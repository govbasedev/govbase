# Open items

As of 12 October 2026. This file holds every item that was still open in the workspace docs. The old docs are deleted. Git history in the workspace repository keeps them, if you need the full text.

All four app repositories are committed and pushed. The SDK is tagged `v0.3.0`, and the pipeline uses it. The SDK side of ADR 0003 is done.

## Before the next read run

- [ ] **Deploy the relay.** Run `deploy.sh`, then `check.sh`. The new version allows 40 requests at once, waits 120 seconds for a council, and adds `cmis-ni.org`, Derry, Newry and Mourne, and `www.decisiontime.online` to the allowlist.
- [ ] **Deploy the browser service.** Run `make check` in `apps/browser` on a machine with Chrome first. The tests that start Chrome were not run in the agent's sandbox. The new version keeps one browser context for each host, and fetches documents without a page load (`render: false`).
- [ ] **Update `config/local/config.yaml` in the pipeline.** Each part in that file replaces the whole part of the development config. Many keys were added on 12 October, in `councils`, `moderngov`, `http`, `reporting` and `textReading`. For each part your local file holds, copy the part again from `config/development/config.yaml`, then put back your own changes. If you skip this, the run fails at start with `PipelineConfigInvalid`. The agent cannot read the local file.
- [ ] **Check six ModernGov entries from the UK.** Aberdeen City, Aberdeenshire, Powys, Rhondda Cynon Taf, Caerphilly, and Derry City and Strabane. Their entries were set from the councils' own links, not from a fetch, because the agent's requests left from the Netherlands. Fetch each one through the relay.
- [ ] **Chelmsford, before 1 January 2027.** Its `base_url` in `sources.yaml` holds the date range `01/01/2026 to 31/12/2026`. Change it to the 2027 range. Without a range, the page shows only coming meetings.

## After the next read run

Compare the run with the run of 11 October 2026.

- [ ] **Lost councils.** 54 were lost on 11 October. Only 9 have no working entry now. Check how many the run really lost.
- [ ] **Blocked requests.** Count the `Browser first:` and `Relay again:` lines, and the `browserFirstHosts` list in the run report.
- [ ] **Second pass.** Read the `Second pass: k of m recovered` line.
- [ ] **Relay limit.** Look for `Relay request: 429` lines. The pipeline sends up to 36 requests at once (`http.mostRequestsAtOnce`), with 72 councils at once. The relay allows 40. If 429 lines appear, lower both values.
- [ ] **Time.** Compare the total run time. Own-site crawls, CMIS budgets and the image turn probes all add time. Use the `Document read:` lines to find slow documents.
- [ ] **Budgets.** Set the page budgets from the run data: `mostCmisCommitteePages` (80), `mostCmisMeetingPages` (120), `mostSiteMeetings` (120), `mostCoinsBodyPages` (80), `mostCoinsMeetingPages` (160), and the Decision Time and Amber Valley budgets.
- [ ] **Eastleigh.** Check that the browser keeps its bot check passed between meetings, now that it keeps one context for each host.
- [ ] **Own-site problems seen on 10 October.** Check if they are still there:
  - A heading with only a month, such as `Chelmsford Policy Board (January 2026)`, took the first full date from the page text. That page got 6 November 2025.
  - Pendle's meeting pages all have the heading `Agendas, reports and minutes`, so its meetings get that title, not the committee name.
  - Clackmannanshire has one archive page for each committee, and each page came through as one meeting, with documents back to 2023.

## Lost councils

A council is lost when the pipeline cannot list its meetings. The run report shows it with its reason.

### Lost on every run

| Council | Why | Work |
| --- | --- | --- |
| Suffolk | Documents come only from ASP.NET form posts. The pipeline sends GET only, and the relay drops `Content-Type`. | POST through the relay and the client. |
| Mole Valley | Documents are in a SharePoint folder that needs a login. | None while they need a login. |
| South Ayrshire | Cloudflare blocked every page from the Netherlands. The site was seen only in the Wayback Machine. | Check from the UK through the browser. The own-site options probably fit. |
| East Renfrewshire | Cloudflare, as above. Its listing is sorted by title, over 40 pages. | Check from the UK. It may need one start page for each year. |
| Fife | Cloudflare challenge. | Check from the UK, probably with `access.fallback: chromium`. |
| Inverclyde | Timed out from the Netherlands. | Check from the UK. |
| South Tyneside | The main site gives a Cloudflare challenge. `portal.southtyneside.info` gives 403 and 404. | Check from the UK. |
| Warrington | `cmis.warrington.gov.uk` timed out from the Netherlands. The probable `base_url` is `https://cmis.warrington.gov.uk/cmis5/Committees/CURRENTCOMMITTEES/CurrentCommittees2014onwards.aspx`. | Check from the UK, then set it. |
| East Staffordshire | All of `eaststaffsbc.gov.uk` timed out. | Check from the UK. |

