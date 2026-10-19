# Read run 2026-10-13: retrospective

Run `2026-10-13T13-16-26-462Z`. Started 13:16Z on 13 Oct, finished 08:41Z on 14 Oct.
Log: `apps/pipeline/data/logs/read-2026-10-13T13-16-24Z.log`.
Run report: `gs://govbase-pipeline-text-dev/bundles/2026-10-13T13-16-26-462Z/run-report.json`.
Written 2026-10-14 from the log, the run report, the failure files, the raw bucket listing and the three Grafana dashboards.

| Measure | Value |
| --- | --- |
| Wall time | 1,164 min (19.4 h) |
| Councils | 382 in run, 369 read, 13 lost |
| Meetings | 7,155 read, 22 lost |
| Documents | 57,460 listed, 53,839 read (93.7%), 3,621 unread |
| Failed requests (final, retries not counted) | 896, plus 43 skipped by a host cut-off |
| Documents read with OCR | 991 documents, 8,310 page images |
| Documents read through the browser | 3,816 |
| Council time, all councils added up | 1,123 h |

## Questions and short answers

| Question | Short answer |
| --- | --- |
| A. Why so long? | The run was bound by OCR. 991 scanned documents (8,310 pages) went through 2 OCR readers, one document at a time, at about 16 s a page. That is about 18 h of OCR work, and the run ended when that backlog drained. Each council reads its documents one after another, so 27 big councils waited 14 to 19 h on the OCR queue. The relay and the browser were mostly idle. Every document was fetched, because the text bucket was new. |
| B. How many requests failed, and why? | 896 final failures and 43 skipped. 857 of the 896 (96%) are one bug: the relay sends a decoded path, so any document URL with `%20` reaches the council as a raw space and gets a 400. |
| C. How many documents did we not capture? | 3,621 unread (6.3%), plus every document of 22 lost meetings and 13 lost councils. 2,491 are ModernGov items marked restricted, 857 are the `%20` bug, 123 scans gave no text, 79 are over 50 MB. 9 of the 13 lost councils are missing config in `sources.yaml`. |
| D. What did we parse wrongly? | Measured signals only: 123 no-text scans, 17 OCR pages scaled to nothing, 1 garbled, 2 broken files, 2 link-only. The OCR page time limit and the 60-page cap also cut text out of long scans. Text quality of the 53,839 read documents was not sampled in this retrospective. |

## A. Why it took so long

### Timeline

| Hours after start | What happened |
| --- | --- |
| 0:00 to 0:32 | Listing only. Own-site and CMIS listings read up to 120 meeting pages each through the relay. No document was read before 13:48Z. |
| 0:32 to 4:30 | Fetch burst. 72 councils at once. 2,909 slow document reads in one hour. Relay places in use peaked at 17 of 40. |
| 4:30 to 12:00 | Browser reads peak at about 500 an hour. OCR queue full. 20 to 30 councils finish an hour. |
| 12:00 to 19:00 | Tail. 27 councils that started in the first batch are still waiting on OCR. Relay at about 1 request a second. |
| 19:13 to 19:24 | Second pass: 16 councils, 66 of 116 failed requests recovered. |

Council durations: p50 60 min, p75 188 min, p90 560 min, p95 992 min, max 1,121 min.
The ten slowest councils (Dudley, South Lanarkshire, West Dunbartonshire, Moray, Norwich, Fermanagh and Omagh, Angus, Sunderland, Renfrewshire, North Lanarkshire) each took over 1,060 min and each has 800 to 1,966 documents.

### Cause 1: OCR is the critical path

- 991 documents needed page images. 8,310 pages. `imageReadersAtOnce` is 2, so two documents are read at once, one page at a time (`apps/parser-sdk/src/pdf/readPdf.ts:152`, `takeTurn`).
- The log only prints a document when fetch plus read takes 30 s or more. 987 documents took over 30 s to read. 942 took over 2 min. 642 took over 30 min. The longest took 146 min. Their read times add up to 742 h, which is queue waiting.
- Grafana pipeline dashboard: "Documents parsing now" rose from 0 at 13:50Z to 49 at 17:42Z and never fell before the metric stopped.
- OCR documents finished at a flat 40 to 90 an hour from 14:00Z to 07:00Z. That is the OCR throughput, about 460 pages an hour, about 16 s a page a reader. The run ended an hour after the last OCR document.

