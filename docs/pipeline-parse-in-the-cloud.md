# Parse step in the cloud: shares of the work, one command from the Mac

As of 24 October 2026. Items E1 to E3 and E6 of section E are built on the `parse-as-markdown` branch, uncommitted, with the check green: 458 tests, 100 percent coverage. The image is not built and the job does not exist yet: items E4 and E5 are the owner's. The design builds on the parse step as it is on the `parse-as-markdown` branch, described in `pipeline-parse-as-markdown.md` and section H of `pipeline-parse-events.md`. The decisions in `pipeline-redesign-decisions.md` and ADR 2 stand. This doc adds a second way to run one step. It does not change what any step reads or writes.

## Short answers

1. The run of 24 October parses 10 documents a minute. At that rate the 135,160 due documents take 9 days.
2. The Mac is not short of processor time. It waits on the bucket. The process used 38 percent of one core. Each document needs one read and about seven saves, and each one is a round trip from the Mac to Google. The Mac also sends up 1.6 MB of images per document.
3. Next to the bucket the round trips take milliseconds. The limit is then the processor: about 2.3 seconds per document, or 84 processor hours for the whole backlog.
4. The design: the parse step gets shares, as the OCR step has today. A Cloud Run job starts N tasks of the one pipeline image, each with one share of the document ids. A join run with one share then builds the event files. One script on the Mac starts both and waits for them.
5. With 50 tasks the backlog takes about two hours. It costs about 10 to 20 US dollars a full run, at the prices checked on 24 October. Prices must be checked again on the day.
6. The run once a day stays on the Mac. The job is for a backlog: the first parse of a long window, or a parse again after the SDK changes.

## A. The run of 24 October in numbers

**Words used in this section**

- **Bucket**: the Google Cloud Storage bucket that holds every store. The pipeline reaches it through its S3-compatible address, `storage.googleapis.com`.
- **Round trip**: one request to the bucket and its reply. From the Mac each one crosses the internet.
- **Slot**: one of the `parse.documentsAtOnce` documents the step works on at once. Today there are 4.
- **p50, p95**: the time half the documents, or 95 of 100 documents, finish inside.
- **RSS**: the memory a process holds, as the operating system counts it.

The numbers come from `apps/pipeline/data/logs/parse-2026-10-24T16-33-01Z.log` and from Grafana at 19:29 UTC, 172 minutes after the first document. The Grafana queries are under Sources at the end.

| Measure | Value | Where from |
| --- | --- | --- |
| Documents due | 135,160 | the log line at 16:37 |
| Documents done in 172 minutes | about 1,780: 1,771 parsed, 3 `broken-file`, 3 `unsaved` | `parsed_documents` counter |
| Rate | 10.3 a minute | 1,780 / 172 |
| Time left at this rate | about 9 days | 133,380 / 10.3 / 1,440 |
| Time per document, mean, last hour | 5.0 s without scan pages, 36 s with | `document_parse_seconds` sum / count |
| p50 and p95, last hour | 1.7 s and 29 s | `document_parse_seconds` buckets |
| Documents with scan pages | 92 of 1,785, 5 percent | `document_parse_seconds` count by label |
| Documents inside the SDK read at once, mean | 1.9 of 4 slots | `documents_parsing` gauge |
| Processor time used | 4,019 s in 10,600 s of life: 38 percent of one core | `cpu_seconds` gauge |
| Memory peak | 5.1 GB RSS | `memory_rss_bytes` gauge |
| Bucket calls | 14,686 reads, 13,197 saves, 7 lists, 3 saves failed | `bucket_calls` counter |
| Bytes sent up | 2.84 GB: 1.6 MB a document, 275 kB/s | `network_bytes` counter |
| Bucket errors in the log | 5 between 17:11 and 17:14: 2 `Access denied`, 3 `an unexpected error has occurred` | the log |

What the numbers say:

- **The processor is mostly idle.** JavaScript runs on one thread, so the ceiling is one core. The step uses 38 percent of it. The rest is waiting.
- **The waiting is the bucket.** Each slot holds a document for 23 s on average: 4 slots times 172 minutes, divided by 1,780 documents. The histogram covers the SDK read and the saves, 6.6 s on average over both kinds of document. The 16 s outside it are the read of the raw bytes from the bucket, the one call made before the histogram starts. The 1.9 of 4 slots inside the SDK read says the same thing: at any moment two slots wait on the bucket.
- **Most reads are the readiness check, not the documents.** About 12,900 of the 14,686 reads are the readiness check reading every list event record to find the due events. So about 12,900 events are listed. The documents account for 1,780 reads.
- **Seven saves a document.** The pictures and page images, then the markdown, then the record. From the Mac every save is a round trip.
- **The five bucket errors** came in the same three minutes as a `Metrics export failed: Transport error` line. That is a network blip on the Mac, not a fault in the bucket. The step did the right thing. `Access denied` and the unknown error are not in `RETRY_CODES` in `createObjectBucket.ts`, so each item was logged as `unsaved`, no record was written, and the next run parses it again. State is presence.
- **Processor time per document is 2.3 s**: 4,019 divided by 1,780, with all of the process's other work inside it. That is the number that matters in the cloud.

