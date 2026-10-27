# OCR step: ways to make it faster

As of 26 October 2026. This doc lists the ways to make the pipeline's OCR step faster or cheaper. It starts from the first cloud OCR run, `govbase-pipeline-dev-ocr-jmlht`, and the restart that finished the backlog, `govbase-pipeline-dev-ocr-729cl`. Nothing in this doc is built. Section F gives the order we recommend.

## Short answers

1. **CPU is the limit, not memory.** Each task used 1.9 to 2.0 of its 2 vCPU for the whole run. Memory stayed at 1.2 to 2.5 GiB of 3.8 GiB. More workers in a task do not help, because Tesseract uses one CPU for each worker.
2. **There are three kinds of fix.** Share the work better between tasks (section C). Do less CPU work for each page (section D). Get more CPU, or pay a service to read the pages (section E).
3. **The cheapest win is a fair split of the work.** Today each task takes the scans whose ID falls in its share. On the restart, one task got 146 of the 178 scans and ran for about 80 minutes. The other tasks had little or nothing to do. A split by page count would have finished in about 10 minutes.
4. **The biggest CPU win is probably the slow pages.** A page that has no text when read upright goes through up to 6 Tesseract passes. A blank page takes 5 passes and gives nothing. We do not know yet how many pages take this path. Measure it first (section B).
5. **A paid service is fast but costs about 10 times more.** Google Cloud Vision costs $1.50 for each 1,000 pages. The jmlht run read 42,632 pages, so it would have cost about $62. The Cloud Run compute for the same run cost about $6.
6. **The backlog is done.** A daily run only reads new scans. If that is a few hundred pages a day, speed may not matter for daily runs, only for a backfill when we add councils. Measure the daily volume before you spend effort (section B, M4).

## A. What we know now

**Words used in this section**

- **OCR**: optical character recognition. A program looks at a picture of a page and finds the text in it.
- **Tesseract**: the free OCR program the parser SDK uses. The SDK runs Tesseract.js 7, a copy of Tesseract built as WebAssembly (WASM), which runs inside Bun.
- **Pass**: one full Tesseract read of one image.
- **Task**: one copy of the Cloud Run job. The OCR job runs 10 tasks at once.
- **vCPU**: one virtual CPU in Google Cloud.

### The run

| Measure | Value |
| --- | --- |
| Job | `govbase-pipeline-dev-ocr`, 10 tasks, 2 vCPU and 4 GiB each |
| CPU used | 20 vCPU, which is all of the region quota in `us-central1` |
| Time | 13:27 to about 17:20 UTC, about 3 hours 53 minutes, then cancelled |
| Scans read | about 7,000 (Grafana: 6,993 read, 1 unsaved, no out-of-memory) |
| Pages read | 42,632 read, 2 failed |
| Pages not read | 5,679, because `ocr.maxImagePages` is 60 |
| CPU in each task | 1.9 to 2.0 of 2 vCPU |
| Memory in each task | 1.2 to 2.5 GiB of 3.8 GiB |
| Time for one page | mean 5 to 7 s, p95 20 to 30 s, up to about 55 s near the end |
| CPU for one page | about 6.6 vCPU-seconds on average (20 vCPU × 14,000 s ÷ 42,632 pages) |
| Compute cost | about $6 (about $5 CPU, $1 memory), before the free tier |

The cost uses the Cloud Run job prices in `us-central1`: about $0.000018 for each vCPU-second and $0.000002 for each GiB-second. Check the pricing page before you use these numbers.

The restart read the last 178 scans and 1,336 pages, with no failures and no watchdog stops. Only 4 of the 10 tasks had work. One task had 146 scans.

### How the SDK reads one page

The pipeline gives each page image to `scanReader.readImage`. The SDK then does these steps (`apps/parser-sdk/src/image/readRecognizedLines.ts`):

1. **Upright read.** 1 pass. If Tesseract finds lines, the page is done. Most pages stop here.
2. **Adaptive read.** 1 more pass, with Sauvola thresholding. Thresholding is how Tesseract turns the image into black and white. Sauvola works better on uneven light. The page is done if it finds 12 words or more (`leastAdaptiveWords`).
3. **Turned read.** The SDK makes 3 small copies of the page, turned by 90, 180 and 270 degrees, each with its longest side at 1,500 px (`turnedImageSide`). It reads each one: 3 passes. If the best turn finds 12 words or more (`leastTurnedWords`), it reads the full page at that turn: 1 more pass.

So a page costs 1 to 6 passes:

| Page | Passes |
| --- | --- |
| Upright text | 1 |
| Faint or uneven text | 2 |
| Blank page | 5, and no text |
| Turned page | 6 |

On the Mac, the largest page took about 15 s upright and about 55 s on the turned path.

Other facts that matter:

- The model is `eng` `4.0.0_best_int`, the accurate English model. Tesseract also has a "fast" model. It is not in the npm package we use.
- The WASM build uses relaxed SIMD. SIMD lets the CPU work on many numbers in one step. Bun supports it, so we already use the fastest WASM build.
- Each Tesseract worker uses one thread. The pipeline starts `ocr.scansAtOnce` workers (2), and reads 2 scans at once. The pages of one scan are read one after the other.
- The parse step draws each page at `imageScale` 3, which is 216 dots per inch, with the longest side at 5,000 px or less.
- Each task takes the scans whose ID, as a number, divided by the task count, leaves its task index (`readIsOwnShare` in `buildOcrStep.ts`). This gives each task about the same number of scans, but not the same number of pages, and not the same number of slow pages.

## B. Measure first

These four measures are small. They tell us which of the options below are worth the work.

| Id | Measure | How | App |
| --- | --- | --- | --- |
| M1 | Which path each page took (upright, adaptive, turned, nothing found) and the time for each path | The SDK returns the path with the lines. The pipeline counts it in a new metric with a `path` label. | SDK and pipeline |
| M2 | How many page images are the same file | List `parse/v<n>/documents/images/` and count the files with the same ETag and size. The ETag is a checksum the bucket gives in the file list, so no download is needed. | A tool script |
| M3 | Pages for each scan, and how uneven the shares are | Count the `page-<n>.png` keys for each scan ID in the same list. | A tool script |
| M4 | New scans and pages each day | Read `govbase_pipeline_pending_scans` and the pages counter after each daily run. | Grafana |

## C. Share the work better

These options do not save CPU. They stop tasks from sitting idle while one task works alone.

### C1. A fair split from a snapshot (recommended)

- **What:** `runStep.sh` gives every task the same plan time. Each task lists the scan IDs and the OCR store, with the time of each file. A scan counts as pending if it had no OCR file at the plan time. So all tasks see the same pending list, even while other tasks save new files. Each task weighs each scan by its page count, from the image list, capped at `maxImagePages`. It gives the largest scans first to the share with the fewest pages. Then it reads its own share and skips the scans that already have an OCR file.
- **Gain:** the restart would have taken about 10 minutes, not 80. A full run ends with a shorter tail, because no task gets many more pages than the others.
- **Effort:** small, in the pipeline only. `readObjectTimes` already gives the file times. No new bucket writes.
- **Risk:** low. All tasks must use the same plan time, or the shares overlap. A slow-page cluster can still make one share slower, because the split counts pages, not passes.

### C2. Claim each scan

- **What:** each task walks the pending list in a random order. Before a scan, it writes a claim file. It skips a scan that has a claim.
- **Gain:** the best balance. It also handles slow pages, because a task that finishes early takes more scans.
- **Effort:** medium. The claim must be "write only if the file does not exist", or two tasks can claim the same scan. Bun's S3 client may not send that condition to Google Cloud Storage (not confirmed). We would need the Cloud Storage JSON API with `ifGenerationMatch=0`. A claim from a task that crashed must expire, or its scans are lost for that run.
- **Risk:** medium. More code, and about one extra write for each scan.

### C3. Largest scans first

- **What:** each task sorts its own share by page count, largest first.
- **Gain:** small. The run does not end with one big scan on its own.
- **Effort:** very small. C1 includes it.

## D. Less CPU for each page

These are changes in the parser SDK. Each one can change the text we get. Test each one on a fixed set of pages and compare the text before and after.

### D1. Skip blank pages

- **What:** before any pass, make a small copy of the page and count the dark pixels. If there are almost none, return no lines and skip all passes.
- **Gain:** 5 passes for each blank page. M1 tells us how many there are. Scanned packs often hold blank backs of sheets.
- **Effort:** small, in the SDK. `@napi-rs/canvas` already loads the image.
- **Risk:** a very faint page could be skipped. Set the line from real pages, and count the skipped pages in a metric.

### D2. Find the turn with less work

- **What:** one or more of these:
  - Test 90 and 270 degrees before 180, and stop when a test finds many words, for example 3 times `leastTurnedWords`. Most turned pages are probably landscape pages, turned by 90 or 270 degrees. Today the SDK always does all 3 tests, in the order 90, 180, 270.
  - Make the test copies smaller, for example 800 px in place of 1,500 px. This is a config change: `textReading.turnedImageSide`.
  - Use Tesseract's OSD mode in place of the 3 test reads. OSD means orientation and script detection: one quick pass that only finds which way the page is turned. It needs the `osd` data file and the older Tesseract engine build. Not confirmed that Tesseract.js 7 gives this in Bun.
- **Gain:** up to 2 or 3 of the 6 passes on each turned page.
- **Effort:** small for the first two, medium for OSD.
- **Risk:** a smaller test copy can choose the wrong turn on small print.

### D3. The fast model

- **What:** use Tesseract's `fast` English model in place of `best_int`. We would keep the model file in the SDK, because the npm package does not have it.
- **Gain:** Tesseract's own notes say the fast models are faster and a little less accurate. We have no number for our pages. Measure it.
- **Effort:** small.
- **Risk:** worse text on poor scans. It could also be a choice per path: fast for the test reads in D2, best for the final read.

### D4. Read each page image once

