# Read run 2026-10-14: retrospective

Run `2026-10-14T23-19-00-011Z`. Started 23:19Z on 14 Oct, finished 02:07Z on 15 Oct.
Log: `apps/pipeline-run/data/logs/read-2026-10-14T23-18-57Z.log`.
Run report: `gs://govbase-pipeline-text-dev/bundles/2026-10-14T23-19-00-011Z/run-report.json`.
Code: pipeline `4f90f2f`, relay `4a9dc69`, parser SDK `8db2733` (tag `v0.5.0`). The run before it, `2026-10-13T13-16-26-462Z`, used pipeline `0afb821`, relay `db64681` and SDK `v0.4.0`.
Written 2026-10-15 from the log, the failure files, the three Grafana dashboards and the diffs of the three commits.

| Measure | 13 Oct run | 14 Oct run |
| --- | --- | --- |
| Started (UK time) | 14:16 | 00:19 |
| Wall time | 1,164 min (19.4 h) | 168 min (2.8 h) |
| Councils | 382 in run, 369 read, 13 lost | 382 in run, 368 read, 14 lost |
| Meetings listed | 7,155 read, 22 lost | 5,853 listed, 5,856 read, 13 lost |
| Documents listed | 57,460 | 45,300 |
| Documents fetched and parsed | 53,839 | 5,710 (38,100 reused from the last run) |
| Failed requests (final) | 896, plus 43 skipped | 68, plus 24 skipped |
| Relay 502, 503, 504 replies (before retries) | 128 | 316 |
| OCR page images read | 8,310 | 816, plus 74 dropped by the 60-page cap |
| OCR readers | 2, on the main thread | 4, in worker threads |
| Browser reads | 3,816 read, 11 failed | 1,119 read, 38 failed |
| Second pass | 11 min, 66 of 116 recovered | 51 min, 124 of 159 recovered |
| Peak pipeline memory (RSS) | 10.1 GB | 6.2 GB |

## Questions and short answers

| Question | Short answer |
| --- | --- |
| A. Did the three commits make the run worse? | No, not in total. Wall time fell from 19.4 h to 2.8 h and final failures fell from 896 to 68. The "worse" lines in the report step's comparison (meetings read -1,299, documents read -9,562, councils lost +1) are not losses. The feed window was 1 to 2 days, not 7, so fewer meetings were listed. 38,100 documents were reused and not fetched again. |
| B. So what did get worse? | Six things. (1) Gateway errors rose from 128 to 316 because the run started at 00:19 UK time, when many ModernGov hosts were slow. (2) That filled the browser's 4 slots with feed reads that timed out, so browser failures rose from 11 to 38 and Camden was lost. (3) The second pass took 51 min, 30% of the run, mostly on one slow host, Newcastle. (4) Each OCR reader got about 35% slower: 4 readers on a 4-core Mac give only about 45% more pages an hour than 2 readers did. (5) Small scans waited up to 17 min in the OCR queue and held their council. (6) Fetches still took 40 to 50 s while the relay answered in 0.4 s. |
| C. Which of the changes worked? | The relay `%20` fix worked: status failures fell from 857 to 8, and none of the 8 is an encoding fault. The metrics export fix worked: every pipeline metric ran to the end of the run, and "Run finished", "Councils in run" and "Councils lost" now draw. Moving OCR into worker threads did not stop the fetch stall. It moved the stall from the main thread to the CPU. |
| D. Which causes come from our code, and which from the councils? | From the councils and the time of day: the gateway errors, Newcastle, Caerphilly and Cherwell. From our code: 4 OCR readers on 4 cores, one OCR queue in arrival order, documents read one at a time in a council, 120 s relay timeouts with 3 tries in the second pass, and the 4 browser slots. Item 4, OCR readers, came from the SDK commit and the `imageReadersAtOnce: 4` change in the pipeline commit. |

## A. Why the headline numbers look worse

### The comparison is not like for like

- The 13 Oct run was the first run against the new text bucket, so it read every document. The 14 Oct run reused 38,100 documents (`govbase_pipeline_documents_total{outcome="known"}`) and fetched only 5,710.
- The report step counts reused documents as "read". So "Documents read: 53,839 -> 44,277" compares 53,839 fetches with 5,710 fetches plus 38,567 reused documents.
- ModernGov feeds ask for a date range from the last run. On 13 Oct the range was 7 days (`DR=06/10/2026-13/10/2026`). On 14 Oct it was 1 to 2 days (`DR=13/10/2026-14/10/2026`). So 5,853 meetings were listed, not 7,155, and 45,300 documents, not 57,460.
- Restricted documents fell from 2,491 to 821 for the same reason: fewer meetings were listed.
- A fair measure is time for each fetched document in the read phase. The 13 Oct run took 1.17 s for each document (1,121 min for 57,460). The 14 Oct run took 0.92 s (91 min, 23:45Z to 01:16Z, for 5,907 fetched and failed). That is 21% better, with a larger share of the time spent on councils with scans.