### Cause 2: a council reads its documents one at a time

- `readCouncilMeetings.ts:439` reads the documents of an agenda item with `Effect.forEach` and no concurrency. Meetings are read in order too.
- Moray: 1,966 documents, 1,111 min, so 34 s a document. A scanned document in the chain blocks the whole council until its OCR turn comes.
- So 72 councils at once gave 72 chains, each stuck behind its slowest document.

### Cause 3: in-process OCR starves the fetches

- 7,844 documents reported a fetch of 30 s or more (103 h added up). But the relay dashboard shows request time p95 of 2 to 8 s after 15:00Z, and places in use never above 17 of 40.
- The pipeline fetch clock includes the time the main thread was busy drawing pages and running Tesseract. Memory on the Mac was 9.2 GiB RSS at 17:46Z and rising.

### Cause 4: first run against the new text bucket

- Every one of 53,839 documents was fetched and parsed. A normal run reuses documents from the last manifest. The 11 Oct run read 21,524.
- Own-site and CMIS councils list up to 120 meetings each run (`mostSiteMeetings`, `mostCmisMeetingPages`), so they listed 800 to 1,966 documents each.

### Cause 5: documents read through the browser

- 3,816 browser reads: 3,774 document files, 29 service calls, 7 feeds, 6 listing pages. 204 came after a relay 403, 49 after a block page, and 3,500 were on the 62 hosts that are now read browser-first.
- Browser read p95 was 40 to 70 s in the busy hours. Chrome restarted 40 to 50 times between 15:00Z and 04:00Z, about every 10 to 20 min.
- The browser was not saturated: slots in use were 1 or 2 of 4 most of the time, because each council sends one request at a time.

### Smaller causes

- The listing phase took 32 min before the first document was read.
- The relay rate limit is 30 requests a minute a host with burst 1. 99 log lines mention a 429.
- The second pass took 11 min and recovered 66 of 116.

## B. Failed requests

Final failures, not counting retries that later worked: 896. Skipped by a host cut-off: 43.
Request-level non-2xx replies before retries: 1,417 (400: 858, 403: 248, 522: 154, 502: 71, 504: 53, 404: 12, 503: 4, 429: 4, no status: 13). 266 retries were sent.

| Class | Count | Cause |
| --- | --- | --- |
| status 400 | 857 | The relay captures the path from nginx's decoded `$uri` (`apps/relay/govbase-relay:63`) and sends it with `proxy_pass https://$relay_host$relay_target_path` (`relay-proxy.conf:8`). A URL with `%20` reaches the council with a raw space. The council's own nginx or IIS answers "400 Bad request". Hosts: valeofglamorgan 489, east-ayrshire 196, cannockchase 61, angus 53, eastcambs 33, eastlothian 20, and 5 more. Every one of the 857 URLs has `%20` in its path. |
| blocked 403 | 12 | Eastleigh (8) and Leicester (2) block the relay and the browser timed out or got the block page too. Camden feed 403 was recovered by the browser. |
| gateway | 11 | Caerphilly `GetMeeting` 504 after 15 s (3, then 6 skipped), Cherwell 502 (3, then 1 skipped), Liverpool 503 (1), 4 others. The service calls have no browser fallback for 502 or 504. |
| gone 404 | 9 | Old links, such as a 2019 Antrim agenda. |
| empty 200 | 5 | Huntingdonshire 3, Amber Valley 1, Richmond 1: a 200 with no body. |
| parse 200 | 2 | Trafford "zzTestNewServers" and a Brighton panel: the reply holds no meeting. |
| skipped | 43 | Shropshire 34, Caerphilly 6, Eastleigh 2, Cherwell 1: not sent after 3 failures in a row on the host. |

Browser results: read 3,816, failed 11 (timed out), blocked 6, unreachable 5.

## C. Documents not captured

Unread: 3,621 of 57,460.

