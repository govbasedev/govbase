# Parse step: one markdown file per event

Written 2026-10-22. Status: proposal, not built. App: `apps/pipeline`, the `parse` step, with small changes to the `list` step and to `apps/parser-sdk`. Branch: `parse-as-markdown`. This doc builds on `pipeline-parse-as-markdown.md`, which gives one markdown file per document. That part is built and green, but not run for real and not committed.

Section H, added the same day, is the simple start the owner asked for. It replaces the optional fields of section D with required fields, because the owner set a hard rule: no optional field in any object in the bucket. Sections D to G stay as the full design to grow into.

Status on 2026-10-23: section H is built in both apps and every check is green, uncommitted. The SDK has `buildEventMarkdown`, `buildWordRuns` and `readTextCover` under `src/event/`. The pipeline has the event record with its documents, the read step over events, the parse store with `documents/` and `events/`, the parse step's event part, and the split-page fallback. The parse step reads the OCR store, the one exception to the rule that a step reads only earlier stores. On 2026-10-24 the owner chose to leave packs out at the list step instead of the pack rule of D7 step 6: a document whose title holds a phrase in `councils.packTitlePhrases` is left out of its meeting when the meeting links any other document, and kept when it is the only one, so the single reports stand in for the pack and the pack is never read or parsed. The owner's steps: in the SDK, `make check`, commit and tag; in the pipeline, `make bump-sdk`, empty `list/v2/events/data/`, `list/v2/documents/data/`, `parse/v3/` and `ocr/v3/` in the development bucket, then a list, read and parse run.

**Words used in this doc**

- **Event**: one meeting. The list step writes one record per event in `list/v2/events/data/<eventId>.json`.
- **Document**: one file or page that the list step found for an event. One event has one or more documents. The meeting page itself is a document whose id is the event id.
- **Meeting page**: the web page of the meeting on the council site. It is the first document of every event.
- **Part**: one document when it is joined into an event file.
- **Pack**: one PDF that holds the agenda and every report of a meeting in one file. Councils publish it beside the single reports.
- **Minutes**: the written record of what a meeting decided. They are published weeks after the meeting.
- **Previous minutes**: the minutes of the last meeting, listed as a document of this meeting, because this meeting approves them.
- **Role**: what a document is for: the page, the minutes, the agenda, a pack, a report, or the previous minutes.
- **Word run**: eight words in a row. Two documents share a word run when both hold the same eight words in the same order. The share of word runs tells how much text two documents have in common.
- **Cover**: document A is covered by document B when nearly every word run of A is also in B.
- **Bucket key**: the full name of an object in the bucket, such as `parse/v3/events/text/<eventId>.md`.
- **LIST and GET**: the two bucket reads. LIST gives the keys under a prefix with their last-modified times. GET fetches one object.
- **Due**: an event is due when the step has to build or rebuild its file this run.
- **Record**: a small JSON object that says what was done. Its presence means done.
- **SDK**: the parser SDK in `apps/parser-sdk`. It turns bytes into markdown and never touches the bucket.
- **Jev**: the judgment model that will read the event file in the judge step.

## A. The requirement in plain words

**Words used in this section**

- **Supporting documents**: the reports, appendices, statements and packs that a meeting looks at.

The owner asked for this on 2026-10-22:

1. The parse step reads the raw bytes at `read/v2/documents/data/<documentId>` and turns them into markdown.
2. Each document belongs to one event. An event has one or more documents.
3. All documents of one event go into one markdown file.
4. The first section of that file is the document whose id is the event id, the meeting page.
5. The file holds the minutes of the meeting and its supporting documents.
6. The same text is often published more than once: in a pack, in a minutes PDF, and on the meeting page. The file must not hold the same text twice.

Three facts from the research shape the design.

- **Documents arrive over weeks.** The agenda comes five days before the meeting, supplements the day before, minutes two to six weeks after. An event file is never finished. It is rebuilt when a new document arrives.
- **The meeting page is sometimes empty.** On two systems the page is a JavaScript app. Its HTML holds no meeting text at all.
- **Copies are the rule, not the exception.** Every system publishes a pack, a minutes copy, or the previous minutes beside the single reports. The measured shares are in section B.

## B. What the six systems publish

**Words used in this section**

- **Feed**: the ModernGov page that lists what a council published in a date range.
- **GetMeeting**: the ModernGov web service call that returns one meeting as XML.
- **Front sheet**: the first pages of an agenda: the notice, the item list, no reports.
- **Supplement**: a document published after the agenda, such as a late report or an amendment sheet.
- **JavaScript app**: a web page that is empty until a script runs in the browser and fetches the content.

The requests below were sent on 2026-10-22 from the sandbox with curl, with the pipeline's user agent and without the relay. Every reply was read with the SDK that is built on this branch. The downloaded files and their markdown are in the session scratchpad, and the two probe scripts are in `apps/pipeline/data/probe/`, which git ignores.

| System | Councils | Requests sent | What they showed |
| --- | --- | --- | --- |
| ModernGov | Cambridge, Cardiff | 2 feeds, 6 `GetMeeting` calls, 4 meeting pages, 9 PDFs | See B1. Cardiff's pages give 403 to curl, its XML and PDFs do not. |
| CMIS | Braintree, Cambridgeshire | 2 committee lists, 4 committee pages, 4 meeting pages | See B2. |
| COINS | Falkirk, West Lothian | 2 latest-meetings pages, 1 bodies page, 1 year page, 8 agenda pages, 1 papers page, 1 viewer page, 1 file | See B3. |
| Own site | Hartlepool, Dundee | 3 meetings lists, 5 meeting pages, 2 committee pages, 1 calendar, 1 minutes page, 1 agenda PDF | See B4. |
| Decision Time | Armagh, Banbridge and Craigavon | 1 site page, 1 script, 1 meetings list, 1 agenda, 2 documents | See B5. |
| Amber Valley | Amber Valley | 1 meetings list, 2 document lists, 5 documents, 1 meeting page | See B6. |

### B1. ModernGov, 307 councils

