# Starting every step of a run

As of 14 November 2026. A finding and a proposed fix. The decisions are
listed at the end for the owner.

## Words used in this document

- **Starter**: the part that starts a step. It is outside the pipeline
  code. Today it is a shell on the owner's Mac.
- **Chain**: `bun run cloud:run`, which runs `tools/cloud/runChain.sh`:
  list, read, parse, OCR, topic, one Cloud Run execution after the
  other, with a one-task run after parse and after OCR that writes the
  full snapshot.
- **Single step**: `bun run cloud:step:<step>` or
  `bash tools/cloud/runStep.sh <step> <tasks>`, one execution, no next
  step.
- **Run guard**: the marker a step writes in the bucket so two runs of
  one step never do the same work at once. A second run of a step that
  finds an older live marker logs `run skipped` and exits 0.
- **Scheduler**: Google Cloud Scheduler, a timer that starts a job.

## What happened on 13 and 14 November

All times are UTC. All executions ran on the job `govbase-pipeline-dev`
and all exited 0.

| Step | Start | End | Tasks |
| --- | --- | --- | --- |
| list | 13 Nov 12:13 | 13:40 | 1 |
| read | 13 Nov 14:12 | 20:19 | 1 |
| parse | 13 Nov 20:19 | 14 Nov 07:15 | 10 |
| OCR | not run | | |
| topic | not run | | |

The 32 minutes between the end of list and the start of read show that
the steps were started one at a time, by hand. The chain starts the next
step the moment the one before it ends. After parse there was no next
command, so OCR and topic did not run. The one-task parse run that
writes the full snapshot did not run either, so the parse snapshot in
the bucket is the one share 0 wrote at 02:13, five hours before the
other nine shares ended. Readers list the store, so they are still
correct, but they fetch more.

OCR last ran on 12 November at 22:55, from the Mac, not the cloud. Topic
last ran on 30 October. The topic store has never counted the texts
parsed since then.

## Why it happened

1. **The only starter is a shell on the Mac.** `runStep.sh` runs
   `gcloud run jobs execute --wait`. The chain lives as long as that
   shell lives. A closed lid, a lost network or a single-step command
   in place of the chain ends the sequence, and nothing notices.
2. **There is no cloud trigger for the dev jobs.** The bucket
   notification rules of `pipeline-event-driven-steps.md` are in its
   "What is left" list. The run script and the Worker of
   `pipeline-side-by-side-steps-spec.md` section 4.2 and 4.3 are in its
   "not built" list.
3. **The one scheduler in the project runs the wrong job.** Cloud
   Scheduler `govwatch-pipeline-daily`, `0 2 * * *`, set up on 28
   September 2026, runs the old production job `govwatch-pipeline`: an
   image from 28 September, no args, no env. Its executions finish in one
   to two minutes and report success, every night since at least 9
   November. Nothing appears in the dev bucket at 02:00. What that job
   does in its minute was not checked here.
4. **The alarm watches one step.** `pipeline-no-finished-run` fires when
   no read run has finished for 26 hours. It uses
   `govbase_pipeline_run_finished_at_seconds`, which the read step sets.
   A topic step that has not run for two weeks fires nothing.

So the parse run on 13 November looked like a good night in Grafana,
and was one for three steps of five.

## What the specs already decided

The fix for this is already designed. It is not built.

- `pipeline-side-by-side-steps-spec.md` section 4.2: on the OVH
  instance, the run script is the starter. It starts list, then for
  each later step it starts a process while an earlier step is live,
  and one last time when none is. OCR and topic start by rule, not by a
  person.
- Section 4.5: "Nothing new is built for Cloud Run. `runChain.sh` stays
  as it is: one step after the other, started by hand."
- Section 4.6: Cloud Scheduler entries on Google are not chosen, because
  the move takes the platform away.
- `pipeline-ovh-r2-migration-spec.md` phase 2: the Cloudflare Worker,
  pinged by UptimeRobot every 5 minutes, starts the run at 02:00 UTC.
  Phase 4: pause the Cloud Scheduler job for `govwatch-pipeline`.

The gap is the time between now and phase 2. In that time, every day
the chain is not run by hand from the Mac is a day with no OCR and no
topic counts, and nothing says so.

## The proposed fix, in four parts

### 1. Now: one command for the daily run, and the Mac kept awake

Until phase 2, the daily run is the chain and nothing else:

```sh
caffeinate -i bun run cloud:run 10
```

`caffeinate -i` stops the Mac from sleeping while the command runs. The
chain already holds OCR, topic and the two one-task snapshot runs. Single
steps are for repairs, not for the daily run. The pipeline README should
say this in its "Run a step in the cloud" section, in one line.

Two small additions to the pipeline, both optional:

- A `cloud:step:topic` script. Today topic is the one step with no
  package script, so it is the easiest to forget.
- One line at the end of `runChain.sh` that prints the end time, so a
  terminal left open shows at a glance whether the chain finished.

This part needs no decision. It is how the scripts are meant to be used.

### 2. Now: pause the nightly scheduler for the old production job

Move this one item of phase 4 forward. The scheduler starts a dead job
every night, costs a minute of Cloud Run, and gives a false signal that
"a run happened at 02:00". The command, for the owner to run:

```sh
gcloud scheduler jobs pause govwatch-pipeline-daily --location us-central1
```

Pausing keeps the job, so it can be resumed. This is a decision for the
owner because it changes the cloud project.

