# Spec: pipeline steps that run side by side

As of 13 November 2026. Status: draft, not built.

This spec goes with `pipeline-ovh-r2-migration-spec.md`, the move to one OVH instance per run. Section 4 says how the two fit together, and how the design grows to one computer per step.

## 1. The problem

Words used in this section:

- **Chain:** the steps in run order: `list`, `read`, `parse`, `ocr`, `topic`.
- **Snapshot:** one file per store that names every object in the store. A step writes it at the end of its run.
- **Due:** a thing is due when a step has work to do on it.

Today each step must finish before the next step starts. If a run stops early, the site gets no new pages. These are the causes, from the code.

1. **The Mac starts each step.** `tools/cloud/runChain.sh` starts one step, waits for it, then starts the next. If the terminal closes, no later step starts.
2. **The list step saves nothing until every council is listed.** `buildListStep.ts` lists all councils first (line 359) and saves them after that (line 369). A list run that stops early saves no event.
3. **Each later step looks for work one time only.** `read`, `parse`, `ocr` and `topic` find their due work at the start of the run. They do not look again. Work that arrives during the run waits for the next run.
4. **The snapshot is written at the end of a run only.** The site builds its pages from the newest snapshot of `list`, `parse`, `ocr` and `topic` (`apps/site/src/lib/readSnapshots.ts`). The site cannot see an object that is newer than the snapshot.

The result: the first new page gets to the site only after all five steps finish all of their work.

Two things in the code already help.

- A step reads an earlier store as "newest snapshot, plus a listing of the objects that changed". So a step can see objects that an earlier step wrote a moment ago.
- The run guard keeps two runs of the **same** step apart. It does not stop two **different** steps from running at the same time.

## 2. The design in one page

Words used in this section:

- **Round:** one pass of a step: look for due work, do a limited amount of it, write the snapshot.
- **Look:** a short check that a step makes for due work. A look does no work and writes nothing to the step's store.
- **Earlier step:** a step that comes before this one in the chain. For `parse`, the earlier steps are `list` and `read`.
- **Live:** a step is live when one of its runs is in progress.
- **Starter:** the part that starts a step. It is outside the pipeline code.

The steps run side by side, and documents move through the chain while the list step is still listing.

1. **The list step saves each council as soon as that council is listed.**
2. **A step does not start until it has a document to work on.** A step that looks and finds no work stops at once.
3. **A step that has started works in rounds.** A round takes a limited number of due things, newest meeting first, does the work, and writes the snapshot.
4. **A step that has started stays until the work is complete.** It stops when it finds no due work and no earlier step is live.
5. **The bucket is the only link between the steps.** A step learns about work from the stores. It learns that an earlier step is live from the guard markers. No step talks to another step, and no step needs the same computer as another step.
6. **The site needs no change.** Each round writes a snapshot, so a site build at any time shows all work that is complete to that point.

Rule 5 is what lets the design scale. The same pipeline code runs as five processes on one computer, or as five groups of computers.

## 3. The rules in the pipeline code

Words used in this section:

- **Marker:** the small file a run writes in `guard/v1/<step>/` to show that it is in progress. The run guard already writes it, writes it again each minute, and writes it one last time as done.
- **Share:** one part of a step's work when the step runs as many processes at once. `parse` and `ocr` use shares.
- **Process:** one running copy of the pipeline program.

These rules are the same at every size of the system.

### 3.1 List step

- The list step builds and saves a council's events inside that council's own work, not after all councils.
- It saves that council's failures at the same time.
- The archive rule does not change: a council whose document page failed archives nothing.
- The list step writes a snapshot each time `run.roundMaxItems` councils are saved, and one more at the end.

### 3.2 The loop

The loop lives in one place, `runSteps`. The steps do not hold the loop.

