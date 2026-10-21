# Pipeline efficiency redesign: state is presence

Written 2026-10-16, during the first OCR run, from the list and read runs of update 1 (15 and 16 October), the code on `update/stores-and-steps` (`d0f2758`) and the parser SDK `v0.6.0`. Revised 2026-10-21 against the code on `parse-as-markdown` (`80e4cad`), the parser SDK `v0.8.0`, and the runs of 17 to 21 October. Most of the first draft is now built, and some of it was built in a simpler shape than the draft asked for. This revision keeps the ask and the rules, records what the code does today, and redraws the rest of the design so that each item starts from the code as it is.

The order of importance, set by the owner: efficiency and elegance first, with the least metadata in the store. Speed is second. The retrospectives already cover speed.

The question this doc answers: how does the pipeline do the least work, with the least stored state, and with no dependence on when the last run happened?

## Short answers

| Question | Answer on 2026-10-16 | Answer on 2026-10-21 |
| --- | --- | --- |
| Where do the repeat requests come from? | Change hashes over a moving feed window. One store read per listed document. A full crawl of every page-based council every 24 hours. | The list step asks the web service for every meeting in the feed window on every run, and opens every page-based meeting page the crawl caps reach on every run. The read, parse and OCR steps repeat nothing. |
| Why does state reset? | The stored state was about runs, not about data. | It no longer resets. No store object holds a run time. The only time the pipeline reads is the bucket's own last-modified time of an object. |
| Can we remove the loop? | Yes, with a set difference over the store. | Done. Each step's work is the items of the step before minus its own records. Run read twice and the second run writes nothing. |
| Can we cut the metadata? | Yes, to one meeting object and one four-field council object. | Done, further than planned. There is no meeting object and no council object. One listed item is four fields. Events are gone. |
| Can many workers share the work with no lock? | Yes, by a hash share. | OCR shares by item id today. The read step can share by host once it works in host lanes. No lock, no lease. |
| How do we cut tokens? | Measure, then gates, then drop repeated text. | Not started. The unit is now one markdown document per item. Measure the markdown, then leave agenda packs out at list time, then gates when the judge is built. |

## The ask, kept

The owner's six ideas, ranked on 16 October by elegance and by how idiomatic they are for this code base: Effect, object storage, one writer per object, no database, no leases. The last column says where each stands.

| Rank | Idea | Idiomatic form | On 2026-10-21 |
| --- | --- | --- | --- |
| 1 | Track what has been fetched and never fetch it again. | The address is the identity. The record is the memory. New means no record. | Built. `read/v2/data/<itemId>.json` is the memory. |
| 2 | A simpler data store than the listing record. | Keep only what exists. Drop when we ran. | Built. One item record of four fields. No listing record, no council record, no raw-facts object. |
| 3 | Spread requests over hosts and workers, not over a council loop. | A fair queue by host inside a process. A hash share by host across processes. | Not built. The read step still runs 72 councils at once. |
| 4 | Measure what we read. Let a person ring-fence what reaches the AI. | Metrics per gate, gates as config, a store tool for the numbers. | Not built. The judge is a stub. |
| 5 | Event based: no dependence on cadence. | Presence in the store between steps. | Built. Any step runs at any time, in any order. |
| 6 | Randomly pick a document, lock it, mark it read. | Rejected: a lock is a lease, ADR 0001. A hash share instead. | Stays rejected. |

## What the code does today

The pipeline is seven steps over one bucket: `list`, `read`, `parse`, `ocr`, `judge`, `plan` and `send`. Each step owns one folder. `data/` holds one record per item done and `errors/` one per item that failed, each named by the item id. No step writes events. A step reads only its own store and the stores of the steps before it, and `tools/structure/stepsOwnTheirStores.test.mjs` fails otherwise.

| Key | Holds | Written by |
| --- | --- | --- |
| `list/v2/data/<itemId>.json` | `id`, `sourceId`, `title`, `url`. Written again on every run that lists the item. | list |
| `list/v2/errors/<errorId>.json` | A failed index page: `id`, `sourceId`, `url`, the failed request. Never deleted. | list |
| `read/v2/data/<itemId>.json` | `id`, `contentHash`, `contentType`. | read |
| `read/v2/errors/<itemId>.json` | `id` and the failed request. Written over by a later failure. | read |
| `read/v2/bytes/<itemId>` | The fetched bytes. | read |
| `parse/v3/data/<itemId>.json` | The read fields plus `sdkVersion`, `pageCount`, `scanPages`, `leftOut`, `images`. | parse |
| `parse/v3/text/<itemId>.md` | One markdown document, English only, pages marked. | parse |
| `parse/v3/images/<itemId>/<file>` | Each picture and each scan page as a PNG. | parse |
| `parse/v3/errors/<itemId>.json` | `id`, `contentHash`, failure class and reason. | parse |
| `ocr/v3/data/<itemId>.json` | `id`, `contentHash`, pages read, failed and left, `leftOut`. | ocr |
| `ocr/v3/text/<itemId>.md` | The parse markdown with the OCR text under each page image. | ocr |
| `ocr/v3/errors/<itemId>.json` | As a parse error. | ocr |

