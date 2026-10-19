# Read run 2026-10-15: retrospective

First run of update 1 (stores and steps). Steps `list` then `read`, run one at a time. Started 13:16Z on 15 Oct (14:16 UK time), finished 16:24Z.
Logs: `apps/pipeline/data/logs/list-2026-10-15T13-16-06Z.log` and `apps/pipeline/data/logs/read-2026-10-15T13-30-33Z.log`.
Stores: `gs://govbase-pipeline-documents-dev/list/v1/` and `gs://govbase-pipeline-documents-dev/read/v1/`.
Code: pipeline `c2c9a39` on `update/stores-and-steps`, with the S3 bucket config not yet committed. Parser SDK `6df938a` (tag `v0.6.0`). Relay `4a9dc69`, no change since the 14 Oct run.
Written 2026-10-15 from the two logs, a listing of every object in the bucket, three Grafana dashboards through the Prometheus API, and the code of the read path.

| Measure | 13 Oct run | 14 Oct run | 15 Oct run |
| --- | --- | --- | --- |
| Started (UK time) | 14:16 | 00:19 | 14:16 |
| Wall time | 1,164 min | 168 min | 188 min (list 13.4, read 174) |
| Councils | 369 read, 13 lost | 368 read, 14 lost | 370 due, 368 read; list lost 12, read lost 2 |
| Meetings | 7,155 read | 5,856 read | 4,101 listed, 4,086 read, 15 lost |
| Documents listed | 57,460 | 45,300 | 27,986 |
| Documents fetched | 53,839 | 5,710 (38,100 reused) | about 25,600 (120 reused) |
| Time for each fetched document | 1.17 s | 0.92 s | 0.41 s |
| Failed requests (final) | 896, plus 43 skipped | 68, plus 24 skipped | 34, plus 53 skipped |
| Relay 502, 503, 504, 522 replies (before retries) | 128 | 316 | 147 |
| OCR | 8,310 pages in the run | 816 pages in the run | none in the run; 597 scans left for the `ocr` step |
| Browser reads | 3,816 read, 11 failed | 1,119 read, 38 failed | 3,717 read, 6 failed, 2 unreachable |
| Second pass | 11 min | 51 min | none (removed in update 1) |
| Peak pipeline memory (RSS) | 10.1 GB | 6.2 GB | 4.4 GB |
| Raw bytes saved to the bucket | not measured | not measured | 23.9 GiB, 33,067 bodies |

## Questions and short answers

| Question | Short answer |
| --- | --- |
| A. Which issues are proven fixed? | Seven. The `%20` relay bug (0 status 400 for the second run in a row). Night-time gateway errors (this daytime run had 147 gateway replies for about 33,000 requests, against 316 for about 7,000 at night). OCR no longer holds a council (it is its own step). Memory (4.4 GB peak). Camden (listed and read, 109 of 111). The slow second pass (removed). The listing phase (13.4 min, against 26 and 32). |
| B. What new issues do we have? | One big one and eight small ones. **The big one: the read step is bound by the Mac's upload link.** Every fetched file is saved to the bucket as raw bytes, inside the lock that each host holds for its one request at a time. 23.9 GiB went up at a flat 3.0 to 3.6 MB/s. The small ones: documents with an empty address share one store file, the bucket has no retry, metrics export fails (598 and 413), Shropshire reads 0 of 51 documents, Kent is lost on 502s, pending scans and lasting unread documents are fetched again every run, the read step waits 2.5 min before it reads a council, and no OCR ran. |
| C. Where are the bottlenecks? | In order: (1) upload of raw bytes, 2.2 h of the 2.9 h; (2) each council reads one document at a time, and each host takes one request every 2 s or more; (3) 6 bucket round trips in a row for each document; (4) councils are started in order of meetings, not of work. The relay (median 5 of 40 places in use), the CPU (median 3 documents parsing) and the browser (median 2 of 4 slots) were not the limit. |
| D. How do we take a big leap? | Stop sending bytes we do not need, and take every bucket write off the critical path. Then let a council read several documents at once, under a rate per host. Items 1 to 5 below take a full first run like this one from 188 min to about 40 min, and a normal run, which only reads new documents, to about 15 min. |

## The model: what limits a run

A run is as slow as its tightest limit. These are the limits for this run, from the evidence below.

