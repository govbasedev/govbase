# Pipeline efficiency redesign: state is presence

**Words used in this section**

- **Pipeline**: the Govbase program that finds, fetches and reads council documents. It runs in seven steps.
- **OCR**: optical character recognition. Software that reads the text in a picture of a page.
- **SDK**: the parser SDK, `govbase-parser-sdk`. The library that reads documents, and the pages and lists that council sites return.
- **Update 1**: the update of 15 October that built the stores and the steps.
- **Metadata**: data about the data, such as a record that says when a document was read.
- **State**: what the pipeline remembers between runs.
- **Retrospective**: a doc that looks back at one run and says what went wrong.

This doc was first written on 2026-10-16, during the first OCR run. It used the list and read runs of update 1, on 15 and 16 October. It used the code on the branch `update/stores-and-steps` (commit `d0f2758`) and the parser SDK `v0.6.0`.

It was revised on 2026-10-21. The revision uses the code on the branch `parse-as-markdown` (commit `80e4cad`), the parser SDK `v0.8.0`, and the runs from 17 to 21 October. Most of the first draft is now built. Some of it was built in a simpler shape than the draft asked for. This revision keeps the ask and the rules. It records what the code does today. It redraws the rest of the design, so that each item starts from the code as it is. The text was then rewritten in plain words and short sentences. The content did not change.

The owner set the order of importance. The least work and the simplest design come first, with the least metadata in the store. Speed comes second. The retrospectives already cover speed.

This doc answers one question. How does the pipeline do the least work, with the least stored state, and with no dependence on when the last run happened?

Each chapter of this doc starts with the hard words that first appear in it. A word explained in one chapter is not explained again in a later one.

## Short answers

**Words used in this section**

- **Step**: one part of the pipeline, with one job. The steps are `list`, `read`, `parse`, `ocr`, `judge`, `plan` and `send`.
- **Hash**: a fixed-length code made from some text. The same text always gives the same hash.
- **Feed**: a web page in RSS form that lists what a site published recently. The feed window is how far back the pipeline asks the feed.
- **ModernGov**: the meeting software that most councils use, 307 of 382. Its sites have a feed and a web service.
- **Page system**: a council site with no feed. The pipeline opens its web pages to find meetings. A page-based council uses one. The page systems are own-site, CMIS, COINS, Decision Time and Amber Valley.
- **Crawl**: to open web pages one after another to find links. A crawl cap is a config limit on how many pages a crawl opens.
- **Config**: the settings in `config/<environment>/config.yaml`.
- **Bucket**: the cloud storage that holds all the pipeline's files. It is on Google Cloud Storage (GCS).
- **Object**: one file in the bucket. Each object has a key, which is its name, and a last-modified time, which is when it was last written.
- **Store**: the folder in the bucket that one step owns, such as `read/v2/`.
- **Record**: one small JSON object (a text file in JSON format) that a step writes for one item.
- **Item**: a meeting page or a document that the list step found.
- **Item id**: the hash of the item's web address, made with SHA-256, the hash function the pipeline uses.
- **Set difference**: take one list, and remove from it everything that is also in a second list.
- **Event**: a record that says something happened, written beside the data. The pipeline no longer writes any.
- **Worker**: one running copy of a step that does part of the work.
- **Lock** and **lease**: a lock marks a piece of work as taken by one worker. A lease is a lock with a time limit.
- **Share**: one part of the work, given to one worker. A hash picks the part.
- **Host**: the domain name part of an address, such as `moderngov.co.uk`.
- **Lane**: all the due items of one host, run as one queue at that host's pace.
- **Token**: a piece of text, about four characters. The unit an AI model charges by.
- **Markdown**: plain text with simple marks for headings and lists.
- **Agenda pack**: one PDF that joins all the papers of a meeting.
- **Judge**: the step that will send text to the AI and save what it says. Not built.
- **Gate**: a config rule that keeps an item from the judge, with a reason.

| Question | Answer on 2026-10-16 | Answer on 2026-10-21 |
| --- | --- | --- |
| Where do the repeat requests come from? | From change hashes over a moving feed window. From one store read per listed document. From a full crawl of every page-based council every 24 hours. | The list step asks the ModernGov web service for every meeting in the feed window, on every run. It also opens every page-system meeting page that the crawl caps reach, on every run. The read, parse and OCR steps repeat nothing. |
| Why does state reset? | The stored state was about runs, not about data. | It does not reset any more. No store object holds a run time. The pipeline reads only one time: the bucket's own last-modified time of an object. |
| Can we remove the loop? | Yes, with a set difference over the store. | Done. The work of a step is the items of the step before, minus the records of this step. Run the read step twice, and the second run writes nothing. |
| Can we cut the metadata? | Yes, to one meeting object and one council object of four fields. | Done, and further than planned. There is no meeting object and no council object. One listed item is four fields. Events are gone. |
| Can many workers share the work with no lock? | Yes, by a hash share. | OCR shares the work by item id today. The read step can share by host, after it works in host lanes. There is no lock and no lease. |
| How do we cut tokens? | Measure first. Then gates. Then drop repeated text. | Not started. The unit is now one markdown document per item. Measure the markdown first. Then leave agenda packs out at list time. Then add gates when the judge is built. |

## The ask, kept

**Words used in this section**

- **Effect**: the TypeScript library the pipeline is written with.
- **ADR**: architecture decision record. A short doc that records one design decision and why. ADR 0001 says: object storage, no database, no leases.
- **Stub**: a step that exists but does no work.
- **Process**: one running copy of the pipeline. Workers in different processes share no memory.
- **Metric**: a number the pipeline sends to Grafana, the dashboard tool.
- **Store tool**: a script under `tools/stores/` that reads the bucket and prints numbers.

The owner gave six ideas. On 16 October we ranked them by elegance, and by how well they fit this code base. The code base uses Effect, object storage, one writer per object, no database and no leases. The last column says where each idea stands now.

