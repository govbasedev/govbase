# Bundle parsing and the council manifest

As of 4 October 2026. Terms follow [CONTEXT.md](CONTEXT.md).

Parse each text once into small numbered blocks. Make the per-council manifest an index of those blocks, with no text in it. Then let code choose which blocks go into each state, under a set token budget.

## Why: the token limit and context rot

Jev's limits, from TypeSafe's models page:

| Constraint | Value |
| --- | --- |
| Total context per request | 64,000 tokens: the state plus all questions combined |
| Per-question budget | 32,000 tokens: the state plus the single longest question |
| Input types | Text only: a string, a JSON object, or an array of text values |
| Language | English is best. Other languages are accepted, but with lower accuracy. |

- The per-question budget is the one that binds a state. A state can never be larger than 32,000 tokens minus the longest question asked with it.
- The total budget limits how many questions share one state. The state counts once, and every question adds its own tokens.
- 22 councils in `sources.yaml` are Welsh. Welsh text may be judged less accurately, so record the language of each block when it is not English.
- TypeSafe's guidance: "Include only the context relevant to the current questions. This helps the model avoid distractions and context rot." ([building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md)). So stay far below the limit, not just under it.

## What the data shows

Run `apps/pipeline/data/bundles/2026-10-03T16-42-57-274Z`. Tokens are estimated at 4 characters per token. Replace the estimate with the real `usage.input_tokens` once requests run.

| Measure | Value | What it means |
| --- | --- | --- |
| Item state without documents, 1 in 100 | about 3,000 tokens | Agenda text and minutes almost always fit |
| Longest minutes text | about 15,000 tokens | Fits, but it is the tail that rots context |
| Document, middle | about 2,400 tokens | |
| Documents over 8,000 tokens | 1,815 of 11,013 | Never send a whole document |
| Documents over 32,000 tokens | 261 | They break the per-question budget on their own |
| Longest document | about 349,000 tokens | |
| Text per council, middle / largest | about 200,000 / 1,560,000 tokens | A council is never one state |
| Documents that mention "recommendation" | 5,490 (50%) | Code can find the key section |
| Middle position of the first "recommendation" | character 1,405 | It often falls just past a 1,500-character opening |
| Openings (first 1,500 characters) with contact details | 1,687 (15%) | Openings carry names, emails and phone numbers: bloat and personal data |

The problem is the documents, not the item. A blind "first 1,500 characters" opening often sends a cover page or a contact block, and misses the recommendation by a few hundred characters.

## How to parse: once, in code, at ingest

1. **Clean up the text.** Decode HTML entities. Keep line breaks. Join the broken lines of each paragraph.
2. **Split into blocks.** One block is a line or a paragraph. Each block gets a stable ID inside its text: `B0001`, `B0002`, and so on. This is the line-ID pattern from TypeSafe's [semantic find](https://docs.typesafe.ai/cookbooks/semantic_find.md) and [structure recovery](https://docs.typesafe.ai/cookbooks/autoformat.md) cookbooks.
3. **Tag each block with code rules, not with the model:**
    - `heading`: short, no full stop, often numbered.
    - `boilerplate`: page numbers, and lines that repeat 3 or more times in the document.
    - `contact`: email addresses, phone numbers, "Contact officer".
    - `recommendation`: under a heading such as "Recommendation(s)" or "Decision required".
    - `summary`: under a heading such as "Purpose of report" or "Executive summary".
4. **Store the token estimate** for every block, so the state builder can add blocks up to a budget without reading any text.
5. **Use Jev for structure only where code fails.** The structure-recovery questions (is this a heading, does this line continue a sentence) run only on documents whose headings code cannot find, and only when a recipe needs those sections.

## State budgets for each recipe

| Recipe | What is sent | State budget |
| --- | --- | --- |
| Step 1 (every item) | Title, agenda text, document titles. If there is no agenda text, the first body block of the first document. | 1,500 tokens |
| Step 2 (about 1% of items) | Step 1, plus each document's `summary` and `recommendation` blocks. Fall back to the first body blocks, never `boilerplate` or `contact`. Up to 3 documents. | 4,000 tokens |
| Minutes stage | Title and minutes blocks | 6,000 tokens. Over that, split into windows of blocks. |
| Decision spans | Minutes blocks, each with its block ID | 6,000 tokens per window |
| Any request | State plus questions | State plus the longest question: hard stop at 24,000, leaving room under the 32,000 per-question budget. State plus all questions: hard stop at 56,000, leaving room under the 64,000 total. Never cut text silently: split into windows, and record the split. |

