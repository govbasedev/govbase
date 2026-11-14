# Site navigation: a UX review and a new model

As of 14 November 2026. A proposal. The owner decided four points on
14 November, listed in "Decided". The open decisions are in the last
section.

This review looks at how the Govbase site is organised today. It
proposes a model that makes meetings easy to reach and gives a quick
overview on each page. The model also covers governments, parliaments,
committees and other public bodies.

## The short answer

1. **Fix the addresses first.** The site is not deployed yet, so a
   change of address costs nothing today. After launch, each changed
   address needs a redirect.
2. **Treat each page as a first page.** Most readers will arrive from a
   search engine on a meeting page or a council page, not on the home
   page. Today those pages do not say where they are.
3. **Use one hierarchy: Body › Committee › Meeting.** Topics and places
   are lenses across it, not branches of it.
4. **Replace the tree menu** with a breadcrumb and a short local menu
   that has the same shape on each page.
5. **Put the answer at the top of each overview page:** one sentence,
   three or four numbers, the top five topics.
6. **Each page must stay true for a week or more.** The site is built
   about once a week, on no set day. So no page says "this week",
   "coming up" or "latest". Each page shows dates, and the date of its
   data.

## Decided

The owner decided these points on 14 November 2026. The model below
follows them.

1. **The site is not deployed yet.** So no old address needs a
   redirect.
2. **"Governments", "Public sector" and "Private sector" stay in the
   header.** Each will be a marketing page: a page that tells one kind
   of customer what Govbase does for them.
3. **`/` will be a marketing page.** It is the front page for a new
   visitor, not a data page.
4. **The site is built again about once a week, on no set day.** The
   build follows a pipeline run. So a reader can see data that is one
   day old or ten days old, and the design must work for both.

So the site has two parts. The marketing part is `/` and the three
pages above. The data part is everything under "Public data". This
review is about the data part. It names the marketing part only where
the two meet.

## Words used in this document

- **Marketing page**: a page that explains the product to a possible
  customer. It holds no data from the pipeline.
- **Data home**: the page at `/public-data/`, the front page of the
  data part.

- **Body**: an organisation that holds meetings, such as a council.
- **Lens**: a way to look across all bodies and meetings, such as by
  topic.
- **Breadcrumb**: one line of links at the top of a page that shows
  where the page sits, such as `Bodies › Leeds › Meetings`.
- **Slug**: the part of an address that names one thing, such as
  `leeds` in `/bodies/leeds/`.
- **Canonical address**: the one true address of a page.
- **Hub**: a page whose main job is to link to many other pages.
- **Pagefind**: the search tool that comes with Starlight. It builds a
  search index as files, and the search runs in the browser.
- **Glance block**: the first part of an overview page, made for a
  reader who has a few seconds.

## How this review was made

- Read against the `apps/site` branch `starlight` as it was on 14
  November 2026.
- Every number is counted from `src/data/national.json`, built on 12
  November 2026 from the list run of 30 October 2026, unless a line
  names another document.
- The pages were read as code. They were not opened in a browser, and
  no reader was tested. Section "How we will know it works" lists the
  tests to run.

## The need

### The readers

| Reader | Arrives from | Wants |
| --- | --- | --- |
| Quick reader | A search engine or a shared link, on any page | To understand one thing in a few seconds |
| Deep reader | The same, or a marketing page | One meeting, one body or one topic in depth |
| Analyst, the first user named in `CONTEXT.md` | A bookmark | To follow a topic across many councils, week by week |

The first row matters most for the design. A site built for search
traffic has no one front door. Each page is a front door.

### The goals

1. **Glance.** Each overview page answers one question at the top, in
   one sentence and a few numbers.
2. **Dig.** A reader reaches one meeting in a few clicks, with no
   guessing, and knows where they are at each step.
3. **Arrive anywhere.** A reader who lands on any page can tell what
   the page is, whose it is, and where to go next.
4. **Grow.** The owner plans to add government meetings, the Lords,
   committees and government organisations. The same model and the same
   addresses must hold them.