| Rank | Idea | The form that fits this code | On 2026-10-21 |
| --- | --- | --- | --- |
| 1 | Track what has been fetched. Never fetch it again. | The address is the identity. The record is the memory. New means no record. | Built. The record `read/v2/data/<itemId>.json` is the memory. |
| 2 | A simpler data store than the listing record. | Keep only what exists. Drop the time we ran. | Built. One item record of four fields. There is no listing record, no council record and no raw-facts object. |
| 3 | Spread requests over hosts and workers, not over a council loop. | A fair queue by host inside one process. A hash share by host across processes. | Not built. The read step still runs 72 councils at once. |
| 4 | Measure what we read. Let a person decide what reaches the AI. | A metric per gate. Gates as config. A store tool for the numbers. | Not built. The judge is a stub. |
| 5 | Event based. No dependence on how often the pipeline runs. | Presence in the store between steps. | Built. Any step runs at any time, in any order. |
| 6 | Pick a document at random, lock it, mark it read. | Rejected. A lock is a lease, and ADR 0001 says no leases. A hash share instead. | Stays rejected. |

## What the code does today

**Words used in this section**

- **Structure test**: a test that checks the shape of the code, such as which files a step may import.
- **Scan page**: a page that is a picture with no text, so it needs OCR.
- **Failure class**: the kind of a failed request, such as `gateway`, `blocked`, `skipped` or `gone`.
- **`GetMeeting`**: a ModernGov web service call. It returns one meeting with its documents.
- **launchd**: the macOS scheduler that starts a program at a set time.
- **Alarm**: a rule in Grafana that sends an alert when a metric crosses a limit, or when a metric stops coming.
- **Schema**: the written shape of a record or a config part: its fields and their types.
- **Exit condition**: a test that says when this redesign is done.
- **Prefix**: the start of a key, such as `list/v2/data/`. The bucket can return every key that starts with one.
- **Hash chain**: a record that holds the hash of the record before it. A reader can then check that nothing changed between a producer, which writes, and a consumer, which reads.

The pipeline is seven steps over one bucket: `list`, `read`, `parse`, `ocr`, `judge`, `plan` and `send`. Each step owns one folder in the bucket. In that folder, `data/` holds one record per item done, and `errors/` holds one record per item that failed. Each record is named by the item id. No step writes events. A step reads only its own store and the stores of the steps before it. The structure test `tools/structure/stepsOwnTheirStores.test.mjs` fails when a step reads more.

| Key | Holds | Written by |
| --- | --- | --- |
| `list/v2/data/<itemId>.json` | `id`, `sourceId`, `title`, `url`. Written again on every run that lists the item. | list |
| `list/v2/errors/<errorId>.json` | A failed index page: `id`, `sourceId`, `url`, the failed request. Never deleted. | list |
| `read/v2/data/<itemId>.json` | `id`, `contentHash`, `contentType`. | read |
| `read/v2/errors/<itemId>.json` | `id` and the failed request. Written over by a later failure. | read |
| `read/v2/bytes/<itemId>` | The fetched bytes. | read |
| `parse/v3/data/<itemId>.json` | The read fields, plus `sdkVersion`, `pageCount`, `scanPages`, `leftOut`, `images`. | parse |
| `parse/v3/text/<itemId>.md` | One markdown document, English only, with each page marked. | parse |
| `parse/v3/images/<itemId>/<file>` | Each picture and each scan page, as a PNG. | parse |
| `parse/v3/errors/<itemId>.json` | `id`, `contentHash`, the failure class and the reason. | parse |
| `ocr/v3/data/<itemId>.json` | `id`, `contentHash`, the pages read, failed and left, `leftOut`. | ocr |
| `ocr/v3/text/<itemId>.md` | The parse markdown, with the OCR text under each page image. | ocr |
| `ocr/v3/errors/<itemId>.json` | As a parse error. | ocr |

The rules, as built.

1. **An item is a meeting page or a document.** Its `id` is the SHA-256 hash of its address. `ItemIdSchema` in `createListStore.schema.ts` makes the id, once. Every later store names its objects by that id. No later store hashes the address again. A document under two meetings is one item. When two sources list the same item, it is one record. The first source from A to Z keeps it.
2. **State is presence.** The read step's work is every item in `list/v2/data/` that has no record in `read/v2/data/`. An item with an error in `read/v2/errors/` is also left out, when the error is newer than the item's last-modified time. The parse step's work is every read item with no parse record and no parse error. The OCR step's work is every parsed document with a page image, and no OCR record or error. Parse and OCR never try again. To redo their work, empty their folder.
3. **The list step keeps no memory of the last run.** Every run lists everything the page limits reach. For ModernGov, it reads the feed for `councils.feedWindowInDays` back from now. Then it calls `GetMeeting` for each meeting the feed names. For a page system, it reads the index pages, then the meeting pages up to the crawl caps. It writes every item it listed. So an item's last-modified time is the time of the last run that listed it. A failed read is tried again only after the list step lists the item again.
4. **One step, one process, one run.** The config key `run.steps` picks the steps. The script `bun run dev:run` runs list, read, parse, ocr and judge, once a day on the Mac, under launchd. The alarm `pipeline-no-finished-run` fires after 26 hours with no finished run. The config key `sources.hostKeys` limits a read run to the sources on some hosts. That is a share set by hand. The keys `ocr.shareIndex` and `ocr.shareCount` share the scans by item id.
5. **The judge is a stub.** The code to judge whole documents is not built. These were all deleted: the judge store, the judgment client, item versions, item states, experiments, issues, questions, recipes and tagging. Plan and send have no work.
6. **Config that was removed**: `fullListingInHours`, `lostAfterInHours`, `listingFallbackInHours`, `lastingUnreadClasses`, `goneAfterAttempts`, `firstListingInDays`, `recordsAtOnce`, `guessedDocumentsPerMeeting`, and the `tagging` and `tokens` parts. **Config that stayed**: `councils.councilsAtOnce` is 72, and the schema says it must be twice `http.mostRequestsAtOnce`. `councils.documentsAtOnce` is 4. The read step uses it for the items of one source, and the list step for `GetMeeting` calls. `councils.feedWindowInDays` is 7. The crawl caps per system stayed.