`GetMeeting` returns the agenda items, each with its text, its minutes text, and its linked documents. The list step keeps only the linked documents. It drops the agenda text and the minutes text.

The linked documents are the single reports and appendices, named `documents/s<id>/document.pdf`. The XML does not list the meeting-level files. Those sit only on the meeting page: the agenda front sheet (`g<id>...?T=0`), the printed minutes (`?T=1`), the public reports pack (`?T=10`), and the supplement packs (`b<id>...?T=9`). So today the list step never lists a ModernGov pack or a printed minutes PDF. That removes two copies by accident.

The meeting page holds the minutes in full. Each agenda item is one row of a table, and the row holds the item title, the links, and the whole minutes text of the item. The SDK renders that table as one GFM table row per item, so the minutes of one item become one very long cell. That is correct but hard to read.

The previous minutes are listed as a document under the agenda item named `Minutes`, for example `Minutes - 15 June 2026` under the meeting of 14 September 2026, and `Minutes Public Pack, 16/09/2026` under the meeting of 21 October 2026.

Measured shares, Cambridge Housing Advisory Board of 14 September 2026, with eight-word runs:

| Pair | Shared |
| --- | --- |
| Pack, 134 pages, and the report `s73457` | 90 percent of the report |
| Pack and the appendix `s73458`, 12 pages | 95 percent of the appendix |
| Pack and the scope report `s73467` | 93 percent of the report |
| Pack and the previous minutes `s73477` | 97 percent of the previous minutes |
| Pack and the front sheet | 96 percent of the front sheet |
| Pack and the printed minutes | 1 percent |
| Meeting page and the printed minutes | 87 percent of the minutes, 74 percent of the page |
| Meeting page and the front sheet | 2 percent |
| Meeting page and the report `s73457` | 0 percent |

So the pack is a copy of the front sheet, the reports, and the previous minutes. The page is a copy of the printed minutes. The front sheet shares nothing with the page, because it lists the items without their text.

Cardiff's minutes of 16 July 2026 are 26 pages, mostly English, with 24 Welsh units that the language rule left out. The page markdown is fine.

### B2. CMIS, 35 councils

A thin CMIS site, Braintree, lists one or two files per meeting under `Meeting documents`: an `Agenda` PDF and a `Minutes` PDF. The agenda PDF is the pack.

A full CMIS site, Cambridgeshire, has agenda sections, minutes text in the page under `MinuteDetails`, and documents such as `Agenda Document Pack`, `Minutes - 12 September 2024 and 14 November 2024 (Public)` under item 2, `Minutes Action Log`, the reports and their appendices, and `250227 PFC ISC minutes (PUBLIC)`, the minutes of the meeting itself. So one CMIS event can hold every kind of copy at once: a pack beside its reports, the minutes in the page and as a PDF, and the previous minutes.

### B3. COINS, 4 councils

The agenda page holds the item titles. Each item links a papers page, and the papers page links each file through a viewer page. The SDK already rewrites the viewer link to the file link, and the file link returns the PDF. The viewer page itself is HTML with no text.

A meeting has packs when they exist: West Lothian lists `Public Agenda (5.11MB)` and `Agenda Notice (0.11MB)` as packs beside the papers. Falkirk's current meetings have papers and no packs. The minutes of a meeting appear only as a paper of the next meeting, named like `3 - Minute 0810.pdf`, under item 3. COINS gives no other copy of the minutes.

### B4. Own site, 29 councils

Each council is different, and the site rule in `config/sources.yaml` says where the documents are. Hartlepool lists meetings with their files under `/download/meetings/id/`. Its list shows future meetings first, so the probe found pages with `Sorry, no content available` and no files.

Dundee has no file for its minutes. The minutes are the web page itself, at `/minutes/fulltext?meeting_ref=<n>`, and the rule `self_documents` lists that page as a document. Its agenda is one PDF with every report in it: `cg261026ag.pdf` is 165 pages and 61,539 words. The language rule marked three of its units Welsh and four not English. Dundee is in Scotland, so those are false alarms of the unit rule, and they are few.

Some own-site councils put several meetings on one page. For them `split_by_date` makes one meeting per date, but every meeting keeps the same page address. The list step makes the event id from that address, so all meetings on the page become one event.

### B5. Decision Time, 3 councils

The meetings list is one JSON array, 823 meetings for Armagh, and each meeting says whether it has public minutes and gives the minutes document id. The agenda is JSON too: each item has a reference, a title, a description in HTML, and document ids. The list step keeps the documents and drops the descriptions.

The meeting page address is `https://abc.public-minutes.com/#<meetingKey>`. That page is the JavaScript app. Its HTML has 50 words: a logo, `Agenda`, `Minutes`, `Audio`, and `Browse By Month`. It holds nothing about the meeting. The documents themselves are PDFs: the minutes of 9 September 2026 are 6 pages, and a report is 8 pages.

### B6. Amber Valley, 1 council

The documents call lists every file of a meeting with a title and an agenda number. The Planning Committee of 7 September 2026 lists, in this order: `Draft minutes 7 September 2026 Planning Committee`, `Agenda Reports Pack Planning Committee 7 September 2026`, `Agenda Front Sheet`, `Minutes of the meeting 6 July 2026`, then six reports `6a` to `6f`. The Cabinet of 2 September 2026 lists its minutes, a question time paper, the agenda, the previous minutes, and twenty reports and appendices, each titled `Agenda Item No 9(a) - Appendix B: ...`.

Measured shares:

| Pair | Shared |
| --- | --- |
| Pack, 44 pages, and the report `6a`, 12 pages | 96 percent of the report |
| Pack and the front sheet | 94 percent of the front sheet |
| Pack and the previous minutes | 96 percent of the previous minutes |

The meeting page address is the committee documents page with a query string. That page is a JavaScript app too. Its HTML has 197 words, a login link and a search box, and nothing about the meeting.

One download was cut short. curl said `transfer closed with 21563 bytes remaining` for the draft minutes, and the SDK then said `Invalid PDF structure`. The read step would save those bytes as they came and the parse step would report `broken-file`. The read step does not check the reply length against `Content-Length` today.

