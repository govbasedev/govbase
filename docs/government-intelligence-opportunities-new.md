# Government intelligence opportunities

As of 3 October 2026. This replaces [government-intelligence-opportunities.md](government-intelligence-opportunities.md). Terms follow [CONTEXT.md](CONTEXT.md). The test design is in [evaluation-plan.md](evaluation-plan.md).

## Summary

The pipeline's 1,113 meetings from 299 councils can feed eight intelligence products, and most need judgment that keyword search cannot give. But none of them is worth building until one claim is proved: AI judgment about what an agenda item is about, and what it decides, beats keyword matching.

So the first step is a proof of concept (POC) on two issues, local government reorganisation (LGR) and devolution. It produces a local dataset and an evaluation report, not a product. Every other opportunity waits for its gate.

The first user is a **public-affairs or consultancy analyst** who follows national issues across many councils for clients. An analyst reads every item anyway, so an unclear judgment becomes a review task, not a published error.

Each idea names the TypeSafe question type it uses: a Choice picks one option, a Noul gives the probability of yes, and a Score places an item on ordered levels.

## What the data shows

The data is the run of 3 October 2026 in `apps/pipeline/data/bundles`.

| Fact | Number |
| --- | --- |
| Councils read (ModernGov only, out of 382 in `sources.yaml`) | 299 |
| Meetings | 1,113 |
| Agenda items | 11,444 |
| Items with minutes | 3,607 |
| Meetings still to come | 608 |
| ... of which within 7 days | 451 |
| ... of which 8 to 14 days ahead | 155 |
| Minutes items containing "RESOLVED" in capitals | 942 (26%) |
| Minutes items with none of "RESOLVED", "AGREED" or "DECISION" in capitals | 2,557 (71%) |

- **Decisions ahead.** An agenda usually appears about 8 days before its meeting. So the forward view is about two weeks, not "the coming weeks".
- **Text sizes.** In the middle item, agenda text is 123 characters and minutes text is 359 characters, so both can be sent whole. The middle document is about 9,000 characters, and 1 in 100 is over 200,000, so documents cannot.
- **Minutes belong to items.** Each agenda item holds its own minutes text, so the agenda item is the natural unit.
- **No history in production.** Each run writes a new bundle. In production the bundles are lost when the job ends.

### Keyword counts measure "mentions", not "about"

The earlier version of this document counted councils per topic with keywords. Those counts measure only that a word appears. They depend heavily on where you look. For "LGR" or "local government reorganisation":

| Where the words are searched | Items |
| --- | --- |
| Item title only | 24 |
| Title, agenda text and minutes text | 230 |
| All text, including documents | 1,232 |

The real share of items about LGR is probably below 1%.

Examples of keyword mistakes:

- "Petition" matched "There were no petitions or public questions".
- "LGR" matched "Food Waste Implementation" (Bromsgrove) and "Procurement Pipeline Report" (Guildford), which only mention it.
- "Unitary" matched "Applications For Planning Permission" (Knowsley).
- "Combined authority" matched Bradford's "A650 Improvement Project", a road project that a combined authority only pays for.

## Issues and service areas

The earlier version used "topic" for two different things. They are now kept apart.

| | Issue | Service area |
| --- | --- | --- |
| Meaning | A national question a council can take a position on | A field of council work |
| Examples | LGR, devolution, SEND high-needs deficits | Contracts, temporary accommodation, local plans |
| How many per item | None, one or several | One main area |
| Question type | One Noul per issue | One Choice |
| Position | Yes, per issue, later | No |

Related issues sit in a **programme**, such as "English devolution and local government reorganisation", so an analyst can follow both at once. East Devon's "Local Government Reorganisation, Devolution and Transformation" is about both issues.

Issues and programmes live in an **issue register**: a data file with each issue's definition and exclusions. Changing a definition makes a new version of the issue.

## Mentions, about, and decides on

| Level | Meaning | Decided by |
| --- | --- | --- |
| Mentions | A word for the issue appears | Code: the keyword baseline |
| About | The issue is the subject of the action the meeting is asked to take, or a part of the item set out on its own | An issue Noul |
| Decides on | The meeting is asked to decide, or did decide, something about the issue itself | A Noul per issue, asked only when "about" passed |