What the code already proves about the three exit conditions.

| Condition | Met? | Proof |
| --- | --- | --- |
| A. The loop can go | Yes | Run read with no list before it. It lists three prefixes and logs `No listed item is waiting to be read`. Run read twice. The second run writes nothing. Run list, list, read. Both listings are present, because the list step writes every item it sees. No step reads a run time. |
| B. Less metadata | Yes, and more than the draft asked | Gone: the listing record of 20 fields, the read council record, the raw-facts object, the events and the `schemaVersion` field. An item is four fields. A read record is three fields. |
| C. Safe transfer | Yes, by how the records are built | Every later record copies the item `id` and the `contentHash` forward. A read item is never fetched again, so the bytes under a parse never change. No hash chain between a producer and a consumer is needed. |

## Evidence from the runs of 17 to 21 October

**Words used in this section**

- **LIST, GET, PUT**: the three bucket operations. LIST returns the keys under a prefix, 1,000 at a time. GET fetches one object. PUT writes one object.
- **Item model**: the store design built on 19 October. One item is one record of four fields.
- **S3**: the storage protocol the bucket speaks. An `S3Error` is a failed bucket call.
- **Relay**: the Govbase proxy service. The pipeline sends every web request to a council through it.
- **Slot**: one of the 72 places for a council in the read step.
- **Gateway**: a failure class. The relay waited too long for the council site, or the site's own gateway failed. The statuses are 502, 503, 504 and 522.
- **Blocked**: a failure class. The site refused the request with a 401, a 403, or a block page.
- **Skipped**: a failure class. The request was not sent, because the host had failed three times in a row, or because the source has no reader.

| Run | Result | What it shows |
| --- | --- | --- |
| list 17 Oct 13:41 | 382 councils, 20.7 min, 5,437 meetings | Before the item model. |
| list 19 Oct 21:49 | 382 sources, 21.6 min, 7,081 meetings, 58,954 items | The item model. One PUT per item. |
| list 20 Oct 09:22 | 34.2 min, 6,815 meetings, 55,373 items | The time moves with the councils' sites, not with new work. |
| list 20 Oct 10:45 | 40.1 min, 6,963 meetings, 58,048 items, 57,784 new | The bucket was emptied before the run. |
| list 20 Oct 12:28 | 24.2 min, 6,988 meetings, 58,280 items, `New items saved: none, the save failed` | One `S3Error: Service Unavailable` on one item stopped the save of the rest. 22 sources listed nothing. 19 listing failures: 8 skipped, 8 gateway, 3 blocked. |
| read 17 Oct 14:08 | 369 councils, 165.6 min | A full read, before the item model. |
| read 18 Oct 15:02 | 371 councils, 94.7 min | A full read, before the item model. |
| read 20 Oct 19:09 | 6 sources by `hostKeys`, 1,593 items due, 1,533 read, 35.6 min | Angus alone took 35.5 min: one own-site host, about 1,500 documents, one request a second. The slowest host sets the run time, whatever the council slots say. |
| read 20 Oct 21:41 | The same 6 sources, 1,542 read, 35.2 min | The read store was emptied, so the same work ran again. The same limit. |
| parse 21 Oct 14:36 | 1,542 items, 39.4 min, 1,535 documents, 163 with scan pages, 3 `broken-file`, 4 unsaved | About 6 s per item, 4 at once. |
| ocr 21 Oct 15:19 | 162 scans, 2 at once, about 1 to 2 s per one-page scan | OCR reads the stored page image. It never draws a page again. The 7-hour OCR run of 16 October will not happen again. |

What the runs show.

1. The list step is the step that repeats work. It made about 5,500 `GetMeeting` calls. It opened every page-system meeting page the caps reach. It wrote 58,280 items. On that day, the read step then had about 2,000 new items to fetch.
2. One failed PUT can lose most of a listing. The save on 20 October at 12:28 stopped at the first error. The next run lists again, so nothing is lost for good. But one day of reading waits.
3. The slowest host sets the read step's time. Council slots do not change that. The Angus run is the proof: 35 minutes for one host, at one request a second.
4. Parse and OCR no longer set the run time. Both are limited by the Mac's CPU. Both repeat nothing.
5. Nothing measures tokens yet. The parse record has a page count and image sizes, but no text size.

## Where the waste is in the code today

**Words used in this section**

- **`pubDate`**: the publish date of one feed entry.
- **Class A**: Google's price group for writes to the bucket.
- **503**: a reply status that means the service was not available for a moment.
- **Politeness**: to send a host no more requests than it can take. The pipeline paces its requests per host.
- **Touch**: to write an item again with the same content, so that its last-modified time moves.
- **Transient failure**: a failure that goes away on its own, such as a gateway time-out.
- **Lasting failure**: a failure that stays, such as a 404, which means the site says the page does not exist.
- **Brief**: the summary of a meeting that the plan step will write for a reader.
- **Jev**: the AI model that the judge step will send text to.

Each waste item has a cause, a place in the code, and a cost.

**W1. The list step asks for every meeting in the feed window, on every run.** It does this whether or not the council published anything since the last listing. The SDK drops the feed's `pubDate`, so the step cannot tell.

- Where: `readModernGovListing.ts`, function `readCouncilList`. SDK `readFeedXml.ts`, which keeps only `MId` and the committee title.
- Cost: about 5,500 `GetMeeting` calls a run, at one request a second per host. On a normal day, about six in seven of these calls repeat a listing already made.

**W2. Every page-based council is crawled to its caps, on every run.** The step reads the index pages, then up to 120 meeting pages, closest to today first.

