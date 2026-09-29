# ModernGov run, 3 October 2026

This is the record of one run of the pipeline over every ModernGov source.
Use it as the baseline when you run it again. Compare each table with the
same table from the new run.

## Setup

| Item                | Value                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Pipeline commit     | `3977d2f`, plus two changes that are not committed (see below)       |
| Environment         | `PIPELINE_ENV=local`                                                 |
| Sources             | All 299 sources in `config/sources.yaml` with `system: moderngov`   |
| Councils at a time  | 50                                                                   |
| Wait before request | `moderngov.requestGapInSeconds: 5`                                   |
| Time window         | 7 days back (`fallbackQueryWindowInDays`), because `data/bundles` was empty |
| Relay               | `relay.govbase.co.uk`                                              |

Changes that were not committed at the time of the run:

1. The `notes` lines were removed from `config/sources.yaml`.
2. `createModernGovClient` changes each document link from
   `.../mgConvert2PDF.aspx?ID=<n>` to `.../documents/s<n>/document.pdf`.
   Before this change, Cloudflare blocked every `mgConvert2PDF.aspx` link
   on `*.moderngov.co.uk` with a 403 bot check. The new address is not
   blocked.

The run script is at the end of this file.

## Timing

| Item                      | Value                                      |
| ------------------------- | ------------------------------------------ |
| Start                     | 2026-10-03 14:02:49 UTC (16:02:49 CEST)    |
| End                       | 2026-10-03 14:52:22 UTC (16:52:22 CEST)    |
| Total                     | **49m 33s**                                |
| Time for one council      | 316s on average, 235s median               |

Slowest councils:

| Council                 | Time  | Meetings | Documents |
| ----------------------- | ----- | -------- | --------- |
| Wiltshire               | 1627s | 18       | 262       |
| Dumfries and Galloway   | 1551s | 7        | 229       |
| Cornwall                | 1497s | 16       | 240       |
| Leicestershire          | 1272s | 8        | 187       |
| Wirral                  | 1269s | 13       | 175       |
| Oxfordshire             | 1231s | 9        | 153       |
| Charnwood               | 1217s | 8        | 187       |
| East Sussex             | 1190s | 7        | 123       |

The total time is set by the councils with the most documents. Each
document is one request, with a 5 second wait before it.

### Requests

The pipeline does not log each request, and it does not log retries. So
this count is built from the bundles and the log, and it is a lower
bound.

| Request                                                       | Count  | Source                                      |
| ------------------------------------------------------------- | ------ | ------------------------------------------- |
| RSS feed (`mgRss.aspx`), 1 for each council                   | 290    | Bundles                                     |
| `GetMeeting`, 1 for each meeting                              | 1,042  | Bundles                                     |
| Documents fetched (not restricted, not a link to another site) | 10,836 | Bundles                                     |
| **Counted from the bundles**                                  | **12,168** |                                         |
| `GetAllMeetingsByDate`, after the feed failed                 | 28     | Log: "the published feed failed"            |
| `GetCommittees`, after the date range call failed             | 13     | Log: "the date range call failed"           |
| `GetMeetings` for each committee, for the 2 councils whose `GetCommittees` worked | not known | Not logged                 |
| The 9 lost bundles, at 42 requests for each council on average | about 380 | Estimate                                 |
| Retries after a status in `retryStatuses` (up to 12 for each request) | not known | Not logged                         |
| **Total**                                                     | **about 12,600, plus retries** |                        |

A council made 42 requests on average and 32 for the middle council
(median). Wiltshire made the most, about 248.

To get an exact count next time, the run script must count each request
the HTTP client sends, including retries.

### Estimate: a shorter gap

Each request waits `requestGapInSeconds` and then waits for the answer.
The requests of one council run one after the other.

| Item                                    | Value                       |
| --------------------------------------- | --------------------------- |
| Requests counted from the bundles       | 12,168                      |
| Time from the start of one request to the start of the next, on average | 7.5s (5s gap, 2.5s answer) |

#### Method

For each council, I took its real time and subtracted the saved gap time
for each of its requests. Then I replayed the run with 50 councils at a
time, in the order of `sources.yaml`. The replay of the 5 second run gives
49m 46s. The real run took 49m 33s, so the method is close.

