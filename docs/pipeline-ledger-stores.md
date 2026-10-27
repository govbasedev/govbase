# Stores with history: run the pipeline again and again, and never lose a fact

Written 28 October 2026. Pipeline at `0f670e6`, parser SDK at `da01731`, Bun 1.4.2. It answers the gaps in `pipeline-daily-rerun-gaps.md` with one design. It keeps ADR 0001 (stores in object storage, no database) and ADR 0002 (one process per step). Nothing here is built.

**The ask**

Run the pipeline often. Never lose data. Add to it. Mark a thing as gone, but never delete it. Keep an audit trail: what was made, added or marked gone, and when. And:

- A) Cast the net wide. List and read events and documents from far back and from many pages, without fear.
- B) Make reading the data very fast.
- C) Build it once. One way to write, one way to read, used by every step.

**Words used in this doc**

- **Object**: one JSON file about one thing, at a fixed key, as today. It is rewritten only when the thing changes, and the new version holds everything the old one held plus the change.
- **Link**: the object that ties one document to one event. It sits beside the event, at `events/data/<eventId>/documents/<documentId>.json`.
- **History**: a list on an event or a link of what happened to it and in which run: `created`, `updated`, `archived`, `unarchived`, and for an event which document comes first. Each entry has a `kind`, so a reader switches on it.
- **Run id**: a name for one run of one step. It starts with the start time, so run ids sort in time order. Example: `20261027T061500Z-k3f9qa`.
- **ETag**: a tag the bucket gives every object and returns in a listing. It changes when the object's bytes change, and only then. Comparing ETags finds changed objects with no GET and no clock.
- **Snapshot**: one file per store that holds a copy of every object in it, with the object's ETag. It is a cache. It can always be built again from the objects.
- **Share run**: one task of a cloud job that does part of a step's work. It writes objects and no snapshot.
- **Content hash**: the SHA-256 of a file's bytes. The same bytes always give the same hash.
- **Validator**: the `ETag` a web server sends with a file. A later request sends it back to ask "has it changed?". `Last-Modified` is the weaker validator, and this design does not use it.

## 1. The design in one page

Today's stores, with four changes.

1. **Documents leave the event.** The event object holds the meeting's own facts and its history, which also names its first document. Each document of a meeting is its own small link object beside the event, with a pointer to the next document. Adding a paper adds one object and rewrites at most the link before it. The event is rewritten for a document only when the first document changes, which is rare.
2. **Every object carries its history.** An object is rewritten only when its thing changes, and the new version holds everything the old one held plus the change. A removed document is not deleted: its link gets an `archived` entry. Nothing is ever lost.
3. **Every object carries its `id`.** It is there so a migration can move an object and still know what it is about. The parse, OCR and join records and the error object also carry the `runId` that last wrote them, so the newer of a record and its error wins. An event, a link and a read record carry their runs in `history` instead.
4. **One snapshot per store, refreshed by ETag.** A step lists the store, sixteen prefixes at once, compares each key's ETag with the one in its snapshot, and GETs only the keys that are new or changed. No step reads the bucket's modified times. No step GETs an object it already has.

Carried over from the redesign:

- **Content is named by its hash and version**, and written once. Parse text is keyed by content hash and SDK version. OCR text by content hash, SDK version, engine version and the count of pages read. An upgrade is a new key, so it flows down with no special code.
- **Runs of one step never overlap.** Decision 2 of the redesign says a step skips a run while the last one is still going, and `runStep.sh` runs a cloud job's share runs and then one single run.
- **The one-writer rule stays.** A step writes only inside its own store, and reads only the stores of earlier steps. `stepsOwnTheirStores.test.mjs` still holds.
- **Rules live in code**, not in config. Config holds knobs.

What this design gives up: an object's old versions. The title a meeting had before a correction is not kept, only the current one. The runs in which a thing was added and removed are kept, in its history.

Picture of the list store and the parse store:

```
list/v3/
  events/data/<eventId>.json                 the meeting: id, source, title, date, url, history
  events/data/<eventId>/documents/<documentId>.json   one link per document: id, title, url, next document, history
  events/errors/<pageId>.json                the last failure of a page, as today
  snapshot/<runId>.json

parse/v4/
  documents/data/<documentId>.json
  documents/errors/<documentId>.json
  documents/text/<documentId>/<contentHash>/<sdkVersion>.md
  documents/images/<documentId>/<contentHash>/<file>.png
  snapshot/<runId>.json
```

## 2. The shapes

Eight shapes. Every object starts with `id`, the thing it is about. The parse, OCR and join records and the error object also carry `runId`, the run that last wrote them, so the newer of a record and its error can be told. An event, a link and a read record carry their runs in `history`. A type sits in angle brackets, a bar separates choices, and `n` is a number. Every field is present. A field with no value is `null`. No object carries a schema version: the folder version does, as today.

Each object below is shown in the same order: its key, the object today, the object after, what changed, and when it is written.

The event, the link and the read record share one history entry. It is a union on `kind`. A meeting or a document is current when the last of its `created`, `archived` and `unarchived` entries is not `archived`. The chain of a meeting starts at the `documentId` of its last `first-document` entry. `fetched` and `checked` belong to the read record. `fetched` carries the hash the bytes had, so a change of the file is in the history. `checked` is only the run. The type, size and ETag live at the top of the read record, to keep the entries small.

```
{ "kind": "created" | "updated" | "archived" | "unarchived", "runId": "<runId>" }
{ "kind": "first-document", "runId": "<runId>", "documentId": "<documentId>" }
{ "kind": "fetched", "runId": "<runId>", "contentHash": "<hash>" }
{ "kind": "checked", "runId": "<runId>" }
```

### 2.1 Event

`list/v3/events/data/<eventId>.json`

Today, `list/v2/events/data/<eventId>.json`:

```
{
  "id": "<eventId>",
  "sourceId": "<id>",
  "title": "<text>",
  "date": "<date text>",
  "url": "<url>",
  "documents": [ { "id": "<id>", "title": "<text>", "url": "<url>" } ]
}
```

After:

```
{
  "id": "<eventId>",
  "sourceId": "<id>",
  "title": "<text>",
  "date": "<date text>",
  "url": "<url>",
  "history": [ <HistoryEntry> ]
}
```

What changed: `documents[]` is gone, and each document is a link object of its own, 2.2. `history` is added.

Written when the meeting is first seen, with a `created` entry. Rewritten only when something happens to the meeting itself, and each time one entry is added: `updated` when `title`, `date` or `url` change, `archived` when the meeting is gone from a page that loaded fine, `unarchived` when it is back, and `first-document` when the first document of the chain is set or changes. The first document is the meeting page, whose id is the hash of `url`, as today. For a source with no meeting page it is the first paper the source lists. A new paper never rewrites the event unless it becomes the first. Nothing at the top of the object changes without an entry that says when.

### 2.2 Link

`list/v3/events/data/<eventId>/documents/<documentId>.json`

Today, one row of the event's `documents[]`:

```
{ "id": "<id>", "title": "<text>", "url": "<url>" }
```

After:

```
{
  "id": "<documentId>",
  "title": "<text>",
  "url": "<url>",
  "nextDocumentId": "<id>" | null,
  "history": [ <HistoryEntry> ]
}
```

What changed: the row becomes an object of its own, beside the event. `nextDocumentId` and `history` are added.

Written when the document is first found, with a `created` entry. Rewritten with one entry added each time: `updated` when `title`, `url` or `nextDocumentId` change, `archived` when the page loaded fine and no longer links it, `unarchived` when it is back after that. The links of a meeting form a chain from the document the event's last `first-document` entry names. An archived link keeps its `nextDocumentId`, so the chain runs through it, and a reader leaves it out. Archiving the first document, or one in the middle, rewrites nothing.

A meeting page and two papers:

```
events/data/<eventId>.json                            history ends: first-document <meetingPageId>
events/data/<eventId>/documents/<meetingPageId>.json  nextDocumentId: <paper1Id>
events/data/<eventId>/documents/<paper1Id>.json       nextDocumentId: <paper2Id>
events/data/<eventId>/documents/<paper2Id>.json       nextDocumentId: null
```

### 2.3 Read record

`read/v3/documents/data/<documentId>.json`, with the bytes at `read/v3/documents/bytes/<documentId>/<contentHash>`.

Today, `read/v2/documents/data/<documentId>`: the bytes only, with the content type on the object. No record is written. The schema has one, never used:

```
{ "id": "<documentId>", "contentHash": "<hash>", "contentType": "<type>" }
```

After:

```
{
  "id": "<documentId>",
  "contentHash": "<hash>",
  "contentType": "<type>",
  "byteCount": n,
  "etag": "<text>" | null,
  "history": [ <HistoryEntry> ]
}
```

What changed: the record is now written. The top holds the current file: its hash, type, size and the ETag for the next request. `history` holds every fetch and check, with the hash on each `fetched` entry, so every hash the file ever had is there with the run that saw it. The bytes move from the record's key to `bytes/<documentId>/<contentHash>`, one object per hash.

Written on the first fetch, with a `fetched` entry. Rewritten on every fetch or check after that: a `fetched` entry when the bytes changed, with the new hash at the top, or a `checked` entry when they were the same, by a 304 or by the same hash.

### 2.4 Parse record

`parse/v4/documents/data/<documentId>.json`, with the text at `parse/v4/documents/text/<documentId>/<contentHash>/<sdkVersion>.md` and the images at `parse/v4/documents/images/<documentId>/<contentHash>/<file>`.

Today, `parse/v3/documents/data/<documentId>.json`, with the text at `documents/text/<documentId>.md`, the images at `documents/images/<documentId>/<file>`, and a started marker `{ "id" }` at `documents/started/<documentId>.json`:

```
{
  "id": "<documentId>",
  "sdkVersion": "<version>",
  "pageCount": n,
  "scanPages": [ n ],
  "leftOut": [ { "languageName": "<text>", "unitCount": n } ],
  "images": [ { "fileName": "<text>", "pageNumber": n, "kind": "page" | "picture", "width": n, "height": n, "byteCount": n } ]
}
```

After:

```
{
  "id": "<documentId>",
  "runId": "<runId>",
  "contentHash": "<hash>",
  "sdkVersion": "<version>",
  "textKey": "documents/text/<documentId>/<contentHash>/<sdkVersion>.md",
  "pageCount": n,
  "scanPages": [ n ],
  "leftOut": [ <as today> ],
  "images": [ <as today> ]
}
```

What changed: added `runId`, `contentHash` and `textKey`. `leftOut` and `images` keep today's shape. The text and images move under the content hash and SDK version, so a re-parse never writes over them. The started marker is gone: the error object is written first instead, 2.7.

Written on the first parse. Rewritten on a re-parse, for a new hash or a new SDK.

### 2.5 OCR record

`ocr/v4/data/<documentId>.json`, with the text at `ocr/v4/text/<documentId>/<contentHash>/<sdkVersion>/<engineVersion>/<pagesReadCount>.md`.

Today, `ocr/v3/data/<documentId>.json`, with the text at `ocr/v3/text/<documentId>.md`:

```
{
  "id": "<documentId>",
  "pagesRead": [ n ],
  "pagesFailed": [ n ],
  "pagesLeft": [ n ],
  "leftOut": [ <as today> ]
}
```

After:

```
{
  "id": "<documentId>",
  "runId": "<runId>",
  "contentHash": "<hash>",
  "sdkVersion": "<version>",
  "engineVersion": "<version>",
  "pagesRead": [ n ],
  "pagesFailed": [ n ],
  "pagesLeft": [ n ],
  "leftOut": [ <as today> ],
  "textKey": "text/<documentId>/<contentHash>/<sdkVersion>/<engineVersion>/<pagesReadCount>.md"
}
```

