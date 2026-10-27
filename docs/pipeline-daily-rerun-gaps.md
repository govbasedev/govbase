# Daily runs: what a second run does, and the gaps

As of 26 October 2026, pipeline at `0f670e6`, parser SDK at `da01731`. The question: if the pipeline runs again, do A) list, B) read or C) parse overwrite work we have already done? We will run it every day, so each run must only fill in the gaps and never repeat work. This doc answers the question step by step and lists the gaps to that design.

**Update, 27 October 2026:** the join is now its own step, `join`, after `ocr` (`src/domain/buildJoinStep/`). It writes the meeting files to `join/v1/events/` instead of `parse/v3/events/`. This closes gap 11. In the cloud the join runs only on its own, from `bun run cloud:step:join`. `cloud:step:parse` and `cloud:step:ocr` no longer start a join or parse run when they finish. The file and line references below are for `0f670e6`, before this change.

This doc comes from reading the code, not from a test run. I could not read `config/local/config.yaml`, because the sandbox blocks it. The config values here come from the committed `development` and `production` files.

## Short answers

1. **List: yes, it overwrites.** Each run saves again every meeting it lists, even when nothing changed. Most of the time the new record is the same as the old one. In two cases it is not: a COINS meeting can lose papers, and an own-site meeting can get a second record (B1).
2. **Read: no.** A document that was downloaded is never downloaded again. But a document that failed is tried again every day for as long as its meeting is listed. A file that the council changes at the same address is never seen (B2).
3. **Parse: no.** It parses only documents that have no parse result yet. But every failure is parked for ever, and a crash parks the documents in progress (B3).
4. **OCR: no.** It reads only scans that have no OCR result yet. Its failures are parked for ever too, and no tool clears them (B4).
5. **The join: no, but it trusts the list.** It rebuilds a meeting file only when one of its parts is newer. It rebuilds from the newest list record, so if the list record lost papers, the meeting file loses them too (B5).
6. **So the design mostly holds for read, parse and OCR.** The gaps are: changed files, the retry rules, crashes and runs that overlap, the list record overwrite, and a fixed cost that grows each day. Section C ranks them.

## A. How a daily run works today

**Words used in this doc**

- **Event**: one meeting, as the list step saves it. It holds the meeting's title, date and documents.
- **Item ID**: the ID of a document or event. It is the sha256 of its address (URL), so the same address always gives the same ID.
- **Store**: a folder in the bucket with a version number, for example `parse/v3/`. Each step reads the store of the step before it.
- **Due**: work that a step will do in this run.
- **Parked**: a document that failed, with an error record. The step skips it in later runs.
- **Join**: the part of the parse step that builds one markdown file for each meeting from the parsed and OCR text of its documents.

`bun run dev:run` runs `list, read, parse, ocr, judge` in one process on the Mac. The join runs inside the parse step, before OCR (`buildParseStep.ts:792-796`). So new OCR text reaches the meeting files one day late, on the next run. In the cloud there are jobs only for parse and OCR. There is no cloud job for list or read yet. In the cloud, `bun run cloud:step:ocr` already runs a join after OCR: it starts a 1-task parse run (`tools/cloud/runStep.sh`). That run also parses any documents that are still due before it joins.

| Step | What is due | A second run with nothing new | Can it overwrite earlier work? | Failures |
| --- | --- | --- | --- | --- |
| List | Every source, every run | Lists every source again and saves every event again | Yes, the event records | Listed again the next day |
| Read | Listed documents with no data, and no error newer than the event | Downloads nothing | No | Tried every day while listed, then never |
| Parse | Read documents with no parse data and no parse error | Parses nothing | No | Parked for ever |
| Join | Meetings with a part newer than the meeting file | Builds nothing | Yes, from the newest list record | A failed build is tried every run |
| OCR | Parsed scans with no OCR data and no OCR error | Reads nothing | No | Parked for ever |
| Judge | Nothing, it is a stub | Nothing | No | None |

## B. Step by step

### B1. List

- **What is due:** every source, every run. The step keeps no memory of the last run (`buildListStep.ts:270-295`).
  - ModernGov lists the last `feedWindowInDays` days: 7 in production, 120 in development.
  - The page-based systems list the meetings closest to today, up to `maxItemsPerSource` (100 in production, 40 in development) and `maxIndexPagesPerSource` (80).
