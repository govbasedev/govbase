# Ledger stores: run the pipeline again and again, and never lose a fact

Written 27 October 2026. Pipeline at `0f670e6`, parser SDK at `da01731`, Bun 1.4.2. It answers the gaps in `pipeline-daily-rerun-gaps.md` with one design. It keeps ADR 0001 (stores in object storage, no database) and ADR 0002 (one process per step). Nothing here is built.

**The ask**

Run the pipeline often. Never overwrite data. Add to it. Mark a thing as gone, but never delete it. Keep an audit trail: what was made, added or marked gone, and when. And:

- A) Cast the net wide. List and read events and documents from far back and from many pages, without fear.
- B) Make reading the data very fast.
- C) Build it once. One way to write, one way to read, used by every step.

**Words used in this doc**

- **Fact**: one small JSON object that says one thing happened, such as "run R saw meeting M with these papers". A fact is written once and never changed.
- **Run id**: a name for one run of one step. It starts with the start time, so run ids sort in time order. Example: `20261027T061500Z-k3f9qa`.
- **Run chunk**: one file that holds the facts one run wrote, in order, a few hundred at a time.
- **Ledger**: every run chunk of one store. It is the whole history of that store.
- **Fold**: to read the facts of one thing in time order and work out its current state. A fold is a pure function: same facts in, same state out.
- **History**: the list on each folded thing of the facts that made it: run id, fact kind, and the chunk that holds the fact.
- **Snapshot**: the folded state of every thing in a store, saved as one file or a few. It is a cache. It can always be built again from the ledger.
- **Head**: one tiny file per store that names the newest snapshot and the runs folded into it. It is the only object a step writes over.
- **Content hash**: the SHA-256 of a file's bytes. The same bytes always give the same hash.
- **Tombstone**: a fact that says a thing is gone. It hides the thing. It removes nothing.
- **Validator**: a header a web server sends with a file, `ETag` or `Last-Modified`. A later request sends it back to ask "has it changed?".
- **Delimiter**: a listing option that groups keys by one character. A listing of `runs/` with the delimiter `/` returns one entry per run, not every file.
- **Shard**: one slice of a snapshot, picked by the first hex characters of the thing's id. A snapshot starts as one shard.

## 1. The design in one page

Three kinds of object, plus two tiny markers.

| Kind | What it is | Written how | Example key |
| --- | --- | --- | --- |
| Run chunk | The facts one run wrote, in order | Once. The run id is in the key, so two runs can never write the same key. | `list/v3/runs/<runId>/0001.json` |
| Content | Bytes, text and images, named by what they are | Once. The key is the content hash, so the same bytes are never saved twice. | `read/v3/blobs/<contentHash>` |
| Snapshot | The current state of every thing, folded from the facts | A new one each run, named by run id. The head points at it. | `list/v3/snapshot/<runId>/all.json` |
| Done marker | Says a run finished, and how many chunks it wrote | Once, as the last write of a run. | `list/v3/runs/<runId>.done` |
| Head | Names the newest snapshot and the runs folded into it | Written over. The only object that is. | `list/v3/snapshot/HEAD.json` |

Rules:

1. **A fact is never overwritten.** It lives in a run chunk, and the run id is in the chunk key. A change is a new fact. A removal is a tombstone fact. The audit trail is the ledger, and each folded thing carries its history, so one read answers "what happened to this, in order".
2. **Content is named by its hash.** A changed council file gets a new hash, so it is new content. Parse text is keyed by content hash and SDK version. OCR text is keyed by content hash, SDK version, engine version and pages read. An upgrade is a new key, so it flows down with no special code.
3. **No step reads the bucket's last-modified time, and no step lists a big folder.** A step reads the snapshot of the step before it, its own snapshot, and one listing of the run folders. The snapshot is the only thing that must be fast, so it is the only thing tuned for speed.
4. **Nothing in the bucket is compressed.** Every chunk, snapshot and fact is plain JSON, and every text is plain markdown, so a person can read any object as it is, with one fetch.
5. **One maker builds every store.** `createLedgerStore` gives each step `appendFact`, `readSnapshot` and `saveSnapshot`, and runs the fold. A step adds only its fact body schema, its reducer and its due rule.
6. **The one-writer rule stays.** A step writes only inside its own store, and reads only the stores of earlier steps. `stepsOwnTheirStores.test.mjs` still holds.

Picture of one store:

```
parse/v4/
  runs/<runId>/0001.json           the ledger: the facts the run wrote, in order
  runs/<runId>/attempted/<id>.json    one fact written at once, before each parse
  runs/<runId>.done                   { chunkCount, attemptedCount, finishedAtUnixMs }
  text/<contentHash>/<sdkVersion>.md  content
  images/<contentHash>/<file>.png     content
  snapshot/<runId>/all.json        the folded state, one shard to start
  snapshot/HEAD.json                  { runId, shardCount, shards, foldedRuns }
```

