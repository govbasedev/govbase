# Parse step: the fixes for the files that run out of memory

As of 25 October 2026. This doc follows `pipeline-parse-out-of-memory-2026-10-25.md`, which found the files that were in progress when a Cloud Run task was killed. This doc says what in those files uses the memory, measured file by file on the Mac, and the changes that fix it: four in the parser SDK and two in the pipeline. The measurements come from copies of the SDK source with the changes patched in, in a temporary folder. Everything in sections C and D was built on 25 October, uncommitted in both repositories, with one change from the first design: the started marker is never removed, because the pipeline's verb list has no `delete`, see D1. The owner's steps are in section F.

## Short answers

1. There are three causes, not one. Most of the memory is not the pictures.
2. **Cause 1: vector maps and plans.** A page drawn from tens of thousands of short lines makes the SDK's ruled-table detection run a quadratic merge over those lines. One page of the Horsham file took 87 seconds and grew the process by 2.8 GB, and the whole file gave 4 MB of markdown that was empty tables.
3. **Cause 2: pdf.js caches and canvases that are never freed.** pdf.js keeps every page's decoded pictures and operator list until the document is closed, and the SDK never frees the canvases it draws on. The Cotswold file reached 4.9 GB in the SDK and 3.9 GB in pdf.js alone; with a cleanup after each page, pdf.js alone stays at 1.5 GB.
4. **Cause 3: thousands of pictures.** Each picture is drawn on a canvas, encoded as a PNG and held until the document is saved. The Cheshire East file has 1,515 pictures and spends 207 of its 290 seconds encoding them. Swale's Appendix A has 17,650.
5. **JPEG 2000 is not a cause.** The Horsham file was blamed for its 21 JPEG 2000 pictures. pdf.js decodes all 21 in 55 MB and 15 seconds.
6. **The fix in the SDK:** a cap on the lines used for table detection, a cleanup of each page after it is read and after it is drawn, canvases freed after each encode, a pixel copy with no allocation per pixel, and a per-document picture budget.
7. **The fix in the pipeline:** a marker saved before each parse and deleted after it, so a file that still kills a task is parked as a `cut-off` error on the next try and its share goes on. A tool clears the parked records when they should be tried again.
8. **A watchdog is possible too.** The pipeline already samples its memory and knows the container limit. To drop a document before the limit, the SDK read must run in a worker thread that the main thread can stop, as the OCR step already does for its scan readers. Section D4 says how, and what it cannot catch.
9. **Results:** with the four SDK fixes and no picture budget, every one of the 12 killer files measured stays under 1.7 GB. Before, 10 of the 12 passed 2.9 GB and 4 passed 4.9 GB. Horsham went from 161 seconds and 5.2 GB to 29 seconds and 1.1 GB; Swale's 134-page photo appendix from 357 seconds and 5.5 GB to 266 seconds and 1.4 GB. Section E has the table.

## A. How the files were measured

**Words used in this section**

- **RSS**: resident set size, the memory a process holds, as the operating system counts it. Cloud Run kills a task when the memory of its container passes the limit, so RSS is the number that matters.
- **Peak**: the highest RSS seen during one parse, sampled every 50 ms.
- **Phase**: one part of reading a page: the operator list, the line segments, the text blocks, the pictures.
- **Copy**: a copy of the SDK source at `v0.9.0` in a temporary folder, with `node_modules` pointing at the pipeline's packages, so a change can be patched in and run without touching the repository.

Three scripts were used, all run with Bun 1.4.2 on the Mac:

1. `measure.mjs` reads one file with `createParser(...).readDocument(...)`, with the reading options of `apps/parser-sdk/corpus/reading.json`, which are the committed pipeline config. It samples RSS every 50 ms and prints the time, the peak, the page count, the pictures and page images stored, and the markdown size.
2. `probePdfjs.mjs` drives pdf.js alone, with no SDK code: it opens the file as the SDK does and, for each page, builds the operator list and the text content, then counts the operators, the path operators, the numbers inside the paths, the pictures and their decoded bytes. A variant calls `page.cleanup()` after each page.
3. A patched copy prints the time and RSS after each phase of `readPage`.