| Limit | What it allows | Time it sets for this run | Binding? |
| --- | --- | --- | --- |
| Mac upload link | about 3.3 MB/s | 23.9 GiB / 3.3 MB/s = 2.2 h | **Yes** |
| One request at a time on a host, 2 s gap | 0.5 documents a second for each host | Birmingham, 578 documents x 2 s = 19 min | Not yet. It binds once the upload is gone |
| One document at a time in a council | one chain for each council, 72 chains | 72 councils / 3.3 documents a second = 22 s for each document | It turns the upload limit into wall time |
| Relay places | 40 | median 5 in use, peak 24 | No |
| CPU (4 cores) | parse | median 3, peak 8 documents parsing | No |
| Browser slots | 4 | median 2 in use, peak 4 | No. It binds once the others are gone |

Little's law checks the model. 72 councils were always in progress (Grafana). Documents finished at about 3.3 a second (bucket object times). So each document took about 72 / 3.3 = 22 s in its council's chain. The log agrees: Birmingham took 17.8 s a document (578 in 171 min), Sunderland 22 s, Luton 25 s.

## A. Issues proven fixed

| Issue | From | Evidence in this run | Verdict |
| --- | --- | --- | --- |
| `%20` paths reach the council as a space (857 of 896 failures) | 13 Oct, item 1 | 0 lines with `(400 `. | Fixed, proven twice. |
| Gateway errors at night | 14 Oct, Cause 1 and item 1 | Daytime start. Gateway replies before retries: 522 95, 502 33, 504 18, 503 1. That is 0.45% of requests, against 4.5% on 14 Oct. Relay 5xx peak 1.1 a minute, against 1.9. Final gateway failures 18, against 34. | Proven: time of day was the cause. Run in the day. |
| OCR holds the council and fills the CPU | 13 Oct Cause 1, 14 Oct Causes 4 and 5 | The read step saves scans as pending (597) and moves on. Documents parsing: peak 8, against 22 and 49. No document waited for OCR. | Fixed for the read step. OCR speed is not proven, because the `ocr` step did not run. |
| Memory | 13 Oct item 7 | Peak RSS 4.4 GB, heap 713 MB, against 6.2 GB and 10.1 GB. | Fixed. |
| Camden lost | 14 Oct, Cause 2 | Feed 403, then read by the browser in 34 s. Council read: 109 of 111 documents. | Fixed. |
| Slow second pass | 14 Oct, Cause 3 | No second pass. A failed document stays unread and is tried again on the next run. | Fixed by design. |
| Long listing phase | 13 Oct, 14 Oct | List step 13.4 min, 3 failed requests, 8 browser reads. | Better. |
| Metrics export stops | 13 Oct item 6, 14 Oct | 114 `Metrics export failed` lines (598: 86, 413: 21, 504: 7). Pipeline data in Grafana stops at about 15:50Z. | **Not fixed. Worse than 14 Oct.** |
| Four histogram panels draw nothing | 14 Oct item 9 | Bucket samples are 0 or 1 at each export. Quantiles are flat. | Not fixed. |
| Fetch stall: fetch 40 to 50 s while the relay answers in 0.4 s | 14 Oct, Cause 6 | Still there: average printed fetch 58 to 73 s from 13:40 to 14:20, relay p50 0.44 s. **Cause now found** (Cause 1 below). | Explained, not fixed. |
| Documents of a council read one at a time | 13 Oct item 3, 14 Oct item 4 | `councils.documentsAtOnce` exists now, but both config files set it to 1. | Built, not switched on. |
| Lost councils from config (9) | 13 Oct item 8 | Still lost at listing: East Renfrewshire, East Staffordshire, Fife, Inverclyde, Mole Valley, South Ayrshire, South Tyneside, and 2 more. | Not fixed. |

## B. New issues

### Cause 1: raw bytes go up the Mac's upload link on the critical path

This is the main finding of this run.

- Update 1 saves every fetched reply to `read/v1/state/raw/` as a body and a record. That is two bucket writes (`saveRaw` in `createReadStore.ts`).
- The save sits inside the host's turn. `getDocument` calls `takeHostTurn`, which holds a one-permit semaphore for the host. It sleeps `requestGapInSeconds` (2 s), sends the request, and then `getReply` runs `saveRawReply` before the turn ends (`createModernGovClient.ts`, `getReply` and `takeHostTurn`).
- The fetch clock in `readFetchedBytes` covers all of it: the wait for the host turn, the 2 s gap, the relay request, the download and the raw upload.
- The run saved 33,067 bodies, 23.9 GiB, mean 0.77 MB, p50 0.16 MB, p90 1.2 MB, p99 13.5 MB, max 80 MB.
- Upload rate, from the object times in the bucket:

| 10 min from (UTC) | Bodies | MB/s up | Average printed fetch |
| --- | --- | --- | --- |
| 13:30 | 1,246 | 2.1 | 60 s |
| 13:40 | 1,995 | 3.1 | 58 s |
| 13:50 | 1,986 | 3.4 | 69 s |
| 14:00 | 2,146 | 3.4 | 73 s |
| 14:10 | 1,998 | 3.6 | 67 s |
| 14:20 | 2,199 | 3.3 | 44 s |
| 15:00 | 1,382 | 2.3 | 33 s |
| 15:50 | 1,570 | 1.8 | 31 s |

- The rate is flat at 3.0 to 3.6 MB/s (24 to 29 Mbit/s) while the relay has 35 places free. That is the shape of a full link, not of a slow server.
- 72 councils shared that link. A 0.77 MB body got about 3.3 / 72 = 0.05 MB/s, so about 17 s. That matches the 17.8 s a document of Birmingham.
- The download of the same 23.9 GiB shares the same home line.
- The 14 Oct run also saved raw bytes (up to 6,280 saves in each half hour in Grafana), but it fetched only 5,710 documents, so the link was not full for long. Its "fetch stall" was likely the same cause. This is likely, not proven.

### Cause 2: one document at a time, one request at a time on a host

- `councils.documentsAtOnce: 1`. A council is one chain: meetings in order, items in order, documents in order.
- `takeHostTurn` lets one request at a time reach a host, with a 2 s sleep first, and it holds the turn through the raw save.
- Councils that share a host share one turn: Fermanagh and Omagh and Armagh City both use `www.decisiontime.online`. They took 155 and 106 min. 147 of their documents took 30 s or more.
- The longest council sets the end of the run. From 16:00Z, 63 councils finished in 10 min, then Birmingham ran alone until 16:24Z.

### Cause 3: six bucket round trips in a row for each document

For each typed document, the read step makes these calls one after the other: read the old outcome, save the raw body, save the raw record, save the text, save the outcome, save one event. Each round trip from the Mac to `storage.googleapis.com` takes 0.15 to 0.25 s before any upload. That is 1 to 1.5 s for each document, about 7 to 10 min of Birmingham's chain.

The bucket now holds 25,415 outcomes, 37,937 texts, 23,217 events (one object for each event) and 66,132 raw objects. That is about 153,000 writes in 3 hours.

Grafana shows 1,800 to 4,600 "read failed" bucket calls in each half hour. These are the outcome reads of new documents, which find nothing. A missing record should count as a miss, not a failure.

### Cause 4: the read step waits 2.5 min before it starts

`readDueCouncils` in `buildReadStep.ts` reads 382 listing records and council records with `Effect.forEach` and no concurrency. "Starting step: read" at 13:30:35, "Councils due" at 13:33:03.

### Cause 5: councils start in order of meetings, not of work

The read step sorts councils by number of meetings. Birmingham comes first with 120 meetings, but more than 40 of them are future meetings with 0 documents, some in 2027 (past `cmisFutureInDays: 14`). The work is the documents not yet known, multiplied by the time a document takes on that host.

### Smaller issues

1. **Empty address, one store file.** 22 GCS 429s on `read/v1/state/documents/e3b0c442….json` from 11 ModernGov councils, 2 each. Already item 1 of `pipeline-todo-2026-10-15.md`. Outcomes overwrite each other, so data is lost.
2. **Same text saved twice at once.** 2 GCS 429s on texts (Falkirk). To-do item 2.
3. **No bucket retry.** 3 GCS 503s and 1 500 on raw saves, 1 503 on a text. To-do item 3.
4. **Metrics export.** See the table in A. To-do item 4. JSON bodies grow until Grafana answers 413.
5. **Shropshire reads 0 of 51 documents.** Each document redirects to `modgov.shropshire.gov.uk/mgError.aspx`, which answers 404. The browser gets 404 too. After 3 failures the host cut-off skips the other 45. A 404 on one document should not count as a failure of the host. The redirect itself needs a check by hand: it may need a cookie or a different path.
6. **Kent lost.** Every `GetMeeting` call gave 502, 3 times each. Service calls have no browser fallback for 502 (`browserFallbackStatuses.service: [403, 404]`). Caerphilly was lost the same way with 504. This was item 9 of the 13 Oct list.
7. **Work done again on every run.** `readIsKnown` counts a document as known only when its status is `read`. So the 597 pending scans, and lasting unread documents such as too-large (27, 52 to 131 MB each) and not-supported, are fetched and uploaded again on every run until the `ocr` step reads them. For a too-large file, the log prints its full size; check if the whole body is downloaded before it is skipped.
8. **No OCR ran.** The run used `dev:step:read`, so 597 scans wait in `read/v1/state/pending/`. The speed of the `ocr` step is not measured yet.
9. **Browser restarts.** Chrome started 2 to 4 times in every 10 minutes, and up to 56 contexts in 10 minutes were closed by a restart. Not yet a limit, but it will be one when the browser is busy.