The replay counts 1 feed request, 1 request for each meeting, and 1
request for each fetched document. It does not count retries. It assumes
that each answer still takes 2.5s on average, whatever the gap.

#### Estimates

| Gap | Total run time | Saved   | Wiltshire (slowest council) | Requests to one council, each minute | Requests through the relay, each second, at peak | Requests to `*.moderngov.co.uk`, each second |
| --- | -------------- | ------- | --------------------------- | ------------------------------------ | ------------------------------------------------ | -------------------------------------------- |
| 5s  | 49m 33s (real) | none    | 27m 7s (real)               | 8                                    | 6.7                                              | 1.6                                          |
| 3s  | about 36m      | 14m, 28% | about 19m                  | 11                                   | 9.1                                              | 2.2                                          |
| 2s  | about 29m      | 21m, 42% | about 15m                  | 13                                   | 11.1                                             | 2.7                                          |
| 1s  | about 25m      | 25m, 49% | about 11m                  | 17                                   | 14.3                                             | 3.4                                          |

How the rate columns are worked out:

- **One council:** 60 seconds divided by (gap + 2.5s answer).
- **Relay at peak:** 50 councils divided by (gap + 2.5s answer).
- **`*.moderngov.co.uk`:** 72 of the 299 councils are hosted on
  `*.moderngov.co.uk`. They share one supplier and one Cloudflare
  setup. So at any time, about 12 of the 50 running councils send to it.

The saving gets smaller with each step. From 5s to 3s saves 14 minutes.
From 2s to 1s saves only 4 minutes. This is because the answer time
(2.5s) does not change, and because the run ends when the last large
council ends.

#### 3 second gap

Pros:

- Saves about 14 minutes (28%).
- Each council still gets fewer than 1 request every 5 seconds
  (11 a minute).
- The smallest change. It is the easiest to undo if errors go up.

Cons:

- The relay gets about 36% more requests each second at peak. This run
  already had 62 relay errors (522 and transport errors) at the 5s gap.
- `*.moderngov.co.uk` gets 2.2 requests each second from one relay
  address.

#### 2 second gap

Pros:

- Saves about 21 minutes (42%).
- The gap is still close to the answer time, so each council gets
  13 requests a minute.

Cons:

- The relay gets about 66% more requests each second at peak. Expect
  more 522 and transport errors, unless the relay gets more capacity.
- `*.moderngov.co.uk` gets 2.7 requests each second from one address.
  A rate limit there would hit all 72 hosted councils at the same time.
- More retries can eat into the time saved.

#### 1 second gap

Pros:

- Saves about 25 minutes (49%), the most of the four.

Cons:

- Only 4 minutes faster than the 2 second gap, for about 29% more load.
- The relay gets more than twice the requests each second at peak.
- Each council gets 17 requests a minute. At this rate, our traffic
  looks less like a polite crawler and more like a bulk download.
  Bot checks like the ones on Sutton, Oxford and Bolsover are more
  likely to start on other councils.
- `*.moderngov.co.uk` gets 3.4 requests each second from one address.

#### Edge cases to consider

1. **One relay address for every council.** All requests leave from the
   relay's address. If a council, or the supplier of `*.moderngov.co.uk`,
   blocks that address, it blocks production too, not only this run. A
   block can last much longer than the run.
2. **Rate limits are per site, not per council.** 72 councils share
   `*.moderngov.co.uk`. A gap that is polite for one council can be too
   fast for the supplier, who sees the total of all 72.
3. **Answers get slower under load.** The estimates assume 2.5s for each
   answer. If the relay or a council slows down under more load, the
   saving is smaller than the table shows.
4. **Retries cost time and requests.** A status in `retryStatuses`, such
   as 429, is sent again, up to `retryLimit` (12) times. The wait doubles
   each time, or follows `Retry-After`. A few retries on a large council
   can cancel the time saved by a shorter gap.
5. **Errors are not always retried.** 522, 403 and transport errors
   leave a document unread. A faster run with more of these errors gives
   a less complete bundle. Compare the unread count, not only the time.