5. **Two parts, one site.** A reader on a marketing page reaches the
   data in one click, and a reader on a data page can see what Govbase
   is.

### The limits

- The site is static: files built once, with no server.
- The design is Starlight's. The site rules allow plain HTML in the
  page and no custom styling of the frame.
- The address pattern is hard to change after launch. See
  `site-hosting-limits-and-r2.md`, section 7.
- Some changes below go against a rule in `apps/site/AGENTS.md`.
  Section "Site rules this model changes" lists each one.

## What works today

- **Question headings.** "Which topics do UK council meetings discuss
  most?" tells the reader what a chart answers. Keep them.
- **One page per meeting**, with every paper on it, is the right unit
  for a deep reader.
- **One page per council and topic.** This is the page most searches
  will match, such as "Leeds council biodiversity". There are 4,266 of
  them. The new model must keep it.
- **Static pages with stable addresses.** These are fast, cheap and
  easy for search engines to read.
- **Bar charts built as HTML** load fast and work without JavaScript.
- **The list on the right of a meeting page** names each paper. A
  reader can jump to one paper.

## Problems today

### 1. Four of the five top addresses show "page not found"

`/`, `/governments/`, `/public-sector/` and `/private-sector/` have no
page. The site name links to `/`. Three of the four header links lead
to the 404 page. On a phone, that 404 page has no menu button, so the
reader has no way on.

The cost is high. A reader who clicks the site name, the most common
way "home", leaves the site.

The owner has decided that these four addresses become marketing
pages. Until they are built, the fault stays. So no build of the site
goes public while a header link leads to the 404 page.

### 2. Labels do not match where they lead

- "Councils" in the menu opens the UK topics page. Its heading is about
  topics.
- "Public data" and "Councils" lead to two pages that are almost the
  same.
- The header mixes two ideas: what the site holds ("Public data") and
  who it is about ("Governments", "Public sector", "Private sector").
  Councils are public sector, but they sit under "Public data".
- On a meeting page, the council name links to the council's meeting
  list, not to the council's page.
- The stats block is named "Stats, last 12 months". The data covers 7
  September to 24 November 2026, which is 11 weeks.

**Rule broken:** one label, one destination, and the page heading
repeats the label.

### 3. Meetings are hard to reach

A meeting sits five levels deep:
`/public-data/<nation>/councils/<council>/meetings/<meeting>/`.

| Route | Clicks from the header |
| --- | --- |
| By council | Public data › a council in a list of 351 › "Meetings of … with a topic" › the meeting. 4 clicks |
| By topic | Public data › a topic bar › a council bar › the meeting. 4 clicks |

- The link to a council's meetings is one line of text under a chart
  of up to 30 bars.
- No page lists meetings across councils. No page lists the meetings of
  one topic across the UK. A reader must pick a council first.
- There is no search. A reader who knows a committee's name cannot
  find it.

### 4. One meeting in four has no page

The list holds 1,434 meetings. The site builds a page for 1,045 of
them: only a meeting with a topic in a paper's title or headings gets a
page. So 389 meetings can not be reached at all.

A council's meeting list shows this as two numbers that do not agree.
Neath Port Talbot shows "All meetings 16" beside a list of 12 rows. The
same is true for 200 of the 351 councils. Meetings still to come are the
ones most likely to be missing, because a council publishes its papers
about a week before the meeting.

### 5. A page does not say where it is

- The heading of a meeting page is the committee name alone. 87 meeting
  pages have the heading "Cabinet". The council and the date are in
  smaller text below.
- No page has a breadcrumb.
- The topic links on a meeting page go to the nation's topic page. The
  reader came from one council and lands among 294.

This is the problem that hurts the reader from a search engine most.

### 6. The menu changes shape from page to page

The left menu shows different nations, councils and toggles on
different pages. An arrow is a link on one row and a toggle on the
next. A reader cannot learn a map that moves. On a phone the menu is
gone, and the menu button shows only the four header links.

A full tree also does not scale. England alone has about 10,000 parish
and town councils. No menu can list them.

The tree also has a cost in code. `SidebarTree.astro` is a copy of a
Starlight file, and a test fails on each Starlight upgrade until
someone compares the two.