The rules as built.

1. **An item is a meeting page or a document.** Its `id` is the SHA-256 hash of its address, made once by `ItemIdSchema` in `createListStore.schema.ts`. Every later store names its objects by that id and never hashes again. A document under two meetings is one item. An item two sources list is one record, kept by the first source from A to Z.
2. **State is presence.** The read step's work is every item in `list/v2/data/` with no record in `read/v2/data/`, and no record in `read/v2/errors/` that is newer than the item's own last-modified time in the bucket. The parse step's work is every read item with no parse record and no parse error. The OCR step's work is every parsed document with a page image and no OCR record or error. Parse and OCR never try again. To redo their work, empty their folder.
3. **The list step keeps no memory of the last run.** Every run lists everything the page limits reach: the ModernGov feed for `councils.feedWindowInDays` back from now, then `GetMeeting` for each meeting the feed names; for page systems, the index pages and the meeting pages up to the crawl caps. It writes every item it listed, so an item's last-modified time is the last run that listed it, and a failed read is tried again only after the list step lists the item again.
4. **One step, one process, one run.** `run.steps` picks the steps. `bun run dev:run` runs `[list, read, parse, ocr, judge]` once a day on the Mac under launchd. The `pipeline-no-finished-run` alarm fires at 26 hours. `sources.hostKeys` limits a read run to the sources on some hosts, which is the by-hand form of a share. `ocr.shareIndex` and `ocr.shareCount` share the scans by item id.
5. **The judge is a stub.** Judging whole documents is not built. The judge store, the judgment client, item versions, item states, experiments, issues, questions, recipes and tagging were all deleted. Plan and send have no work.
6. **Config that went:** `fullListingInHours`, `lostAfterInHours`, `listingFallbackInHours`, `lastingUnreadClasses`, `goneAfterAttempts`, `firstListingInDays`, `recordsAtOnce`, `guessedDocumentsPerMeeting`, the `tagging` and `tokens` parts. **Config that stayed:** `councils.councilsAtOnce` (72, and it must be twice `http.mostRequestsAtOnce`), `councils.documentsAtOnce` (4, used by the read step for items of one source and by the list step for `GetMeeting` calls), `councils.feedWindowInDays` (7), the crawl caps per system.

What this already proves of the three exit conditions.

| Condition | Met? | Proof |
| --- | --- | --- |
| A. The loop can go | Yes | Run read with no list before it: it lists three prefixes and logs `No listed item is waiting to be read`. Run read twice: the second run writes nothing. Run list, list, read: both listings are present, because the list step writes every item it sees. No step reads a run time. |
| B. Less metadata | Yes, beyond the draft | The 20-field listing record, the read council record, the raw-facts object, the events and the `schemaVersion` field are gone. An item is four fields. A read record is three. |
| C. Safe transfer | Yes, by construction | Every later record copies the item `id` and the `contentHash` forward. A read item is never fetched again, so the bytes under a parse never change. No hash chain between a producer and a consumer is needed. |

## Evidence from the runs of 17 to 21 October

| Run | Result | What it shows |
| --- | --- | --- |
| list 17 Oct 13:41 | 382 councils, 20.7 min, 5,437 meetings | Before the item model. |
| list 19 Oct 21:49 | 382 sources, 21.6 min, 7,081 meetings, 58,954 items | The item model. One PUT per item. |
| list 20 Oct 09:22 | 34.2 min, 6,815 meetings, 55,373 items | Time swings with the councils' sites, not with new work. |
| list 20 Oct 10:45 | 40.1 min, 6,963 meetings, 58,048 items, 57,784 new | The bucket had been emptied before the run. |
| list 20 Oct 12:28 | 24.2 min, 6,988 meetings, 58,280 items, `New items saved: none, the save failed` | One `S3Error: Service Unavailable` on one item stopped the save of the rest. 22 sources listed nothing. 19 listing failures: 8 skipped, 8 gateway, 3 blocked. |
| read 17 Oct 14:08 | 369 councils, 165.6 min | A full read, before the item model. |
| read 18 Oct 15:02 | 371 councils, 94.7 min | A full read, before the item model. |
| read 20 Oct 19:09 | 6 sources by `hostKeys`, 1,593 items due, 1,533 read, 35.6 min | Angus alone took 35.5 min: one own-site host, about 1,500 documents, one request a second. The run is bound by its slowest host, whatever the council slots say. |
| read 20 Oct 21:41 | The same 6 sources, 1,542 read, 35.2 min | The read store had been emptied, so the same work again. Same bound. |
| parse 21 Oct 14:36 | 1,542 items, 39.4 min, 1,535 documents, 163 with scan pages, 3 `broken-file`, 4 unsaved | About 6 s per item, 4 at once. |
| ocr 21 Oct 15:19 | 162 scans, 2 at once, about 1 to 2 s per one-page scan | OCR reads the stored page image and never draws a page again. The 7-hour OCR run of 16 October is history. |

