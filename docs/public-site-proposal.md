# A public website from the meeting data

As of 6 November 2026. A proposal, not a decision.

## The question

The owner wants a public website built from the council meeting data in
the pipeline stores. The site is English only and is built on a schedule.
Astro, a tool that turns markdown and data files into static web pages,
will render it. The site must earn search traffic and be worth reading.

This document records what the stores hold, what stories the data can
tell, and five ways to show it as pages. It ends with one recommendation
and the open questions.

## What the stores hold today

The numbers come from the newest snapshot of each store in the
development bucket, `govbase-pipeline-documents-dev`, written by one
chain run on 30 October 2026. The production bucket named in the config,
`govbase-pipeline-documents`, did not exist when checked on 6 November.
So the development bucket is the only data there is.

| What | Count |
| --- | --- |
| Council sources in `sources.yaml` | 382 |
| Sources with at least one meeting in the window | 353 |
| Current meetings | 1,434 |
| Meetings with a joined file | 1,406 |
| Links (meeting pages and papers) | 16,344 |
| Papers fetched | 15,925 |
| Papers that could not be fetched | 397 |
| Papers parsed to markdown | 15,848 |
| Papers with OCR text | 756 |
| Topics in `topics.yaml` | 95 |
| Words of text in all | 65,078,518 |

Meeting dates run from 7 September to 24 November 2026. As of the run
date, 786 meetings were still to come and 648 had passed. So more than
half the data is agendas for meetings that have not happened yet.

### Rich

- **Text.** The median paper has 1,534 words. The median meeting has
  25,694 words across a median of 9 papers. That is far more than a
  council's own site shows as HTML, where the papers are PDFs.
- **Structure inside a meeting.** The joined file names each paper with
  its link title and keeps page order. The meeting page markdown holds
  the agenda table with item numbers, item titles and links to each
  paper.
- **Topic counts.** Every paper has a count for every topic in three
  zones: the link title, the heading lines, and the body text. A zone is
  one part of a paper, counted on its own.
- **Council facts.** `sources.yaml` gives each council a display name,
  an ONS code, a nation (England 317, Scotland 32, Wales 22, Northern
  Ireland 11), a parent council, its website and a licence. Every
  entry says OGL-3.0, the Open Government Licence.
- **Breadth.** 353 councils and 813 distinct committee names in six
  weeks. Cabinet 94, Planning Committee 77, Licensing Sub-Committee 52,
  Council 49.

### Thin

- **Per council.** 65 councils have one meeting in the window. 109 have
  two or three. Only 41 have eight or more. 29 sources have none.
- **Per meeting.** 100 meetings have the meeting page and no papers. 45
  joined files are under 300 words.
- **Scans.** Only 756 papers have OCR text. A scan without OCR shows
  page images and no words.
- **Over time.** One listing run exists. There is no history yet to show
  a topic rising or falling.
- **Too thick.** The largest meeting file is 1,530,227 words and 5.8 MB
  (Haringey Strategic Planning, a whole Local Plan). The 90th percentile
  meeting is 110,790 words. These cannot be one web page.

### Missing

- **Agenda items as records.** The glossary in `CONTEXT.md` makes the
  agenda item the unit, but no store has one. The agenda table is only
  text inside the meeting page markdown. Pulling items out of it would
  be new parsing. That is a guess about effort, not a measurement.
- **Agenda stage versus minutes stage.** No field says whether a
  meeting has minutes. The site can only compare the meeting date with
  the build date. 949 meetings link a paper titled "minutes", but that
  is almost always the previous meeting's minutes.
- **Decisions, summaries, councillor names, wards.** None exist in the
  stores.
- **Clean meeting page text.** The meeting page markdown includes the
  council site's menus, login links and skip links. It needs trimming
  before it is shown.
- **Clean topic signal.** See the next section.

## What the topic counts can and cannot say

The body count is noisy. The phrase lists hold common single words:
`attendance`, `absence`, `events`, `survey`, `engagement`, `audit`,
`governance`, `sport`, `village`. So `school-attendance` lists 1,385 of
1,406 meetings, because every agenda has "apologies for absence". The
median paper hits 11 topics. 15,335 of 15,848 papers hit at least one.

A stricter rule gives a usable signal. Counting a meeting only when a
topic phrase is in a link title or a heading gives:

| Topic | Any mention | Title or heading | Body 50 or more |
| --- | --- | --- | --- |
| consultation-and-engagement | 1,269 | 336 | 514 |
| council-finances | 1,033 | 284 | 345 |
| planning | 918 | 245 | 303 |
| school-attendance | 1,385 | 111 | 68 |
| disability-and-accessibility | 1,233 | 107 | 163 |

Under the title-or-heading rule the median topic lists 43 meetings, the
smallest 2 and the largest 336. 1,127 of 1,434 meetings have at least
one such topic, with a median of 3 topics each. That is the shape of a
topic page that reads as true.

Ranking within one meeting also works, even with body counts alone. The
Durham Safer and Stronger Communities Overview and Scrutiny Committee of
2 November 2026 has 9 papers and no title or heading hit at all. Its
body totals are drugs-and-alcohol 95, crime-and-policing 79,
anti-social-behaviour 46. That is what the meeting is about. So: rank
topics inside a meeting by body count, but list a meeting under a topic
only by the stricter rule. The design document for the index step says
such a rule belongs in the `index` config, not in an app.

## Stories the data supports today

1. **What one meeting is about, before it happens.** Supported now for
   1,406 meetings. The papers, their titles, the agenda table and the
   top topics by count.
2. **Which councils are talking about a topic this month.** Supported
   now under the stricter rule. For example 245 meetings have planning
   in a title or heading, across many councils.
3. **How a council's agenda differs from the national mix.** Supported,
   but thin for most councils. Camden gives 26.4% of its topic mentions
   to schools-and-education against 6.6% nationally. Leeds gives 19.6%
   to biodiversity against 3.6%. Wiltshire gives 14.1% to carers against
   0.8%. One long paper can skew a council with few meetings, so this
   needs a least number of meetings before it is shown.
4. **The week ahead across the UK.** Supported now. 786 of 1,434
   meetings were still to come at the run. Grouping by week and nation
   is a plain file sort.
5. **A topic rising or falling over time.** Not supported yet. It needs
   daily runs to build up meetings by date for some months. How many
   months is a guess; three feels like the least.

## Five ways to show the data as pages

### 1. One page per meeting

- **Reader gets.** Council, committee, date, a link to the council's own
  page, the agenda table, each paper with its title, a link to the
  original file, its length, and its top topics. A short preview of each
  paper. The full text on a second page per paper, or behind a toggle.
- **Search it matches.** "Durham council scrutiny committee 2 November
  2026", "Haringey local plan cabinet report", a paper's exact title.
  These are specific searches that few people make each, but there are
  many of them, and council sites answer them with a PDF.
- **Data it needs.** The list event and its links, the join record and
  file, the topic records of its text keys, and the council's name from
  `sources.yaml`. All exist.
- **Thin edges.** 100 meetings with no papers. 45 under 300 words. The
  largest file is 5.8 MB, so the full text must be split by paper. Page
  text includes site menus until trimmed. 410 meetings, 29%, are
  planning, licensing or standards committees, whose papers name
  private individuals.

### 2. One page per council

- **Reader gets.** The council's name, nation and website. Its coming
  meetings and its past meetings in the window. Its top topics by the
  stricter rule.
- **Search it matches.** "Adur council meetings", "Fylde council
  agenda", "what is Camden council discussing".
- **Data it needs.** `sources.yaml` and the list store. Topic counts for
  the topic list.
- **Thin edges.** 65 councils with one meeting and 29 with none. A page
  with one meeting is a list of one. It needs a plain "no meetings
  listed since <date>" line, not an empty page.

### 3. One page per topic, UK wide

- **Reader gets.** What the topic means, in the plain phrases from
  `topics.yaml`. The meetings that cover it, newest first, grouped by
  week, with the council and committee. Later, a count by month.
- **Search it matches.** "councils discussing local government
  reorganisation", "council meetings on temporary accommodation".
- **Data it needs.** The index record per topic, filtered by the
  stricter rule, plus the join file key for each meeting link.
- **Thin edges.** Smallest topic lists 2 meetings under the rule
  (misinformation and nhs-dentists are the smallest by any rule). The
  largest lists 336. A page of 336 rows needs paging by month. Trend
  charts are not honest until months of runs exist.

### 4. One page per council and topic

- **Reader gets.** What one council has said about one topic. The
  meetings, the papers that mention it most, and short quotes around
  the matches.
- **Search it matches.** "Leeds council biodiversity", "Wiltshire
  council carers". These are the searches an analyst or a local
  reporter makes.
- **Data it needs.** The same as pages 1 and 3, cut by source id. Quotes
  need the paper text and the phrase list, found at build time.