- Where: `readCmisListing.ts`, `readOwnSiteListing.ts`, `readCoinsListing.ts`, `readDecisionTimeListing.ts`, `readAmberValleyListing.ts`. Config `councils.most*Pages` and `most*Meetings`.
- Cost: 72 councils, up to 200 pages each, about 8,000 to 10,000 page requests a run. Most of these meeting pages were read the day before and have not changed.

**W3. The list step writes every item it listed.** That is 58,000 PUTs a run. It does this so that the bucket's last-modified time means "last listed".

- Where: `createListStore.ts`, function `saveListedItems`. `buildListStep.ts`.
- Cost: about 58,000 small PUTs a run, about one minute, about 9 US dollars a month at GCS Class A prices. The rule it buys is right. W1 and W2 cut the count to the items of meetings that were really read again.

**W4. The save of the listed items stops at the first failed PUT.** The rest stay unsaved.

- Where: `createListStore.ts`, function `saveListedItems`. It uses `Effect.forEach`, which stops at the first error.
- Cost: one 503 error from the bucket on 20 October cost the day's listing.

**W5. The read step is shaped around councils.** It runs 72 councils at once, with 4 items of a council at once, the sources with the most items first. But the host is the unit of politeness. So the slot plan and the pace work against each other. The config schema also ties `councilsAtOnce` to `mostRequestsAtOnce`.

- Where: `buildReadStep.ts`, functions `buildDueSources` and `runDueSources`. `readListedItems.ts`. `createPipelineConfig.schema.ts`, constant `COUNCIL_PACING_TEXT`.
- Cost: the run ends when the biggest host's lane ends. Slots sit idle while they wait. The rule that ties the two config keys is a sign of a bad shape.

**W6. The retry rule depends on the touch.** A read error is tried again only when the list step lists the item again. Today that is every run, because W3 touches every item. When W1 and W2 stop the touches of unchanged meetings, a transient failure would wait days. A lasting failure is today tried again every run, for ever.

- Where: `buildReadStep.ts`, function `readIsDue`.
- Cost today: one request a run for each `gone` or `blocked` item that is still listed. Cost after W1 and W2, with no change here: slow retries of transient failures.

**W7. The OCR step lists every image key to find its work.** It keeps the keys that match `page-<n>.png`.

- Where: `createParseStore.ts`, function `readScanIds`, over `parse/v3/images/`.
- Cost: the list grows with every picture in every document ever parsed, not with the scans that wait. Tens of thousands of keys today. Hundreds of thousands within months.

**W8. Each LIST reads its pages one after another.** Each step finds its work with one LIST per prefix. The prefixes grow for ever.

- Where: `createObjectBucket.ts`, function `readCloudPage`, reads the pages in sequence.
- Cost: 58 pages a prefix today. About 1,000 pages a prefix a year from now, at 100 seconds each, several times a run.

**W9. Items know nothing of their meeting. Read records know nothing of their source.** A document item knows its source and its title only. The plan step needs a committee and a meeting date for a brief. The judge needs the council at least. The read and parse records have no source, so no metric or report can group text by system or by council.

- Where: `createListStore.schema.ts`, `ListedItemSchema`. `createReadStore.schema.ts`, `ReadItemSchema`.
- Cost: no waste today. It blocks the next steps, and it blocks a token measure by system.

**W10. Agenda packs repeat their item papers.**

- Where: the 13 October retrospective, item 16. The 12 October big tickets, item 9.
- Cost: 24% of bytes and 35% of parsed text on 11 October. The same text would reach Jev twice.

**W11. A lost council is visible only in a log line.** The list report counts `Sources with nothing listed: 22`. No metric or alarm carries it.

- Where: `buildListStep.ts`, function `buildListLines`.
- Cost: a council that fails for a week is found only by a person who reads the logs.

## What the first draft proposed and what became of it

**Words used in this section**

- **Conditional GET**: a GET that asks the site for the file only if it changed.
- **Mark**: a small record that says the judge has read an item.
- **Flag**: a true or false field on a record.
- **Query**: a question answered by reading the store, not by a stored field.
- **Address normalisation**: to make two spellings of one address into one.
- **Block**: a piece of parsed text. The unit the parser used before markdown sections.
- **Claim object**: an object a worker writes only when it does not exist yet, to take a piece of work.

The draft searched three rounds of ten ideas each. The ideas that were kept are listed here, with what became of them, so the path is visible.

| Idea | What became of it |
| --- | --- |
| R1.1 The list step outputs addresses, not change hashes. New means no record. | Built. |
| R1.2 A conditional GET to check a known document again. | Dropped. A read item is never fetched again. A paper replaced at the same address is a known limit. |
| R1.3 Skip `GetMeeting` when the feed says nothing is new. | Still to do. W1. |
| R1.4, R2.3, R3.4 The host is the lane. No council slots. Shares by host. | Still to do. W5. |
| R1.7, R2.5 One object per document and nothing else. No council record. | Built, and smaller than drafted. There is no meeting object either. |
| R1.8, R2.7, R3.1 The judge reads only what changed, by a mark and a hash chain. | Dropped. The judge is not built. The parse chain needs no mark, because presence does the job. |
| R1.9 Skip an agenda pack when the meeting has item papers. | Still to do. W10. |
| R1.10, R3.9 Gates in config between read and judge. | Waits for the judge. |
| R2.1 Get the known set from one LIST, not from one GET per document. | Built. The read step LISTs three prefixes. |
| R2.2, R3.2 Check a meeting again only when it changed, or when its object is old. | Still to do, in the item shape. W1 and W2. |
| R2.4 A fixed feed window back from now. | Built, at 7 days. The draft asked for 30. |
| R2.6 Write an object only when its content differs. | Not built for the list step, on purpose. The touch is how "last listed" is known. W3. |
| R2.8, R3.6 Drop the first-listing flags. Bound the run by the crawl caps. | Built. The caps bound every run. |
| R2.9 "Lost" is a query, not a flag. | Not yet visible. W11. |
| R2.10 Events only on a change. | Built, and further: no events at all. |
| R3.3 Address normalisation in the SDK. | Not built. No changing address has been seen since the Rugby case. Wait for evidence. |
| R3.5 Fetch a known document again when its listed facts changed. | Dropped for now. See the edge cases. |
| R3.7 Drop repeated blocks before Jev. | Waits for the judge. Blocks are gone. The unit is a markdown section. |
| R3.8 Tokens as metrics, and a store tool. | Still to do, over markdown. |
| R3.10 A claim object for workers that come and go. | Stays the written-down option. Not now. |

