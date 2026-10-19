# Read run of 12 October 2026: ten big-ticket items

As of 12 October 2026. This file is a hand-off for Opus. No item here is built yet. Each item says what to change, where, how to test it, and what the next run must show.

The run is `2026-10-12T19-13-36-870Z`, started with `bun run dev:step:read`. The last good run is `2026-10-11T11-26-29-760Z`. Both are in `apps/pipeline/data/`.

## Short answer

| Question | Short answer |
| --- | --- |
| What happened? | The run read nothing. Every request failed on the Mac, before it left. `relay.govbase.co.uk` does not resolve. |
| Why? | The .uk registry (Nominet) has `govbase.co.uk` on `server hold`. A held name is taken out of the .uk zone, so no DNS server can find it. `browser.govbase.co.uk` is gone too. |
| Is the relay broken? | No. Through a Cloudflare edge address, the relay and the browser service both answer. The certificate, the Cloudflare zone and the DNS records are correct. |
| Is there damage after the run? | Yes. The run saved an empty bundle for all 382 councils. The next run takes its "known documents" from the newest bundle, so it would download and parse every document again. The plan step would see no meetings. See item 3. |
| What matters most? | Get the name back, and make sure one domain can never stop a whole run again (items 1 to 3). Then the losses of the last good run (items 4 to 10). |

## The two runs

| | 11 October | 12 October |
| --- | --- | --- |
| Run time | 325 min | 19 min |
| Councils lost | 54 of 382 | 382 of 382 |
| Meetings | 3,539 | 0 |
| Documents read | 21,066 of 21,524 | 0 |
| Failed requests in the run report | 24 | 748 |
| Relay replies that failed | 64 | all: 5,984 of 5,984 tries |
| Browser tries | 8 read, 11 blocked | 0, never tried |

On 12 October every failure record says the same thing:

```
cause: TypeError: getaddrinfo ENOTFOUND relay.govbase.co.uk
failureClass: connection   failedBy: unknown   browserResult: not-tried
```

`ENOTFOUND` means the Mac's resolver found no address for the name.

## How the items are ranked

The categories, in order of priority:

- **A.** Fewer blocked or dropped requests.
- **B.** Fewer lost councils.
- **C.** Fewer lost documents.
- **D.** Fewer parsing errors.

"Impact" is the share of a category that the item removes. Items 1 to 3 are measured on the 12 October run. Items 4 to 10 are measured on the 11 October run, the last run that read anything, because the 12 October run has no data for them.

| # | Item | Category | Impact | Measured on |
| --- | --- | --- | --- | --- |
| 1 | Get the hostnames back, and add a second domain | A, B | A: 100%. B: 100%. | 12 Oct: 5,984 failed tries, 382 lost councils |
| 2 | Check the relay before the read, and stop when it is down | A, B | During an outage, 100% of tries are not sent and 100% of false council losses are not recorded. No effect on a good run. | 12 Oct |
| 3 | A failed run must not become the newest bundle | A, C | A: about 21,000 repeat document requests (37.8 GB) on the next run. On 11 Oct, documents gave 58% of failed relay replies. C: 100% of read documents are hidden from the plan step until each council is read again. | 12 Oct bundles, 11 Oct log and raw bucket |
| 4 | Three councils behind a Cloudflare managed challenge | A, B | A: 40% of blocked failures (6 of 15). B: 6% (3 of 54). | 11 Oct |
| 5 | Prove the 43 new council entries with a list-only pass | B | Up to 80% (43 of 54) | 11 Oct |
| 6 | Find entries for the 7 councils still lost for site reasons | B | 13% (7 of 54) | 11 Oct |
| 7 | Let the relay send POST requests | B, C | B: 2% (1 of 54). C: not measurable from run data. | 11 Oct |
| 8 | Let the relay pass a Referer header | C | Two councils' minutes. Not measurable from run data. | Open items |
| 9 | Stop downloading agenda packs that repeat the item papers | A, D | 24% of document bytes. 35% of the text parsed. 6.5% of document requests. | 11 Oct raw bucket |
| 10 | Read the scanned pages that still give no text | D | 100% of parse failures (46 of 46) | 11 Oct |

---

## 1. Get the two hostnames back, and add a second domain (A, B)