## 2. The shapes

Every file and every fact in this design has one of the shapes below. They are written as JSON. A type sits in angle brackets, a choice has a bar between the options, and `n` is a number. Every field is present in every object. A field with no value is `null`. `createLedgerStore.schema.ts` holds the shared shapes. Each step's `.schema.ts` holds its own fact bodies and its folded state.

### 2.1 Files

**A chunk**, `runs/<runId>/<nnnn>.json`. One JSON object. The facts are in the order the run wrote them. `<nnnn>` is a four-digit counter that starts at `0001` and is the same number as `chunkIndex`. The zeros on the front keep a listing in write order.

```
{
  "schemaVersion": 1,
  "runId": "<runId>",
  "chunkIndex": n,
  "facts": [ <Fact> ]
}
```

**An `attempted` object**, `runs/<runId>/attempted/<subjectId>.json`. One `<Fact>` with `factKind` `attempted`, written before the work starts.

**A done marker**, `runs/<runId>.done`. The last write of a run.

```
{
  "schemaVersion": 1,
  "runId": "<runId>",
  "chunkCount": n,
  "attemptedCount": n,
  "factCount": n,
  "finishedAtUnixMs": n
}
```

**A head**, `snapshot/HEAD.json`. `shards` maps each shard to the run id whose folder holds its newest file, so the head is the manifest from the first day. With one shard the map has one entry, `all`. `foldedRuns` says how much of each run the snapshot holds.

```
{
  "schemaVersion": 1,
  "runId": "<runId>",
  "shardCount": n,
  "shards": { "all" | "<hex prefix>": "<runId>" },
  "foldedRuns": { "<runId>": { "chunkCount": n, "attemptedCount": n } }
}
```

**A snapshot shard**, `snapshot/<runId>/<shard>.json`. One JSON object. `things` is keyed by subject kind, then by id. The subject kinds of a store are the things its fold produces: `source` and `event` in list, `document` in read, parse and OCR, `event` in join.

```
{
  "schemaVersion": 1,
  "store": "<step>/v<n>",
  "runId": "<runId>",
  "shard": "all" | "<hex prefix>",
  "things": {
    "<subject kind>": { "<id>": <FoldedThing> }
  }
}
```

**A folded thing.** The envelope is the same in every store. `state` is what the step's reducer makes, section 2.4. `history` is in observation order, oldest first.

```
{
  "id": "<id>",
  "kind": "source" | "event" | "document",
  "history": [
    {
      "runId": "<runId>",
      "factKind": "<factKind>",
      "observedAtUnixMs": n,
      "chunkKey": "runs/<runId>/<nnnn>.json" | "runs/<runId>/attempted/<id>.json",
      "factIndex": n | null
    }
  ],
  "state": <State for the store, section 2.4>
}
```

### 2.2 The fact envelope

One schema, `FactSchema`, in `createLedgerStore.schema.ts`. Every step's fact uses it. A step adds only its `body` schema.

```
{
  "schemaVersion": 1,
  "factKind": "listed" | "seen" | "withdrawn" | "checked" | "read" | "attempted" | "parsed" | "scanned" | "joined" | "failed",
  "subject": { "kind": "source" | "event" | "document", "id": "<id>" },
  "runId": "20261027T061500Z-k3f9qa",
  "observedAtUnixMs": 1793000000000,
  "writer": { "step": "parse", "codeVersion": "0f670e6", "sdkVersion": "0.9.0" },
  "basedOn": [{ "store": "read/v3", "runId": "20261026T061500Z-p2x1mm", "subject": { "kind": "document", "id": "<id>" } }],
  "body": { ... }
}
```

- `factKind` says what happened. The audit trail reads straight off it: `listed` is created or changed, `seen` is listed again with no change, `read`, `parsed` and `scanned` are added, `withdrawn` is marked gone.
- `basedOn` names the facts and content this fact was made from. This is the chain of custody: the record of where each thing came from. From any meeting file you can walk back to the bytes and the listing that made it. A tool finds a named fact through the subject's history in that store's snapshot.
- `observedAtUnixMs` is when the step saw the thing: the time the page loaded, the file arrived or the parse ended. The audit trail needs a time, so a fact carries one. No step uses it to decide work. Work is decided by presence and by hash.
- No field is optional. A field with no value is `null`.

**Fact order.** The fold sorts facts by `observedAtUnixMs`, then run id, then place in the chunk. Run id alone is wrong: a deep run that started at 06:00 can load a page at 08:30, while a feed run that started at 08:00 loaded the same page at 08:10. The page at 08:30 is the truth. A reducer keeps, for each field that the newest fact decides, the observation time of the fact that set it, so a fact folded late never replaces a newer one.

The run id is made once per process by `createRunContext`, and every store gets it from there.

### 2.3 Fact bodies

The subject of a fact is always the thing its fold produces. In the list store a document is part of its event, so a fact about a document names the event as its subject and the document in its body.