"Decides on" is its own question, not a combination of "about" and "takes a decision". The Bradford road item takes a decision, but not a decision on devolution.

Example: Teignbridge Executive, 6 October 2026: "In view of the Government's recent announcement to pause LGR … a report be provided … on the direct and indirect costs to date of LGR." It is about LGR, and it decides on LGR. On 3 October it is a recommendation, not a decision.

## The proof of concept

| Phase | What is built | Gate |
| --- | --- | --- |
| 0. Foundations | Local SQLite store, issue register, label guide, private-case filter, fixed keyword baselines | No private-case item is sent. TypeSafe's Data Processing Agreement is accepted. |
| 1. Issue judgments | Issue Nouls for LGR and devolution, and the procedural Noul | Beats both keyword baselines by 15 points, with a real difference (McNemar's test). |
| 2. Decisions | "Decides on" per issue, and decision spans from minutes | Decision spans beat the best keyword rule, not only "RESOLVED". Forecasts match outcomes. |

After the POC:

| Phase | What is built |
| --- | --- |
| 3. Quote check | A Noul that blocks any quote naming or identifying a private individual |
| 4. Brief and alerts | A weekly brief per issue, and alerts for meetings before the next brief |

The full pass marks, samples and kill rule are in [evaluation-plan.md](evaluation-plan.md).

How the POC works:

- **Unit.** One agenda item at one time: an **item version**. When minutes arrive, the item gets a new version. The old judgments are kept.
- **Two steps.** Step 1 asks the issue Nouls and the procedural Noul on every item, with short text. Step 2 adds the start of the documents, only for the roughly 1% of items where an issue Noul passed.
- **Judge once.** An item version is judged again only when its evidence changes.
- **Raw answers.** Probabilities are stored, not yes-or-no labels. See [ADR 0001](adr/0001-raw-judgments-keyed-by-item-version.md).
- **Forecasts.** A forecast is an agenda-stage judgment stored before the meeting. The pipeline runs every day, locally, for 6 weeks to collect real forecasts.

## Opportunities

Each opportunity now states where it stands and what it waits for.

### 1. Track issues by what an item is about, not by its words

**In the POC (phase 1).**

For each item, ask one Noul per issue in a single request: "Is this item mainly about local government reorganisation, rather than mentioning it in passing?". Code builds the feeds.

- The centrality Score is dropped from the POC. A Noul measures how sure the model is, not how central the issue is. Add a Score only if analysts need ranking.
- A procedural Noul removes items such as apologies and "no petitions were received".
- This is the base for every other product.

### 2. Early warning on decisions to come

**In the POC (phase 2), narrowed.**

For each issue an item is about, ask: "Is the meeting asked to decide something about this issue itself?". The officers' recommendation is shown as "recommended, not decided".

- The general "Will this item take a decision?" Noul is dropped. The analyst only needs decisions on the issues they follow.
- The decision-type Choice (budget, contract, policy, asset sale, planning, appointment) and the significance Score wait until after the POC.

### 3. Pull out decisions from minutes

**In the POC (phase 2).**

Use the "select, do not generate" pattern:

1. Code decodes HTML entities and splits the minutes into **decision spans**: sentences and list items such as "(a)".
2. A Choice per span: substantive decision, noting, procedural, or not a decision.
3. A Noul per item: "Did this meeting take a decision on this item?"

- Decisions without "RESOLVED" are common: "On being put to the vote, the MOTION was CARRIED." (Oldham).
- One decision can span two sentences, a motion and then "the motion was carried". These form a **decision group**.
- Noting is kept apart from substantive decisions.
- The outcome Choice (approved, refused, deferred, amended) waits until after the POC.
- **Conflict:** the planning signal "Did members go against the officer's recommendation?" needs planning-application items. These are private-case items and are never sent to the model. This idea needs a new privacy decision before it can return.

### 4. A contract and money tracker

**After the POC. Different user.**

This serves a supplier or bid team, not the analyst. Formal tender notices already exist as structured data, for example in Contracts Finder, so meetings add value mainly as an early signal. The contract details are mostly in documents, which are the least reliable part of the fetch.

Method, unchanged: code finds candidate amounts, company names and terms, and a Choice picks the contract value, the supplier and the term.

- Example: South Kesteven Cabinet, 6 October 2026: NEC Software Solutions UK Ltd, £366,502, 3 years.

### 5. A financial and service stress score for each council

**After the POC.**

Use the composite scoring pattern: a separate Score per signal (overspend, use of reserves, section 114, exceptional financial support, limited audit assurance, Ofsted or CQC concerns), combined with weights users can change in code. Raw judgments are stored, so changing a weight does not need the model again.

- Example: Southend forecasts "a significant overspend for the 2026/27 financial year".
- This needs the most testing of all the ideas, because it combines many judgments.

### 6. Compare councils on the same national issue

**After the POC. Redesigned.**

Do not ask "What is the council's position?". Only the body that holds the power can take a **council position**. A recommendation, a failed motion or a member's statement never counts. Split the question into parts, per statement and per issue:

1. Source, a Choice: full council resolution, executive decision, committee recommendation, officer recommendation, motion passed, motion failed, or member's statement.
2. Binding, a Noul: "Is this a decision by the body that holds the power?"
3. Stance, a Choice: supports, opposes, has concerns, or neutral.

Code computes the council position from binding decisions only.

- In one 7-day window, only about 2 full council resolutions on LGR or devolution appear. That is too few to test or to fill a brief.
- Labels come from the analysts: when an analyst records a council's position from a quote, keep it as a label.

### 7. Accountability signals

**After the POC.**

Call-ins, notices of motion, petitions and public questions show that a decision is contested. The procedural Noul in the POC already filters empty mentions such as "There were no petitions".

- A public question is not a private-case item. It is sent to the model, but never quoted, because the person who asked is a private individual.
- The question text is usually in the minutes or a question pack, not the agenda text. The POC will measure how many the short text misses.

### 8. Personal watchlists

**After the POC and after phase 4.**

Users follow an issue, a programme, a council, an area or a company. The "re-ranking" cookbook scores new items against each watchlist. A watchlist can never follow a person.

## Privacy rules

1. Store evidence as published. Do not remove names.
2. Never extract people as entities. No question has a person as its answer.
3. Never build an index or a search by person. Users get no free-text search over evidence.
4. Never quote text that names or identifies a private individual, including by address.
5. Send only what each question needs. Never send private-case items: licensing, standards, and planning applications.
6. Follow withdrawals. A withdrawn item is never used in any output.
7. Get legal advice and a data protection impact assessment before production.

The Open Government Licence does not cover personal data. So the names of councillors and officers are public, but not licensed under the OGL.

## What changed from the earlier version

| Earlier | Now | Why |
| --- | --- | --- |
| Eight products, start with 1 and 3 | A POC on two issues, with gates | Prove the claim before building on it |
| "Topic" | Issue and service area | Only issues have positions, and an item can be about several issues |
| Noul plus centrality Score | Noul only | A Noul is certainty, not centrality |
| General "will this take a decision?" | "Decides on" per issue | A decision in an item may be about something else |
| Sentences in minutes | Decision spans and groups | List items and two-sentence decisions |
| Position per council | Source, binding and stance per statement, after the POC | Only the body with the power takes a position |
| Label about 100 items | About 430 label decisions for the issue test, with groups and weights | Random samples hold almost no LGR items |
| Baseline run, `bundles_old` | New run, `bundles` | Newer and complete: all 299 bundles |

## Sources

- Data: `apps/pipeline/data/bundles/2026-10-03T16-42-57-274Z`, the ModernGov run of 3 October 2026 (299 bundles).
- [TypeSafe use-case map](https://docs.typesafe.ai/concepts/use-case-map.md), [primitives](https://docs.typesafe.ai/primitives.md), [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring.md), [structure recovery](https://docs.typesafe.ai/cookbooks/autoformat.md), [documentation index](https://docs.typesafe.ai/llms.txt), [legal](https://docs.typesafe.ai/legal.md).
