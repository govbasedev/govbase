# Plan: build the bundle parsing design in the pipeline

As of 4 October 2026. Terms follow [CONTEXT.md](CONTEXT.md). This plan builds the design in [bundle-parsing-and-manifest.md](bundle-parsing-and-manifest.md) in `apps/pipeline`.

Status: steps 1 to 7 are built. See "What was built differently" at the end.

## The goal

Every choice about what we send to Jev lives in config files, not in code. To run an experiment, you add or change a named entry in a config file, then run the pipeline again. You do not change code.

An **experiment** is a named set of choices:

- how blocks are tagged (tag rules),
- which blocks go into each state, and the token limits (recipes),
- which questions are asked (question sets),
- which model is used.

## Rules for the design

1. **Code owns the method. Config owns the numbers and the choices.** Code knows how to split, tag, choose and slice blocks. Config says how many, which tags, which order, and which limits.
2. **IDs are names. Hashes are the truth.** Every tag-rule set, recipe and question set has a hash of its decoded content. The hash is stored with every state and every judgment. If you edit an entry and keep its ID, the store sees a new hash and refuses the run, so old results never mix with new ones. To change an entry, give it a new ID.
3. **Privacy rules cannot be turned off in config.** Code always removes private-case items, `contact` blocks and `statusText`. The config schema has no field that can select them. An experiment can send less, never more than the privacy rules allow.
4. **An experiment never fetches from councils again.** Experiments run over the text already stored. Only the `read` step talks to councils.
5. **Plan before you spend.** A dry run builds every state and writes a budget report, with no call to Jev. Turn on sending only when the report looks right.

The house-style lint already pushes the design this way: `house-style/value-lives-in-config` fails on any number in `src/` other than 0 and 1. So every limit, count and size in this plan must be config.

## Where each choice lives

| File | What it holds | Same in every environment? |
| --- | --- | --- |
| `config/<env>/config.yaml` | Paths, the token ratio, Jev's address, model, key and limits, which experiments to run, which steps to run, and whether to send | No |
| `config/tagging.yaml` | Named tag-rule sets: phrases and counts that tag blocks | Yes |
| `config/recipes.yaml` | Named recipe sets: what each state holds, in what order, and its token limit | Yes |
| `config/questions.yaml` | Named question sets, built from the issue register | Yes |
| `config/experiments.yaml` | Named experiments, each joining one tag-rule set, one recipe set, one question set and one model | Yes |
| `config/issues.yaml` | The issue register (already exists, not yet committed) | Yes |

The four new files sit beside `sources.yaml` and `issues.yaml`. `index.ts` imports them as YAML, in the same way as `sources.yaml`. A domain reader checks each one, in the same way as `readIssueRegister`. The run fails before any work starts when a file has problems.

To choose an experiment without editing a file, use `PIPELINE_CONFIG`:

```sh
PIPELINE_CONFIG='{judging: {experimentIds: [short-state]}}' bun run start
```

Run two experiments over the same items with `experimentIds: [baseline, short-state]`. Gate 1, check 5 (short state against full state) needs this.

### `config/<env>/config.yaml`: new parts

```yaml
run:
  steps: [read, plan]
tokens:
  charactersPerToken: 4
texts:
  path: data/texts
judging:
  path: data/judgments.sqlite
  experimentIds: [baseline]
  shouldSend: false
jev:
  url: https://api.typesafe.ai/v1/systemone
  model: jev-latest
  apiKey: null
  stateAndLongestQuestionLimitTokens: 24000
  stateAndAllQuestionsLimitTokens: 56000
  requestsAtOnce: 5
```

- `run.steps` chooses the steps: `read` (fetch, parse and save), `plan` (build states and the budget report), and `send` (ask Jev and store judgments). An experiment over stored text runs `[plan]`, then `[plan, send]`.
- `charactersPerToken` stays at 4 until real `usage.input_tokens` replaces it. See "Measure early" in the design.
- `apiKey` is `Schema.Redacted`, and `null` in every committed file. It reaches production through `PIPELINE_CONFIG`.
- The two Jev limits are the hard stops from the design: 24,000 under the 32,000 per-question budget, and 56,000 under the 64,000 total. The recipe reader checks that no recipe limit is above them.
- `shouldSend: false` is the default in every committed file, so no run spends money by accident.