## B. What the design builds on

**Words used in this section**

- **Share**: one of the equal parts of the due documents that one process takes, chosen by document id. The OCR step has shares today.
- **Composition root**: `index.ts`, the one file that wires the real services together and runs the pipeline.

These things exist today and the design uses them as they are.

- A parse run lists `read/v2/documents/data/` and `parse/v3/documents/data/` and `errors/`, and the due documents are the read ids with no parse record or error. The run uses that listing. A document's record is written last, after its images and markdown, so a crash leaves no record without its text, and a run can stop at any point and the next run carries on.
- The OCR step takes a share with `ocr.shareIndex` and `ocr.shareCount`. The rule in `buildOcrStep.ts` is: the id as a big number, modulo the share count, equals the share index. Ids are SHA-256 hashes, so the shares are equal in size. The config schema checks that the index is below the count.
- The parse step builds the event files after the documents, in the same run. An event file has one writer.
- The `Dockerfile` builds one image of the whole pipeline on `oven/bun:1`, sets `PIPELINE_ENV=production`, and runs `bun run index.ts`. The comment at the end of `index.ts` still names a Cloud Run job.
- `PIPELINE_CONFIG` is merged over the config file field by field. The README says it is how secrets reach production, for example from Secret Manager in Cloud Run.
- `src/` reads two environment variables and no others: `PIPELINE_ENV` and `PIPELINE_CONFIG`. The rule is in `AGENTS.md` under Runtime APIs.
- The bucket is in Google Cloud. `gcloud` on the Mac is logged in to the project `govwatch-pipeline`. Its default Cloud Run region is `us-central1`, which may not be where the bucket is.
- The pipeline and the SDK are both on GitHub under `govbasedev`, but `package.json` still pins the SDK to `git+file:///Users/shauncarmody/govbase/apps/parser-sdk#v0.9.0`. A Docker build cannot resolve that address.
- The Mac is an Intel Mac, `x86_64`. A `docker build` on it makes a `linux/amd64` image with no cross-build.

## C. Four ways to go faster

**Words used in this section**

- **Worker**: a second JavaScript thread in the same process, with its own copy of the code. The OCR step runs Tesseract in workers today.
- **Task**: one container that Cloud Run starts. A job is a set of tasks started together, each told its own number.
- **Box**: a rented virtual machine, as the relay and the browser service run on.

| Way | Time for 135,160 documents | Cost | New parts | Notes |
| --- | --- | --- | --- | --- |
| 1. More slots on the Mac: `parse.documentsAtOnce` 4 to 12 | 3.5 days at best, when one core is full at 27 a minute | none | none | Memory was 5.1 GB at 4 slots. The home upload link may cap it sooner. |
| 2. Workers on the Mac, one per core | about 11 hours with 8 cores | none | a parse worker in the SDK, like the Tesseract worker | The Mac must stay awake and on a good link. The upload of 1.6 MB a document stays on the home link. |
| 3. A Cloud Run job, N tasks next to the bucket | about 2 hours with 50 tasks, 1 hour with 100 | about 10 to 20 dollars a run, nothing when idle | shares in the parse step, an image registry, a job, a secret, a script | Scales to the backlog. One command from the Mac. |
| 4. A box, as update 2 plans | 4 cores give about 1 day | about 40 euros a month, always on | all of update 2 | Parked until product-market fit. Does not scale to a backlog. |

Take way 3. The reasons:

- The bucket is in Google Cloud, so a Cloud Run task in the bucket's region reads and writes it in milliseconds and pays no transfer fee.
- A job costs nothing between runs. A backlog is rare: the first parse of a long window, or a parse again after the SDK changes. Way 2 and way 4 are paid for, or kept awake, all the time.
- The job runs the same image and the same `index.ts`. There is no second code path. The only new code in `src/` is the share rule, copied from the OCR step.
- The trigger is `gcloud` from the Mac. The script that starts the job is a sibling of the `dev:step:<name>` scripts.