1. Take the run place from the guard, as today.
2. Run `readReadiness`. This is the look.
3. `StepNotReady`: log the problems and end, as today.
4. `StepReady`: run `runStep`. This is one round. The step has now started. Go to 2.
5. `StepHasNoWork`, and the step has **not** started: log `nothing to do` and end. The step did not start.
6. `StepHasNoWork`, the step **has** started, and an earlier step is live: wait `run.roundWaitInSeconds`, then go to 2.
7. `StepHasNoWork`, the step **has** started, and no earlier step is live: the step is complete.

Item 5 is the "no document, no start" rule. It is today's behaviour: no `Starting step` log line, no "step started" metric, nothing written to the store.

Item 6 keeps a started step alive between two pieces of work. Without it, a step on its own computer would stop and start again many times.

### 3.3 A round is limited

- A round takes at most `run.roundMaxItems` due things.
- It writes the snapshot at its end, as a run does today.

The order of the work in a round, by step:

| Step | Order today | Order in this spec |
| --- | --- | --- |
| `list` | Councils from A to Z. | No change. A meeting has no date before it is listed. |
| `read` | Council by council, many councils at once. The council with the most due documents starts first. | Councils as today. Inside each council, the newest meeting first. |
| `parse` | By document id. The id is a hash, so the order is random. Only documents that are parsed again go newest meeting first. | Newest meeting first for all documents. |
| `ocr` | By document id, so random. | Newest meeting first. |
| `topic` | By document id, so random. | Newest meeting first. |

- "Newest meeting" means the latest meeting date. A meeting in the future comes before a meeting in the past.
- A document that two meetings link takes the later date. A document with no date comes last.
- The read step is not put in one newest-first line for all councils. Each council's site has its own request limit, so the step is fastest when all councils work at the same time.

### 3.4 "Is an earlier step live?"

- The run guard gets one more method, `readLiveRun(stepName)`. It lists the markers of that step and applies the rule the guard already has: a marker written as done, or not written for `run.guardStaleInSeconds`, is not live.
- A step asks about every earlier step, not only the one before it.
- If an earlier step crashes, its marker goes stale after 10 minutes. Then the later steps finish their work and stop.

### 3.5 Shares

Today a run of many shares writes no snapshot, and a one-share run after it writes the snapshot. In the new design:

- Each process does rounds on its own share.
- The process with `shareIndex` 0 writes the snapshot at the end of each of its rounds. Before it writes, it reads the store again, so the snapshot includes the objects the other processes wrote.
- The snapshot can be a short time behind the other processes. This is safe: a reader always lists the store for objects newer than the snapshot.
- The one-share run after `parse` and `ocr` goes away.
- All share processes of one step in one run must have the same `shareCount`. The number is set when the step starts and does not change during the run.

## 4. The cloud solution, and how it scales

Words used in this section:

- **Instance:** one rented computer at OVH. Also called a VM.
- **Worker:** the small Cloudflare program from the migration spec. UptimeRobot calls it each 5 minutes. It can read the bucket and it can make and delete instances.
- **Run script:** `tools/cloud/runOnInstance.sh` from the migration spec. It runs on an instance and starts step processes with `docker run`.

The pipeline will move from Cloud Run to OVH. So this spec adds nothing to Google Cloud.

### 4.1 What is the same at every size

| Part | Why it scales |
| --- | --- |
| The pipeline image and code | One image. The step name and the share are given at the start. |
| The stores in the bucket | The only place where work is handed on. |
| The guard markers in the bucket | The only place that says which step is live. |
| The loop of section 3.2 | Uses only the stores and the markers. |
| The share rule | A share is a process. The process can be on any computer. |

No step reads a local file of another step, shares memory with another step, or calls another step. So a step can move to its own computer with no change to the pipeline code.

Only the starter changes with the size. The starter has one job: start a step when the step has a document to work on.

### 4.2 Size 1: one instance for the run

This is the migration spec, with one change. The run script does not run the steps "in order". It is the starter.