What changed: added `runId`, `contentHash`, `sdkVersion`, `engineVersion` and `textKey`. The page lists and `leftOut` keep today's shape. The text moves under the hash, the SDK version, the engine version and the count of pages read, so a re-scan never writes over it.

Written on the first scan. Rewritten on a re-scan, for a new hash, SDK, engine or page cap.

### 2.6 Join record

`join/v2/events/data/<eventId>.json`, with the file at `join/v2/events/files/<eventId>/<inputsHash>.md`.

Today, `join/v1/events/data/<eventId>.md`: the file only, written over on each build. No record.

After:

```
{
  "id": "<eventId>",
  "runId": "<runId>",
  "inputsHash": "<hash>",
  "fileKey": "events/files/<eventId>/<inputsHash>.md",
  "textKeys": [ "<key>" ]
}
```

What changed: the record is new. The file moves to `events/files/<eventId>/<inputsHash>.md`, one object per build, so a rebuild never writes over it. `textKeys` are the parse and OCR texts the file was built from, sorted. `inputsHash` is the hash of them plus the listing and the config, section 4.5.

Written on the first build. Rewritten on each rebuild.

### 2.7 Error

`<store>/.../errors/<id>.json`, the same `errors/` keys as today.

Today, three shapes, each written over on the next failure:

```
list and read   { "id": "<id>", "failure": <FailureEntry> }
parse and OCR   { "id": "<id>", "failure": { "failureClass": "<class>", "reason": "<text>" } }
join            { "id": "<id>", "reason": "<text>" }
```

A `FailureEntry` has `url`, `hostKey`, `requestKind`, `failureClass`, `status`, `failedBy`, `browserResult`, `kind` and `reason`.

After:

```
{
  "id": "<id>",
  "runId": "<runId>",
  "class": "<class>",
  "reason": "<text>",
  "url": "<url>" | null,
  "attempt": n,
  "request": <FailureEntry as today> | null
}
```

What changed: one shape for every store. Added `runId`, `attempt` and `url`. `class` is today's `failureClass`, and a row of the retry rule in section 6. `request` keeps today's `FailureEntry` whole for a request failure, and is `null` for a parse, scan or build failure.

Rewritten on each failure, with `attempt` one higher. `attempt` starts at 1 again after a good object. Parse and OCR write this object first, with class `cut-off`, and the data object after the work. The data object wins a tie on `runId`, so a crash in between leaves the error standing.

### 2.8 Snapshot

`<store>/snapshot/<runId>.json`

Today: none. A step lists `data/` and `errors/` of each store it reads, and the read step downloads every event record.

After:

```
{
  "store": "<step>/v<n>",
  "runId": "<runId>",
  "objects": {
    "<key>": { "etag": "<etag>", "object": <the object at that key> }
  }
}
```

What changed: new. One per store. It holds every data and error object of the store, by key, with the ETag the listing gave for that key. Content is not in it. A link or an event is current when the last of its `created`, `archived` and `unarchived` entries is not `archived`. An archived link still takes part in the chain through its `nextDocumentId`. A thing is in a failed state when its error's `runId` is newer than the last run of its data object, which is its `runId` or the last entry of its history, or it has no data object.

Written at the end of a run that changed something.

## 3. Why this shape and not the obvious ones

| Obvious idea | Problem in an S3-style bucket | What this design does instead |
| --- | --- | --- |
| Audit fields as object metadata | A listing does not return custom metadata. To read it you need one HEAD request per object. When an object is written over, its old metadata is gone. | The fields live in the object, and the object carries its history. |
| A soft-delete date written onto the object | Writing a field onto an object writes the whole object again, and the old state is lost. | The same write, but the object keeps its history, so the old state is in it. A document is archived by an entry on its link. |
| Bucket versioning as the audit trail | The rule lives in a bucket setting, which code cannot see and tests cannot check. | The history is a field. Code writes it and a test checks it. |
| One record per event with the documents inside | Adding one document writes the whole record again. A failed page can shrink it. | One link per document. Adding a paper adds one object. A failed page writes nothing. |
| The run id in every key, so nothing is ever written over | The bucket shows runs or versions, not meetings. The listing grows with every version. | Fixed keys, as today. Nothing is lost, because the history is inside. The listing grows only with things. |
| Check if a thing changed by comparing times | Times depend on when a run happened, and the join race in gap B5 shows times can lie. | Compare hashes. Content keys hold the hash. The snapshot compares ETags, which are hashes of the objects. |