Way 1 is still worth a trial for the run once a day, since it is free. See D9.

## D. The design

**Words used in this section**

- **Join run**: the run with one share, after every task has finished, that builds the event files.
- **Entry script**: the small program the container starts. It builds `PIPELINE_CONFIG` for one task, then starts `index.ts`.
- **Secret Manager**: Google's store for secrets. Cloud Run can hand a secret to a container as an environment variable.
- **Artifact Registry**: Google's store for Docker images. Cloud Run pulls its images from there.
- **HMAC key**: the access key and secret key that let the S3-compatible client sign requests to the bucket. Each key belongs to one service account.
- **Service account**: the identity a Cloud Run task runs as. It gets the rights to the bucket and the secret, and nothing else.

### D1. Shares in the parse step

The parse step gets `parse.shareIndex` and `parse.shareCount`, with the same schema and the same `readIsOwnShare` rule as the OCR step. `readDueIds` in `buildParseStep.ts` keeps only the ids of its own share. A run with `shareCount` 1 takes every id, as today.

A run with `shareCount` above 1 is a share run. It parses its share and builds no event files. Its readiness check lists the read and parse stores and does not read the event records. The log line says `Parsing 2,703 of 135,160 read items, share 7 of 50, 2 at once`.

Why no events in a share run: an event's documents fall in many shares, so no task can know when an event is complete. An event file has one writer, and the join run is that writer. The rule that rebuilds an event when a part is newer than its file stays as it is, so the join run after a share run builds every event whose documents the tasks parsed.

### D2. Two runs make one parse

| Run | Tasks | `parse.shareCount` | Does |
| --- | --- | --- | --- |
| Share run | N, for example 50 | N | each task parses its share of the documents |
| Join run | 1 | 1 | parses what the tasks left, then builds every due event file |

Both runs use the same image and the same step. The join run is the parse step exactly as it runs today. What the tasks left is small: the `unsaved` items of any network error, and the documents of a task that was killed and used up its retries.

### D3. The image

The `Dockerfile` stays one image of the whole pipeline. It changes in three ways.

- The SDK pin moves to `git+ssh://git@github.com/govbasedev/parser-sdk.git#v0.9.0`, item B1 of update 2 in its SSH form, because the SDK repository is private. `bun install` inside the build fetches it through the SSH agent of the building machine, handed in with `docker build --ssh default`; the image installs `git` and `openssh-client` for that. On the Mac the agent holds the key that reads the SDK. On GitHub a read-only deploy key does, so `check.yml` can install on GitHub too, which the file pin never could.
- `PIPELINE_ENV` stays `production` in the `Dockerfile` as the default. The job sets it to `development` for the dev bucket, so one image serves both.
- `ENTRYPOINT` becomes the entry script of D4, with `CMD ["parse"]` as the default step. Cloud Run's `--args` replaces `CMD`, so `--args ocr` runs the OCR step from the same image.

`.dockerignore` gains `data/`, `coverage/`, `node_modules/`, `.git/` and `.claude/`, so the image is small and holds no log or local file.

The image is built on the Mac with `bun run cloud:image <address>`, which runs `docker build --platform linux/amd64 --ssh default` and pushes to Artifact Registry as `<region>-docker.pkg.dev/govwatch-pipeline/govbase/pipeline:<git sha>`. The Mac is Intel, so the build is native. On a push to `main`, the `deploy` job of `check.yml` does the same on GitHub and points the dev job at the new image, with a service account key and the deploy key as repository secrets; the README's Deploy from GitHub section has the setup.

### D4. How a task learns its share

Cloud Run gives each task two environment variables: `CLOUD_RUN_TASK_INDEX`, from 0, and `CLOUD_RUN_TASK_COUNT`. Nothing in `src/` may read them: the rule is that `PIPELINE_ENV` and `PIPELINE_CONFIG` are the only environment variables.

So the image starts a small entry script, `tools/cloud/startTask.mjs`, outside `src/`. It:

1. Reads `PIPELINE_CONFIG`, which the job hands it from Secret Manager, as JSON.
2. Takes the step name from its one argument, such as `parse`.
3. Reads the two Cloud Run variables. Without them, as on the Mac, the index is 0 and the count is 1.
4. Sets `run.steps` to the one step, `parse.shareIndex` and `parse.shareCount` to the index and the count, `ocr.shareIndex` and `ocr.shareCount` to the same, and `metrics.instanceId` to the index as text (see D6).
5. Starts `bun run index.ts` with the merged JSON as `PIPELINE_CONFIG`.