1. Start `list`.
2. For each later step, in chain order, repeat:
   - If the step has no process, and an earlier step still has one: start the step's process. It makes its look. With no document, it ends in a short time and the step has not started. Wait `LOOK_WAIT` seconds before the next try.
   - If the step has no process, and no earlier step has one: start the step one last time and wait for it to end.
3. When the last pass of the last step has ended, upload the logs and call `POST /done/<runId>`, as the migration spec says.

The last pass makes the result complete. It takes work that was left by a run that stopped early.

The instance has 8 processors and 32 GB of memory. In the migration spec each step gets the full instance in its turn. Side by side, the steps must share it. A first split, to measure and not a known good one:

| Step | Processes | Each process | Memory in total |
| --- | --- | --- | --- |
| `list` | 1 | `--cpus 1 --memory 4g` | 4 GB |
| `read` | 1 | `--cpus 1 --memory 4g` | 4 GB |
| `parse` | 4, shares 0 to 3 of 4 | `--cpus 1 --memory 3.5g` | 14 GB |
| `ocr` | 2, shares 0 to 1 of 2 | `--cpus 2 --memory 4g` | 8 GB |
| `topic` | 1 | `--cpus 1 --memory 1g` | 1 GB |

- The total is 31 GB of 32 GB. This is tight, and it is the limit of size 1.
- `parse` and `ocr` have half the processes they have in the migration spec.
- The migration spec also names a `join` step and an `index` step. They follow the same rules.

### 4.3 Size 2: one instance, or more, for each step

When one instance is too small, each step gets its own. The Worker becomes the starter. The pipeline code does not change.

**The run script** gets the step name from the Worker. It starts only that step's processes, waits for them, uploads the logs, and calls `POST /done/<runId>/<step>`.

**The Worker**, on each call, does this for each step:

1. If the step is live, do nothing. The markers show this.
2. If the step is not live, start an instance for it when one of these is true:
   - **New input.** The snapshot of a store the step reads is newer than the last time the step's newest marker was written. This means an earlier step made something after this step last looked.
   - **Work left.** The step's newest marker is not written as done. This means its last run stopped early.
3. Delete an instance when its step has called `/done`, or when it is too old.

The stores each step reads:

| Step | Reads the snapshot of |
| --- | --- |
| `read` | `list` |
| `parse` | `read` |
| `ocr` | `parse` |
| `topic` | `list`, `parse`, `ocr` |

The Worker needs only bucket listings for this. It runs no pipeline code. The migration spec already has the Worker read the guard markers.

**A step with shares** gets more than one instance, or one large instance with many processes. Each process gets its share index and the same share count. The Worker holds the number for each step.

**What grows with the load**

| Load grows in | What to add |
| --- | --- |
| Scanned pages | More `ocr` instances. |
| Documents to parse | More `parse` instances. |
| Councils | `list` and `read` have no shares today. They wait on the network, not the processor, so one process each goes a long way. A share rule by council is the next step if it is needed. |

### 4.4 What must be true now, so that size 2 needs no new pipeline code

1. A step learns that an earlier step is live from the markers, never from the processes on its own computer. This is section 3.4.
2. A started step waits for more work by itself. This is item 6 of section 3.2.
3. Share 0 writes the snapshot. No extra one-share run is needed, so no part has to know when all shares have ended.
4. Logs go to the bucket under the run id and the step, as the migration spec says.

All four are in the build order of section 8.

### 4.5 Before the move (Cloud Run)

- Nothing new is built for Cloud Run. `runChain.sh` stays as it is: one step after the other, started by hand.
- The pipeline code changes still help there. A list run that stops early keeps its saved councils, and each step writes snapshots during its work.

### 4.6 Other ways, not chosen

- *Start every step at the same moment and let it wait.* A step would run with no document to work on. At size 2 that is a paid instance with nothing to do.
- *A queue between the steps.* One more service to run and pay for. The stores already hand the work on.
- *A conductor that knows the full state of the run.* It would be one program that every step depends on. In this design the Worker can miss a call, or start a step that has no work, and the result is still correct.
- *Cloud Scheduler entries on Google.* Work on a platform that the move takes away.