### `config/tagging.yaml`

```yaml
tagRuleSets:
  - id: tags-v1
    headingMostWords: 12
    boilerplateLeastRepeats: 3
    sectionHeadings:
      recommendation: [recommendation, recommendations, decision required, recommended decision]
      summary: [purpose of report, purpose of the report, executive summary, summary]
    contactPhrases: [contact officer, report author, contact details]
    languageMarkers:
      cy: [cyngor, pwyllgor, cyfarfod, adroddiad, argymhelliad]
    languageLeastMarkers: 2
```

- Code always finds email addresses and phone numbers, and always tags them `contact`. Config can add phrases, but cannot remove that check.
- `languageMarkers` marks a block as Welsh (`cy`) when it holds at least `languageLeastMarkers` marker words. This follows the Welsh-language note in the design.

### `config/recipes.yaml`

```yaml
recipeSets:
  - id: baseline
    recipes:
      - id: agenda-step-1
        stage: agenda
        stateLimitTokens: 1500
        meetingFields: [council, committee, meetingDate, statusWord]
        parts:
          - source: itemTitle
          - source: agendaText
            skipTags: [boilerplate]
          - source: documentTitles
            mostDocuments: 10
          - source: documentBody
            onlyWhenEmpty: agendaText
            mostDocuments: 1
            takeTags: [summary, recommendation, body]
            mostBlocks: 1
        overLimit: dropLastParts
        showBlockIds: false

      - id: agenda-step-2
        stage: agenda
        stateLimitTokens: 4000
        meetingFields: [council, committee, meetingDate, statusWord]
        parts:
          - source: itemTitle
          - source: agendaText
            skipTags: [boilerplate]
          - source: documentTitles
            mostDocuments: 10
          - source: documentBody
            mostDocuments: 3
            takeTags: [summary, recommendation]
            fallbackTags: [body]
            partLimitTokens: 800
        overLimit: dropLastParts
        showBlockIds: false

      - id: minutes
        stage: minutes
        stateLimitTokens: 6000
        meetingFields: [council, committee, meetingDate]
        parts:
          - source: itemTitle
          - source: minutesText
            skipTags: [boilerplate]
        overLimit: slices
        sliceOverlapBlocks: 2
        showBlockIds: false

      - id: decision-spans
        stage: minutes
        stateLimitTokens: 6000
        meetingFields: [council, committee, meetingDate]
        parts:
          - source: itemTitle
          - source: minutesText
        overLimit: slices
        sliceOverlapBlocks: 2
        showBlockIds: true
```

What each field means:

| Field | Meaning |
| --- | --- |
| `stage` | `agenda` or `minutes`. Decides which item versions the recipe runs on. |
| `stateLimitTokens` | The most tokens the state may hold. |
| `meetingFields` | Facts about the meeting to put in the state. Only `council`, `committee`, `meetingDate` and `statusWord` exist. `statusText` is not a choice. |
| `parts` | What goes into the state, in order. The order is also the priority: when the state is too big, the last parts go first. |
| `source` | `itemTitle`, `agendaText`, `minutesText`, `documentTitles` or `documentBody`. |
| `takeTags`, `skipTags`, `fallbackTags` | Which block tags to take or skip. `fallbackTags` are used only when `takeTags` finds nothing. `contact` is not an allowed value. |
| `onlyWhenEmpty` | Use this part only when the named source has no blocks. |
| `mostDocuments`, `mostBlocks`, `partLimitTokens` | Limits for one part. |
| `skipLanguages` | Optional. Leave out blocks in these languages, such as `[cy]`. |
| `overLimit` | What to do when the state is too big: `dropLastParts`, `slices` (split into several states of whole blocks), or `skip` (send nothing, and record why). Text is never cut inside a block. |
| `sliceOverlapBlocks` | How many blocks each slice repeats from the slice before it, so a decision group is not split. |
| `showBlockIds` | Put the block ID before each block, as in the line-ID pattern. Decision spans need this. |