6. **The order of councils matters more than the gap.** The run ends when
   the slowest council ends. Wiltshire alone takes 27 minutes at 5s. If
   the largest councils start first, the replay gives these totals with
   the same gaps:

   | Gap | `sources.yaml` order | Largest councils first |
   | --- | -------------------- | ---------------------- |
   | 5s  | 49m 46s              | about 31m              |
   | 3s  | 35m 45s              | about 23m              |
   | 2s  | 28m 52s              | about 19m              |
   | 1s  | 25m 2s               | about 16m              |

   Largest first, with the 5s gap, is faster than `sources.yaml` order
   with a 3s gap, and it adds no load. The size of a council can come
   from its last bundle.
7. **This run is not a normal run.** It started with empty bundles, so
   every council read 7 days. A later run reads only what is new since
   the last clean run, so it has far fewer requests. The gap matters most
   for the first run, and for councils with a large backlog.
8. **The gap is in config.** `moderngov.requestGapInSeconds` is one value
   for every council. A council that blocks fast traffic cannot get a
   longer gap without a code change.
9. **Concurrency adds load too.** The gap sets the rate for one council.
   The number of councils at a time multiplies it. Going from 50 to 100
   councils doubles the load on the relay, like going from 5s to about
   1.3s.
10. **One run is one sample.** Councils publish different amounts each
    week. Compare time per request, not only the total time, across
    runs.
11. **Being a good guest.** The User-Agent names us and gives a contact
    address. A council that sees fast traffic can contact us or block
    us. A slower crawl is less likely to trigger either.

## Results

These numbers come from the 290 bundles in `data/bundles`. 9 bundles were
lost (see Known issues), so the real totals are a little higher.

| Item                     | Value                 |
| ------------------------ | --------------------- |
| Councils run             | 299                   |
| Bundles saved            | 290                   |
| Councils with problems   | 20 (17 in the bundles) |
| Councils with 0 meetings | 62                    |
| Meetings                 | 1,042                 |
| Documents                | 12,589                |
| Documents read           | 10,139 (81%)          |

A council with 0 meetings is usually not a fault. It means the council
published nothing in the 7 day window.

## Error statuses in the log

Command:

```bash
grep -o "status code ([0-9]*" <run log> | sort | uniq -c
```

Output:

```
 353 status code (403
  26 status code (404
  11 status code (502
  66 status code (504
  55 status code (522
```

What each status means:

| Status | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| 403    | Refused. Here, a firewall or bot check on the council's side.      |
| 404    | Not found.                                                          |
| 502    | The council's server gave a bad answer to the server in front of it. |
| 504    | The council's server took too long to answer.                       |
| 522    | Cloudflare could not connect to the council's server.               |

The log counts more errors than the bundles do. The log also holds
errors from web service calls and from the 9 lost bundles.

For comparison, the run before the document address change had 844 errors
with status 403, from about 76 councils.

## Why documents were not read

From the `unreadReason` field of every unread document in the bundles:

| Count | Reason                                 |
| ----- | -------------------------------------- |
| 1,751 | restricted                             |
| 333   | HTTP 403                               |
| 221   | no text, so probably a scanned image   |
| 55    | HTTP 522                               |
| 33    | HTTP 504                               |
| 23    | HTTP 404                               |
| 17    | not a PDF or HTML file                 |
| 8     | HTTP 502                               |
| 7     | transport error (the connection broke) |
| 2     | a link to another site                 |

"Restricted" documents are marked restricted by the council, so the
pipeline does not fetch them.

### HTTP errors on documents, by host

The hosts with the most failed documents:

| Count | Status | Host                                    | Cause                                   |
| ----- | ------ | --------------------------------------- | --------------------------------------- |
| 96    | 403    | `sutton.moderngov.co.uk`                | Not checked yet                         |
| 53    | 403    | `moderngov.erewash.gov.uk`              | Not checked yet                         |
| 53    | 403    | `democracy.lbhf.gov.uk`                 | Not checked yet                         |
| 44    | 403    | `mycouncil.oxford.gov.uk`               | Azure firewall bot check                |
| 41    | 403    | `kingston.moderngov.co.uk`              | Azure firewall bot check                |
| 28    | 403    | `democracy.hyndburnbc.gov.ukdocuments`  | Broken link (see Known issues)          |
| 23    | 404    | `modgov.shropshire.gov.uk`              | Not checked yet                         |
| 17    | 403    | `mg.wakefield.gov.uk`                   | Not checked yet                         |
| 7     | 504    | `democracy.leics.gov.uk`                | Slow server                             |
| 5     | 504    | `mgenglish.pembrokeshire.gov.uk`        | Slow server                             |
| 4     | 522    | `cms.wiltshire.gov.uk`                  | Could not connect                       |
| 4     | 504    | `democracy.cambridge.gov.uk`            | Slow server                             |

