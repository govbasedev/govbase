# Read run 2026-10-15 (evening): retrospective

Second run of update 1, and the first with the 16 changes from the 15 Oct retrospective. Steps `list` then `read`, run one at a time. Started 20:12Z on 15 Oct (21:12 UK time), finished 21:52Z.
Logs: `apps/pipeline/data/logs/list-2026-10-15T20-12-56Z.log` and `apps/pipeline/data/logs/read-2026-10-15T20-19-35Z.log`.
Stores: `gs://govbase-pipeline-documents-dev/list/v1/` and `gs://govbase-pipeline-documents-dev/read/v1/`.
Code: pipeline `d0f2758` on `update/stores-and-steps`. Parser SDK `v0.6.0`. Relay `e0da862` (60 a minute, burst 5). Browser `4038513`. It is not proven that the relay and browser changes were deployed before the run (see Cause 6).
Written 2026-10-16 from the two logs, a listing of every object in the bucket, the three Grafana dashboards through the Prometheus API, and the code of the read path.

The read store was emptied before this run. Only 5 of the 26,222 document outcomes are older than the run, and the read step counted 67 documents as known. So this was a full first read again, and it compares like for like with the 15 Oct afternoon run.

| Measure | 13 Oct run | 14 Oct run | 15 Oct afternoon | 15 Oct evening (this run) |
| --- | --- | --- | --- | --- |
| Started (UK time) | 14:16 | 00:19 | 14:16 | 21:12 |
| Wall time | 1,164 min | 168 min | 188 min (list 13.4, read 174) | **99 min (list 5.5, read 92.2)** |
| Councils | 369 read, 13 lost | 368 read, 14 lost | 370 due, 368 read; list lost 12, read lost 2 | 370 due, 368 read; list lost 12, read lost 2 |
| Meetings | 7,155 read | 5,856 read | 4,101 listed, 4,086 read, 15 lost | 4,251 listed, 4,241 read, 11 lost |
| Documents listed | 57,460 | 45,300 | 27,986 | 29,017 |
| Documents fetched | 53,839 | 5,710 (38,100 reused) | about 25,600 (120 reused) | 25,713 read, 598 pending scans (67 known) |
| Time for each fetched document | 1.17 s | 0.92 s | 0.41 s | **0.22 s** |
| Failed requests (final) | 896, plus 43 skipped | 68, plus 24 skipped | 34, plus 53 skipped | 54, plus 138 skipped |
| Gateway replies before retries (502, 503, 504, 522) | 128 | 316 | 147 | 381 (see Cause 5) |
| Relay 429 replies | 99 lines | 4 | 0 | 64 |
| OCR | 8,310 pages | 816 pages | none; 597 scans left | none; 598 scans left |
| Browser reads | 3,816 read, 11 failed | 1,119 read, 38 failed | 3,717 read, 6 failed | 3,839 read, 13 failed |
| Peak pipeline memory (RSS) | 10.1 GB | 6.2 GB | 4.4 GB | 4.0 GB |
| Pipeline CPU | not measured | not measured | not measured | median 0.9 cores, peak 1.1 |
| Raw bytes saved to the bucket | not measured | not measured | 23.9 GiB, 33,067 bodies | **2.15 GiB, 8,606 bodies** |
| Bytes downloaded to the Mac | not measured | not measured | not measured | about 22.6 GB, median 4.1 MB/s |

## Questions and short answers

