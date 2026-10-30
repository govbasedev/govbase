# A topic index for the topics app

As of 30 October 2026.

## The question

The owner is building an app that shows topics. A user picks a topic, sees the meetings that covered it, and reads the meeting's markdown, the file the join step builds. The topic store counts mentions per document, not per meeting, and names no meeting, because one document can be linked by two meetings. The join store has the markdown per meeting. The app needs a way from a topic to the meetings that mention it, and from a meeting to its markdown, without a database.

## What the stores already give

The link from a meeting to its counts exists, but not in the shape the app reads.

| Store | Record | Field |
| --- | --- | --- |
| list | `list/v3/events/data/<eventId>.json` | the meeting's `sourceId`, `title`, `date` |
| join | `join/v2/events/data/<eventId>.json` | `textKeys`, the texts in the markdown, and `fileKey` |
| topic | `topic/v2/documents/data/<documentId>.json` | `textKey` and `mentions` by zone |

A join record names the texts that went into its markdown. A topic record names the text it counted. So the counts of a meeting are the topic records whose `textKey` is in the join record's `textKeys`, and they always match the markdown the user will read. A document in two meetings is in both `textKeys` lists, so it counts for both. A document the join left out as a copy is in neither.

## Ways to give the app its shape

### 1. Put the topics on the join record

The join step would write the topic counts into its own record.

- Pros: one record per meeting with everything in it.
- Cons: the join step runs before the topic step, so it cannot know the counts; the topic step must not write into the join store, because each step owns one store and writes nowhere else; and the app still has no way from a topic to its meetings without reading every join record.

### 2. A per-meeting record in the topic store

The topic step would also write `topic/v2/events/data/<eventId>.json` with the counts of the meeting added up.

- Pros: no new step; the topic step already reads the list store.
- Cons: the app goes from a topic to its meetings only by scanning every meeting record, so the scan sits in the app; the topic step would own two kinds of record and two due rules.

### 3. The app joins three stores at read time

The app reads the newest snapshot of the list, join and topic stores and builds the view in memory.

- Pros: no pipeline change.
- Cons: the app holds pipeline rules, such as which link is current and which text the join used; every app start reads three whole stores; a second app does the same work again.

### 4. A new step with its own store (chosen)

An `index` step, after `topic`, reads the list, join and topic stores and writes one record per topic that lists the meetings which mention it.

- Pros: one small object per click; the rule of what a meeting's counts are lives in one place; fits the rule that each step owns one store; a later threshold for "covered the topic" has a home.
- Cons: one more step, store and job; a record for a broad topic such as roads can grow to thousands of meetings.

## What was decided

- A new step, `index`, in the chain after `topic` and before `plan`. It owns `index/v1/`.
- One record per topic in `config/topics.yaml`, at `index/v1/topics/data/<topicId>.json`:

```
{
  id: "roads",
  name: "Roads",
  inputsHash: "...",
  events: [
    {
      eventId: "...",
      sourceId: "...",
      title: "Cabinet, 14 October 2026",
      date: "2026-10-14",
      mentions: { title: 1, headings: 3, body: 12 }
    }
  ],
  history: [{ event: "indexed", runId: "...", inputsHash: "..." }]
}
```

- A failed save is an error object at `index/v1/topics/errors/<topicId>.json` with class `unsaved`.
- The meetings sort newest first, then by meeting id. A meeting is listed when any zone count is above zero. A topic with no meeting still has a record, with an empty list.
- The record never holds the join `fileKey`. The key changes when the join inputs change, so a copy would go stale between runs. The app reads the join record at click time instead.
- Config: `index.topicsAtOnce` (8), how many records are written at once.

## How the step works

1. Read the current meetings from the list store, the join records, the topic records and its own records.
2. For each current meeting, take its join record. Find the topic record of every text key in it. A meeting with no join record, or with a text key that has no topic record yet, waits for the next run, and the report counts it as waiting.
3. For each topic in the file, add up the `title`, `headings` and `body` counts of each meeting's texts. A topic record counted for an older topics file has no count for a new topic, and counts as no mention until the topic step counts the text again.
4. Hash the topic's id and name with each listed meeting's id, source id, title, date and the `inputsHash` of each of its topic records. The topic is due when its record has no `indexed` entry with that hash. So a new meeting, a changed title or date, a new count or a new phrase writes the record again, and a run where nothing changed writes nothing.
5. Write the due records, `index.topicsAtOnce` at once, then the snapshot. Log `Index report:` with the topics indexed, unsaved and up to date, and the meetings used and waiting.

The file is checked before the step runs, as the topic step checks it. A bad file stops the chain with `StepNotReady`. `govbase_pipeline_indexed_topics` counts the topics by outcome.

## How the app reads it

1. Read `index/v1/topics/data/<topicId>.json` to list the meetings.
2. On a click, read `join/v2/events/data/<eventId>.json` for the current `fileKey`.
3. Read the markdown at that key.

The list of topics itself comes from `config/topics.yaml`, or from a listing of the `index/v1/topics/data/` prefix.

## What is built

The store, `src/infrastructure/createIndexStore/`, and the step, `src/domain/buildIndexStep/`, with their tests. The step is in `allSteps`, in `run.steps` of both committed config files, in `bun run dev:run`, in `bun run dev:step:index` and in the cloud chain script. The pipeline README has a **Topic index** section and the store table rows. All checks pass.

## What is left

- Commit the change in `apps/pipeline` and deploy the image before `bun run cloud:run` reaches the new step, or the job fails on an unknown step name.
- A rule for "covered the topic". Today one body mention lists the meeting. If the app needs a stronger rule, such as a heading hit or a least count, it is an `index` config value, not an app rule.
- A broad topic can grow a large record over time. If that becomes a problem, split the record by year or by council, under the same prefix.
- The topics app itself, which reads the three objects above.