**List, subject `event`**

`listed`, when the event is new or this body differs from the newest `listed` fact:

```
{
  "sourceId": "<id>",
  "title": "<text>",
  "date": "<date text as today>",
  "url": "<url>",
  "documents": [ { "id": "<id>", "title": "<text>", "url": "<url>" } ],
  "scope": "feed" | "deep" | "first",
  "pageResults": [ { "url": "<url>", "outcome": "ok" | "failed" } ]
}
```

`seen`, when the event was listed again and nothing changed:

```
{ "scope": "feed" | "deep" | "first" }
```

`withdrawn`, for one document, or for the whole event when `documentId` is `null`:

```
{
  "documentId": "<id>" | null,
  "reason": "unlinked" | "by-hand",
  "pageUrl": "<url>" | null
}
```

**List, subject `source`**

`listed`, one per source per run. The failures of the run live here. The list store writes no `failed` facts.

```
{
  "scope": "feed" | "deep" | "first",
  "pagesOpened": n,
  "eventsSeen": n,
  "failures": [
    { "url": "<url>", "requestKind": "feed" | "service" | "document", "failure": <FailureEntry as today> }
  ]
}
```

**Read, subject `document`**

`read`:

```
{
  "contentHash": "<hash>",
  "contentType": "<type>",
  "byteCount": n,
  "etag": "<text>" | null,
  "lastModified": "<text>" | null,
  "hasValidator": true | false,
  "outcome": "new" | "same" | "changed",
  "blobKey": "read/v3/blobs/<contentHash>"
}
```

`checked`, after a 304:

```
{ "etag": "<text>" | null, "lastModified": "<text>" | null }
```

**Parse, subject `document`**

`parsed`:

```
{
  "contentHash": "<hash>",
  "sdkVersion": "<version>",
  "textKey": "parse/v4/text/<contentHash>/<sdkVersion>.md",
  "pageCount": n,
  "scanPages": [ n ],
  "leftOut": <as in the parse record today>,
  "images": [ "<file name>" ]
}
```

**OCR, subject `document`**

`scanned`:

```
{
  "contentHash": "<hash>",
  "sdkVersion": "<version>",
  "engineVersion": "<version>",
  "pagesRead": n,
  "pagesLeft": n,
  "pagesFailed": n,
  "textKey": "ocr/v4/text/<contentHash>/<sdkVersion>/<engineVersion>/<pagesRead>.md"
}
```

**Join, subject `event`**

`joined`:

```
{
  "inputsHash": "<hash>",
  "fileKey": "join/v2/events/<eventId>/<inputsHash>.md",
  "parts": [ { "documentId": "<id>", "place": "<PartPlace from the SDK>" } ]
}
```

**Shared by more than one step**

`attempted`, parse and OCR, written before the work. `engineVersion` is `null` in parse.

```
{ "contentHash": "<hash>", "sdkVersion": "<version>", "engineVersion": "<version>" | null }
```

`failed`, read, parse, OCR and join. `class` is a row of the retry table in section 6. `status` is the HTTP status when there was one. `contentHash` is `null` in join.

```
{
  "class": "<class>",
  "reason": "<text>",
  "status": n | null,
  "contentHash": "<hash>" | null
}
```

### 2.4 Folded states

The `state` of a folded thing, per store. A list is in observation order, newest last. A field that the newest fact decides sits next to the observation time of the fact that set it, so a fact folded late never replaces a newer one.

**List, `source`**

```
{
  "lastRunId": "<runId>",
  "lastScope": "feed" | "deep" | "first",
  "lastPagesOpened": n,
  "lastEventsSeen": n,
  "lastFailures": [ <failure as in the source body> ]
}
```

**List, `event`**

```
{
  "sourceId": "<id>",
  "title": "<text>",
  "date": "<date text>",
  "url": "<url>",
  "detailObservedAtUnixMs": n,
  "firstSeenRunId": "<runId>",
  "lastSeenRunId": "<runId>",
  "lastScope": "feed" | "deep" | "first",
  "withdrawn": null | <Withdrawn>,
  "documents": [
    {
      "id": "<id>",
      "title": "<text>",
      "url": "<url>",
      "firstSeenRunId": "<runId>",
      "lastSeenRunId": "<runId>",
      "withdrawn": null | <Withdrawn>
    }
  ]
}
```

`<Withdrawn>`:

```
{ "runId": "<runId>", "observedAtUnixMs": n, "reason": "unlinked" | "by-hand", "pageUrl": "<url>" | null }
```

**Attempts**, the output of `foldAttempts`. It sits in the states below as `attempts`.

```
{
  "sinceGoodCount": n,
  "lastClass": "<class>" | null,
  "lastAtUnixMs": n | null,
  "dueAfterUnixMs": n | null,
  "parkedClass": "<class>" | null,
  "lane": "heavy" | null
}
```

