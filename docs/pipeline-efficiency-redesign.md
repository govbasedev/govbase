# Pipeline efficiency redesign: state is presence

Written 2026-10-16, during the first OCR run, from the two list and read runs of update 1 (15 Oct evening and 16 Oct morning), their logs, the code on `update/stores-and-steps` (`d0f2758`), the parser SDK `v0.6.0`, the decisions in `pipeline-redesign-decisions.md` and the retrospectives. Nothing here is built.

The order of importance, set by the owner: efficiency and elegance first, with the least metadata in the store. Speed is second. The retrospectives already cover speed.

The question this doc answers: how does the pipeline do the least work, with the least stored state, and with no dependence on when the last run happened?

## Short answers

| Question | Short answer |
| --- | --- |
| Where do the repeat requests come from? | Three places. The list step marks a feed council changed when its meeting window differs from the last window, so 155 of 303 ModernGov councils were "changed" this morning with no meeting at all. The read step asks the store about every listed document, one read each: 6,319 this morning, 4,018 of them already known. Every page-based council is crawled in full every 24 hours, whatever changed. |
| Why does state reset? | The stored state is about runs, not about data: `lastListedAtUnixMs`, `changedAtUnixMs`, `lastDeepReadAtUnixMs`, `isFirstListing`, `isFirstListingDone`. Every run moves them. Two list runs with no read between them lose the first run's meetings. |
| Can we remove the loop? | Yes. Make a step's work a set difference over the store: what the step before wrote, minus what this step has already written. A run can then start at any time, in any order, as often as wanted. Running twice gives the same result as running once. The loop becomes a trigger and nothing more. |
| Can we cut the metadata? | Yes. The listing record (20 fields plus a copy of every meeting) becomes one object per meeting and one four-field object per council. The council record in the read store goes. The raw-facts object goes. The document outcome drops six fields. Every meeting and document is stored once, by the step that owns it. |
| Can many workers share the work with no lock? | Yes. Split the work by a hash, as the OCR step already does: the read step by host, the OCR step by address, the list step by council. A lock is a lease, which ADR 0001 rejected. A random pick fights the per-host pace. |
| How do we cut tokens? | Measure first: tokens by council, committee and document kind. Then gates in config that a person tunes, with a metric per gate. Then drop text that repeats: agenda packs and repeated blocks. |

## Evidence from the two days

| Measure | 15 Oct 20:12 list | 15 Oct 20:19 read | 16 Oct 06:01 read | 16 Oct 07:08 list | 16 Oct 07:33 read |
| --- | --- | --- | --- | --- | --- |
| Time | 5.5 min | 92.2 min | 1.9 min | 20.6 min | 17.7 min |
| Councils marked changed, or due | 370 of 382 | 370 due | 0 due | 301 of 382 | 301 due |
| Feed councils with no meeting in the window | 7 of 303 | | | 159 of 303 | |
| Meetings from the feeds | 1,597 (7-day window) | | | 229 (11-hour window) | |
| Meetings held in the listing records | 4,251 | | | 5,220 | |
| Meetings walked by the read step | | 4,241 | 0 | | 532 |
| Documents listed | | 29,017 | 0 | | 6,319 |
| Documents already known | | 67 | 0 | | 4,018 |
| Councils read that had no meeting | | 0 | | | 155 |
| Councils read whose documents were all known | | 0 | | | 72 of 140 |
| Unread: restricted | | 2,460 | | | 363 |
| Browser reads | | 3,839 | | | 5 |
| Councils lost | 12 | 2 | | 12 | 3 |

OCR, started 09:11 on 16 Oct: 649 pending scans, 2 at once. After 7 hours: 474 scans done (430 read, 44 with no text), 3,744 pages. About 540 pages an hour.

What the two days show.

1. The 15 Oct read was a full read, because the store had been emptied. The 16 Oct read had 2,301 new documents in 6,319 listed. It spent its time on 301 councils. 155 of them had no meeting. 72 more had nothing new.
2. The 06:01 read did nothing, because no list had run since the last read. It still read 382 listing records and 382 council records to find that out. A read depends on a list before it. That is the loop.
3. The feed window moved from 7 days to 11 hours, so the feed councils' records dropped from 1,597 meetings to 229. A meeting listed on 15 Oct is in no listing record now. If its read had failed, nothing would try it again.
4. Meetings held in the records rose from 4,251 to 5,220 while the feeds gave only 229. The page-based councils listed more history on their second listing than on their first. That is the first-listing cap doing its job once, and the cliff after it. Likely, from the counts; not proven per council.
5. The list step took 20.6 min for 229 new feed meetings. Most of that time was not new work. The cause is not analysed here.