## The design, redrawn

**Words used in this section**

- **Join**: the key that links the records of one item across the stores. Also a field that lets two records be matched.
- **Marker**: a small object whose presence is the fact.
- **Lister**: the function that lists one council's meetings for one system.
- **Dry run**: a run that logs what it would do and changes nothing.
- **Gauge**: a metric that holds a current value.
- **Semaphore**: a counter that limits how many requests run at once.
- **Browser service**: the Govbase service that opens a page in a real Chrome browser, for sites that block the relay. The browser route is to read a document through it.
- **Hex digit**: one of the sixteen digits 0 to 9 and a to f. Every id in a store is written in them.
- **Fan out**: to split one job into many smaller jobs that run at once.
- **Wall time**: the time a person waits for a job to finish.
- **Update 2**: the later update that moves the pipeline off the Mac onto a server.
- **`If-None-Match: *`**: a request header that makes a PUT fail when the object already exists.
- **Spec**: a doc that says what a step must do, written before the step is built.
- **Edge case**: a rare situation that the normal rules do not cover well.
- **Supplement**: a paper added to a meeting after its agenda was published.
- **Counter-example**: one case that proves a rule wrong.
- **Operator**: the person who runs the pipeline.
- **Drain**: to work an old folder down until it is empty, then remove it.
- **Baseline**: the run that the estimates are measured against.
- **Change detection**: to find out whether a meeting or a page changed since the last run, before reading it again.
- **ETag**: a version code a web server gives for a file.
- **Backfill**: to list old meetings that were published before the pipeline first ran.
- **Glossary**: the list of project words in `CONTEXT.md`.

### Five rules

1. **Presence is state.** A step's work is what the step before wrote, minus what this step has written. Nothing in the store says when a run happened.
2. **Identity is the address. Change is the content hash.** Time comes from the bucket's own last-modified time of an object. It never comes from a run.
3. **One step, one noun.** List owns items. Read owns bytes. Parse owns markdown. OCR owns scan text. Judge will own judgments. A fact is stored once, by its owner. The item id is the join.
4. **The host is the lane. The item is the work. The share is the worker.** Politeness is per host. Output is per item. Scale is a hash.
5. **Twice is the same as once.** Every write is keyed by the item id. Any step can run at any time, in any order.

### The store after this revision

No folder moves. The changes are one new folder in the parse store, and optional fields on two records. The store rules allow this: a new field is optional with a default, and a reader ignores fields it does not know.

```
list/v2/data/<itemId>.json        + meetingUrl, meetingDate, committeeTitle   (optional)
read/v2/data/<itemId>.json        + sourceId                                  (optional)
parse/v3/scans/<itemId>.json      new: a marker, present when the document has a page image
parse/v3/data/<itemId>.json       inherits sourceId through the read fields
```

### The records

**Listed item.** The fields are `id`, `sourceId`, `title` and `url`. A document also gets `meetingUrl`, the address of its meeting page. Both the page item and its documents get `meetingDate` and `committeeTitle`. The list step has all three values in `ListedMeeting` today, and throws them away. `meetingUrl` is an address, not an id. So `ItemIdSchema` stays the one place that makes a hash.

**Read item.** The fields are `id`, `contentHash`, `contentType` and `sourceId`. The read step has the source in hand when it saves. With the source on the record, the parse step can count markdown bytes by system without a store read. It uses the sources file that every step already holds.

**Scan marker.** The object `parse/v3/scans/<itemId>.json` holds `id`. The parse step writes it before the record, when `scanPages` is not empty. The OCR step's work is then the markers, minus its own records and errors. That is one LIST of a small prefix, instead of a LIST of every image key.

### What each step does in one run

**List.**

1. LIST `list/v2/data/` once, with times. Hold the result for the run. The list store answers one question for the listers: when was this address last listed? The store hashes the address itself, so the id rule holds. The list step may read its own store, because the structure test allows a step its own reader.
2. For a feed system: fetch the feed for `councils.feedWindowInDays` back from now. The SDK gives each meeting its newest publish time, from the `pubDate` of the feed entries. Call `GetMeeting` only when the meeting page has no item, or when its newest publish time is newer than the item's last listing. A council whose feed failed yesterday has old items, so its meetings are read again. The rule repairs itself.
3. For a page system: read the index pages as today. Open a meeting page only in one of three cases. The page has no item. Its meeting date is within `councils.liveMeetingInDays` of today. Its item is older than `councils.oldMeetingRecheckInDays`. The crawl caps still bound the run. Closest to today first, as today.
4. Build the items of each meeting that was read, and write them. A meeting that was skipped keeps its items as they are, so their last-modified time stays old.
5. Write the failures as today. Save with `Effect.partition`, which saves what it can and collects the failures. One failed PUT then costs one item and a count in the report, not the run.
6. Set the gauge `govbase_pipeline_sources_listed{result}` to the count of sources listed, listed empty, and failed. A Grafana rule on `failed` and `empty` is the lost-council alarm. Per-council detail stays in the log, as decision 25 says.
7. Leave out a document whose title matches `documents.packTitlePhrases`, when its meeting has another document. A pack that is the meeting's only document is kept. An item that is never listed is never fetched.

**Read.**