What the runs show.

1. The list step is the step that repeats work. It made about 5,500 `GetMeeting` calls and opened every page-system meeting page the caps reach, and it wrote 58,280 items, on a day when the read step then had about 2,000 new items to fetch.
2. One failed PUT can lose most of a listing. The save on 20 October at 12:28 stopped at the first error. The next run lists again, so nothing is lost for good, but one day of reading waits.
3. The read step's time is set by its slowest host. Council slots do not change that. The Angus run is the proof: 35 minutes for one host at one request a second.
4. Parse and OCR are no longer the long pole. Both are bound by local CPU and both repeat nothing.
5. Nothing measures tokens yet. The parse record has a page count and image sizes, not a text size.

## Where the waste is in the code today

| # | Cause | Where | Cost |
| --- | --- | --- | --- |
| W1 | The list step asks the web service for every meeting in the feed window on every run, whether or not anything was published since the last listing. The SDK drops the feed's `pubDate`, so the step cannot tell. | `readModernGovListing.ts` `readCouncilList`; SDK `readFeedXml.ts` keeps only `MId` and the committee title | About 5,500 `GetMeeting` calls a run, at one request a second per host. On a normal day about six in seven repeat a listing already made. |
| W2 | Every page-based council is crawled to its caps on every run: the index pages, then up to 120 meeting pages, closest to today first. | `readCmisListing.ts`, `readOwnSiteListing.ts`, `readCoinsListing.ts`, `readDecisionTimeListing.ts`, `readAmberValleyListing.ts`; `councils.most*Pages`, `most*Meetings` | 72 councils, up to 200 pages each, about 8,000 to 10,000 page requests a run. Most of the meeting pages were read the day before and have not changed. |
| W3 | The list step writes every item it listed, 58,000 PUTs a run, so that the bucket's last-modified time means "last listed". | `createListStore.ts` `saveListedItems`; `buildListStep.ts` | About 58,000 small PUTs a run, about one minute, about 9 dollars a month at GCS Class A prices. The rule it buys is right. W1 and W2 cut the count to the items of meetings that were really re-read. |
| W4 | The save of the listed items fails at the first failed PUT and leaves the rest unsaved. | `createListStore.ts` `saveListedItems` uses `Effect.forEach`, which stops at the first error | One `503` from the bucket on 20 October cost the day's listing. |
| W5 | The read step runs 72 councils at once, 4 items of a council at once, the sources with most items first. The host is the unit of politeness, so the slot plan and the pace fight. The config schema ties `councilsAtOnce` to `mostRequestsAtOnce`. | `buildReadStep.ts` `buildDueSources`, `runDueSources`; `readListedItems.ts`; `createPipelineConfig.schema.ts` `COUNCIL_PACING_TEXT` | The run ends when the biggest host's lane ends. Slots sit idle while they wait. The coupling rule in the config is a smell. |
| W6 | A read error is retried only when the list step lists the item again. Today that is every run, because W3 touches every item. Once W1 and W2 stop touching the items of unchanged meetings, a transient failure such as a gateway time-out would wait days. A lasting failure such as a 404 is today retried every run for ever. | `buildReadStep.ts` `readIsDue` | Today: one request a run for each `gone` or `blocked` item that is still listed. After W1 and W2 with no change here: slow retries of transient failures. |
| W7 | The OCR step finds its work by listing every image key ever written and keeping the `page-<n>.png` ones. | `createParseStore.ts` `readScanIds` over `parse/v3/images/` | Grows with every picture in every document ever parsed, not with the scans that wait. Tens of thousands of keys today, hundreds of thousands within months. |
| W8 | Each step finds its work with one LIST per prefix, read one page of 1,000 keys after another. The prefixes grow for ever. | `createObjectBucket.ts` `readCloudPage` is sequential | 58 pages a prefix today. About 1,000 pages a prefix a year from now, 100 seconds each, several times a run. |
| W9 | A document item knows its source and its title, and nothing of its meeting. The plan step needs a committee and a meeting date for a brief, and the judge needs the council at least. The read and parse records know no source, so no metric or report can group text by system or council. | `createListStore.schema.ts` `ListedItemSchema`; `createReadStore.schema.ts` `ReadItemSchema` | No waste today. A dead end for the next steps, and a block on measuring tokens by system. |
| W10 | Agenda packs repeat their item papers. | 13 Oct retrospective item 16; 12 Oct big tickets item 9 | 24% of bytes and 35% of parsed text on 11 October. The same text would reach Jev twice. |
| W11 | A "lost" council is not visible anywhere but a log line. The list report counts `Sources with nothing listed: 22` and no metric or alarm carries it. | `buildListStep.ts` `buildListLines` | A council that fails for a week is found by a person reading logs. |