The script has two small functions, `readTaskParts` and `buildTaskConfig`, tested in `tools/cloud/startTask.test.mjs`, and a main part that runs only when Bun starts the file:

```js
export const buildTaskConfig = ({ heldConfig, stepName, taskIndex, taskCount }) => {
  const sharedWork = { shareIndex: taskIndex, shareCount: taskCount };
  return {
    ...heldConfig,
    run: { ...heldConfig.run, steps: [stepName] },
    parse: { ...heldConfig.parse, ...sharedWork },
    ocr: { ...heldConfig.ocr, ...sharedWork },
    metrics: { ...heldConfig.metrics, instanceId: String(taskIndex) },
  };
};
```

`src/` is unchanged by this. `tools/structure/startTaskOwnsCloudVariables.test.mjs` fails when any file under `src/` or `index.ts` names `CLOUD_RUN_TASK`, so the rule stays enforced. The secret must be JSON, not YAML, because the script parses it. The step name is the job's argument, so one job serves `parse` today and `ocr` later with no change: `--args ocr`. A missing step name prints the usage and exits with 1, and the exit code of `index.ts` becomes the task's, so Cloud Run sees a failed run as failed.

This was decision 1 for the owner in section L. It is built this way, and `AGENTS.md` names the script as the one program outside `src/` that reads the environment.

### D5. The job

One Cloud Run job per environment: `govbase-pipeline-dev` against `govbase-pipeline-documents-dev`, and `govbase-pipeline` against the production bucket. The job holds:

| Setting | Value | Why |
| --- | --- | --- |
| Region | the bucket's location | Reads and writes stay inside Google and cost no transfer fee. `gcloud storage buckets describe gs://govbase-pipeline-documents-dev --format="value(location)"` says where. If the bucket is a multi-region such as `EU`, pick a region in it, such as `europe-west2`. |
| Image | `<region>-docker.pkg.dev/govwatch-pipeline/govbase/pipeline:<git sha>` | the image of D3 |
| Argument | `parse` | the step, read by the entry script |
| `PIPELINE_ENV` | `development` or `production` | picks the config file and so the bucket |
| `PIPELINE_CONFIG` | from the Secret Manager secret `govbase-pipeline-dev-config` | the secrets, the metrics address and `logging.format: json`, see D7 |
| Service account | `govbase-pipeline-job@govwatch-pipeline.iam.gserviceaccount.com` | has the bucket's object admin role on the one bucket and the secret accessor role on the one secret |
| CPU and memory per task | 1 vCPU, 4 GiB | one thread needs one core; the Mac held 5.1 GB with 4 slots, so 2 slots fit 4 GiB, to be measured |
| `parse.documentsAtOnce` | 2, in the secret config | two slots overlap the fast bucket calls with the one thread of parsing; more slots only add memory |
| Tasks and parallelism | 10 and 10 | the region's job quota is 20 vCPU and 40 GiB, so 10 tasks of 4 GiB at most; raise it on the quotas page to run more. On 25 October 2026 a run of 20 tasks of 2 GiB parsed about 18,800 documents in 2 hours 10 minutes, then every task ran out of memory three times |
| Task timeout | 6 hours | 2,703 documents at 2.9 s each is 2.2 hours; Cloud Run allows up to 168 hours |
| Retries per task | 2 | a killed task starts again, lists the stores, and does only what has no record; Cloud Run allows up to 10 |

The processor time per document in the cloud is a guess from the Mac's 2.3 s, and the first trial measures it. If a task runs out of memory on a large document, the task restarts and the log names the document in its last `parse.document` span; the fix is 2 vCPU and 8 GiB, or a limit in the SDK, not more retries.

Cloud Run bills a job's CPU for the whole task, not only when it is busy, so idle slots cost money. That is why a task has one core and two slots, not four cores and sixteen slots.

### D6. Metrics from many tasks

Every task sends metrics to Grafana with the same `job` and `service_name`. Fifty tasks would write the same series and the numbers would be wrong. So `createMetrics` gains `metrics.instanceId`, `null` in both config files, sent as the resource attribute `service.instance.id` when it is set. In Grafana it is the `instance` label. The entry script sets it to the task index.

The dashboard then sums over instances: `sum(increase(govbase_pipeline_parsed_documents_total[5m]))` for the rate, `sum(govbase_pipeline_step_work_left{step="parse"})` for what is left, and `max(govbase_pipeline_memory_rss_bytes)` for the memory of the worst task. The `pipeline-memory-high` alarm reads the container limit from `/sys/fs/cgroup/memory.max`, which Cloud Run provides, so it fires for a task near its limit as it would for the box.