### 7. Topics are placed inside the hierarchy

Topics sit at `/public-data/<place>/topics/<topic>/` and under
"Councils › All topics". A topic is not a child of a place or of
councils. It cuts across every body and every meeting. Inside the
tree, it makes the tree harder to read.

### 8. Overview pages ask too much of a quick reader

The first thing on an overview page is a chart of 30 bars, with 65 more
behind "Show all". The key numbers are at the bottom of the page. A
quick reader needs the numbers and the top few topics first.

### 9. The pages do not show how old the data is

The data file comes from the list run of 30 October. On that day 786
of 1,434 meetings were still to come. On 14 November the data file
holds one meeting that is still to come. The week of 2 November has
477 meetings with a page. The week of 9 November has 97.

So the same site answers "what is coming?" well on the day of a run
and badly two weeks later. With a build about once a week, this is
normal, not a fault to fix. But a reader cannot see it. The date of the
data is in small text under each chart, and a meeting page puts it at
the very end. A list of meetings shows no date of its data at all.

### 10. Small faults a reader sees

- 17 meeting titles show `&#39;` in place of an apostrophe, such as
  "Children&#39;s Services". The fault is also in the address:
  `children-39-s-services-…`.
- A meeting's address ends in `-2` when two meetings of one council
  share a title and a date. The number comes from sort order, so it can
  move to the other meeting when a new one is listed. No meeting has
  this today.

## The new model

### Three things, and two lenses

Everything on the site is one of three things:

| Thing | What it is | Examples |
| --- | --- | --- |
| **Body** | An organisation that holds meetings | Leeds City Council, House of Lords, Department for Education, an NHS trust |
| **Committee** | A group inside a body that meets | Planning Committee, Cabinet, Lords Economic Affairs Committee |
| **Meeting** | One meeting of a committee on one date, with its papers | Planning Committee, 14 October 2026 |

Two lenses cut across all three:

| Lens | What it answers |
| --- | --- |
| **Topic** | What is discussed: housing, council finances, transport |
| **Place** | Where: UK, England, Wales, later a region |

The hierarchy is always **Body › Committee › Meeting**. That is true
for a parish council, a city council, a government department and the
House of Lords. The type of body (council, government, parliament,
public body) is a filter, not a new branch of the site.

### Header and section menu

The header stays as it is, with a search box added:

```
Govbase    Governments   Public sector   Private sector   Public data    [ Search ]
```

- **The header is the same on every page**, marketing or data. The
  first three links and the site name lead to marketing pages. "Public
  data" leads to the data home.
- **A header link goes public only when its page exists.** See
  problem 1.
- **Search** looks in the data part only.

The data part has its own three sections. They show at the top of the
left menu on every data page:

```
Meetings
Topics
Bodies
```

- **Meetings** is first, because meetings are the main goal.
- **The three rows never change.** Under them, a line, then the local
  menu of the page. See "Wayfinding".
- **Places is not a section yet.** There are five places today. A place
  is a filter on Meetings, Topics and Bodies, and each nation keeps a
  page. Places can become a section when regions exist.
- **A body type is a filter**, not a section and not a header label.
  The header labels name kinds of customer. The filter names kinds of
  body. A council page is not a "Public sector" page.
- **On a phone**, the menu button shows the four header links, then the
  three sections, then the local menu. A phone reader gets the same
  routes as a desktop reader.
- **Each marketing page links into the data.** For example, "Public
  sector" can show the newest week of council meetings as its proof,
  with a link to Meetings.

### Addresses

Short and stable. Each thing has one canonical address. A lens has
pages of its own. Every data page stays under `/public-data/`, written
as `/pd/` in this table only, to keep the table narrow.

