# ModernGov run, 3 October 2026 (new)

This is the record of the second run of the pipeline over every ModernGov
source on 3 October 2026. It is the first run after the fixes in
`moderngov-run-2026-10-03-old.md`. Compare each table with the same table
in that file.

## Setup

| Item                | Value                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Pipeline commit     | `2cbf81c`                                                            |
| Environment         | `PIPELINE_ENV=local`                                                 |
| Sources             | All 299 sources in `config/sources.yaml` with `system: moderngov`   |
| Councils at a time  | 30 (`councils.councilsAtOnce`)                                       |
| Requests at a time  | 15 to the relay (`http.mostRequestsAtOnce`), 5 to `*.moderngov.co.uk` (`http.sharedHosts`) |
| Wait before request | `moderngov.requestGapInSeconds: 2`                                   |
| Retries             | `retryStatuses: [429, 502, 503, 504, 522]`, `retryLimit: 3`, transport errors retried too |
| Time window         | 7 days back (`councils.queryWindowInDays`)                           |
| Relay               | `relay.govbase.co.uk`                                              |
| Bundles             | `data/bundles` was empty. The old bundles were moved to `data/bundles_old` |

The values above come from `config/local/config.example.yaml` at commit
`2cbf81c`. I did not read `config/local/config.yaml`, so I cannot confirm
that the run used the same values. The bundle data agrees with them:
the councils started 30 at a time.

What changed since the old run:

1. The run uses `index.ts` and `runPipeline`. It no longer needs a
   separate run script. `runPipeline` now runs every ModernGov council
   itself.
2. `runPipeline` sorts the councils by the size of their last bundle,
   largest first. `data/bundles` was empty, so no council had a size, and
   the run used the order of `sources.yaml`.
3. `readModernGovCouncil` reuses documents from earlier bundles instead
   of fetching them again. `data/bundles` was empty, so nothing was
   reused in this run.
4. `createHttpClient` has one limit for all requests to the relay, and a
   lower limit for `*.moderngov.co.uk`. It also retries transport errors.
5. All councils of one run save into one run folder,
   `data/bundles/<run name>/<source id>/`. No bundle was lost.

## Timing

| Item                      | Value                                      |
| ------------------------- | ------------------------------------------ |
| Start                     | 2026-10-03 16:42:57 UTC (18:42:57 CEST)    |
| End                       | 2026-10-03 17:38:13 UTC (19:38:13 CEST)    |
| Total                     | **55m 16s**                                |
| Time for one council      | 235s on average, 134s median               |

There is no run log for this run. The start is the run name. The end is
the latest `finishedAtUnixMs` in the manifests.

Slowest councils:

| Council         | Time  | Meetings | Documents | Requests |
| --------------- | ----- | -------- | --------- | -------- |
| Charnwood       | 2179s | 8        | 187       | 137      |
| Leicestershire  | 1850s | 8        | 187       | 137      |
| Ashfield        | 1818s | 0        | 0         | failed   |
| Herefordshire   | 1574s | 0        | 0         | failed   |
| Cornwall        | 1374s | 16       | 240       | 200      |
| Pembrokeshire   | 1333s | 7        | 108       | 113      |
| Torbay          | 1271s | 0        | 0         | failed   |
| Wealden         | 1163s | 2        | 30        | 24       |
| Cambridge       | 1163s | 5        | 66        | 72       |
| Lambeth         | 1119s | 3        | 29        | 32       |

Wiltshire, the slowest council in the old run, took 797s (old: 1627s).

The total time went up, from 49m 33s to 55m 16s, even with a shorter gap.
See "Performance: new run against old run" below for the reasons.

### Requests

The pipeline does not log each request, and it does not log retries. So
this count is built from the bundles, and it is a lower bound.

| Request                                                       | Count      | Source    |
| ------------------------------------------------------------- | ---------- | --------- |
| RSS feed (`mgRss.aspx`), 1 for each council                   | 299        | Bundles   |
| `GetMeeting`, 1 for each meeting                              | 1,113      | Bundles   |
| Documents fetched (not restricted, not a link to another site) | 11,681    | Bundles   |
| **Counted from the bundles**                                  | **13,093** |           |
| `GetAllMeetingsByDate` and `GetCommittees`, after the feed failed | not known | No log  |
| Retries after a status in `retryStatuses` (up to 3 for each request) | not known | Not logged |
| **Total**                                                     | **13,093, plus fallback calls and retries** | |

A council made 44 requests on average and 34 for the middle council
(median). The most was 248 (Wiltshire).