The design calls a split state a "window". In code it is a **slice**, because `window` is in the lint's `timingWords` and a name ending in it must have a time unit.

### `config/experiments.yaml`

```yaml
experiments:
  - id: baseline
    tagRules: tags-v1
    recipes: baseline
    questions: issues-v1
    model: jev-latest
  - id: short-state
    tagRules: tags-v1
    recipes: short-state
    questions: issues-v1
    model: jev-latest
```

The reader checks that each name points to an entry that exists.

### `config/questions.yaml`

This file is needed only for the `send` step. It is listed here because its size counts against the request limits. Each question set holds question templates. A template fills in an issue's `name`, `definition` and `excludes` from the issue register, so changing a definition makes a new question hash. The exact questions come from [evaluation-plan.md](evaluation-plan.md), "Judgments".

## Changes to the design document

Two small changes make the design work with config. They are now in [bundle-parsing-and-manifest.md](bundle-parsing-and-manifest.md).

1. **Tags move out of the text file.** The text file holds only `id`, `tokens`, `language` and `text`. Splitting rarely changes. Tag rules change with experiments. If tags lived in the text file, every new tag rule would rewrite every text file.
2. **The manifest records which tag rules made its sections.** Each document's `sections` and `excludedBlocks` sit under `tagging: { "ruleSetId": "tags-v1", "ruleSetHash": "sha256:…" }`. The `plan` step uses the manifest's sections when the hash matches the experiment. When it does not match, it tags the stored blocks again. This is fast, because it is only code.

## Modules

Each module follows the app's rules: one maker per folder, a `.types.ts` file, a `.schema.ts` file, and a mirrored test. All names use verbs that are already in `presentVerbs`, so no new verb needs permission.

| Module | Layer | Job |
| --- | --- | --- |
| `readTaggingFile` | domain | Check `tagging.yaml` |
| `readRecipeFile` | domain | Check `recipes.yaml`, including that no limit is above Jev's limits |
| `readQuestionFile` | domain | Check `questions.yaml` against the issue register |
| `readExperimentFile` | domain | Check `experiments.yaml` and that every reference exists |
| `buildBlocks` | domain | Turn text lines into blocks with IDs and token estimates. Parser version `blocks-v1`. |
| `buildBlockTags` | domain | Tag blocks with one tag-rule set |
| `createTextStore` | infrastructure | Hash a text, and save or read it by hash, as gzipped JSON |
| `createBundleStore` (changed) | infrastructure | Write the version 2 manifest, and read only the latest manifest for each council |
| `buildState` | domain | Build the states for one item version from one recipe |
| `buildBudgetReport` | domain | Sum states per recipe: counts, token spread, slices, dropped parts and skips |
| `createTypeSafeClient` | infrastructure | Send one request to Jev, and return its answers and `usage` |
| `createJudgmentStore` | infrastructure | Store states and judgments in SQLite (`bun:sqlite`), keyed as in [ADR 0001](adr/0001-raw-judgments-keyed-by-item-version.md) |

Hashing calls `Bun.CryptoHasher`, so it lives in infrastructure. Domain code gets hashes through the `TextStore` service.

## What the store records

Every state row holds:

- the item key and the evidence hash,
- the experiment ID,
- the parser version, and the tag-rule set's ID and hash,
- the recipe set ID, the recipe ID and the recipe hash,
- the slice number and the number of slices,
- the block IDs sent, and the parts dropped or skipped, with the reason,
- the estimated tokens.

Every judgment row adds:

- the question set ID and hash, and the question ID,
- the model asked and the model that answered,
- the raw answer, and `usage.input_tokens` and `usage.output_tokens`.

A state with the same key is never built or sent twice. This is "judge once" from the evaluation plan, applied to each experiment.

With this record, "why was this judged this way?" leads to the exact blocks and rules. Two experiments can be compared item by item.