| Page | Address |
| --- | --- |
| Marketing pages | `/`, `/governments/`, `/public-sector/`, `/private-sector/` |
| Data home: UK snapshot | `/pd/` |
| Meetings, the newest week first | `/pd/meetings/` |
| Meetings of one week | `/pd/meetings/week-of-2026-11-09/` |
| All bodies, with filters for type and place | `/pd/bodies/` |
| One body | `/pd/bodies/<body>/` |
| One body's meetings | `/pd/bodies/<body>/meetings/` |
| One meeting | `/pd/bodies/<body>/meetings/<date>-<committee>/` |
| One body on one topic | `/pd/bodies/<body>/topics/<topic>/` |
| One committee, later | `/pd/bodies/<body>/committees/<committee>/` |
| All topics | `/pd/topics/` |
| One topic, UK | `/pd/topics/<topic>/` |
| One topic in one place | `/pd/topics/<topic>/<place>/` |
| One place | `/pd/places/<place>/` |

Rules for the addresses:

- **Data pages keep the `/public-data/` start.** It keeps data names
  apart from marketing names, so a later marketing page such as
  `/meetings/` cannot clash. It also lets the header mark "Public data"
  as the current link on every data page, as the code does today. The
  cost is one more part in each address. Decision 1 at the end.
- **No nation in a body's address.** The House of Lords has no nation.
  This is the one part of today's pattern that can not hold the new
  bodies.
- **A slug comes from a stable id, not from a display name.** Today a
  council's slug comes from its name, so a new name moves the page. Use
  the source id from `sources.yaml` without its `uk-council-` start,
  such as `leeds`, or add a `slug` field. The id is unique by rule.
- **The date comes first in a meeting's slug**, such as
  `2026-10-14-cabinet`, so addresses sort by date. When two meetings
  share a date and a title, add the first characters of the meeting's
  id, not a number from sort order.
- **Week pages use a date, not the words "this week".** A page named
  "this week" is wrong some days after the build. A page named "Week
  of 9 November 2026" is always true. `/meetings/` lists every week
  that has a meeting, the newest first, with the count of meetings in
  each.
- **A meeting is under its body only.** Topic, place and week pages
  link to it. They never hold a copy at a second address.

### How a reader moves

From the data home:

```
Data home ──▶ Meetings, week by week ─────────▶ Meeting
  │                                                ▲
  ├────▶ Topic ──▶ Body on that topic ─────────────┤
  │                                                │
  └────▶ Bodies ──▶ Body ──▶ Body's meetings ──────┘
```

Each path ends at a meeting in at most three clicks from the data
home. A marketing page is one click before the data home, or links
straight to Meetings.

From a search engine, on a meeting page:

```
Meeting ──▶ up: the body's meetings, the body
        ──▶ across: each topic of the meeting, for this body
        ──▶ along: the committee's meeting before and after
```

### Wayfinding: a breadcrumb and a local menu

Replace the tree with two tools. Both are the same on a phone and on a
desktop.

1. **A breadcrumb** as the first line of each page below the data
   home: `Bodies › Leeds › Meetings › Cabinet, 14 Oct 2026`. It is one
   plain line of links, so it needs no custom styling. It starts at
   the section, because the header already marks "Public data".
2. **A local menu** in the left column, under the three sections. On a
   body's pages it holds
   `Overview · Meetings · Topics`. On a topic's pages it holds
   `UK · England · Northern Ireland · Scotland · Wales`. It has a few
   rows, the rows are the same on each page of one kind, and the
   current row is marked. It uses Starlight's own menu, so
   `SidebarTree.astro` and its upgrade test can go.

### Pages that stay true between builds

The site is built about once a week, on no set day. A reader may come
ten days after a build. Four rules keep each page true on any day.

1. **Dates, not words about today.** No page says "this week", "coming
   up", "latest", "held", "today" or "new". A meeting row shows its
   date, and the reader knows what day it is. A week page is named by
   its Monday.
2. **Each page says how old it is.** One line near the top of each data
   page: "Data read on 30 October 2026". On a meeting page: "Papers
   read on 30 October 2026. The council may have added papers since",
   with the link to the original. The date is the date of the pipeline
   run, not of the build.
3. **Every count names its dates.** "1,434 meetings from 7 September to
   24 November 2026", not "1,434 meetings this autumn" and not "in the
   last 30 days".