## What the first draft proposed and what became of it

The draft searched three rounds of ten ideas. The ones kept are listed here with their fate, so the path is visible.

| Idea | Fate |
| --- | --- |
| R1.1 The list step outputs addresses, not change hashes. New means no record. | Built. |
| R1.2 A conditional GET to re-check a known document. | Dropped. A read item is never fetched again. A replaced paper at the same address is a known limit. |
| R1.3 Skip `GetMeeting` when the feed says nothing new. | Still to do. W1. |
| R1.4, R2.3, R3.4 The host is the lane. No council slots. Shares by host. | Still to do. W5. |
| R1.7, R2.5 One object per document and nothing else. No council record. | Built, smaller than drafted: no meeting object either. |
| R1.8, R2.7, R3.1 The judge reads only what changed, by a mark and a hash chain. | Dropped. The judge is not built, and the parse chain needs no mark: presence does it. |
| R1.9 Skip an agenda pack when the meeting has item papers. | Still to do. W10. |
| R1.10, R3.9 Gates in config between read and judge. | Waits for the judge. |
| R2.1 The known set from one LIST, not one GET per document. | Built. The read step LISTs three prefixes. |
| R2.2, R3.2 Re-check a meeting only when it changed, or when its object is old. | Still to do, in the item shape. W1 and W2. |
| R2.4 A fixed feed window back from now. | Built, at 7 days. The draft asked for 30. |
| R2.6 Write an object only when its content differs. | Not built for the list step, on purpose: the touch is how "last listed" is known. W3. |
| R2.8, R3.6 Drop the first-listing flags; cap by the crawl limits. | Built. The caps bound every run. |
| R2.9 "Lost" is a query, not a flag. | Not yet visible. W11. |
| R2.10 Events only on a change. | Built further: no events at all. |
| R3.3 Address normalisation in the SDK. | Not built. No volatile address has been seen since the Rugby case. Wait for evidence. |
| R3.5 Re-fetch a known document when its listed facts changed. | Dropped for now. See the edge cases. |
| R3.7 Drop repeated blocks before Jev. | Waits for the judge. Blocks are gone; the unit is a markdown section. |
| R3.8 Tokens as metrics and a store tool. | Still to do, over markdown. |
| R3.10 A conditional-create claim object for workers that come and go. | Stays the written-down option. Not now. |

## The design, redrawn

### Five rules

1. **Presence is state.** A step's work is what the step before wrote, minus what this step has written. Nothing in the store says when a run happened.
2. **Identity is the address. Change is the content hash.** Time comes from the bucket's own last-modified time of an object, never from a run.
3. **One step, one noun.** List owns items. Read owns bytes. Parse owns markdown. OCR owns scan text. Judge will own judgments. A fact is stored once, by its owner, and the item id is the join.
4. **The host is the lane. The item is the work. The share is the worker.** Politeness is per host. Output is per item. Scale is a hash.
5. **Twice is the same as once.** Every write is keyed by the item id. Any step can run at any time, in any order.

### The store after this revision

Nothing moves folder. The changes are one new folder in the parse store and optional fields on two records, which the store rules allow: a new field is optional with a default, and a reader ignores fields it does not know.

```
list/v2/data/<itemId>.json        + meetingUrl, meetingDate, committeeTitle   (optional)
read/v2/data/<itemId>.json        + sourceId                                  (optional)
parse/v3/scans/<itemId>.json      new: a marker, present when the document has a page image
parse/v3/data/<itemId>.json       inherits sourceId through the read fields
```

### The records

**Listed item.** `id`, `sourceId`, `title`, `url`, and for a document `meetingUrl`, the address of its meeting page, with `meetingDate` and `committeeTitle` on both the page item and its documents. The list step has all three in `ListedMeeting` today and throws them away. `meetingUrl` is an address, not an id, so `ItemIdSchema` stays the one place that hashes.

**Read item.** `id`, `contentHash`, `contentType`, `sourceId`. The read step has the source in hand when it saves. With the source on the record, the parse step can count markdown bytes by system without a store read, through the sources file every step already holds.

**Scan marker.** `parse/v3/scans/<itemId>.json`, holding `id`. The parse step writes it before the record when `scanPages` is not empty. The OCR step's work is the markers minus its own records and errors: one LIST of a small prefix instead of every image key.

