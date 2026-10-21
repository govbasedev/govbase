# The list step, as built

This doc describes what the list step does today, in the order it does it. It is written from the code on the branch `parse-as-markdown` (commit `80e4cad`), the parser SDK `v0.8.0`, and the list runs of 19 and 20 October 2026. It describes the code as it is. It does not say what to change.

The aim is that you can understand the step without reading the code. Each section names the file that holds the behaviour, so you can go to the code when you want to.

## Words used in this doc

- **Source**: one entry in `config/sources.yaml`. Most sources are councils. There are 382.
- **Meetings system**: the software a council uses to publish its meetings. The systems are `moderngov`, `cmis`, `coins`, `own-site`, `decision-time`, `amber-valley` and `unknown`.
- **Lister**: the function that lists one council's meetings for one system. There are six.
- **Meeting**: one committee meeting on a council site. It has a page, a date, and agenda items with documents.
- **Item**: a meeting page or a document that the list step found. It is what the read step will fetch.
- **Item id**: the SHA-256 hash of the item's web address. A hash is a fixed-length code made from some text. The same text always gives the same hash.
- **Bucket**: the cloud storage that holds the pipeline's files, on Google Cloud Storage. A file in it is an object. Each object has a key, which is its name, and a last-modified time.
- **LIST, GET, PUT**: the three bucket operations. LIST returns the keys under a prefix, 1,000 at a time. GET fetches one object. PUT writes one object.
- **Relay**: the Govbase proxy service. Every web request to a council goes through it.
- **Browser service**: the Govbase service that opens a page in a real Chrome browser. It is used when the relay is blocked.
- **Host**: the domain name part of an address, such as `moderngov.co.uk`.
- **Feed**: a web page in RSS form that lists what a ModernGov site published recently.
- **`GetMeeting`**: a ModernGov web service call. It returns one meeting with its agenda items and documents.
- **Crawl**: to open web pages one after another to find links.
- **Cap**: a config limit on how many pages or meetings a crawl opens.
- **Gauge**: a metric that holds a current value. The pipeline sends its metrics to Grafana.
- **Effect**: the TypeScript library the pipeline is written with. An Effect is a description of work that runs later.

## The job in short

The list step finds every meeting page and document that each council has published, and writes one record per item to the bucket. It reads no document. It keeps no memory of the last run. Every run lists everything that the crawl caps reach.

## Where the step sits

| Thing | Fact |
| --- | --- |
| Composition | `index.ts` builds the step with `buildListStep`. It hands in the six listers, keyed by system, and `readCouncilListings`. |
| Start | `runPipeline` reads `config/sources.yaml` with `readSourcesFile` and checks it. One problem in the file, and no source runs. It logs `Found 382 sources`. |
| Order | `runSteps` keeps the steps named in `run.steps` and runs them in the `allSteps` order. The list step is first. |
| Readiness | The step has no work when the file holds no source. Otherwise it is ready. It reads nothing else before it starts. |
| Schedule | `bun run dev:run` runs list, read, parse, ocr and judge once a day on the Mac. `bun run dev:step:list` runs the list step alone. |
| Store | The step owns `list/v2/` in the bucket. It writes `data/<itemId>.json` and `errors/<errorId>.json`. |
| Reads | The step reads its own store once, a LIST of `list/v2/data/` keys, to count new items. It reads no other store. |

## The parts