| Question | Short answer |
| --- | --- |
| A. Which issues are proven fixed? | Nine. The upload of raw bytes (2.15 GiB, not 23.9 GiB; upload never above 1 MB/s). Store writes off the chain. Metrics export and histograms (no `Metrics export failed` line; histogram counts grow; data runs to 21:51:51Z). The empty address key (`e3b0c442`: 0 lines). Shropshire (40 read and 8 pending of 51). Kent (read, 6 meetings). Warrington (read, 42 documents). The read step's long start (96 s, against 2.5 min). The listing phase (5.5 min, against 13.4). |
| B. What new issues do we have? | One big one and nine small ones. **The big one: every `*.moderngov.co.uk` council shares 5 request places, and a request holds its shared place while it queues for one of the 36 relay places.** In the first 50 minutes, 104 councils on that hosting moved at about 0.25 documents a second. By the end, 66 of the 72 council slots held one of these councils. The small ones: the Mac's download link is now close to full; the 36 relay places are held about 10 s each for a 0.5 s relay request; 233 Cloudflare 522 replies; 8 `S3Error` lines that were not retried; 64 relay 429s at the end; Liverpool, Elmbridge and Caerphilly lost to 503 and 504; Merthyr cut off after 504s; Bridgend loops to `mgError.aspx`; the listing records are still read one at a time. |
| C. Where are the bottlenecks? | In order: (1) the 5 shared places for `*.moderngov.co.uk`, nested inside the 36 relay places, which set the last 40 minutes; (2) the Mac's download link, about 5 MB/s, which sets the first 50 minutes and is a floor of about 75 min for a full first read of 22.6 GB; (3) the 36 relay places, full for the first hour. The relay (median 5 of 40 in flight), the CPU (0.9 of 4 cores), the upload link, the bucket and the browser (median 2 of 4 slots) were not the limit. |
| D. How do we take a big leap? | For a full first read, the floor is now the bytes we download. Fix the shared places (items 1 to 3) and the run is about 70 min. Below that, send fewer bytes or run beside the bucket (update 2). For a normal run, which fetches about 5,700 new documents, items 1 to 4 give about 15 to 20 min. The normal run is the one that matters now: a full first read happens only when the store is emptied. |

## The model: what limits a run

| Limit | What it allows | Time it sets for this run | Binding? |
| --- | --- | --- | --- |
| Shared places for `*.moderngov.co.uk` (5), taken before a relay place | 5 / (relay queue wait + request time). With the queue: about 0.25 documents a second. Without it: about 3.2 a second | 6,834 documents on 104 councils. 20:21 to 21:10: 600 documents. 21:10 to 21:52: the rest | **Yes, for the last 40 min** |
| Mac download link | about 5 MB/s (4.1 median, 6.0 peak) | 22.6 GB / 5 MB/s = 75 min | **Likely, for the first 50 min**. A floor for any full first read |
| Relay places in the pipeline (36) | 36 / hold time | Own hosts: 3.7 requests a second x 9.7 s = 36. Full | Yes, as the way the link limit shows |
| Host rate (1 a second, burst 5) and 4 requests at once on a host | 1 document a second for each host | Birmingham: 602 documents in 69 min | No. Host wait is a knock-on of the network queue |
| Relay (nginx) | 40 at once | median 5, peak 33 in flight | No |
| CPU (4 cores) | parse | median 0.9 cores used | No |
| Browser slots | 4 | median 2, peak 4 | No, but near at peaks |
| Upload link and bucket | about 3.3 MB/s up | 0.34 MB/s used; saves in the background | No |

Little's law checks the model, as before.
- 72 councils were in progress all run, each with up to 4 documents in flight: up to 288 documents.
- Documents finished at about 4.5 a second (Grafana stage counts and the read report: 25,713 in 92 min).
- So a document took about 288 / 4.5 = 64 s. The log agrees: 16,279 of the 25,713 documents printed a "Document read" line, which is printed only at 30 s or more. Their median fetch was 39 s and p95 163 s.
- Grafana's stage timers give the split: at any moment about 165 documents were in the network stage, 77 in host wait, 27 in save (background) and 7 in parse.

## A. Issues proven fixed

