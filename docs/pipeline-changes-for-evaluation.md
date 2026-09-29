# Pipeline changes for the evaluation plan

As of 4 October 2026. Terms follow [CONTEXT.md](CONTEXT.md). This lists what `apps/pipeline` must still change before the proof of concept in [evaluation-plan.md](evaluation-plan.md) can start. Facts come from the code and from the run `data/bundles/2026-10-03T16-42-57-274Z`.

The other changes on the first version of this list are built. See [bundle-parsing-implementation-plan.md](bundle-parsing-implementation-plan.md).

## Must change

### 1. Re-read recent meetings that have no minutes yet

- When the RSS feed fails, meetings are listed by meeting date, ±`queryWindowInDays` (`readListedMeetings` and `readCouncilFrom` in `src/domain/readModernGovCouncil/readModernGovCouncil.ts`).
- Minutes usually arrive weeks after the meeting, outside that window, so the meeting is never read again.
- For those councils there are no minutes-stage item versions, and gate 2b loses them.
- Fix: also re-read meetings from the last N weeks that have an agenda but no minutes. N is a new config value, so it needs a line in every committed config file.

## Should change

### 2. Accept that withdrawals are only partly visible

- Each run is a snapshot of a window, so an item missing from a run means nothing by itself.
- A withdrawal shows only when a meeting is read again, which happens only when new material is published for it.
- This is a limit of the source, not a bug. It is listed in the plan's known gaps.

## Already fits

| Need | What the pipeline has |
| --- | --- |
| Stable item keys | `sourceId/meetingId/agendaItemId` |
| Agenda item as the unit | Minutes are stored per item |
| Rebuilt item versions | Every document has `publishedOn`: 0 missing, 152 published after the meeting |
| First seen | The run folder name and the manifest's `run.startedAtUnixMs`, while local bundles are kept |
| Private-case filter input | Committee title and item title |
| Failed councils | The manifest `problems` list, so a failed council is not read as withdrawn |