Fifty tasks add about fifty times the pipeline's series while they run. The pipeline's series per process is well under 100, so the Grafana Cloud free tier of 10,000 active series holds up to about 100 tasks. Above that, set `metrics.exportUrl` to `null` in the secret config and read the log instead.

Tracing stays off in the share run: `tracing.exportUrl: null` in the secret config. Fifty tasks times 2,700 documents times a few spans each is about a million spans for one run, and the log and the metrics say enough. The join run may turn it on.

### D7. Logs

The task's standard output goes to Cloud Logging. The secret config sets `logging.format: json`, so every line carries `severity` and Cloud Logging shows errors as errors. Cloud Run labels every line with its task index, and the task's `Parsing` line names its share: `Parsing 2703 of 135160 read items, share 7 of 50, 2 at once`. To read them from the Mac:

```bash
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="govbase-pipeline-dev"' --limit 100 --format="value(jsonPayload.message)"
```

The progress line every `parse.progressEveryItems` items is per task, so with 50 tasks and 2,703 documents each, `progressEveryItems` of 200 gives 13 lines per task. That is right for a task. The secret config can set it to 100 for a short trial.

### D8. The command on the Mac

`package.json` gains `cloud:step:parse`, beside the `dev:step:<name>` scripts. It runs `tools/cloud/runStep.sh parse 50`, which:

1. Runs `gcloud run jobs execute govbase-pipeline-dev --region <region> --args parse --tasks 50 --wait`. The `--tasks` override on `execute` sets the share count for that execution without changing the job.
2. When it ends, runs the same with `--tasks 1`: the join run.
3. Prints the console address of both executions and a `gcloud logging read` line for the log.

The script takes the step and the task count as its two arguments. For `ocr` it skips the join run, since the OCR step builds no event files. The environment is the job name: `govbase-pipeline-dev` by default, `govbase-pipeline` with a third argument.

`--wait` holds the terminal for the whole run. Without it the command returns at once and the executions run on. Either way the Mac can sleep: the work is in the cloud. The script does not read secrets and holds none. `gcloud` on the Mac must be logged in as a user who may execute the job.

There is no new flag and no new environment variable in the pipeline. The step comes from the argument, the shares from Cloud Run, the rest from the secret config.

### D9. What stays on the Mac

The run once a day, `bun run dev:run`, stays on the Mac and parses as today. On a production window of seven days it has about 1,100 new documents a day, which at 10 a minute is under two hours. Way 1 of section C, `parse.documentsAtOnce` 8 in the Mac's local config, is a free trial to halve that; the memory gauge says whether 8 fits.

The job is run by hand, for a backlog. Nothing schedules it.

The OCR step can use the same job once the parse backlog is done: `bun run tools/cloud/runStep.sh ocr 20`. It already has shares, it builds no event files, and the one image carries Tesseract. ADR 2 wants one image per step later, and that stays with update 2.

## E. Work items

Build in this order. Items E1 to E3 are code in `apps/pipeline` and pass `make check`. Items E4 and E5 are the owner's, with `gcloud`.

**E1. Shares in the parse step.** Built. `ParseConfigSchema` and `OcrConfigSchema` take `shareIndex` and `shareCount` from one `SharedWorkSchema` with one filter, and both config files hold `0` and `1`. `readIsOwnShare` is copied into the parse step as six lines, since the two steps may not import each other; with one share it skips the arithmetic. `readDueItems` returns the due ids and the share's ids, so the log says `Parsing 2 of 6 read items, share 1 of 3, 1 at once`. The readiness check and the run skip the events when `shareCount` is above 1. Tests: a share run parses only its share, builds no event and reads no event record; a share with no item has no work even when an event is due; a share index at or over the count fails the config.

**E2. The instance id.** Built. `metrics.instanceId` is `Schema.NullOr(Schema.NonEmptyString)`, `null` in both files, and `createMetrics` puts it in the OTLP resource as `service.instance.id` when set. Tests: the export carries it when set and not when `null`.