**Read, `document`**

```
{
  "currentContentHash": "<hash>" | null,
  "contentHashes": [
    { "contentHash": "<hash>", "contentType": "<type>", "byteCount": n, "firstSeenRunId": "<runId>" }
  ],
  "hasValidator": true | false | null,
  "etag": "<text>" | null,
  "lastModified": "<text>" | null,
  "lastReadAtUnixMs": n | null,
  "lastCheckedAtUnixMs": n | null,
  "attempts": <Attempts>
}
```

**Parse, `document`**

```
{
  "parsed": [
    { "contentHash": "<hash>", "sdkVersion": "<version>", "textKey": "<key>", "pageCount": n, "scanPages": [ n ], "images": [ "<file name>" ], "runId": "<runId>" }
  ],
  "attempts": <Attempts>
}
```

**OCR, `document`**

```
{
  "scanned": [
    { "contentHash": "<hash>", "sdkVersion": "<version>", "engineVersion": "<version>", "pagesRead": n, "pagesLeft": n, "pagesFailed": n, "textKey": "<key>", "runId": "<runId>" }
  ],
  "attempts": <Attempts>
}
```

**Join, `event`**

```
{
  "joined": [ { "inputsHash": "<hash>", "fileKey": "<key>", "runId": "<runId>" } ],
  "attempts": <Attempts>
}
```

### 2.5 Catalog files

`<CatalogEvent>`, one event as a reader outside the chain sees it:

```
{
  "id": "<id>",
  "sourceId": "<id>",
  "title": "<text>",
  "date": "<date text>",
  "url": "<url>",
  "withdrawn": true | false,
  "fileKey": "join/v2/events/<eventId>/<inputsHash>.md" | null,
  "documents": [
    {
      "id": "<id>",
      "title": "<text>",
      "url": "<url>",
      "withdrawn": true | false,
      "contentHash": "<hash>" | null,
      "textKey": "<parse text key>" | null,
      "ocrTextKey": "<OCR text key>" | null,
      "parkedClass": "<class>" | null
    }
  ]
}
```

`by-source/<sourceId>.json` and `by-date/<yyyy-mm>.json`. One of `sourceId` and `month` is set.

```
{
  "schemaVersion": 1,
  "runId": "<runId>",
  "sourceId": "<id>" | null,
  "month": "<yyyy-mm>" | null,
  "events": [ <CatalogEvent> ]
}
```

`changes/<runId>.json`:

```
{
  "schemaVersion": 1,
  "runId": "<runId>",
  "sinceRunId": "<runId>" | null,
  "events": { "new": [ "<id>" ], "changed": [ "<id>" ], "withdrawn": [ "<id>" ] },
  "documents": { "new": [ "<id>" ], "newText": [ "<id>" ], "newOcrText": [ "<id>" ], "withdrawn": [ "<id>" ] },
  "files": [ { "eventId": "<id>", "fileKey": "<key>" } ]
}
```

The catalog's `snapshot/HEAD.json`. It names every file, so a reader never lists the bucket.

```
{
  "schemaVersion": 1,
  "runId": "<runId>",
  "sourceIds": [ "<id>" ],
  "months": [ "<yyyy-mm>" ],
  "changesRunIds": [ "<runId>" ]
}
```

## 3. Why this shape and not the obvious ones

| Obvious idea | Problem in an S3-style bucket | What this design does instead |
| --- | --- | --- |
| Audit fields as object metadata | A listing does not return custom metadata. To read it you need one HEAD request per object. When an object is written over, its old metadata is gone. | The audit fields live inside the fact. The folded thing carries its history. |
| A soft-delete date written onto the object | Writing a field onto an object writes the whole object again. That is an overwrite, and the old state is lost. | A tombstone fact. The old facts stay. The fold hides the thing from that time on. A later listing can bring it back, and that is a fact too. |
| Append to an existing object | S3 has no append. Each append is a full rewrite, and two writers can clash. | A new chunk per few hundred facts. Two writers cannot clash, because the run id is in the key. |
| Check if a thing changed by comparing times | Times depend on when a run happened, and the join race in gap B5 shows times can lie. | Compare hashes. A thing is due when the hash of its inputs is not the hash its last output was built from. |
| One object per fact, so a folder listing shows a thing's history | One PUT per fact. A list run writes one per event it sees, about 7,000 in development, the same count as today. The fold never reads them. | The chunk is the ledger. The folded thing carries its history. One GET answers the audit question, and a run writes tens of chunks, not thousands of objects. |
| 256 shards from the first day | A run that touches a few shards needs a manifest for the rest, and a run start reads up to 512 files. | One file per store, about 40 MB at today's size. The head maps each shard to the run that last wrote it from the first day, so sharding later is a config change. |

## 4. Each step

### 4.1 List

**Facts it writes**