## Where the waste comes from in the code today

| # | Cause | Where | Cost |
| --- | --- | --- | --- |
| C1 | A feed council's change hash is the hash of a moving window of meeting ids. The last window was a different window, so the hash differs. An empty window hashes to `e3b0c442…`, as in the record the owner pasted. | `readModernGovListing.ts` (`meetingKeys` from the window), `readCouncilListings.ts` `buildChangeReader` | 155 councils marked changed with no meeting. 155 listing records, 155 council records and 155 events written for nothing. |
| C2 | The read step asks the store about each listed document, one GET each, to learn it is known. The council record already lists the known addresses, but it is used only to guess the work. | `readCouncilMeetings.ts` `readPreviousOutcome`; `buildReadStep.ts` `readKnownAddresses` | 6,319 store reads this morning, 4,018 of them for known documents. |
| C3 | Every council is marked changed every 24 hours. Every page-based council is crawled in full then, whatever changed. | `readCouncilListings.ts` `readIsFullListingDue`; `councils.fullListingInHours: 24` | Up to 80 site pages plus 120 meeting pages for each of about 70 page-based councils, every day. |
| C4 | A feed window starts at the last list run, not at the last read. The record's meetings are replaced by the new window. | `readModernGovListing.ts` `readFeedFromUnixMs`; `buildListStep.ts` `readListedParts` | List, list, read loses the first window. A failed meeting read is never tried again once it leaves the window. |
| C5 | A meeting is stored three times and a document four times: the listing record (`meetings`, with `siteMeeting` detail for page systems), the read council record, the document outcome, and the item version. | `createListStore.schema.ts`, `createReadStore.schema.ts`, `createJudgeStore.schema.ts` | Every due council rewrites its whole council record. The judge reads every council record every run. |
| C6 | The council is the unit of concurrency. The host is the unit of politeness. The two fight. | `councils.councilsAtOnce: 72`, `councils.documentsAtOnce: 4`; `buildLimitedClient` | 15 Oct evening retrospective, Cause 1: 66 of 72 slots held by one supplier's councils. |
| C7 | An unread document whose class is not lasting (`link`, `no-text`, `garbled`, `broken-file`, `status`, `gateway`) is decided and saved again on every run. | `readCouncilMeetings.ts` `readIsKnown`, `readIsLastingUnread` | One store read and one store write each, every run. |
| C8 | The judge visits every council record every run, not only the changed ones. | `buildJudgeStep.ts` `runJudge` over `readCouncilIds` | Work grows with all items, not with new items. |
| C9 | Agenda packs repeat their item papers. | 13 Oct retrospective item 16; 12 Oct big tickets item 9 | 24% of bytes and 35% of parsed text on 11 Oct. The same text reaches Jev twice. |
| C10 | An address with a volatile part is new every time. | Rugby: `…?version=1.0&t=17…` | One re-fetch for each such document, every run. |
| C11 | The SDK drops the feed's publish time and kind. Each RSS item has a `pubDate`, and its link says what was published: `EVT=101` with `DT=A` (agenda) or `DT=M` (minutes). Only the meeting id and committee title are kept. | `govbase-parser-sdk` `readFeedXml.ts` | The pipeline cannot tell a meeting with new papers from one it has already read. Every feed meeting costs a `GetMeeting` call. |
| C12 | A run report, every council and every changed document is written as an event. Only the retrospective tool reads them. | `saveEvent` in every step | Objects that grow for ever. |

## The owner's ideas, ranked

Ranked by elegance and by how idiomatic they are for this code base: Effect, object storage, one writer per object, no database, no leases.