### Timeline

| Time (UTC) | What happened |
| --- | --- |
| 23:19 to 23:45 | Listing. 92 relay 502 and 504 replies in 23:20 to 23:30, nearly all from ModernGov `mgRss.aspx` feeds. 20 browser fallbacks failed in the same 10 min. 17 councils could not be listed; 9 of them were listed again after 60 s. |
| 23:45 to 00:45 | 72 councils read at once. Fetches that the log prints took 40 to 48 s on average. The relay answered in 0.4 to 0.5 s (p50). OCR queue full from 23:50. "Documents parsing now" peaked at 19. |
| 00:45 to 01:16 | Councils being read fell from 72 to 22, then to 1. Slow fetches stopped. Slowest councils: South Derbyshire 91 min, Bristol 91 min, Vale of Glamorgan 87 min. |
| 01:16 to 02:07 | Second pass: 27 councils, 159 failed requests. Newcastle alone ran from 01:16 to 02:07. |

## B. What got worse, and why

### Cause 1: the run started at 00:19 UK time

- The 13 Oct run started at 14:16 UK time. This run started at 00:19 UK time.
- Relay 502, 503 and 504 replies before retries: 128 in 19.4 h on 13 Oct, 316 in 2.8 h on 14 Oct. 227 of the 316 came after 60 to 119 s, 16 after the full 120 s.
- They came from many ModernGov hosts at once, many of them on the shared `*.moderngov.co.uk` hosting: Cherwell 27, Newcastle 26, Caerphilly 21, Ealing 16, Denbighshire 14, Rochdale 10, Gateshead 9, Blaenau Gwent 9, and 30 more hosts. Many separate councils failing in the same minutes points at the time of night, not at our code. The relay change only touched the path, and the failing URLs have no encoded characters.
- This is likely nightly upkeep on the council side, but the run did not prove it. A daytime run with the same code will show it.

### Cause 2: the browser slots filled with feeds that timed out

- 20 of the 38 browser failures came in the first 11 min of the run, all on `mgRss.aspx` feeds. 20 came after a relay 504, 9 after a 403, 6 after a block page, 6 after a 404.
- Grafana browser dashboard, 23:00 to 23:30: fetches in flight hit 4 of 4, and the browser read p50 was 46 s and p95 98 s. After that, p50 was 0.3 s.
- Each failed feed held a slot for the 30 s `goto` timeout. So a council waiting behind them ran out of time.
- Camden was lost this way. The relay got a 403 on its feed at 23:19:09. The browser timed out at 23:19:39. The second try at 23:20:42 ended with "the browser read did not end within 1m 30s". On 13 Oct the browser recovered the same Camden feed.
- Lancashire (8) and Shropshire (6) failed later on documents, with `get: Timeout 30000ms exceeded`.

### Cause 3: the second pass is slow on one slow host

- The second pass took 51 min, against 11 min on 13 Oct. It recovered 124 of 159.
- Newcastle answered most requests after 66 to 120 s, or with 504 at 120 s. Every request had up to 3 tries. Its documents are read one at a time. So one document could take 6 min, and the council ran from 01:16 to 02:07.
- Grafana relay dashboard: request time p50 was 120 s at 02:00, because Newcastle was the only traffic.
- Caerphilly and Cherwell `GetMeeting` 504s and 502s came back in the second pass, as on 13 Oct.

### Cause 4: 4 OCR readers on a 4-core Mac

- SDK `8db2733` moved OCR into worker threads (`createScanReaders`, `runScanReader`). Pipeline `4f90f2f` raised `imageReadersAtOnce` from 2 to 4.
- The Mac has 4 cores. Four readers each draw pages with pdf.js and run Tesseract, so they use all 4 cores. The main thread, the GCS calls and gzip then share those cores.
- OCR throughput (`govbase_pipeline_page_images_total`): 13 Oct about 450 to 540 pages an hour with 2 readers. 14 Oct peak 662 pages an hour with 4 readers. So twice the readers gave about 25% to 45% more pages. Each reader went from about 16 s a page to about 22 s a page.
- A PDF that needs OCR is also parsed twice now. `readWholeDocument` in `createTextReader.ts` runs the typed parse on the main thread first. If it finds pages that want images, it sends the whole file to a scan reader, which opens and parses it again. The bytes are copied into the worker too (`pdfBytes.slice()` and `postMessage`).