- `listed`, subject `event`. Body: `sourceId`, `title`, `date`, `url`, `documents` as today, plus `scope` and `pageResults`: for each page the lister opened for this event, its address and `ok` or `failed`. Written when the event is new, or when this body differs from the newest `listed` fact in the fold.
- `seen`, subject `event`. Body: `scope`. Written when the event was listed again and nothing changed. It is about a hundred bytes.
- `listed`, subject `source`. Body: `scope`, `pagesOpened`, `eventsSeen`, `failures`. One per source per run. A source's facts are in a chunk as soon as it is listed, so a crash loses only what is in the open chunk, not the whole listing.
- `withdrawn`, subject `event`, with the document id in the body, or `null` for the whole event. Written only on positive evidence: the page that listed the thing loaded fine and no longer links it. A failed page never makes a tombstone. A person can add one with a tool, with `reason: by-hand`.
- No `failed` facts. A page that failed is in the `failures` list of the source's `listed` fact, with the failure entry as today.

**The fold** for an event:

- `documents` is the union of every document ever listed for the event. Each carries `firstSeenRunId`, `lastSeenRunId` and `withdrawn`: `null`, or the tombstone's run id and reason. A document that a later `listed` fact names again has `withdrawn: null` once more.
- `title`, `date` and `url` come from the `listed` fact with the newest observation time.
- A `listed` fact with a failed page adds what it saw and removes nothing. This closes gap 2, the COINS shrink.
- `history` holds every fact's run id, kind and chunk key.

**Event identity.** For own-site sources that split meetings by date, the event id becomes the hash of `sourceId`, meeting date and committee title, not the first document address. The own-site lister already has the committee title from the page. This closes gap 12. The fold still works if a source changes its rule, because the old event's facts stay.

**Casting the net wide.** The lister takes a `scope` from config per run: `feed` (the feed window, cheap, often), `deep` (every index page the caps reach, by meeting date up to `councils.firstListingInDays`, less often) and `first` (the first time a source is seen). The scope is a field on the fact. The fold does not care which scope saw a document. A wide run can never harm a narrow one, and a narrow run can never shrink a wide one. The schedule outside the code decides when each scope runs. Nothing in the code names a cadence.

### 4.2 Read

**What is due**: a document in the list snapshot that is not withdrawn, where one holds:

- it has no `read` fact, or
- its newest `read` or `checked` fact is older than `read.recheckInDays`, its event is in the feed window, and its `read` fact says it has a validator, or
- its newest fact is `failed` and the retry policy (section 6) says it is due.

**Facts it writes**

- `read`, body: `contentHash`, `contentType`, `byteCount`, `etag`, `lastModified`, `hasValidator`, `outcome: new | same | changed`. The bytes go to `read/v3/blobs/<contentHash>`. The step always writes the blob: the same bytes go to the same key, so a second write changes nothing. Measure duplicate writes before building an index to skip them.
- `checked`, body: `etag`, `lastModified`. Written when a conditional request returned 304. One header exchange, no download, and an audit entry that says "we looked on this day and it was the same". This closes gap 1 at low cost.
- `failed`, as today.

**The recheck needs two things that do not exist yet.** The HTTP client must send `If-None-Match` and `If-Modified-Since` and return a 304 as a result, not a failure. The browser fallback fetches through a real browser, so it does no recheck. A document with no validator is not rechecked. The `read` fact records `hasValidator`, and a metric counts documents without one, so the size of that hole is known.

**The fold** for a document gives `currentContentHash`, `contentHashes` (every hash ever seen, with the run id that first saw it), `hasValidator` and `attempts`, which holds `dueAfterUnixMs`. The shape is in section 2.4.

### 4.3 Parse

**What is due**: a document whose `currentContentHash` has no `parsed` fact with the current `sdkVersion`, and is not parked (section 6).

**Facts it writes**

- `attempted`, before the read. It is the one fact that is not put in a chunk. It is written at once as its own object, `runs/<runId>/attempted/<documentId>.json`, because it must survive the crash it guards against. It replaces the started marker, and it is never removed.
- `parsed`, body: `contentHash`, `sdkVersion`, `textKey`, `pageCount`, `scanPages`, `leftOut`, `images`. Text at `parse/v4/text/<contentHash>/<sdkVersion>.md`. Images at `parse/v4/images/<contentHash>/<file>`.
- `failed`, with the text failure class.

An SDK upgrade makes every document due again by itself. The config decides how fast: `parse.redoShare` caps how many redo items a run takes, oldest meeting last, so the cloud job is not flooded. Gap 5 closes.

**Shares.** The share is a filter over the due list after the fold, with the rule the step has today: the remainder of the id as a number, divided by the share count, is the share index. Every task reads the whole snapshot. At today's size that is tens of megabytes, which is small next to the work.

### 4.4 OCR

**What is due**: a document whose current `parsed` fact has scan pages, and has no `scanned` fact for the same `contentHash`, `sdkVersion` and `engineVersion`, or whose newest such fact has `pagesLeft` over zero and `pagesRead` under `ocr.maxImagePages`. And it is not parked. So raising the cap makes the pages left due, and lowering it does nothing.