The 522 errors are spread over 45 hosts, with 1 or 2 documents each.
They look like short outages, not blocks.

Basingstoke was blocked by the Azure firewall in the earlier probe. It
had no failed documents in this run.

## Relay or council: which side caused each error

The bundles do not store the reply headers. So after the run, at about
15:00 UTC, I fetched one failed document for each status and host again
through the relay. I also fetched the failed council calls again. Three
things show which side sent an error:

- `x-relay-upstream-status`: the relay adds this header when it got an
  answer from the council. Its value is the council's status.
- A page title of `govbase.co.uk | <status>`: this is a Cloudflare error
  page for our own domain. Cloudflare sits in front of the relay, so the
  error is between Cloudflare and the relay.
- The page itself, such as an "Azure WAF" bot check or a council's own
  error page.

### Relay side

| Reason                       | Count | Evidence                                                                                               |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| HTTP 522 on documents        | 55    | Page title `govbase.co.uk \| 522: Connection timed out`. Cloudflare could not connect to the relay. Spread over 45 hosts, 1 or 2 each. When fetched again, 43 of 45 gave the PDF. |
| Transport error on documents | 7     | The connection between the pipeline and the relay broke. All 7 gave the PDF when fetched again.        |
| HTTP 403 for Hyndburn        | 28    | The relay answered `host not allowed: democracy.hyndburnbc.gov.ukdocuments`. The relay refused the host, because the link is broken (see Known issues). |

The 522 errors and the transport errors happened while 50 councils ran at
the same time. They are very likely caused by load on the relay.

### Probably relay side, not proven

| Reason                       | Count | Evidence                                                                                               |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| HTTP 504 and 502 on documents | 41   | All of them gave the PDF when fetched again. Spread over many hosts, like the 522 errors. The original replies were not saved, so I cannot tell which side sent them. |
| HTTP 504 on `GetCommittees` for Ashfield, Herefordshire and Torbay | 3 councils | Still 504 when fetched again, with the page title `govbase.co.uk \| 504: Gateway time-out` and no `x-relay-upstream-status`. The relay did not get an answer from the council in time. So the relay reported the error, but the cause is probably a council server that does not answer. |

### Council side

| Reason                                   | Count | Evidence                                                                              |
| ---------------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| HTTP 403, Azure WAF bot check            | 304   | Sutton (96), Erewash (53), Hammersmith and Fulham (53), Oxford (44), Kingston (41), Wakefield (17). The page is an "Azure WAF" JavaScript check and has an `x-azure-ref` header. Erewash, Hammersmith and Fulham, Oxford and Wakefield have `x-relay-upstream-status: 403`. Sutton and Kingston have no relay header, but the page is the same Azure check. |
| HTTP 403, Cloudflare bot check on `GetCommittees` | 4 councils | Bolsover, Eastleigh, Leicester and North East Derbyshire. "Just a moment..." page with `x-relay-upstream-status: 403`. |
| HTTP 404 on `GetCommittees` for Bedford  | 1 council | A page titled "Blocked" with `x-relay-upstream-status: 404`.                       |
| HTTP 404 on documents, Shropshire        | 23    | Shropshire Council's own error page.                                                  |
| HTTP 403, Devon                          | 1     | Gave the PDF when fetched again. A short block on the council side.                   |
| restricted                               | 1,751 | The council marks these documents restricted. Not an error.                           |
| no text, so probably a scanned image     | 221   | The council's PDF has no text layer. Not an error.                                    |
| not a PDF or HTML file                   | 17    | The council's file is another format. Not an error.                                   |
| a link to another site                   | 2     | The council links to another site. Not an error.                                      |

The Blaby 502 and the Test Valley 504 calls worked when fetched again, so
they were short failures on one side or the other.