For the councils with at least 1 meeting, a request took 5.0s on average,
from the council's start to its end. The median council took 3.5s for
each request. The old run assumed 7.5s (5s gap and 2.5s answer).

## Performance: new run against old run

The numbers in this section come from the 290 old bundles in
`data/bundles_old` and the 299 new bundles. A council's time is
`finishedAtUnixMs` minus `startedAtUnixMs` in its manifest. A council's
requests are 1 feed, 1 for each meeting and 1 for each fetched document,
as in "Requests" above. Retries and fallback calls are not counted.

### Headline numbers

| Item                                         | Old (5s gap, 50 at once) | New (2s gap, 30 at once, limits) | Change |
| -------------------------------------------- | ------------------------ | -------------------------------- | ------ |
| Total time                                   | 49m 33s                  | 55m 16s                          | 12% slower |
| Requests counted from the bundles            | 12,168                   | 13,093                           | 8% more |
| Requests each second, over the whole run     | 4.1                      | 3.9                              | about the same |
| Requests each second, at peak (5 minutes)    | 7.3                      | 7.2                              | about the same |
| Time for one council, average                | 316s                     | 235s                             | 26% faster |
| Time for one council, median                 | 235s                     | 134s                             | 43% faster |
| Time for each request, average               | 7.4s                     | 5.0s                             | 32% faster |
| Time for each request, median council        | 6.9s                     | 3.5s                             | 49% faster |
| Time for each document, overall              | 0.24s                    | 0.25s                            | about the same |
| Half the councils done                       | 13m 7s                   | 17m 31s                          | 4m later |
| 90% of the councils done                     | 28m 52s                  | 33m 36s                          | 5m later |
| Time with fewer than 10 councils running     | about 15m                | about 15m                        | the same |
| Bundles saved                                | 290 of 299               | 299 of 299                       | all saved |
| Documents read                               | 10,139 (81%)             | 11,013 (82%)                     | 1 point more |
| Relay errors on documents (522, transport)   | 62                       | 0                                | all gone |
| 502 and 504 on documents                     | 41                       | 0                                | all gone |

"Time for each request" is a council's time divided by its requests,
for councils with at least 1 meeting. The time and the request rate
"over the whole run" use the run start and the last council end. The
rate at peak spreads each council's requests evenly over its time, and
takes the busiest 5 minutes.

### Each council is about twice as fast

228 councils had meetings in both runs. For these councils:

- 204 of the 228 were faster in the new run.
- The middle council took 52% of its old time for each request. 10% of
  the councils took 39% or less. 10% took 106% or more.

Examples of large councils, time for each request:

| Council                | Requests | Old    | New    |
| ---------------------- | -------- | ------ | ------ |
| Wiltshire              | 248      | 6.6s   | 3.2s   |
| Dumfries and Galloway  | 229      | 6.8s   | 4.4s   |
| Somerset               | 150      | 7.5s   | 2.9s   |
| East Sussex            | 125      | 9.5s   | 4.4s   |
| Sutton                 | 104      | 6.7s   | 2.6s   |
| Cornwall               | 200      | 7.5s   | 6.9s   |
| Pembrokeshire          | 113      | 8.5s   | 11.8s  |
| Leicestershire         | 137      | 9.3s   | 13.5s  |
| Charnwood              | 137      | 8.9s   | 15.9s  |

Only 3 large councils got slower: Pembrokeshire, Leicestershire and
Charnwood. All 3 had 504 errors in the old run, so their servers are
slow. Charnwood and Leicestershire read the same server (see Known
issues), and they ran at the same time in both runs.

### Why the whole run is not faster

**1. The relay still handles the same number of requests each second.**
The run sends a fixed amount of work, about 13,000 requests. The total
time is that work divided by the rate. The rate stayed the same, about
7 requests each second at peak and 4 over the whole run. So the total
time stayed about the same, and it went up a little because there were
8% more requests.

The shorter gap did not raise the rate, because `http.mostRequestsAtOnce`
(15) now caps it. Each council is faster only because 30 councils share
the relay instead of 50. Each one gets a larger part of the same rate.

If the 15 places were full all the time, each request held its place
for about 3.8s (15 places divided by 3.9 requests each second). The old
file assumed 2.5s for an answer. The run does not log how long a request
waits for a place, so this is not proven.

The old file estimated about 29m for a 2s gap. That estimate assumed no
limit on requests at the same time, so it does not apply to this run.