The scripts and the batch runner are kept in `apps/pipeline/data/oom/scripts/`, which git ignores, beside the scripts of the first doc.

**Limits of the method.**

- The Mac ran two or three measurements at once, so the times are inflated and two runs are not comparable in time. The peaks are comparable: each process has its own RSS.
- The peak depends on when the garbage collector runs. The same Horsham code gave 5.2 GB in one run and 7.7 GB in another. A difference under about 20 percent means nothing.
- The Mac is macOS 12 on x64; the cloud is Linux on x64, with the Bun of the `oven/bun:1` image. The engine is the same, so the shape of the numbers should carry over, not the exact values.

## B. What uses the memory

**Words used in this section**

- **Operator list**: pdf.js's list of the drawing commands of one page: text, paths, pictures. It is built once per page and cached inside the page object.
- **Path**: one drawing command made of moves, lines and curves. A map has hundreds of thousands.
- **Segment**: one straight line the SDK takes from a path, when it is nearly horizontal or vertical and at least 2 points long. The SDK reads segments to find the ruled lines of tables.
- **Ruler**: segments on the same line, merged into one.
- **Cache**: data kept in memory to avoid computing it again. pdf.js keeps each page's decoded pictures in `page.objs` and its operator list in the page's intent states.
- **Canvas**: the bitmap the SDK draws on, from `@napi-rs/canvas`. Its pixels live outside the JavaScript heap, so the garbage collector does not see their size and frees them late.
- **Garbage**: memory that is no longer used but not yet collected. It counts in RSS until the collector runs.

### B1. Vector drawings and the table detection

The Horsham file, `06856823ebd2`, is 4 pages of policies maps. pdf.js alone reads it in 15 seconds with a peak of 1.3 GB:

| Page | Operators | Path operators | Numbers in paths | Pictures | Decoded pictures | Text items | Operator list time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 55,402 | 42,482 | 892,428 | 8 | 55 MB | 93 | 2.3 s |
| 2 | 125,742 | 91,628 | 1,255,006 | 504 | 55 MB | 124 | 2.0 s |
| 3 | 4,506 | 2,872 | 86,844 | 8 | 55 MB | 19 | 0.5 s |
| 4 | 353,818 | 317,205 | 3,676,254 | 314 | 55 MB | 263 | 6.1 s |

The SDK took 161 seconds and 5.2 GB on the same file. The phases of each page say where:

| Page | Segments found | Operator list | Segments | Text blocks and tables | Pictures | RSS after the page |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 31,974 | 3.1 s | 0.2 s | 20.0 s | 4.0 s | 3.5 GB |
| 2 | 110,293 | 2.1 s | 0.2 s | 32.2 s | 4.7 s | 4.1 GB |
| 3 | 3,817 | 0.3 s | 0.0 s | 0.3 s | 3.9 s | 4.2 GB |
| 4 | 117,409 | 7.9 s | 1.9 s | 86.7 s | 14.6 s | 5.9 GB |

The text blocks phase is `buildPdfBlocks`, which calls `buildPdfTables` with every segment of the page. Two things in `buildPdfTables` grow with the square of the segment count:

- `buildMergedRulers` sorts the rulers, then for each one searches the whole list of merged rulers with `findIndex`.
- `growGrid` repeats `growRulers` until no ruler is added, and `growRulers` spreads the set of crossed rulers into a new array for every candidate on every round.

With 117,409 segments that is tens of millions of comparisons and millions of short-lived arrays. The arrays are the memory: RSS grows by 0.7 to 2.8 GB during the phase, and the collector does not run in time. The result is wrong as well as slow: the markdown of the file is 4,126 KB, almost all of it tables of empty cells read from the grid of the map. With the cap of section C1 the same file gives 20 KB.

Page 3 shows the scale that is fine: 3,817 segments, 0.3 seconds.

### B2. pdf.js caches and canvases

pdf.js decodes every picture of a page when it builds the page's operator list, and keeps the decoded pixels in the page object until `page.cleanup()` is called or the document is destroyed. The SDK never calls `cleanup()`. It reads every page first, then draws the scan pages, then closes the document. So the decoded pictures of every page are in memory at the same time, 3 or 4 bytes a pixel.