## 4. Each step

### 4.1 List

**What it writes.** For each meeting the lister saw: the event object when the meeting is new, and again only when its title, date or url changed, its first document changed, or it was gone and is back, with the matching history entry. A link for each document that is new, changed, gone, or back, with a `created`, `updated`, `archived` or `unarchived` entry added. A document is gone only on positive evidence: the page loaded fine and no longer links it. A page that failed writes nothing for its event and documents, and writes the error object at `events/errors/<pageId>.json`, as today. This closes gap 2, the COINS shrink.

**Event identity.** For own-site sources that split meetings by date, the event id becomes the hash of `sourceId`, meeting date and committee title, not the first document address. The own-site lister already has the committee title from the page. This closes gap 12. The old event and its links stay.

**Casting the net wide.** The lister takes a `scope` per run: `feed` (the feed window, cheap, often), `deep` (every index page the caps reach, by meeting date up to `councils.firstListingInDays`, less often) and `first` (the first time a source is seen). The scope is not stored: nothing reads it, and which scope a run used is in the run log. A wide run can never harm a narrow one, and a narrow run can never shrink a wide one. The schedule outside the code decides when each scope runs. Nothing in the code names a cadence.

### 4.2 Read

**What is due**: a current document in the list snapshot where one holds:

- it has no read record, or
- the last entry of its history is older than `read.recheckInDays`, its event is in the feed window, and it has an `etag`, or
- it is in a failed state and the retry rule says its time has come.

**What it writes.** The bytes to `documents/bytes/<documentId>/<contentHash>`, once per hash, and the read record. A conditional request that gets 304 adds a `checked` entry to the record, with no download. This closes gap 1 at low cost. A failed fetch writes the error object with the document's address in `url`.

**The recheck needs two things that do not exist yet.** The HTTP client must send `If-None-Match` and return a 304 as a result, not a failure. The browser fallback fetches through a real browser, so it does no recheck. A document with no ETag is not rechecked, and a metric counts those, so the size of that hole is known. `Last-Modified` is not used: it is the weaker validator, and one field fewer.

### 4.3 Parse

**What is due**: a document whose read record's `contentHash` is not the hash in its parse record, or whose parse record has another `sdkVersion`, and that is not parked.

**What it writes.** The error object with class `cut-off` first. Then the text at `documents/text/<documentId>/<contentHash>/<sdkVersion>.md`, the images at `documents/images/<documentId>/<contentHash>/<file>`, and the parse record. On a text failure, the error object again with the text failure class.

An SDK upgrade makes every document due again by itself. `parse.redoShare` caps how many redo items a run takes, oldest meeting last, so the cloud job is not flooded. Gap 5 closes.

**Shares.** The share is a filter over the due list, with the rule the step has today: the remainder of the id as a number, divided by the share count, is the share index. Every task reads the whole snapshot. A share run writes objects and no snapshot.

### 4.4 OCR

**What is due**: a document whose parse record has scan pages, and whose OCR record is missing, or names another `contentHash`, `sdkVersion` or `engineVersion`, or has pages left and fewer pages read than `ocr.maxImagePages`. And it is not parked. So raising the cap makes the pages left due, and lowering it does nothing.

The step finds its work from the parse snapshot, never by listing the images. Gap 7's double image listing goes. If an image is missing, the step writes a `bytes-missing` error, so gap 10 closes.