- **A second run:** fetches every feed, meeting page and index page again. Then it saves every listed event, not only the new ones. The list of keys it already has is used only to count the new events (`createListStore.ts:141-165`).
- **Overwrite risk:** each event record is replaced by what this run saw.
  - **COINS loses papers.** When a paper page fails to load, the meeting is still saved, with no documents for that agenda item (`readCoinsListing.ts:103-108`, `227-239`). The stored event then has fewer documents than before.
  - **Own-site meetings can split.** When a source splits meetings by date, the event address is the first document address in sorted order (`readOwnSiteListing.ts:283-296`). A new paper whose address sorts first gives the meeting a new event ID. The old record stays, so the same meeting has two events.
  - ModernGov and Amber Valley drop a meeting whose detail page fails, so they do not overwrite its record.
- **Failures:** not retried inside a run. A failed source is listed again the next day. Failure records are overwritten and never deleted.
- **Crash:** nothing is saved until every source is listed. If the run stops before that, the whole listing is lost. The saves stop at the first save that fails after the bucket's retries (`createListStore.ts:150-160`).

### B2. Read

- **What is due:** a listed document that has no data, and no error newer than the time its event was last saved (`buildReadStep.ts:225-234`, `275-298`).
- **A second run:** downloads nothing for documents that already have data.
- **Overwrite risk:** none. A document with data is never downloaded again.
- **Failures:** the list step saves every event again each run, so the event is always newer than the error. That makes every failed document due again every day, as long as its meeting is in the listing. This includes `gone`, `blocked` and too-large documents, which will fail again. When the meeting leaves the listing window, its failed documents are never tried again, and no metric shows this.
- **Changed files:** when a council puts a new file at the same address, the read step never sees it. The read store has a `contentHash` field in its schema (`createReadStore.schema.ts:10`), but no code writes it. The step saves only the bytes. So the new file never reaches parse, OCR or the join.
- **Cost:** each run reads the list of every event and then downloads every event record ever saved, both to check if it is ready and to run (`buildReadStep.ts:236-249`). This cost grows each day.

### B3. Parse

- **What is due:** read documents minus those with parse data or a parse error (`buildParseStep.ts:236-253`, `createParseStore.ts:55-58`).
- **A second run:** parses nothing.
- **Overwrite risk:** none.
- **Failures:** every error class is parked for ever. Only a person can retry them, with `clear:parked`. That tool clears only `cut-off` and `out-of-memory`, and its folder is fixed at `parse/v3` (`clearParked.mjs:14`, `readParkedRecords.mjs:8`).
- **SDK upgrades:** each parse record saves the `sdkVersion` (`buildParseStep.ts:302`), but no code reads it. After an SDK upgrade, only new documents use the new SDK.
- **Crash:** the step saves a started marker for each document as it starts (`buildParseStep.ts:479-488`). The marker is never removed. On the next run, a due document with a marker is parked as `cut-off` without a try (`buildParseStep.ts:500-517`). So if the Mac stops or the process is killed, the documents in progress (up to `documentsAtOnce`, 4) are parked, even when they did nothing wrong.
- **Two runs at once:** there is no lock. A second run parks the documents that the first run has in progress. Cloud shares split the work by ID, so cloud tasks of one job do not clash.

### B4. OCR

- **What is due:** documents with page images, minus those with OCR data or an OCR error (`buildOcrStep.ts`, `readPendingIds`).
- **A second run:** reads no scans. But it lists every file under `parse/v3/documents/images/`, once to check if it is ready and once to run.
- **Overwrite risk:** none.
- **Failures:** `out-of-memory`, `broken-file` and `bytes-missing` are parked for ever, and no tool clears OCR errors.
  - There is no started marker. A scan that kills the task before the watchdog stops it is tried again every run.
  - If page images exist but the parse record does not, the scan fails, and no error record is saved (`runScan` in `buildOcrStep.ts`). So it is tried, and counted as a problem, every run. A crash between the image save and the record save in parse can cause this. Not seen in the data yet.
- **Old text:** the OCR file holds the parse markdown as it was at scan time. If parse is redone, OCR still counts as done, and the join uses the old text, because it prefers OCR text (`buildParseStep.ts:672-684`).
- **The page cap:** pages over `ocr.maxImagePages` (60) are saved as `pagesLeft`. Raising the cap does not make those scans due again.

### B5. The join