**Impact.** A: 100% (5,984 of 5,984 tries). B: 100% (382 of 382 councils).

### Evidence

- **The registry.** Nominet's RDAP record for `govbase.co.uk` (`https://rdap.nominet.uk/uk/domain/govbase.co.uk`, checked twice on the evening of 12 October) has status `server hold`, `server update prohibited`, `server transfer prohibited`, `client transfer prohibited` and `add period`. The name was registered on 7 October 2026 at 04:12 UTC, through Cloudflare. The registrant contact has status `validated`. The name servers are `carol.ns.cloudflare.com` and `dan.ns.cloudflare.com`.
- **Public DNS.** Google (`dns.google`) and Cloudflare (`cloudflare-dns.com`) both answer `NXDOMAIN` ("no such name") for `govbase.co.uk`, `relay.govbase.co.uk` and `browser.govbase.co.uk`. The answer carries the `co.uk` SOA record, so the name is missing from the .uk zone itself. It is not a Cloudflare DNS problem.
- **The Cloudflare dashboard.** The registration shows `Active`, expiring 7 October 2027. The DNS records are correct: `relay` is an `A` record for `195.58.134.177`, proxied, and `browser` is the `govwatch-browser` tunnel, proxied. The dashboard does not show the hold.
- **The servers work.** The test sent the request to a Cloudflare edge address and set the hostname by hand:

  ```
  curl --connect-to relay.govbase.co.uk:443:104.21.0.1:443 https://relay.govbase.co.uk/healthz
  ```

  | Request | Answer |
  | --- | --- |
  | relay `/healthz` | 200, `ok` |
  | relay `/fetch/...` with no token | 401, `unauthorised`, with `Retry-After: 2` (nginx's own reply) |
  | relay `/nothing` | 404 |
  | browser `/health` | 200, `{"ok":true,...,"isExportingTraces":true}` |
  | `195.58.134.177` direct | no answer in 15 s. The firewall admits only Cloudflare, as designed. |
  | edges `104.16.132.229` and `172.67.0.1` | Cloudflare error 1034. Not every edge address serves this zone. |

  So the origin certificate is fine. Cloudflare is in Full (strict) mode, and a bad origin certificate would give a 526, not a 200.
- **When it started.** The 11 October run used the same hostname and worked until about 16:51 UTC. So the hold started between 11 October 16:51 UTC and 12 October 19:13 UTC.

### Cause

Not known. Only Nominet or Cloudflare can say. The registrant is `validated`, so it is probably not Nominet's usual contact-data check. A hold on a five-day-old name that holds the word "gov" fits Nominet's checks of new registrations for misuse. That is a guess.

### Work for the owner, now

1. Open a ticket with Cloudflare Registrar support. Cloudflare is the registrar, and only the registrar talks to Nominet. Quote the RDAP status above. Look for a mail from Nominet or Cloudflare in the registrant mailbox.
2. Until the hold is lifted, pin both names on the Mac that runs the pipeline. Bun uses the system resolver, so the pipeline follows `/etc/hosts`:

   ```
   104.21.0.1 relay.govbase.co.uk
   104.21.0.1 browser.govbase.co.uk
   ```

   Check it with `curl https://relay.govbase.co.uk/healthz`, which must print `ok`. Remove both lines when public DNS answers again. Cloudflare can move a zone to other edge addresses. If the check fails later, find a working address with the `--connect-to` test above.

### Work for Opus: a second domain, so one name can never stop a run

- **Relay.** Register a second name with a different registry, such as a `.com`, and put it on Cloudflare. Make an origin certificate for that zone. In `apps/relay/govbase-relay`, add a second `server` block for `relay.<second name>` with its own `ssl_certificate` pair. Move the shared `location` blocks into a snippet that both servers include, so the two names cannot drift apart. Keep the same token. Follow the relay rules: pin the new names in `test.sh`, change the README, deploy only with `deploy.sh`.
- **Browser.** Add a second public hostname to the same Cloudflare tunnel, on the second name.
- **Pipeline.** Change `urls.relayUrl` to `urls.relayUrls`, a list, and `urls.browserUrl` to `urls.browserUrls`. Change both committed environment files. `createPipelineConfig` joins the `urls` part into `HttpConfig` and `BrowserConfig`, so the lists reach the two clients from there. `createHttpClient.ts:465` builds the one relay base today, and `createBrowserClient.ts:165` builds the one browser base.
  - When a request gets a transport error, switch to the next base for the rest of the run, and log one line: `Relay switched: from <a> to <b> after <cause>`. A transport error is DNS, a refused connection, a reset or TLS. Every request goes to the relay, so a transport error is always about the relay, never about a council. A council's timeout comes back from the relay as a 504.
  - `buildCapturedUrl` (`createHttpClient.ts:340`) cuts the relay prefix off the URL to make the capture key. It must cut the prefix of the base that was used. The capture key must stay the council's host and path, so captures from both relays match.
- **Tests.** Point the first relay URL at `https://relay.invalid`. The `.invalid` top-level name never resolves (RFC 2606). Point the second at a local server on port 0. Every request must succeed through the second, and the switch line must appear once.

### The next run must show

- [ ] No `ENOTFOUND` line in `data/logs/read-*.log`.

---

## 2. Check the relay before the read, and stop when it is down (A, B)

**Impact.** In an outage like 12 October, 5,984 failed tries become 1 health request, 382 false lost councils become 0, and 19 minutes become a few seconds. A good run is not changed.

### Evidence

- The read step's readiness check passed, because it only checks the sources file (`buildReadStep.ts:591`).
- Each request was tried 4 times. A transport error is retried `http.retryLimit` (3) times, after waits of 5, 10 and 20 s (`createHttpClient.ts:161`). That is 35 s of waiting for each request.
- Each failure is classed `connection` (`createModernGovClient.ts:428`). It is blamed on `unknown`, because `readFailedBy` returns `unknown` for every request error (`createModernGovClient.ts:364`).
- `connection` is in `councils.secondPassFailureClasses`. So the second pass (`buildReadStep.ts:479`) repeated everything. The first pass took 5.5 min. The second pass took 13.4 min and logged `Second pass: reading 373 councils again for 374 failed requests`, then `0 of 374 recovered`.
- The report then compared the run with 11 October: `Lost councils: still 54, new 328`. That is 328 councils blamed for a relay outage.
- `bun run dev:step:read:failed` (`tools/readFailed.sh`) reads the hosts of the newest failure folder. That folder now holds 367 hosts, so it would read almost every council again.

### Work

1. **Check before the read.** Add a relay check to the read step's `readReadiness`. It sends `GET <relay>/healthz`, which needs no token. When the check fails, return `StepNotReady` with one problem: `Relay not reachable: <cause>`. The chain stops, and nothing is saved.
   - Also check `GET <browser>/health`. A browser that is down must not stop the run, because only the fallback needs it. Log a warning and count it in the run report.
   - The pipeline's `AGENTS.md` says `readReadiness` "only reads. It never saves and never sends." A `GET` to a health endpoint changes nothing on any server, so put the check there. If the owner reads the rule strictly, put the check first in `runStep` instead, before any listing.
   - Layering: the domain may not import infrastructure code. Add a method to an existing infrastructure service, such as `checkRelay` on `ModernGovClient`. It returns `Effect<void, RelayUnreachable>`, with `RelayUnreachable` a tagged error in the `.schema.ts` file. Domain code imports only the shape.
2. **Stop when the relay goes down during a run.** In the HTTP client service, count transport errors in a row in a `Ref`. Any reply from the relay resets the count. At `http.relayDownAfterErrors` (a new config value, about 20, in both environment files), mark the relay down:
   - Later requests fail at once with a `RelayDown` error, with no retries.
   - The read step lists no more councils, and it saves no bundle for a council it did not finish. See item 3.
   - The second pass does not run while the relay is down.
3. **Blame the right party.** A transport error is the relay's failure, so `readFailedBy` must return `relay` for it, not `unknown`. The report's `failuresByFailedBy` then shows an outage plainly.
4. **Protect `readFailed.sh`.** Make it refuse a failure folder from a run that stopped for a relay outage. The run report can carry a `stoppedFor` field for this.

### Tests

- `test/domain/buildReadStep/buildReadStep.test.ts`: a fake relay check that fails gives `StepNotReady`, and no bundle is saved.
- `test/infrastructure/createHttpClient/createHttpClient.test.ts`: start a server on port 0, then close it. After `relayDownAfterErrors` errors, a request fails at once with `RelayDown`, and the next relay reply resets the count.
- `test/infrastructure/createModernGovClient/...`: a transport error is `failedBy: relay`.

### The next run must show

- [ ] With the relay stopped on purpose, the run ends in seconds with one `Relay not reachable` line, and no new folder appears under `data/bundles`.

---

## 3. A failed run must not become the newest bundle (A, C)

**Impact.**

- A: the next run would request about 21,000 documents again, 37.8 GB, that the 11 October run already read. On 11 October, document requests gave 37 of the 64 failed relay replies (58%) and all 3 relay 429s.
- C: the plan step and judging read each council's newest manifest. They now see empty manifests, so 100% of the 21,066 documents read on 11 October are hidden from them until each council is read again.

### Evidence

- `data/bundles/2026-10-12T19-13-36-870Z` holds 382 manifests with no meetings. Every `meetings.ndjson.gz` is 20 bytes.
- `readKnownDocuments` (`createBundleStore.ts:171`) calls `readLatestManifest` (`:123`) with the default test `readIsAnyManifest` (`:97`). So it takes the empty 12 October bundle, and every council gets no known documents.
- A known document is reused, not fetched, only when its `documentId` and `publishedOn` match (`readKnownRecord`, `readCouncilMeetings.ts:209`). With no known documents, every listed document is fetched and parsed again.
- That is what a full read costs: on 11 October, 21,137 of the 21,172 document bodies in the raw bucket were saved that day, and the run took 325 minutes.
- `readLatestManifests` (`createBundleStore.ts:186`) feeds `buildPlanStep.ts:251` and `runJudging.ts:176`. It also takes the newest manifest of each council, whatever it holds.
- The CMIS skip for meeting pages known to be empty (`readEmptyLaterUrls`, `readCmisListing.ts:149` and `:218`) reads the newest manifest too, so it skips nothing.
- The ModernGov feed window is safe. `readLastCompleteRunAtUnixMs` (`createBundleStore.ts:134`) uses `readIsComplete` (`:99`), so the feeds start again from 11 October.

### Work for the owner, now

Move the failed run aside before the next run, so the 11 October bundles are the newest again. `data/` is ignored by git.

```
cd apps/pipeline
mkdir -p data/failed-runs
mv data/bundles/2026-10-12T19-13-36-870Z data/failures/2026-10-12T19-13-36-573Z data/failed-runs/
```

### Work for Opus

1. Add a test `readIsListed` in `createBundleStore.ts`: true when the manifest has no failure with scope `council`. Do not use `readIsComplete`, because one failed meeting in a council of 140 meetings would then skip a good bundle.
2. Use `readIsListed` in `readKnownDocumentsUnder`, `readLatestManifestUnder` and `readLatestManifestsUnder`. Keep `readIsAnyManifest` only where the report needs the true newest manifest.
3. Keep saving the failed council's manifest, because the report and the comparison need it.
4. When item 2 stops a run for a relay outage, save no manifest for the councils it did not read.

### Tests

In `test/infrastructure/createBundleStore/createBundleStore.test.ts`, write two runs. In the newer run, one council failed at council scope. `readKnownDocuments` must return that council's documents from the older run. `readLatestManifests` must return the older manifest for that council and the newer one for the others.

### The next run must show

- [ ] The run's raw captures hold only new documents, not the whole set again. The run is much shorter than 325 minutes.

---

## 4. Three councils behind a Cloudflare managed challenge (A, B)

**Impact.** A: 6 of the 15 blocked failures on 11 October (40%), and 6 of the 11 browser `blocked` results. B: 3 of 54 lost councils (6%).

### Evidence

- Cotswold (`meetings.cotswold.gov.uk`), Leicester (`cabinet.leicester.gov.uk`) and West Oxfordshire (`meetings.westoxon.gov.uk`): the feed gets a 403 at the relay, and the browser is blocked too. This happened on 10 and 11 October. They appear as "fixed" in the 12 October comparison only because nothing was read.
- `docs/open-items.md` records that Cloudflare gives these feeds a managed challenge from any data-centre address.

### Cause

Cloudflare scores the address a request comes from. Both the relay and the browser leave from data-centre addresses, and these three sites challenge such addresses.

### Work

1. **Ask first.** Write to the three councils' web teams. Ask them to allow the relay address `195.58.134.177`, or the pipeline's declared user agent, on their `mgRss.aspx`, `mgWebService.asmx` and document paths. This is the lasting fix, and it keeps the pipeline an open, declared bot.
2. **Only if they refuse, it is an owner decision.** The decision in `docs/open-items.md` is to give the browser a UK home or ISP address. The browser service has `PROXY_URL` today, but it covers the whole Chrome. A proxy for named hosts only would add a `PROXY_HOSTS` setting in `apps/browser/src/readConfig.ts`, `.env.example`, `cloud-init.yaml`, `bootstrap.sh` and the README table, per that app's rules. The pool in `src/createBrowserPool.ts` already opens one context for each host, and Playwright can give a context its own proxy.

### The next run must show

- [ ] No blocked feed for these three hosts.

---

## 5. Prove the 43 new council entries with a list-only pass (B)

**Impact.** Up to 43 of the 54 councils lost on 11 October (80%).

### Evidence

- On 11 October, 53 councils were lost with a council-scope failure. 47 of them were gaps in `config/sources.yaml`, not network faults:

  | Reason on 11 October | Councils |
  | --- | --- |
  | no reader for meetings system unknown | 32 |
  | no meetings.documents in sources.yaml | 10 |
  | no meetings.base_url in sources.yaml | 5 |
  | a block page, 403 or 502 | 6 |

- On 12 October, helpers gave 43 of those 47 a reader: 22 own-site, 9 ModernGov, 5 CMIS, 4 COINS, 2 Decision Time and 1 Amber Valley. Four still have `system: unknown`. See item 6.
- None of the 43 has run against its site through the relay yet. The 12 October run was their first chance, and it read nothing.
- Six of the ModernGov entries were set from the councils' own links, not from a fetch, because the helpers' requests left from the Netherlands: Aberdeen City, Aberdeenshire, Powys, Rhondda Cynon Taf, Caerphilly, and Derry City and Strabane.

### Work

1. Add `sources.sourceIds`, a list beside `sources.hostKeys`, in both environment files, with `[]` meaning every council. Filter on it where `hostKeys` is used (`buildReadStep.ts:85` and `:546`). `hostKeys` alone is not enough: an own-site council's host is the council's main website, and five ModernGov hosts are shared by two councils.
2. Run the list step for the 43 only, through `PIPELINE_CONFIG` as the `AGENTS.md` asks, with no new flag:

   ```
   PIPELINE_ENV=development PIPELINE_CONFIG='{run: {steps: [list]}, sources: {sourceIds: [uk-council-angus, ...]}}' bun run index.ts
   ```

   This takes minutes, not hours.
3. A council that lists no meeting has a wrong entry. Fix it in `config/sources.yaml`, and fetch the new address through the relay to check it.
4. Then run the full read.

### The next run must show

- [ ] At most 11 lost councils.

---

## 6. Find entries for the 7 councils still lost for site reasons (B)

**Impact.** 7 of 54 (13%).

### Evidence

| Council | State |
| --- | --- |
| East Renfrewshire, Fife, Inverclyde, South Ayrshire | `system: unknown` in `config/sources.yaml` |
| South Tyneside, Warrington, East Staffordshire | Their sites failed or timed out from the Netherlands. Never checked from the UK. |

Two other councils from the "Lost on every run" list in `docs/open-items.md` are left out here. Mole Valley needs a login, so no work fixes it. Suffolk needs POST, which is item 7.

### Work

1. With the hosts pin from item 1, the relay is in London again. Fetch each candidate page through it, with the token: `GET https://relay.govbase.co.uk/fetch/<host>/<path>`. All seven sites are on `.gov.uk`, so the allowlist admits them.
2. Set `meetings.system` and `meetings.base_url` from what the council really publishes. Fetch the new address to check that it serves meetings, as the pipeline's `AGENTS.md` asks. For Warrington, `docs/open-items.md` gives a probable `base_url`.
3. Prove each one with the list-only pass from item 5.

---

## 7. Let the relay send POST requests (B, C)

**Impact.** B: 1 of 54 (2%), Suffolk. C: the later pages of CMIS committee pages, and the COINS calendar months. Run data cannot count meetings that were never listed, so C is not measured.

### Evidence

- Suffolk's documents come only from ASP.NET form posts.
- A CMIS committee page shows 10 meetings. Its later pages need a form post (`__doPostBack`, with `__VIEWSTATE` and `__EVENTVALIDATION`). A committee whose newest meetings are on a later page is read only in part.
- `apps/relay/relay-proxy.conf` sends every request as a GET with no request headers (`proxy_pass_request_headers off`), so the `Content-Type` of a form is dropped.

### Work

1. **Relay.** Admit `GET` and `POST` only. Return 405 for any other method. For a POST, pass the body and set `Content-Type` from the request. Keep every other request header dropped. Pin the methods in `test.sh`. The rate limit for each host applies as it does now.
2. **Pipeline.** Add a form post to the HTTP client. In the CMIS reader, read the three ASP.NET fields from a committee page and post the next-page target. Stop at `councils.mostCmisCommitteePages`.
3. **Capture.** The raw store key is the SHA-256 of host, path and query (`createRawStore.ts:50`). Two posts to the same URL with different bodies would overwrite each other. Add the body's hash to the key for a POST.

---

## 8. Let the relay pass a Referer header (C)

**Impact.** Shetland's minutes, which are only in COINS packs, and Glasgow's minutes packs. Not measurable from run data, because those requests are refused.

### Work

1. **Relay.** Read an `X-Relay-Referer` request header and send it upstream as `Referer`. Use a `map` to accept it only when its host is the target host, so the relay cannot forge a referer for another site. Pin this in `test.sh`.
2. **Pipeline.** The COINS reader sends the pack's page address as `X-Relay-Referer`.

---

## 9. Stop downloading agenda packs that repeat the item papers (A, D)

**Impact.** On 11 October, 1,402 agenda packs repeated at least 80% of the lines of their own meeting's item papers.

| Measure | Packs that repeat item papers | Share |
| --- | --- | --- |
| Bytes downloaded | 9.22 GB | 24% of all document bytes, 34% of the bytes of read documents |
| Text parsed | 295.8 million characters | 35% of all text |
| Requests | 1,402 | 6.5% of document requests |

The time effect is smaller than the bytes suggest. Only 12 of the 165 slow good replies (15 s or more) on 11 October were packs. 125 were item papers and 28 were listing pages.

### Evidence and method

- Each parsed document was joined to its raw body in `gs://govbase-pipeline-raw-dev/raw/latest/` by the capture key. 21,172 of 21,524 documents matched.
- A pack is a document whose title matches `pack`, `agenda document`, `agenda reports`, `public reports`, `supplement` or `printed minutes`. The common titles are `Agenda Document Pack - <committee> - <date>` (ModernGov), `Supplementary Agenda Contents`, `agenda pack for this meeting` and `AgendaPack`.
- For each pack, the method took its lines longer than 40 characters and counted the share that also appear in another document of the same meeting. 1,402 of the 1,669 packs (10.12 GB) reached 80%.

### Work

This needs an owner decision first. It is "Large agenda packs" in `docs/open-items.md`.

1. **Rule.** Skip a pack when its meeting lists at least one item paper. Keep it when it is the meeting's only document, which covers the flat CMIS agendas in `docs/open-items.md`.
2. **Matching.** The text check cannot run before the download, so the rule must use the title and the link. Put the title phrases in config, as a list such as `documents.packTitlePhrases`, in both environment files. Record a skipped pack with a new unread class, such as `pack-skipped`, so it is never counted as lost.
3. **Check the rest first.** 267 packs repeated less than 80%. Some may hold late papers that are linked nowhere else. Look at 20 of them by hand before the rule ships.
4. **Lower priority.** 957 documents in the same council had exactly the same text as another document (0.46 GB), and 15 of them were listed twice under the same URL. Fetching each URL once per council removes the 15 at once.

---

## 10. Read the scanned pages that still give no text (D)

**Impact.** 46 of 46 documents lost to parsing on 11 October (100% of D): 45 `no-text` and 1 `broken-file`. Also 144 read documents over 2 MB gave less than 1,000 characters per MB (2.2 GB). These are probably scans read only in part.

### Evidence

- `no-text` by council: West Dunbartonshire 9, Harborough 7, Norwich 5, Fylde 5, Walsall 4, East Suffolk 4, and 11 more documents in other councils.
- The 11 October log holds 4 Leptonica error lines, 8 times each: `Error in pixScaleAreaMap: pixd too small`, then `pixCopyText`, `pixCopyInputFormat` and `pixClone`. A picture too small to scale breaks the scale step.

### Work

Parsing lives in `apps/parser-sdk`. Do not add parsing code to the pipeline.

1. Fetch the 46 documents from the raw bucket with the replay tools (`bun run replay:index`, `bun run replay:get`) and replay them against the SDK.
2. Skip a picture below a smallest side before it is scaled. That stops the Leptonica errors.
3. For the 144 documents with little text, compare the page count with the pages that gave text, and read the empty pages as images.
4. The parsing fixes of 12 October have not run on a full read yet. Replay before you change anything.

---

## Built on 12 October, not yet proven

The 12 October run was the first run of all the work in `docs/open-items.md`. It read nothing, so none of it is proven. The next good run must check each one:

- [ ] **Second pass.** Look for `Second pass: k of m recovered`, with `k` above 0.
- [ ] **Browser first.** Look for `Browser first:` lines, and Eastleigh with no lost meeting.
- [ ] **Body check.** Harborough's 76 recordings were 10.53 GB, 28% of all document bytes on 11 October. They must now be dropped after the first part, and Harborough must take well under its 305 minutes.
- [ ] **CMIS restricted.** 322 CMIS documents were wrongly `restricted` on 11 October. This must be close to 0.
- [ ] **36 requests at once.** Look for `Relay request: 429`. If any appear, lower `http.mostRequestsAtOnce` and `councils.councilsAtOnce` together.
- [ ] **Relay deploy.** `docs/open-items.md` still lists "Deploy the relay" as open. If the relay still allows 20 at once and waits 60 s, the pipeline's 36 at once and its 120 s second pass will meet 429s and 504s.

## How to measure the next run

- From the next relay deploy, the relay writes a span for each request, and a `govbase-relay-traces` service on the relay sends them over OTLP to the same backend as the browser. It was added on 12 October and is not deployed yet. Each span joins the pipeline's trace through `traceparent`. The spans show, for each council host: the relay's own refusals (`relay.refused`: token, allowlist, rate, places), the council's status, the time to connect, the time to the first byte, and the time for the body. Use them to count 429s and to find the slow hosts. The `X-Trace-Id` reply header names the trace. See `apps/relay/README.md`.
- A request that never reached the relay, as on 12 October, makes no relay span. Item 2's `Relay not reachable` line covers that case.

## Sources

| What | Where |
| --- | --- |
| 12 October run report | `apps/pipeline/data/bundles/2026-10-12T19-13-36-870Z/run-report.json` |
| 12 October log | `apps/pipeline/data/logs/read-2026-10-12T19-13-32Z.log`, 16,581 lines |
| 12 October failure records | `apps/pipeline/data/failures/2026-10-12T19-13-36-573Z/`, 1,496 files on 367 hosts |
| 11 October run report and bundles | `apps/pipeline/data/bundles/2026-10-11T11-26-29-760Z/` |
| 11 October log | `apps/pipeline/data/logs/read-2026-10-11T11-26-28Z.log` |
| Raw bucket | `gs://govbase-pipeline-raw-dev/raw/latest/`: 107,221 objects, 53.07 GB, saved 9 to 11 October. On 11 October, 25,909 bodies, 38.2 GB. |
| Registry record | `https://rdap.nominet.uk/uk/domain/govbase.co.uk` |
| Cloudflare | the `govbase.co.uk` zone: DNS records, and Domains, Registrations |

The raw-bucket join keys each document by `sha256(<host><path>?<query>)`, as `buildObjectKey` in `createRawStore.ts` does. Use the pattern from the earlier analyses: `bun` from `apps/pipeline` with `@google-cloud/storage`, with `storage.googleapis.com`, `oauth2.googleapis.com` and `www.googleapis.com` allowed.