### What each step does in one run

**List.**

1. LIST `list/v2/data/` once, with times, and hold the result for the run. The list store answers one question for the listers: when was this address last listed? It hashes the address itself, so the id rule holds. The list step may read its own store; the structure test allows a step its own reader.
2. Feed system: fetch the feed for `councils.feedWindowInDays` back from now. The SDK gives each meeting its newest publish time from the items' `pubDate`. Ask `GetMeeting` only when the meeting page has no item, or its newest publish time is newer than the item's last listing. A council whose feed failed yesterday has old items, so its meetings are re-read: the rule heals itself.
3. Page system: read the index pages as today. Open a meeting page only when it has no item, or its meeting date is within `councils.liveMeetingInDays` of today, or its item is older than `councils.oldMeetingRecheckInDays`. The crawl caps still bound the run. Closest to today first, as today.
4. Build the items of each meeting that was read, and write them. A meeting that was skipped has its items left as they are, so their last-modified time stays old.
5. Write the failures as today. Save with `Effect.partition`, so one failed PUT costs one item and a count in the report, not the run.
6. Set `govbase_pipeline_sources_listed{result}` to the count of sources listed, listed empty, and failed. A Grafana rule on `failed` and `empty` is the lost-council alarm. Per-council detail stays in the log, as decision 25 says.
7. Leave out a document whose title matches `documents.packTitlePhrases` when its meeting has another document. A pack that is the meeting's only document is kept. An item never listed is never fetched.

**Read.**

1. LIST `list/v2/data/` with times, `read/v2/data/` keys and `read/v2/errors/` with times, as today. An item is due when it has no read record and either no error, or an error older than the item's listing, or a transient error older than `read.retryAfterInHours` by the error's own last-modified time. The class is inside the error record, so the held errors cost one GET each. They are few and grow with failures, not with items. Transient classes are in `read.transientFailureClasses`: `gateway`, `connection`, `skipped`. A `gone`, `blocked`, `private`, `empty` or `parse` failure waits for the item to be listed again, which after W1 and W2 means its meeting was republished: the right moment to try a 404 again.
2. GET the due items, 64 at once, as today. Group them by host key, the lower-cased host of the address, into lanes. Longest lane first.
3. Run `read.hostsAtOnce` lanes at once. Inside a lane, run `moderngov.mostHostRequestsAtOnce` items at once; the client's pace per host holds. `http.mostRequestsAtOnce` stays the one global cap, through the relay semaphore it already is. `councils.councilsAtOnce` leaves the read step, and the config rule that ties it to `mostRequestsAtOnce` goes.
4. Each item looks up its source by `sourceId` for the browser route and the `file_link` rule, and logs under its council, as today. Save bytes, then the record with `sourceId`, or the error. The report counts hosts and the slowest lanes instead of the slowest sources.

**Parse.** As today, plus the scan marker before the record, and `govbase_pipeline_markdown_bytes{system}` from the markdown length and the source's system.

**OCR.** Work is `parse/v3/scans/` minus `ocr/v3/data/` and `ocr/v3/errors/`. Shares by item id, as today. A one-off tool writes a marker for each existing parse record that has scan pages, so nothing pending is lost at the switch.

**Judge, plan, send.** No work yet. When the judge is built, gates as the draft describes them, over markdown sections instead of blocks, with a metric per gate and a reason in the saved state.

**Every store.** A LIST fans out over the sixteen hex digits a key can start with, since every object in a store is named by a hex id, and reads the sixteen prefixes at once. Same number of pages, one sixteenth of the wall time. A structure test checks that every store key starts with a hex digit.

### Scale and politeness

| Step | Share key | Status |
| --- | --- | --- |
| list | council id | Not needed yet. `councilsAtOnce` paces the listing. |
| read | host key | Lanes first. A share is then one filter over the lanes, as `readIsOwnShare` is for OCR. Not before update 2. |
| ocr | item id | Built. |
| judge | one process | Later. |

`sources.hostKeys` stays as the by-hand share for a dev run. Two processes on the same share keep the data correct and double the rate to those hosts, so the rule is one process per share. The claim object with `If-None-Match: *` stays the option if workers must come and go.

### Tokens and the judge

1. **Measure.** `govbase_pipeline_markdown_bytes{system}` at parse time. A store tool, `tools/stores/readTextReport.mjs`, sums `parse/v3/text/` sizes by source and system, from one LIST with sizes and the `sourceId` on the read records. Markdown bytes over four is the token estimate until the judge spec says otherwise.
2. **Packs.** The title rule at list time, W10. The 12 October big tickets ask for 20 packs checked by hand first. The markdown bytes metric shows the share before and after.
3. **Gates.** `judging.gates` as the draft: `{ id, when, action }`, a skipped state with `skipReason: gate:<id>`, a metric by gate. Built with the judge, not before.
4. **Repeated text.** A section whose text appears in another document of the same meeting is not sent twice. Needs `meetingUrl` on the items, W9. Built with the judge.