### Lost on some runs

- **Cotswold, Leicester and West Oxfordshire.** Their feeds give a Cloudflare managed challenge to the relay and to the browser. No code change fixes this from a data-centre address. See the decision below.
- **Cherwell and Lambeth.** Gateway failures and time-outs. The second pass retries them with a 120-second limit.

### Read only in part

- **CMIS committee pages** show 10 meetings on each page. Later pages need a form post, so a committee whose newest meetings are on a later page is read only in part. This needs POST through the relay.
- **Shetland's minutes** are only in COINS packs, which need a `Referer` header. The relay drops it. Glasgow's minutes packs need the same.
- **Hull** is read from 20 committee start pages, not from every committee.

## Decisions for the owner

- [ ] **robots.txt.** Most CMIS sites answer `User-agent: *` with `Disallow: /`. Nottinghamshire disallows `/DMS/Document.ashx`. The Decision Time API (`www.decisiontime.online`) also says `Disallow: /`. The pipeline is a declared bot, and it reads these sites.
- [ ] **East Riding.** Its robots.txt asks for `Crawl-delay: 10`. The pipeline waits 2 seconds between requests to a host.
- [ ] **Cotswold, Leicester and West Oxfordshire.** Give the browser a UK home or ISP address, or ask the councils to allow the relay.
- [ ] **POST through the relay.** This would read Suffolk, the later CMIS committee pages, and the COINS calendar months.
- [ ] **`Referer` through the relay.** This would read the Shetland and Glasgow minutes packs.
- [ ] **CMIS re-read every few runs.** Not built. It breaks the rule in the pipeline's `AGENTS.md` that a site with no publish-date feed is read again on every run.
- [ ] **Large agenda packs.** A CMIS agenda pack repeats the item papers, so the same text is read twice, and a pack can be 15 MB. West Lothian's "Public Agenda" packs are 10 to 20 MB each. Decide whether to skip packs when the item papers are there.
- [ ] **The `more_meetings` design.** It joins a second listing block to a council, for Mid and East Antrim's minutes. Confirm the design before more councils use it.
- [ ] **Five pairs of councils share one ModernGov site.** Adur and Worthing, Babergh and Mid Suffolk, Broadland and South Norfolk, Eastbourne and Lewes, South Hams and West Devon. Each pair reads the same meetings twice and saves them under two source ids.
- [ ] **Welsh text.** Send Welsh blocks to the model, or leave them out with `skipLanguages: [cy]`. The baseline sends them, so the evaluation can measure the loss. 22 councils are Welsh.
- [ ] **How an SDK tag is made.** Today the SDK's local post-commit hook tags the commit that `make patch`, `make minor` or `make major` makes. With pull requests on GitHub, a GitHub Action could tag the merge to `main` instead, so a feature branch makes no tags.
- [ ] **Renovate.** Install the Renovate app on the pipeline repository, or delete `renovate.json`. The file watches only the SDK, and opens a pull request for each new tag.

## Build work

- [ ] **Docker cannot build the pipeline.** The pipeline depends on the SDK at a local path: `git+file:///Users/shauncarmody/govbase/apps/parser-sdk#v0.3.0`. Change it to `github:govbasedev/parser-sdk#v0.3.0`, run `bun install`, and change `make bump-sdk` to write that form. Renovate needs the same form.
- [ ] **Stop writing `meetings.ndjson.gz`.** The bundle store still writes it beside the version 2 manifest. Stop when a test run shows that the manifest and the text store hold the same text.
- [ ] **Measure the real token ratio.** `tokens.charactersPerToken` is still the estimate, 4. Send 20 real states to the model, and set it from `usage.input_tokens`.
- [ ] **Parser time and limits.**
  - A page image with no text is turned and read again. A 7-page Teignbridge photo document took 129 seconds, against 92 before. The 14-page sideways North Yorkshire survey took 461 seconds.
  - A page with no text whose shorter side is over `largestPageShortSideInPoints` (1,400 points) is not drawn. A scan saved at one point per pixel is skipped too, so a scanned letter saved that way would be missed.
  - A grey picture that the PDF marks as colour is mended only after a failed draw, so a broken page is drawn twice.
  - 2 of the 46 unread documents of the 11 October run are still read wrong.