**2. The end of the run is a long tail.** All 30 places were full for
the first 30 minutes. From about 40 minutes, fewer than 10 councils ran.
The last 10 minutes had 1 to 4 councils. The tail is as long as in the
old run, about 15 minutes, but it starts 5 minutes later. Pembrokeshire set the end: it
started at 33m 3s, because it is near the end of `sources.yaml`, and it
took 22 minutes.

**3. Councils that fail now take much longer.**

| Council        | Old  | New   |
| -------------- | ---- | ----- |
| Ashfield       | 201s | 1818s |
| Herefordshire  | 208s | 1574s |
| Torbay         | 61s  | 1271s |

All 3 fail on 503 or 504, which are now retried 3 times. Torbay started
at 26m 24s and ended at 47m 35s, near the end of the run. Together the 3
held a council place for 78 minutes and gave 0 meetings. The 9 councils
that failed on 403 or 404 failed in under 10 seconds, faster than in the
old run, because those statuses are not retried.

### Replay of the new run

I replayed the new run with 30 councils at a time, using each council's
real time from this run and a different order. The replay of the real
order gives 55m 15s, which matches the real run.

| Order                                                    | Total    |
| -------------------------------------------------------- | -------- |
| `sources.yaml` order (the real run)                      | 55m 15s  |
| `sources.yaml` order, the 3 slow failures fail in 7s     | 52m 52s  |
| Largest first, by requests                               | 64m 12s  |
| Largest first, by requests, the 3 slow failures fail in 7s | 50m 2s |

The replay keeps each council's time the same, whatever the order. In a
real run, the time of a council depends on what runs beside it, so these
numbers are a guide, not a forecast.

Two things come out of the replay:

- **Largest first, by size, can make the run slower.** A council that
  fails slowly has a size of 1 request, so it goes last, and its 20 to
  30 minutes then set the end of the run. `runPipeline` sorts by
  meetings plus documents from the last bundle, so it has this problem.
  Sorting by the time of the last run, from the manifest, avoids it.
- **The order alone saves little now.** Even the best order gives about
  50 minutes, because Charnwood alone took 36 minutes. The rate cap in
  point 1 sets the floor.

### What would make the run faster

| # | Change | Where | Effect |
| - | ------ | ----- | ------ |
| 1 | Raise `http.mostRequestsAtOnce` in small steps, such as 15 to 20, and `councils.councilsAtOnce` with it (the schema needs twice the value) | Config only | Raises the rate. This is the only change that makes the whole run much shorter |
| 2 | Sort by the time of the last run, not by its size | `runPipeline`, `createBundleStore` | Slow failures and slow servers start first |
| 3 | Fail faster on the council web service calls, such as fewer retries for a relay 504 on `GetCommittees` | `createHttpClient` or `createModernGovClient` | Saves about 20 to 30 minutes of council time for each council that is down |
| 4 | Fix Charnwood's `base_url` | `config/sources.yaml` | Removes 137 duplicate requests and the slowest council |
| 5 | Log each request, each retry and each wait for a place | `createHttpClient` | Shows how full the 15 places are, so the next limit can be set from data |

For change 1, watch the relay errors. The old run had 62 relay errors at
a peak of 7.3 requests each second with 50 councils. This run had 0 at
7.2 with 15 requests at a time. So the number of requests at the same
time may matter more to the relay than the rate. Also, this run retried
502, 504 and 522, and it does not log retries. So some relay errors may
have happened and been hidden by a retry that worked. Change 5 shows
this.

The next run with this run's bundles in place also reuses documents
(fix 5 in the old file). It sends far fewer requests, so it is much
shorter whatever the limits are. Compare the time for each request, not
the total time, with this file.

## Results

These numbers come from the 299 bundles in
`data/bundles/2026-10-03T16-42-57-274Z`.

| Item                     | Value          |
| ------------------------ | -------------- |
| Councils run             | 299            |
| Bundles saved            | 299            |
| Councils with problems   | 12             |
| Councils with 0 meetings | 55             |
| Meetings                 | 1,113          |
| Documents                | 13,494         |
| Documents read           | 11,013 (82%)   |

A council with 0 meetings is usually not a fault. It means the council
published nothing in the 7 day window.

The two runs used different 7 day windows, about 2h 40m apart. So some
changes in meetings and documents are only new publications.

## Error statuses in the bundles

There is no run log, so the counts come from the bundles. The council
problems are in each `manifest.json`. The document errors are in the
`unreadReason` field in each `meetings.ndjson.gz`.

Commands, from `apps/pipeline`:

```bash
RUN=data/bundles/2026-10-03T16-42-57-274Z
cat $RUN/*/manifest.json | grep -o "status code ([0-9]*" | sort | uniq -c
gzcat $RUN/*/meetings.ndjson.gz | grep -o "status code ([0-9]*" | sort | uniq -c
```