1. LIST `list/v2/data/` with times, `read/v2/data/` keys, and `read/v2/errors/` with times, as today. An item is due in three cases. It has no read record and no error. Its error is older than the item's listing. Its error is transient and older than `read.retryAfterInHours`, by the error's own last-modified time. The failure class is inside the error record, so each held error costs one GET. Held errors are few, and they grow with failures, not with items. The transient classes are in `read.transientFailureClasses`: `gateway`, `connection` and `skipped`. A `gone`, `blocked`, `private`, `empty` or `parse` failure waits for the item to be listed again. After W1 and W2, that means its meeting was published again. That is the right moment to try a 404 again.
2. GET the due items, 64 at once, as today. Group them by host key into lanes. The host key is the lower-cased host of the address. Longest lane first.
3. Run `read.hostsAtOnce` lanes at once. Inside a lane, run `moderngov.mostHostRequestsAtOnce` items at once. The client's pace per host still holds. `http.mostRequestsAtOnce` stays the one global cap, through the relay semaphore it already is. `councils.councilsAtOnce` leaves the read step. The config rule that ties it to `mostRequestsAtOnce` goes.
4. Each item looks up its source by `sourceId`, for the browser route and the `file_link` rule. It logs under its council, as today. Save the bytes, then the record with `sourceId`, or the error. The report counts hosts and the slowest lanes, instead of the slowest sources.

**Parse.** As today, plus two things. Write the scan marker before the record. Send the metric `govbase_pipeline_markdown_bytes{system}`, from the markdown length and the source's system.

**OCR.** The work is `parse/v3/scans/` minus `ocr/v3/data/` and `ocr/v3/errors/`. Shares by item id, as today. A one-off tool writes a marker for each existing parse record that has scan pages. So nothing that waits is lost at the switch.

**Judge, plan, send.** No work yet. When the judge is built, add gates as the draft describes them, over markdown sections instead of blocks. Each gate gets a metric, and writes its reason in the saved state.

**Every store.** Every object in a store is named by a hex id. So a LIST can fan out over the sixteen digits a key can start with, and read the sixteen prefixes at once. Same number of pages, one sixteenth of the wall time. A structure test checks that every store key starts with a hex digit.

### Scale and politeness

| Step | Share key | Status |
| --- | --- | --- |
| list | council id | Not needed yet. `councilsAtOnce` paces the listing. |
| read | host key | Lanes first. A share is then one filter over the lanes, as `readIsOwnShare` is for OCR. Not before update 2. |
| ocr | item id | Built. |
| judge | one process | Later. |

`sources.hostKeys` stays as the share set by hand for a dev run. Two processes on the same share keep the data correct, but they double the rate to those hosts. So the rule is one process per share. The claim object with `If-None-Match: *` stays the option, if workers must come and go.

### Tokens and the judge

1. **Measure.** Send `govbase_pipeline_markdown_bytes{system}` at parse time. A store tool, `tools/stores/readTextReport.mjs`, sums the sizes under `parse/v3/text/` by source and by system. It uses one LIST with sizes, and the `sourceId` on the read records. Markdown bytes divided by four is the token estimate, until the judge spec says otherwise.
2. **Packs.** The title rule at list time, W10. The 12 October big tickets ask for 20 packs checked by hand first. The markdown bytes metric shows the share before and after.
3. **Gates.** `judging.gates` as the draft: `{ id, when, action }`. A skipped item gets the state `skipReason: gate:<id>`. One metric by gate. Built with the judge, not before.
4. **Repeated text.** A section whose text appears in another document of the same meeting is not sent twice. This needs `meetingUrl` on the items, W9. Built with the judge.

### The exit conditions

| Condition | How it is met | What proves it |
| --- | --- | --- |
| A. The loop can go | Met today. The redraw keeps it. The skip rules read object ages, never a run time. | Run read with no list: `No listed item is waiting to be read`. Run read twice: nothing is written. Run list twice: the second run skips every meeting with nothing published, and writes only new items. |
| B. Less metadata | Met today. The redraw adds four optional fields and one marker folder. Each has a named reader. | The object count and bytes per store from the store tool, before and after. |
| C. Safe transfer | Met today, by the copied id and hash. | Change a read record's hash by hand. The parse record for that item shows the old hash, so the mismatch is visible. |

### Edge cases that stay, and what they cost

| Case | What happens | Cost |
| --- | --- | --- |
| A paper is replaced at the same address | Missed. A read item is never fetched again. ModernGov gives a replaced paper a new attachment id, and so a new address. An own site may write over the file in place. | None today. If a fix is ever needed, it is one rule: fetch again when the item's `publishedOn` from the listing is newer than the read record. Items must carry `publishedOn` first. |
| A document is added to a meeting with no new feed entry | The assumption is that the ModernGov "What's new" feed lists every publication for a meeting, supplements included. Then the rule in W1 catches it. The dry-run week in item 3 checks this. A counter-example is a meeting the rule would skip, whose `GetMeeting` still gives a new item. A page system that adds a paper with no sign is caught at the old-meeting check. | One `GetMeeting` or one page per old meeting, once per `oldMeetingRecheckInDays`. |
| The pipeline stops for longer than the feed window | Feed meetings published in the gap are not listed. Page systems are not affected. | A wider window costs one feed request and, with W1, few `GetMeeting` calls. Set it to 30 days after W1 is in. |
| A transient failure | Tried again after `read.retryAfterInHours`. | One request per held item per period. |
| A lasting failure, such as a 404 | Tried again when its meeting is published again. | Nothing between publications. |
| One PUT fails in a save of thousands | That item is counted, and listed again next run. The rest are saved. | One line in the report. |
| A crash in the middle of a read | The bytes go up before the record. So an item is read again, or done. It is never half done. | A few GETs. |
| Two processes run the same share | The data stays correct. The hosts see twice the rate. | An operator rule. |
| A key that does not start with a hex digit | The fan-out LIST would miss it. | A structure test over every `build*Key` fails first. |
| A schema change | A new folder. Decision 11, kept. | A drain. |

### Expected effect on a normal run