- **Thin edges.** Most of the 95 by 353 pairs are empty. Build a page
  only where the stricter rule gives at least one meeting, and link it
  from the council page. Otherwise the site fills with near-empty pages
  that search engines punish. That last part is a judgment, not a
  measurement.

### 5. This week in council meetings

- **Reader gets.** One page per week: the meetings that week by nation
  and day, with the top three topics of each, and the topics that most
  meetings share that week.
- **Search it matches.** "council meetings this week", "council
  meetings 10 November 2026". Also a natural home page and a weekly
  share link.
- **Data it needs.** The list store sorted by date, the index records,
  and the council names.
- **Thin edges.** Weeks before 7 September 2026 do not exist. Weeks far
  ahead are thin because councils publish agendas about a week before
  the meeting. The current week is the only rich one until history
  builds.

A page per paper was considered and set aside. It would make about
16,000 pages whose text already exists on council sites as PDFs, so a
search engine sees a copy and little else.

## MVP: every topic, national charts, and a programmatic page set

The owner asked for a first version that does two things. A: show all
topics. B: show the topics at a national level with charts. A first
draft of this section proposed 97 pages: one national page, one list of
topics and one page per topic. The owner rejected it: 97 pages with
generic names such as "Planning" or "Council finances" will not earn
search traffic. Those words are owned by large sites.

This version keeps A and B, and builds them on a programmatic SEO
strategy. Programmatic SEO means: pick a search that many people make
with one word changed, such as "Leeds council biodiversity", write one
page template for it, and build one page for every value of that word
from the data. Each page must then hold content that only its data can
give, or search engines treat the set as copies and rank none of them.

Every number below is from the 30 October snapshot. The search phrases
are guesses about what people type. Nothing here measured search
demand.

### The page templates

| Template | Search it matches (guess) | Pages today | Grows |
| --- | --- | --- | --- |
| Council × topic | "[council] council [topic]" | 6,998 with one meeting or more; 1,809 with two or more | with every run |
| Council | "[council] council meetings" | 353 with a meeting; 382 in all | content grows, count fixed |
| Topic, UK wide | "which councils are discussing [topic]" | 95 | fixed |
| Topic × nation | "Welsh councils [topic]" | 298 with one meeting or more; 171 with five or more | slowly |
| National overview and all topics | "what are UK councils discussing" | 2 | fixed |

The council × topic page is the engine. It is the only template with
thousands of distinct searches behind it, each naming a place and a
subject, which is what a person who wants this data types. The other
templates are hubs. A hub's job is to link every spoke page, so search
engines find them all and the site reads as one thing.

Two templates are measured and left for later:

- **One page per meeting.** 1,406 today and about 137 a week in October.
  It is the largest and most unique set, and the second slice in the
  recommendation. In the MVP, meeting rows link to the council's own
  page.
- **Council × committee.** 1,277 pairs, but only 135 have two meetings
  in the window. Committees recur, so this set gets good after months.
- **Topic × month.** 256 pages today. An archive hub for later.

### Rules that decide which pages exist

A meeting counts for a topic under a middle rule: a phrase in a link
title or a heading, or 50 or more body mentions. The stricter rule
alone gives 4,415 council × topic pages. The middle rule gives 6,998.
Any body mention gives 25,839, most of them noise.

- **Build** a council × topic page when it has one meeting or more
  under the middle rule. 6,998 pages.
- **Let search engines index** it only when it has two meetings or
  more. 1,809 pages. The rest carry a `noindex` tag until they grow.
  This is a judgment about where thin begins.
- **Build every** council page and topic page, whatever the count. A
  council with no meeting gets a page that says so with the date of its
  last listing.
- **Topic × nation** pages are indexed at five meetings or more. 171.

Under these rules the MVP builds about 7,750 pages and asks search
engines to index about 2,560 of them on day one. The indexable set grows
with each daily run.

### What makes each council × topic page unique

A page template with the same words on every page is not enough. Each
page must hold what only its data gives:

1. **A count line.** "4 meetings of Leeds since 7 September 2026 had
   biodiversity in a title or heading." Dates and counts from the index
   record.
2. **The meetings.** Committee, date and a link. From the list store.
3. **The papers that mention it most.** Title, link to the original,
   and the mention count. From the topic records of the meeting's text
   keys, joined through the join record. The median page has 5 such
   papers with five or more body mentions. 199 pages have none, and the
   90th percentile has 15.
