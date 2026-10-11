# Lost councils

As of 11 October 2026. Terms follow [CONTEXT.md](CONTEXT.md).

A council is **lost** in a read run when the pipeline cannot list its meetings. The run report shows the council with its reason. A lost council does not stop the run. A council lost while listing, with a request behind its failure, is listed once more later in the same run.

`apps/pipeline/config/sources.yaml` holds 382 councils. This file lists the 54 that are lost now, or were lost in the run of 10 October 2026, with the reason for each and the work to read it.

Two rules from the pipeline's `AGENTS.md` apply to all of this work:

- **Publish date.** A run lists what was published, by publish date, never by meeting date. A system with a publish-date feed is listed from it. A system without one is read again on every run, and a document not read before counts as new.
- **No hiding.** Do not change a council's system or address to take a failing council out of a run. Fix the entry so the council is read, or leave it lost.

## Summary

| Cause                                                                 | Councils | Reason in the run report                                          | Lost on                                                          |
| --------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| [No reader for the system](#1-no-reader-for-the-system)               | 32       | `no reader for meetings system unknown`                           | Every run                                                        |
| [Own site with no documents path](#2-own-site-with-no-documents-path) | 10       | `no meetings.documents in sources.yaml`                           | Every run                                                        |
| [CMIS with no committees page](#3-cmis-councils)                      | 5        | `no meetings.base_url in sources.yaml`                            | Every run                                                        |
| [CMIS committees page fails](#3-cmis-councils)                        | 2        | The failure of the committees page                                | Every run until fixed. No read run has used the CMIS reader yet. |
| [ModernGov feed fails](#4-moderngov-feed-fails)                       | 5        | `a block page came back with status 403`, or a 504 from the relay | The run of 10 October 2026. They can be lost again on any run.   |
| **Total**                                                             | **54**   |                                                                   |                                                                  |

## 1. No reader for the system

32 councils have `meetings.system: unknown` in `sources.yaml`. The pipeline has no listing maker for `unknown`, so it asks these councils for nothing, and each one is lost with the reason `no reader for meetings system unknown`.

All 32 are outside England: 17 in Scotland, 6 in Wales and 9 in Northern Ireland. An agent identified the system of each one on 11 October 2026. Three more turned out to run CMIS and are now `cmis`: North Ayrshire, Stirling and Mid Ulster.

| Order | Work                                                            | Councils         | Size                                                      |
| ----- | --------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| 1.1   | [ModernGov, data only](#11-moderngov-data-only)                 | 9                | `sources.yaml` lines, and one relay host                  |
| 1.2   | [Own site, data only](#12-own-site-data-only)                   | 9                | `sources.yaml` lines                                      |
| 1.3   | [Northgate COINS, new reader](#13-northgate-coins-new-reader)   | 4                | SDK reader, pipeline listing maker, new system value      |
| 1.4   | [Own site, new reader options](#14-own-site-new-reader-options) | 7                | New `meetings` fields, SDK and pipeline changes           |
| 1.5   | [Decision Time, new reader](#15-decision-time-new-reader)       | 2, and 1 in part | JSON reader, a per-council key, three relay hosts         |
| 1.6   | [East Ayrshire, custom app](#16-east-ayrshire-custom-app)       | 1                | Own-site option for off-host documents, or its own reader |

### 1.1 ModernGov, data only

**Why lost:** these councils run ModernGov, which the pipeline reads, but their entries still say `unknown`. The existing reader fits. Each entry needs `system: moderngov`, its `base_url`, and `fallback: chromium` where noted.

| Council                 | Nation           | `base_url`                                          | Notes                                                                      |
| ----------------------- | ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Aberdeen City           | Scotland         | `https://aberdeen.moderngov.co.uk`                  | `fallback: chromium`. The old host committees.aberdeencity.gov.uk is gone. |
| Aberdeenshire           | Scotland         | `https://aberdeenshire.moderngov.co.uk`             | `fallback: chromium`.                                                      |
| Argyll and Bute         | Scotland         | `https://www.argyll-bute.gov.uk/moderngov`          | The root has a path. The web service answered from Amsterdam.              |
| Caerphilly              | Wales            | `https://democracy.caerphilly.gov.uk`               | Timed out from Amsterdam. Check from the UK.                               |
| Isle of Anglesey        | Wales            | `https://democracy.anglesey.gov.uk`                 | Answered from Amsterdam.                                                   |
| Neath Port Talbot       | Wales            | `https://democracy.npt.gov.uk`                      | `fallback: chromium`. An Azure firewall challenge.                         |
| Powys                   | Wales            | `https://powys.moderngov.co.uk`                     | `fallback: chromium`. A Welsh copy is at powysw.moderngov.co.uk.           |
| Rhondda Cynon Taf       | Wales            | `https://rctcbc.moderngov.co.uk`                    | `fallback: chromium`.                                                      |
| Derry City and Strabane | Northern Ireland | `https://meetings.derrycityandstrabanedistrict.com` | Timed out from Amsterdam. The relay allowlist lacks this host.             |

- **Relay.** Add `meetings.derrycityandstrabanedistrict.com` to the relay allowlist: the map, `README.md` and `PINNED_ALLOW` in `test.sh`. Then deploy.
- **Check.** Fetch each `base_url` through the relay before the change, as the pipeline's `AGENTS.md` asks.

### 1.2 Own site, data only

**Why lost:** these councils publish on their own sites, and the own-site reader fits them as it is, but their entries still say `unknown`. Each entry needs `system: own-site`, its `base_url`, and its `documents` path.

| Council                  | Nation           | `base_url`                                                                                          | `documents`                        | Notes                                                                                    |
| ------------------------ | ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Highland                 | Scotland         | `https://www.highland.gov.uk/meetings`                                                              | `/download/meetings/`              | Jadu, the same as Rossendale.                                                            |
| East Lothian             | Scotland         | `https://www.eastlothian.gov.uk/council-and-democracy/committees`                                   | `/sites/default/files/`            | 29 committees. The Council page alone lists 40 meetings back to 2022.                    |
| Eilean Siar              | Scotland         | `https://www.cne-siar.gov.uk/council-and-committees/committees`                                     | `/sites/default/files/imce/`       |                                                                                          |
| Fife                     | Scotland         | `https://www.fife.gov.uk/about-your-council/politicians-and-committees/committees/`                 | `/__data/assets/pdf_file/`         | Not checked: a Cloudflare challenge. Probably `fallback: chromium`.                      |
| Inverclyde               | Scotland         | `https://www.inverclyde.gov.uk/meetings`                                                            | `/meetings/documents/`             | Not checked: timed out from Amsterdam.                                                   |
| Vale of Glamorgan        | Wales            | `https://www.valeofglamorgan.gov.uk/en/our_council/Council-Structure/minutes,_agendas_and_reports/` | `/Documents/_Committee%20Reports/` | Lists meetings oldest first, back to 2020, so the page limit reaches old meetings first. |
| Causeway Coast and Glens | Northern Ireland | `https://causewaycoastandglens.gov.uk/council/minutes`                                              | `/assets/`                         | Gets the 20 newest meetings. Older ones need `?page=N`, which sits behind `href="#"`.    |
| Antrim and Newtownabbey  | Northern Ireland | `https://antrimandnewtownabbey.gov.uk/council/committees-meetings/`                                 | `/get`                             | No page per meeting: each year page becomes one meeting.                                 |
| Mid and East Antrim      | Northern Ireland | `https://www.midandeastantrim.gov.uk/council/council-and-committee-meetings/meeting-agendas/`       | `/downloads/`                      | Agendas only. The minutes are on Decision Time, see 1.5.                                 |

### 1.3 Northgate COINS, new reader

**Why lost:** these councils run Northgate COINS, the same build on each. The pipeline has no COINS reader. Glasgow is the largest council in Scotland.

| Council          | Nation   | Site                                                              |
| ---------------- | -------- | ----------------------------------------------------------------- |
| Falkirk          | Scotland | `https://coins.falkirk.gov.uk/`                                   |
| Glasgow City     | Scotland | `https://onlineservices.glasgow.gov.uk/councillorsandcommittees/` |
| Shetland Islands | Scotland | `https://coins.shetland.gov.uk/`                                  |
| West Lothian     | Scotland | `https://coins.westlothian.gov.uk/coins/`                         |

1. Add `coins` to `MeetingsSystemSchema` in the pipeline.
2. In the SDK, add `src/coins/` with a reader that turns `Agenda.asp?meetingid=N` into the shared meeting tree, one item per agenda row. Each item's documents come from its `submissiondocuments.asp?submissionid=N` page.
3. A document link `viewDoc.asp?c=X` opens a frame. Read `viewSelectedDocument.asp?c=X` instead, which is the PDF and needs no session. A pack's `c` value differs, so read its file address from the frame page.
4. In the pipeline, add `readCoinsListing`. Look first for a list of recent publications. If there is none, list from `latestMeetings.asp` and `allBodyMeetings.asp?bodyid=N&MeetingYear=YYYY`, closest to today first, as CMIS does.
5. Add a corpus entry for one agenda page and one submission page.

### 1.4 Own site, new reader options

**Why lost:** these councils publish on their own sites, but the own-site reader cannot follow their layout yet. Each needs one or more of the [own-site reader options](#5-own-site-reader-options).

| Council                 | Nation           | Why the own-site reader cannot read it                                                                                                                                                                      | Options it needs                                                             |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Dundee City             | Scotland         | Its minutes are the HTML meeting page itself, with no file to link. Its agendas sit on a calendar page, `/reports/calendar`.                                                                                | Its own handling                                                             |
| East Renfrewshire       | Scotland         | Its committee pages sit at top-level addresses, so no one start page leads to them. It needs `fallback: chromium`. Not checked: the system is a guess.                                                      | Several start pages                                                          |
| Orkney Islands          | Scotland         | No page links its meetings. They are in an iCal feed, `/actions/_orkney/calendar/ical-feed`, and in its sitemaps.                                                                                           | Meetings from a feed                                                         |
| South Ayrshire          | Scotland         | Its meeting pages sit under `/article/`, outside the meetings page's address. Not checked: the system is a guess.                                                                                           | Meeting pages on another path                                                |
| Ards and North Down     | Northern Ireland | Its meeting pages sit under `/article/`. A year page links many meetings.                                                                                                                                   | Meeting pages on another path, dates from link text                          |
| Lisburn and Castlereagh | Northern Ireland | Its meeting pages sit under `/w/`.                                                                                                                                                                          | Meeting pages on another path                                                |
| Newry, Mourne and Down  | Northern Ireland | 9 committee pages, with no one page above them. A year page links many meetings. Some links are mp3 files. The relay allowlist lacks `newrymournedown.org`. Its `name` in `sources.yaml` ends with a space. | Several start pages, dates from link text, skip files that are not documents |

### 1.5 Decision Time, new reader

**Why lost:** these councils run Decision Time, a JavaScript app over a JSON service. The pipeline has no Decision Time reader. Mid and East Antrim keeps its minutes there too.

| Council                              | Nation           | Site                                |
| ------------------------------------ | ---------------- | ----------------------------------- |
| Armagh City, Banbridge and Craigavon | Northern Ireland | `abc.public-minutes.com`            |
| Fermanagh and Omagh                  | Northern Ireland | `fermanaghomagh.public-minutes.com` |

1. Add `decision-time` to `MeetingsSystemSchema`, and a field for the council's key. The key is in each site's public `js/main.js`.
2. List meetings with `www.decisiontime.online/face/getMeetings/<key>/0/0/0/0/0`. It returned 820 meetings back to 2015 for Armagh. First check whether the reply carries a publish or change date, so the listing can follow the publish-date rule.
3. For each meeting, read `getAgenda/<key>/<meetingKey>`, and the minutes from `getMeeting` (`MinutesDocument`) or `publicMinuteID`.
4. Fetch each file with `getDocument/<key>/<id>/pdf`.
5. **Relay.** Add `decisiontime.online`, `public-minutes.com` and `public-minutes.info` to the relay allowlist.
6. **Mid and East Antrim** has agendas on its own site and minutes on Decision Time. `sources.yaml` holds one `meetings` block per council, so reading both needs a list of blocks, or a second source entry.

### 1.6 East Ayrshire, custom app

**Why lost:** East Ayrshire runs its own app. Its document links go through a viewer on another host, which the own-site reader does not follow. The pipeline has no reader for this app.

| Council       | Nation   | Meetings           | Documents                                      |
| ------------- | -------- | ------------------ | ---------------------------------------------- |
| East Ayrshire | Scotland | `/MVC/Committees/` | `docs.east-ayrshire.gov.uk/r?f=<file address>` |

The own-site reader could fit with one more option: accept [documents on a second host](#5-own-site-reader-options), and take the file address out of `f=`. It is the lowest priority: one council.

## 2. Own site with no documents path

**Why lost:** these 10 councils have `system: own-site` and a `base_url`, but no `documents` path. The own-site reader needs that path to tell document links from other links, so each one is lost with the reason `no meetings.documents in sources.yaml`. The path was left out on purpose: the reader cannot read their layout yet. All 10 are in England, except Angus in Scotland.

| Council                  | Why the own-site reader cannot read it                                                                                  | Possible work                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Angus                    | Each document link opens a web page. The file is one more link away, under `/sites/default/files/`.                     | Follow a document page one step to its file                           |
| Cannock Chase            | Meeting pages sit outside the meetings page's address.                                                                  | Meeting pages on another path                                         |
| East Cambridgeshire      | Meeting pages are `/node/<n>`, outside the meetings page's address.                                                     | Meeting pages on another path                                         |
| Rugby                    | Meeting pages are `/web/guest/l/<id>`, outside the meetings page's address.                                             | Meeting pages on another path                                         |
| Stafford                 | Meeting pages are `/meeting/<slug>`, outside the meetings page's address. Committee pages also link documents directly. | Meeting pages on another path                                         |
| East Riding of Yorkshire | One page holds every document of every committee. Each link goes to a web page that holds the file address.             | Dates from link text, and follow a document page one step to its file |
| Wyre Forest              | One page per committee holds every meeting for years, on another host, `forms.wyreforestdc.gov.uk`.                     | Several start pages on that host, and dates from link text            |
| Amber Valley             | The meetings page is a JavaScript app. Its data comes from JSON services on `info.ambervalley.gov.uk`.                  | Its own reader for the JSON services                                  |
| Mole Valley              | Documents sit in a SharePoint folder that needs a login.                                                                | None while the documents need a login. It stays lost.                 |
| Suffolk                  | Meetings sit on `committeeminutes.suffolk.gov.uk` and open through form posts, not links.                               | Its own reader that sends the form posts                              |

## 3. CMIS councils

**Why lost:** the CMIS reader starts at a council's committees page, its `base_url`. Five councils have no `base_url` and are lost with the reason `no meetings.base_url in sources.yaml`. Two have a `base_url` whose page fails, so they are lost with that failure. No read run has used the CMIS reader yet, so these two are expected, not seen.

| Council            | Reason                     | Why                                                                                                                                                                                                        | Work                                                                               |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Birmingham         | No `base_url`              | Its committees sit on several group pages under `/birmingham/Committee/*.aspx`. The reader takes one start page.                                                                                           | Let `base_url` be a list, as in [several start pages](#5-own-site-reader-options). |
| Dudley             | No `base_url`              | Its committees pages link no committee pages. Its meetings are listed only on a calendar page, `/Meetings/tabid/116/ctl/MeetingCalendarListView/mid/543/Default.aspx`, which changes month by a form post. | A listing from the calendar page, with form posts.                                 |
| East Staffordshire | No `base_url`              | It is not a public CMIS site. It publishes on its own site, `eaststaffsbc.gov.uk`, which timed out from Amsterdam.                                                                                         | Check from the UK. Then set its correct system and entry.                          |
| South Tyneside     | No `base_url`              | Every address answered 403 from Amsterdam. Its old `base_url` was wrong and was removed.                                                                                                                   | Check from the UK, then set its committees page.                                   |
| Warrington         | No `base_url`              | Timed out from Amsterdam. The probable root is `https://cmis.warrington.gov.uk/cmis5/`.                                                                                                                    | Check from the UK, then set its committees page.                                   |
| Kingston upon Hull | The committees page fails  | Its `base_url` is the host root, `https://cmis.hullcc.gov.uk`, and lacks the `/cmis/` folder. The TLS check also fails from Amsterdam.                                                                     | Check from the UK, then set its committees page.                                   |
| Mid Ulster         | The relay refuses the host | Its site is on `mid-ulster.cmis-ni.org`. The relay allowlist now has `cmis-ni.org`, but that change is not deployed.                                                                                       | Deploy the relay.                                                                  |

## 4. ModernGov feed fails

**Why lost:** the pipeline lists a ModernGov council only from its "What's new" feed, `mgRss.aspx`, as [ADR 0003](adr/0003-list-meetings-only-from-the-published-feed.md) decides. When the feed fails, the council is lost for that run. These five were lost in the run `2026-10-10T20-20-13-694Z`. They can be read on the next run if the feed answers, and lost again on any run where it does not.

| Council          | What failed                                                                           |
| ---------------- | ------------------------------------------------------------------------------------- |
| Cotswold         | The feed gave a Cloudflare block page, status 403, to the relay and to the browser.   |
| Eastleigh        | The feed gave a Cloudflare block page, status 403, to the relay and to the browser.   |
| Leicester        | The feed gave a Cloudflare block page, status 403, to the relay and to the browser.   |
| West Oxfordshire | The feed gave a Cloudflare block page, status 403, to the relay and to the browser.   |
| Lambeth          | The relay timed out on the feed with 504, and the browser timed out after 30 seconds. |

The work is on the fetch side, not in a reader. Two hosts in the same run lost documents but not the council: see [read-run-2026-10-10-concerns.md](read-run-2026-10-10-concerns.md).

## 5. Own-site reader options

Each option is a new optional field under `meetings`, a rule in the SDK's `readSitePage`, and the crawl in `readOwnSiteListing`.

| Option                                      | Councils                                                                                                          | Change                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Meeting pages on another path               | Ards and North Down, South Ayrshire, Lisburn and Castlereagh, Cannock Chase, East Cambridgeshire, Rugby, Stafford | A `pages` path: links under it are followed, not only links under `base_url`.                    |
| Several start pages                         | Newry, Mourne and Down, East Renfrewshire, Wyre Forest, and CMIS's Birmingham                                     | `base_url` may be a list.                                                                        |
| Dates from link text                        | Antrim and Newtownabbey, Ards and North Down, Newry, Mourne and Down, East Riding of Yorkshire, Wyre Forest       | A page that links many meetings is split into one meeting per date in the link text.             |
| Skip files that are not documents           | Newry, Mourne and Down (mp3)                                                                                      | Leave out links whose type cannot be read. The SDK's `readDocument` already says `NotSupported`. |
| Find meetings from a feed                   | Orkney Islands                                                                                                    | Read meeting pages from an iCal feed or a sitemap.                                               |
| Newest first                                | Vale of Glamorgan, East Lothian                                                                                   | Read the newest meetings first, by the date in the link text.                                    |
| Follow a document page one step to its file | Angus, East Riding of Yorkshire                                                                                   | When a document link opens a web page, read the file link on that page.                          |
| Documents on a second host                  | East Ayrshire                                                                                                     | Accept documents on a named second host.                                                         |

- **Relay.** Add `newrymournedown.org` to the relay allowlist.

## 6. Checks from the UK

These could not be opened from the agent's sandbox in Amsterdam. Fetch them through the relay before changing their entries.

- **Systems guessed from search:** Fife, East Renfrewshire, South Ayrshire and Inverclyde.
- **Systems sure from links, but no meeting page opened:** Caerphilly, Derry City and Strabane, Neath Port Talbot, Powys, Rhondda Cynon Taf, Aberdeen City and Aberdeenshire.
- **CMIS with no working committees page:** Kingston upon Hull, South Tyneside and Warrington.
- **Own site not reached:** East Staffordshire.
- **ModernGov feeds that failed:** Cotswold, Eastleigh, Leicester, West Oxfordshire and Lambeth.