- **What is due:** a meeting whose newest part is newer than its meeting file (`buildParseStep.ts:616-629`, `640-667`). The parts are parse data, parse errors and OCR data.
- **A second run:** builds nothing. It still downloads every event record ever saved, twice.
- **Overwrite risk:** it rebuilds the file from the newest list record (`buildParseStep.ts:718-737`). If the list record lost papers (the COINS case in B1), the next rebuild drops them from the meeting file.
- **Missed changes:** a change to the list record alone never makes a meeting due. This covers a removed paper, a new title, and a change to `coverShare`, `wordsPerRun` or the SDK's `buildEventMarkdown`.
- **Failures:** a failed build saves an error, but only a saved file counts as built. So a failed build is tried every run with no limit.
- **Race:** a part saved by another process while the join runs can get an older time than the meeting file. It is then not joined until another part of that meeting changes.

### B6. Judge

It always says it has no work (`buildJudgeStep.ts:12-13`).

### B7. Versions and config

Each store has a version: `list/v2`, `read/v2`, `parse/v3`, `ocr/v3`. A new version starts that store empty. Only that step redoes its work:

- **New read version:** downloads every document of every saved event again. Parse still counts them as done, so it never uses the new bytes.
- **New parse version:** parses everything again and rebuilds every meeting. OCR still counts its scans as done, so the old OCR text wins. `clear:parked` still points at `parse/v3`.
- **New list version:** the old meeting files are never rebuilt.

The design notes name a first-listing cap and a refresh window (decisions 15 and 38). Neither is in the code.

## C. The gaps, most harmful first

| # | Gap | Harm | A possible fix | App |
| --- | --- | --- | --- | --- |
| 1 | A changed council file is never seen | The text goes out of date, with no sign | Save the content hash, ETag and Last-Modified of each document. Check listed documents again with a conditional request, which downloads only if the file changed. On new bytes, save them and make parse, OCR and the join due again. | Pipeline |
| 2 | A partial COINS listing shrinks the event record, and the next join drops its papers | Papers we read go missing from the meeting file | Merge the new listing into the stored record. Never remove a document because a page failed. Or do not save that event in this run. | Pipeline |
| 3 | Parse and OCR failures are parked for ever, and OCR has no clear tool | Documents that could now work stay unread | Add an attempt count and a retry time to each error record, by class. Retry `cut-off`, `out-of-memory` and `bytes-missing` up to a limit, with `out-of-memory` sent to the heavy job. | Pipeline |
| 4 | Read failures are tried every day while listed, then dropped with no sign | Wasted requests to councils, and lost documents nobody sees | Add an attempt count and a wait that grows after each try, by class. Stop `gone` after a few tries. Show old errors in a metric. | Pipeline |
| 5 | Upgrades do not flow down | Old text stays after an SDK or parse change | Make OCR due when its parse record is newer. Save the SDK version and a config hash in OCR and meeting files, and redo on a mismatch. | Pipeline |
| 6 | No run lock, and a crash parks work | Good documents parked as `cut-off`, a killer scan tried every run, a part not joined | One lock object for the run, or only one scheduled run at a time. An OCR started marker with an attempt count. | Pipeline |
| 7 | A run with nothing new still costs more each day | It downloads every event record 4 times, lists every image twice, saves every listed event and fetches the whole listing window | Keep the readiness result for the run. Keep one index file of events and documents. Find OCR work from the parse records. | Pipeline |
| 8 | Coverage holes | With the 7-day production window, a missed day or week loses ModernGov meetings for good. The closest-to-today cap misses late minutes on older meetings. | List each source from its last good list time, with a cap. Add a deeper crawl now and then. | Pipeline |
| 9 | List saves are all or nothing | One failed save, or a crash, loses the whole listing | Save each source when it is listed, and carry on past a failed save. | Pipeline |
| 10 | Page images with no parse record make OCR fail every run | A problem counted every run, for ever | Save an OCR error record when the parse record is missing. | Pipeline |
| 11 | The join runs before OCR in `dev:run` | New OCR text reaches the meeting files one day late | Run the join again after OCR, or move the join to its own step after OCR. Done on 27 October 2026: the `join` step runs after `ocr`. | Pipeline |
| 12 | Own-site meetings split by date can get a new event ID | The same meeting has two events | Build the event ID from the source and the meeting date, not from a document address. | Pipeline |

## D. Not confirmed

1. The values in `config/local/config.yaml`, which `dev:run` uses on the Mac.
2. How often COINS paper pages fail in a real run. The list report shows page failures, so the next run can tell us.
3. Which own-site sources split meetings by date.
4. Whether any page images exist with no parse record (gap 10).
5. Nothing here was tested by a run. A safe test: run `dev:run` twice on the development bucket and compare the counts in each step's report.