4. **This council against the UK.** Its share of mentions on this topic
   against the national share, as a two-bar chart. Leeds gives 19.6% of
   its mentions to biodiversity against 3.6% nationally.
5. **Excerpts.** A short run of words around each match in the top
   papers. This is the strongest unique content and the one costly
   feature: it needs the paper text at build time. The texts are 65
   million words in 15,848 files. A build must cache them and fetch only
   new ones. Effort is a guess.
6. **Links to siblings.** The council's other topic pages, a median of
   18 per council and at most 70, and the same topic in nearby councils
   through `parent_id` in `sources.yaml`, which groups districts under
   their county, such as 12 under Kent.

A council with one meeting in the window is the main copy risk. Its
topic pages would all list the same meeting. The index rule above holds
them out of search until a second meeting arrives, and the papers and
excerpts differ by topic even then.

### Addresses and names

- Council slug from the source `id` with `uk-council-` removed:
  `/councils/leeds/`. Topic slug from the topic `id`:
  `/councils/leeds/biodiversity/`. Both ids are stable by rule.
- `sources.yaml` gives short names such as "Leeds" and "Adur". Page
  titles need the name people type, such as "Leeds City Council". The
  file has no field for it. That is a question below.
- Every page carries breadcrumbs, a "last updated" date from its newest
  index entry, and a sitemap entry with that date.

### A and B: all topics and the national charts

The hubs carry the charts. These are the charts the data supports now,
each checked against the snapshot under the stricter rule.

| Chart | Where | Numbers today |
| --- | --- | --- |
| C1 Meetings per topic, all 95 | national overview, all topics | 2 to 336, median 43 |
| C2 Councils per topic | national overview | 2 to 192, median 37 |
| C3 Share of each nation's meetings | topic page, topic × nation page | schools 36.6% Scotland, 13.7% England |
| C4 Mentions per 10,000 words | national overview | 0.0 to 19.2 |
| C5 Topics by committee kind | topic page | adult social care: 45 of 111 are scrutiny |
| C6 Topics that go together | topic page, as a list | top pair 140 meetings |
| C7 This council against the UK | council × topic page | two bars |

Nation shares rest on 1,216 English, 120 Welsh, 71 Scottish and 27
Northern Irish meetings, so the small nations swing on a few meetings.
Show the count beside each share. The committee kind comes from words in
the committee title, and 35% of meetings fall into "other", so C5 is
rough. C4 is the one chart that reads the 93 MB topic snapshot.

One chart is held back. Meetings per week looks like a trend, but today
it shows the listing window. The week of 2 November holds 637 of 1,434
meetings because the run was on 30 October. Leave it out until months
of runs exist.

For a topic under about 10 meetings, show its list and skip its charts.
Misinformation has 2, nhs-dentists 3, loneliness 3, food-poverty 4,
fly-tipping 5.

### Preconditions

- **Clean the phrase lists first.** School-attendance still counts 111
  meetings under the stricter rule, and "Apologies for Absence" is a
  common heading. A council × school-attendance page built on that is
  wrong on its face. Single common words such as `absence`,
  `attendance`, `events` and `survey` must go from `topics.yaml` before
  the pages are public. The topic step then counts every paper again.
- **A searchable council name.** See the question below.

### How it is built

1. A build script reads the newest snapshot of the list, join, index
   and topic stores. Snapshots are 11.5 MB, 3.5 MB, 14.3 MB and 93 MB.
2. It computes the page data and writes one JSON file per page.
3. Astro renders the five templates from those files.
4. Charts are drawn in the browser with Chart.js, the most downloaded
   JavaScript chart library, from JSON the build writes into the page.
   The owner chose this on 6 November 2026 over build-time SVG. Every
   chart keeps a table view in the HTML with the same numbers, so search
   engines and readers without JavaScript still get the figures.
5. The build runs after each daily chain run and writes the sitemap.

### What the MVP does not do

No meeting pages and no full paper text. Every meeting row links to the
council. Those pages are the second slice, see the recommendation, and
every council × topic page then links to them instead.

### What is built

As of 6 November 2026 the national overview page exists, in a new app
`apps/site` (Astro on Bun, Chart.js for the charts). It has the stat
tiles, the table of all 95 topics with a thin bar, the nation heatmap
for the top 25 topics, ranked bars for mentions per 10,000 words and for
topic pairs, and the method note. Its data step applies the
title-or-heading rule with the meeting page excluded, and reads the
newest snapshots of the list, join and topic stores. The council × topic
pages, the topic pages and the council pages are not built yet. The
app's `README.md` says how to build it.