| Rank | Idea | Verdict | Idiomatic form |
| --- | --- | --- | --- |
| 1 | Track what has been fetched and never fetch it again. | Right. It is decision 10 already. The missing step is to make it the only state. | The address is the identity. The outcome object is the memory. "New" means "no outcome object". |
| 2 | A simpler data store than the listing record. | Right. The record mixes three concerns: what exists, what changed, and when we ran. | Keep only what exists. Derive what changed from the data. Drop when we ran. |
| 3 | Spread requests over hosts and workers, not over a council loop. Scale out. | Right goal. | A fair queue by host inside a process. A hash share by host across processes. No lock. |
| 4 | Measure what we read. Let a person ring-fence what reaches the AI. | Right, and cheap. | Gates as config predicates, a metric per gate, a store tool for the numbers. |
| 5 | Event based: while the list has not ended, keep picking a link. | Right instinct: no dependence on cadence. Events between steps would rebuild a queue. | Inside a process: an Effect `Stream` into a bounded `Queue`. Between steps: presence in the store. |
| 6 | Randomly pick a document, lock it, mark it read. | Least idiomatic. A lock is a lease (ADR 0001). Random order fights the per-host pace. | A deterministic share by host hash. If workers must come and go one day, a conditional create (`If-None-Match: *`) is the cheap guard. |

## The search: three rounds of ten

Each round lists ten ideas. The review after each round keeps, replaces or drops them, and sets the next round.

### Round 1: remove the waste in place

| # | Idea | Review |
| --- | --- | --- |
| R1.1 | The list step outputs addresses, not change hashes. New means no outcome object. | Keep. It is the core. |
| R1.2 | A conditional GET (`If-None-Match`, `If-Modified-Since`) re-checks a known document for one header exchange. | Keep, for the systems with no publish date. |
| R1.3 | Skip `GetMeeting` when the feed says nothing new for that meeting. | Keep. Needs the SDK to expose the feed's publish time and kind (C11). |
| R1.4 | The document is the unit of work. A per-host lane is the limit. No council slots. | Keep, refined in R2.3. |
| R1.5 | Shares by hash for the read step, as the OCR step has. | Keep, refined in R3.4: by host, not by address. |
| R1.6 | Claim a document by conditional create before fetching it. | Drop for now. It is a lease with another name. R1.5 covers it. |
| R1.7 | One object per document and nothing else. No council record. | Keep, refined in R2.5. |
| R1.8 | The judge reads only what changed since its last run. | Keep, refined in R2.7. |
| R1.9 | Skip an agenda pack when the meeting has item papers. | Keep. |
| R1.10 | Gates in config between read and judge. | Keep. |

Review. R1.1, R1.4, R1.5, R1.7 and R1.8 say one thing in five places: **what is in the store is the state, and a step's work is a set difference**. That removes `blockHashes`, the listing `etag` and `lastModified`, `isChanged`, `changedAtUnixMs`, `isFirstListing`, `isFirstListingDone`, `lastDeepReadAtUnixMs`, `lastListedAtUnixMs`, `emptyLaterUrls` and the due-by-timestamp rule in the read step. Three gaps stay. (a) Learning the known set with one GET per document is C2 again. (b) "Re-check on a timer" is the loop again. (c) A feed window still needs a start.

### Round 2: make the state live in the data

| # | Idea | Review |
| --- | --- | --- |
| R2.1 | The known set comes from one LIST of the outcome prefix, held in memory for the run, not from one GET per document. Key the outcomes by host so a worker lists only its hosts. | Keep. 29,017 outcomes are 30 LIST pages and about 2 MB of memory. |
| R2.2 | Re-check a document only when its meeting changed, not on a timer. A meeting changes when the feed publishes it again, or when a page system shows new items. | Keep. Replaces `fullListingInHours`. |
| R2.3 | The meeting is the work item. The host is the lane. A fair round robin over hosts; each turn takes the next meeting of that host. | Keep. One writer for the meeting's read record (R2.5), and the host pace holds. |
| R2.4 | A fixed feed window from config, back from now, for example 30 days. Meeting objects are idempotent, so a wide window costs one feed request and nothing more. | Keep. Removes `lastListedAtUnixMs`. Honest limit: a pause longer than the window misses feed meetings. |
| R2.5 | List owns meetings. Read owns documents. The read step writes one small read record per meeting: address, status and text key per document. No council record. | Keep. Each fact is stored once, by its owner. |
| R2.6 | Write an object only when its content hash differs from what is there. Then the bucket's own `LastModified` means "changed". | Keep. Stops hot-key 429s and makes R2.7 possible. |
| R2.7 | The judge keeps one mark: the newest `LastModified` of the read records it has fully processed. It lists the read records newer than the mark. | Keep. Versions are keyed by evidence hash, so a crash re-does a few meetings and nothing breaks. |
| R2.8 | Drop the first-listing flags. The crawl caps bound history for page systems. The feed covers late publication for feed systems. | Keep, with one guard in R3.6. |
| R2.9 | "Lost" is a query, not a flag: a council whose listing object holds a failure, or is older than the lost period. | Keep. Grafana or the store tool answers it. |
| R2.10 | Events only on a change. No run-report events. Logs and metrics hold the run report. | Keep. |