| Issue | From | Evidence in this run | Verdict |
| --- | --- | --- | --- |
| Raw bytes go up the upload link on the critical path | 15 Oct, Cause 1, items 1 and 2 | `bucket.rawBodies: needed`. 8,606 bodies, 2.15 GiB (p50 65 KB, p99 5.8 MB), against 33,067 and 23.9 GiB. Bucket upload 0.1 to 0.7 MB/s in each 10 min, never flat. Saves run in the background: 27 at once on average, below the cap of 64. | Fixed. |
| One document at a time, a host lock with a 2 s sleep | 15 Oct, Cause 2, item 3 | `documentsAtOnce: 4`, host rate 1 a second, burst 5. 288 documents in flight. Time for each fetched document 0.22 s, against 0.41 s. | Fixed. The next limit shows (Cause 1 and 2). |
| Metrics export fails (598, 413) and histograms are flat | 13, 14 and 15 Oct | 0 `Metrics export failed` lines. Histogram counts grow (about 1,363 documents a 5 min). The last pipeline sample is at 21:51:51Z, the end of the run. | Fixed. Proven. |
| Empty address, one store file | 15 Oct, small issue 1, item 8 | 0 lines with `e3b0c442`. | Fixed. |
| Shropshire reads 0 of 51 | 15 Oct, small issue 5, item 10 | New `base_url`. 40 read and 8 pending scans of 51. | Fixed. |
| Kent lost on service 502 | 15 Oct, small issue 6, item 11 | 6 meetings, 205 documents, 51 read. The other 153 are mostly restricted papers of one appeal panel. | Fixed. Not proven that the browser fallback did it: Kent may just have answered. |
| Warrington lost (no `base_url`) | 13 Oct, item 8 | Listed and read: 67 meetings, 42 documents. | Fixed. |
| The read step waits before it starts | 15 Oct, Cause 4, item 5 | 96 s from "Starting step: read" to "Councils due", against 2.5 min. | Better, not fixed. See small issue 9. |
| Long listing phase | 13, 14 and 15 Oct | 5.5 min, 8 failed requests. | Fixed. |
| Councils start in order of meetings | 15 Oct, Cause 5, item 5 | Order is now by expected documents x councils on the same host. Birmingham ended at 69 min. | Done, but the order does not see shared hosting (Cause 1). |
| Pending scans and lasting unread documents are fetched again | 15 Oct, item 6 | Not tested: the store was emptied, so nothing was known. | Not proven. The next normal run shows it. |
| Night-time gateway errors | 14 Oct, Cause 1 | This run started at 21:12 UK time. 381 gateway replies, against 147 at 14:16. Most are not from councils (Cause 5). | Not comparable. |
| Lost councils from config | 13 Oct, item 8 | Still lost at listing: East Renfrewshire, East Staffordshire, Fife, Inverclyde, Mole Valley, South Ayrshire, and 2 more. Also Cherwell and Newcastle (504), Eastleigh and Leicester (403). | Not fixed. Suffolk and Mole Valley need new listing makers. |

## B. New issues

### Cause 1: shared places for `*.moderngov.co.uk` wait inside the relay queue

This is the main finding of this run.

- `http.sharedHosts` gives every host that ends in `moderngov.co.uk` one pool of 5 request places (`mostRequestsAtOnce: 5`), because many councils share one supplier there.
- In `buildLimitedClient` (`createHttpClient.ts`), a request to such a host takes its shared place first, and then waits for one of the 36 relay places (`relayLimit`). It holds the shared place all the time it waits.
- In the first hour all 36 relay places were full (Cause 2). So each of the 5 shared places spent most of its time in the relay queue.
- 104 councils have documents on `*.moderngov.co.uk`: 6,834 documents, 24% of the run.

| 10 min from (UTC) | Shared-host documents done (printed lines) | Their average network time | Shared-host councils in progress, of 72 |
| --- | --- | --- | --- |
| 20:20 | 68 | 149 s | 14 |
| 20:40 | 122 | 220 s | 20 |
| 21:00 | 139 | 293 s | 29 |
| 21:20 | 963 | 91 s | 43 |
| 21:30 | 1,155 | 90 s | 49 |
| 21:40 | 1,893 | 72 s | 66 |