## C. The copies, and what to do with each

**Words used in this section**

- **Within an event**: both copies are documents of the same event.
- **Across events**: the copies are documents of two different events.

| Copy | Where it was seen | How to tell | What to do |
| --- | --- | --- | --- |
| A pack beside its single reports | Amber Valley, CMIS, COINS, Dundee. Not ModernGov today, because `GetMeeting` omits the pack. | The pack covers two or more other parts. | The cover rule in D7. The parts win when together they cover the pack. Otherwise the pack wins. |
| The minutes in the page and in a minutes PDF | ModernGov (the PDF is not listed today), CMIS (both listed). | A part with the role `minutes` that the page covers at 70 percent or more. | Keep the page. Leave the PDF out and say so in the record. See open decision 2. |
| The previous minutes listed under this meeting | Every system. COINS has no other copy of those minutes. | The role `previous-minutes`: a minutes title with a date before the meeting date, or a document under an agenda item named `Minutes`. | Keep it, as the last section, with a heading that says it is the previous meeting's record. Never a copy within the event, so the cover rule leaves it alone, unless a kept pack holds it. |
| The same file at two addresses, or listed twice | ModernGov links the same `s<id>` file under two items, or by two file names. | Two parts cover each other. | Keep the first in meeting order. |
| The front sheet beside the page | ModernGov, Amber Valley. | Role `agenda`. | Keep both. They share 2 percent. The front sheet lists the items, the page holds the text. |
| A supplement pack beside the single supplement | ModernGov lists only the single file. | The cover rule, when both are ever listed. | The cover rule. |
| Minutes of another body as an appendix, such as `DCF Minutes` | Cambridge planning report. | The word `appendix` or `annex` in the title. | Role `report`. Not a copy. |

## D. The design

**Words used in this section**

- **Layer**: one folder of a store that holds one kind of thing. The parse store gets two: documents and events.
- **Rebuild**: build the event file again from the parts, after a new part arrives.
- **Demote**: move a heading down a level, so `#` becomes `###`.
- **Optional field**: a field that a record may have. A reader fills in a default when it is missing. The store rules allow a new optional field without a new store version.

### D1. Two layers in the parse store

The step keeps the per-document markdown that is built today, and adds the per-event file on top.

Why two layers. The OCR step needs the images and the scan pages of one document. An event is rebuilt every time a document arrives, and parsing a 134-page pack takes 17 seconds, so the document markdown must be kept and reused. And the cover rule compares documents, so it needs each document's text on its own.

| Key | Holds | Written by |
| --- | --- | --- |
| `parse/v3/documents/data/<documentId>.json` | The document record: id, SDK version, page count, scan pages, units left out, images, and the word count. | Part 1 of the step, as today. |
| `parse/v3/documents/text/<documentId>.md` | The document's markdown. | Part 1. |
| `parse/v3/documents/images/<documentId>/page-3.png` | A page image or a picture. | Part 1. |
| `parse/v3/documents/errors/<documentId>.json` | The failure class and reason. | Part 1. |
| `parse/v3/events/data/<eventId>.json` | The build record: the event, the SDK version, and one line per part with its role, its title, and its place: `joined`, `covered by <documentId>`, `covered by its parts`, `failed <class>`, `not read`, or `waiting for OCR`. | Part 2, last. |
| `parse/v3/events/text/<eventId>.md` | The event file. | Part 2. |
| `parse/v3/events/errors/<eventId>.json` | A build that could not be saved, with the reason. | Part 2. |

The folders follow `read/v2/documents/`, with the `documents/` level added. `parse/v3/` has never been written to, so the name stays `v3`. Open decision 5 says why.

### D2. What the list step adds for the parse step

The parse step cannot ask a council site anything. Everything it needs about an event must already be in the list store. Four optional fields do that. Each has a default, so old records still decode and the store version stays `v2`.

| Field | On | Default | Why |
| --- | --- | --- | --- |
| `documentIds` | the event | `[]` | The documents of the event, in meeting order: the page first, then each agenda item's documents in agenda order. The parse step learns the parts of an event from one GET of the event record, instead of a GET of every document in the store. |
| `status` | the event | `""` | `Confirmed`, `Cancelled`, `Postponed`. The header of the event file says it. |
| `agendaItemNumber` | the document | `""` | Such as `4.`, `26/25/HAB` or `9(a)`. Heads the item's section. |
| `agendaItemTitle` | the document | `""` | Such as `Minutes` or `Housing Performance Report Qtr 1 2026-27`. Heads the item's section and tells the previous minutes apart. |

Two more list changes, both small:

- Documents are sorted by address today. `documentIds` keeps the meeting order instead. The document records themselves can stay sorted by address.
- A meeting from a page with `split_by_date` gets the event address `<pageUrl>#<date>`, so each date is its own event. A browser and a server ignore the part after `#`, so the read step fetches the same page for each. The page document of each such event then has its own id, and the same bytes.

### D3. When an event is built

An event is due when all of these hold:

1. At least one of its documents has a parse record. An event with nothing parsed yet has nothing to join.
2. No document is waiting for OCR. A document waits when its parse record lists scan pages and the OCR store has no record and no error for it. After `parse.longestScanWaitInDays` the wait ends, so an OCR step that never runs cannot block an event for ever.
3. The event has no build record, or the newest parse or OCR record of its documents is newer than the build record, by bucket last-modified time, or the set of document ids differs from the parts in the last build record.

A document that was listed but not read, or whose read failed, does not block the build. It is listed in the file as not read, and when it arrives its parse record is newer than the build record, so the event is rebuilt.

A build error record does not count as done. The next run tries that event again. This differs from a document error, which is final.

What the step reads to decide, once per run:

| Read | Gives |
| --- | --- |
| LIST `list/v2/events/data/` | Every event id. |
| GET each event record | Its `documentIds`, title, date, status and address. About 7,000 GETs today, a few seconds at 64 at once. |
| LIST `read/v2/documents/data/` and `errors/` | Which documents were read, and which failed. |
| LIST `parse/v3/documents/data/` and `errors/` | Which documents are parsed, with times, and which failed. |
| LIST `ocr/v3/data/` and `errors/` | Which scans are read, with times. |
| LIST `parse/v3/events/data/` and `errors/` | Which events are built, with times. |
| GET each build record of an event that is otherwise not due | Its parts, to see whether the document set changed. |

The GET count grows with the number of events, about one or two per event per run. Open decision 4 gives an alternative that needs no GET.

### D4. How one event file is built

1. Read the event record: title, date, council, address, status, document ids.
2. For each document id, read its parse record and its markdown. When the OCR store has a record for it, read the OCR markdown instead, because that is the parse markdown with the OCR text under each page image. A document with a parse error, a read error, or no read object becomes a left-out line with the reason.
3. Give each part a role with the rules in D6.
4. Measure cover between the parts and apply the cover rule in D7. A covered part is left out and its line says what covers it.
5. Order the parts: the page, the minutes, the agenda, then each agenda item in meeting order with its documents, then the decisions, then the previous minutes.
6. Render the file as in D5. Demote each part's own headings by two levels, capped at six. Page markers stay level six.
7. Save the markdown, then the build record. The record is last so a crash never leaves a record without a file.

Events are built `parse.eventsAtOnce` at a time. One build is a handful of GETs and one or two PUTs, and no parsing.

### D5. The file

```
# Housing Advisory Board, 2026-09-14

- Council: uk-council-cambridge
- Meeting page: https://democracy.cambridge.gov.uk/ieListDocuments.aspx?MId=4846
- Status: Confirmed
- Documents: 16 listed, 14 joined, 1 left out as a copy, 1 not read

## Meeting page

<the page's markdown>

## Minutes

### 250227 PFC ISC minutes (PUBLIC)

<the minutes' markdown>

## Agenda

### Agenda frontsheet

<markdown>

## Item 26/25/HAB: Housing Performance Report Qtr 1 2026-27

### Housing Performance Report Qtr 1 2026-27

<markdown>

### 4. Appendix A - Performance Report - Qtr 1 2026-27 - FINAL

<markdown>

## Minutes of the previous meeting

### Minutes - 15 June 2026

<markdown>

## Documents left out

- Agenda Reports Pack: a copy of 9 documents above
- Annexe B: not read, blocked 403
- Adroddiad Blynyddol: other-language, Welsh
```

The title line and the facts list are a preamble. The first section is the meeting page, as the owner asked. When the page was not read, the section says `Not read: <reason>` and the preamble still carries the facts, so Jev always knows which meeting the file is about. The `Minutes` section appears only when a part has that role. An item section appears for each agenda item that has a joined document. A document with no agenda item goes under `## Other documents`.

Image links inside a part keep their full bucket keys under the document's own image folder, so one event file links images from several documents without a clash.

### D6. Roles

A role comes from the title, the agenda item title, and the dates. First strip a leading label from the title: `3 - `, `Item 2 - `, `Agenda Item No 5 - `, `00 `, and a file ending such as `.pdf`. Then apply the first rule that matches.

| Role | Rule | Seen |
| --- | --- | --- |
| `page` | The document id is the event id. | Every event. |
| `report` | The title holds `appendix` or `annex`. Checked first, so an appendix that is minutes of another body stays a report. | `Chapter House Appendix 1 - DCF Minutes`. |
| `previous-minutes` | The title holds `minutes` or `minute`, and it holds a date before the meeting date. Or the agenda item title starts with `Minutes`, such as `Minutes`, `Minutes of the previous meeting`, `Minutes of last meeting`, and the title holds no date on or after the meeting date. | `Minutes - 15 June 2026`, `Minutes Public Pack, 16/09/2026`, `3 - Minute 0810.pdf`, `Minutes of the meeting 6 July 2026`. |
| `minutes` | The title holds `minutes` or `minute`, and it holds the meeting date or no date. Also the Decision Time minutes document, whatever its title. | `Draft minutes 7 September 2026 Planning Committee`, `250227 PFC ISC minutes (PUBLIC)`, `Minutes`. |
| `agenda` | The title starts with `agenda` and holds none of `pack`, `reports`, `papers`. Or it holds `front sheet`, `frontsheet`, `notice of meeting`, `agenda notice` or `summons`. | `Agenda frontsheet`, `Agenda Front Sheet`, `Agenda Notice`. |
| `pack` | The title holds `pack` or `papers`, or holds both `agenda` and `reports`. Also any part that the cover rule finds to cover two or more other parts, whatever its title. | `Agenda Reports Pack`, `Public reports pack`, `Agenda Document Pack`, `Public Agenda`, Dundee `cg261026ag.pdf`. |
| `decisions` | The title holds `decision`. | `JDMC Cmte Decisions - 21 Oct 2026`, `NEPP Notice of Decisions`, `Decision sheet`. |
| `report` | Everything else. | Reports, statements, question papers, plans. |

Dates in titles come in many forms: `15 June 2026`, `16/07/2026`, `16th July 2026`, `0810` in COINS for 8 October, `250227` in CMIS for 27 February 2025. The date reader tries the long forms, the UK numeric form, then the six-digit and four-digit forms. A title whose date cannot be read is treated as having no date, and the agenda item rule decides.

Roles are guesses from text. The build record keeps every role, so a run can be checked and the rules can grow from what the runs show.

### D7. The cover rule

The rule compares the text of the parts of one event. It never compares across events, because that would need the text of every other event.