- **What:** keep the OCR lines of each page image under its checksum. When the same page image comes again, use the saved lines. This happens when an agenda item PDF is also inside the full pack PDF.
- **Gain:** depends on M2. The join already leaves out 1,432 parts as copies, because they share their text with another part. Some of these were scans that OCR read twice. We do not know how many.
- **Effort:** medium. A new folder in the OCR store, one extra read for each page, and the same drawing scale for both copies.
- **Risk:** low. The same image bytes give the same text.

### D5. Smaller page images

- **What:** draw or shrink pages to fewer pixels before OCR.
- **Gain:** probably small. Tesseract reads small print best at about 300 dots per inch. We draw at 216, so most pages are already small. Only the largest pages (up to 5,000 px) would gain.
- **Effort:** small.
- **Risk:** small print becomes harder to read. Low value. Not recommended now.

### D6. Native Tesseract

- **What:** install the normal Tesseract program in the Docker image. The SDK runs it for each page and reads its TSV output (a text table of words and their boxes) into blocks and paragraphs. This replaces the WASM build.
- **Gain:** native code is usually faster than WASM. We have no number for our pages. Measure it on the Mac before you build it.
- **Effort:** medium to large. A new recognizer in the SDK, a change to the Docker image, and Tesseract installed on the Mac for local runs. The text output can differ from today, so tests change.
- **Risk:** two ways to run Tesseract, and a program outside Bun to keep up to date.

## E. More CPU, or a paid service

### E1. More Cloud Run CPU quota

- **What:** ask Google to raise the Cloud Run CPU quota in `us-central1` from 20 vCPU, for example to 40 or 80. Then raise the task count and parallelism.
- **Gain:** a run takes about half the time at 40 vCPU. The cost for each page stays the same, because we pay for each vCPU-second.
- **Effort:** a quota request in the console, and a change to `check.yml`.
- **Risk:** low. The parse jobs use the same quota. A run that uses all of it blocks a parse job that starts at the same time.

### E2. Google Cloud Vision for all pages

- **What:** send each page image to the Vision API with `DOCUMENT_TEXT_DETECTION`. Google Document AI Enterprise Document OCR is a similar service at the same price.
- **Gain:** fast. We can send many pages at once, and no CPU is used in our tasks. It finds turned pages by itself, and it reads poor scans and handwriting better than Tesseract.
- **Cost:** $1.50 for each 1,000 pages after the first 1,000 free pages each month. $0.60 above 5 million pages. The jmlht run would have cost about $62, against about $6 of compute today. The redesign budget is $100 to $200 a month for machines and storage.
- **Effort:** medium. A new recognizer in the SDK that maps the Vision answer to blocks and paragraphs, a service account role, and the API's request quota.
- **Risk:** the cost grows with the pages. The text and the layout differ from Tesseract's. The pages go to an outside service, but they are public council documents.

### E3. Vision only for the slow pages

- **What:** read each page upright with Tesseract first. Send only the pages where that read finds nothing to Vision, in place of the adaptive and turned passes.
- **Gain:** removes up to 5 passes from each slow page, and gives better text on poor scans.
- **Cost:** $1.50 for each 1,000 slow pages. M1 tells us how many there are.
- **Effort:** medium, the same as E2, plus the rule for when to send.
- **Risk:** two engines give text of different quality on different pages.

### Not recommended now

- **A vision language model**, such as Gemini, to read the pages. It can write text that is not on the page, and that is hard to detect.
- **Spot VMs through Cloud Batch.** The CPU is cheaper and the quota is separate. But it is a new way to run jobs, and a run costs only about $6 today.
- **A second OCR job in another region** to get past the per-region quota. It works, but E1 is simpler. Reading the bucket from another region may cost network fees (not confirmed).

## F. Recommended order

| Step | Option | Saves CPU | Shorter run | Effort | App |
| --- | --- | --- | --- | --- | --- |
| 1 | M1 to M4 measures | No | No | Small | SDK, pipeline, Grafana |
| 2 | C1 fair split (with C3) | No | Yes | Small | Pipeline |
| 3 | D1 skip blank pages | Yes | Yes | Small | SDK |
| 4 | D2 stop early, smaller test copies | Yes | Yes | Small | SDK, config |
| 5 | D4 read each page image once, if M2 shows many copies | Yes | Yes | Medium | Pipeline |
| 6 | E1 more quota, or E3 Vision for slow pages, if M4 shows the daily volume is too large | No / Yes | Yes | Small / Medium | Console / SDK |
| Later | D3 fast model, D6 native Tesseract, after a test on our pages | Yes | Yes | Small / Large | SDK |

Steps 3 and 4 need a fixed test set of pages, with the text before and after, so we can see what each change costs in quality.

## G. Open questions

1. Does OCR speed matter for daily runs, or only for a backfill when we add councils? M4 answers this.
2. Is about $1.50 for each 1,000 pages inside the budget, for all pages or only the slow pages?
3. Should `ocr.maxImagePages` go above 60? The jmlht run left 5,679 pages unread because of it.

## Sources

- [Cloud Vision pricing](https://cloud.google.com/vision/pricing)
- [Document AI pricing](https://cloud.google.com/document-ai/pricing)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