The Cotswold file, `3e8f20ce4f4e`, is 88 pages with 22 pictures, 3 of them 8.7 megapixels. pdf.js alone, with no SDK code:

| Variant | Peak RSS |
| --- | --- |
| As the SDK uses it | 3,891 MB |
| With `page.cleanup()` after each page | 1,488 MB |

The SDK adds its own share. `buildPixelPng` draws each picture on a canvas it never frees, and builds the RGBA bytes with one four-element array per pixel, so a 7 megapixel picture makes 7 million small arrays. `buildLoadedPng` and `buildTurnedImage` make canvases the same way. A canvas's pixels are native memory: the collector does not count them, so it does not hurry.

| File | SDK as it is | SDK with cleanup, freed canvases and a plain pixel copy |
| --- | --- | --- |
| City of London `0682c12488cd`, 23 slide pages, all drawn as page images | 760 MB | 372 MB |
| Cotswold `3e8f20ce4f4e`, 88 pages, 22 pictures | 4,966 MB | 1,350 MB |

### B3. Thousands of pictures

The Cheshire East file, `98a297ac5a14`, is 25 plan pages with 1,515 pictures, 1,507 of them JPEG 2000 tiles. With the fixes of B2 in place its phases sum to: operator lists 65 seconds, segments 0.3 seconds, text blocks 0.8 seconds, pictures 207 seconds. The pictures phase is about 135 ms a picture, almost all of it the PNG encoding on a canvas. The 1,515 PNGs held at the end are 85 MB. Each one is also one save to the bucket.

Swale's Appendix A 801-934, `21b5931c246d`, draws 17,650 pictures, 11,564 of them different. With the fixes of B2 it takes 266 seconds and 1.4 GB, and holds 127 MB of PNGs at the end: the pictures are small, about 20 ms each. The cost that stays is the saves: 11,564 objects in the bucket for one document, and the same number of keys in the images folder that the OCR step lists at the start of each run.

### B4. What is not a cause

- **JPEG 2000.** The first doc blamed the Horsham, Harrow and Cheshire East files on JPEG 2000. The real sizes inside their codestreams, read from the `SIZ` marker of each one, match the sizes in the PDF: Horsham's 21 pictures are 4327 by 484 pixels at most, 39 megapixels in all. pdf.js decodes them in 55 MB. Harrow's 259 are 63 megapixels in all; Cheshire East's 1,507 are 247 megapixels, with one of 70 megapixels that pdf.js skips because it is over `largestPicturePixels`.
- **File size.** The 5.6 MB City of London file and the 12.6 MB Horsham file were killed six times; the 80 MB and 109 MB PDFs in the first doc parsed without a problem.
- **The pipeline.** The pipeline holds a document's images only between the SDK's return and the saves, and it parses two documents at once. The memory is made inside the SDK's read of one document.

## C. The changes in the parser SDK

**Words used in this section**

- **Reading option**: one value in `TextReadingOptions`, set by the pipeline from `textReading` in `config/<environment>/config.yaml`.
- **Note**: a `note` block in the document tree, written into the markdown as a line of text in place of what was left out, such as `Page 61: its image is not stored, over mostImagePages`.
- **Major release**: a release whose markdown output changes, made with `make major` in the SDK. The pipeline stores the markdown as it is, so a change of output is a change of version.

### C1. A cap on the lines used for table detection

A new reading option `mostTableLines`, 5,000 in both config files. `readSegments` in `readPdfFacts.ts` stops as soon as it has more than `mostTableLines` segments and gives none, so `buildPdfTables` finds no ruled table on that page. Tables read from aligned rows of short cells still work, because they come from the text, not the lines. A table page has hundreds of segments: a 30-row, 8-column table with every cell border drawn is under 1,000. Horsham's page 3, with 3,817, stays under the cap and takes 0.3 seconds.

The output changes: a map page no longer gives tables of empty cells. The corpus check will show the difference on any corpus entry with a drawn page.

### C2. Clean each page after it is read and after it is drawn

In `readPdfTree.ts`, `readPage` calls `cleanup()` on the page after its text, segments and pictures are read, and `drawPageImage` calls it after the page image is encoded. pdf.js then drops the page's decoded pictures and operator list, and memory is bounded by the heaviest page, not the whole document.