1. Take each part's markdown. Drop the page-marker lines and the image links. Lower-case the text and keep only letters, digits and spaces. Split it into words.
2. A part with fewer than `parse.leastCoverWords` words, 40 in the first config, is too short to judge. It is never covered and never covers. This protects maps, drawings and one-line letters.
3. Make the part's word runs: every run of `parse.wordsPerRun` words, 8 in the first config.
4. The cover of A in B is the share of A's word runs that B also holds.
5. A is covered by B when the cover of A in B is at least `parse.coverShare`, 0.9 in the first config, and B has more words than A. The measured copies in section B gave 90 to 97 percent, and unrelated pairs gave 0 to 2 percent, so 0.9 sits well above the noise and below every true copy seen.
6. A part that covers two or more other parts gets the role `pack`. Take the word runs of all the parts it covers together. When those hold at least `parse.packCoverShare` of the pack's word runs, 0.9 in the first config, the parts cover the pack: the pack is left out and the parts are joined, each under its own title and item. Otherwise the pack holds text that no single part has, so the pack is joined and the parts it covers are left out.
7. When the page covers a part with the role `minutes` at `parse.pageCoverShare` or more, 0.7 in the first config, the minutes part is left out. The lower bar is because a web page and a PDF of the same minutes differ in headers, footers and signatures: the measured page held 87 percent of the printed minutes. See open decision 2.
8. When two parts cover each other, the one later in meeting order is left out.
9. A part with the role `previous-minutes` is never left out by the page rule. It can be left out by a kept pack, as any part can.

Every left-out part is a line in the record and in the `Documents left out` section, so nothing disappears without a trace.

### D8. Failures

| What happens | Result |
| --- | --- |
| A document's bytes cannot be parsed | A document error record, as today: `broken-file`, `not-supported`, `no-text`, `other-language`, `too-large`, `bytes-missing`. The event is still built and lists the document as left out with the class. |
| A document has scan pages | The event waits for the OCR step, up to `parse.longestScanWaitInDays`. |
| A part's markdown cannot be read from the store | The event build fails with a `parse/v3/events/errors/<eventId>.json` record and is tried again next run. |
| The event file or record cannot be saved | The same. |
| An event has no parsed document | Not due. Nothing is written. The report counts it. |

### D9. Config

New keys in the `parse` part of every committed config file. Each is a number an operator may change.

| Key | First value | Meaning |
| --- | --- | --- |
| `eventsAtOnce` | 8 | Events built at the same time. |
| `wordsPerRun` | 8 | Words in one word run. |
| `leastCoverWords` | 40 | A part shorter than this is never compared. |
| `coverShare` | 0.9 | The share at which one part is a copy of another. |
| `packCoverShare` | 0.9 | The share at which the parts together replace a pack. |
| `pageCoverShare` | 0.7 | The share at which the page replaces a minutes document. |
| `longestScanWaitInDays` | 7 | How long an event waits for the OCR step. |

### D10. Where the code lives

The SDK rule says parsing and text work live in the SDK, and the pipeline only stores. So:

| In the SDK, pure functions with corpus tests | In the pipeline |
| --- | --- |
| `readDocumentRole`: the rules of D6, with the date reader. | `createParseStore`: the two layers of D1, a reader for times and records, a writer for documents and events. |
| `buildWordRuns` and `readTextCover`: steps 1 to 4 of D7. | `buildParseStep`: part 1 parses documents as today, part 2 finds the due events with D3 and builds them with D4. The cover decisions of D7 steps 5 to 9 sit here, because they decide what is stored. |
| `buildEventMarkdown`: the file of D5 from the event, the ordered parts with their roles and markdown, and the left-out lines. Heading demotion and escaping of titles happen here, once. | `createListStore` and `readCouncilListings`: the four fields of D2 and the two list changes. |
| The HTML reader: prefer the main content and drop the site's navigation, header and footer. Render a table whose cells hold paragraphs or lists as sections with headings, not as a GFM table. This is the ModernGov agenda table and the CMIS sections. | `createOcrStore`: a reader that gives the OCR record times, for the due rule. |
| Corpus fixtures from the probe: the Cambridge page, its printed minutes, its pack and three reports; the Amber Valley pack and three parts; Cardiff's bilingual minutes; the Dundee minutes page; the Decision Time shell page. | `tools/stores/readRunReport.mjs`, `README.md` and `AGENTS.md`. |

### D11. The report and the metrics

The report gains lines:

```
Parse report: 1234 documents and 310 events in 41.2 min
  Outcomes: document 1180, failed 40, unsaved 14
  Failed documents by class: broken-file 22, not-supported 12, other-language 6
  Documents with scan pages: 31
  Events built: 310, waiting for OCR: 12, with nothing parsed: 3, unsaved: 0
  Parts joined: 2450, left out: 210: pack 95, copy 20, minutes in page 95
  Previous minutes kept: 280
```

Two new metrics: `govbase_pipeline_parsed_events`, a counter by outcome, and `govbase_pipeline_event_parts`, a counter by place. `grafana/alerts.yaml` is checked by the structure test for metrics no code sends.

## E. Five rounds of edge cases

**Words used in this section**

- **Round**: one pass over the design, looking for cases that break it, in order of how much they matter. Each round changed the design above. The tables say what was found and what was decided.

### Round 1. Copies, the owner's first worry

| Edge case | Seen | Decision |
| --- | --- | --- |
| A pack beside every report it holds. | Amber Valley pack holds 96 percent of each part. CMIS `Agenda Document Pack`. COINS `Public Agenda`. Dundee's 165-page agenda. | The cover rule, D7 step 6. The parts win when together they cover the pack, because each part keeps its title and its item. |
| A pack that holds reports no single document has. | Thin CMIS sites list only the pack and the minutes. | The pack wins and the parts it covers are left out, D7 step 6. |
| The minutes in the page and in a PDF. | ModernGov page holds 87 percent of the printed minutes. CMIS pages with `MinuteDetails` beside a minutes PDF. | The page stays, the PDF goes at 0.7, D7 step 7. The SDK renders the page's item table as sections so the kept copy reads well. Open decision 2. |
| The previous minutes under this meeting. | Every system. For COINS they are the only copy of those minutes. | Role `previous-minutes`, kept as the last section, named as the previous meeting's record. |
| The same file at two addresses. | ModernGov `s73477/document.pdf` and `s73477/Minutes - 15 June 2026.pdf` are one file. | Two parts cover each other, the later one goes, D7 step 8. |
| The front sheet beside the page. | 2 percent shared. | Both stay. Not a copy. |
| A part too short to compare. | A one-page map, a drawing pack, a letter. | Under 40 words it is never compared, D7 step 2. |
| Minutes of another body as an appendix. | `DCF Minutes` under a planning item. | `appendix` wins, role `report`, D6. |
| A pack judged before its parts are parsed. | Parts with scan pages wait for OCR. | The event waits for OCR before it is built, D3 rule 2, so the cover rule sees every part. |
| A supplement listed as a single file and inside a later supplement pack. | ModernGov lists only the single file today. | The cover rule, when both are ever listed. |