The baseline is the list run of 20 October at 12:28, and the normal day it implies: about 2,000 new items. The "after" column is an estimate.

| Measure | Today | After | Why |
| --- | --- | --- | --- |
| `GetMeeting` calls a run | About 5,500 | Under 1,000 | W1. Only meetings with a publish time newer than their last listing. |
| Page requests for page systems a run | 8,000 to 10,000 | About half | W2. Index pages stay. Old meeting pages that did not change go. |
| Items written by the list step | 58,000 | About 10,000 | Only the items of meetings that were read. |
| List step time | 24 to 40 min | 10 to 15 min | Fewer calls at the same pace. |
| Read step time | Set by the slowest host | Set by the slowest host, with no idle slots | W5. A host with 1,500 documents at one request a second still needs 25 minutes. |
| Requests for lasting failures | One a run each, for ever | None until the meeting is published again | W6. |
| How OCR finds its work | One LIST of every image key | One LIST of the markers | W7. |
| LIST wall time per prefix | 58 pages, one after another | 16 prefixes at once | W8. |
| A lost council | Found in a log | An alarm within a day | W11. |
| Bytes on a full read | 100% | About 76% | The pack rule. Packs were 24% of bytes on 11 October. |
| Text parsed and stored | 100% | About 65% | The pack rule. Packs were 35% of text on 11 October. |

### Config that goes and config that comes

| Key | Change | Why |
| --- | --- | --- |
| `councils.councilsAtOnce` | Stays, for the list step only. The rule that ties it to `http.mostRequestsAtOnce` goes. | The read step runs lanes, not councils. |
| `councils.documentsAtOnce` | Leaves the read step. Stays for `GetMeeting` calls at once, so a rename to `meetingsAtOnce` is due. | The host pace limits the items of a host. |
| `councils.feedWindowInDays` | Stays. Goes from 7 to 30 after W1 is in. | A wide window is cheap when nothing is read again. |
| `councils.liveMeetingInDays` | New. | The days around a meeting date in which its page is opened every run. |
| `councils.oldMeetingRecheckInDays` | New. | The age of a meeting page's item after which the page is opened again. |
| `read.hostsAtOnce` | New. | The number of lanes that run at once. |
| `read.retryAfterInHours` | New. | The age of a transient read error before it is tried again. |
| `read.transientFailureClasses` | New. | The classes that are tried again by age. The rest wait for a new listing. |
| `documents.packTitlePhrases` | New. | The pack rule. |
| `bucket.listsAtOnce` | New. | The number of prefixes a fan-out LIST reads at once. 16. |
| `judging.gates` | Later. | With the judge. |

### Decisions this changes

Against `pipeline-redesign-decisions.md`.

| Decision | Then | Now |
| --- | --- | --- |
| 8. Each store has `state/` and `events/` | Yes | `data/` and `errors/`, and no events. This line in ADR 0001 needs a change. |
| 11. Every store object carries a schema version | Yes | The version is in the folder name, not in the object. |
| 13. Change detection first, by ETag or listing hash | Yes | Gone. Presence, plus the feed's publish time (W1) and object age (W2). |
| 14. Feed systems read from the council's last-listed time | Yes | A fixed window back from now. |
| 15, 16. A first-listing cap, and no backfill | Flags | Gone. The crawl caps bound every run. |
| 17. A council is lost after a period with no listing | A flag | A metric and an alarm (W11). |
| 18. Nothing is permanent | Try again every run | Transient by age. Lasting by a new publication (W6). |
| 24, 37. Documents of a council at once is 1 | 1 | 4 today, and the key leaves the read step. The host pace is the limit. |
| 34, 36. OCR reads the raw bytes and writes under the read outcome's key | Yes | OCR reads the parse step's page images and writes its own markdown. |
| 35. Change detection hashes the parsed listing | Yes | Gone. |
| 38. A full read of a page-based council again every 24 hours | Yes | Every run today. The live and old-meeting rules after W2. |
| 10, 12, 20, 25 | Kept | Kept. |

ADR 0001 (object storage, no database, no leases) and ADR 0002 (one process per step) still hold. ADR 0003, "State is presence", should record rules 1, 2 and 5, and the `data/` and `errors/` layout. ADR 0001 should point to it for the store layout.

### Order of work

Each item stands alone. The next run measures it. The files named are the ones to change.

1. **Stop losing a listing, and start counting.**
   - `createListStore.ts`, `saveListedItems`: use `Effect.partition`. Return the saved and failed counts.
   - `buildListStep.ts`: report both counts. Add the gauge `govbase_pipeline_sources_listed{result}`.
   - `grafana/alerts.yaml`: a lost-council rule.
   - `createObjectBucket.ts`: count LIST pages in `govbase_pipeline_bucket_calls`.
   - No schema change.
2. **OCR work by marker, and the fan-out LIST.**
   - `createParseStore.ts`: write `parse/v3/scans/` before the record. `readScanIds` reads the markers.
   - `tools/stores/saveScanMarkers.mjs`: write a marker for each record already there.
   - `createStoreFiles.ts`: `readObjectKeys` and `readObjectTimes` read sixteen hex prefixes, `bucket.listsAtOnce` at once.
   - A structure test that every store key starts with a hex digit.
   - Nothing is removed or changed. All of it is added.
3. **The list step skips what has not changed.**
   - SDK `readFeedXml.ts`: read `pubDate`. Give `PublishedMeeting` a `publishedAtUnixMs`. Tag a minor version. Run `make bump-sdk`.
   - `createListStore.ts`: a reader that answers "when was this address last listed?", from one LIST held for the run.
   - `readCouncilListings.types.ts`: hand that reader to each lister in `ListingRequest`.
   - `readModernGovListing.ts`: skip `GetMeeting` by publish time.
   - The five page-system listers: open a meeting page by the live and old-meeting rules.
   - `createPipelineConfig.schema.ts` and both committed config files: `liveMeetingInDays`, `oldMeetingRecheckInDays`.
   - First as a dry run: log `would skip` and count, for one week of runs. Then make the switch.
   - `buildReadStep.ts`, `readIsDue`: the transient retry rule, with `read.retryAfterInHours` and `read.transientFailureClasses`. In the same change, so retries do not slow down when the touches stop.