**E3. The image and the entry script.** Built, apart from the image itself: `tools/cloud/startTask.mjs` and its test, `tools/cloud/buildImage.sh`, `tools/cloud/runStep.sh`, the `Dockerfile` with `ENTRYPOINT` and the SDK build context, the longer `.dockerignore`, the scripts `cloud:image` and `cloud:step:parse` in `package.json`, and the structure test. The sandbox has no Docker daemon, so the image is not built yet. The owner builds it on the Mac with `bun run cloud:image <address>` and runs it once against the dev bucket, `docker run -e PIPELINE_ENV=development -e PIPELINE_CONFIG='<the dev secret>' <address>`, to prove the image before any cloud step. Two things there were not tried: Bun fetching the SDK over SSH inside the build through `--ssh default`, which needs BuildKit, the default since Docker 23; and the `bun.lock` lines for the new pin, edited by hand because the sandbox cannot reach GitHub, so `bun install` on the Mac must leave `bun.lock` unchanged.

**E4. The cloud.** The owner's. With `gcloud`, in this order:

1. Find the bucket's location. Set `gcloud config set run/region <region>` to match.
2. Make the Artifact Registry repository `govbase`, Docker format, in that region. `gcloud auth configure-docker <region>-docker.pkg.dev` once on the Mac.
3. Make the service account `govbase-pipeline-job`. Give it `roles/storage.objectAdmin` on the dev bucket only.
4. Make an HMAC key for it: `gcloud storage hmac create <service account email>`. Keep the two values in the password manager.
5. Make the secret `govbase-pipeline-dev-config` in Secret Manager with one JSON document: `secrets.bucket.accessKeyId` and `secretAccessKey` from step 4, `secrets.grafana.apiToken`, `metrics.exportUrl` and `tracing.exportUrl` as in production for metrics and `null` for tracing, `logging.format: json`, and `parse.documentsAtOnce: 2`. Give the service account `roles/secretmanager.secretAccessor` on it.
6. Push the image. Create the job with the settings of D5.
7. Repeat steps 3 to 6 for production when the dev run is right, with the production bucket and its own secret.

**E5. The trial, then the backlog.** Run `tools/cloud/runStep.sh parse 2` first: two tasks, each with half the backlog, stopped by hand after ten minutes with `gcloud run jobs executions cancel`. That shows the processor time per document and the memory per task in the cloud. Then run `parse 50`. Then the join run happens by itself. Section I has the checks.

**E6. The README.** Built: the section Run a step in the cloud holds the image, the entry script, the job and its secret, the run command, the log line, the Grafana queries and the trial. `AGENTS.md` names the shares and the entry script.

## F. Config changes

| Key | Development | Production | Change |
| --- | --- | --- | --- |
| `parse.shareIndex` | 0 | 0 | new, the entry script sets it in a task |
| `parse.shareCount` | 1 | 1 | new, the entry script sets it in a task |
| `metrics.instanceId` | null | null | new, the entry script sets it in a task |

The secret config of the dev job also sets `parse.documentsAtOnce: 2`, `logging.format: json`, `metrics.exportUrl`, `tracing.exportUrl: null` and the three secrets. Nothing is added to `config/local/config.yaml`.

## G. Metrics, logs and alarms

| Metric | Change |
| --- | --- |
| every pipeline metric | gains the `instance` label in Grafana when `metrics.instanceId` is set |
| `govbase_pipeline_step_work_size{step="parse"}`, `govbase_pipeline_step_work_left{step="parse"}` | per share in a task; the dashboard sums them |

| Alarm | Change |
| --- | --- |
| `pipeline-memory-high` | unchanged; it now fires for one task near its limit, since Cloud Run provides `memory.max` |
| `pipeline-no-finished-run` | unchanged; the job is not the run once a day and does not feed it |

On 24 October the one pipeline dashboard was split into three boards, one per step, kept in `apps/pipeline/grafana/dashboards/`. The parse board sums `step_work_left` over `instance` and draws memory per instance, so a cloud job of many tasks reads as one run. Two metrics were added for the boards: `govbase_pipeline_step_started_at_seconds` and `govbase_pipeline_step_finished_at_seconds`, by `step`, from the step runner, for the run duration panel; and `govbase_pipeline_council_list_seconds`, the time to list one council. `tools/structure/dashboardsNameSentMetrics.test.mjs` fails when a board names a metric the code does not send, so a rename moves with its panels.

## H. One run, as the owner sees it

