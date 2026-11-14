---
name: discover-topics
description: Find subjects that council papers discuss and that config/topics.yaml does not cover yet, by labelling paper titles and headings in small checked batches. Use when the user asks to discover new topics, find topics we do not know about, or extend the topic list. Built to run on Haiku.
---

# Discover topics

You label council papers in small batches. A script gives you each batch, checks your work, and builds the report. You only do the labelling. Do not ask the user questions. Do not change any file in `apps/`. Do not edit `topics.yaml`.

The script is `.claude/skills/discover-topics/scripts/discover.mjs`. Run every command from the workspace root, `/Users/shauncarmody/govbase`. Below, `D` stands for `bun .claude/skills/discover-topics/scripts/discover.mjs`.

## 1. Start

Run `D status`.

- If it says `0 of 0 batches`, run `D prepare`. This reads the bucket and can take up to an hour the first time. It needs `gcloud auth login` to have been done, and in the sandbox it needs `allowed_domains`: `storage.googleapis.com`, `oauth2.googleapis.com`, `www.googleapis.com`. If the user asked for a sample, add `--sample <number of papers>`.
- If batches exist, do not run `prepare`. Go to step 2.

Read `apps/pipeline/data/topic-discovery/known-topics.md` once. These topics are already counted.

## 2. The loop

Repeat these four steps. Do one batch at a time. Never skip the check.

1. Run `D next`. It prints a batch number and four lines to follow. If it prints `ALL DONE`, go to step 4. If it prints `WAIT`, go to step 4.
2. Read the vocabulary file and the batch file it names.
3. Write the labels file it names, one line for every item in the batch. Use the Write tool.
4. Run the `check` command it prints.
   - `OK`: go back to 1.
   - `FAIL`: it lists each problem and its item number. Fix those lines, write the whole labels file again, run `check` again. If the same batch fails three times, write the file again with `"new": []` on every failing item, so it passes, and move on.

Stop the loop after 100 batches in one session, then go to step 4. The work is saved, and the next session carries on from where this one stopped.

## 3. How to label one item

A batch line looks like this:

```json
{"n":7,"title":"019 - PART A ECH retender 2026-27","headings":["Extra Care Housing re-tender 2026/27","Officer Contact: ..."],"covered":["Adult social care"]}
```

`title` is the link title of one paper. `headings` are its headings. `covered` names the known topics that already match it.

Your line for it:

```json
{"n":7,"new":[{"name":"extra care housing","evidence":"Extra Care Housing re-tender"}]}
```

Most items have nothing new. Then write `{"n":7,"new":[]}`. An empty list is the normal answer, and it is never wrong to be unsure and leave it empty.

Ask one question for each item: **is there a subject here that a resident would search for, that no known topic covers?**

A subject is a thing the council acts on: a service, a problem, a group of people, a kind of place or asset. Examples: `school transport`, `leisure centres`, `taxi licensing`, `coastal erosion`, `allotments`, `cemeteries`, `foster care`.

Rules for `name`:

- 1 to 4 words, lowercase, letters only. No digits, no punctuation.
- A plain noun phrase a resident would type. Write `taxi licensing`, not `hackney carriage and private hire licensing policy review`.
- General, not local. Write `leisure centres`, not `riverside leisure centre`.
- If a name in the vocabulary file fits, use it with the same spelling. Make a new name only when none fits.
- At most 3 new topics for one item.

Rules for `evidence`:

- Copy the exact words from the `title` or one heading that show the subject. 3 or more characters. Do not change, shorten inside, or correct them. The check compares them letter by letter.
- The evidence must hold the subject in plain words, and the name must share a word with it. An abbreviation, a file code or the name of a law is not evidence: `PlngRoW` does not show `rights of way`, and `Commons Act 2006` does not show `common land`. The check fails a name that shares no word with its evidence.
- If you cannot point at exact plain words, there is no topic. Write `"new": []`. When two rules pull apart, the empty list wins.

Never output these:

- A known topic, or a narrower part of something in `covered` or in the known topics list. If `covered` has `Planning`, a planning application is not new. Grants to charities are part of `Volunteering and community`. Test: would a resident who reads the known topic's page expect to find this paper there? If yes, it is not new.
- Meeting procedure: minutes, agenda, apologies, declarations of interest, questions, motions, work programme, forward plan, appointments, terms of reference, constitution.
- Document types: report, appendix, update, policy, strategy, plan, review, with no subject.
- Names of places, people, councils, committees, companies or wards.
- Money words alone: budget, revenue, capital, fees, treasury. `Council finances` covers them.
- Anything you inferred that is not in the words shown.

Worked examples:

| Title and headings | Answer |
| --- | --- |
| `Minutes of Previous Meeting`, no headings | `[]`, procedure |
| `00290 Glentham Site Location Plan` | `[]`, a place and a document type |
| `Taxi and Private Hire Licensing Policy 2026` | `taxi licensing`, evidence `Taxi and Private Hire Licensing` |
| `Home to School Transport Policy`, covered `Schools` | `school transport`, evidence `Home to School Transport`. It is a different service from schools |
| `Corporate Health, Safety and Wellbeing Policy`, heading `CABINET` | `[]`, internal staff policy with no resident subject |
| `Leisure Centre Management Contract Award`, covered `Social value and procurement` | `leisure centres`, evidence `Leisure Centre` |
| `Q2 Financial Monitoring Report`, covered `Council finances` | `[]`, covered |
| `Bereavement Services Fees`, heading `Cemeteries and Crematorium` | `cemeteries`, evidence `Cemeteries and Crematorium` |

Every item in the batch gets exactly one line, with the same `n`. Do not add other fields. Do not wrap the file in a list. Do not write notes in the file.

## 4. Finish

Run `D report`, then `D status`. Tell the user, in short plain sentences:

- how many batches are done and how many are left;
- the top candidates the report printed, up to 15, with councils and papers;
- the report path, `apps/pipeline/data/topic-discovery/report.md`;
- that running the skill again carries on with the next batches.

Do not add candidates to `topics.yaml`. The owner decides which ones become topics. The `Phrases found` column holds the exact words from the papers, ready for a phrase list.

## Facts about the tool

- `bun run discover:topics` in `apps/pipeline`, with no command, does everything: it prepares when no batches exist, starts Haiku sessions of 40 batches each until every batch has passed, then writes the report. `--sessions <n>` runs several at once. A session started that way is told to stop after its batches and not to run the report.

- Work folder: `apps/pipeline/data/topic-discovery/`, ignored by git. `--work <folder>` on every command uses another one.
- `prepare` reads the newest list, parse and OCR snapshots, takes each current paper with a text, picks the OCR text when its scan matches the parse, and keeps only the link title and the first 15 headings. Papers with the same title and headings become one item with a count. Items seen in most councils come first, so early batches are worth the most.
- Texts are cached in `cache/headings.jsonl`, so a second `prepare` is fast. `prepare` refuses to run once batches are labelled.
- Two sessions can run at once. `next` claims a batch for 30 minutes.
- `report --least-councils <n>` changes the cut-off, 5 by default. `report.json` holds every candidate.
- Sizes on 14 November 2026: 182,536 linked papers, 98,761 with a text. A 400-paper sample gave 396 items, so a full run is about 1,900 batches of 50. A sample of 10,000 papers is 200 batches.