### Round 2. Events change, pages are empty

| Edge case | Seen | Decision |
| --- | --- | --- |
| Minutes arrive weeks after the agenda. | Every system. | The due rule rebuilds when a part's record is newer than the build record, D3 rule 3. |
| An event rebuilt several times: agenda, supplement, minutes, OCR. | Normal. | Each build overwrites the file and the record. The record's time moves, so the judge sees a new version each time. Redesign decision 9 says versions are append-only; the judge is not built, so this is the simplest form of it. |
| The meeting page was not read. | Cardiff gives 403 to a plain client. Gateway errors. | The preamble carries the facts from the event record. The first section says `Not read` with the reason. The event is still built. |
| The meeting page is a JavaScript app with no text. | Decision Time, 50 words of chrome. Amber Valley, 197 words. | The preamble carries the facts. Later: the list step could keep the agenda items in the event record, because `GetMeeting`, CMIS pages and the Decision Time agenda all give item titles, agenda text and minutes text that the list step drops today. See the plan, step 7. |
| Several meetings on one page. | Own-site `split_by_date`, Antrim and Newtownabbey, Mid and East Antrim. | The event address gets `#<date>`, D2. |
| A document moves from one event to another between runs. | The list step keeps a shared address under the first event that lists it. | The due rule compares the document set with the last build's parts, D3 rule 3, so both events are rebuilt. |
| An event whose only document is the page. | Meetings with no papers. | Built, with the page alone. |
| An event whose page failed and that has no other document. | Rare. | Not due. Counted as `with nothing parsed`. |
| A cancelled meeting. | ModernGov gives a status. | The `status` field, D2, shown in the preamble. |
| A document the council changed after it was read. | An amended report under the same address. | Out of scope. The read step never fetches a read document again. Noted for the read step. |

### Round 3. Order, titles and roles

| Edge case | Seen | Decision |
| --- | --- | --- |
| Documents are sorted by address today, so the file order would be random. | All systems. | `documentIds` in meeting order on the event, D2. |
| Many parts with the same title. | Cardiff has eight parts named `Appendix 1` to `Appendix 5b` under one item. | The item section heads them, D5, and each part keeps its title. |
| A title with markdown characters. | `Kingway & Brackley`, `Item 9(a) - Appendix B: ...`, `#`, `*`, `[`. | Escaped by `buildEventMarkdown` in the SDK, D10. |
| COINS titles are file names. | `3 - Minute 0810.pdf`. | The label and the ending are stripped before the role rules, D6. |
| A date in a title in an odd form. | `0810`, `250227`, `16/07/2026`, `16th July 2026`. | The date reader of D6 tries each form and gives up to the agenda item rule. |
| An agenda item number that is not a number. | `26/25/HAB`, `9(a)`, `0` for a section header in ModernGov. | Kept as text in the item heading. A document under item `0` takes that item's title as its section. |
| A minutes document whose title has no date and no `Minutes` item. | `Minutes` on Decision Time, from the meetings list. | Role `minutes`. The Decision Time listing knows it is the minutes. |
| `Minutes Action Log` under the `Minutes` item. | Cambridgeshire. | Role `previous-minutes` by the item rule. Harmless: it is kept and labelled. |
| A part that is a page of the council site with its navigation. | Dundee's minutes page, every ModernGov page. | The HTML reader prefers the main content and drops navigation, header and footer, D10. |
| A document title that is empty. | Some own-site links have no text. | The list step already uses the last path segment. The role rules see a file name. |

### Round 4. Mechanics of the store and the step

| Edge case | Seen | Decision |
| --- | --- | --- |
| A crash between the file and the record. | Any run. | The record is written last, D4 step 7. A file without a record is rebuilt. |
| The due check costs one or two GETs per event, every run. | 7,000 events today, more each month. | Accepted. A few seconds now, a minute or two at 100,000 events. Open decision 4 has a LIST-only alternative. |
| The OCR step is not in the run, so an event waits for ever. | A `dev:step:parse` run alone. | `parse.longestScanWaitInDays`, D3 rule 2. |
| The SDK changes and every event should be built again. | A new SDK tag. | Records hold the SDK version. To redo, empty `parse/v3/events/`. To redo the documents too, empty `parse/v3/` and `ocr/v3/`. |
| One part's markdown cannot be read from the store. | A bucket error. | The event build fails with an error record and is tried again next run, D8. Not final, unlike a document error. |
| An event with seventy documents. | Cardiff Council, 18 items and 50 documents. | No cap on the file. The record holds the word count of each part. The judge decides what fits. |
| Building many events at once, each with many GETs. | Normal. | `parse.eventsAtOnce`, D9. The GETs of one event run `bucket.objectsAtOnce` at a time. |
| A truncated download that parses as `broken-file`. | Amber Valley draft minutes, cut off by the server. | A document error, as today. The read step could check `Content-Length` and save an error instead. Noted for the read step. |
| An event record without `documentIds`, written by the list step before this change. | The first run after the change. | The default is `[]`, so the event has no parts and is not due, until the next list run writes the ids. |
| Part 1 and part 2 in one run. | Normal. | Part 2 runs after part 1 in the same run, so an event's documents parsed today are joined today. |

### Round 5. The judge, languages and sizes