Output, council calls (manifests):

```
   6 status code (403
   1 status code (404
   1 status code (503
   2 status code (504
```

Output, documents (bundles):

```
 373 status code (403
  23 status code (404
```

What each status means:

| Status | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| 403    | Refused. Here, a firewall or bot check on the council's side.      |
| 404    | Not found.                                                          |
| 503    | The server is not available now.                                    |
| 504    | The council's server took too long to answer.                       |

These counts are not the same as the counts in the old file. The old
counts came from the run log, which also held errors that were retried
or that came from the lost bundles. The new counts only hold the final
error for each call or document.

No document failed with 502, 504, 522 or a transport error. In the old
run, 103 documents failed with these errors.

## Why documents were not read

From the `unreadReason` field of every unread document in the bundles:

| Count | Reason                                 |
| ----- | -------------------------------------- |
| 1,811 | restricted                             |
| 373   | HTTP 403                               |
| 255   | no text, so probably a scanned image   |
| 23    | HTTP 404                               |
| 17    | not a PDF or HTML file                 |
| 2     | a link to another site                 |

"Restricted" documents are marked restricted by the council, so the
pipeline does not fetch them.

### HTTP errors on documents, by host

| Count | Status | Host                                    | Cause                                   |
| ----- | ------ | --------------------------------------- | --------------------------------------- |
| 97    | 403    | `sutton.moderngov.co.uk`                | Azure firewall bot check (old run)      |
| 53    | 403    | `moderngov.erewash.gov.uk`              | Azure firewall bot check (old run)      |
| 53    | 403    | `democracy.lbhf.gov.uk`                 | Azure firewall bot check (old run)      |
| 44    | 403    | `mycouncil.oxford.gov.uk`               | Azure firewall bot check (old run)      |
| 41    | 403    | `kingston.moderngov.co.uk`              | Azure firewall bot check (old run)      |
| 37    | 403    | `democracy.basingstoke.gov.uk`          | Not checked yet. New in this run        |
| 28    | 403    | `democracy.hyndburnbc.gov.ukdocuments`  | Broken link (see Known issues)          |
| 23    | 404    | `modgov.shropshire.gov.uk`              | Shropshire's own error page (old run)   |
| 17    | 403    | `mg.wakefield.gov.uk`                   | Azure firewall bot check (old run)      |
| 1     | 403    | `democracy.croydon.gov.uk`              | Not checked yet                         |
| 1     | 403    | `democracy.hertfordshire.gov.uk`        | Not checked yet                         |
| 1     | 403    | `democracy.devon.gov.uk`                | Not checked yet                         |

Basingstoke was blocked by the Azure firewall in the earlier probe. It
had no failed documents in the old run, but 37 in this run.

## Relay or council: which side caused each error

I did not fetch the failed documents or calls again for this run. The
"Cause" column above uses what the old run found for the same host.

### Relay side

No document failed on the relay side. There were no 522 errors and no
transport errors left after retries. In the old run there were 62.

The run does not log retries, so it is not known how many requests
failed first and then worked on a retry.

### Probably relay side, not proven

| Reason                                                  | Count      | Evidence |
| ------------------------------------------------------- | ---------- | -------- |
| HTTP 504 on `GetCommittees` for Ashfield and Torbay     | 2 councils | The same as the old run. The relay did not get an answer from the council in time. The cause is probably a council server that does not answer. |
| HTTP 503 on `GetCommittees` for Herefordshire           | 1 council  | A 504 in the old run. Not checked again. |

### Council side

| Reason                                   | Count      | Evidence |
| ---------------------------------------- | ---------- | -------- |
| HTTP 403, bot checks on documents        | 342        | Sutton, Erewash, Hammersmith and Fulham, Oxford, Kingston, Basingstoke and Wakefield. The same hosts as the old run, plus Basingstoke. |
| HTTP 403 on `GetCommittees`              | 6 councils | Bolsover, Eastleigh, Leicester and North East Derbyshire, as in the old run. Camden and Sefton are new in this file, because their bundles were lost in the old run. |
| HTTP 404 on `GetCommittees` for Bedford  | 1 council  | The same as the old run. |
| HTTP 404 on documents, Shropshire        | 23         | The same as the old run. |
| HTTP 403, Croydon, Hertfordshire, Devon  | 3          | 1 each. Not checked. Devon had the same short block in the old run. |
| restricted                               | 1,811      | The council marks these documents restricted. Not an error. |
| no text, so probably a scanned image     | 255        | The council's PDF has no text layer. Not an error. |
| not a PDF or HTML file                   | 17         | The council's file is another format. Not an error. |
| a link to another site                   | 2          | The council links to another site. Not an error. |