| Part | File | Job |
| --- | --- | --- |
| The step | `src/domain/buildListStep/buildListStep.ts` | Starts the run, builds the item ids, saves, and writes the report. |
| The fan-out | `src/domain/readCouncilListings/readCouncilListings.ts` | Runs the sources 72 at once. Picks the lister for each source. Turns meetings into items. |
| ModernGov lister | `src/domain/readModernGovListing/readModernGovListing.ts` | Reads the feed, then `GetMeeting` per meeting. 307 sources. |
| Own-site lister | `src/domain/readOwnSiteListing/readOwnSiteListing.ts` | Crawls a council's own web pages. 29 sources. |
| CMIS lister | `src/domain/readCmisListing/readCmisListing.ts` | Crawls a CMIS site: committees, then meeting pages. 35 sources. |
| COINS lister | `src/domain/readCoinsListing/readCoinsListing.ts` | Crawls a COINS site: bodies by year, then agenda, paper and pack pages. 4 sources. |
| Decision Time lister | `src/domain/readDecisionTimeListing/readDecisionTimeListing.ts` | One JSON list, then one agenda page per meeting. 3 sources, one through `more_meetings`. |
| Amber Valley lister | `src/domain/readAmberValleyListing/readAmberValleyListing.ts` | One JSON list, then one documents call per meeting. 1 source. |
| The client | `src/infrastructure/createModernGovClient/createModernGovClient.ts` | Sends every request. Paces each host. Cuts off a failing host. Falls back to the browser. Classes each failure. |
| The HTTP client | `src/infrastructure/createHttpClient/createHttpClient.ts` | Sends through the relay. Follows redirects. Retries. Times out. Limits requests at once. |
| The list store | `src/infrastructure/createListStore/createListStore.ts` | Makes the item id. Saves items and failures. |
| The bucket | `src/infrastructure/createObjectBucket/createObjectBucket.ts` | LIST, GET and PUT with retries. |
| The SDK | `apps/parser-sdk/src/moderngov/`, `site/`, `cmis/`, `coins/`, `decisiontime/`, `ambervalley/` | Reads the XML, HTML and JSON that the sites return. Builds the request addresses. |

## The sequence of one run

### 1. Start

1. `runSteps` logs `Starting step: list`.
2. The step reads `councils.councilsAtOnce` (72) and `reporting.shownRowLimit` (10) from config.
3. It takes the start time.
4. It logs `Listing the meetings and documents of 382 sources, 72 at once, from A to Z. No document is read`.
5. It calls `readCouncilListings` with all the sources and the six listers.

Every source in the file is listed. The `active` field is checked for shape only, and does not filter the list. The config key `sources.hostKeys` is not read by this step.

### 2. Fan out over the sources

In `readCouncilListings`:

1. Set two gauges to 382: `govbase_pipeline_step_work_size` and `govbase_pipeline_step_work_left`, both with the labels `step=list` and `unit={council}`.
2. Sort the sources by id, A to Z.
3. Run `readListedSource` for each source, 72 at once. When one source finishes, the next one in A to Z order starts. Each finished source takes one off the `work_left` gauge.
4. When all are done, set `work_left` to 0.

### 3. One source

In `readListedSource`:

1. Collect the meetings blocks of the source: the `meetings` block, then each block in `more_meetings`. Most sources have one block.
2. For each block, in sequence:
   - No `base_url` in the block: make one failure with the class `skipped`, the reason `no meetings.base_url in sources.yaml`, and the council's website as the address. No meetings.
   - No lister for the block's system, which is the case for `unknown`: make one failure with the class `skipped`, the reason `no reader for meetings system unknown`, and the base URL as the address. No meetings.
   - Otherwise, call the lister with the source and the base URL. The lister returns a list of meetings and a list of failures.
3. Join the meetings of all blocks.
4. Turn the meetings into items (section 7).
5. Sort the failures by address.
6. Log `<sourceId>: N meeting(s), N item(s) to read, N failure(s)`.

Every log line inside a source carries the council id in brackets.

### 4. The ModernGov lister

In `readModernGovListing`. This is 307 of the 382 sources.