The step finds its work from the parse snapshot, never by listing the images folder. Gap 7's double image listing goes. A missing parse record cannot happen, because the parse fact and its images are written before the snapshot names them. If an image is missing, the step writes a `failed` fact with `bytes-missing`, so gap 10 closes.

**Facts it writes**

- `attempted`, written at once like the parse step's. A scan that kills the task is counted, and parked after `attemptLimit` tries.
- `scanned`, body: `contentHash`, `sdkVersion`, `engineVersion`, `pagesRead`, `pagesLeft`, `pagesFailed`, `textKey`. Text at `ocr/v4/text/<contentHash>/<sdkVersion>/<engineVersion>/<pagesRead>.md`, so a read with a higher cap is a new object and the old text stays.
- `failed`, with the class.

**Shares.** A filter over the due list, like parse. The rule is free to change: the split by page count in `pipeline-ocr-efficiency.md` fits, because every task sees the same snapshot.

### 4.5 Join

The join is its own step, after OCR, with its own store `join/v2`. This closes gap 11. Its store is read by `catalog` and later by `judge`.

**What is due**: an event whose `inputsHash` is not the `inputsHash` of its newest `joined` fact. `inputsHash` is the hash of the sorted list of keys the file would be built from: the event's folded listing with each document's `withdrawn` state, each document's current parse text key, each OCR text key, the config values `coverShare` and `wordsPerRun`, and the SDK version. No times. No race. A change to any input, the listing included, makes the event due. Gap 5's missed changes close.

Writes `join/v2/events/<eventId>/<inputsHash>.md` and a `joined` fact with `inputsHash` and `basedOn`. The old file stays, so a judgment that cites it still points at what it judged.

A failed build writes a `failed` fact, and the retry policy limits it.

### 4.6 Catalog

A new step, after join and before judge. It reads every snapshot and writes one store, `catalog/v1`, for readers outside the chain: the document viewer, the judge, retrospective tools and Grafana. It is the one place a reader goes.

- `catalog/v1/snapshot/<runId>/by-source/<sourceId>.json`: the events of one council, with their documents and the keys of their current text and meeting file.
- `catalog/v1/snapshot/<runId>/by-date/<yyyy-mm>.json`: the same, by meeting month.
- `catalog/v1/changes/<runId>.json`: what changed since the last catalog run: new events, new documents, new text, new meeting files, tombstones. A reader that wants to stay current reads only this.
- `catalog/v1/snapshot/HEAD.json`.

The viewer's folder constants in `labelStore.mjs` become one: the catalog head.

## 5. Snapshots: the fast path

Today a run with nothing new downloads every event record four times and lists every image twice. That is the cost that grows each day (gap 7). The snapshot removes it.

**How a step starts a run**

1. Read `HEAD.json` of its own store and of the step before. Two small reads.
2. Read the snapshot files both heads name. One file per store to start.
3. List the `runs/` prefix of both stores with the delimiter. One call returns every run folder and every done marker. A run is settled when it has a done marker, or when its start time is more than `snapshot.longestRunInHours` ago. For each settled run that `foldedRuns` does not name, or names with fewer chunks or `attempted` objects than its done marker counts: list its folder, read the chunks not yet folded and its `attempted` objects, and fold them in. A run that is not settled is still running. Leave it for the next run. The step does this for both stores, and saves the result only for its own. The other store's head is its owner's to write.
4. Work out what is due. Do the work. Append facts. Write a chunk every `snapshot.chunkSize` facts, and when `snapshot.chunkWaitInSeconds` passes with facts waiting. Write the done marker last.
5. Fold this run's facts. Save the snapshot under the run id. Write `HEAD.json`: `foldedRuns` is the old map, plus the runs folded in step 3, plus this run.

**Two runs at once.** Run A starts at 06:00 and run B at 06:05. Both read the head and find no unfolded run. A finishes first: done marker, snapshot, a head whose `foldedRuns` names A. B finishes: a head whose `foldedRuns` names B and not A. Run C reads the head, lists `runs/`, finds A's done marker, sees A is not in `foldedRuns`, and folds A. No fact is lost. The head is a cache. The listing of `runs/` is the truth.

**Crash safety.** A chunk is complete on its own. A run that dies leaves chunks, `attempted` objects and no done marker. After `snapshot.longestRunInHours` the next run treats it as settled and folds what it left. The facts in the open chunk are lost. The loss is bounded by `snapshot.chunkSize`, and the work is done again next run, which is safe because every output key is by content hash. Nothing is parked by a crash. Gap 6 closes without a lock. Gap 9 closes because a source's facts are in a chunk as soon as it is listed.

**Cost of a run with nothing new**