### The exit conditions

| Condition | How it is met | What proves it |
| --- | --- | --- |
| A. The loop can go | Met today. The redraw keeps it: the skip rules read object ages, never a run time. | Run read with no list: `No listed item is waiting to be read`. Run read twice: nothing written. Run list twice: the second run skips every meeting with nothing published and writes only new items. |
| B. Less metadata | Met today. The redraw adds four optional fields and one marker folder, each with a named reader. | Object count and bytes per store from the store tool, before and after. |
| C. Safe transfer | Met today by the copied id and hash. | Change a read record's hash by hand: the parse record for that item shows the old hash, and the mismatch is visible. |

### Edge cases that stay, and what they cost

| Case | What happens | Cost |
| --- | --- | --- |
| A paper replaced at the same address | Missed. A read item is never fetched again. ModernGov gives a replaced paper a new attachment id and so a new address; own sites may overwrite in place. | None today. The fix, if it is ever needed, is one rule: fetch again when the item's `publishedOn` from the listing is newer than the read record, once items carry it. |
| A document added to a meeting with no feed republish | The assumption is that ModernGov's "What's new" feed lists every publication for a meeting, supplements included, so the rule in W1 catches it. The dry-run week in item 3 checks this: a meeting the rule would skip whose `GetMeeting` still gives a new item is a counter-example. A page system that adds a paper silently is caught at the old-meeting re-check. | One `GetMeeting` or one page per old meeting per `oldMeetingRecheckInDays`. |
| The pipeline stops for longer than the feed window | Feed meetings published in the gap are not listed. Page systems are not affected. | A wider window costs one feed request and, with W1, few `GetMeeting` calls. Set it to 30 days once W1 is in. |
| A transient failure | Retried after `read.retryAfterInHours`. | One request per held item per period. |
| A lasting failure, such as a 404 | Retried when its meeting is republished. | Nothing between republishes. |
| One PUT fails in a save of thousands | That item is counted and listed again next run. The rest are saved. | One line in the report. |
| A crash in the middle of a read | Bytes go up before the record, so an item is read again or done, never half done. | A few GETs. |
| Two processes run the same share | The data stays correct. The hosts see twice the rate. | An operator rule. |
| A key that does not start with a hex digit | The fan-out LIST would miss it. | A structure test over every `build*Key` fails first. |
| A schema change | A new folder. Decision 11, kept. | A drain. |

### Expected effect on a normal run

The baseline is the 20 October list run at 12:28 and the normal day it implies: about 2,000 new items. The "after" column is an estimate.

| Measure | Today | After | Why |
| --- | --- | --- | --- |
| `GetMeeting` calls a run | About 5,500 | Under 1,000 | W1: only meetings with a publish time newer than their last listing. |
| Page requests for page systems a run | 8,000 to 10,000 | About half | W2: index pages stay, old unchanged meeting pages go. |
| Items written by the list step | 58,000 | About 10,000 | Only the items of meetings that were read. |
| List step time | 24 to 40 min | 10 to 15 min | Fewer calls at the same pace. |
| Read step time | Bound by the slowest host | Bound by the slowest host, with no idle slots | W5. A 1,500-document host at one request a second still needs 25 minutes. |
| Requests for lasting failures | One a run each, for ever | None until the meeting is republished | W6. |
| OCR work discovery | One LIST of every image key | One LIST of the markers | W7. |
| LIST wall time per prefix | 58 pages in sequence | 16 prefixes at once | W8. |
| A lost council | Found in a log | An alarm within a day | W11. |
| Bytes on a full read | 100% | About 76% | The pack rule, 24% of bytes on 11 October. |
| Text parsed and stored | 100% | About 65% | Packs, 35% of text on 11 October. |

### Config that goes and config that comes

| Key | Change | Why |
| --- | --- | --- |
| `councils.councilsAtOnce` | Stays for the list step only. The rule tying it to `http.mostRequestsAtOnce` goes. | The read step runs lanes, not councils. |
| `councils.documentsAtOnce` | Leaves the read step. Stays for `GetMeeting` calls at once, so a rename to `meetingsAtOnce` is due. | The host pace limits items of a host. |
| `councils.feedWindowInDays` | Stays. 7 to 30 once W1 is in. | A wide window is cheap when nothing is re-read. |
| `councils.liveMeetingInDays` | New. | Days around a meeting date in which its page is opened every run. |
| `councils.oldMeetingRecheckInDays` | New. | Age of a meeting page's item after which the page is opened again. |
| `read.hostsAtOnce` | New. | Lanes at once. |
| `read.retryAfterInHours` | New. | Age of a transient read error before it is tried again. |
| `read.transientFailureClasses` | New. | The classes that retry by age. The rest wait for a re-listing. |
| `documents.packTitlePhrases` | New. | The pack rule. |
| `bucket.listsAtOnce` | New. | Prefixes a fan-out LIST reads at once. 16. |
| `judging.gates` | Later. | With the judge. |