### Summary

- Every 403 except Hyndburn's came from a bot check on the council side.
- The relay itself caused the 522 errors and the transport errors, about
  62 documents. These look like load on the relay with 50 councils at a
  time.
- About 41 more document errors (502, 504) were short and are probably
  from the same load, but this is not proven.

## Cheap ways to reduce the load on the relay

These need no new servers and no extra cost. Most are small changes to
config or to the pipeline. The relay's code is not in this workspace, so
the one relay change below is general advice.

Today the load on the relay is the gap for one council multiplied by the
number of councils at a time. Nothing limits the total. The 522 errors
and the transport errors in this run came from that total.

| # | Change | Where | Cost | Effect on load | Effect on time |
| - | ------ | ----- | ---- | -------------- | -------------- |
| 1 | Run the largest councils first | Run script or `runPipeline` | Small code change | None | About 49m to 31m at the 5s gap |
| 2 | Retry 502, 504 and 522 | `retryStatuses` in config | Config only | A little more, only after a failure | A little more |
| 3 | One limit for all requests to the relay | `createHttpClient` | Small code change | Fixed, whatever the gap and the number of councils | Depends on the limit |
| 4 | A separate limit for `*.moderngov.co.uk` | `createHttpClient` or `createModernGovClient` | Small code change | Protects the 72 hosted councils | A little more for those councils |
| 5 | Do not fetch a document again | `readModernGovCouncil` and the bundle store | Medium code change | Fewer requests in each later run | Shorter later runs |
| 6 | The relay answers 429 with `Retry-After` when it is busy | Relay | Small relay change | The relay sets its own limit | The pipeline waits instead of failing |
| 7 | Fewer councils at a time | Run script | Config only | Lower | Longer |

### 1. Run the largest councils first

The run ends when the last large council ends. In this run, Wiltshire
started late and took 27 minutes. Sort the councils by the number of
requests in their last bundle, largest first. The replay gives about 31m
instead of 49m 33s, with the same gap and the same load.

Edge case: a council with no earlier bundle has no size. Put it in the
middle of the list.

### 2. Retry 502, 504 and 522

These errors were short. When I fetched the documents again, almost all
of them worked. Today `retryStatuses` is `[429, 503]`, so a 502, 504 or
522 leaves the document unread. Add them to `retryStatuses` in every
config file. The retry waits start at `firstRetryWaitInSeconds` (5s) and
double, so the retries do not add much load.

Edge cases:

- Lower `retryLimit` for these statuses, or a council that is down can
  cost 12 retries for each document. With one list for all statuses
  today, this needs a code change. A cheap first step is to lower
  `retryLimit` from 12 to about 3.
- Transport errors (7 in this run) are not a status, so `retryStatuses`
  does not cover them. Retrying them needs a small code change in
  `createHttpClient`.
- Do not retry 403. A bot check does not go away when you ask again, and
  more requests make a block more likely.

### 3. One limit for all requests to the relay

Add one shared limit in `createHttpClient`, such as "at most N requests
each second to the relay". Effect has the parts for this, such as a
`Semaphore` or a rate limiter. Every council shares it. Then the load on
the relay stays the same if you change the gap or the number of councils
at a time.

This is the most useful fix. It turns the load into one number in
config, such as `http.mostRequestsInEachSecond`, that you can set from
what the relay can take. This run had relay errors at a peak of about
6.7 requests each second, so start below that, and raise it while you
watch the 522 count.

Edge case: with a fixed limit, a shorter gap gives no gain once the limit
is reached. The gap then only spreads the requests of one council.

### 4. A separate limit for `*.moderngov.co.uk`

72 councils are hosted on `*.moderngov.co.uk`, behind one supplier and
one Cloudflare setup. Give that domain its own, lower limit, so the
supplier sees a steady, low rate from us. This lowers the risk that the
supplier blocks the relay's address for all 72 councils at once.

Edge case: some councils use their own domain but are hosted by the
same supplier. The limit only catches the ones on `moderngov.co.uk`.

### 5. Do not fetch a document again

A meeting comes back in the RSS feed each time something new is
published for it, such as the minutes after the agenda. Each time, the
pipeline fetches every document of that meeting again, including the
ones it already has. Before a fetch, look for the same document ID in
earlier bundles. If it is there, use the text from the bundle.