1. Build the site: the base URL, the web service path (`meetings.webservice`, or `/mgWebService.asmx` when absent), and whether the browser may be used (`access.fallback` is `chromium`).
2. Take the time now. The window is from now minus `councils.feedWindowInDays` (7 days) to now.
3. Fetch the feed. The address is `<baseUrl>/mgRss.aspx?XXR=0&DR=<from>-<to>`, with UK dates, such as `DR=13/10/2026-20/10/2026`. The request kind is `feed`.
4. The SDK reads the feed XML (`readFeedXml.ts`). It keeps an entry only when its link has `EVT=101` and `DT` is `A` or `M`: an agenda or minutes was published. It takes the `MId` as the meeting id. It takes the committee title from the entry's description, before the last `: `. One meeting id is kept once, the first time it is seen. The publish date of the entry is read and dropped. The result is a list of `{ meetingId, committeeTitle }`.
5. Log `<sourceId>: N meeting(s) with an agenda or minutes published since <date>`.
6. For each meeting, 4 at once (`councils.documentsAtOnce`), call `GetMeeting`. The address is `<baseUrl><servicePath>/GetMeeting?lMeetingId=<id>`. The request kind is `service`.
7. The SDK reads the meeting XML (`readMeetingXml.ts`). It gives the meeting id, the date (UK date turned into ISO), the status, the location, and the agenda items. Each agenda item has an id, a number, a title, the agenda HTML, the minutes HTML, a restricted flag, and its linked documents. Each linked document has an attachment id, a title, an address, a publish date, a link flag (`isLink`, true when the entry is a web link and not a file), and a restricted flag. The SDK rewrites a `mgConvert2PDF.aspx?ID=<n>` address to `documents/s<n>/document.pdf`, and unwraps an address nested inside another address.
8. A reply whose meeting id is `0` is "the reply holds no meeting". When the browser is allowed, the same address is read again through the browser.
9. Each read meeting becomes a listed meeting: `{ meetingId, committeeTitle, pageUrl, meetingDetail }`. The page URL is `<baseUrl>/ieListDocuments.aspx?MId=<id>`.
10. A `GetMeeting` failure is logged as `<sourceId>: the meeting could not be read <id>: <reason>` and becomes one failure for the page URL. The other meetings go on.
11. Log `<sourceId>: N meeting(s) read from the web service, N failed`.
12. A feed failure stops the council for this run. It is logged as `<sourceId>: the published feed failed, so the council is not listed this run: <reason>`, and the council has one failure for the feed address and no meetings.

### 5. The page-system listers

Every page lister asks the client for a page with `getPage`. The request kind is `document`. The client does not check the body type for a page.

**Own site** (`readOwnSiteListing`, 29 sources).

1. The source must have `meetings.documents`, the path or paths where its documents live. Without it, the council gets one `skipped` failure, `no meetings.documents in sources.yaml`.
2. The start page is `base_url`. More start pages come from `meetings.start_pages`. The site rule comes from the other `meetings` fields: `pages`, `skip`, `self_documents`, `link_date`, `file_url`, `split_by_date`.
3. Read the start page. The SDK (`readSitePage`) returns the page title, the page date, the meeting links on the page with their dates, and the meetings on the page with their documents.
4. Read the other start pages, one after another, up to `councils.mostSitePages` minus one (79).
5. Read the waiting meeting links, one after another, until the page count reaches `councils.mostSitePages` (80) or no link waits. A failed page counts as a page. The waiting links are kept in rank order, and the rank is re-sorted after each page: dated links before undated, links within `councils.siteFutureInDays` (14 days) ahead before links further ahead, then closest to today first. A link with no date takes the oldest date on the page that holds it, or the page's own date.
6. Collect the meetings from all the pages read. An agenda item is kept once across pages, by its id, the first page wins. A meeting with no new agenda item is dropped.
7. Sort the meetings by the same rank, by meeting date, and take `councils.mostSiteMeetings` (120).
8. The committee title of a meeting is the title of the page where it was found. The page URL is that page.
9. Log `<sourceId>: N meeting(s) with documents, from N page(s) of its own site`.
10. A start page failure stops the council: `the meetings page of its own site failed`, one failure, no meetings. A later page failure is one failure, and the crawl goes on.

**CMIS** (`readCmisListing`, 35 sources).

1. The start page is `base_url`, the committees page. More start pages come from `meetings.start_pages`.
2. Read the start page. The SDK (`readCmisLinks`) returns committee addresses and meeting links with dates. Read the other start pages, one after another, the same way.
3. Read each committee page, one after another, up to `councils.mostCmisCommitteePages` (80). Each gives meeting links.
4. Keep each meeting link once, by address.
5. Order the links: dated links on or before now plus `councils.cmisFutureInDays` (14 days), closest to today first; then dated links further ahead, closest first; then undated links.
6. Read the first `councils.mostCmisMeetingPages` (120) meeting pages, one after another. The SDK (`readCmisMeeting`) returns the meeting with its agenda items and documents, and the committee title.
7. Log `<sourceId>: N meeting(s) from N committee page(s) of its CMIS site`.
8. A start page failure stops the council: `the committees page of its CMIS site failed`. A later failure is one failure, and the rest go on.