## A first 100 pages

The owner asked which 100 pages to start with, from a search point of
view. The repo holds no search demand data, so popularity cannot be
measured. The list below uses what the repo gives, plus two judgments
that are marked.

### How the 100 were chosen

1. **Only council × topic pages.** The hub pages do not rank for their
   generic names, and a meeting page is too specific for a first 100.
2. **Only the title-or-heading rule, with two meetings or more.** 955
   pages qualify.
3. **Only topics people search for.** A judgment. It keeps 58 of the 95
   topics, such as planning, council-finances, schools-and-education,
   adult-social-care, parking, roads and local-government-reorganisation.
   It drops abstract or noisy ones such as consultation-and-engagement,
   transparency-and-accountability, school-attendance, complaints,
   social-value-and-procurement and councillor-conduct. 568 pages
   remain.
4. **Bigger councils first.** The ONS code in `sources.yaml` gives the
   council class. Unitary, metropolitan, London borough, county and
   Scottish councils weigh 3, Welsh and Northern Irish 2, English
   districts 1. Population is the real proxy for search demand, and the
   repo does not hold it, so the class stands in. A judgment.
5. **Score** is the weight times the meetings, plus a fifth of the
   papers. Papers are those with a title or heading hit or five or more
   body mentions.
6. **Spread.** At most 3 pages per council and 8 per topic, so one busy
   council or one broad topic does not fill the list.

### What the list looks like

| Measure | Value |
| --- | --- |
| Distinct councils | 50 |
| Topics | 32 |
| Meetings per page | 2 to 11, median 3 |
| Papers per page | 4 to 77, median 20 |
| England / Scotland / Wales / Northern Ireland | 84 / 8 / 6 / 2 |
| Unitary / metropolitan / London / Scottish / county / Welsh / NI / district | 28 / 24 / 23 / 8 / 8 / 6 / 2 / 1 |

Council-finances, schools-and-education, planning and adult-social-care
each hit the cap of 8. The one district is there on content alone.

### The list