The cost: a scan page's operator list is built twice, once to read it and once to draw it. For a document of 23 scan pages this is some seconds of processor time. Only scan pages pay it.

### C3. Free each canvas, and copy pixels without allocating

In `buildPngImage.ts`, `buildPixelPng` and `buildLoadedPng` set the canvas to 0 by 0 after `encode`, as pdf.js's own canvas factory does, so its pixels are freed at once. `buildTurnedImage.ts` does the same for the OCR step. `readRgbaBytes` becomes `writeRgbaBytes`: it writes straight into the `ImageData` buffer, four assignments per pixel, and copies a four-channel picture with one `set`.

### C4. A picture budget for one document, optional

Two new reading options: `mostPictures` and `mostPicturePixels`, the most pictures and the most picture pixels stored for one document. `readPdfPictures` counts both as it stores pictures. Past either, the pictures of the page are not drawn or encoded, and the page gets one note: `page 61: 230 pictures are not stored, over mostPictures`. A picture seen before is still found by its hash and linked again, and counts once.

Section E shows that memory no longer needs the budget: the heaviest file holds 127 MB of PNGs. The budget bounds the time and the saves of a document with thousands of pictures, and the size of the images folder. Whether to have it is the owner's call, section H. A document with the budget used still has its text and its first pictures.

### C5. Later, not now: a linear merge of rulers

`buildMergedRulers` can merge in one pass over the sorted rulers, looking back only at rulers within the tolerance, and `growRulers` can walk the set without spreading it. This makes pages under the cap faster but is not needed for memory once C1 is in. It is a separate change with its own corpus check.

## D. The change in the pipeline

**Words used in this section**

- **Marker**: a small record that says a parse has started: `parse/v3/documents/started/<documentId>.json`, holding the `id`.
- **Cut off**: a parse that ended without a record, because the process was killed while it ran. The pipeline cannot see the kill; it sees the marker with no record.
- **Parked**: saved as an error record with the class `cut-off`, so the step does not try the document again until the record is removed.

### D1. A started marker, and parking on the next try

The parse step saves the marker as it starts to read a document, and never removes it. The marker save runs beside the SDK read, not before it, so it adds no wait: the read takes seconds, the save milliseconds, and the record is saved only after both are done. The first design deleted the marker after the record; the pipeline's house style allows no `delete` verb, and a marker left in place costs one small object a document, so the marker stays. The folder grows with the documents parsed, one listing a run, and a lifecycle rule on the bucket can expire old markers.

At the start of a run, the step lists `started/`. An id in `started/` with no record in `data/` or `errors/` is a document whose parse was cut off. For each one in its share, the step saves `errors/<documentId>.json` with the class `cut-off` and the reason `the parse was cut off before it finished, in an earlier run, probably out of memory`, counts it as a failed item with the reason `cut-off`, and logs one line: `Parked 2 documents cut off in an earlier run: 06856823ebd2..., 0682c12488cd...`. Then it parses the rest. So a file that still kills a task kills it once; on the next try the share goes on, and the log names the file.

The limits:

- The documents in progress beside the killer are parked too, `parse.documentsAtOnce` less one of them for each kill. They are innocent and parse fine when cleared.
- A run stopped by hand, or a task that Cloud Run stops for a deploy, parks its in-progress documents the same way.
- Two runs on the same bucket at the same time would park each other's documents. The runs are not meant to overlap today.

What changes in the code:

- `ParseStoreReader` gains `readStartedIds`; `ParseStoreWriter` gains `saveStarted`.
- `TextFailureClassSchema` gains `cut-off` and `out-of-memory`, pipeline classes like `bytes-missing`.
- `buildParseStep` parks, then parses with the marker. The readiness check is unchanged: a cut-off document is a due document.
- The step's report and `govbase_pipeline_parsed_documents{outcome="failed", reason="cut-off"}` show the parked count.

### D2. A tool to clear the parked documents

`bun run clear:parked -- <bucket name>` in `tools/stores/` reads every record in `parse/v3/documents/errors/`, deletes those whose class is `cut-off` or `out-of-memory`, and prints the ids. The next parse run then tries them again: after the SDK fix, or in the heavy job of D4 with `parse.documentsAtOnce: 1`. The tool refuses a bucket whose name is not the one in the config, as `empty:bucket` does.