1. `bun run cloud:step:parse` on the Mac. `gcloud` starts the execution and prints its name.
2. In the first two minutes every task starts, lists the three store folders, about 400 list pages each, and logs its `Parsing 2,703 of 135,160` line with its share number.
3. For about two hours the dashboard shows the sum of `parsed_documents` rising at about 1,000 a minute and `step_work_left` falling in 50 steps. The log shows one progress line per task every 200 documents.
4. The tasks end within some minutes of each other. A task that was killed shows a retry in the execution's task list and carries on from its records.
5. The join run starts. It lists the stores, finds the handful of documents the tasks left, parses them, then reads every event record and builds every event whose documents are newer than its file. On a first full parse that is every event, about 12,900. This part is one thread; its time is measured in the trial and section K says what to do if it is long.
6. The script prints the two execution names and the log line. The Mac did nothing but run `gcloud`.

## I. Verification

1. `make check` passes with E1 to E3: done on 24 October, 458 tests, 100 percent coverage. The structure test fails when a `src/` file or `index.ts` names `CLOUD_RUN_TASK`.
2. On the Mac, `bun run dev:step:parse` is unchanged: one run, shares 0 of 1, events built.
3. On the Mac, the image runs against the dev bucket with `docker run` and parses, with `PIPELINE_ENV=development`, the dev secret as `PIPELINE_CONFIG` and the argument `parse`. Without Cloud Run's variables it logs share 0 of 1.
4. The two-task trial of E5: each task logs about 67,580 documents in its share, the shares do not overlap (the two `Parsing` lines add up to 135,160), the memory gauge per task stays under 3 GiB, and `cpu_seconds` divided by documents done gives the processor time per document. Write it in this doc.
5. The 50-task run: every task ends with its report line, the sum of `parsed_documents` across instances equals 135,160 minus what the trial did minus the `unsaved` count, and `parse/v3/documents/data/` plus `errors/` hold one record per read item, counted with `bun run report:stores`.
6. The join run: `parse/v3/events/data/` holds one file per listed event, its report line says `Events built:` with the count and `unsaved 0`, and a spot check of three events shows their documents under their titles.
7. Grafana: one `instance` per task during the run, and the summed panels match the task report lines. The Grafana Cloud series count stays under its limit.
8. The bill the next day matches section J within a factor of two. Write the real figure in this doc.
9. `bun run dev:step:parse` on the Mac after the job finds no work: `No read item is waiting to be parsed, and no event is waiting to be built`.

## J. Costs

The Cloud Run prices were checked on 24 October 2026 on Google's pricing page, for a Tier 1 region such as `us-central1`: jobs cost 0.000018 dollars a vCPU-second and 0.000002 dollars a GiB-second, after a free allowance each month of 240,000 vCPU-seconds and 450,000 GiB-seconds. A Tier 2 region, such as London, costs about 20 percent more with a smaller allowance. The bucket prices are from memory and must be checked on the Cloud Storage pricing page. The sums are the formula to fill in.

| Item | Amount for one full parse | Price basis | About |
| --- | --- | --- | --- |
| Task CPU | 50 tasks × 2.2 h × 1 vCPU = 396,000 vCPU-seconds | 0.000018 dollars a vCPU-second, the first 240,000 a month free | 3 to 7 dollars |
| Task memory | 396,000 s × 4 GiB = 1,584,000 GiB-seconds | 0.000002 dollars a GiB-second, the first 450,000 a month free | 2 to 3 dollars |
| Bucket writes | 135,160 × 7.4 = about 1,000,000 class A operations | about 0.005 dollars a thousand | 5 dollars |
| Bucket reads and lists | about 160,000 class B operations and 20,000 class A | about 0.0004 and 0.005 a thousand | under 1 dollar |
| Transfer | none, the tasks sit in the bucket's region | | 0 |
| Image storage | one image of about 500 MB | about 0.10 dollars a GB a month | under 1 dollar |
| Logs | about 10 MB | inside the free 50 GB a month | 0 |
| Total | | | about 10 to 20 dollars a full parse |

The task count does not change the processor cost much: 100 tasks for one hour cost the same vCPU-seconds as 50 for two. A trial of two tasks for ten minutes costs cents. A run of the OCR step costs more per document, since Tesseract takes tens of seconds a page, and gets its own estimate when it is planned.

The budget target in `pipeline-redesign-decisions.md` is 100 to 200 dollars a month for everything. A backlog parse is rare, so it fits.

## K. Risks