| # | Council | Topic | Meetings | Papers | Class |
| --- | --- | --- | --- | --- | --- |
| 1 | City of Edinburgh | tourism | 6 | 66 | Scottish |
| 2 | Carmarthenshire | council-finances | 11 | 44 | Welsh |
| 3 | Aberdeenshire | schools-and-education | 6 | 42 | Scottish |
| 4 | Stockton-on-Tees | building-safety | 8 | 8 | unitary |
| 5 | Somerset | schools-and-education | 5 | 50 | unitary |
| 6 | Somerset | council-finances | 4 | 65 | unitary |
| 7 | Carmarthenshire | elections | 11 | 13 | Welsh |
| 8 | City of Edinburgh | schools-and-education | 3 | 75 | Scottish |
| 9 | Camden | schools-and-education | 3 | 74 | London borough |
| 10 | Wiltshire | crime-and-policing | 6 | 28 | unitary |
| 11 | City of Edinburgh | planning | 4 | 58 | Scottish |
| 12 | Stockport | childrens-social-care | 5 | 38 | metropolitan |
| 13 | Salford | climate-change | 6 | 21 | metropolitan |
| 14 | Bournemouth, Christchurch and Poole | parking | 3 | 63 | unitary |
| 15 | Dumfries and Galloway | schools-and-education | 2 | 77 | Scottish |
| 16 | Rochdale | schools-and-education | 4 | 44 | metropolitan |
| 17 | Central Bedfordshire | council-finances | 4 | 44 | unitary |
| 18 | Enfield | schools-and-education | 4 | 36 | London borough |
| 19 | Waltham Forest | schools-and-education | 3 | 44 | London borough |
| 20 | Waltham Forest | childrens-social-care | 4 | 28 | London borough |
| 21 | Bournemouth, Christchurch and Poole | public-transport | 3 | 43 | unitary |
| 22 | Central Bedfordshire | biodiversity | 4 | 27 | unitary |
| 23 | Wiltshire | council-finances | 5 | 11 | unitary |
| 24 | Enfield | council-finances | 4 | 25 | London borough |
| 25 | Bury | planning | 4 | 25 | metropolitan |
| 26 | Stockport | council-finances | 3 | 40 | metropolitan |
| 27 | Stockport | planning | 2 | 55 | metropolitan |
| 28 | Wiltshire | public-health | 5 | 8 | unitary |
| 29 | Bournemouth, Christchurch and Poole | planning | 3 | 38 | unitary |
| 30 | Salford | building-safety | 5 | 7 | metropolitan |
| 31 | Hampshire | waste-and-recycling | 4 | 22 | county |
| 32 | Nottingham | council-finances | 2 | 51 | unitary |
| 33 | Aberdeenshire | council-finances | 3 | 36 | Scottish |
| 34 | Sutton | planning | 3 | 32 | London borough |
| 35 | Rochdale | send | 4 | 16 | metropolitan |
| 36 | Somerset | childrens-social-care | 3 | 31 | unitary |
| 37 | Manchester | youth-services | 3 | 31 | metropolitan |
| 38 | Lewisham | youth-services | 4 | 14 | London borough |
| 39 | Leeds | crime-and-policing | 3 | 29 | metropolitan |
| 40 | Aberdeenshire | planning | 3 | 29 | Scottish |
| 41 | Staffordshire | libraries-and-leisure | 4 | 13 | county |
| 42 | Staffordshire | roads | 4 | 12 | county |
| 43 | Peterborough | local-government-reorganisation | 4 | 12 | unitary |
| 44 | Staffordshire | adult-social-care | 4 | 11 | county |
| 45 | Rochdale | mental-health | 4 | 10 | metropolitan |
| 46 | Buckinghamshire | crime-and-policing | 3 | 25 | unitary |
| 47 | Peterborough | private-rented-sector | 4 | 8 | unitary |
| 48 | Bury | roads | 3 | 22 | metropolitan |
| 49 | Newcastle upon Tyne | crime-and-policing | 3 | 22 | metropolitan |
| 50 | Central Bedfordshire | public-health | 4 | 6 | unitary |
| 51 | City of London | biodiversity | 2 | 36 | London borough |
| 52 | Carmarthenshire | planning | 4 | 25 | Welsh |
| 53 | Kingston upon Thames | traffic-and-congestion | 3 | 20 | London borough |
| 54 | Stirling | tourism | 4 | 4 | Scottish |
| 55 | Derry City and Strabane | planning | 3 | 34 | NI |
| 56 | Manchester | high-streets-and-regeneration | 3 | 19 | metropolitan |
| 57 | Enfield | high-streets-and-regeneration | 3 | 19 | London borough |
| 58 | Sheffield | public-health | 3 | 19 | metropolitan |
| 59 | Leeds | night-time-economy | 3 | 19 | metropolitan |
| 60 | Islington | youth-services | 3 | 18 | London borough |
| 61 | Leeds | parks-and-green-spaces | 3 | 17 | metropolitan |
| 62 | Bury | parking | 3 | 15 | metropolitan |
| 63 | Sheffield | libraries-and-leisure | 3 | 15 | metropolitan |
| 64 | Wokingham | adult-social-care | 3 | 14 | unitary |
| 65 | Peterborough | housing-development | 3 | 14 | unitary |
| 66 | Lewisham | private-rented-sector | 2 | 29 | London borough |
| 67 | Waltham Forest | high-streets-and-regeneration | 3 | 13 | London borough |
| 68 | Kingston upon Thames | air-quality | 3 | 13 | London borough |
| 69 | Manchester | roads | 3 | 12 | metropolitan |
| 70 | Sheffield | nhs-and-gp-services | 2 | 26 | metropolitan |
| 71 | Derry City and Strabane | libraries-and-leisure | 3 | 25 | NI |
| 72 | Camden | employment-and-jobs | 3 | 10 | London borough |
| 73 | Lincolnshire | roads | 2 | 25 | county |
| 74 | York | adult-social-care | 2 | 21 | unitary |
| 75 | Camden | send | 2 | 21 | London borough |
| 76 | Herefordshire | youth-services | 2 | 21 | unitary |
| 77 | York | housing-development | 2 | 20 | unitary |
| 78 | Elmbridge | local-government-reorganisation | 3 | 34 | district |
| 79 | Lewisham | social-housing | 2 | 19 | London borough |
| 80 | Swansea | public-health | 4 | 8 | Welsh |
| 81 | Barnsley | adult-social-care | 2 | 18 | metropolitan |
| 82 | Haringey | parking | 2 | 17 | London borough |
| 83 | Gateshead | adult-social-care | 2 | 17 | metropolitan |
| 84 | Swansea | high-streets-and-regeneration | 2 | 26 | Welsh |
| 85 | Wokingham | nhs-and-gp-services | 2 | 16 | unitary |
| 86 | Newcastle upon Tyne | nhs-and-gp-services | 2 | 15 | metropolitan |
| 87 | Wokingham | employment-and-jobs | 2 | 15 | unitary |
| 88 | Redbridge | crime-and-policing | 2 | 15 | London borough |
| 89 | Hammersmith and Fulham | crime-and-policing | 2 | 15 | London borough |
| 90 | Lincolnshire | adult-social-care | 2 | 15 | county |
| 91 | Plymouth | adult-social-care | 2 | 15 | unitary |
| 92 | Plymouth | parking | 2 | 14 | unitary |
| 93 | Leicestershire | childrens-social-care | 2 | 14 | county |
| 94 | Lambeth | adult-social-care | 2 | 14 | London borough |
| 95 | North East Lincolnshire | devolution | 2 | 14 | unitary |
| 96 | Lincolnshire | public-health | 2 | 14 | county |
| 97 | Neath Port Talbot | libraries-and-leisure | 3 | 13 | Welsh |
| 98 | Bedford | childrens-social-care | 2 | 13 | unitary |
| 99 | Islington | childrens-social-care | 2 | 13 | London borough |
| 100 | Barking and Dagenham | crime-and-policing | 2 | 13 | London borough |