### Decisions this changes

Against `pipeline-redesign-decisions.md`.

| Decision | Then | Now |
| --- | --- | --- |
| 8. Each store has `state/` and `events/` | Yes | `data/` and `errors/`, no events. ADR 0001 needs this line amended. |
| 11. Every store object carries a schema version | Yes | The version is in the folder name, not the object. |
| 13. Change detection first, by ETag or listing hash | Yes | Gone. Presence, plus the feed's publish time (W1) and object age (W2). |
| 14. Feed systems read from the council's last-listed time | Yes | A fixed window back from now. |
| 15, 16. First-listing cap, no backfill | Flags | Gone. The crawl caps bound every run. |
| 17. A council is lost after a period with no listing | A flag | A metric and an alarm (W11). |
| 18. Nothing is permanent | Retry every run | Transient by age, lasting by republish (W6). |
| 24, 37. Documents of a council at once is 1 | 1 | 4 today, and the knob leaves the read step. The host pace is the limit. |
| 34, 36. OCR reads the raw bytes and writes under the read outcome's key | Yes | OCR reads the parse step's page images and writes its own markdown. |
| 35. Change detection hashes the parsed listing | Yes | Gone. |
| 38. A full re-read of a page-based council every 24 hours | Yes | Every run today. Live and old-meeting rules after W2. |
| 10, 12, 20, 25 | Kept | Kept. |

ADR 0001 (object storage, no database, no leases) and ADR 0002 (one process per step) hold. ADR 0003, "State is presence", should record rules 1, 2 and 5 and the `data/` and `errors/` layout, and ADR 0001 should point to it for the store layout.

### Order of work

Each item stands alone and is measured by the next run. The files named are the ones to change.

1. **Stop losing a listing, and start counting.** `createListStore.ts` `saveListedItems`: `Effect.partition`, return the saved and failed counts; `buildListStep.ts`: report both. `buildListStep.ts`: the `govbase_pipeline_sources_listed{result}` gauge and a lost-council rule in `grafana/alerts.yaml`. `createObjectBucket.ts`: count LIST pages in `govbase_pipeline_bucket_calls`. No schema change.
2. **OCR work by marker, and the fan-out LIST.** `createParseStore.ts`: `parse/v3/scans/`, written before the record, read by `readScanIds`; `tools/stores/saveScanMarkers.mjs` for the records already there. `createStoreFiles.ts`: `readObjectKeys` and `readObjectTimes` over sixteen hex prefixes at `bucket.listsAtOnce`; a structure test that every store key starts with a hex digit. Additive.
3. **The list step skips what has not changed.** SDK `readFeedXml.ts`: read `pubDate`, give `PublishedMeeting` a `publishedAtUnixMs`; tag a minor version; `make bump-sdk`. `createListStore.ts`: a reader that answers "when was this address last listed?" from one LIST held for the run. `readCouncilListings.types.ts`: hand that reader to each lister in `ListingRequest`. `readModernGovListing.ts`: skip `GetMeeting` by publish time. The five page-system listers: open a meeting page by the live and old-meeting rules. `createPipelineConfig.schema.ts` and both committed config files: `liveMeetingInDays`, `oldMeetingRecheckInDays`. First as a dry run that logs `would skip` and counts, for one week of runs. Then the switch. `buildReadStep.ts` `readIsDue`: the transient retry rule, `read.retryAfterInHours`, `read.transientFailureClasses`, in the same change, so retries do not slow down when the touches stop.
4. **Host lanes in the read step.** `buildReadStep.ts`: `buildDueLanes` by host key, `runDueLanes` at `read.hostsAtOnce`, longest first; `readListedItems.ts`: a lane and a source map instead of one source; `createPipelineConfig.schema.ts`: drop the `councilsAtOnce` rule, add `read.hostsAtOnce`; `grafana/alerts.yaml` and `alertsNameSentMetrics.test.mjs` for the renamed `council_seconds` metric.
5. **The join fields, the pack rule and the text measure.** `createListStore.schema.ts`: `meetingUrl`, `meetingDate`, `committeeTitle`, optional; `readCouncilListings.ts`: fill them, and the pack rule under `documents.packTitlePhrases`. `createReadStore.schema.ts`: `sourceId`, optional; `readListedItems.ts`: fill it. `buildParseStep.ts`: `govbase_pipeline_markdown_bytes{system}`. `tools/stores/readTextReport.mjs`. `createObjectBucket.types.ts`: `byteCount` on `ObjectTime`.
6. **Docs.** `AGENTS.md` and `README.md` in the pipeline for the scan marker, the skip rules, the lanes and the config; `CONTEXT.md` glossary; ADR 0003; the amendment to ADR 0001.