Review. Rounds 1 and 2 give a design where no step reads a run timestamp. Two safety questions stay. How does the judge know the read step has caught up with a changed meeting? How does a page system's old meeting get a late paper? Three efficiency questions stay: volatile addresses, politeness across shares, and tokens.

### Round 3: edge cases and the last costs

| # | Idea | Review |
| --- | --- | --- |
| R3.1 | The read record carries the meeting object's content hash. The judge joins the two only when the hashes match. Otherwise the read step has not caught up and the judge waits. | Keep. This is the safe transfer: a hash chain, not a timestamp. |
| R3.2 | An old meeting's page on a page system is opened again only when its meeting object is older than `oldMeetingRecheckInDays`, by the bucket's own `LastModified`. The list step puts the object again after the check. | Keep. The object's age is the time since the last check. No field, no run time. |
| R3.3 | Address normalisation per system in the SDK: drop volatile query parts before hashing. A test corpus of real addresses. | Keep. Fixes C10. |
| R3.4 | Read shares by the host pool key (the host, or a shared suffix such as `moderngov.co.uk`), not by address. One process paces one host. | Keep. Replaces R1.5. Keeps the one-request-a-second rule true. |
| R3.5 | Re-fetch a known document only when its listed facts changed (`publishedOn` or title). Use a conditional GET only when the system gives no `publishedOn` and the meeting is live. | Keep. Refines R1.2 and R2.2. |
| R3.6 | On a council's very first listing (no council listing object yet) cap the meetings by date, as today. After that, no cap. | Keep. The cap is "no listing object yet", not a flag. |
| R3.7 | Drop repeated blocks: a block whose hash appears in another document of the same meeting is not sent to Jev. | Keep. Catches the packs the title rule misses. |
| R3.8 | Tokens as metrics at read time (by system and document kind) and at judge time (by experiment and recipe), plus a store tool that prints tokens by council and committee. | Keep. Measure before gating. |
| R3.9 | Gates as config: `judging.gates`, a list of `{ id, when, action }`. A gated state records `skipReason: gate:<id>`. A metric counts by gate. | Keep. Refines R1.10. |
| R3.10 | A conditional-create claim object, for workers that come and go. | Drop. Shares cover the proof of concept. Written down as the option if it is ever needed. |

Review. The three exit conditions are met: the loop can go, the metadata shrinks, and state moves between steps by a hash chain. The design below is the result.

## The design

### Five rules

1. **Presence is state.** A step's work is what the step before wrote, minus what this step has written. Nothing in the store says when a run happened.
2. **Identity is the address. Change is the content hash.** Time comes from the bucket's own `LastModified` of an object, never from a run.
3. **One step, one noun.** List owns meetings. Read owns documents. OCR owns scans. Judge owns items. A fact is stored once, by its owner.
4. **The host is the lane. The meeting is the work item. The share is the worker.** Politeness is per host. Output is per meeting. Scale is a hash.
5. **Twice is the same as once.** Every write is keyed by content, or compared before it is written. Any step can run at any time, in any order.

### The store after the change

```
list/v2/state/councils/<councilId>.json               listedAtUnixMs, failure | null
list/v2/state/meetings/<councilId>/<meetingId>.json   the meeting: items, documents, publish facts, contentHash
read/v2/state/documents/<hostKey>/<addressHash>.json  the outcome of one address, with its headers
read/v2/state/meetings/<councilId>/<meetingId>.json   the read record: address, status, textKey per document, meetingHash
read/v2/state/texts/<contentHash>.json.gz             as today
read/v2/state/bodies/<contentHash>.body               as today
read/v2/state/pending/<addressHash>.json              as today, without the time in the key
ocr/v1/state/scans/<addressHash>.json                 as today
ocr/v1/state/texts/<contentHash>.json.gz              as today
judge/v1/state/mark.json                              the newest read-record LastModified fully processed
judge/v1/state/...                                    versions, states, judgments as today
<step>/<version>/events/<hour>/...                    only on a change
```