### Summary

- The fixes removed every relay side error on documents. The 522,
  502, 504 and transport errors went from 103 to 0.
- All the document errors that are left are 403 bot checks and 404s on
  the council side, plus Hyndburn's broken links.
- Basingstoke is a new block, with 37 documents.

## Status of the fixes from the old run

| # | Change                                              | Status in this run |
| - | --------------------------------------------------- | ------------------ |
| 1 | Run the largest councils first                      | In the code. No effect yet, because `data/bundles` was empty |
| 2 | Retry 502, 504 and 522, and lower `retryLimit` to 3 | Done. Transport errors are retried too |
| 3 | One limit for all requests to the relay             | Done, 15 at a time |
| 4 | A separate limit for `*.moderngov.co.uk`            | Done, 5 at a time |
| 5 | Do not fetch a document again                       | In the code. No effect yet, because `data/bundles` was empty |
| 6 | The relay answers 429 with `Retry-After`            | Not known. The relay's code is not in this workspace |
| 7 | Fewer councils at a time                            | Done, 30 instead of 50 |

The next run with these bundles in place will be the first one where
fixes 1 and 5 work.

## Council problems

A problem is a call that failed for the whole council or for one meeting.

| Council                  | Problem                                                       |
| ------------------------ | ------------------------------------------------------------- |
| Ashfield                 | 504 on `GetCommittees`                                        |
| Bedford                  | 404 on `GetCommittees`                                        |
| Bolsover                 | 403 on `GetCommittees`                                        |
| Camden                   | 403 on `GetCommittees`                                        |
| Eastleigh                | 403 on `GetCommittees`                                        |
| Herefordshire            | 503 on `GetCommittees`                                        |
| Leicester                | 403 on `GetCommittees`                                        |
| North East Derbyshire    | 403 on `GetCommittees`                                        |
| Sefton                   | 403 on `GetCommittees`                                        |
| Torbay                   | 504 on `GetCommittees`                                        |
| Southampton              | The `GetCommittees` reply did not match the expected format   |
| Surrey                   | The `GetCommittees` reply did not match the expected format   |

A `GetCommittees` failure means the RSS feed and the date range call
had already failed, so the council gave no meetings.

These problems from the old run are gone: Blaby (502), and the
`GetMeeting` errors for Cambridge, Hillingdon, Oxfordshire,
Staffordshire, Tendring and Test Valley. Welwyn Hatfield, which had a
problem in a lost bundle in the old run, had none.

## Known issues

1. **Hyndburn's document links are broken.** The council gives links with
   no `/` between the domain and `mgConvert2PDF.aspx`. The rewritten link
   keeps the gap, so it becomes `democracy.hyndburnbc.gov.ukdocuments/...`.
   28 documents, the same as the old run.
2. **Charnwood reads Leicestershire's site.** Both have `base_url:
   https://democracy.leics.gov.uk` in `sources.yaml`. So both read the
   same 8 meetings and 187 documents, and they are the two slowest
   councils. Check Charnwood's real ModernGov address.
3. **A council that fails still takes a long time.** Ashfield, Herefordshire
   and Torbay each took 21 to 30 minutes to give 0 meetings, because each
   failed call is now retried 3 times.
4. **The run has no log.** The run output was not saved, so the fallback
   calls and the retries cannot be counted.

## How to compare a new run

1. Decide if the next run starts with empty bundles or with this run's
   bundles. With empty bundles, it compares with this file. With this
   run's bundles in place, the run tests fixes 1 and 5, and it reads
   far fewer documents.
2. Save the run output to a file, so the fallback calls can be counted.
3. Run the two `grep` commands above on the new bundles, and compare the
   counts.
4. Count the `unreadReason` values in the new bundles, and compare them
   with the table above.
5. Compare the total time. The time depends on how many documents the
   councils published in the window, so compare the time per document
   too. This run took about 0.25s per document overall
   (3,316s for 13,494 documents, with 30 councils at a time).

## Run command

The run uses the pipeline's own entry point. Run it from `apps/pipeline`:

```bash
PIPELINE_ENV=local bun run start
```

`bun run start` runs `bun run index.ts`. `index.ts` runs `runPipeline`
with `readModernGovCouncil`, and `runPipeline` reads every ModernGov
source in `sources.yaml`, `councils.councilsAtOnce` at a time.