**COINS** (`readCoinsListing`, 4 sources).

1. The SDK builds two start addresses from `base_url`: the latest meetings page and the bodies page.
2. Read the meetings page. If it has an "all rows" link, read that too. Read the bodies page the same way.
3. Keep each body once, by id. For each body, build one page address per year, from this year back to the year of now minus `councils.coinsPastInDays` (60 days). Read up to `councils.mostCoinsBodyPages` (80) of these pages, one after another. Each gives meeting links.
4. Keep each meeting link once, by address. Order them closest to today first, undated last.
5. For each meeting, one after another, while pages are left: read the agenda page. A page with no meeting date is not an agenda, and is skipped. Otherwise read one paper page per agenda item, and one frame per pack. If a pack frame comes back with no pack, stop reading packs for the rest of the council. The pages of one meeting count as one plus the paper pages plus the pack pages, against `councils.mostCoinsMeetingPages` (160).
6. Pages are decoded as `windows-1252`.
7. Log `<sourceId>: N meeting(s) from N body page(s) of its COINS site`.
8. A meetings page failure stops the council: `the latest meetings page of its COINS site failed`.

**Decision Time** (`readDecisionTimeListing`, 3 sources).

1. The source must have `meetings.service_url` and `meetings.site_key`. Without them, one `skipped` failure.
2. Read one JSON list of all the meetings on the site. The 20 October run saw 668 to 874 meetings per council.
3. Keep the meetings that have papers: not scheduled, and with an agenda or a minutes document. Order them closest to today first. Take `councils.mostDecisionTimeMeetings` (40).
4. For each meeting, one after another: when it has an agenda, read the agenda page and take its agenda items. Otherwise the meeting has no items. Build the meeting page with its page URL.
5. Log `<sourceId>: N meeting(s) of N on its Decision Time site, N failed`.

**Amber Valley** (`readAmberValleyListing`, 1 source).

1. The source must have `meetings.service_url`.
2. Read one JSON list of meetings, from now minus `councils.amberValleyPastInDays` (730 days) to now plus `councils.amberValleyFutureInDays` (60 days).
3. Order them closest to today first. Take `councils.mostAmberValleyMeetings` (40).
4. For each meeting, one after another, read one documents call and build the meeting page.
5. Log `<sourceId>: N meeting(s) of N from its democracy service`.

### 6. Every request

Every request from every lister goes through the client in `createModernGovClient.ts`, then the HTTP client in `createHttpClient.ts`. This is what happens to one request, in order.

1. **Host key.** The lower-case host of the address.
2. **Cut-off check.** The client keeps one failure counter per host and request kind, in memory for the run. When the counter is at `moderngov.hostFailureLimit` (3) or more, the request is not sent. It fails with the class `skipped`. The first skip of a host and kind is logged: `<host>: 3 service failures in a row, so later service requests to this host are not sent`.
3. **Pace.** The client keeps one pace clock per host. The next slot is the later of the last slot and now, plus `moderngov.requestGapInSeconds` (1 second). The request waits for its slot minus a burst of `moderngov.hostBurstRequests` (5) gaps. So up to 5 requests to one host can go at once, and then one per second.
4. **Host turn.** One permit from the host's semaphore of `moderngov.mostHostRequestsAtOnce` (4). A semaphore is a counter that limits how many run at once. The cut-off check runs again inside the turn.
5. **Relay.** The HTTP client sends `GET <relayUrl>/fetch/<host><path><query>` with the user agent and the relay token. Its chain, from the outside in:
   - Follow redirects: statuses 301, 302, 303, 307, 308, up to `http.redirectLimit` (5), each logged as `Relay redirect: N of 5 to <url>`.
   - Retry: a transport error, or a status in `http.retryStatuses` (429, 502, 503, 504, 522), is sent again. The limit is `http.retryLimit` (3), or for a gateway status (502, 504, 522) the request kind's `moderngov.gatewayRetryLimits` (feed 2, service 2, document 1). The wait starts at `http.firstRetryWaitInSeconds` (5) and doubles, up to `http.longestRetryWaitInSeconds` (60), or follows the council's `Retry-After` header. Each retry is logged: `Relay retry: N of M in <ms>ms after <status> for <url>`.
   - Body check: not used for a page or XML request.
   - Limit: one permit from the relay semaphore of `http.mostRequestsAtOnce` (36). When the host ends in `moderngov.co.uk`, also one permit from that shared pool of 5 (`http.sharedHosts`).
   - Timing: the time is measured and sent to the metrics `govbase_pipeline_relay_requests` and `govbase_pipeline_relay_request_seconds`, by status class and host class. A line `Relay request: <status> in <ms>ms for <url>` is logged for every reply that is not 2xx, and for a 2xx reply slower than `http.slowRequestInMs` (15,000).
   - Timeout: `moderngov.requestTimeoutsInSeconds` for the kind (60 seconds for all three kinds). A request that runs over is treated as a 504 reply.