| Edge case | Seen | Decision |
| --- | --- | --- |
| The previous minutes counted twice by the judge: once in their own event, once as previous minutes. | Every system except COINS, where their own event has no copy. | The section heading and the role in the record say what they are. The judge can skip the section or weigh it. |
| A document in Welsh with an English twin. | Welsh ModernGov sites. | The twin is an `other-language` error and a left-out line with the language. The English one is joined. |
| A bilingual document. | Cardiff minutes, 24 Welsh units left out. | Already handled by the unit rule. The count shows in the record. |
| A false alarm of the language rule. | Dundee's agenda, 3 units marked Welsh. | Few and small. Noted for the SDK's marker lists. |
| An event file over the Jev limit. | A council meeting with a 300-page pack and twenty reports. | The judge cuts. The record's word counts per part let it keep the minutes and the page first. |
| Page markers from several documents in one file. | Every event. | They stay under the part's heading, so `Page 3 of 12` reads as that part's page. |
| Copies across events, beyond the previous minutes. | A report presented to two committees. | Not detected. The cover rule works within an event. The judge sees it twice. |
| An image-only document. | A scanned letter. | Its OCR markdown is joined when OCR is done, else it waits. |
| A document that is a link to a video or a spreadsheet. | ModernGov `isLink`, `.xlsx`, `.mp4`. | `not-supported` today. A left-out line. |

## F. Plan to build

**Words used in this section**

- **Corpus**: the SDK's folder of real files with their expected markdown. A change that alters the markdown of a file fails the corpus check until the expected file is updated on purpose.

Order: the SDK first, then the list step, then the parse step, then a real run. One branch per app, named `parse-events`.

### Step 1. The SDK

1. Add `readDocumentRole` with the rules of D6 and a date reader for the forms seen.
2. Add `buildWordRuns` and `readTextCover`, D7 steps 1 to 4.
3. Add `buildEventMarkdown`, D5, with heading demotion, title escaping and the left-out section.
4. Change the HTML reader: prefer `main`, `article` or the site's content element, drop `nav`, `header`, `footer` and `aside`, and render a table whose cells hold block content as sections.
5. Add the corpus fixtures of D10. Expected markdown for each.
6. `make check`, commit, tag.

### Step 2. The list step

1. The four optional fields of D2 in `createListStore.schema.ts`, with defaults.
2. `readCouncilListings` fills them: `documentIds` in meeting order, `status` from the meeting detail, item number and title on each document. Each listing maker already returns the agenda items in order.
3. The `#<date>` event address for `split_by_date` pages.
4. Tests, `make check`.

### Step 3. The parse step

1. `createParseStore`: the `documents/` and `events/` layers, a reader for event times and build records, a writer for events.
2. `createOcrStore`: `readScannedTimes`.
3. `buildParseStep`: part 2 with the due rule of D3 and the build of D4 and D7. The config keys of D9 in both committed config files. The report lines and metrics of D11.
4. `tools/stores/readRunReport.mjs`, `README.md`, `AGENTS.md`.
5. Tests for each due case in D3, each cover case in D7, and the file of D5. `make check`.

### Step 4. A real run

Run `bun run dev:step:parse` against the development bucket after a list and read run. Open ten event files: a ModernGov meeting with minutes, an Amber Valley meeting with its pack, a CMIS meeting with a pack and a minutes PDF, a Decision Time meeting, a COINS meeting with a previous minutes paper, a Welsh council. Check the roles and the left-out lines in each record against the files.

### Later, not in this update

- The agenda items in the event record: title, number, agenda text and minutes text per item, for the systems whose page is empty. `buildEventMarkdown` would render them as the first section when the page has no content.
- A `Content-Length` check in the read step, so a cut-off download is a read error and not a broken file.
- Cover across events, if the judge shows that shared reports matter.

## G. Open decisions for the owner

**Words used in this section**

- **Nested key**: a bucket key with the event id as a folder, such as `read/v2/documents/data/<eventId>/<documentId>`.

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | The parse step builds the events, or a new step after OCR does. | The parse step. An event with a scan waits for the OCR step and is built on the next parse run, one day later in the daily chain. A new step would add a store, a script, a config line and a chain change for little gain. |
| 2 | When the page and a minutes PDF both hold the minutes, leave the PDF out, or keep both. | Leave the PDF out at 0.7, and render the page's item table as sections in the SDK, so the kept copy reads well. Keeping both is the copy the requirement rules out. |
| 3 | The previous minutes: keep them last and labelled, or leave them out. | Keep them. For COINS they are the only copy. The label lets the judge skip them. |
| 4 | Event records hold `documentIds`, and the parse step GETs each event record, or the stores use nested keys so one LIST gives the grouping. | `documentIds`. It is one optional field, and the GETs are cheap. Nested keys would change the list, read, parse and OCR stores and the read step's due rule. |
| 5 | Keep the name `parse/v3` with the new `documents/` and `events/` folders, or go to `parse/v4`. | Keep `v3`. Nothing has been written to it yet, so no reader breaks. The store rule about a new folder is for a store that was run. |
| 6 | The `#<date>` event address for `split_by_date` pages. | Yes. Without it, every meeting on such a page is one event. |

## H. The simple start

**Words used in this section**

- **Required field**: a field every record must have. The owner's rule: an object in the bucket never has an optional field. So a new field is a change of shape, and the old objects in that folder must go before the next run.
- **Iteration**: one small build that works end to end. The next iteration adds one thing to it.

This is the smallest build that gives one file per event, keeps the meeting page first, and leaves out copies. It has one rule for copies, no roles, and no record per event. Everything else in section D is a later iteration.

### H1. What changes in the list step