## C. Bottlenecks and where to improve

| Rank | Bottleneck | Share of the run | Evidence |
| --- | --- | --- | --- |
| 1 | Raw upload inside the host turn | about 75% | Flat 3.3 MB/s up, relay idle, 22 s a document (Little's law) |
| 2 | One document at a time per council, one request per 2 s per host | the tail, about 25 min | Birmingham alone from 16:00 to 16:24; shared `decisiontime.online` |
| 3 | 6 bucket round trips in a row per document | about 5% | 1 to 1.5 s per document |
| 4 | Order of councils | about 5% | Biggest chain started first, but by meetings, not by work |
| 5 | Start-up read of listing records | 2.5 min | `readDueCouncils` without concurrency |
| Next | Browser: 4 slots, Chrome restarts | 0% now | Bristol: 302 documents through the browser, 104 min |
| Next | CPU for parsing | 0% now | Median 3 documents parsing; no CPU metric on the Mac |
| Next | Download link | not known | The same 23.9 GiB came down; its speed is not measured |

## D. Proposals for a big leap

### The shape of the read step after the change

Treat the read step as three stages with their own limits, joined by bounded queues, not as one chain for each council:

1. **Fetch.** Each host has a rate (a token bucket at the relay's limit for each host), not a lock. A council puts several documents in flight (`documentsAtOnce: 4`). The host turn covers the network request only.
2. **Parse.** A pool sized to the cores, as now.
3. **Write behind.** Store writes go to a bounded queue, drained by a fiber in the step's scope, with retry. The step ends when the queue is empty. A document is "done" only after its outcome is written, so a crash loses work, never a record. Raw bodies go up only when a later step needs them.

Each stage is then limited by its own resource, and the slowest one sets the time. Today one chain carries all three, so the slowest resource is waited for 72 times over.

### Top 16 improvements

The percentage is the estimated effect on that measure for a run like this one (a full first read of 25,600 documents). A: wall time. B: failed requests. C: documents not captured. D: documents parsed wrongly. Each estimate assumes the items above it are made first.

| # | Change | Where | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Save raw bodies only when a later step needs them: pending scans, failed or blocked replies, and listing XML and HTML. Key a body by its content hash, so the same file is saved once. A typed PDF read to text keeps its text only. **This changes the redesign decision "raw bytes always on", so the owner must agree.** Put the choice in config, such as `bucket.rawBodies: needed` or `all`, so update 2 on a box can use `all`. | `saveRawReply` in `createModernGovClient.ts`, `buildRawKey` in `createReadStore.ts`, bucket config | -55% | | | |
| 2 | Take every store write out of the host turn and out of the document chain: a write-behind queue with retry, drained before the step ends. | `takeHostTurn`, `getReply`, `createReadStore`, `createObjectBucket` | -10% | -8 store errors | | |
| 3 | Replace the host lock and 2 s sleep with a rate for each host. Set `documentsAtOnce` to 4. Then a council waits only on its host's rate. | `takeHostTurn`, `councils.documentsAtOnce` | -15% | | | |
| 4 | Fewer round trips per document: write text, outcome and event at the same time; write events as one object for each council and run; count a missing outcome as a miss. | `readCouncilMeetings.ts`, `createReadStore.ts`, `createMetrics` | -3% | | | |
| 5 | Start councils in order of expected work (documents not known x host time), and read the listing records with concurrency 16. | `buildReadStep.ts` | -3% | | | |
| 6 | Count pending scans and lasting unread documents (too-large, not-supported, gone twice) as known. Skip a too-large file from its headers, before the body comes down. | `readIsKnown`, `readSkipCause`, `readFileSkipCause` | -10% on a normal run | | | |
| 7 | Raise the relay rate to 60 a minute for each host with burst 5, and the pipeline's host rate with it. Carried from 13 Oct item 17. | `apps/relay` conf, `moderngov.requestGapInSeconds` | -5% | | | |
| 8 | Do not save an outcome for an empty address; count it on its own. To-do item 1. | SDK `readMeetingXml.ts`, `readDocumentRecord` | | -22 | about 22 outcomes kept | |
| 9 | Retry bucket calls on 429, 500 and 503. Treat a 429 on a text that now exists as done. To-do items 2 and 3. | `createObjectBucket.ts`, `saveText` | | -7 | | |
| 10 | Do not count a document 404 as a host failure. Check Shropshire's `mgError.aspx` redirect by hand. | `hostFailureStatuses`, `takeHostTurn` | | -45 skipped | 51 documents, 1 council | |
| 11 | Give service calls a browser fallback on 502 and 504. Carried from 13 Oct item 9. | `moderngov.browserFallbackStatuses.service` | | -8 | 2 councils, 13 meetings | |
| 12 | Fill in `sources.yaml` for the 9 councils with no reader, address or documents. Carried from 13 Oct item 8. | `config/sources.yaml` | | | 9 councils | |
| 13 | Send metrics as protobuf, find why histograms show 0 or 1 at each export, and add a test that records two values and reads a count of 2. To-do item 4. | `createMetrics` | | | | |
| 14 | Time each stage of a document: host wait, network, parse, store write. Log them in the slow-document line and as histograms. Add Mac CPU and network bytes. | `readCouncilMeetings.ts`, `createMetrics` | | | | |
| 15 | Run the `ocr` step on the 597 pending scans, and measure pages an hour with 3 readers. | `run.steps`, `ocr.scansAtOnce` | | | 597 documents | |
| 16 | Fetch documents on browser-first hosts with one `fetch()` inside the page, and stop the Chrome restart every few minutes. Carried from 13 Oct items 10 and 20. This becomes the limit after items 1 to 3. | `apps/browser` | -5% | | | |

### What the items add up to

- **A first full run like this one.** Item 1 removes about 2.2 h of upload. Items 2 and 3 bring the chain of a document to the host rate, so Birmingham takes about 20 min. With items 4 and 5: list 13 min plus read about 25 min, so about **40 min, against 188 min**. Item 7 brings the read to about 15 min.
- **A normal run**, which reads only documents not known (the 14 Oct run fetched 5,710): about **15 min**, most of it listing. Item 6 stops the same files being fetched every run.
- After that, the limits are the listing (CMIS councils walk up to 80 committee pages), the browser and the download link. Measure them before the next change (item 14).

### Scale beyond the Mac

- The Mac stays the runner for about six months (owner decision of 15 Oct). Item 1 is the change that fits the Mac: the upload link is fixed, so send fewer bytes.
- The `ocr` step already has `shareIndex` and `shareCount`. Give the read step the same, split by council, so two processes can run when a box arrives. Update 2 puts the run beside the bucket, where `rawBodies: all` costs nothing.

## What the next run should show

- [ ] Raw bytes saved under 3 GiB for a full run, or under 0.5 GiB for a normal run.
- [ ] Bucket upload rate never flat at its peak for more than 10 min.
- [ ] Printed fetch times under 10 s while the relay p50 is under 1 s. Carried from 14 Oct.
- [ ] Read step under 30 min for a full run, and the slowest council under 25 min.
- [ ] No `e3b0c442` line and no `S3Error` line.
- [ ] No `Metrics export failed` line, and the histogram panels draw lines.
- [ ] Shropshire reads its documents. Kent and Caerphilly are read, or the cause is a council outage.
- [ ] The `ocr` step runs on the pending scans, with its pages an hour written down.
- [ ] Started between 08:00 and 20:00 UK time.

## Sources

- `apps/pipeline/data/logs/list-2026-10-15T13-16-06Z.log` (517 lines) and `apps/pipeline/data/logs/read-2026-10-15T13-30-33Z.log` (12,726 lines).
- `gcloud storage ls -l -r` and `du -s` of `gs://govbase-pipeline-documents-dev/read/v1/` and `list/v1/`, on 2026-10-15.
- Grafana Cloud `friendlymule476.grafana.net`, dashboards govbase-pipeline, govbase-browser and govbase-relay, 2026-10-15 13:10Z to 16:30Z, and 2026-10-14 23:00Z to 2026-10-15 03:00Z for comparison, through the Prometheus API.
- Round-trip times from the Mac to `storage.googleapis.com`, the relay and the browser, measured with `curl` on 2026-10-15.
- Code: `src/domain/readCouncilMeetings/readCouncilMeetings.ts`, `src/domain/buildReadStep/buildReadStep.ts`, `src/infrastructure/createModernGovClient/createModernGovClient.ts`, `src/infrastructure/createReadStore/createReadStore.ts`, `config/development/config.yaml`.
- `docs/read-run-2026-10-13-retrospective.md`, `docs/read-run-2026-10-14-retrospective.md`, `docs/pipeline-todo-2026-10-15.md`.