### Cause 5: one OCR queue, and a council waits for its scan

- The scan readers take whole documents in arrival order. A 60-page agenda pack holds a reader for up to 20 min. A 1-page scan behind it waits.
- Vale of Glamorgan: a 1-page scan took 995 s (16.5 min) and a 2-page scan took 849 s. Bradford: a 1-page scan took 207 s and a 4-page scan took 1,046 s.
- Average time a page spent in the reader, queue included: 11 s at 23:50Z, 78 s at 00:20Z, 137 s at 00:40Z.
- `readCouncilMeetings.ts:439` still reads the documents of an agenda item one at a time, so the council stops until its scan is done. This was Cause 2 of the 13 Oct retrospective and is not fixed yet.
- The three slowest councils spent 30 to 48 min of their 90 min waiting on OCR reads: South Derbyshire 30 min (134 pages), Bristol 39 min (54 pages), Vale of Glamorgan 31 min (3 pages).

### Cause 6: the fetch stall is still there

- The log prints a document when fetch plus read takes 30 s or more. 546 fetches took 30 s or more, 9% of the 5,907 sent. On 13 Oct it was 7,844 of 57,460, 14%.
- From 23:40Z to 00:30Z the average printed fetch was 40 to 48 s. The relay p50 was 0.4 to 0.5 s and the browser p50 0.3 s. The slow fetches were spread over every host: Babergh Mid Suffolk, Bristol, East Ayrshire, Sandwell, High Peak, Angus and more.
- The slow fetches stopped at 00:50Z. That is when councils being read fell from 72 to 22 and "Documents parsing now" fell from 18 to 4.
- So the time is spent inside the pipeline, not at the relay. The worker threads took page drawing off the main thread, but the 4 readers now take the CPU. The fetch clock in `readCouncilMeetings.ts:380` also covers the raw save to the bucket and the wait for a request place. The run has no metric that splits these, because the fetch histogram does not work (see below).

### Smaller things

- Listing took 26 min, against 32 min on 13 Oct. 17 councils failed the first listing; 9 were listed again after 60 s.
- 11 log lines mention a 429.
- 1 OCR page still failed with "pixScaleAreaMap: pixd too small" (item 14 of the 13 Oct list, not done).
- Rossendale: 4 documents gave 404 and a fifth was skipped by the host cut-off. These URLs hold `%2F` and `%2520`, so the relay fix was checked. It is not the cause. Rossendale answers 404 for document id 12236 in every form, also with no file name, and 200 for a live id with `%2520` in it. The links are old.

## C. Did the fixes work?

| Fix | Commit | Result |
| --- | --- | --- |
| Send the raw `$request_uri` path, so `%20` stays encoded | relay `4a9dc69` | Worked. Status failures 857 -> 8: 7 Kensington and Chelsea 500s and 1 Comhairle nan Eilean Siar 500. None has an encoded character. |
| Cut off a metrics export after 30 s, log it, go on | pipeline `4f90f2f` | Worked. Memory, councils, documents and run totals ran to 03:00Z. No "Metrics export failed" line in the log. |
| OCR in worker threads | SDK `8db2733` | Partly. The main thread no longer draws pages. But the stall moved to the CPU, and each PDF that needs OCR is parsed twice. |
| `imageReadersAtOnce` 2 -> 4 | pipeline `4f90f2f` | Partly. 25% to 45% more pages an hour, not 100%. Too many for 4 cores. |
| Pages past `mostImagePages` are listed | SDK `8db2733` | Worked. 74 page images were logged as "not read, over mostImagePages". |

## D. Failed requests and documents not captured

Final failures: 68 (gateway 34, blocked 14, gone 10, status 8, empty 2). Skipped by a host cut-off: 24 (Shropshire 17, Caerphilly 5, Cherwell 1, Newcastle 1).
Request-level replies before retries: 504: 272, 403: 127, 502: 40, 522: 23, 500: 17, 404: 13, 503: 4, 429: 4, 520: 1. 257 retries were sent.

Unread: restricted 821, too-large 78, no-text 63, skipped 18, not-supported 10, gone 10, blocked 8, status 7, gateway 4, empty 2.

Lost councils: 14. The 13 from 13 Oct (9 config, Leicester and Eastleigh blocked, Caerphilly and Cherwell gateway), plus Camden (Cause 2).
Lost meetings: 13. 11 still lost from 13 Oct (Caerphilly, Cherwell), plus Caerphilly 15507 and Newcastle 15304. 11 were fixed, among them 5 Eastleigh meetings and Surrey Cabinet.

