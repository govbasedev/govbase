# Read run of 10 October 2026: points of concern

As of 11 October 2026. Terms follow [CONTEXT.md](CONTEXT.md). This file lists what is still wrong or weak after the work on the read run `2026-10-10T20-20-13-694Z`. That work fixed parsing failures in `apps/parser-sdk`, added readers for councils that run their own meetings site and for councils on CMIS, and split the council reader in `apps/pipeline` into one listing maker per system and one shared meeting reader.

Status: the SDK work up to the turn probing and the picture mend is committed as `wip` in `apps/parser-sdk`, but not tagged. The own-site and CMIS readers in the SDK, every pipeline change, and one relay change are not committed. The pipeline still pins SDK `v0.1.1`, so its own typecheck and some tests fail until the SDK is tagged and `make bump-sdk` runs. The agent ran the full pipeline checks against the new SDK in a scratch copy outside the repo: 446 tests passed with full coverage. The SDK's own checks pass in its repo: 183 tests with full coverage.

## Councils not read

Every council in `config/sources.yaml` is now in every run. A council the pipeline cannot read is lost, with its reason. It is no longer left out without a trace.

- **54 councils are lost.** [lost-councils.md](lost-councils.md) lists each one, grouped by cause, with its reason and the work to read it. 32 have no reader, 10 are own-site councils with no `documents` path, 7 are CMIS councils, and 5 lost their ModernGov feed in this run.
- **Rossendale was hidden before.** A commit on 10 October 2026 moved it to `own-site` with no browser fallback, which took it out of every run. The pipeline's `AGENTS.md` now forbids changing a council's system or address to take a failing council out of a run.

## Own-site reader

The reader starts at the meetings page, follows links on the same host under that page's address, deeper pages first, and stops at `councils.mostSitePages`, now 80. A page that links documents no earlier page linked is one meeting.

- **No feed.** Own sites have no list of new publications. Each run reads up to 80 pages of each own-site council, whether anything changed or not. A recent meeting is found only if the page limit reaches it.
- **Future meetings first.** Hartlepool and North Warwickshire list future meetings, with no documents yet, at the top. At 40 pages Hartlepool gave no meeting. At 80 pages it gave 25.
- **Chelmsford goes stale on 1 January 2027.** Its `base_url` holds the date range `01/01/2026 to 31/12/2026`, because the page shows only coming meetings without one.
- **Dates can be wrong.** The meeting date is the first date in the heading, the title, or the page text. A heading with only a month, such as `Chelmsford Policy Board (January 2026)`, gets the first full date from the page text instead. That page got 6 November 2025.
- **Titles can be generic.** Pendle's meeting pages use the heading `Agendas, reports and minutes`, so the meetings checked got that title, not the committee's name.
- **One page can hold many meetings.** Clackmannanshire's archive pages, one per committee, come through as one meeting each, with documents back to 2023.
- **A changed file is not read again.** Own-site documents have no publish date. A council that replaces a file at the same address keeps the old text, because the known record matches.
- **New addresses look like new meetings.** A meeting id is a hash of its page address. A site that moves its pages makes every meeting new.
- **Page requests count as document requests.** The crawl fetches pages with the same call as documents, so a failed page shows as a failed `document` request in the run report.

## CMIS reader

The CMIS reader starts at the council's committees page, reads each committee page, then reads the meeting pages it links, closest to today first, up to `councils.mostCmisPages`, now 160. A live run on Luton read all 101 meetings its 33 committee pages link: 73 with documents, 585 documents in all.

- **robots.txt.** Most CMIS sites answer `User-agent: *` with `Disallow: /`. Nottinghamshire disallows `/DMS/Document.ashx`. The pipeline is a declared bot. Whether it should read these sites is a decision for the project, made before the next run.
- **No publish-date list.** CMIS's only feed, `RSSFeed.ashx?type=Meeting`, lists coming meetings. So every run reads the committee pages and up to 160 pages per council again. A paper published late for an older meeting is found while the page limit still reaches that meeting. The page limit costs up to 160 page requests per CMIS council per run, about 190 KB each on Luton.
- **Large councils.** Sunderland has 66 committees, so 67 of its 160 pages are listing pages. Its committee pages linked 214 meetings.
- **Flat agendas.** Eight councils that are read list their documents with no agenda items: Castle Point, Derby, Fylde, Norfolk, Sunderland, Walsall, Warwick and West Dunbartonshire. Each of their meetings comes through as one item, `Meeting documents`. The item number is only in each document title, written differently by each council. Dudley's meeting pages are flat too, but Dudley is lost.
- **The agenda pack is read too.** The pack repeats the item reports, so the same text is read twice, and a pack can be 15 MB.
- **Not read yet.** Seven CMIS councils are lost. See [lost-councils.md](lost-councils.md).

## Parser changes

| Change                                                                                                     | Concern                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page image with no text is turned a quarter, a half and three quarters, and read again in its best turn. | Documents of photos take longer. A 7-page Teignbridge photo document took 129 seconds, against 92 before. The 14-page sideways North Yorkshire survey took 461 seconds.      |
| A page with no text whose shorter side is over 1,200 points is a drawing and is not drawn.                 | A scan saved at one point per pixel, such as 3,060 by 4,080 points, is skipped too. No such page in this run held text, but a scanned letter saved that way would be missed. |
| A grey picture that the PDF marks as colour is mended, and the page is drawn again.                        | The mend runs only after a failed draw, so a broken page is drawn twice. The Bradford plan took 1 second to fail and 7 seconds to redraw.                                    |
| The no-text reason now reads `no text, even in the page images turned each way`.                           | Every document unread with the old reason is fetched and read once more on the next run.                                                                                     |

- **Plan noise.** The Bradford plan `23 Peckover Street - App 1b` was a broken file. It now reads as 2 lines of street names and OCR noise.

## Run of 10 October: fetch failures

These are not parsing failures. They need work on the fetch side.

| Council or host                                           | What failed                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Cotswold, Eastleigh, Leicester, West Oxfordshire, Lambeth | The feed failed, so each council was lost. See [lost-councils.md](lost-councils.md).                  |
| `moderngov.denbighshire.gov.uk`                           | 20 documents failed with 502, and 5 more were skipped by the host cut-off. The browser was not tried. |
| `modgov.shropshire.gov.uk`                                | 24 requests were skipped by the host cut-off.                                                         |

## Before the next run

- [ ] In `apps/parser-sdk`, commit the own-site page reader and run `make minor`. Use minor, not patch: the committed `wip` renames the reading option `largestPageSideInPoints` to `largestPageShortSideInPoints`.
- [ ] In `apps/pipeline`, run `make bump-sdk`, then commit.
- [ ] In `config/local/config.yaml`, if it has a `councils` part, add `mostSitePages: 80`. If it has a `textReading` part, rename the reading option above and add `turnedImageSide: 1000` and `leastTurnedWords: 12`. The agent could not read that file.
- [ ] Decide whether the pipeline reads CMIS sites whose robots.txt disallows all bots.
- [ ] In `apps/relay`, commit the `cmis-ni.org` allowlist change and deploy it with `deploy.sh`, then run `check.sh`.
- [ ] In your local pipeline config, if it has a `councils` part, add `mostCmisPages: 160` as well.
- [ ] Before 1 January 2027, change Chelmsford's date range in `sources.yaml`.
- [ ] After the next read run, compare its run time with this one. Own-site crawls and turn probes both add time.