- Grafana agrees: shared-host relay requests were 30 to 100 a 5 min until 21:00, then 400 to 1,500 as other councils finished and freed the relay places.
- These councils finish slowly, so they pile up in the 72 council slots. By 21:45, 66 of the 72 slots held a shared-host council.
- The ten slowest councils are all on this hosting: Cardiff, Rochdale, Broadland, South Norfolk, Staffordshire Moorlands, High Peak, Lincolnshire, Tower Hamlets, Central Bedfordshire and Buckinghamshire, 80 to 90 min each. Each spent 120 to 140 s in the network stage for each document, against 25 s for Birmingham on its own host.
- Two pairs share one host as well: South Norfolk and Broadland, High Peak and Staffordshire Moorlands. Their host wait was 120 s a document, because two councils with 4 documents each share the host's 4 places.
- Even with no relay queue, 5 places at about 1.5 s a request is 3.3 documents a second. That is 35 min for 6,834 documents, so the pool size is a floor of its own.

### Cause 2: the download link, and the 36 relay places held for 10 s

- The pipeline counts the bytes it downloads (`govbase_pipeline_network_bytes{direction="down"}`). Median 4.1 MB/s, peak 6.0 MB/s, about 22.6 GB in the run. The relay's own sent bytes match it.
- From 20:30 to 21:05 the rate was 4.1 to 6.0 MB/s while all 36 places were full. That is the shape of a full link, as the upload was on 15 Oct. It is likely, not proven: the line's real speed is not measured.
- The relay answers in 0.49 s at p50 and 4.6 s at p95, nearly all of it council time. The relay had only 5 requests in flight at the median.
- The pipeline times the same requests inside its relay place at 6 to 9 s at p50 and 23 to 28 s at p95. The gap of 5 to 8 s is between the relay and the Mac: Cloudflare and the home line.
- Little's law: own-host requests went at about 3.7 a second through 36 places, so each place was held about 9.7 s. 36 bodies at about 0.7 MB each, sharing 5 MB/s, take about 5 s each. That fits.
- So raising `mostRequestsAtOnce` alone does not make a full first read faster. It only moves the queue. 22.6 GB at 5 MB/s is 75 min, whatever the places.
- The 14 Oct normal run fetched 5,710 documents. At this size that is about 4.5 GB, or 15 min of download. A normal run is not bound by the link.

### Cause 3: listing records are still read one at a time

`readDueCouncils` now reads council records 16 at a time, but `readListings` in `createListStore.ts` reads the 382 listing records first with `Effect.forEach` and no concurrency. That is most of the 96 s.

### Cause 4: shared-host councils are not started first

The start order is expected documents x councils on the same host. It counts the host, not the shared pool. So the 104 shared-host councils, which share 5 places, started through the whole run (14 at 20:20, 25 at 21:30, 25 at 21:40), and the last of them set the end.

### Cause 5: most gateway replies are not from councils

- The log has 381 gateway replies: 522: 233, 504: 66, 502: 55, 503: 27.
- The relay counted only about 1 reply a 5 min with a 5xx status. The pipeline counted about 19.
- The 504s are mostly the pipeline's own time limit (`http.timedOutStatus: 504`). Caerphilly `GetMeeting` failed at 30.5 s each time, and Merthyr documents at 66 s. With requests queued on the Mac, a slow council reaches the limit sooner.
- The 522s came from 60 or more hosts, spread over the whole run, with a median of 24 s. 522 is Cloudflare's "the origin did not answer the connection". The relay did not see them. So they are likely Cloudflare failing to open a new connection to the relay box, not the councils.
- A possible cause: nginx keeps idle keep-alive connections from Cloudflare. The relay's "waiting" connections grew from about 155 to 389. nginx on Ubuntu allows 768 connections for each worker by default, and the box has 1 GB of memory and likely one worker. Each proxied request also takes an upstream connection. This is not proven. The nginx error log will show `worker_connections are not enough` if it is the cause.

### Cause 6: relay 429s at the end, and the browser still restarts often