**What it writes.** The `cut-off` error first, then the text at `text/<documentId>/<contentHash>/<sdkVersion>/<engineVersion>/<pagesReadCount>.md` and the OCR record.

**Shares.** A filter over the due list, like parse. The rule is free to change: the split by page count in `pipeline-ocr-efficiency.md` fits, because every task sees the same snapshot.

### 4.5 Join

The join is its own step, after OCR, with its own store `join/v2`. This closes gap 11. Its snapshot is what the viewer and the judge read.

**What is due**: an event whose `inputsHash` is not the `inputsHash` of its join record. `inputsHash` is the hash of the sorted list of keys the file would be built from: the event's current documents in chain order, each document's parse text key, each OCR text key, the config values `coverShare` and `wordsPerRun`, and the SDK version. No times. No race. A change to any input, the listing included, makes the event due. Gap 5's missed changes close.

**Document order.** The join starts at the document the event's last `first-document` entry names and follows `nextDocumentId` through every link, archived ones included, until `null` or an id it has already seen. Archived links are left out of the file. A current document the chain did not reach goes at the end, by title. No pointer mistake loses a document.

**What it writes.** The file at `events/files/<eventId>/<inputsHash>.md` and the join record. A failed build writes the error object.

**Readers outside the chain.** The document viewer reads the list, parse, OCR and join snapshots. Its folder constants in `labelStore.mjs` become the four snapshot prefixes.

## 5. Snapshots and the ETag listing: the fast path

Today a run with nothing new downloads every event record four times and lists every image twice. That is the cost that grows each day (gap 7). The snapshot and one listing replace it.

**How a step starts a run**

1. List `snapshot/` of its own store and of the step before. The last key in each listing is the newest snapshot. Read both.
2. List the `data/` and `errors/` prefixes of both stores, sixteen prefixes at once, `bucket.listsAtOnce`. The listing gives each key with its ETag. A key that is not in the snapshot, or whose ETag differs, is new or changed: GET it. Everything else is already in hand.
3. Work out what is due. Do the work. Write each object with this run's id.
4. If this run wrote an object, or step 2 found one, save `snapshot/<runId>.json`. A run that changed nothing writes nothing. A share run skips this step: the single run after it does it.

Step 2 is done for both stores, in memory. A step saves only its own snapshot.

**Why the ETag and not the time.** The ETag is a hash of the object's bytes. A rewrite with the same bytes gives the same tag, so it costs no GET. A rewrite with new bytes gives a new tag, whenever it happened. A write that lands while a listing is in flight is caught by the next listing, because its tag still differs. No clock is read, and no run can be missed.

**Crash safety.** An object is complete on its own. A run that dies leaves objects and no snapshot. The next run's listing finds their ETags new and picks them up. A parse or scan that died leaves its `cut-off` error standing, and the retry rule counts it. Gap 6 closes without a lock. Gap 9 closes because an object is in the bucket as soon as it is made, not at the end of the run.

**The cost of the listing.** It is the one cost that grows, and it grows only with things, not with runs or versions.

| Store | Keys under `data/` and `errors/` today | After one year | Listing time, sixteen prefixes at once |
| --- | --- | --- | --- |
| list | about 65,000: 7,000 events and 58,000 links | about 450,000 | a few seconds |
| read | about 60,000 | about 400,000 | a few seconds |
| parse | about 60,000 | about 400,000 | a few seconds |
| OCR | about 10,000 | about 70,000 | under a second |
| join | about 7,000 | about 50,000 | under a second |

A listing page holds 1,000 keys and takes about a tenth of a second. The counts assume about 7,500 new documents a week, as the list step sees today.

**Cost of a run with nothing new**

| Today | After |
| --- | --- |
| About 4 reads of every event record ever saved, thousands of GETs, growing daily | 2 snapshot reads and 2 listings, no GETs |
| 2 listings of the images folder, hundreds of thousands of keys | None |
| Every listed event saved again, about 7,000 PUTs in development | Nothing |