6. **Block page check.** An error reply that is not a gateway status, and every OK reply, is checked for a block page: a title or body phrase from `pageChecks`, such as `just a moment` or `cf-challenge`. A match fails as `PageBlocked`.
7. **Browser fallback.** When the site may use the browser, and the failure is a block page, or its status is in `moderngov.browserFallbackStatuses` for the kind (feed 403 and 404 in production, plus 502, 504 and 522 in development; service 403, 404, 502 and 504; document 403 and 404), the browser service reads the same address. The browser service runs `browser.pagesAtOnce` (4) pages at once. The result is logged as `Browser fallback: read <status> <type> for <url>, after relay <cause>`, or `failed`, `blocked`, `needs a login` or `unreachable`. A read page replaces the relay reply.
8. **XML read.** For a feed or service request, the SDK reads the XML. Unreadable XML fails as `parse`.
9. **Count.** On success, the host's failure counter for this kind goes to 0. On a failure whose status is in `moderngov.hostFailureStatuses` for the kind (feed and service: 403, 404, 502, 504, 522), the counter goes up by one.
10. **Class.** Every failure gets a class: `blocked` (401, 403, or a block page), `gone` (404, 410), `gateway` (502, 503, 504, 522), `status` (another status), `connection` (no reply), `parse` (bad XML), `skipped` (cut-off), `private` (login page), `empty` (empty file). It also gets who failed: `council` when the relay's `x-relay-upstream-status` header is present, `relay` otherwise, or `unknown`. Every failure is added to the client's in-memory tally for the report.

### 7. Meetings become items

In `buildListedItems` in `readCouncilListings.ts`, for each source:

1. For each meeting, make one page item: `{ sourceId, title: "<committeeTitle> <date>", url: pageUrl }`.
2. For each document in each agenda item of the meeting, make one document item: `{ sourceId, title, url }`. A document is left out when `isLink` is true, or its address is blank.
3. Keep each address once within the source. The first item with that address wins, in the order the lister returned the meetings.
4. Sort the items by address.

Everything else that the lister returned is dropped here: the meeting date, the committee title as a field, the meeting page of a document, the agenda item, the attachment id, the publish date, the restricted flag, the status and the location.

### 8. Items get their ids

In `buildSourceItems` in `buildListStep.ts`, after every source has finished:

1. For each source in A to Z order, for each item: decode it with `ListedItemDraftSchema`, with the address as the id input.
2. `ItemIdSchema` in `createListStore.schema.ts` checks that the address parses as a URL, then makes the SHA-256 hash of the address as hex. This is the only place in the pipeline that makes an item id.
3. An address that is not a URL is logged as a warning, `an item with no valid URL is not listed: <url>: the address is not a URL`, and counted as dropped. The others go on.

### 9. Items are saved

In `saveListedItems` in `createListStore.ts`, once for the whole run:

1. LIST every key under `list/v2/data/`. The bucket client reads the pages one after another, 1,000 keys a page. With 58,000 items in the store, that is about 58 pages.
2. Keep each item once across all sources, by id. The first source in A to Z order wins.
3. PUT every item as `list/v2/data/<id>.json`, `bucket.objectsAtOnce` (64) at once. The body is the four fields as JSON. Every item is written, whether or not it was there before.
4. A PUT that fails with `SlowDown`, `TooManyRequests`, `InternalError`, `ServiceUnavailable` or `RequestTimeout` is tried again, up to `bucket.retryLimit` (3) times, from `bucket.firstRetryWaitInMs` (500) and doubling.
5. The save uses `Effect.forEach` with `discard: true`. The first PUT that still fails stops the save. The PUTs already done stay in the bucket. The save fails with the source id of that item.
6. The count of new items is the count of items whose key was not in the LIST.