### D3. Where the docs change

- `README.md`: the Stores table gains the `started/` row; the Failures paragraph gains `cut-off`; the parse step paragraph gains the marker and the parking; the Run a step in the cloud section says a killed task parks its documents and how to clear them.
- `AGENTS.md`: the parse store description and the exception to "never tries a document again".

### D4. A watchdog that stops a document before the limit

**Words used in this section**

- **Watchdog**: code that watches the memory of the process and acts when it passes a line.
- **Worker**: a Bun worker thread. It has its own JavaScript heap, and the main thread can stop it at any moment with `terminate()`, which frees that heap.
- **Transfer**: handing bytes to a worker without copying them.

The owner asked whether the pipeline can measure its memory and drop the current document, instead of being killed. It can measure: `createMetrics` already reads the RSS and the container limit from `metrics.memoryLimitFile` every `metrics.memorySampleGapInSeconds`. It cannot drop the document today. The SDK read runs on the main thread as one promise, and JavaScript cannot interrupt its own thread. An Effect interrupt would stop the waiting, not the work; the work and its memory would go on until the read returns.

The way to make the read stoppable is to run it in a worker, as the OCR step already runs its scan readers through `createScanReader` in the SDK's effect shell. The design:

- The SDK's effect shell gains a text reader pool, built like `createScanPool`: `parse.documentsAtOnce` workers, each loading pdf.js once and reading one document at a time from a worker entry file. `createTextReader` hands each document to a worker, transfers the bytes in, and gets the markdown and the image bytes back by transfer.
- The parse step samples the RSS every second. When it passes `parse.memoryStopShare` of the limit, 0.8 for example, it terminates the worker that has run longest, saves an error record for its document with a new class, `out-of-memory`, and the reason `stopped at 3.4 GB of 4 GiB after 48 s`, starts a fresh worker, and goes on with the next document. The log names the document and its memory.

What it cannot catch:

- A sample every second misses a jump. Horsham's table phase grew by 2.8 GB in 20 seconds, which a sample catches; a single allocation of a gigabyte between two samples does not get caught, and the task is killed as today.
- With two documents at once the watchdog cannot tell which one holds the memory. It stops the one that has run longest, which may be the innocent one. The marker of D1 has the same limit.

**The second run for the dropped files.** The dropped documents are error records with the class `out-of-memory`, so they are easy to find. The tool of D2 clears them, and a second job parses them with no parallel work and more memory: the same image, one task, `parse.documentsAtOnce: 1` in its secret, and 16 GiB, which Cloud Run allows with 4 vCPU. The deploy workflow makes this job, `govbase-pipeline-dev-heavy`, beside the first; its secret, `govbase-pipeline-dev-heavy-config`, is the owner's to make once, and `bun run cloud:step:parse:heavy` runs it. A second job is cleaner than changing the memory of the main job before and after each run. A document dropped by mistake, because it ran beside the heavy one, parses in the second run as it would have in the first. Before the SDK fixes, every one of the 12 files of section E would have gone to the second run; after them, none needs it.

The watchdog and the marker are two safety nets with different reach. The watchdog keeps the task alive and names the file with its memory, at the cost of a worker pool in the SDK and the transfer of every document and its images across a thread. The marker is small and catches every kill after the fact, but only names the file on the next try. The SDK fixes of section C are needed with either: they remove the three causes found, and the nets are for the file not yet seen.

## E. The files, before and after

**Words used in this section**

- **Before**: the SDK at `v0.9.0`, as it ran in the cloud.
- **After**: the copy with C1 to C3 patched in, and no picture budget, so the picture numbers show what the budget must bound.

The times are from a Mac running two or three measurements at once, so they say the order of the cost, not the cost. The Mac has no memory limit, so every file finished in both versions; in the cloud, two documents run at once in 4 GiB. The pictures column counts the pictures stored, after the same picture is found again by its hash. The page images are the pages drawn as PNGs, at most `mostImagePages`, 60.