- 64 relay 429 replies, 58 of them from 21:40, all answered in under 3 s, from 20 hosts (Dumfries and Galloway 14, Tunbridge Wells 9, Newark and Sherwood 6). The relay's "refused for rate" count rose to 23 to 34 a 5 min at the end.
- At the end, the relay queue was empty, so hosts were sent at the full host rate. The pipeline's rate and the relay's leaky bucket are close to each other, and retries and redirect hops are not paced, so some requests went over. All were retried, and no final failure is a 429.
- The relay change to 60 a minute is likely deployed: at the old 30 a minute with burst 1, a 1 s gap would give far more 429s. It is not proven.
- Browser: Chrome started 3 to 9 times in each 10 min, and about 118 contexts in each 10 min were closed by a restart from 21:10 to 21:30. With `MAX_REQUESTS_PER_BROWSER=1000` and 3,839 reads, there should be about 4 restarts in the run. So the browser change is likely not deployed yet.

### Smaller issues

1. **`S3Error: an unexpected error has occurred`.** 8 lines for 5 objects: 3 texts and 2 document outcomes, at 20:23 to 20:28. Bun's error has no code from `RETRY_CODES` (`createObjectBucket.ts`), so it was not retried. Three documents were later added to their council records as failures (Perth and Kinross, Buckinghamshire, Tower Hamlets).
2. **Liverpool lost.** Every `GetMeeting` call got 503 in about 1 s, 27 times, at 21:11. Service calls have no browser fallback for 503 (`browserFallbackStatuses.service: [403, 404, 502, 504]`). Liverpool was lost the same way on 13 Oct.
3. **Caerphilly reads 0 of 43, for the fourth run.** `GetMeeting` gets 504 at the 30 s limit, then the host cut-off skips 39 documents. Elmbridge was lost on one `GetMeeting` 504.
4. **Merthyr Tydfil cut off.** Its `GetMeeting` calls took 22 to 28 s and its documents 38 s, then 504 at 66 s. The host cut-off skipped 85 documents. A slow host gets 4 requests at once now, which may make it slower. Derby lost 14 documents the same way after four 502s.
5. **Bridgend loops to `mgError.aspx`.** 8 documents redirect 5 times to `democratic.bridgend.gov.uk/mgError.aspx` and fail as status. Like Shropshire before its move, this needs a check by hand.
6. **Empty files.** Halton 3, Huntingdonshire 2, Richmond 1. The same councils as on 13 Oct.
7. **Connection closed.** 3 documents failed with "The socket connection was closed unexpectedly" while the body came down (North Yorkshire, North Lanarkshire, Fermanagh and Omagh). This is not retried.
8. **No OCR ran.** 598 scans wait in `read/v1/state/pending/`. The `ocr` step has still not been timed. The read report also lists 27 documents with no text.
9. **Started outside the day window.** 21:12 UK time, after 20:00. The gateway counts cannot be compared with the 14:16 run for that reason.

## C. Bottlenecks and where to improve

| Rank | Bottleneck | Share of the run | Evidence |
| --- | --- | --- | --- |
| 1 | 5 shared places for `*.moderngov.co.uk`, held while they wait for a relay place | the last 40 min, about 45% | 66 of 72 slots on shared-host councils at 21:45; 0.25 against 3.2 documents a second |
| 2 | Mac download link, about 5 MB/s | the first 50 min; a floor of about 75 min for a full read | 4.1 to 6.0 MB/s with 36 places full; relay p50 0.49 s against 6 to 9 s in the pipeline |
| 3 | Order of councils does not see shared hosting | part of rank 1 | Shared-host councils started up to 21:40 |
| 4 | Listing records read one at a time | 1.5 min | 96 s before "Councils due" |
| Next | Browser: 4 slots, restarts | 0% now | 4 of 4 at peaks; 3 to 9 Chrome starts in each 10 min |
| Next | Host places for two councils on one host | about 5% | South Norfolk and Broadland, High Peak and Staffordshire Moorlands: 120 s host wait |
| Not a limit | Relay, CPU, upload, bucket | 0% | median 5 of 40 in flight; 0.9 cores; 0.34 MB/s up; saves in the background |

## D. Proposals for a big leap

### What changes the shape now

A full first read moves about 22.6 GB down a home line. That sets about 75 min, whatever the code does. So there are two separate goals:

1. **A normal run** (only new documents) should be bound by host rates, not by our own queues. Items 1 to 5 do this.
2. **A full first read** can only get much faster with fewer bytes (item 10) or with the run beside the bucket and the relay (update 2). It happens only when the store is emptied, so it can wait.

### Top 16 improvements

The percentage is the estimated effect on that measure for a run like this one (a full first read of 25,713 documents). A: wall time. B: failed requests. C: documents not captured. D: documents parsed wrongly. Each estimate assumes the items above it are made first.

| # | Change | Where | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Stop nesting the two limits. Give a shared host its own places that do not also take a relay place, and lower the other pool to match: for example 31 relay places plus 5 shared places, not 5 inside 36. A shared place is then held only for the request itself. Add a test with a full relay pool and one shared request. | `buildLimitedClient`, `buildSharedLimits` in `createHttpClient.ts`, `http.sharedHosts` | -20% | | | |
| 2 | Start councils on a shared host first, and count the shared pool in the order: expected documents x councils in the same pool. Then their 35 min floor runs beside the others, not after them. | `readSortedByWork` in `buildReadStep.ts` | -10% | | | |
| 3 | Raise the `moderngov.co.uk` pool from 5 to 10, as a trial with a config comment, and watch for 429, 503 and 522 from that hosting. Keep the host rate of 1 a second for each council's own host. | `http.sharedHosts[].mostRequestsAtOnce` | -5% | | | |
| 4 | Read the 382 listing records with `recordsAtOnce`. | `readListings` in `createListStore.ts` | -1% | | | |
| 5 | Retry a bucket call on any `S3Error` with no known code, and on a socket closed while the body comes down. | `RETRY_CODES` in `createObjectBucket.ts`, `http.retryStatuses` or the decode error path | | -6 | 6 documents | |
| 6 | Find the 233 Cloudflare 522s. Check the relay's nginx error log for `worker_connections are not enough`. If it is there, set `worker_connections` to 4096 and `keepalive_timeout` lower in the relay config. | `apps/relay/10-govbase-relay.conf` | -2% | -200 replies before retries | | |
| 7 | Count a request that ends at our own time limit as `timed-out`, not as a council 504. Then the run report and Grafana split "the council was slow" from "we waited too long in our own queue". | `http.timedOutStatus`, `createHttpClient.ts`, run report | | | | |
| 8 | Give service calls a browser fallback on 503, for Liverpool. Lower a host to 1 request at once after its first 504, so a slow host such as Merthyr or Caerphilly is not pushed harder. | `moderngov.browserFallbackStatuses.service`, `takeHostTurn` | | -50 | 2 councils, about 130 documents | |
| 9 | Pace retries and redirect hops through the host rate, so the pipeline never sends faster than the relay's 60 a minute. | `takeHostPace`, `buildRetryClient`, `buildFollowingClient` | -1% | -64 replies before retries | | |
| 10 | Measure where the 22.6 GB come from: bytes by document kind and by size band, as a histogram. Then decide on the agenda-pack rule (13 Oct item 16): skip or cut a pack whose item papers are all read. On 11 Oct, 1,402 packs repeated 80% or more of their papers. | `govbase_pipeline_network_bytes`, `readCouncilMeetings.ts` | up to -30% on a full read, not proven | | | -20% |
| 11 | Measure the Mac's line: one speed test, written into this doc. If the line is about 40 Mbit/s, item 10 or update 2 is the only way to a full read under 60 min. | owner | | | | |
| 12 | Deploy the browser change and check that Chrome starts about 4 times in a run of this size. | `apps/browser`, `update.sh` | -2% | | | |
| 13 | Check Bridgend's `mgError.aspx` redirect by hand, as was done for Shropshire. | `config/sources.yaml` | | -8 | 8 documents | |
| 14 | Run the `ocr` step on the 598 pending scans, and measure pages an hour with 3 readers. Carried from 15 Oct item 15. | `bun run dev:step:ocr` | | | 598 documents | |
| 15 | Fill in `sources.yaml` for the 8 councils with no reader, address or documents, and add listing makers for Suffolk and Mole Valley. Carried from 13 Oct item 8. | `config/sources.yaml`, new listing makers | | | 8 councils | |
| 16 | Run the next read in the day, and as a normal run (do not empty the store). That proves 15 Oct item 6 (known documents are not fetched again) and gives a fair gateway count. | owner | | | | |