This cuts requests the most in later runs. It does not help the first
run, because there are no earlier bundles.

Edge cases:

- A council can replace a document and keep its ID. Compare
  `publishedOn` as well, and fetch again when it changed.
- A document that failed last time (unread because of an error) must be
  fetched again. Only reuse documents that were read, or that were
  unread for a reason that does not change, such as "no text".
- Reading earlier bundles costs time and memory as the number of bundles
  grows. Keep a small index of document ID, published date and bundle
  instead of reading every bundle.

### 6. The relay answers 429 with `Retry-After` when it is busy

Today a busy relay fails with 522 or breaks the connection. If the relay
instead limits how many requests it handles at the same time, and
answers 429 with a `Retry-After` header when it is full, the pipeline
already waits and sends again, because 429 is in `retryStatuses`.

Edge case: the relay sits behind Cloudflare. The 522 errors come from
Cloudflare, which could not connect to the relay at all. A 429 only helps
if the relay can still accept the connection and answer quickly.

### 7. Fewer councils at a time

The quickest change. It only needs the number in the run script. Going
from 50 to 25 halves the peak load, but it makes the run longer. With
fix 1, the time lost is smaller. Use this until fix 3 exists.

### Suggested order

1. Retry 502, 504 and 522, and lower `retryLimit` (config only).
2. Run the largest councils first (no extra load, large time saving).
3. Add one limit for all requests to the relay, then a lower one for
   `*.moderngov.co.uk`.
4. Do not fetch a document again.

After each step, run again and compare the 522 count, the transport
error count, the unread count and the total time with this file.

## Council problems

A problem is a call that failed for the whole council or for one meeting.

| Council                  | Problem                                                       |
| ------------------------ | ------------------------------------------------------------- |
| Ashfield                 | 504 on `GetCommittees`                                        |
| Bedford                  | 404 on `GetCommittees`                                        |
| Blaby                    | 502 on `GetCommittees`                                        |
| Bolsover                 | 403 on `GetCommittees`                                        |
| Eastleigh                | 403 on `GetCommittees`                                        |
| Herefordshire            | 504 on `GetCommittees`                                        |
| Leicester                | 403 on `GetCommittees`                                        |
| North East Derbyshire    | 403 on `GetCommittees`                                        |
| Torbay                   | 504 on `GetCommittees`                                        |
| Southampton              | The `GetCommittees` reply did not match the expected format   |
| Surrey                   | The `GetCommittees` reply did not match the expected format   |
| Cambridge                | 504 on `GetMeeting` for 1 meeting                             |
| Hillingdon               | 504 on `GetMeeting` for 2 meetings                            |
| Oxfordshire              | 504 on `GetMeeting` for 1 meeting                             |
| Staffordshire            | 504 on `GetMeeting` for 1 meeting                             |
| Tendring                 | 502 on `GetMeeting` for 1 meeting                             |
| Test Valley              | 504 on `GetMeeting` for 4 meetings                            |

A `GetCommittees` failure means the RSS feed and the date range call
had already failed, so the council gave no meetings. The 3 other
councils with problems were in the lost bundles: Camden, Sefton and
Welwyn Hatfield.

## Known issues

1. **9 bundles were lost.** A bundle folder is named by its start time,
   to the millisecond. With 50 councils at a time, 9 pairs of councils
   got the same folder name, and the second bundle replaced the first.
   The lost councils include Babergh, Bracknell Forest, Camden, Cherwell,
   Gwynedd, Sefton, Stoke-on-Trent, Tamworth and Welwyn Hatfield.
   To find a lost folder, run
   `grep "Saved bundle" <run log> | sort | uniq -d`.
2. **Hyndburn's document links are broken.** The council gives links with
   no `/` between the domain and `mgConvert2PDF.aspx`. The rewritten link
   keeps the gap, so it becomes `democracy.hyndburnbc.gov.ukdocuments/...`.

## How to compare a new run

1. Empty `data/bundles`, so every council uses the same 7 day window.
2. Run the script below with the same number of councils at a time.
3. Run the `grep` command above on the new log, and compare the counts.
4. Count the `unreadReason` values in the new bundles, and compare them
   with the table above.