In the step: a failed save is logged as `<sourceId>: the listed items could not be saved: <reason>`, and the new count becomes `none, the save failed`. The run goes on.

### 10. Failures are saved

In `saveFailures` in `createListStore.ts`:

1. For each failure, make an id: the SHA-256 hash of the failed address. A failed address that is not a URL is logged as a warning, `a listing failure with no valid URL is not saved`, and left out.
2. PUT each failure as `list/v2/errors/<id>.json`, 64 at once, in the same stop-at-first-failure way.
3. A failure with the same address as last run writes over the old record. No error record is ever deleted.

A failed save is logged as `the listing failures could not be saved: <reason>`.

### 11. The report

The step asks the client for its tally, and logs these lines:

```
List report: 382 sources in 40.1 min
  Meetings listed: 6963
  Items listed: 58048
  New items saved: 57784
  Sources with nothing listed: 22
  Listing failures: 19: skipped 8, gateway 8, blocked 3
  Most items: uk-council-moray 2092, ... 350 more
  Failed requests: 11: gateway 8, blocked 3
  Requests skipped by a host cut-off: 0
  Browser fallback: read 37, failed 8, blocked 3
```

- The minutes are from the start of the step to the end of the listing. The save is not in them.
- `Listing failures` counts the failure records of the sources. `Failed requests` counts the client's failures that were not skips. `Most items` shows the top `reporting.shownRowLimit` (10) sources.
- The step returns a summary: the sources processed, and a problem count of the listing failures, the dropped items, one for a failed item save, and one for a failed failure save. `runPipeline` then logs `Pipeline run complete`.

## What is in the bucket after a run

| Key | Body |
| --- | --- |
| `list/v2/data/<sha256 of url>.json` | `{"id":"<hex>","sourceId":"uk-council-blaby","title":"Agenda frontsheet","url":"https://.../documents/g1234/Agenda.pdf"}` |
| `list/v2/errors/<sha256 of url>.json` | `{"id":"<hex>","sourceId":"...","url":"...","failure":{"url","hostKey","requestKind","failureClass","status","failedBy","browserResult","kind","reason"}}` |

The item record has four fields and nothing else. The last-modified time of the object is the last run that listed the item, because every run writes every item it lists.

## The config this step uses

Values are from `config/production/config.yaml`. The development file, which the Mac runs use, holds the same values for these keys, with one difference: `moderngov.browserFallbackStatuses.feed` is `403, 404, 502, 504, 522` in development and `403, 404` in production.