## 5. New config

Words used in this section: none.

| Key | Meaning | First value |
| --- | --- | --- |
| `run.roundMaxItems` | The most due things one round takes. For `list`, the number of councils between snapshots. | 500 |
| `run.roundWaitInSeconds` | How long a started step waits before it looks again, when it found no work and an earlier step is live. | 60 |

Both keys go in both committed config files.

`LOOK_WAIT`, the time between two looks of a step that has not started, is a value at the top of the run script, 60 seconds at first. It is not pipeline config, because the pipeline code does not use it.

## 6. What changes, by file

Words used in this section: none.

| File | Change |
| --- | --- |
| `src/domain/buildListStep/buildListStep.ts` | Save each council when it is listed. Snapshot after each group of councils. |
| `src/domain/readCouncilListings/` | Hand each listed council to a save function as soon as it is ready. |
| `src/domain/runSteps/runSteps.ts` | The loop of section 3.2. |
| `src/infrastructure/createRunGuard/` | The `readLiveRun` method. |
| `src/domain/buildReadStep/`, `buildParseStep/`, `buildOcrStep/`, `buildTopicStep/` | Take at most `run.roundMaxItems` due things, in the order of section 3.3. |
| `src/infrastructure/createStoreSnapshots/`, the parse and OCR stores | Share 0 writes the snapshot after it reads the store again. |
| `src/infrastructure/createPipelineConfig/` and both config files | The two new keys. |
| `tools/cloud/runOnInstance.sh` (not written yet) | Size 1: the starter of section 4.2. |
| `tools/cloud/runChain.sh` | Remove the one-share runs, when item 4 of section 8 is done. |
| `AGENTS.md`, `README.md` | The new rules for the loop and for shares. |
| `docs/pipeline-ovh-r2-migration-spec.md` | The run script section and the table of processes. |

Size 2 changes only the Worker and the run script.

## 7. Limits and risks

Words used in this section: none.

1. **The instance is shared at size 1.** `parse` and `ocr` get half the processes of the migration spec. The first pages arrive much earlier, but the full run can take longer. The 8-hour limit of the migration spec must be measured again.
2. **A look has a cost.** At size 1, a process starts, takes its run place (a wait of 5 seconds), and reads the stores. On R2 each listing is a paid request.
3. **A false start at size 2.** A new snapshot does not prove that a later step has work. The Worker can start an instance whose step looks, finds nothing, and ends. The result is correct, but the instance start is paid for. OVH bills by the hour.
4. **A slow start at size 2.** The Worker is called each 5 minutes, and an instance needs 3 to 5 minutes to start. So a step can start up to 10 minutes after its first document is ready.
5. **More bucket listings.** Each round reads the earlier stores again. 500 for `run.roundMaxItems` is a first value to measure, not a known good value.
6. **Snapshot size.** Each round writes a full snapshot. With a very small round, the snapshot writes become a large part of the work.
7. **The site reads four snapshots at four moments.** A document can be in the list snapshot and not yet in the parse snapshot. The site must show that document as "not read yet", or leave it out. This needs a check in `buildNationalData.ts` before the build.
8. **Share 0 as the snapshot writer.** If process 0 crashes, no snapshot is written until it starts again. The data is safe. Only the site's view is late.
9. **The share count is fixed for a run.** More instances cannot join a step that is in progress. They can join at its next start.

## 8. Order of the build

Words used in this section: none.

Each item is safe to ship alone. Items 1 to 4 are pipeline code. They work on Cloud Run today, at size 1 and at size 2, with no change between them.

1. The list step saves each council as it is listed. This fixes the worst loss when a run stops early.
2. The loop in `runSteps`, with `readLiveRun`.
3. The round limit and the newest-first order in each step.
4. Share 0 writes the snapshot. The one-share runs go away.
5. Size 1: the run script as the starter. This is built with the migration, not before it.
6. Size 2: the Worker as the starter. This is built only when one instance is too small.