4. **Nothing on a page needs the build day to be a set day.** No
   "weekly update" label, no "next update on Monday", and no count such
   as "meetings in the next 7 days", which only fits the day of the
   build.

What a weekly build gives the reader anyway: councils publish papers
about a week before a meeting, so each run lists meetings for one to
three weeks after it. On 30 October the list held meetings up to 24
November. So `/meetings/` still shows meetings that are to come for
most of the time between two builds. The reader sees them as the weeks
at the top of the list.

What it does not give: a meeting that a council lists after the run is
missing until the next build. The line from rule 2 tells the reader
so, and each body page links to the council's own site.

This also means the navigation needs nothing from the pipeline but its
normal run. No step of this model needs a run each day or a run on a
set day.

### The first screen of each page

Each page is a front door. Its first screen holds these parts, in this
order:

| Part | Body page | Meeting page |
| --- | --- | --- |
| Breadcrumb | `Bodies › Leeds` | `Bodies › Leeds › Meetings › Cabinet, 14 Oct 2026` |
| Heading | "Leeds: which topics does it discuss most?" | "Cabinet, Leeds, 14 October 2026" |
| One sentence | The answer to the heading | The count of papers and the top topics |
| Next steps | The meetings with the newest dates, top topics | The meeting before and after, the original on the council's site |

The browser title of a meeting page already holds the committee, the
council and the date. The change is to show the same words as the
heading.

### One pattern for a meeting row

Use the same row on the data home, a week page, a topic page and a
body page, so a reader learns it once:

- the date,
- the committee name, as the link to the meeting,
- the body name, as a link to the body, when the page is not the
  body's own,
- up to three topics, each a link.

A topic link on a body's page goes to that body's page on the topic. On
any other page it goes to the topic's UK page.

Two data needs follow:

- **A rank for topics.** 505 of the 1,045 meetings have more than three
  topics, and one has 41. Today the topics of a meeting are in
  alphabet order. Rank them by the count of mentions in the text, as
  `public-site-proposal.md` suggests, and show the top three.
- **A row for each meeting.** A meeting with no topic gets a row with
  no topics, and a page.

## The glance layer

Each overview page (data home, topic, body, place) opens with the same
block. The question stays as the heading, and the block is the answer.

1. **One sentence.** "Between 7 September and 24 November 2026, 353 UK
   councils listed 1,434 meetings. Consultation and engagement,
   Transparency and accountability and Council finances came up most."
2. **Three or four numbers**, with the existing stat tiles: meetings,
   bodies, papers read, and meetings dated after the data was read,
   such as "786 meetings after 30 October". This is
   the stats block of today, moved from the bottom to the top, with
   the true dates in its title.
3. **The top five topics** as bars, with "Show all 95 topics" under
   them. This is the chart of today with 5 rows shown first, not 30.

Then, for the reader who stays:

4. **The five meetings with the newest dates**, under a heading that
   names the dates, with "All meetings" under them.
5. **The full charts:** month by month.
6. **Lists:** bodies.

Notes on the block:

- Each number comes from the data file, as the site rules say. The
  sentence above is an example from today's file.
- The three top topics today are about how councils work, not what
  they decide. `public-site-proposal.md` asks for the phrase lists to
  be cleaned first. The glance sentence makes that more urgent, because
  it puts the top three in the first line a reader sees.
- Show no trend, such as "↑ 12% on last month", until the data holds
  three or more full months. Today it holds one listing run.
- A body with one meeting gets the sentence and the meeting row, and no
  chart. 65 of the 351 councils have one meeting, and 175 have three or
  fewer.

## How it scales

| Body type | Body | Committee | Meeting |
| --- | --- | --- | --- |
| Principal council | Leeds City Council | Planning Committee | 14 Oct 2026 |
| Parish council | Ilkley Town Council | Full Council | 3 Nov 2026 |
| UK Parliament | House of Lords | Economic Affairs Committee | 21 Oct 2026 |
| Devolved parliament | Senedd | Finance Committee | 5 Nov 2026 |
| Government | Department for Education | Board | 30 Oct 2026 |
| Public body | Leeds Teaching Hospitals NHS Trust | Board of Directors | 6 Nov 2026 |