- [ ] **Later, if wanted:** let the SDK's Effect layer return the tagged document read itself, so the pipeline does not rebuild one from an Effect failure. Check first that the pipeline still does this.

## Known limits

These are limits of the sources, not bugs. They stay open because no work removes them today.

- **Own-site documents have no publish date.** A council that replaces a file at the same address keeps the old text, because the known record matches.
- **A meeting id is a hash of its page address.** A site that moves its pages makes every meeting new.
- **Flat CMIS agendas.** Castle Point, Derby, Fylde, Norfolk, Sunderland, Walsall, Warwick and West Dunbartonshire list documents with no agenda items. Each meeting comes through as one item, `Meeting documents`. The item number is only in each document title, and each council writes it differently. Dudley is flat too.
- **Withdrawals.** A withdrawal shows only when a meeting is read again, which happens only when new material is published for it. An item missing from one run means nothing by itself.

## The evaluation proof of concept

The pipeline already has the parts the POC runs on: the `plan` and `send` steps, the judging config files (`tagging.yaml`, `recipes.yaml`, `questions.yaml`, `experiments.yaml`, `issues.yaml`), the text store, the judgment store, and the TypeSafe client. The labels, the baselines, the tests and the report are not built.

### The claim

AI judgment about what a council agenda item is about, and what it decides, is more useful than keyword matching for an analyst who follows national issues. The proof of concept (POC) tests this on two issues: local government reorganisation (LGR) and devolution.

In the POC: a local SQLite store of item versions, evidence, judgments, keyword results and labels, and an evaluation report. No app, brief, alert or production storage. Council position, service areas, the quote check, briefs and alerts, and other issues come later.

### Judgments to ask

| Judgment | Type | Stage | Asked on |
| --- | --- | --- | --- |
| About LGR, about devolution | One Noul each | Agenda and minutes | Every item that is not a private-case item (step 1) |
| Procedural item | Noul | Agenda and minutes | Every item that is not a private-case item (step 1) |
| Decides on, for each issue that passed "about" | Noul, with the premise "If this item is about ..." | Agenda | Items where an issue Noul passed a low threshold (step 2) |
| Decides on, at the minutes stage | Noul for each issue | Minutes | The same items |
| Decision span class | Choice for each span: substantive decision, noting, procedural, not a decision | Minutes | Phase 2 items with minutes |
| Decision taken | Noul for each item | Minutes | Phase 2 items with minutes |

A Noul gives the probability of yes. A Choice picks one option. "Mentions" is never asked: it is the keyword baseline. Store raw probabilities, never yes-or-no labels (ADR 0001).

### Keyword baselines

Fix them on the practice sample before the test sample is labelled.

| Test | Baseline A | Baseline B |
| --- | --- | --- |
| About an issue | Issue words in the title only | Issue words anywhere, documents included |
| Procedural item | A list of standard titles, such as "apologies" | — |
| Decision spans | "RESOLVED" in capitals | "resolved", "agreed", "carried" or "decision", in any case |
| Decides on (agenda) | Words such as "to approve" or "to note" in the agenda text | — |

### Labels

One labeller makes all labels. To measure agreement, the labeller labels 50 test items again 2 weeks later, without the first labels. Each label records item truth (the answer for the real item, with the whole documents) and state truth (the answer from only the evidence sent). Pass marks use item truth (ADR 0002).

Issue test: run both methods on every item, then sample from these groups. Label in random order, without showing the group. Weight the results back to all items, with ranges of uncertainty. Keep a practice sample of about 100 items apart.

| Group | Keyword says | Model says | Sample |
| --- | --- | --- | --- |
| A | yes | yes | 40 |
| B | yes | no | 50 |
| C | no | yes | 50 |
| D1 | no, but related words | no | 40 |
| D2 | no | no | 100, more from items the model rated higher |

Decision-span test: practice 30 items. Test 100 items with minutes: 30 with "RESOLVED" in capitals, 30 with "resolved" in normal case only, 40 with none of the words. Mark every span, its class and its decision group.

Worked examples for "about":