Gone: the 20-field listing record, the read council record, the raw-facts object per address (its status and headers move into the outcome; the body stays keyed by content hash), and the time prefix in the pending key.

The layout change is a breaking change for the list and read stores, so they move to `v2` folders and `v1` drains, as decision 11 says. The OCR and judge stores gain only the mark object, which is additive.

### The records

**Meeting object** (list store). One per meeting. Written only when its hash changes.

```
schemaVersion, councilId, meetingId, committeeTitle, date, status, location, sourceUrl
site { baseUrl, servicePath, canUseBrowser }
published { agendaAtUnixMs | null, minutesAtUnixMs | null }     from the feed, when the system gives one
items [ { agendaItemId, number, title, isRestricted, agendaHtml, minutesHtml,
          documents [ { documentId, title, address, publishedOn | null, isLink, isRestricted } ] } ]
contentHash                                                     of everything above
```

**Council listing object** (list store). `schemaVersion, councilId, listedAtUnixMs, failure | null`. The time here is a fact about the council (when it was last reached), not a control for another step. "Lost" is a query over these objects: `failure` not null, or the object older than the lost period.

**Document outcome** (read store). One per address.

```
schemaVersion, address, hostKey, status, unreadClass, unreadReason, contentHash, textKey, scanPages
publishedOn | null, etag | null, lastModified | null, httpStatus, sdkVersion, attemptCount, fetchedAtUnixMs
```

Dropped: `councilId`, `documentId`, `title` (the meeting object has them), `previousContentHash` (the events have it), `parser` (the text object has it), `firstSeenAtUnixMs` (the first event has it). Added from the raw-facts object: `etag`, `lastModified`, `httpStatus`.

**Read record** (read store). One per meeting. The join the judge needs.

```
schemaVersion, councilId, meetingId, meetingHash, readAtUnixMs
documents [ { address, status, contentHash, textKey, scanPages, unreadClass } ]
```

| Shape | Today | After |
| --- | --- | --- |
| Listing record | 20 fields, every meeting of the window or crawl inside, page systems with full detail | 4 fields |
| Meeting | Inside the listing record, inside the council record, inside each item version | One meeting object, one read record, a key in the item version |
| Document | Listing record, council record, outcome, raw facts, item version | Meeting object (listed facts), outcome (read facts), read record (join) |
| Fields about runs | 9 (`listedAt`, `lastListedAt`, `firstSeenAt`, `isChanged`, `changedAt`, `isFirstListing`, `isFirstListingDone`, `lastDeepReadAt`, `listingAt`) | 0 that control another step |

### What each step does in one run

**List.**

1. For each council, as many at once as config says. When the list step is shared, by council id hash.
2. Feed system: fetch the feed for the fixed window `councils.feedWindowInDays` back from now. For each item take the meeting id, the kind (agenda or minutes) and the publish time. Compare with the meeting object. No object, or a newer publish time for that kind: call `GetMeeting`, build the object, write it if its hash differs. Otherwise nothing.
3. Page system: crawl as the deep read does today, with the same caps. Open a meeting page when there is no object, or the meeting is live (its date within `councils.liveMeetingInDays` of today), or the object is older than `councils.oldMeetingRecheckInDays`. Build objects; write each if its hash differs; put an old object again after its check so its age restarts.
4. Write the council listing object with `failure` null, or the reason.
5. No change hashes, no due flags, no first-listing flags, no lost flag, no window start from the last run.

**Read.**

1. LIST `list/v2/state/meetings/` and `read/v2/state/meetings/`: keys and `LastModified`. The work is every meeting object with no read record, or newer than its read record. A touched old object costs one GET and one hash compare, then nothing.
2. Keep only the meetings whose host pool key falls in this process's share.
3. LIST `read/v2/state/documents/<hostKey>/` once per host in the work. That is the known set.
4. For each meeting, GET the object and the old read record. New: an address with no outcome. Changed: a known address whose `publishedOn` or title differs from the read record. The rest are known. For a system with no `publishedOn`, a known document of a live meeting gets one conditional GET.
5. A fair queue: round robin over hosts; each turn takes the next meeting of that host and its documents, at the host's pace. One global cap. The shared-suffix pools stay, but not nested inside the relay pool (15 Oct evening retrospective, item 1).
6. For each document: fetch, hash, parse with the SDK, write the text by content hash, write the outcome, write the pending marker for a scan. Then write the read record with `meetingHash` equal to the object's hash, compared before writing.
7. Gone: the council record, "councils due", the sort by expected work, `councilsAtOnce`, `documentsAtOnce`, `recordsAtOnce`, `guessedDocumentsPerMeeting`.