| Today | After |
| --- | --- |
| About 4 reads of every event record ever saved, thousands of GETs, growing daily | 2 head reads, 2 snapshot reads, 2 listings of `runs/`, flat for ever |
| 2 listings of the images folder, hundreds of thousands of keys | None |
| Every listed event saved again, about 7,000 PUTs in development | A `seen` fact per event and a `listed` fact per source, in tens of chunk PUTs |

**Size estimates**

| Measure | Estimate |
| --- | --- |
| Events in the development list store | about 7,000 |
| One folded event, 20 documents with id, title and url | about 6 KB |
| List snapshot | about 40 MB |
| Document snapshot in read, parse or OCR, about 58,000 documents | about 25 MB |
| One list run's chunks | a few MB |

These are estimates from the schemas, not measurements. Section 11 says what to measure first.

**Sharding later.** The head records `shardCount`. While it is 1, the snapshot is `all.json`. When one file passes about 100 MB, raise the count: a shard is picked by the first hex characters of the id with `pickShard`, and the head's `shards` map, which already names the run that last wrote each shard, lets a run write only the shards it touched. A snapshot with a new count is a new snapshot, not a new store version. At ten times today's size the list snapshot is about 400 MB, so it needs about 16 shards by then.

**Why only one mutable object.** `HEAD.json` is written over. It holds the run id, the shard map and the folded runs map. Every snapshot it ever pointed at is still there under its run id, so even the index has an audit trail. Turn on object versioning in the bucket as a second safety, so the head's old values are kept too. A retention rule may expire snapshots older than `snapshot.keepInDays`. That is the only deletion in the system, and it deletes only a cache. Chunks are never deleted.

## 6. Failures and retries, one rule for every step

One config table, used by read, parse, OCR and join through the same fold:

```
retry:
  gone:          { attemptLimit: 3, firstWaitInHours: 24, growth: 2 }
  blocked:       { attemptLimit: 5, firstWaitInHours: 12, growth: 2 }
  gateway:       { attemptLimit: 8, firstWaitInHours: 1,  growth: 2 }
  cut-off:       { attemptLimit: 2, firstWaitInHours: 24, growth: 1 }
  out-of-memory: { attemptLimit: 2, firstWaitInHours: 24, growth: 1, lane: heavy }
  bytes-missing: { attemptLimit: 3, firstWaitInHours: 1,  growth: 2 }
  restricted:    { attemptLimit: 1, firstWaitInHours: 0,  growth: 1 }
```

The fold counts `attempted` and `failed` facts since the last good fact, and sets `dueAfterUnixMs` from the last failure and the table. An `attempted` fact with no outcome after it counts as `cut-off`: that is the crash case. A thing past its limit is `parked`, with the class. Nothing is ever parked for ever by code: raise the limit in config and it is due again. `clear:parked` goes away. A `lane: heavy` class is picked up by the heavy cloud job's share filter. Gaps 3 and 4 close, and a metric counts parked things by class and step, so nothing is dropped out of sight.

## 7. The audit trail: the questions it answers

| Question | How |
| --- | --- |
| When did we first see document D, and in which run? | The list snapshot: `firstSeenRunId`. |
| What happened to D, in order? | D's `history` in the read, parse and OCR snapshots. One read per store. Each entry names the chunk that holds the full fact. |
| Did the council change the file? | The read fold: `contentHashes` has two entries with two run ids. |
| Did we check D on a day and find it the same? | A `checked` fact in D's history. |
| Why is D marked gone? | The `withdrawn` fact: run id, time, reason, and the page that no longer links it. |
| What did meeting file M get built from? | The `joined` fact's `basedOn`. Follow each entry through its subject's history. |
| What changed since Tuesday? | Read `catalog/v1/changes/` for the runs after Tuesday's run id. |
| Was the old text used after an SDK upgrade? | Impossible by construction. The text key holds the SDK version. |
| What did run R do? | List `runs/R/` and read its chunks. |

## 8. DRY: what is built once

| Thing | Built once in | Used by |
| --- | --- | --- |
| Fact envelope schema and the run id | `createLedgerStore.schema.ts`, `createRunContext` | every step |
| Chunk, done marker, head, snapshot, folded thing and attempts shapes | `createLedgerStore.schema.ts` | every step |
| Append a fact, write chunks and the done marker, write `attempted` at once | `createLedgerStore` | every step |
| Fold driver: read heads, read snapshots, list runs with the delimiter, fold settled runs, save the snapshot, write the head | `createLedgerStore` | every step, with its own reducer |
| Delimiter listing | `ObjectBucket.readObjectFolders` | `createLedgerStore` |
| Shard rule | `pickShard(id)` | snapshots |
| Share filter | `readIsOwnShare` | parse, OCR |
| Retry fold and the config table | `foldAttempts` | read, parse, OCR, join |
| Content keys by hash and version | `buildContentKey` | read, parse, OCR, join |
| Inputs hash for a derived file | `hashInputs(keys)` | join; later judge |
| Catalog views and change files | `buildCatalogStep` | viewer, judge, tools, Grafana |