| Key | Value | Used for |
| --- | --- | --- |
| `councils.councilsAtOnce` | 72 | Sources at once. The schema requires twice `http.mostRequestsAtOnce`. |
| `councils.documentsAtOnce` | 4 | `GetMeeting` calls at once for one council. |
| `councils.feedWindowInDays` | 7 | How far back the ModernGov feed is asked. |
| `councils.mostSitePages` | 80 | Pages per own-site crawl. |
| `councils.mostSiteMeetings` | 120 | Meetings kept per own-site council. |
| `councils.siteFutureInDays` | 14 | Own-site rank: links this far ahead rank before further ones. |
| `councils.mostCmisCommitteePages` | 80 | Committee pages per CMIS crawl. |
| `councils.mostCmisMeetingPages` | 120 | Meeting pages per CMIS crawl. |
| `councils.cmisFutureInDays` | 14 | CMIS rank, as for own site. |
| `councils.mostCoinsBodyPages` | 80 | Body-year pages per COINS crawl. |
| `councils.mostCoinsMeetingPages` | 160 | Agenda, paper and pack pages per COINS crawl. |
| `councils.coinsPastInDays` | 60 | How far back the COINS years go. |
| `councils.mostDecisionTimeMeetings` | 40 | Meetings per Decision Time council. |
| `councils.amberValleyPastInDays` | 730 | Amber Valley list window, back. |
| `councils.amberValleyFutureInDays` | 60 | Amber Valley list window, ahead. |
| `councils.mostAmberValleyMeetings` | 40 | Meetings for Amber Valley. |
| `moderngov.requestGapInSeconds` | 1 | Gap between requests to one host. |
| `moderngov.hostBurstRequests` | 5 | Requests to one host that may go with no gap. |
| `moderngov.mostHostRequestsAtOnce` | 4 | Requests in flight to one host. |
| `moderngov.hostFailureLimit` | 3 | Failures in a row before a host and kind is cut off. |
| `moderngov.hostFailureStatuses` | feed and service: 403, 404, 502, 504, 522 | The statuses that count towards the cut-off. |
| `moderngov.browserFallbackStatuses` | feed: 403, 404. service: 403, 404, 502, 504 | The statuses that send a request to the browser. |
| `moderngov.gatewayRetryLimits` | feed 2, service 2, document 1 | Retries of a gateway status. |
| `moderngov.requestTimeoutsInSeconds` | 60 for each kind | Time before a request is treated as a 504. |
| `moderngov.statusClasses` | blocked 401, 403. gone 404, 410. gateway 502, 503, 504, 522 | Status to failure class. |
| `http.mostRequestsAtOnce` | 36 | Requests in flight through the relay. |
| `http.sharedHosts` | `moderngov.co.uk`: 5 | Requests in flight to hosts under that suffix. |
| `http.retryStatuses` | 429, 502, 503, 504, 522 | Statuses sent again. |
| `http.retryLimit` | 3 | Retries, other than gateway statuses. |
| `http.firstRetryWaitInSeconds`, `http.longestRetryWaitInSeconds` | 5, 60 | Retry wait, doubling. |
| `http.redirectLimit` | 5 | Redirects followed. |
| `http.slowRequestInMs` | 15000 | A 2xx reply slower than this is logged. |
| `browser.pagesAtOnce` | 4 | Pages the browser service opens at once. |
| `pageChecks.blockTitlePhrases`, `blockHtmlPhrases` | lists | Block page detection. |
| `bucket.objectsAtOnce` | 64 | PUTs at once in a save. |
| `bucket.retryLimit`, `bucket.firstRetryWaitInMs` | 3, 500 | PUT and LIST retries. |
| `reporting.shownRowLimit` | 10 | Rows in a report line. |

## What one run looked like

The run of 20 October 2026 at 10:45. The bucket had been emptied before it, so almost every item was new.

| Time | What happened |
| --- | --- |
| 10:45:20 | Step starts. 382 sources, 72 at once. |
| 10:45:22 | First ModernGov council done (feed plus `GetMeeting` calls). |
| 10:46:00 | First own-site council done. |
| 10:47:02 to 10:47:44 | The three Decision Time councils done. |
| 10:47:58 | First CMIS council done. |
| 10:50:45 to 10:55:25 | The four COINS councils done. |
| 10:52:14 | Last own-site council done. |
| 10:54:07 | Last ModernGov council done. |
| 11:25:24 | Last CMIS council done: Moray, 120 meetings from 29 committee pages, 2,060 items. Listing ends. |
| 11:25:24 to 11:28:07 | Items built, ids made, LIST of the store, 58,048 PUTs. |
| 11:28:07 | Report: `382 sources in 40.1 min`, 6,963 meetings, 58,048 items, 57,784 new. `Pipeline run complete`. |

Other facts from that log:

| Measure | Count |
| --- | --- |
| ModernGov feeds read | 304 of 307. Cherwell got a 403. Eastleigh and Leicester got a block page. |
| `GetMeeting` failures | 6 |
| CMIS councils done | 33 of 35 |
| Own-site councils done | 27 of 29 |
| Relay lines logged | 329: 209 slow 2xx replies, 59 of 504, 17 of 403, 19 of 302, 13 of 301, 5 of 502, 5 of 429, 1 of 522, 1 of 503 |
| Relay retries logged | 55 |
| Browser fallback lines | 46 |
| Host cut-offs | 0 |

The slow 2xx replies were CMIS meeting pages, most of them Moray, North Lanarkshire, South Lanarkshire and Essex, at 15 to 59 seconds each. CMIS pages of one council are read one after another, so Moray alone took the full 40 minutes.