| Reason | Count | What it is |
| --- | --- | --- |
| restricted | 2,491 | All on ModernGov councils, from the `isrestricted` flag in the meeting XML. Top: Kent 153, Westminster 112, BCP 70, Cornwall 69, St Helens 69, City of London 64, Trafford 63, Cheshire West 62. These are likely real exempt papers, but no sample was checked to see whether the XML still links a public file. |
| status | 857 | The `%20` relay bug above. |
| no-text | 123 | 82 ModernGov, 35 CMIS, 5 own-site. Scans where OCR found fewer than `leastImageWords`, or a page hit the 300 s `imageWaitInSeconds` limit. Dumfries and Galloway 17, Teignbridge 7. |
| too-large | 79 | Over `largestDocumentBytes` 50 MB. Chelmsford 9, South Lanarkshire 7, Hull 6, Great Yarmouth 6, Angus 6, Rugby 6. Agenda packs of 55 to 82 MB. |
| skipped | 34 | Shropshire, after the host cut-off. |
| not-supported | 13 | Audio, video and other non-document files. |
| gone | 9 | 404. |
| blocked, empty | 10 | Norwich 3 and Hull 2 block pages; 5 empty replies. |
| broken-file, garbled, link | 5 | Two unreadable PDFs, one garbled text, two link-only documents. |

Lost meetings: 22. Caerphilly 9 (service 504s, then cut-off), Eastleigh 5 (403, browser timed out), Cherwell 4 (502, then cut-off), Surrey 1 (block page 200, browser unreachable), Liverpool 1 (503), Trafford and Brighton 2 (test meetings with meeting id 0).

Lost councils: 13.
- Config, 9: East Renfrewshire, Fife, Inverclyde, South Ayrshire have `system: unknown`; East Staffordshire, South Tyneside, Warrington have no `meetings.base_url`; Mole Valley and Suffolk have no `meetings.documents`.
- Blocked, 2: Leicester (403 block page, browser blocked), Eastleigh.
- Gateway, 2: Caerphilly (every service call 504), Cherwell (502 three times, then cut-off).

## D. Documents parsed wrongly

What the run measured:
- 123 scans gave no text, and 1 gave garbled text. The 300 s page limit and the 60-page cap (`mostImagePages`) drop pages from long scans without marking the document.
- 17 OCR pages failed in Leptonica with "pixScaleAreaMap: pixd too small" after a scale factor of 0.019. A very large page image was shrunk to nothing, so those pages read as blank.
- 2 broken files, 2 link-only documents, 5 empty replies.
- 991 documents were read by OCR at `imageScale` 3. Their word confidence is not in the log or the run report.
- From the 11 Oct raw join: 1,402 agenda packs repeat 80% or more of their item papers. The same text is parsed and stored twice.

Not measured here: the text quality of typed PDFs and HTML, such as broken tables, headers repeated as body text, or split paragraphs. That needs a sample of blocks from the text bucket.

## Observability gaps seen in this run

- The pipeline's own metrics stopped at about 17:50Z on 13 Oct, five hours into a 19-hour run. The log kept going. "Run finished", "Councils in run" and "Councils lost" showed no data. Four panels drew no lines: time to read one council, document fetch time, document parse time, relay request time by status.
- The browser and relay dashboards ran all night and matched the log.

## Top 20 improvements

The percentage is the estimated effect on that measure if the change had been in this run. A: wall time. B: failed requests. C: documents not captured. D: documents parsed wrongly. The estimates assume the changes above it in the list are made first.