**OCR.** As today: pending markers minus scan outcomes, share by address hash, `scansAtOnce`. This is the first step to run as two processes: 649 scans took more than 7 hours at 2 at once.

**Judge.**

1. Read `mark.json`, or zero. LIST `read/v2/state/meetings/` and take the keys newer than the mark less a margin.
2. For each: GET the read record and the meeting object. If `meetingHash` differs from the object's `contentHash`, skip it: the read step has not caught up. If any document is a pending scan with no scan outcome, skip it (decision 20).
3. Build the evidence hash per item, then versions and states by hash, as today. Apply the gates. Send to Jev under the cap, oldest first.
4. Write the new mark only after every candidate was handled. The mark is the `LastModified` of the oldest meeting still not done (held by the cap, or waiting for read or OCR), or the newest seen when all are done.

**Plan and send.** Unchanged.

### Scale and politeness

| Step | Share key | Why |
| --- | --- | --- |
| list | council id | A council's feed and pages are on one host, so one process paces it. |
| read | host pool key | The one-request-a-second rule then lives in one process. |
| ocr | address hash | No host is involved. As today. |
| judge | one process | The Jev cap is one number. A council hash later, if needed. |

Running the same share in two processes keeps the data correct, because every write is idempotent. It doubles the request rate to that share's hosts. So the rule is one process per share, set in config. If workers must come and go one day, the cheap guard is a claim object: `PUT read/v2/state/claims/<meetingId>` with `If-None-Match: *`, which both GCS and S3 support; a claim older than a few minutes is stale. Not now.

### Tokens and the judge

1. **Measure.** `govbase_pipeline_text_tokens{system, kind}` at read time. `govbase_pipeline_jev_tokens{experiment, recipe, direction}` at judge time. A store tool, `tools/stores/readTokenReport.mjs`, prints tokens by council, committee and document kind, and the share of blocks dropped as boilerplate.
2. **Gates.** `judging.gates`: a list of `{ id, when: { committeeTitlePattern?, councilIds?, documentKinds?, leastTokens?, mostTokens? }, action: skip | hold }`. `skip` writes a state with `skipReason: gate:<id>` and never sends it. `hold` keeps it for a person. Metric `govbase_pipeline_items_gated{gate}`. A person reads the gated sample through the store tool and tunes the list. The rules are data, so a change needs no release.
3. **Dedupe.** The pack rule: `documents.packTitlePhrases` in config, unread class `pack-skipped`, and a pack is kept when it is the meeting's only document. Block dedupe: at state build, a block whose hash appears in another document of the same meeting is dropped.
4. **Deterministic.** A state is keyed by evidence hash and recipe hash, so the same evidence is never asked twice. This holds today and stays.

### The exit conditions

| Condition | How it is met | What proves it |
| --- | --- | --- |
| A. The loop can go | No step reads when another step last ran. Work is a set difference plus a hash compare. Any order, any time, and twice is the same as once. | Run list, list, read: the read sees both windows' meetings. Run read with no list before it: it ends in seconds and writes nothing. Run read twice: the second run writes nothing. |
| B. Less metadata | The listing record goes from 20 fields plus every meeting to 4 fields plus one object per meeting. The council record and the raw-facts object go. The outcome drops 6 fields. Events only on a change. | Object count and bytes per store, from the store tool, before and after. |
| C. Safe transfer | The consumer carries the producer's content hash. The judge joins only on a matching hash. The mark moves only over finished work. | Change a meeting object by hand: the read record's hash differs, and the judge skips it until the read step runs. |

### Edge cases that stay, and what they cost

The owner asked for a solution with no edge cases. There is none. What this design does is make each edge case cheap and bounded.