The run of 20 October at 12:28 ended differently. The listing took 24.2 minutes. The save then failed after about 6 seconds on one Aberdeenshire item with `S3Error: Service Unavailable`. The report said `New items saved: none, the save failed`.

## Facts that are easy to miss

These are facts about the code as it is. They are here because they are not visible from the log lines or the config alone.

1. **Every source is listed.** The step reads all 382 entries. `active` is a shape check only. `sources.hostKeys` belongs to the read step.
2. **The report time leaves out the save.** The minutes run from the step start to the end of the listing. The save of 58,000 items took about 2.7 minutes on 20 October, after the clock stopped.
3. **The log undercounts requests.** A 2xx reply is logged only when it is slower than 15 seconds. The full count is in the metric `govbase_pipeline_relay_requests`.
4. **Inside one council, pages are read in sequence.** Every page lister reads its pages one after another: start pages, committee pages, meeting pages, paper pages. Only `GetMeeting` calls run 4 at once. Across councils, 72 run at once. The run ends when the slowest council ends.
5. **Three limits apply to every request.** The host pace (one per second after a burst of five), the host semaphore (4), and the relay semaphore (36, or 5 for a `moderngov.co.uk` host). The council slots (72) are a fourth limit, on sources, not on requests.
6. **Everything is held in memory until the end.** All the meetings of all the councils, with their full detail, and then all 58,000 items, are in memory before the first PUT.
7. **Items are kept once, twice.** Within a source, by address, in lister order. Across sources, by id, in A to Z order. A document two councils publish belongs to the first council A to Z.
8. **The listers return much more than the step keeps.** The meeting date, the committee title, the meeting's page URL, the agenda item, the attachment id, the publish date, the restricted flag, the status and the location all reach `buildListedItems` and are dropped there.
9. **The cut-off counter is per host and kind, in memory, for the run.** It resets to 0 on any success. It does not carry over to the next run.
10. **A failure's reach depends on where it happens.** A feed failure drops the whole ModernGov council for the run. A `GetMeeting` failure drops one meeting. A start page failure drops the whole page-system council. A later page failure drops one page, and the crawl goes on. In own-site and COINS, a failed page still counts against the page cap.
11. **The LIST of the store is only for the count.** The PUTs happen whether or not an item was there before. The LIST reads about 58 pages, one after another.
12. **The errors folder only grows.** An error record is keyed by the failed address's hash. It is written over when the same address fails again. Nothing deletes it.
13. **The browser service also lists.** Feed and `GetMeeting` requests fall back to the browser on a 403, 404 or, for `GetMeeting`, a 502 or 504. On 20 October, 46 listing requests went that way.
14. **The feed's publish date is dropped.** The SDK reads each feed entry's link and description and keeps the meeting id and committee title. It does not keep the entry's `pubDate`. So the step cannot tell a meeting published today from one published six days ago, and calls `GetMeeting` for both.

## Sources

- `apps/pipeline/index.ts`, `src/domain/runPipeline/runPipeline.ts`, `src/domain/runSteps/runSteps.ts`, `src/domain/readSourcesFile/readSourcesFile.ts` and `.schema.ts`.
- `apps/pipeline/src/domain/buildListStep/`, `readCouncilListings/`, `readModernGovListing/`, `readOwnSiteListing/`, `readCmisListing/`, `readCoinsListing/`, `readDecisionTimeListing/`, `readAmberValleyListing/`.
- `apps/pipeline/src/infrastructure/createListStore/`, `createStoreFiles/`, `createObjectBucket/`, `createModernGovClient/`, `createHttpClient/`, `createFailureStore/createFailureStore.schema.ts`, `createPipelineConfig/createPipelineConfig.schema.ts`.
- `apps/pipeline/config/production/config.yaml`, `config/development/config.yaml`, `config/sources.yaml`, `package.json`.
- `apps/parser-sdk/src/moderngov/buildRequestUrl.ts`, `buildDocumentUrl.ts`, `readFeedXml.ts`, `readMeetingXml.ts`, `moderngov.types.ts`.
- `apps/pipeline/data/logs/list-2026-10-19T21-49-42Z.log`, `list-2026-10-20T10-45-18Z.log`, `list-2026-10-20T12-28-30Z.log`.
- `docs/pipeline-efficiency-redesign.md` for the design that follows from these facts.