| File | Council and document | Pages | Pictures | Page images | Before: time, peak | After: time, peak | Markdown before, after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `06856823ebd2` | Horsham, Policies Map Pack 5 | 4 | 21 | 0 | 161 s, 5,187 MB | 29 s, 1,106 MB | 4,126 KB, 20 KB |
| `0682c12488cd` | City of London, S73 presentation | 23 | 0 | 23 | 45 s, 760 MB | 79 s, 416 MB | 3 KB, 3 KB |
| `3e8f20ce4f4e` | Cotswold, Heritage Impact Assessment Part 3 | 88 | 22 | 0 | 240 s, 4,966 MB | 239 s, 1,438 MB | 202 KB, 202 KB |
| `98a297ac5a14` | Cheshire East, Key Plans A1 pages | 25 | 1,515 | 0 | 516 s, 4,349 MB | 298 s, 1,618 MB | 307 KB, 307 KB |
| `63f49f4504fb` | East Hertfordshire, Surface Water Climate Change Part 1 | 16 | 0 | 16 | 256 s, 3,217 MB | 154 s, 990 MB | 1 KB, 1 KB |
| `1031cb1dcfac` | Harrow, town centre Baseline Report | 76 | 322 | 0 | 242 s, 2,918 MB | 141 s, 1,007 MB | 161 KB, 161 KB |
| `1073e2ea2077` | Middlesbrough, Supplementary Evidence | 138 | 0 | 60 | 152 s, 1,913 MB | 111 s, 429 MB | 12 KB, 12 KB |
| `67bb30782526` | Cumberland, Crindledyke Lane plans | 33 | 31 | 31 | 141 s, 3,509 MB | 108 s, 1,308 MB | 5 KB, 5 KB |
| `90e94530a41c` | Cheshire West and Chester, NWAS Quality Account | 93 | 6,200 | 0 | 222 s, 5,361 MB | 130 s, 641 MB | 738 KB, 738 KB |
| `3842a8e6bd33` | Dacorum, Camelot RUF Club | 93 | 0 | 60 | 252 s, 3,915 MB | 202 s, 788 MB | 7 KB, 7 KB |
| `6061016532ee` | Swale, Appendix A 601-700 | 100 | 5,395 | 0 | 229 s, 4,036 MB | 165 s, 1,122 MB | 671 KB, 671 KB |
| `21b5931c246d` | Swale, Appendix A 801-934 | 134 | 11,564 | 0 | 357 s, 5,453 MB | 266 s, 1,390 MB | 1,040 KB, 1,040 KB |

What the table says:

- The only markdown that changes is Horsham's. The other 11 give the same text as before, so the fixes change memory and time, not the output, apart from the tables read from drawn lines.
- The two heaviest files after the fixes, Cheshire East and Swale, add up to 3.0 GB. So two documents at once fit in 4 GiB with room, and a 2 GiB task would still be at risk when two heavy files meet.
- The picture counts of 5,395 to 11,564 cost no memory to speak of once pdf.js is cleaned per page: Swale holds 127 MB of PNGs. Their cost is time and bucket saves.
- Eight of the 12 files are faster after the fixes, even with the second operator list that C2 costs a scan page. Cotswold is the one file no faster: its pictures are 8.7 megapixels each, and it draws no page.

## F. Work items, in order

Built on 25 October: C1 to C4 in the SDK, with the worker text reader of D4 in its effect shell; D1, D2 and D4 in the pipeline, with the heavy job in the deploy workflow. Both check suites are green, with 100 percent coverage, and the corpus output did not change. What is left is the owner's:

1. **SDK.** In `apps/parser-sdk`: commit, then `make major`, because `mostTableLines` changes the markdown of drawn pages, and push with the tag.
2. **Pipeline.** In `apps/pipeline`: `make bump-sdk`, which moves the pin to the new tag and runs `make check`; then commit and push to `main`, which deploys both jobs. The sandbox could not run `bun install`, so `bun.lock` must come from this step.
3. **The heavy secret.** `gcloud secrets create govbase-pipeline-dev-heavy-config --data-file heavy-config.json`, where the file is the dev secret with `"parse": { "documentsAtOnce": 1 }`, and the same `secretAccessor` binding as the first secret, see the README.
4. **Cloud.** Run `bun run cloud:step:parse 10`. The 83,593 documents left have no record and are due. Watch `govbase_pipeline_memory_rss_bytes` by instance, and the `out-of-memory` and `cut-off` reasons of `govbase_pipeline_parsed_documents_total`. Then the join run builds the events.
5. **After the run.** `bun run clear:parked -- govbase-pipeline-documents-dev`, then `bun run cloud:step:parse:heavy`. Write the count of parked documents and the peak memory of the run into this doc.
6. **Later.** C5. A trial of 2 GiB tasks with 20 at once, if the peaks in the run allow it.