When a state is over its budget, the recipe chooses whole blocks. It never cuts in the middle of a block. The state records which block IDs were sent, so "why was this judged this way?" points to exact text.

## The council manifest

The manifest is a table of contents, not a store of text. It holds IDs, hashes, sizes, dates and block tags. The largest council has 262 documents, so its manifest is a few hundred KB, not 6 MB. The state builder can plan every state from the manifest alone.

```json
{
  "schemaVersion": 2,
  "run": { "name": "2026-10-03T16-42-57-274Z", "startedAtUnixMs": 1791045777284, "finishedAtUnixMs": 1791045863989 },
  "council": { "sourceId": "uk-council-teignbridge", "name": "Teignbridge", "licence": "OGL-3.0" },
  "tagging": { "parser": "blocks-v1", "ruleSetId": "tags-v1", "ruleSetHash": "sha256:…" },
  "problems": [],
  "bundleFile": "meetings.ndjson.gz",
  "meetings": [
    {
      "meetingId": "1234",
      "date": "2026-10-06",
      "statusWord": "Confirmed",
      "statusText": "Confirmed",
      "committee": { "title": "Executive" },
      "sourceUrl": "https://…/ieListDocuments.aspx?MId=1234",
      "items": [
        {
          "itemKey": "uk-council-teignbridge/1234/5678",
          "agendaItemId": "5678",
          "number": "7",
          "title": "Local Government Reorganisation (LGR) costs",
          "isRestricted": false,
          "evidenceHash": "sha256:…",
          "agenda": {
            "textHash": "sha256:…", "tokens": 180, "blockCount": 3,
            "sections": [], "excludedBlocks": { "boilerplate": 0, "contact": 1 }
          },
          "minutes": null,
          "documents": [
            {
              "documentId": "17516",
              "title": "Report",
              "url": "https://…/document.pdf",
              "publishedOn": "2026-09-28",
              "isRead": true,
              "unreadReason": null,
              "text": {
                "textHash": "sha256:…",
                "tokens": 9400,
                "blockCount": 212,
                "sections": [
                  { "tag": "summary", "fromBlock": "B0004", "toBlock": "B0009", "tokens": 310 },
                  { "tag": "recommendation", "fromBlock": "B0010", "toBlock": "B0013", "tokens": 140 }
                ],
                "excludedBlocks": { "boilerplate": 31, "contact": 6 }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

The text lives apart from the manifest, in one file per text hash. The same text is stored once, however many runs see it. Between the two runs of 3 October 2026, 99% of items had the same evidence.

```json
{
  "textHash": "sha256:…",
  "parser": "blocks-v1",
  "blocks": [
    { "id": "B0001", "tokens": 6, "text": "Teignbridge District Council" },
    { "id": "B0004", "tokens": 4, "text": "1. Purpose of the report" },
    { "id": "B0010", "tokens": 42, "text": "That the Executive …" }
  ]
}
```

### Why this shape

- **No text in the manifest.** States can be planned, budgets checked and evidence hashes computed without loading text. Text is read only for the blocks a state uses.
- **Content-addressed text.** A text file is named by the hash of its content. Block IDs stay stable while that text exists, so a label or quote that points to `B0010` never moves.
- **The parser has a version.** A better splitter is a new parser version. Old states still point to the exact blocks they were built from.
- **Tags live apart from the text.** The text file holds only blocks. Tags come from a tag-rule set in `config/tagging.yaml`, which changes with experiments. The manifest records which rule set made its sections, and the state builder tags the stored blocks again for each experiment. So a new tag rule never rewrites a text file.
- **Tags are facts, not judgments.** `contact` and `boilerplate` are code rules, kept out of states by the recipe. Privacy rule 5 and the context budget are enforced in one place.
- **`statusWord` sits beside `statusText`.** The raw status is kept as published (privacy rule 1). Only `statusWord` is ever sent, because the raw status can hold names and addresses.

## Measure early

- **The real token ratio.** Send 20 real states, and compare `usage.input_tokens` with the estimate.
- **Question cost.** With small states, the question text can cost more than the state. Measure each question once per question-set version: the longest one sets the per-question budget, and their sum counts against the total.
- **Recall from block selection.** Gate 1, check 5 in [evaluation-plan.md](evaluation-plan.md) (short state against full state) tests this selection rule directly.