### What the items add up to

- **A full first read like this one.** Items 1 to 4 let the shared-host councils run beside the others, so the end is set by the download link: about **70 min, against 99 min** (list 5.5 plus read about 65). Below that needs item 10 or update 2.
- **A normal run** (about 5,700 new documents, about 4.5 GB): about **15 to 20 min**, most of it listing and the shared-host pool.
- After that, the limits are the host rates of the biggest councils (Birmingham: 602 documents at 1 a second is 10 min) and the browser's 4 slots.

## What the next run should show

- [ ] No more than 10 shared-host councils in progress at any time after the first 10 min, and the slowest council under 30 min.
- [ ] Pipeline relay request p50 under 2 s while the relay p50 is under 1 s.
- [ ] Read step under 70 min for a full read, or under 20 min for a normal run.
- [ ] Documents known on a normal run close to the documents read before, and pending scans not fetched again.
- [ ] No `S3Error` line, and no 522 that the relay did not see.
- [ ] No relay 429.
- [ ] Liverpool, Caerphilly and Merthyr read, or the cause written down as a council outage.
- [ ] Chrome starts 4 to 6 times in the run.
- [ ] The `ocr` step runs on the pending scans, with its pages an hour written down.
- [ ] Started between 08:00 and 20:00 UK time.

## Checklist from the 15 Oct afternoon retrospective

| Item | Result |
| --- | --- |
| Raw bytes saved under 3 GiB for a full run | Done: 2.15 GiB. |
| Bucket upload rate never flat at its peak for more than 10 min | Done: 0.1 to 0.7 MB/s. |
| Printed fetch times under 10 s while the relay p50 is under 1 s | Not done: printed median 39 s, relay p50 0.49 s. Cause 1 and 2. |
| Read step under 30 min, slowest council under 25 min | Not done: 92 min and 90 min. Cause 1. |
| No `e3b0c442` line and no `S3Error` line | Half: no `e3b0c442`; 8 `S3Error` lines (small issue 1). |
| No `Metrics export failed` line, and the histogram panels draw lines | Done. |
| Shropshire reads its documents; Kent and Caerphilly are read | Shropshire and Kent done. Caerphilly not (small issue 3). |
| The `ocr` step runs on the pending scans | Not done. |
| Started between 08:00 and 20:00 UK time | Not done: 21:12. |

## Sources

- `apps/pipeline/data/logs/list-2026-10-15T20-12-56Z.log` (547 lines) and `apps/pipeline/data/logs/read-2026-10-15T20-19-35Z.log` (28,497 lines).
- `gcloud storage ls -l -r gs://govbase-pipeline-documents-dev/` on 2026-10-16: 85,109 objects, 2.48 GiB.
- Grafana Cloud `friendlymule476.grafana.net`, dashboards govbase-pipeline, govbase-browser and govbase-relay, 2026-10-15 20:10Z to 21:55Z, and 13:10Z to 16:30Z for comparison, through the Prometheus API.
- Code: `src/infrastructure/createHttpClient/createHttpClient.ts` (`buildLimitedClient`, `buildSharedLimits`), `src/infrastructure/createModernGovClient/createModernGovClient.ts` (`takeHostTurn`, `takeHostPace`), `src/infrastructure/createObjectBucket/createObjectBucket.ts` (`RETRY_CODES`), `src/infrastructure/createListStore/createListStore.ts` (`readListings`), `src/domain/buildReadStep/buildReadStep.ts`, `src/domain/readCouncilMeetings/readCouncilMeetings.ts`, `config/development/config.yaml`.
- `docs/read-run-2026-10-13-retrospective.md`, `docs/read-run-2026-10-14-retrospective.md`, `docs/read-run-2026-10-15-retrospective.md`.