### Notes on the list

- Edinburgh tourism at the top is a visitor levy agenda, Carmarthenshire
  council-finances is a budget round. Those are the kind of pages the
  method favours: one live subject across several meetings.
- The names are the short `name` field. The page titles need the full
  name people type, question 13.
- The list is from the 30 October snapshot and will change with every
  run. The build should apply the rules, not a fixed list.
- If a search demand source is added later, such as keyword volumes for
  "[council] council [topic]", it replaces the class weight in step 4.

## If only one page is built

The owner asked which single page to build first. The answer is one
council × topic page: `/councils/city-of-edinburgh/tourism/`, Edinburgh
on tourism.

### Why that page

- **It is a real story.** Six meetings since 24 September 2026 have
  tourism in a title or heading. The first three are the Edinburgh
  Visitor Levy: new projects at Finance and Resources, visitor economy
  sector work at Housing, Homelessness and Fair Work, and the advisory
  forum at full Council. The paper titles carry the phrase, so the list
  reads as a story without any text being shown.
- **It has the content a page needs.** 66 papers with a hit or five or
  more body mentions. The top paper, "Visitor Levy, New Project Update",
  has 56 body mentions.
- **It has plausible search demand.** "Edinburgh visitor levy" and
  "Edinburgh tourist tax" are things people type. That is a guess, as
  every demand claim here is.
- **It exercises every hard part of the template at once.** The count
  line, the meetings list, the papers list through the join and topic
  records, the council-against-UK bar, the sibling links, the short
  name problem ("City of Edinburgh"), and the excerpt fetch.
- **It shows the two open decisions on real rows.** Its last three
  meetings are a Development Management Sub-Committee and two Licensing
  Sub-Committees. Their papers are short-term let licence cases with
  flat addresses in the titles, such as "flat 1, 16 New Orchardfield".
  That is the private-case problem of question 3, on one page.

### Why not the top of the first-100 list

Checking the two strongest candidates found a flaw in the counting.
Carmarthenshire on council-finances ranked second with 11 meetings.
Ten of them count only because the council's meeting page carries two
menu links, "The Council Budget" and "Council Budget", which the parser
keeps as heading lines. Every Carmarthenshire meeting page has them. The
page would list every meeting the council held. Edinburgh on tourism
keeps all 6 meetings when the meeting page is left out.

So the rule gains one clause: **a meeting page's own hits do not count.
Only its papers do.** The counts under that rule:

| Measure | Meeting page counted | Meeting page excluded |
| --- | --- | --- |
| Council × topic pages with 1 meeting or more | 4,415 | 4,266 |
| With 2 or more | 955 | 875 |
| With 3 or more | 263 | 235 |
| Meetings with at least one topic | 1,127 | 1,045 |
| Meetings per topic, median | 43 | 38 |
| Carmarthenshire council-finances | 11 | 1 |
| Edinburgh tourism | 6 | 6 |

The topics that lose most are school-attendance (111 to 67), tourism
(76 to 41), planning (245 to 212) and elections (44 to 29). Those are
menu words: attendance, visitor, planning, elections. The first-100
list above was built before this clause and should be rebuilt with it.
The same menus feed the body counts of every meeting page, so the
better fix is upstream: trim the site menus from the meeting page
markdown before the topic step counts it, or have the topic step skip
the meeting page. That is a pipeline change, and a question below.