- **A new type adds rows, not branches.** It needs a value for the type
  filter and its body pages. The header, the addresses and the
  breadcrumb do not change.
- **Parents.** A body can have a parent: a district inside a county, a
  committee inside a chamber. `sources.yaml` holds `parent_id` for each
  council, such as 12 districts under Kent. The body page can link to
  its parent and its children.
- **Size of a page.** Each page carries its own breadcrumb and a local
  menu of a few rows. So the size of the frame stays flat as the site
  grows. Today each page of a nation carries that nation's council
  list, up to 294 links.
- **Long lists.** A list shows 50 rows a page. `/bodies/` has 351 rows
  today, grouped by nation, which one page can hold. With 10,000 bodies
  it needs the filters and search.
- **Meeting pages built on request.** `site-hosting-limits-and-r2.md`
  says a million pages may need meeting pages that a Worker makes when
  asked. This model allows that. The local menu and the breadcrumb of a
  meeting need only the meeting's own record, not a list of all
  meetings.

### Search in two steps

Search is the fastest route for a deep reader. It has two different
jobs, and they have different costs.

| Job | Reader's words | What is indexed | Tool |
| --- | --- | --- | --- |
| Find by name | "Fylde standards committee" | The name of each body, topic and meeting, with its date | Pagefind |
| Find in the text | "battery storage" | The text of each paper | A search service, see the hosting document, section 8 |

Start with find by name. It answers "I know the committee and cannot
find it". Its index is small, because it leaves out the text of the
papers. The hosting document measured 166 MB for a Pagefind index that
held the paper text. Pagefind can also filter by body type, place and
topic. The size of a names-only index is not measured yet.

## What the data supports today

| Need | Today |
| --- | --- |
| Body, meeting, date | Yes, from the list store |
| A row and a page for each meeting | No. The data file holds only the 1,045 meetings with a topic. Needs a change in the data step |
| Committee | The meeting title is the committee name. 970 pairs of council and committee have a page today. 66 of them have two or more meetings |
| Meetings still to come | Yes, for one to three weeks after each run. The data file lacks the date of the list run as a date. It holds the run id, which starts with it |
| Topics of a meeting | Yes |
| Top three topics of a meeting | No. Needs a rank in the data file |
| Body on a topic | Yes, 4,266 pages |
| Place | Yes, the nation. A region needs a table from ONS code to region. The first three characters of the code give the type of council, not the region |
| Parent body | Yes, `parent_id` in `sources.yaml`. The site does not read it yet |
| Body type | The field `sourceType` exists in `sources.yaml`. All 382 sources say `council`. The site does not read it yet |
| The name people type | No. `sources.yaml` says "Leeds", not "Leeds City Council". One of 351 names holds the word "council" |
| Trend over time | No. One listing run only |

Committee pages wait. With 66 of 970 committees at two or more
meetings, a committee page today is a list of one. Until the data
holds some months, the committee name is the link text of each meeting
row, and a body's meeting list is grouped by date. The address is kept
free for later.

## Site rules this model changes

Each line is a rule in `apps/site/AGENTS.md` today. The owner decides
each change.

| Rule today | Change |
| --- | --- |
| "Do not add a page at `/`" | Decided: `/` gets a marketing page |
| "Governments", "Public sector" and "Private sector" have no pages | Decided: each gets a marketing page |
| The header has no search box | The header gains a search box |
| Data addresses are `/public-data/<nation>/councils/…` and `/public-data/<place>/topics/…` | They are `/public-data/bodies/…`, `/public-data/topics/…`, `/public-data/meetings/…` and `/public-data/places/…` |
| `/public-data/` and the UK page stay two files | No change. `/public-data/` is the data home for all bodies. The UK page moves to `/public-data/places/uk/` |
| Every page goes through `SitePage.astro`, with the data menu | A marketing page needs its own layout rule: the same header, no data menu |
| Search is off | Pagefind is on, for names only, for data pages only |
| The left menu is the tree in `SidebarTree.astro` | The left menu is the three sections and the local menu, drawn by Starlight |
| On a phone, the menu button opens the four header links | It opens the header links, the three sections and the local menu |
| Only meetings with a topic are in the data file | Every listed meeting is in the data file |