## G. Config changes

| Key | Development | Production | Change |
| --- | --- | --- | --- |
| `textReading.mostTableLines` | 5000 | 5000 | new |
| `textReading.mostPictures` | 2000 | 2000 | new; 2,000 keeps every file of section E but the three photo appendices whole |
| `textReading.mostPicturePixels` | 300000000 | 300000000 | new; 300 megapixels is under the 333 of the heaviest file that parsed without a kill |
| `parse.memoryStopShare` | 0.8 | 0.8 | new, the share of the container limit at which the watchdog stops a document |
| `parse.memoryCheckGapInSeconds` | 1 | 1 | new, how often the watchdog reads the memory |

The job's secret keeps `parse.documentsAtOnce: 2` and the job keeps 4 GiB until a full run has shown its peaks.

## H. Decisions for the owner

1. **Which safety net.** The marker of D1 is small and catches every kill, on the next try. The watchdog of D4 keeps the task alive and names the file with its memory, but needs a worker pool for the text reader in the SDK and a thread transfer of every document. The owner's own idea on 25 October was the watchdog with the second run: drop the heavy file at a memory line, go on, and parse the dropped files later, one at a time, with more memory. Both nets can be built; the marker stays useful as the backstop for a jump the watchdog's sampling misses. The SDK fixes come before either.
2. **The picture budget.** Whether to keep C4 at all, now that memory does not need it, and its values. A budget bounds the time and the saves of a photo appendix and the size of the images folder; without one, Swale's appendix is 11,564 saves and 266 seconds, and parses.
3. **Parking the partner.** D1 parks every document in progress at a kill. The alternative is to try a cut-off document once more, alone, before parking it, with a tries count in the marker. It saves the innocent partner at the cost of one more kill per killer and one more rule.
4. **The cap value.** 5,000 lines keeps every table page seen so far and cuts every map page seen so far. A page between the two, such as a dense engineering drawing with a title block table, loses its ruled table.
5. **The release.** C1 changes the markdown of drawn pages, so the SDK release is major. The documents already parsed keep their old markdown until `parse/v3/` is emptied and parsed again, which is the rule in the README.

## Sources

- The first doc, `pipeline-parse-out-of-memory-2026-10-25.md`, and the data in `apps/pipeline/data/oom/`: the 24 PDFs in `pdfs/`, `pdf-facts.txt`, `killed-files-named.tsv`.
- The scripts of this doc in `apps/pipeline/data/oom/scripts/`: `measure.mjs`, `probePdfjs.mjs`, `scanJpx.mjs`, `patchTrace.mjs`, `patchFix.mjs`, `patchCap.mjs`, `patchPhase.mjs`, `runBatch.sh`. Each patch script rewrites a copy of `apps/parser-sdk/src`; run them in a copy, never in the repository.
- The code read: `apps/parser-sdk/src/pdf/readPdfTree.ts`, `readPdfFacts.ts`, `readPdfPictures.ts`, `buildPdfTables.ts`, `src/image/buildPngImage.ts`; `apps/pipeline/src/domain/buildParseStep/buildParseStep.ts`, `src/infrastructure/createParseStore/createParseStore.ts`, `createObjectBucket.ts`, `createStoreFiles.ts`; `node_modules/pdfjs-dist/legacy/build/pdf.mjs` and `pdf.worker.mjs` for `PDFPageProxy.cleanup`, `buildPaintImageXObject`, `JpxImage` and `GlobalImageCache`; `node_modules/unpdf/dist/index.mjs` for `extractImages` and `renderPageAsImage`.