| Change | Detail |
| --- | --- |
| `documents` on the event, required | Decided 2026-10-23. The event record holds its documents, each with `id`, `title` and `url`, in meeting order: the page first, with the event's own id and address, then each agenda item's documents in agenda order. The draft holds the addresses and `ListedEventDraftSchema` decodes each one to its id with `ItemIdSchema`, as it does for the event's own id. The folder `list/v2/documents/data/` goes: the event is the only list record. The two error folders stay. |
| The read step loops the events | It LISTs `list/v2/events/data/`, GETs each record, and reads every document in it that has no bytes object and no error. A failed document is tried again when its error object is older than the event record, which the list step writes again every run it lists the meeting. |
| The event address of a `split_by_date` meeting | The address of the meeting's first document after the sort by address, such as its agenda PDF, instead of the shared page address. Each meeting on the page then has its own id, and the id rule stays one address, one object. The page document of such an event is that first document, so the event file opens with the agenda. The shared page is not read for these councils; it holds only links. Decided 2026-10-23 in place of a `#<date>` suffix. |
| Nothing else | The document record stays `{ id, title, url, eventId }`. The read step does not change. |

The event shape changes, so `list/v2/events/data/` must be emptied before the next list run, and `list/v2/documents/data/` is deleted. The owner does both.

```ts
export const ListedEventSchema = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  title: Schema.String,
  date: Schema.String,
  url: Schema.String,
  documents: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      url: Schema.String,
    }),
  ),
});
```

### H2. What changes in the parse step

| Change | Detail |
| --- | --- |
| The document record loses `contentHash` and `contentType` | The read step no longer writes them, and the SDK sniffs the bytes. The record keeps `id`, `sdkVersion`, `pageCount`, `scanPages`, `leftOut` and `images`. The old `readItem` call goes. This change is needed anyway: the step does not run today. |
| The document layer moves under `documents/` | `parse/v3/documents/data/`, `text/`, `images/`, `errors/`, as in D1. The OCR step keeps reading the record and the images as it does now. |
| One object per event | `parse/v3/events/data/<eventId>.md` is the file and the done marker. Its bucket time is the build time. `parse/v3/events/errors/<eventId>.json` holds a build that could not be saved, and is tried again next run. There is no event record: what was left out, and why, is written at the end of the file. |
| Part 2 of the run | After the documents are parsed, the step builds the due events. |

### H3. When an event is due

1. LIST `list/v2/events/data/`, then GET each event record for its `documents`.
2. LIST `parse/v3/documents/data/` and `errors/`, LIST `ocr/v3/data/`, and LIST `parse/v3/events/data/`, all with times.
3. An event is due when at least one of its documents has a parse record, and the event has no file, or the newest parse or OCR record of its documents is newer than the file.

No waiting for OCR. A scanned document is joined without its OCR text first, and the event is rebuilt when the OCR record arrives, because that record is newer than the file. No check of the document set. A new document gets a parse record, and that record is newer than the file.

### H4. How the file is built

1. GET the event record and, for each entry in `documents`, the document's markdown from `parse/v3/documents/text/`, or from `ocr/v3/text/` when the OCR store has a record for it. A document with no parse record, or with a parse error, becomes a left-out line.
2. Hand the event and the parts to the SDK's `buildEventMarkdown`, a pure function. It does the one copy rule of H5, demotes each part's headings by two levels, and renders the file of H6.
3. PUT the file.

Events are built `parse.eventsAtOnce` at a time.

### H5. The one copy rule

Take each part's words, without the page-marker lines and the image links, lower-cased, letters and digits only. Make its word runs of `parse.wordsPerRun` words, 8 to start. A part is left out when at least `parse.coverShare` of its word runs, 0.8 to start, are in another part of the same event that has more words. The meeting page is never left out. A part with no word runs is never left out.

What this one rule does with the copies of section C:

| Copy | Result |
| --- | --- |
| A pack beside its reports | The reports go, the pack stays. The pack is the longer one. The reports' titles are lost inside the pack. Iteration 2 turns this round. |
| The minutes in the page and in a PDF | The page covers the PDF at 87 percent, so the PDF goes at 0.8. If the PDF is the longer one, both stay. |
| The same file twice | One goes. |
| The previous minutes | Not a copy within the event. They stay, in listing order, with no label. Iteration 2 labels them. |
| The front sheet | Stays. 2 percent shared. |

The bar is 0.8 because true copies measured 90 to 97 percent, the page against the minutes 87 percent, and unrelated pairs 0 to 2 percent.

### H6. The file

```
# Housing Advisory Board, 2026-09-14

- Council: uk-council-cambridge
- Meeting page: https://democracy.cambridge.gov.uk/ieListDocuments.aspx?MId=4846

## Meeting page

<the page's markdown, or: Not read>

## Minutes - 15 June 2026

<markdown>

## Housing Performance Report Qtr 1 2026-27

<markdown>

## Documents left out

- Public reports pack: a copy of 9 documents above
- Annexe B: not parsed
- Adroddiad Blynyddol: other-language
```

One `##` section per part, in listing order, with the part's title. A part's own headings go down two levels, capped at six. Page markers stay level six. Image links keep their full bucket keys.

### H7. Config

Three keys in the `parse` part: `eventsAtOnce` 8, `wordsPerRun` 8, `coverShare` 0.8.

### H8. What is left for later, in order

Decided 2026-10-22: only data capture is in scope, which is H1 to H7 and H9. Everything below, and the judge, is out of scope until the owner says otherwise.

1. Roles, so the previous minutes get their own last section and the parts win over a pack.
2. The ModernGov and CMIS item table rendered as sections in the SDK, so the page's minutes read well.
3. Waiting for the OCR step before a build, so an event is judged once.
4. The agenda items in the event record, for the systems whose page is empty.
5. `status` on the event, and the agenda item number and title on the document, for item headings.

Each of these adds a required field or a rule, and each needs the folder it changes to be emptied first.

### H9. The order of work

1. SDK: `buildEventMarkdown` with the copy rule, heading demotion and the file layout. Corpus fixtures from the probe files.
2. List step: `documentIds` and the `#<date>` address. Empty `list/v2/events/data/`.
3. Parse step: the record change, the `documents/` and `events/` folders, the due rule, the build. Empty `parse/v3/` and `ocr/v3/`.
4. A list run, a read run, a parse run on the development bucket. Open five event files: a ModernGov meeting with minutes, Amber Valley with its pack, a CMIS meeting, a Decision Time meeting, a COINS meeting.