4. **Host lanes in the read step.**
   - `buildReadStep.ts`: `buildDueLanes` by host key. `runDueLanes` at `read.hostsAtOnce`, longest first.
   - `readListedItems.ts`: take a lane and a source map, instead of one source.
   - `createPipelineConfig.schema.ts`: drop the `councilsAtOnce` rule. Add `read.hostsAtOnce`.
   - `grafana/alerts.yaml` and `alertsNameSentMetrics.test.mjs`: the renamed `council_seconds` metric.
5. **The join fields, the pack rule and the text measure.**
   - `createListStore.schema.ts`: `meetingUrl`, `meetingDate`, `committeeTitle`, all optional.
   - `readCouncilListings.ts`: fill them. Add the pack rule under `documents.packTitlePhrases`.
   - `createReadStore.schema.ts`: `sourceId`, optional. `readListedItems.ts`: fill it.
   - `buildParseStep.ts`: the metric `govbase_pipeline_markdown_bytes{system}`.
   - `tools/stores/readTextReport.mjs`: new.
   - `createObjectBucket.types.ts`: `byteCount` on `ObjectTime`.
6. **Docs.**
   - Pipeline `AGENTS.md` and `README.md`: the scan marker, the skip rules, the lanes and the config.
   - `CONTEXT.md`: the glossary words below.
   - ADR 0003, and the change to ADR 0001.

Later, and not in this update:

- Read shares by host key, with update 2.
- `feedWindowInDays` to 30, after item 3 has run for a week.
- The judge, its gates and the repeated-text rule.
- Address normalisation, if a changing address appears again.

### Decisions for the owner

- [ ] The live window: 14 days on each side of the meeting date? The old-meeting check: 30 days?
- [ ] The transient retry: 24 hours? The transient classes: `gateway`, `connection` and `skipped`? Does `status` join them?
- [ ] The feed window: 30 days after item 3 is in?
- [ ] Add `meetingUrl`, `meetingDate` and `committeeTitle` to items now, or wait for the judge spec? To add them now costs nothing, and gives the plan step its join.
- [ ] The pack rule at list time, so a pack is never fetched? Or fetch the pack, and skip it at judge time? The 20 packs checked by hand come first in both cases.
- [ ] Rename `councils.documentsAtOnce` to `councils.meetingsAtOnce` when the read step stops using it?
- [ ] Is ADR 0003 wanted now, or with the docs item?

### Glossary words to add to `CONTEXT.md`

- **Item**: a meeting page or a document that the list step found, named by the hash of its address. Every store is keyed by it.
- **Presence**: an object exists in a store. The only state a step reads.
- **Due**: an item of the step before, with no record in this step's store. For the read step, also no error newer than the item's listing, unless the error is transient and old.
- **Touch**: to write an item again with the same content, so that its last-modified time moves. This is how the list step says "listed again".
- **Lane**: the queue of due items of one host, paced at the host's rate.
- **Share**: exists for OCR. Now also the read step's unit, by host key.
- **Marker**: a record with no content, whose presence is the fact. A scan marker is one.
- **Gate**: a config rule that keeps an item from the judge, with a reason. Later.

The words **Changed council**, **Lost council** (as a flag), **First listing**, **Outcome** and **Event** no longer describe the code. Mark them as old, or remove them.

## Sources

- `apps/pipeline/data/logs/list-2026-10-17T13-41-27Z.log`, `list-2026-10-19T21-49-42Z.log`, `list-2026-10-20T09-22-21Z.log`, `list-2026-10-20T10-45-18Z.log`, `list-2026-10-20T12-28-30Z.log`, `read-2026-10-17T14-08-22Z.log`, `read-2026-10-18T15-02-37Z.log`, `read-2026-10-20T19-09-34Z.log`, `read-2026-10-20T21-41-24Z.log`, `parse-2026-10-21T14-36-12Z.log`, `ocr-2026-10-21T15-19-34Z.log`.
- Code on `parse-as-markdown` (`80e4cad`): `src/domain/buildListStep/`, `readCouncilListings/`, `readModernGovListing/`, `readOwnSiteListing/`, `readCmisListing/`, `readCoinsListing/`, `readDecisionTimeListing/`, `readAmberValleyListing/`, `buildReadStep/`, `readListedItems/`, `buildParseStep/`, `buildOcrStep/`, `buildJudgeStep/`, `runSteps/`; `src/infrastructure/createListStore/`, `createReadStore/`, `createParseStore/`, `createOcrStore/`, `createStoreFiles/`, `createObjectBucket/`, `createModernGovClient/`, `createHttpClient/`, `createPipelineConfig/`; `tools/stores/readRunReport.mjs`; `tools/structure/stepsOwnTheirStores.test.mjs`; `config/development/config.yaml`, `config/production/config.yaml`; `config/sources.yaml` (382 councils: 307 moderngov, 35 cmis, 29 own-site, 4 coins, 3 decision-time, 1 amber-valley, 4 unknown); `README.md`, `AGENTS.md`.
- Parser SDK `v0.8.0`: `src/moderngov/readFeedXml.ts`, `readMeetingXml.ts`, `moderngov.types.ts`.
- `docs/pipeline-redesign-decisions.md`, `docs/pipeline-parse-as-markdown.md`, `docs/pipeline-read-store-schema.md` (describes the `read/v1` shape, now replaced), `docs/adr/0001-stores-in-object-storage-no-database.md`, `docs/adr/0002-one-process-and-one-image-per-step.md`, `docs/read-run-2026-10-15-evening-retrospective.md`, `docs/read-run-2026-10-13-retrospective.md`, `docs/read-run-2026-10-12-big-ticket-items.md`, `docs/CONTEXT.md`.