- **The processor time per document is a Mac number.** A Cloud Run vCPU may be slower than the Mac's core. The two-task trial measures it before the 50-task run, and the task count is set from it.
- **Memory per task is a guess.** The Mac held 5.1 GB with four slots. If a task is killed, Cloud Run retries it and the log names the document. Two retries of a task that dies on the same document leave that document for the join run, which may then die on the Mac. The fix is a limit in the SDK for that kind of document, as the A0 plan limit was.
- **The join run is one thread.** Building 12,900 event files reads about 130,000 markdown objects and runs the cover rule on each event. In the region the reads are fast, but the cover rule is processor work. If the join run takes more than an hour, the next change shards the events by event id in the same way as the documents, since each event has one writer when the shares are by event id. That is a later item, not this one.
- **The quota on parallel tasks.** A new project may be allowed fewer than 50 tasks at once. The job then runs the tasks in waves and takes longer, not wrongly. The quotas page raises it.
- **A burst of writes to the bucket.** Fifty tasks make about 120 saves a second, well under the rate the bucket serves from the start. Five hundred tasks would need the slow ramp Google asks for.
- **Secrets in two places.** The HMAC key lives in Secret Manager and in the password manager. The key is scoped to the one bucket by the service account's role. Rotate it by making a new key, updating the secret, and deleting the old key.
- **The SDK pin on GitHub.** A private SDK repository needs a token in `check.yml` and in any Cloud Build. The Mac's `docker build` uses the Mac's own SSH key through Bun's git, so it needs nothing new.
- **One image for every step.** The parse task carries Tesseract it never loads. The image is bigger, not slower. ADR 2's one image per step stays with update 2.

## L. Decisions for the owner

1. **The entry script reads the environment outside `src/`.** `tools/cloud/startTask.mjs` reads `CLOUD_RUN_TASK_INDEX`, `CLOUD_RUN_TASK_COUNT` and `PIPELINE_CONFIG`. The rule in `AGENTS.md` says `src/` reads two variables, and this keeps that true, with a structure test. The alternative is to let `createPipelineConfig` read the two Cloud Run variables itself, which puts Google's names into `src/`. The design recommends the script, and asks for a line in `AGENTS.md` that names it as the one program outside `src/` that reads the environment. Built this way on 24 October, with the line in `AGENTS.md`.
2. **Where the bucket is.** The job's region must be the bucket's location, and `gcloud` is set to `us-central1` today. If the bucket is in the US and the owner wants it in Europe, moving it is a copy of every store and a change of `bucket.endpoint`, and is its own job before this one.
3. **Dev first, or production.** The design runs the dev job first against `govbase-pipeline-documents-dev`, where the 135,160 documents are. The production job is the same with its own secret, when the owner wants it.
4. **The task count.** 50 is a middle value. The trial gives the processor time per document, and the owner picks the count from the formula: time ≈ 135,160 × seconds per document ÷ (tasks × 0.8).
5. **Whether the join run stays in the cloud.** It can equally be `bun run dev:step:parse` on the Mac, where the reads are slower but nothing else changes. The script does it in the cloud so the Mac is free.
6. **The verb for the new names.** `startTask` and `runStep` use verbs already in `presentVerbs`. No new verb is needed.

## Sources

The Grafana queries, run against the `grafanacloud-prom` data source at 19:29 UTC on 24 October 2026 through `https://friendlymule476.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/query?query=`:

- `sum by (outcome, reason) (increase(govbase_pipeline_parsed_documents_total[6h]))`
- `sum by (has_scan_pages) (rate(govbase_pipeline_document_parse_seconds_sum[1h])) / sum by (has_scan_pages) (rate(govbase_pipeline_document_parse_seconds_count[1h]))`
- `histogram_quantile(0.5, sum by (le) (rate(govbase_pipeline_document_parse_seconds_bucket[1h])))` and the same with `0.95`
- `sum by (has_scan_pages) (increase(govbase_pipeline_document_parse_seconds_count[6h]))`
- `sum(increase(govbase_pipeline_network_bytes_total[6h]))`
- `sum by (operation, result) (increase(govbase_pipeline_bucket_calls_total[6h]))`
- `max_over_time(govbase_pipeline_cpu_seconds[6h])`, `max_over_time(govbase_pipeline_memory_rss_bytes[6h])`, `avg_over_time(govbase_pipeline_documents_parsing[1h])`

The code read for section B: `apps/pipeline/src/domain/buildParseStep/buildParseStep.ts`, `src/domain/buildOcrStep/buildOcrStep.ts`, `src/infrastructure/createParseStore/createParseStore.ts`, `src/infrastructure/createObjectBucket/createObjectBucket.ts`, `src/infrastructure/createMetrics/createMetrics.ts`, `src/infrastructure/createPipelineConfig/createPipelineConfig.schema.ts`, `index.ts`, `Dockerfile`, `.dockerignore`, `package.json`, and `apps/parser-sdk/src/effect/createTextReader.ts`, which runs the SDK read on the main thread.
