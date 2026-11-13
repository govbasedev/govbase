# Starting pipeline steps when there is work

As of 30 October 2026.

## The question

Today the chain runs from one script on the Mac, step after step, and a step runs only when something starts it. The owner wants the list step on a schedule, and every other step to run only when the step before it made new work. The answer must work on any cloud provider, or sit behind a port so the provider part can be swapped.

## Ways to start a step

### 1. Every step on its own timer

Each step runs every few minutes, looks at its store, and stops at once when there is no work.

- Pros: simple; no trigger to set up; a run that finds no work costs one listing; works on any provider.
- Cons: work waits up to one interval at every step, so a chain of six steps can wait an hour end to end; idle runs still start containers; the timers must be kept from overlapping.

### 2. Start the next step from the bucket (chosen)

A step writes its snapshot file only when its run wrote something. A bucket notification on that file starts the next step's job. Only the list step runs on a schedule.

- Pros: work moves on as soon as it exists; no idle runs; the signal already exists; the rule lives in the deploy script, not the code, so a move to another provider is a new rule and no code change, because every object store has notifications.
- Cons: a trigger can fire while a run is still going, so the steps need a guard; a run of many tasks writes no snapshot, so the trigger must start the one-task run that does; each provider spells the rule its own way.

### 3. A queue or a database as the hand-off

- Pros: well known; ordering and locks come with it.
- Cons: one more service to run and pay for; the stores already hand work on, so it would do the same job twice.

## Ways to keep two runs of one step apart

### a. Ask the platform

At start, a run asks the job service whether an older run of its job is going.

- Pros: about twenty lines; nothing new in the bucket.
- Cons: tied to one provider.

### b. A conditional write

A run creates its marker with "only if it does not exist", so the bucket itself refuses a second one.

- Pros: atomic; the textbook primitive.
- Cons: Google Cloud Storage ignores the standard header and honours only its own; the pipeline's S3 client cannot send either; a provider that ignores the header would let two runs through in silence.

### c. A marker, a wait and a listing (chosen)

A run writes a marker that holds its creation time, waits a few seconds, lists the markers of the step, and goes on only when its own marker, or one of its own group, is the oldest live one. While it works it writes the marker again every minute, and at the end it writes it as done. A marker not written for ten minutes is stale and is skipped without a read.

- Pros: needs only a write, a listing and a read, which every object store has; nothing is deleted; a crashed run blocks its step for ten minutes at most; sits behind a port, so a better primitive can replace it later.
- Cons: a few seconds of wait at the start of every step; relies on the listing being up to date after a write, which the main providers give; two runs started inside the wait are ordered by the time in their markers, so their clocks must agree to within the wait.

## What was decided

- The list step runs on a schedule. Every other step is started by a bucket notification on the snapshot of the step before it. The notification is a deploy rule, not code.
- A run guard behind a port, `RunGuard`, with two adapters picked by config: `bucket`, the marker above, and `none`, for tests and tools. The tasks of one cloud job share a group, so a job of many tasks is one run.
- The marker is `guard/v1/<step>/<runId>.json` with `runId`, `group`, `createdAtUnixMs`, `lastModifiedAtUnixMs` and `isDone`.
- Config: `run.guard`, `run.guardWaitInSeconds` (5), `run.guardRefreshInSeconds` (60), `run.guardStaleInSeconds` (600) and `run.group`.

## What is built

The port, both adapters, the config, the metric `govbase_pipeline_runs_skipped`, and the group from the cloud execution name. A run that does not get the place logs `run skipped` and exits 0. A run whose guard cannot reach the bucket exits 1, so the job is tried again.

## What is left

- The notification rules for the dev jobs, one per step.
- The share-run rule: after a many-task run, the one-task run that writes the snapshot must be the one that fires the next step. Done on 12 November 2026 for the hand-started chain: `runChain.sh` starts the one-task run after each sharded step, and a one-share parse or OCR run with nothing to do still writes the snapshot.
- The production job still runs an old image.