Rules the model keeps: the four header links, every data page under
`/public-data/`, the Starlight design with no custom frame styling, numbers only from the data file, one browser script of ours,
and question headings on chart pages.

## Order of work

The order puts first what is hard to change later, then the largest
gain for the least work.

1. **Addresses.** Move to `/public-data/bodies/`, `/public-data/topics/`,
   `/public-data/meetings/` and `/public-data/places/`, with slugs from
   stable ids, before the site is deployed.
2. **The first screen of each page.** The breadcrumb, the full heading
   on a meeting page, labels that match their pages, the true dates on
   the stats block, the "Data read on" line, and the apostrophe fault.
   No new data is needed.
3. **The three sections and the local menu** in place of the tree, on
   desktop and phone.
4. **The data home.** `/public-data/` uses the glance block with the
   data of today.
5. **Every meeting in the data file**, with a rank for its topics.
6. **Meetings by week**, at `/public-data/meetings/`. It needs step 5
   and no change to the pipeline.
7. **Search by name**, with Pagefind.
8. **The glance block** on each topic, body and place page.
9. **Body type and parent** read from `sources.yaml`, ready for the
   first source that is not a council.
10. **Committee pages**, when most committees have two or more
    meetings.

The four marketing pages are a separate piece of work, with their own
words and design. They have one tie to this list: they must exist
before the site is deployed, or the header links must be hidden until
they do.

## How we will know it works

Give five readers these tasks on a phone, before and after the change.
Count the readers who finish and the clicks they need.

| Task | Start page | Target |
| --- | --- | --- |
| Find the newest meeting of Fylde's standards committee | Data home | 3 clicks or fewer |
| Find which councils discussed social housing this month | Data home | 2 clicks or fewer |
| Find a council meeting dated after today | The "Public sector" marketing page | 2 clicks or fewer |
| Say how old the data on this page is, in 5 seconds | A meeting page | All five readers |
| Say whose meeting this is, and its date, in 5 seconds | A meeting page | All five readers |
| Find the same council's other meetings | A meeting page | 1 click |
| Say what UK councils discuss most, in 10 seconds | Data home | All five readers |

Two checks need no readers:

- No link in the header, the menu or a breadcrumb leads to a 404 page.
- Read the built site ten days after its build. No sentence on it is
  false. A test can search the built pages for the words in rule 1 of
  "Pages that stay true between builds".
- The frame of a page, without its content, has the same number of
  links for 351 bodies and for 10,000.

## Decisions for the owner

Each has a recommendation.

1. **Do data addresses keep the `/public-data/` start?** Recommended:
   yes, for the reasons under "Addresses". The other choice is
   `/meetings/`, `/topics/` and `/bodies/` at the top level. Those are
   shorter, but they share one name space with the marketing pages.
2. **Does a marketing page show the data menu?** Recommended: no. A
   marketing page has the header and its own content. The left menu
   belongs to the data part.
3. **What does the site name link to on a data page?** Recommended:
   `/`, as today. "Public data" in the header is the way to the data
   home.
4. **"Bodies" or "Organisations"?** "Bodies" is short, and the hosting
   document uses it already. Readers may know "Organisations" better.
   Recommended: ask the five test readers what they expect behind each
   word.
5. **A slug field or the source id?** Recommended: the source id
   without `uk-council-` for councils. Decide the pattern for other
   body types with the first one that is added.
6. **The name people type.** Recommended: add a display name such as
   "Leeds City Council" to `sources.yaml`. Page headings and search by
   name both need it. `public-site-proposal.md` asks the same.
7. **Do meetings with no topic get a full page?** Recommended: yes,
   with a `noindex` tag, which tells search engines to leave the page
   out, when the meeting has no papers. A reader who follows a body
   needs each of its meetings.
8. **Do place pages come in step 1?** Recommended: keep the five place
   pages that exist, at `/public-data/places/<place>/`, and add no
   region pages until regions are in the data.