| Case | What happens | Cost |
| --- | --- | --- |
| A volatile address part (`t=`, a session id) | The normaliser strips it. A pattern not yet in the list means one re-fetch per run for that document, inside the host pace. | Add the pattern; the SDK test corpus grows. |
| A paper replaced at the same address with no republish | Feed systems: the feed republishes the meeting on any paper change, so it is caught. Page systems: caught while the meeting is live (one conditional GET), or at the old-meeting re-check. Outside both, missed. | One header exchange per live known document per run. |
| A paper added late to an old meeting on a page system | Caught at the old-meeting re-check. Delay up to `oldMeetingRecheckInDays`. | One page request per old meeting per period. |
| The pipeline stops for longer than the feed window | Feed meetings published in the gap are not listed. Page systems are not affected. | An alarm when the council listing objects are older than the window. A wider window costs nothing. |
| A document goes 404 | `gone` after `goneAfterAttempts`, counted in the outcome. As today. | As today. |
| Two processes run the same share | The data stays correct. The share's hosts see twice the rate. | An operator rule. The claim object later, if needed. |
| Bucket `LastModified` against the judge mark | Same clock, the bucket's. A margin of a few minutes. Reprocessing is idempotent. | A few repeated hash compares. |
| A crash in the middle of a read | The outcomes written so far stay. The read record is not written, so the meeting is work again. Known documents are not fetched again. | Nothing lost. A few GETs. |
| A document with an empty or odd address | Unread with a reason, never fetched. As today (fixed 15 Oct). | None. |
| A schema change | A new folder, `list/v3/`. Decision 11. | A drain. |

### Expected effect on a normal run

The baseline is the 16 Oct 07:33 read and the 07:08 list. The "after" column is an estimate.

| Measure | Today | After | Why |
| --- | --- | --- | --- |
| Feed requests | 303 | 303 | One per feed council, as today. |
| `GetMeeting` calls | 229, plus one per republished meeting | Only meetings with a newer publish time or kind. On a quiet night, 0. | C11 fixed. |
| Page requests for page systems a day | Up to 14,000 | About 800: a front page and the live meeting pages for about 70 councils | R2.2, R3.2 replace the 24-hour crawl. |
| Councils handled by read that had nothing to do | 155 with no meeting, 72 with nothing new | 0 | R1.1, R2.1. |
| Store reads in read, nothing new | 764 | 2 LISTs | The 06:01 run shape. |
| Store reads in read, this morning's work | 6,319 GETs, plus 764 | About 2 LISTs, 40 host LISTs, 300 meeting GETs, 300 read-record GETs | R2.1. |
| Store writes in read | 301 council records, 6,319 outcomes and events | About 300 read records and 2,300 outcomes | New and changed documents only. |
| Judge reads | 382 council records | The read records newer than the mark, about 300 | R2.7. |
| Bytes on a full read | 22.6 GB | About 17 GB | The pack rule, 24% of bytes on 11 Oct. |
| Text parsed and sent | 100% | About 65% | Packs and repeated blocks, 35% of text on 11 Oct. |

### Config that goes and config that comes

| Key | Change | Why |
| --- | --- | --- |
| `councils.fullListingInHours` | Goes | Replaced by `liveMeetingInDays` and `oldMeetingRecheckInDays`. |
| `councils.lostAfterInHours` | Moves to a Grafana rule and the store tool | Lost is a query. |
| `councils.listingFallbackInHours` | Goes | No header-based change detection. |
| `councils.councilsAtOnce`, `documentsAtOnce`, `recordsAtOnce`, `guessedDocumentsPerMeeting` | Go | The host is the lane. |
| `councils.feedWindowInDays` | Stays, new meaning | A fixed window back from now, for example 30. |
| `councils.firstListingInDays` | Stays | Applies when the council has no listing object yet. |
| `councils.lastingUnreadClasses`, `goneAfterAttempts` | Stay | They decide which unread outcomes are final. |
| `councils.liveMeetingInDays` | New | Days around the meeting date in which its page is opened and its known documents re-checked. |
| `councils.oldMeetingRecheckInDays` | New | Age of a meeting object after which its page is opened again. |
| `read.shareIndex`, `read.shareCount` | New | Share by host pool key, as `ocr.shareIndex` and `ocr.shareCount`. |
| `read.requestsAtOnce` | New | The one global cap in the read step. `http.mostRequestsAtOnce` stays for the relay pool. |
| `judge.markMarginInSeconds` | New | The safety margin under the mark. |
| `documents.packTitlePhrases` | New | The pack rule. |
| `judging.gates` | New | The gates. |

### Decisions this changes