Each step keeps three things of its own: its body schema, its reducer and its due rule. Everything else is shared.

**Tests.** The fold is a pure function, so each reducer is tested with a table of facts in and state out. Two property tests run for every store:

1. Folding every fact at once gives the same state as folding a snapshot and then the rest.
2. Folding a snapshot of a run set S, and then the runs not in S, gives the same state, for an S that is not a prefix of the run order. This is the two-runs-at-once case.

**New config values**

| Value | What it sets |
| --- | --- |
| `snapshot.chunkSize` | Facts per chunk. Also the most a crash can lose. |
| `snapshot.chunkWaitInSeconds` | Longest time facts wait in memory before a chunk is written. |
| `snapshot.longestRunInHours` | A run older than this with no done marker is treated as crashed and folded. |
| `snapshot.shardCount` | 1 to start. |
| `snapshot.keepInDays` | The retention rule for old snapshots. |
| `councils.firstListingInDays` | How far back a `deep` or `first` scope lists, by meeting date. |
| `read.recheckInDays` | How old a `read` or `checked` fact must be before a document with a validator is checked again. |
| `parse.redoShare` | The most of a run's items that may be redo work after an SDK upgrade. |
| `retry.*` | The table in section 6. |

## 9. How the gaps close

| # | Gap | Closed by |
| --- | --- | --- |
| 1 | Changed council file never seen | Content hash in the `read` fact, conditional recheck, `checked` facts. A new hash makes parse, OCR and join due. |
| 2 | Partial COINS listing shrinks the event | The fold is a union. A failed page adds, never removes. |
| 3 | Parse and OCR failures parked for ever | Retry table and attempt fold. |
| 4 | Read failures tried every day, then dropped silently | Retry table, and a parked metric. |
| 5 | Upgrades do not flow down | Versions in the content keys. Inputs hash on the join. |
| 6 | No lock, crash parks work | Run id in every key. Chunks and done markers. `attempted` written at once, with a limit. |
| 7 | Cost grows each day | Snapshots and chunks. No big listings. |
| 8 | Coverage holes | Listing scopes, and a union fold that makes a deep run safe. |
| 9 | List saves all or nothing | A source's facts are in a chunk as soon as it is listed. |
| 10 | Images with no parse record | Work comes from the parse snapshot, and a `bytes-missing` fact. |
| 11 | Join before OCR | Join is its own step after OCR. |
| 12 | Own-site meeting gets a new id | Event id from source, date and committee. |

## 10. Order of work

Each item stands on its own and is a run's worth of checking.

1. `ObjectBucket.readObjectFolders` with the delimiter. `createRunContext`. `createLedgerStore` with the envelope, chunks, the done marker, `attempted` at once, the one-file snapshot, the head with `foldedRuns`, and the fold driver. Both property tests. No step uses it yet.
2. Conditional requests in the HTTP client: send the validators, return 304 as a result.
3. List on `list/v3` and read on `read/v3` together, so listings keep flowing: `listed`, `seen` and source facts, the union fold, scopes, the new own-site event id, tombstones only from positive evidence; blobs by hash, `read` and `checked` facts, the retry fold. A migration tool copies the old read store's bytes to blobs by hash and writes one `read` fact per document under run id `20261101T000000Z-migrate`. No content hash is stored today, and a bucket listing gives an ETag, not a SHA-256, so the tool must download every blob once. Run it as a Cloud Run job in the bucket's region, where reads from the bucket have no network charge. Old folders stay.
4. Parse on `parse/v4` and OCR on `ocr/v4`: content keys with versions, `attempted` facts, work from snapshots. The same migration tool writes `parsed` and `scanned` facts for what exists, with the SDK version each record saved.
5. Join as its own step on `join/v2`, with the inputs hash.
6. Catalog, then point the viewer at it.
7. Turn on bucket object versioning and the snapshot retention rule.

## 11. Not decided, and not confirmed

1. The sizes in section 5 are estimates from the schemas: about 6 KB per folded event. Build step 1, fold the development list store once, and measure the file before choosing a chunk size or a shard count.
2. Whether Bun's S3 client sends the delimiter to Google Cloud Storage's S3 interface and gets the run folders back. The option is in the types of Bun 1.4.2. One call against the development bucket confirms it.
3. How many councils send `ETag` or `Last-Modified` with a document. The read step can log the headers for one run. This sets how much of gap 1 the recheck really closes.
4. Which own-site sources split by date, and so which events change id. The migration tool reports it.
5. Whether the judge should read the catalog or the join store. The catalog is simpler. The one-writer test allows either.
6. The size of the old read store in bytes, which sets the time of the migration job.
7. Nothing here was run. The first safe test is step 1 with the property tests. Then step 3 on the development bucket, run twice: the second run writes only `seen`, source and `checked` facts.