### What the one page would show

1. Title and count line: "City of Edinburgh Council on tourism. 6
   meetings since 24 September 2026 had tourism in a title or heading."
2. The six meetings, newest first, each linking to the council's own
   meeting page.
3. The papers that mention tourism most, with titles and links. The
   visitor levy papers lead.
4. A two-bar chart: Edinburgh's share of mentions on tourism against
   the UK share.
5. Short excerpts around "visitor levy" and "short-term lets" from the
   top papers, if the excerpt fetch is built.
6. Links to Edinburgh's other topic pages and to tourism in other
   Scottish councils.

## Recommendation

Build in two slices. The first slice is the MVP above: the council ×
topic pages as the engine, with the council, topic, nation and national
pages as hubs that carry the charts. About 7,750 pages built and 2,560
indexed on day one, with meeting rows that link out to the councils. The
second slice is page 1, one page per meeting. Every council × topic page
and council page then links to those pages instead of to the councils.
Reasons for the second slice:

- The meeting is the unit every store already has a record for. No new
  pipeline field or rule is needed to build it.
- It is the link target of every other page type. Topic pages and
  weekly pages are lists of meeting pages, so they come almost free
  once meeting pages exist.
- It is robust at the edges. A meeting with no papers is still a true
  page. A council with one meeting is still a true list.
- It gives 1,406 pages on day one and grows every day with the chain.
- The searches it matches are ones council sites answer badly.

Rules to apply from the start:

- Trim the meeting page markdown to the agenda table and the meeting
  details. Drop the site menus.
- Show each paper as title, link, length and top topics, with the full
  text on its own page or behind a toggle. Never put a whole joined
  file on one page.
- Rank topics inside a meeting by body count. Label a meeting with a
  topic only by the stricter rule.
- Keep every council slug stable from `sources.yaml` `id`, so links
  never break when a name changes.

## Questions before going further

1. **Which bucket.** The production bucket named in the config does not
   exist. Will the site build from the development bucket, or will a
   production bucket be rebuilt first?
2. **Full text or excerpts.** Should the site publish the full text of
   every paper, or a preview with a link to the original? This decides
   the page count and the copyright and privacy position.
3. **Planning, licensing and standards.** 29% of meetings are these
   committees. Their papers name applicants, objectors and the subjects
   of complaints. Leave them out at first, show only the agenda table,
   or treat them like any other meeting?
4. **The topic rule.** Is "a phrase in a link title or a heading" the
   rule for listing a meeting under a topic? Should it live in the
   `index` config, as the design document suggests, or in the site
   build?
5. **Where the Astro app lives.** A new app folder, `apps/site`, with
   its own repository and `AGENTS.md`, as the workspace rules require?
6. **Build trigger.** Build after each daily chain run, from the newest
   snapshots, or on a fixed clock?
7. **Domain and names.** Use the council's `name` from `sources.yaml`
   for display and its `id` for the address? Group by nation?
8. **History.** Keep every meeting on the site for good, or drop past
   meetings after a set time?
9. **Failures.** Show the papers that could not be fetched or read, with
   the reason, or hide them?
10. **Topic groups.** `topics.yaml` has no group field. Add one, such as
    housing, health, children, transport, environment, money and
    governance, so the all-topics page can group its 95 rows? Or show
    one sorted list?
11. **Phrase clean-up.** Review `topics.yaml` and remove single common
    words such as `absence`, `attendance`, `events` and `survey` before
    the MVP goes public? The topic step then counts every paper again,
    which is one long run.
12. **Hosting.** Charts are decided: Chart.js in the browser, with a
    table twin in the HTML. Where does the static output live: Cloud
    Storage behind a domain, Cloudflare Pages, or elsewhere?
13. **Searchable council names.** `sources.yaml` gives short names such
    as "Leeds". Page titles need the name people type, such as "Leeds
    City Council". Add a `display_name` field to the file, or derive it
    with a rule such as adding "Council"? A rule will be wrong for some,
    such as "City of Edinburgh" or "Comhairle nan Eilean Siar".
14. **Index thresholds.** Index a council × topic page at two meetings
    or more, and a topic × nation page at five or more? Or different
    numbers?
15. **Meeting page menus.** The parser keeps council site menus as
    heading lines, so "Council Budget" counts as a heading hit on every
    Carmarthenshire meeting. Fix it in the parser SDK by trimming
    navigation from the meeting page, in the topic step by skipping the
    meeting page, or in the site build by ignoring the meeting page's
    counts?