5. Compare the total time. The time depends on how many documents the
   councils published in the window, so compare the time per document
   too. This run took about 0.24s per document overall
   (2,973s for 12,589 documents, with 50 councils at a time).

## Run script

The script runs `runPipeline` with `readModernGovCouncil`, the same
functions that `index.ts` uses. It sets `chosenSourceId` to each
ModernGov source in turn. It is not part of the pipeline repository.

Run it from `apps/pipeline` with `PIPELINE_ENV=local bun run <script>`.

```ts
const REPO = "/Users/shauncarmody/govbase/apps/pipeline";

const { Effect, Layer } = await import(`${REPO}/node_modules/effect/dist/esm/index.js`);
const { readModernGovCouncil } = await import(`${REPO}/src/domain/readModernGovCouncil/readModernGovCouncil.ts`);
const { readSourcesFile } = await import(`${REPO}/src/domain/readSourcesFile/readSourcesFile.ts`);
const { runPipeline } = await import(`${REPO}/src/domain/runPipeline/runPipeline.ts`);
const { createBundleStore } = await import(`${REPO}/src/infrastructure/createBundleStore/createBundleStore.ts`);
const { createHttpClient } = await import(`${REPO}/src/infrastructure/createHttpClient/createHttpClient.ts`);
const { createModernGovClient } = await import(`${REPO}/src/infrastructure/createModernGovClient/createModernGovClient.ts`);
const { createPipelineConfig } = await import(`${REPO}/src/infrastructure/createPipelineConfig/createPipelineConfig.ts`);
const { createPlainLogger } = await import(`${REPO}/src/infrastructure/createPlainLogger/createPlainLogger.ts`);
const { createTextReader } = await import(`${REPO}/src/infrastructure/createTextReader/createTextReader.ts`);
const { CouncilsConfig } = await import(`${REPO}/src/infrastructure/createPipelineConfig/createPipelineConfig.types.ts`);
const listedSources = (await import(`${REPO}/config/sources.yaml`)).default;

const configLayer = createPipelineConfig(`${REPO}/config`).pipe(
  Layer.provideMerge(createPlainLogger()),
);
const servicesLayer = Layer.mergeAll(
  createModernGovClient().pipe(Layer.provide(createHttpClient())),
  createTextReader(),
  createBundleStore(),
).pipe(Layer.provideMerge(configLayer));

const program = Effect.gen(function* () {
  const sourcesFile = yield* readSourcesFile(listedSources);
  const councilsConfig = yield* CouncilsConfig;
  const moderngovIds = sourcesFile.sources
    .filter((source: any) => source.meetings.system === "moderngov")
    .map((source: any) => source.id);
  yield* Effect.log(`Running ${moderngovIds.length} moderngov sources`);
  return yield* Effect.forEach(
    moderngovIds,
    (sourceId: string) =>
      runPipeline({
        sourcesReading: readSourcesFile(listedSources),
        readCouncil: readModernGovCouncil,
      }).pipe(
        Effect.provideService(CouncilsConfig, {
          ...councilsConfig,
          chosenSourceId: sourceId,
        }),
        Effect.map((summary: any) => ({ sourceId, ...summary })),
        Effect.tap((result: any) =>
          Effect.log(`RESULT ${JSON.stringify(result)}`),
        ),
      ),
    { concurrency: 50 },
  );
});

const runStartedAtUnixMs = Date.now();
console.log(`STARTED ${new Date(runStartedAtUnixMs).toISOString()}`);
const results = await Effect.runPromise(program.pipe(Effect.provide(servicesLayer)));
await Bun.write(`${import.meta.dir}/moderngov-results-full.json`, JSON.stringify(results, null, 2));
const withProblems = results.filter((r: any) => r.problemCount > 0);
const runTookInSeconds = Math.round((Date.now() - runStartedAtUnixMs) / 1000);
console.log(`FINISHED ${new Date().toISOString()}, took ${Math.floor(runTookInSeconds / 3600)}h ${Math.floor((runTookInSeconds % 3600) / 60)}m ${runTookInSeconds % 60}s`);
console.log(`DONE: ${results.length} councils run, ${withProblems.length} with problems`);
process.exit(0);
```