## Observability gaps seen in this run

- The four histogram panels still draw nothing: time to read one council, document fetch time, document parse time, relay request time by status. Their `_count` series stay at 1, 2 or 4 for the whole run, so `rate()` gives nothing. The export fix did not reach these. A histogram that never grows points at how `createMetrics` builds or tags them.
- There is no CPU metric for the Mac. Cause 4 and Cause 6 cannot be proved without one.
- There is no metric for time spent waiting for an OCR reader, or for a request place, or for the raw save.

## Top 12 improvements

The percentage is the estimated effect on that measure for a run like this one. A: wall time. B: failed requests. C: documents not captured. D: documents parsed wrongly.

| # | Change | Where | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Run in the day, or after 02:00 UK time, not just after midnight. Compare one daytime run with this code before any other change. | launchd plist, `dev:run` | -10% | -40% | 1 council | |
| 2 | Set `imageReadersAtOnce` to 3 on a 4-core Mac, so one core stays free for fetching and typed parsing. | `config/*/config.yaml` | -10% | | | |
| 3 | Keep the typed read in the scan reader: send a PDF that needs OCR to the worker with the pages already found, and do not parse it again. | SDK `createTextReader.ts`, `readWholeDocument` | -5% | | | |
| 4 | Read the documents of a council with concurrency 4, so a scan does not stop the council. Carried over from the 13 Oct list, item 3. | `readCouncilMeetings.ts:439` | -25% | | | |
| 5 | Give the OCR queue two lanes: short scans (up to 5 pages) and long ones, so a 1-page scan does not wait 17 min. | SDK `createScanReaders.ts` | -10% | | | |
| 6 | In the second pass, read the documents of a host at the same time as other hosts, and give up on a host after 2 timeouts of 120 s. | second pass, `createModernGovClient` | -25% | | | |
| 7 | Do not use the browser for a feed after a relay 504. A 504 is a slow council, not a block. Use it only after 403 and block pages. | `moderngov.browserFallbackStatuses.feed` | | -30% | 1 council | |
| 8 | Raise the browser's `pagesAtOnce` from 4 to 8 for the listing phase, or cut the `goto` timeout for feeds to 15 s. | `browser.pagesAtOnce`, browser `goto` timeout | -2% | -10% | 1 council | |
| 9 | Fix the four histograms so their counts grow. Add a test that records two values and reads a count of 2. | `createMetrics`, `grafana/` | | | | |
| 10 | Add Mac CPU, OCR queue wait and request place wait metrics. | `createMetrics` | | | | |
| 11 | Split the fetch clock into request place wait, network time and raw save time in the log line. | `readCouncilMeetings.ts:380` | | | | |
| 12 | Report "fetched", "reused" and "read" as three counts in the run report and in its comparison. | report step | | | | |

Items 1, 2, 4 and 6 together would bring a run like this one from 2.8 h to about 1.5 h. Item 7 alone would have kept Camden and removed about 20 of the 38 browser failures.

## What the next run should show

- [ ] One run started between 08:00 and 20:00 UK time, with the same code, to separate the time of day from the code.
- [ ] Relay 502, 503 and 504 replies under 150 for a run of this size.
- [ ] No small scan (5 pages or fewer) with a read time over 5 min.
- [ ] Printed fetch times under 10 s while the relay p50 is under 1 s.
- [ ] Second pass under 15 min.
- [ ] The four histogram panels draw lines.
- [ ] Camden listed again.

## Sources

- `apps/pipeline-run/data/logs/read-2026-10-14T23-18-57Z.log` (10,834 lines).
- `apps/pipeline-run/data/failures/2026-10-14T23-18-59-817Z/` (153 files).
- `gs://govbase-pipeline-text-dev/bundles/2026-10-14T23-19-00-011Z/run-report.json`, as printed at the end of the log.
- Grafana dashboards govbase-pipeline, govbase-browser and govbase-relay, 2026-10-14 23:00Z to 2026-10-15 03:00Z, and 2026-10-13 13:00Z to 2026-10-14 09:00Z for the comparison. Queried through the Grafana Prometheus API.
- `git show` of pipeline `4f90f2f`, relay `4a9dc69` and parser SDK `8db2733`.
- `docs/read-run-2026-10-13-retrospective.md`.
- A direct check of `www.rossendale.gov.uk/download/meetings/id/12236` and `/12707` on 2026-10-15.