| Case | About | Decides on |
| --- | --- | --- |
| Budget report with its own section on LGR costs | Yes | Depends on the recommendations |
| Housing strategy that says "subject to LGR" twice | No | No |
| Scrutiny work programme with an "LGR update" row | No | No |
| Motion on notice asking the government to pause LGR | Yes | Yes |
| Bradford "A650 Improvement Project", paid for by a combined authority | No | No |
| Hinckley and Bosworth "Leader's Position Statement" | Yes, if LGR has its own paragraph or heading | Usually no |
| A public question about LGR, with its answer | Yes | No |
| Teignbridge, asking for a report on the costs of LGR | Yes | Yes |
| East Devon "Local Government Reorganisation, Devolution and Transformation" | Yes for both issues | Depends on the recommendations |

### Gates

- [ ] **Gate 0, before phase 1.**
  - [x] The store keeps item versions from one run to the next.
  - [x] Code proves that no private-case item is sent. A test in `buildItemStates` covers it.
  - [ ] The keyword baselines and the label guide are fixed.
  - [ ] TypeSafe's Data Processing Agreement is accepted, its sub-processor list is read, and zero data retention is in place or the agreed retention is acceptable.
- [ ] **Gate 1, the issue test.** All must hold, on item truth, weighted to all items:
  1. The model's precision is at least 15 points higher than baseline B.
  2. The model's recall is at least 15 points higher than baseline A.
  3. McNemar's test on the disagreements gives p < 0.05.
  4. The labeller's second pass agrees with the first on at least 90% of issue labels.
  5. Step 1 with the short state loses no more than 5 points of recall against the full state (`baseline` against `full-state`).
  6. The procedural Noul has at least 98% precision.

  Report calibration and cost too, but they are not a gate. If the model does not beat the better keyword baseline on both precision and recall, stop, and decide whether to change the question or drop the idea. If check 5 fails, keep line breaks in document text, add document headings to the state, and test again.
- [ ] **Gate 2.** 2a: decision spans beat baseline B, not only baseline A. 2b: "decides on" forecasts match their outcomes. First on rebuilt item versions, marked as rebuilt. Then on forecasts stored before the meeting, from 6 weeks of local runs on a schedule.

### Gaps to measure or report

- **Minutes delay.** Measure how long minutes take to appear, in week 1 of the runs. If most take over 4 weeks, make the 6-week period longer.
- **Public questions.** The question text is usually in the minutes or a question pack, not the agenda text. Expect this to show as lost recall in check 5.
- **Rebuilt versions** are not what was seen at the time. A council may edit an agenda after the meeting.
- **Rare issues.** About 1% of items are about LGR or devolution, so the ranges will be wide. Do not round them into a clean claim.
- **One labeller.** Report this as a limit.

### Privacy rules

1. Store evidence as published. Do not remove names.
2. Never extract people as entities. No question has a person as its answer.
3. Never build an index or a search by person. Users get no free-text search over evidence.
4. Never quote text that names or identifies a private individual, including by address.
5. Send only what each question needs. Never send private-case items: licensing, standards, and planning applications.
6. Follow withdrawals. A withdrawn item is never used in any output.
7. Get legal advice and a data protection impact assessment before production.

The Open Government Licence does not cover personal data.

### After the POC

Each of these waits for the POC gates.

- **Quote check (phase 3).** A Noul that blocks any quote that names or identifies a private individual. Test it with an honorary alderman: a former councillor who no longer holds office, and so a private individual.
- **Brief and alerts (phase 4).** A brief for each issue, and alerts for meetings before the next brief.
- **Decision type and outcome.** A Choice for the decision type (budget, contract, policy, asset sale, planning, appointment), a significance Score, and an outcome Choice (approved, refused, deferred, amended).
- **Planning signal.** "Did members go against the officer's recommendation?" needs planning-application items, which are private-case items and are never sent. It needs a new privacy decision.
- **Contract and money tracker.** For a supplier or bid team. Code finds amounts, company names and terms, and a Choice picks the value, the supplier and the term.
- **Financial and service stress score.** A Score for each signal (overspend, use of reserves, section 114, exceptional financial support, limited audit assurance, Ofsted or CQC concerns), joined with weights in code.
- **Compare councils on one issue.** For each statement: its source (a Choice), whether it binds (a Noul), and its stance (a Choice). Code makes the council position from binding decisions only. Labels come from analysts' own notes.
- **Accountability signals.** Call-ins, notices of motion, petitions and public questions. A public question is sent but never quoted.
- **Personal watchlists.** Follow an issue, a programme, a council, an area or a company. Never a person.