### 3. Now: an alarm for each step, not only read

Add to `grafana/alerts.yaml` one rule per step after list: the newest
finished time of the step is older than 26 hours. The expression follows
the read alarm, with the step metric in place of the run metric:

```
(time() - max(max_over_time(govbase_pipeline_step_finished_at_seconds{job="govbase-pipeline", step="topic"}[2d]))) > 93600
```

One rule each for `read`, `parse`, `ocr` and `topic`, or one rule with
`max by (step)`. A step that has sent no metric for two days gives no
series at all, so the rule's "no data" state must be set to alerting, as
the read alarm's summary already assumes. This rule would have fired for
topic on 1 November.

The alarm does not start anything. It makes a missed step visible within
a day, which is what was missing on 13 November.

### 4. Soon: phase 2 of the migration

The real starter is the run script of section 4.2 on an OVH instance
that the Worker creates at 02:00 UTC. Phases 0 and 1 come before it. No
new design is needed here; this document only says that part 1 to 3
above are the bridge to it, and that part 4 is what removes the Mac from
the daily run.

## Ways considered for the gap, and not recommended

| Way | Why not |
| --- | --- |
| A Cloud Scheduler job on `govbase-pipeline-dev` with args `list` | It starts list only. The later steps still need a starter. Section 4.6 rules out scheduler work on Google. |
| A scheduler that starts all five steps at 02:00 and lets them wait | The side-by-side code allows it: a step waits while an earlier step is live. But a waiting Cloud Run task is a paid task, and the one-task snapshot runs after parse and OCR would still be missing. Section 4.6 names this way and sets it aside. |
| A Cloud Run job that runs `runChain.sh` itself | New plumbing on a platform the move takes away. |
| Bucket notifications per step | The design of `pipeline-event-driven-steps.md`, which phase 4 of the migration spec replaces. |
| A cron on the browser VPS that runs `runChain.sh` | The one way that removes the Mac without new Google plumbing. The VPS is always on and in the UK. It needs `gcloud` and a Google credential on a box whose one job is the browser, and the migration spec keeps the VPS only as a fallback for the Worker. Listed here because it works; not recommended because it adds a second thing to maintain for a few weeks. |

## Running OCR and topic now

To bring the stores up to date after the 13 November run:

```sh
caffeinate -i sh -c 'bun run cloud:step:ocr 10 && bash tools/cloud/runStep.sh ocr 1 && bash tools/cloud/runStep.sh topic 1'
```

On 14 November the OCR runs completed and the topic run died three
times with exit code 137, out of memory, each time at the end of a
round when it wrote the topic snapshot. The dev job has 4 GiB. The
step holds the list, parse, OCR and topic stores in memory at once,
and a topic record then listed every topic with zeros, 5.7 KB a
record, so the snapshot reached 181 MB at 31,000 records and one
`JSON.stringify` of it took about three times that in extra memory.
Two changes followed. A record now holds only the topics with a hit,
1.4 KB on average, so the finished store is about a quarter of the
size. `runStep.sh` sends the topic step to `govbase-pipeline-dev-heavy`,
4 vCPU and 16 GiB, because the region's quota of 40 GiB would let only
five of the ten parse tasks run at once if the dev job itself grew.
The 31,000 records counted before the change stay dense until the
topics file changes, which counts every document again.

The order matters in one place. The one-task OCR run must start after
the ten-task run has ended. Each execution is its own run guard group,
so a one-task run started while the ten-task run is live finds an older
live marker, logs `run skipped`, exits 0 and writes no snapshot.
`runStep.sh` waits for each execution, so `&&` gives the right order.

Topic may start at the same time as the ten-task OCR run. It is another
step, with its own guard folder. Under the side-by-side rules it counts
what parse produced, waits while OCR is live, looks again every 60
seconds, counts the OCR texts as they land, and stops when OCR has ended
and nothing is due. Two costs come with that: the topic step lists its
stores every minute for the length of the OCR run, and a scanned
document is counted twice, once from its parse text and again when its
OCR text replaces it. Whether a step waiting on a live earlier step has
been exercised in the cloud is not known; the 13 November parse run had
no earlier step live. One after the other is the known path.

## Decisions for the owner

1. Pause `govwatch-pipeline-daily` now, or leave it for phase 4?
2. Until phase 2: the chain by hand from the Mac under `caffeinate`, or
   `runChain.sh` under cron on the browser VPS?
3. Add the per-step finished alarms now, as one rule or four?
4. Add the `cloud:step:topic` script and the end-time line to
   `runChain.sh`?

## What is not known

- What the nightly `govwatch-pipeline` execution does in its one to two
  minutes.
- Whether a step that waits on a live earlier step has run in the cloud
  yet.
- The Grafana "no data" setting of the existing read alarm. The summary
  text says it covers "none has sent metrics in 2 days"; the setting was
  not read for this document.

## Method

- Executions, their args and task counts: the Cloud Run v2 API,
  `jobs/<job>/executions`, read on 14 November 2026.
- Run markers and snapshots: the dev bucket, `guard/v1/<step>/` and
  `<store>/snapshot/`. A marker's `group` is the execution name for a
  cloud run and the run id for a run from the Mac.
- The scheduler: the Cloud Scheduler v1 API, `locations/us-central1/jobs`.
- The log lines about metrics: Cloud Logging `entries:list` filtered on
  the execution name.
- The specs and the alarms: the files named above, in this folder and
  in `apps/pipeline/grafana/`.
