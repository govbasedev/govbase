# Evaluation plan: issue and decision judgments

As of 3 October 2026. Terms follow [CONTEXT.md](CONTEXT.md).

## The claim

AI judgment about what council agenda items are about, and what they decide, is more useful than keyword matching for an analyst who follows national issues.

The proof of concept (POC) tests this claim on two issues, local government reorganisation (LGR) and devolution, in the programme "English devolution and local government reorganisation".

## Scope

In the POC:

- A local SQLite store of item versions, evidence, judgments, keyword baseline results and labels.
- An evaluation report.
- No app, view, brief or alert. No production storage.

Out of the POC:

- Council position. Position labels come later, from analysts' own notes.
- Service area Choice and centrality Score.
- Quote check (phase 3) and brief and alerts (phase 4).
- Issues other than LGR and devolution.

## Judgments

| Judgment | Primitive | Stage | Asked on |
| --- | --- | --- | --- |
| About LGR, about devolution | One Noul each | Agenda and minutes | Every item that is not a private-case item (step 1) |
| Procedural item | Noul | Agenda and minutes | Every item that is not a private-case item (step 1) |
| Decides on, one per issue that passed "about" | Noul, with the premise "If this item is about ..." | Agenda | Items where an issue Noul passed a low threshold (step 2) |
| Decides on, at the minutes stage | Noul per issue | Minutes | Same items, asked with the decision-span questions |
| Decision span class | Choice per span: substantive decision, noting, procedural, not a decision | Minutes | Phase 2 items with minutes |
| Decision taken | Noul per item | Minutes | Phase 2 items with minutes |

- "Mentions" is never asked. It is the keyword baseline.
- "Decides on" is its own Noul, not a combination in code. A decision on a different matter in the same item, such as the Bradford A650 road project, must not count.
- All independent questions about one item version go in one request.
- Raw probabilities are stored, never labels. See [ADR 0001](adr/0001-raw-judgments-keyed-by-item-version.md).

## Evidence sent

| Stage | State |
| --- | --- |
| Agenda, step 1 | Council, committee, meeting date, item title, agenda text in full, document titles. If the agenda text is empty, the first 500 characters of the first document. |
| Agenda, step 2 | Step 1 state plus the start of up to 3 documents, about 1,500 characters each, as a starting point to test. |
| Minutes | Item title and minutes text in full. |

- A private-case item (licensing, standards, planning applications) is never sent.
- A public question is not a private-case item. It is sent, and it is never quoted.
- An item version is judged once. It is judged again only when its evidence changes.
- Past items are also judged as rebuilt item versions: the agenda text and the documents published on or before the meeting date. A rebuilt version is never a forecast.

## Keyword baselines

Fixed on the practice sample before the test sample is labelled.

| Test | Baseline A | Baseline B |
| --- | --- | --- |
| About an issue | Issue words in the title only | Issue words anywhere, including the documents |
| Procedural item | A list of standard titles, such as "apologies" | — |
| Decision spans | "RESOLVED" in capitals | "resolved", "agreed", "carried" or "decision", in any case |
| Decides on (agenda) | Words such as "to approve" or "to note" in the agenda text | — |

## Labels

All labels are made by one labeller. Agreement is measured by labelling 50 test items again 2 weeks later, without seeing the first labels.

Each label records two answers. See [ADR 0002](adr/0002-score-against-item-truth.md).

- **Item truth**: the answer for the real item. The labeller may search the whole documents.
- **State truth**: the answer from the state that was sent.

### Issue test

Run both methods on every item first. Then sample from the groups:

| Group | Keyword says | Jev says | Sample |
| --- | --- | --- | --- |
| A | yes | yes | 40 |
| B | yes | no | 50 |
| C | no | yes | 50 |
| D1 | no, but related words | no | 40 |
| D2 | no | no | 100, taking more from items Jev rated higher |

- Practice sample: about 100 items, kept apart.
- Each item is labelled for both issues, for "procedural", and, when it is about an issue, for "decides on".
- D2 is shared across issues.
- Labels are made in random order, without showing the group.
- Results are weighted back to all items, with ranges of uncertainty.

### Decision-span test (phase 2)

- Practice: 30 items. Test: 100 items with minutes: 30 with "RESOLVED" in capitals, 30 with "resolved" only in normal case, 40 with none of the words.
- Each label marks every decision span, its class, and its decision group.
- Metrics: item level (found at least one decision), span level, class (substantive against noting), and group (both parts found).

## Pass marks

### Gate 0, before phase 1

- The store keeps item versions from one run to the next.
- Code proves that no private-case item is sent.
- The keyword baselines and the label guide are fixed.
- TypeSafe's Data Processing Agreement is accepted, its sub-processor list is read, and zero data retention is in place or the agreed retention is acceptable.

### Gate 1, the issue test

All of these must hold, on item truth, weighted to all items:

1. Jev's precision is at least 15 points higher than baseline B.
2. Jev's recall is at least 15 points higher than baseline A.
3. McNemar's test on the disagreements gives p < 0.05.
4. The labeller's second pass agrees with the first on at least 90% of issue labels.
5. Step 1 with the short state loses no more than 5 points of recall against the full state.
6. The procedural Noul has at least 98% precision.

Reported but not a gate: calibration, and cost in tokens and requests per item and per run.

Kill rule: if Jev does not beat the better keyword baseline on both precision and recall, stop. Then decide whether to change the question or drop the idea.

If check 5 fails, change the pipeline to keep line breaks in document text, add document headings to the state, and run the test again.

### Gate 2

- 2a: decision spans beat baseline B, not only baseline A.
- 2b: "decides on" forecasts match their outcomes. First on rebuilt item versions, marked as rebuilt. Then on forecasts stored before the meeting, from 6 weeks of daily local runs. Expect wide ranges, because few items are about the issues.

## Label guide: worked examples for "about"

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

## Known gaps

- **Minutes delay.** How long minutes take to appear is not measured. Measure it in week 1 of daily runs. If most take over 4 weeks, extend the 6-week period.
- **Public questions.** The question text is usually in the minutes or a question pack, not the agenda text. Step 1 at the agenda stage will often miss them. Expect this to show as lost recall in check 5.
- **Rebuilt is not seen at the time.** A council may edit an agenda after the meeting.
- **Rare issues.** About 1% of items are about LGR or devolution, so ranges will be wide. Do not round them into a clean claim.
- **One labeller.** The test uses the labeller's idea of "about", not an analyst's. Report this as a limit.
- **Coverage.** Only the 299 ModernGov councils are read, out of 382 in `sources.yaml`.
- **Withdrawals.** A withdrawal shows only when a meeting is read again after new material is published. An item missing from one run means nothing by itself.
- **Pipeline changes.** Phase 0 needs the changes in [pipeline-changes-for-evaluation.md](pipeline-changes-for-evaluation.md).

## Privacy rules

1. Store evidence as published. Do not remove names.
2. Never extract people as entities. No question has a person as its answer.
3. Never build an index or a search by person. No free-text search over evidence for users.
4. Never quote text that names or identifies a private individual, including by address.
5. Send only what each question needs. Never send private-case items.
6. Follow withdrawals. A withdrawn item is never used in any output.
7. Get legal advice and a data protection impact assessment before production.

Quote-check test cases for phase 3 include an honorary alderman: a former councillor who no longer holds office, and so a private individual.