## 9. What is built

Words used in this section: none.

As of 13 November 2026, items 1 to 4 of section 8 are built in `apps/pipeline`. They are not committed and not deployed. The run script (section 4.2) and the Worker (section 4.3) are not built.

The code differs from the sections above in these points.

1. **One more stop rule in the loop.** `StepReady` now carries the ids that the round would take. If a look would take the same ids as the last round, those things were tried and are still due. The step does not try them again: it waits and looks again while an earlier step is live, and stops with a warning when none is. Without this rule, a thing that stays due could hold a step in a loop. Examples of such a thing: a document of a council that is no longer in `sources.yaml`, or a record that the bucket refuses to save.
1a. **One more look at the end.** When no earlier step is live, the step looks one more time before it stops. This look finds what the earlier step wrote as it ended.
1b. **One try per run.** A thing that failed in a run is not due again in that run. Before rounds, a step looked one time per run, so this was always true. With rounds it needs a rule, or a failure could use all its tries in one long run.
2. **Share 0 does not read the store again before it writes the snapshot.** Its snapshot holds what it saw at its last look, plus its own work. So the snapshot can lack the newest objects of the other shares. A reader of the store is still correct, because it lists the store. The site is a short time behind.
3. **The one-share run after `parse` and `ocr` stays.** It writes the full snapshot when all shares have ended. `runChain.sh` is not changed. The run script of section 4.2 must do the same, or share 0 must wait for the other shares.
4. **A one-share `parse` or `ocr` run still starts with nothing due.** This is the run of point 3. It is the one case where a step starts with no document.
5. **The parse step keeps its choice of documents to parse again.** It chooses them at its first look, up to `parse.redoShare`, and does not choose more in later rounds.
6. **The read step counts the round limit for each council.** A round takes at most `run.roundMaxItems` documents from each council, so every council is still read at the same time. Only a council with a long backlog is cut. A limit for the full round would give each council 1 or 2 documents, and then the step would write its snapshot and list the stores again some hundreds of times in a large run.
7. **The list step saves one council at a time.** Up to `councils.councilsAtOnce` councils are listed at the same time, but their saves go one after the other. The first cloud run on 13 November 2026 showed that this made the step slow: it took about 70 minutes to reach the councils that the old code reached in about 26 minutes. Two causes were fixed after that run. The list store read and checked all of its records again for each save, and now it does that one time and keeps the result. A council kept its place in the listing group while it waited for its save, and now it gives the place back first.
8. **The list step counts saved records, not councils.** It writes a snapshot each time it has saved `run.roundMaxItems` records. There are fewer than 500 councils, so a count of councils would never write a snapshot during a run.

A separate agent reviewed the code as a staff engineer. Its findings that were fixed are points 1, 1a, 1b, 6 and 8, and one race in the snapshot save. Its findings that are left open are in section 7 and here:

- The topic step and the parse step write a full snapshot and list their stores again for each round of 500 documents. In a large backlog this can be a large part of the run. The value of `run.roundMaxItems` must be measured.
- The OCR step now reads the list store, to know the meeting dates. Each OCR task uses more memory and makes more listings than before.
- A waiting step lists every store it reads again each 60 seconds.
- A step that hangs but still writes its marker keeps the later steps alive until the task timeout.

## 10. Decisions for the owner

Words used in this section: none.

1. Is the order table in section 3.3 correct? It keeps the read step council by council, and it puts a future meeting before a past one.
2. Is 500 a good first value for `run.roundMaxItems`?
3. Is the first split of the instance in section 4.2 acceptable as a start: 4 `parse` processes and 2 `ocr` processes?
4. At size 2, is a false start now and then acceptable? The other way is a small instance that is always on and makes the looks, which costs money at all times.