**Size estimates.** A link is about 300 bytes and an event about 400, so the list snapshot is about 20 MB at today's size. A document record is about 400 bytes, so the read and parse snapshots are about 25 MB each. These are estimates from the schemas, not measurements. At ten times today's size the list snapshot is about 200 MB. If one file is then too slow, split it by the first hex character of the id, as a new store version.

**Rebuild.** A tool lists every key under `data/` and `errors/`, GETs them all, and writes a snapshot. It is the proof that the snapshot is a cache.

**Retention.** A rule may expire snapshots older than `snapshot.keepInDays`. That is the only deletion in the system, and it deletes only a cache. Objects and content are never deleted.

## 6. Failures and retries: the rule is code

The rule lives in one function, `readNextTry`, in the domain code, and every step calls it. Config holds no retry table, so the rule cannot drift from the code that applies it.

The rule: a failure of a class is tried again after a wait that doubles each time, up to a number of tries for that class. The wait starts at the failed run's start time, which is in the error object's `runId`. Past the last try, the thing is parked. An `out-of-memory` failure is taken only by the heavy cloud job's share filter.

| Class | Tries | First wait | Then |
| --- | --- | --- | --- |
| `gateway` | 8 | 1 hour | doubles |
| `bytes-missing` | 3 | 1 hour | doubles |
| `blocked` | 5 | 12 hours | doubles |
| `gone` | 3 | 1 day | doubles |
| `cut-off` | 2 | 1 day | the same |
| `out-of-memory` | 2 | 1 day | the same |
| `restricted` | 1 | none | parked |

Nothing is parked for ever by code: a release that raises a number makes the parked things of that class due again. `clear:parked` goes away. A metric counts parked things by class and step. Gaps 3 and 4 close.

## 7. The audit trail: the questions it answers

| Question | How |
| --- | --- |
| When did we first see document D in meeting M? | D's link: the `created` entry in its history. One GET. |
| What happened to D, in order? | D's link history, then D's read record history, which has every fetch and check with its run, then the `runId` on its parse and OCR records. |
| Did the council change the file? | D's read record: two `fetched` entries with different hashes. |
| Did we check D lately and find it the same? | D's read record: the last `checked` entry. Every check is kept. |
| Why is D marked gone? | D's link: the last `archived` entry names the run. That run's log has the page that no longer linked it. |
| What did meeting file M get built from? | The join record's `textKeys`. |
| What changed since Tuesday? | Snapshots are kept. Compare Tuesday's with the newest: every key whose ETag differs changed. |
| Was the old text used after an SDK upgrade? | Impossible by construction. The text key holds the SDK version. |

Every answer is a GET in the bucket console, or a tool over two snapshots.

## 8. Built once

| Thing | Built once in | Used by |
| --- | --- | --- |
| The run id | `createRunContext` | every step |
| Listing with ETags, sixteen prefixes at once | `ObjectBucket.readObjectEntries` | `createStoreSnapshot` |
| Find the newest snapshots, read them, list and diff by ETag, GET the changes, save the snapshot | `createStoreSnapshot` | every step |
| The `id` and `runId` fields, the error object and the snapshot shape | `createStoreSnapshot.schema.ts` | every step |
| The retry rule | `readNextTry` | read, parse, OCR, join |
| Share filter | `readIsOwnShare` | parse, OCR |
| Content keys by hash and version | `buildContentKey` | read, parse, OCR, join |
| Inputs hash for a derived file | `hashInputs(keys)` | join; later judge |
| Rebuild a snapshot, compare two snapshots | `tools/stores/` | people |

Each step keeps three things of its own: its object shapes, what it writes, and its due rule. Everything else is shared.

**Tests.** Each due rule is tested with a table: a snapshot in, the due list out. Each store's write rule is tested with a table: the old object and what the run saw in, the new object out. One property test runs for every store: the snapshot after a run equals a GET of every key under `data/` and `errors/`.

**Config.** Five values, all knobs and no rules: `read.recheckInDays`, `parse.redoShare`, `councils.firstListingInDays`, `snapshot.keepInDays` and `bucket.listsAtOnce`. The scope of a list run comes in the same way `run.steps` does.