Later, not in this update: read shares by host key with update 2; `feedWindowInDays` to 30 after item 3 has run for a week; the judge, its gates and the repeated-text rule; address normalisation if a volatile address appears again.

### Decisions for the owner

- [ ] The live window: 14 days either side of the meeting date? The old-meeting re-check: 30 days?
- [ ] The transient retry: 24 hours? The transient classes: `gateway`, `connection`, `skipped`? Does `status` join them?
- [ ] The feed window: 30 days once item 3 is in?
- [ ] Add `meetingUrl`, `meetingDate` and `committeeTitle` to items now, or wait for the judge spec? Adding them now costs nothing and gives the plan step its join.
- [ ] The pack rule at list time, so a pack is never fetched, or fetch and skip at judge time? The 20 packs by hand come first either way.
- [ ] Rename `councils.documentsAtOnce` to `councils.meetingsAtOnce` when the read step stops using it?
- [ ] Is ADR 0003 wanted now, or with the docs item?

### Glossary words to add to `CONTEXT.md`

- **Item**: a meeting page or a document the list step found, named by the hash of its address. The unit every store is keyed by.
- **Presence**: an object exists in a store. The only state a step reads.
- **Due**: an item of the step before with no record in this step's store. For the read step, also no error newer than the item's listing, unless the error is transient and old.
- **Touch**: writing an item again with the same content, so its last-modified time moves. How the list step says "listed again".
- **Lane**: one host's queue of due items, paced at the host's rate.
- **Share**: exists for OCR. Now also the read step's unit, by host key.
- **Marker**: an empty-handed record whose presence is the fact, such as a scan marker.
- **Gate**: a config rule that keeps an item from the judge, with a reason. Later.

The words **Changed council**, **Lost council** (as a flag), **First listing**, **Outcome** and **Event** no longer describe the code and should be marked as such or removed.

## Sources

- `apps/pipeline/data/logs/list-2026-10-17T13-41-27Z.log`, `list-2026-10-19T21-49-42Z.log`, `list-2026-10-20T09-22-21Z.log`, `list-2026-10-20T10-45-18Z.log`, `list-2026-10-20T12-28-30Z.log`, `read-2026-10-17T14-08-22Z.log`, `read-2026-10-18T15-02-37Z.log`, `read-2026-10-20T19-09-34Z.log`, `read-2026-10-20T21-41-24Z.log`, `parse-2026-10-21T14-36-12Z.log`, `ocr-2026-10-21T15-19-34Z.log`.
- Code on `parse-as-markdown` (`80e4cad`): `src/domain/buildListStep/`, `readCouncilListings/`, `readModernGovListing/`, `readOwnSiteListing/`, `readCmisListing/`, `readCoinsListing/`, `readDecisionTimeListing/`, `readAmberValleyListing/`, `buildReadStep/`, `readListedItems/`, `buildParseStep/`, `buildOcrStep/`, `buildJudgeStep/`, `runSteps/`; `src/infrastructure/createListStore/`, `createReadStore/`, `createParseStore/`, `createOcrStore/`, `createStoreFiles/`, `createObjectBucket/`, `createModernGovClient/`, `createHttpClient/`, `createPipelineConfig/`; `tools/stores/readRunReport.mjs`; `tools/structure/stepsOwnTheirStores.test.mjs`; `config/development/config.yaml`, `config/production/config.yaml`; `config/sources.yaml` (382 councils: 307 moderngov, 35 cmis, 29 own-site, 4 coins, 3 decision-time, 1 amber-valley, 4 unknown); `README.md`, `AGENTS.md`.
- Parser SDK `v0.8.0`: `src/moderngov/readFeedXml.ts`, `readMeetingXml.ts`, `moderngov.types.ts`.
- `docs/pipeline-redesign-decisions.md`, `docs/pipeline-parse-as-markdown.md`, `docs/pipeline-read-store-schema.md` (describes the `read/v1` shape, now replaced), `docs/adr/0001-stores-in-object-storage-no-database.md`, `docs/adr/0002-one-process-and-one-image-per-step.md`, `docs/read-run-2026-10-15-evening-retrospective.md`, `docs/read-run-2026-10-13-retrospective.md`, `docs/read-run-2026-10-12-big-ticket-items.md`, `docs/CONTEXT.md`.