| Decision | Today | After |
| --- | --- | --- |
| 13. Change detection first, by ETag or listing hash | Hashes of the parsed listing per block | Presence of a meeting object, plus the feed's publish time and kind. |
| 14. Feed systems read from the council's own last-listed time | `lastListedAtUnixMs` | A fixed window back from now. |
| 15, 16. First listing cap, no backfill | Flags in the record | The cap applies when there is no listing object yet. No flags. |
| 17. A council is lost after a period with no listing | `isLost`, `lostReason` | A query over the council listing objects. |
| 35. Change detection hashes the parsed listing | Yes | Gone. The meeting object's content hash is the only hash. |
| 38. A full re-read of a page-based council every 24 hours | `fullListingInHours` | Live meetings each run, old meetings on a long period. |
| 10, 11, 12, 20, 24 | Kept | Kept, and strengthened. |

ADR 0001 (stores in object storage, no database, no leases) and ADR 0002 (one process per step) hold. A share is more processes of one step, as decision 5 already allows for OCR. A third ADR, "State is presence", should record rules 1, 2 and 5.

### Order of work

Each item stands alone and is measured by the next run.

1. **Measure tokens and bytes (R3.8), and the pack rule (R1.9).** No schema change. Cuts bytes and text now. The 12 Oct big tickets ask for 20 packs checked by hand first.
2. **Known set from one LIST (R2.1), flat prefix, and address normalisation in the SDK (R3.3).** No schema change. Cuts 6,000 store reads a run now.
3. **SDK: expose the feed's publish time and kind (C11). The meeting object and the new list step, in `list/v2`.** The read step reads `list/v2`.
4. **The read step: host lanes, shares, read records, outcomes with headers, in `read/v2`.** Drop the council record and the raw-facts object.
5. **The judge: the mark, the hash chain, the gates.** The judge store stays `v1` plus `mark.json`.
6. **Delete the config and flags. Update `AGENTS.md`, `README.md` and the glossary in `CONTEXT.md`. Write ADR 0003.**

### Decisions for the owner

- [ ] The feed window: 30 days?
- [ ] The live window: 14 days before and after the meeting date? The old-meeting re-check: 30 days?
- [ ] List owns meetings, so `GetMeeting` moves from the read step to the list step: about 230 calls a day move. Agree?
- [ ] The pack rule: skip by title, or parse and drop repeated blocks, or both?
- [ ] The first gates to try, once the token report exists.
- [ ] Whether to run OCR as two processes now, with `ocr.shareCount: 2`.

### Glossary words to add to `CONTEXT.md`

- **Presence**: an object exists in a store. The only state a step reads.
- **Known set**: the addresses with an outcome object, listed once per run.
- **Lane**: one host's queue, paced at the host's rate.
- **Mark**: the newest `LastModified` a consumer has fully processed.
- **Gate**: a config rule that keeps an item from the judge, with a reason.
- **Share**: exists. Now also used by the read and list steps.

## Sources

- `apps/pipeline/data/logs/list-2026-10-15T20-12-56Z.log`, `read-2026-10-15T20-19-35Z.log`, `read-2026-10-16T06-01-50Z.log`, `list-2026-10-16T07-08-11Z.log`, `read-2026-10-16T07-33-27Z.log`, `ocr-2026-10-16T09-11-27Z.log` (read while still running, at 16:16).
- Code: `src/domain/buildListStep/`, `readCouncilListings/`, `readModernGovListing/`, `readOwnSiteListing/`, `readCmisListing/`, `buildReadStep/`, `readCouncilMeetings/`, `buildOcrStep/`, `buildJudgeStep/`, `buildItemVersions/`; `src/infrastructure/createListStore/`, `createReadStore/`, `createOcrStore/`, `createJudgeStore/`, `createStoreFiles/`, `createModernGovClient/`; `config/development/config.yaml`; `config/sources.yaml` (382 councils: 307 moderngov, 35 cmis, 29 own-site, 4 coins, 3 decision-time, 1 amber-valley, 4 unknown).
- Parser SDK `v0.6.0`: `src/moderngov/readFeedXml.ts`, `buildRequestUrl.ts`, `moderngov.types.ts`.
- `docs/pipeline-redesign-decisions.md`, `docs/adr/0001-stores-in-object-storage-no-database.md`, `docs/adr/0002-one-process-and-one-image-per-step.md`, `docs/read-run-2026-10-15-evening-retrospective.md`, `docs/read-run-2026-10-13-retrospective.md`, `docs/read-run-2026-10-12-big-ticket-items.md`, `docs/CONTEXT.md`.