| # | Change | Where | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Build the upstream path from the raw `$request_uri`, not the decoded `$uri`, so `%20` survives. Add a relay test with a space in the path. | `apps/relay/govbase-relay:63`, `relay-proxy.conf:5` | -1% | -96% | -24% | |
| 2 | Run OCR in worker threads with 6 to 8 readers, not 2 on the main thread. | SDK `createReadGuard`, pipeline `textReading.imageReadersAtOnce` | -50% | | | |
| 3 | Read the documents of a council with concurrency 4, not one at a time. | `readCouncilMeetings.ts:439` | -25% | | | |
| 4 | Keep the known-document reuse working against the bucket, so a normal run fetches only new documents. Check the next run reads far fewer than 53,839. | `readKnownDocuments`, `createTextBucket` | -60% on a normal run | | | |
| 5 | Cap OCR at 20 pages a document and skip OCR for meetings older than the feed window. Mark the document "partly read" when pages are dropped. | `textReading.mostImagePages`, SDK `readPdf.ts` | -10% | | | -30% |
| 6 | Fix the metrics exporter that stopped at 17:50Z, and make the four empty panels draw. | `createMetrics`, `grafana/` | | | | |
| 7 | Set `councilsAtOnce` back to 36 and `mostRequestsAtOnce` to 18 until memory is under 4 GiB. RSS was 9.2 GiB and rising at 17:46Z. | `config/*/config.yaml` | 0% now, prevents a kill | | | |
| 8 | Fill in `sources.yaml` for the 9 councils with no reader, no base URL or no documents. | `config/sources.yaml` | | | 9 councils | |
| 9 | Give service calls (`GetMeeting`) a browser fallback on 502, 503 and 504, and do not cut off a host on service 5xx. | `moderngov.browserFallbackStatuses.service` | | -1% | 14 meetings, 2 councils | |
| 10 | Fetch documents on the 62 browser-first hosts with one `fetch()` inside the browser context, not one page load each. | `apps/browser`, `createBrowserSession` | -10% | | | |
| 11 | Raise the browser's `pagesAtOnce` to 8 once councils send more than one request at a time. | `browser.pagesAtOnce` | -5% | | | |
| 12 | Check a sample of 30 restricted ModernGov items. If the XML links a public file, read it. | SDK `readMeetingXml.ts:35` | | | up to -69% | |
| 13 | Raise `largestDocumentBytes` to 150 MB and read only the first 60 pages of a pack over 50 MB. | `moderngov.largestDocumentBytes` | | | -2% | |
| 14 | Fix the OCR scale rule so a huge page image is scaled to `largestImageSide`, never below it. | SDK `buildImageScale`, `textReading.largestImageSide` | | | | 17 pages |
| 15 | Raise the browser challenge wait for Eastleigh and Leicester, or route them through the browser first. | `browser.challengeWaitInMs`, `browserFirstHosts` | | -1% | 7 meetings, 2 councils | |
| 16 | Skip an agenda pack whose item papers are all read, or parse it and drop blocks that repeat an item paper. | `readCouncilMeetings`, SDK blocks | -10% | | | -20% |
| 17 | Raise the relay rate limit to 60 a minute a host with burst 5, matched by the pipeline's host gap. | `10-govbase-relay.conf:39`, `govbase-relay:67` | -3% | | | |
| 18 | Cache own-site and CMIS listings by ETag or last-modified, and stop listing a meeting whose documents are all known. | `readOwnSiteListing`, `readCmisListing` | -3% | | | |
| 19 | Do not skip documents after 3 service failures on the host; only skip service calls. | `createModernGovClient` host cut-off | | -5% | -1% | |
| 20 | Stop the browser's Chrome restart every 10 to 20 min, or make it restart between reads only. | `apps/browser` restart rule | -2% | | | |

Together, items 1 to 5 and 10 would bring a first run like this one from 19.4 h to about 4 to 5 h, and a normal run to under 2 h. Item 1 alone removes 96% of failed requests and a quarter of the uncaptured documents.

## What the next run should show

- [ ] No status 400 on a URL with `%20`.
- [ ] "Documents parsing now" under 20 all run, and no document read over 10 min.
- [ ] Documents read far below 53,839.
- [ ] Pipeline metrics present to the end of the run.
- [ ] Councils lost under 5.

## Sources

- `apps/pipeline/data/logs/read-2026-10-13T13-16-24Z.log` (26,479 lines).
- `gs://govbase-pipeline-text-dev/bundles/2026-10-13T13-16-26-462Z/run-report.json`.
- `apps/pipeline/data/failures/2026-10-13T13-16-26-264Z/` (936 files).
- Grafana dashboards govbase-pipeline, govbase-browser, govbase-relay, 2026-10-13 13:00Z to 2026-10-14 09:00Z.
- `apps/relay/govbase-relay`, `apps/relay/relay-proxy.conf`, `apps/parser-sdk/src/pdf/readPdf.ts`, `apps/pipeline/src/domain/readCouncilMeetings/readCouncilMeetings.ts`.