## Steps

Each step is one branch in `apps/pipeline`. Each one is test-first and ends with `make check` passing.

| Step | Work | Depends on |
| --- | --- | --- |
| 1 | Pipeline changes for the evaluation: keep line breaks, decode entities, store `isRestricted`. Meeting records move to `schemaVersion: 2`. | — |
| 2 | New config parts in the config schema, with one `Context.Tag` each, in every committed config file. The four readers, and their checks in `runPipeline`. | 1 |
| 3 | `buildBlocks` and `buildBlockTags`, tested with written example texts. Fixtures hold no real personal data. | 2 |
| 4 | `createTextStore`, then the version 2 manifest in `createBundleStore`. Pipeline change 5 (read only the latest manifest) comes with it. Keep writing `meetings.ndjson.gz` until a test run shows that the manifest and the text store hold the same text. Then stop writing it. | 3 |
| 5 | `buildState` for all four recipes, with slices and dropped parts. | 4 |
| 6 | The `plan` step and `buildBudgetReport`, as a dry run over the latest run. Compare its numbers with "What the data shows" in the design. | 5 |
| 7 | `createTypeSafeClient`, `createJudgmentStore`, `questions.yaml` and the `send` step. Send 20 states, then set `charactersPerToken` from the real `usage.input_tokens`. | 6, and gate 0 |

Gate 0 in the evaluation plan comes before step 7: the Data Processing Agreement, and proof in code that no private-case item is sent.

## How to run an experiment

1. Add a new recipe set to `recipes.yaml`, such as `short-state`, with a new ID.
2. Add an experiment to `experiments.yaml` that uses it.
3. Run `[plan]` with `experimentIds: [baseline, short-state]`, and read the budget report.
4. Run `[plan, send]` with `shouldSend: true`.
5. Compare the judgments of the two experiments against the labels.

## Open decisions

- **Where judging lives.** Decided: `apps/pipeline`, chosen with `run.steps`. Two reasons: the workspace forbids shared code between apps, and the manifest schema would otherwise be copied into a second app.
- **"Experiment" as a glossary term.** It is not in [CONTEXT.md](CONTEXT.md). Add it if the word is used outside this plan.
- **Welsh text.** Is a Welsh block sent, or left out with `skipLanguages`? The config allows both. The baseline sends it, so the evaluation can measure the loss.

## What was built differently

| Plan | Built | Why |
| --- | --- | --- |
| Four readers, one per file | One reader, `readJudgingFiles`, checks all four files together | The layer rules forbid one domain module from calling another. One reader can also check references between the files. |
| `buildBudgetReport` as its own module | The report is part of `runJudging` | The same layer rule. The report is a few log lines per recipe. |
| Not in the plan | `onlyWhen` on a recipe: `{ recipe, question, leastNoul }` | Step 2 must run only on items where step 1 passed. Without it, the plan step builds step 2 for every item. |
| `language` in the text file | `language` is worked out with the tags | The language markers are in `tagging.yaml`, so language changes with the tag rules. |
| `tagging` on each document | `tagging` once, at the top of the manifest | One council is tagged with one rule set. |
| `partLimitTokens` limits one part | For `documentBody`, it limits each document | Each document then keeps its own summary and recommendation. |
| `short-state` experiment | `full-state` experiment | `baseline` is already the short state. Gate 1, check 5 compares it with `full-state`. |
| The domain sets `schemaVersion` | The bundle store sets it when it saves | The lint allows no number other than 0 and 1 in `src/`. |

Other facts about the build:

- Private-case items are found from the committee title and the item title, with patterns in the code of `buildItemStates`. They are not config, so privacy rule 5 cannot be turned off. Restricted items are never sent either.
- A run reads only the newest version 2 bundle of each council. Version 1 bundles are ignored, so the first run after this change fetches every document again.
- `data/judgments.sqlite` holds the states and judgments. `data/texts/blocks-v1/` holds one gzipped file per text hash.
- `config/local/config.yaml` is not in git. It needs the new parts too, copied from `config.example.yaml`.