## 9. How the gaps close

| # | Gap | Closed by |
| --- | --- | --- |
| 1 | Changed council file never seen | Content hash in the read record, and a conditional recheck. A new hash makes parse, OCR and join due. |
| 2 | Partial COINS listing shrinks the event | One link per document. A failed page writes nothing. A removal needs positive evidence. |
| 3 | Parse and OCR failures parked for ever | The retry rule and `attempt` on the error object. |
| 4 | Read failures tried every day, then dropped silently | The retry rule, and a parked metric. |
| 5 | Upgrades do not flow down | Versions in the content keys. Inputs hash on the join. |
| 6 | No lock, crash parks work | A `cut-off` error written first, counted by the retry rule, with a limit. |
| 7 | Cost grows each day | Snapshots, and one ETag listing in place of GETs. |
| 8 | Coverage holes | Listing scopes. A deep run can only add links and histories. |
| 9 | List saves all or nothing | An object is in the bucket as soon as it is made. |
| 10 | Images with no parse record | Work comes from the parse snapshot, and a `bytes-missing` error. |
| 11 | Join before OCR | Join is its own step after OCR. |
| 12 | Own-site meeting gets a new id | Event id from source, date and committee. |

## 10. Order of work

Each item stands on its own and is a run's worth of checking.

1. `ObjectBucket.readObjectEntries` with ETags over sixteen prefixes at once. `createRunContext`. `createStoreSnapshot` with the ETag diff, the `id` and `runId` fields, the error object, the snapshot, `readNextTry`, and the rebuild tool. The property test. No step uses it yet.
2. Conditional requests in the HTTP client: send `If-None-Match`, return 304 as a result.
3. List on `list/v3` and read on `read/v3` together, so listings keep flowing: events and links with history and the chain, scopes, the new own-site event id; bytes by hash and read records. A migration tool copies the old read store's bytes under each document by hash and writes one read record per document under run id `20261101T000000Z-migrate`. No content hash is stored today, and a bucket listing gives an ETag, not a SHA-256, so the tool must download every blob once. Run it as a Cloud Run job in the bucket's region, where reads from the bucket have no network charge. Old folders stay.
4. Parse on `parse/v4` and OCR on `ocr/v4`: content under the document by hash and version, `cut-off` first, work from snapshots. The same migration tool writes parse and OCR records for what exists, with the SDK version each record saved.
5. Join as its own step on `join/v2`, with the inputs hash and the file under `files/`.
6. Point the viewer at the snapshots.
7. The snapshot retention rule.

## 11. Not decided, and not confirmed

1. The sizes in section 5 are estimates from the schemas and from the list step's counts. Build step 1, build the development list snapshot once, and time one listing of `events/data/`.
2. That Google Cloud Storage returns the ETag in an S3-style listing, and that Bun's client passes it through. The type in Bun 1.4.2 has the field. One call against the development bucket confirms it.
3. How many councils send an `ETag` with a document. The read step can log the headers for one run. This sets how much of gap 1 the recheck really closes. A document with only `Last-Modified` is not rechecked in this design. If the log shows many, add `lastModified` to the `fetched` entry.
4. Which own-site sources split by date, and so which events change id. The migration tool reports it.
5. The size of the old read store in bytes, which sets the time of the migration job.
6. Bytes and text under the document, not under a shared hash folder, means the same file at two addresses is stored and parsed twice. That is today's behaviour. It keeps everything about a document in one place. Measure how often it happens before deciding it matters.
7. The retry numbers are constants in domain code. The house-style rule `value-lives-in-config` fails on a number the code chose, so they need adding to `allowedNumbers`, which is the owner's permission to give.
8. Whether to guard the no-overlap rule in code. The schedule may be guard enough.
9. Nothing here was run. The first safe test is step 1 with the property test and the rebuild tool. Then step 3 on the development bucket, run twice: the second run writes no object and no snapshot.
