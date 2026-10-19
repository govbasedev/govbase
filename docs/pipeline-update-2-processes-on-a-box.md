# Pipeline update 2 of 2: one process per step on a box

As of 15 October 2026. This is the second of two updates that build `pipeline-redesign-decisions.md`. Nothing in it is built. It depends on `pipeline-update-1-stores-and-steps.md`, which gives the stores, the schema versions, the six steps and the two SDK readers that this update runs as six processes. The coverage table at the end of update 1 shows where every decision lands.

**Parked.** The pipeline runs on the Mac only, once every 24 hours, from the `dev:run` script of update 1 on a launchd schedule. This update is built when the proof of concept is validated and there is product-market fit, about six months on, when the read step moves to every hour. Nothing in it is needed before then. Providers, prices and the box are not decided until then.

This update touches `apps/pipeline` only. It does not change what any step reads or writes. It changes how the steps run and where.

## What this update gives

- Each step is a loop on its own interval from config. A failure in one step never stops another. A run still going when the next is due is skipped and logged.
- Each step sends a heartbeat from its run loop. A stale heartbeat raises an alarm. A watchdog restarts the unit.
- One Docker image per step, built from the one repository with one Docker target per step. Only the OCR image carries the engine.
- Six systemd units on one 4-core, 16 GB box, deployed with a script, like the relay. Secrets reach each unit through a root-only env file.
- The bucket sits with the box, on a provider with no egress fee. The budget check is recorded.
- A dev script still runs one run of one step on the Mac and exits.

## Before you start

- The proof of concept is validated and there is product-market fit.
- Update 1 is merged, the SDK is tagged and the pipeline pins it. The Mac has run the chain once a day for the proof of concept.
- The owner has picked the provider for the 4-core box and the bucket beside it, and confirmed the price on the day. Prices moved a lot in 2026, so the figures in decision 39 are not current. The box runs Ubuntu 24.04 with Docker, like the browser box.
- The SDK repository is on GitHub, with its tags pushed. A Docker build cannot resolve a `git+file:` pin.
- The owner has a Grafana Cloud stack with the OTLP gateway, as today, and an account on the image registry.

## The shape after this update

| Unit | Image | Interval | Memory limit |
| --- | --- | --- | --- |
| `govbase-pipeline@list` | `pipeline-list` | 20 minutes | 1 GB |
| `govbase-pipeline@read` | `pipeline-read` | 60 minutes, goal 20 | 4 GB |
| `govbase-pipeline@ocr` | `pipeline-ocr` | 10 minutes | 5 GB |
| `govbase-pipeline@judge` | `pipeline-judge` | 10 minutes | 2 GB |
| `govbase-pipeline@plan` | `pipeline-plan` | 15 minutes | 1 GB |
| `govbase-pipeline@send` | `pipeline-send` | 15 minutes | 1 GB |

The plan and send units are enabled only when those steps have work; until then four units run. The intervals and limits are first values. The read step must finish inside its interval on the box, or every second run is skipped. The limits add up to 14 GB on a 16 GB box. The OCR unit moves to its own box when `govbase_pipeline_pending_scans` stays high: with one image per step, that move is one unit on another host with the same env file.

Each unit runs one `docker run` of its image with `PIPELINE_ENV=production` and a `PIPELINE_CONFIG` that holds `run.steps` with that one step and the secrets. Nothing else differs between units. The units need no inbound port: they reach the relay, the browser service, the bucket, Grafana and Jev outbound only.

## Work items

Build in this order.

### A. The loop

**A1. A loop per step** [2, 3]. Add `src/domain/runStepLoop/` with a maker that takes the steps named in `run.steps` and runs each on its own fiber. New config: `run.shouldRepeat` (false in development, true in production) and `run.intervalsInSeconds` with one whole number per step name. When `shouldRepeat` is false, each named step runs once in `allSteps` order and the process exits, so every `dev:step:<name>` script works as today. When it is true, each step's fiber runs the step at once, then on every tick of `Schedule.spaced` from its interval. A tick takes a one-permit semaphore without waiting; when the permit is held, the tick logs `run skipped` with the step name and bumps counter `govbase_pipeline_runs_skipped{step}`. A failed run is logged and counted in `govbase_pipeline_runs{step, result}`, and the next tick still fires. The loop never stops on a step's failure. `index.ts` keeps the one `Effect.runPromise`; it calls `process.exit` only on the run-once path. The comment that names a Cloud Run job goes.

**A2. The heartbeat** [12]. Add `src/infrastructure/createHeartbeat/`. After every run, the loop sets gauges `govbase_pipeline_step_started_at_seconds{step}` and `govbase_pipeline_step_finished_at_seconds{step}` and writes the finish time to `<run.heartbeatPath>/<step>.beat`. New config `run.heartbeatPath`: `data/heartbeat` in development and `/var/lib/govbase/pipeline` in production. Delete `govbase_pipeline_run_started_at_seconds`, `govbase_pipeline_run_finished_at_seconds`, `govbase_pipeline_run_lost_councils` and `govbase_pipeline_run_councils` from the read step; the list step's `govbase_pipeline_lost_councils` and the read step's `run` event hold what they held. In `grafana/alerts.yaml`, replace `pipeline-run-too-long` and `pipeline-no-finished-run` with one rule per step, `pipeline-<step>-heartbeat-stale`: `finished_at` older than three times that step's interval. Add `pipeline-runs-skipped` when `runs_skipped` rises for three ticks of one step. `tools/structure/alertsNameSentMetrics.test.mjs` must pass. There is no in-progress marker anywhere: a document with no outcome is read again on the next run, as update 1 built.

### B. Images

**B1. The SDK pin off the Mac** [1]. Change the pin in `package.json` from `git+file:///Users/shauncarmody/govbase/apps/parser-sdk#<tag>` to `github:govbasedev/parser-sdk#<tag>`. `tools/bumpSdk.mjs` keeps the address and moves only the tag. Run `bun install` so `bun.lock` records the GitHub address. If the repository is private, the publish workflow and the Docker build pass a read-only token as a build secret.

**B2. One target per step** [1]. Rewrite the `Dockerfile` as multi-stage. `base` is `FROM oven/bun:1.4.2-debian` with `package.json` and `bun.lock` copied. `text` runs `bun install --frozen-lockfile --omit=optional` and copies the source. `ocr` runs `bun install --frozen-lockfile` with the optional engine and copies the source. The named targets `list`, `read`, `judge`, `plan` and `send` are `FROM text AS <step>`, and `ocr` is its own. Every target has `ENV PIPELINE_ENV=production` and `CMD ["bun", "run", "index.ts"]`. `.dockerignore` adds `data/`, `coverage/`, `node_modules/`, `.git/`, `.claude/` and `config/local/`. Add `make images`, which builds every target on the Mac, and a test in `tools/structure/` that every step name in `RunStepSchema` has a target in the `Dockerfile`.

**B3. Publish** [1]. Add `.github/workflows/publish.yml` after the browser's: on a push to `main`, build the six targets and push `ghcr.io/govbasedev/pipeline-<step>:latest` and `:<sha>`. `check.yml` stays as the gate on pull requests.

### C. Units and the box

**C1. The units** [1, 12, 27]. Add a `deploy/` folder in the pipeline repository:

- `govbase-pipeline@.service`, a template unit. `ExecStartPre` pulls `ghcr.io/govbasedev/pipeline-%i:latest`. `ExecStart` runs `docker run --rm --name govbase-pipeline-%i --memory=<limit> --env-file /etc/govbase/pipeline-%i.env -v /var/lib/govbase/pipeline:/var/lib/govbase/pipeline --log-driver journald ghcr.io/govbasedev/pipeline-%i:latest`. `ExecStop` stops the container. `Restart=always`, `RestartSec=10`. The memory limit per step is read from a small table in `deploy.sh`.
- `govbase-pipeline-watchdog.service` and `.timer`, every 5 minutes, running `pipeline-watchdog.sh`: for each enabled step, when `/var/lib/govbase/pipeline/<step>.beat` is older than three times the step's interval, `systemctl restart govbase-pipeline@<step>` and log it. This is the watchdog. A `docker run` unit cannot feed systemd's own `WatchdogSec` without a notify socket inside the container, so the timer stands in for it. If the owner wants systemd's own watchdog later, the unit needs `Type=notify`, `NotifyAccess=all` and the notify socket mounted in.
- `bootstrap.sh` and `cloud-init.yaml` after the browser's: Docker, `ufw` with SSH in only, the registry login, the `govbase` state folder.
- `deploy.sh` after the relay's: runs `make check`, writes `/etc/govbase/pipeline-<step>.env` for each step with `umask 077`, holding `PIPELINE_ENV=production` and `PIPELINE_CONFIG` as one JSON line with `run.steps` for that step and the `secrets` and `bucket.endpoint` values the owner gives it, installs the units and the timer, enables `govbase-pipeline@{list,read,ocr,judge,plan,send}` and the timer, and ends with `check.sh`.
- `check.sh`: every unit active, every beat file younger than its interval after one interval has passed, and one `govbase_pipeline_step_finished_at_seconds` per step in Grafana.

The relay's `deploy.sh` and the browser's `bootstrap.sh` are the patterns. The relay AGENTS.md rule applies: deploy only with the script, never by hand on the box.

**C2. The bucket beside the box** [6, 27, 28, 39]. `bucket.endpoint` in the production env files points at the chosen provider's bucket in the same region as the box. The owner sets a lifecycle rule on the provider that keeps objects under `read/v1/state/raw/` for 30 days; nothing else expires. The README records the budget check: the box under 40 euros a month, the bucket under 1 dollar at 40 GB with no egress fee, Grafana Cloud on the free tier at under 10,000 series, Jev by use. All of it inside the 100 to 200 dollars a month target.

**C3. The relay and the browser see six clients** [24]. Each process holds its own host turn, so the list and read units together can send more than 30 requests a minute to one host. The relay's `limit_req` at 30 a minute is then the rule of record and answers 429. Change `readRetryWaitInMs` in `createHttpClient` to honour `Retry-After` on a relay 429 that carries no `x-relay-upstream-status`, so the retry waits the relay's 2 seconds and not the 5-second backoff. The relay config does not change. `moderngov.requestGapInSeconds` stays 2. `browser.pagesAtOnce` is per process too; the browser service's 4 slots are the shared limit, and a busy slot answers 429, which the client already retries.

### D. Docs

**D1. README.** A Deployment section: the six units, the env files, the watchdog timer, the bootstrap, the deploy script, the check, the image targets, the memory table, the budget table and the move of the OCR unit to its own host. A Loop section: `run.shouldRepeat`, the intervals, the skip rule, the heartbeat and its alarms. The metrics table gains the loop metrics and loses the run gauges.

**D2. AGENTS.md.** The Steps section says that `run.steps` holds one step per unit in production, that the loop lives in `runStepLoop`, and that `index.ts` is still the one composition root. The Config section gains `run.heartbeatPath` and the intervals.

## Config changes

| Key | Development | Production | Change |
| --- | --- | --- | --- |
| `run.shouldRepeat` | false | true | new |
| `run.intervalsInSeconds.list` | 1200 | 1200 | new |
| `run.intervalsInSeconds.read` | 3600 | 3600 | new |
| `run.intervalsInSeconds.ocr` | 600 | 600 | new |
| `run.intervalsInSeconds.judge` | 600 | 600 | new |
| `run.intervalsInSeconds.plan` | 900 | 900 | new |
| `run.intervalsInSeconds.send` | 900 | 900 | new |
| `run.heartbeatPath` | `data/heartbeat` | `/var/lib/govbase/pipeline` | new |
| `run.steps` | unchanged | `[list, read, ocr, judge, plan, send]` in the file; each env file overrides it with one step | |

## Metrics and alarms

| Metric | Change |
| --- | --- |
| `govbase_pipeline_step_started_at_seconds{step}`, `govbase_pipeline_step_finished_at_seconds{step}` | new, the heartbeat |
| `govbase_pipeline_runs{step, result}`, `govbase_pipeline_runs_skipped{step}` | new |
| `govbase_pipeline_run_started_at_seconds`, `govbase_pipeline_run_finished_at_seconds`, `govbase_pipeline_run_lost_councils`, `govbase_pipeline_run_councils` | removed |

| Alarm | Change |
| --- | --- |
| `pipeline-run-too-long`, `pipeline-no-finished-run` | removed |
| `pipeline-<step>-heartbeat-stale`, six rules | new |
| `pipeline-runs-skipped` | new |

## Verification

1. `make check` passes. `make images` builds all six targets from a clean clone with the GitHub pin. Inside the `read` image, `bun -e "import('tesseract.js')"` fails; inside the `ocr` image it loads.
2. `bun run dev:step:read` on the Mac runs one run and exits. A `docker run` of the `read` image with a development env file and `run.shouldRepeat: true` runs a second run one interval after the first, against the dev bucket.
3. On the box, `systemctl status 'govbase-pipeline@*'` shows six active units. `journalctl -u govbase-pipeline@read` shows a run starting on every interval. Grafana shows `govbase_pipeline_step_finished_at_seconds` advancing for every step.
4. `systemctl stop govbase-pipeline@judge` makes `pipeline-judge-heartbeat-stale` fire within three intervals and clear after `start`. `docker pause govbase-pipeline-read` makes the watchdog timer restart the read unit within three intervals, and the next run reads what the paused run left without an outcome.
5. A read run forced longer than its interval, with a small interval in the env file, logs `run skipped` once and `govbase_pipeline_runs_skipped{step="read"}` rises by one. The following tick runs.
6. A forced failure in the list unit (a bad `bucket.endpoint` in its env file) shows `govbase_pipeline_runs{step="list", result="failed"}` rising while the other five units keep running.
7. The relay access log shows no council host above 30 requests a minute while list and read run together, and the read log shows a 429 followed by a retry after 2 seconds.
8. After one full day, the read unit finishes every run inside its interval, `govbase_pipeline_pending_scans` returns to zero between OCR runs, and the bucket's size and the provider's bill match the budget table.

## Risks

- **The intervals are guesses.** If the read unit overruns its hour on the box, every second run is skipped. Halve the interval only after the run time is known; raise `councils.documentsAtOnce` only with the rate rule in mind.
- **The watchdog is a timer, not systemd's own.** A hang inside the container is caught within three intervals. A hang of the Docker daemon is not. The notify-socket path is the fix if that happens.
- **Six env files hold the same secrets** on one box, under `umask 077`. That is the relay's pattern and the only guard. The bucket key should be scoped to the one bucket.
- **The first run after update 1 is a full read.** Every listed document is fetched once into the new store. Plan for a slow first day, and start the units in the order list, read, ocr, judge, plan, send, one at a time, watching the heartbeat of each.
- **A private SDK repository** needs a token in the publish workflow and in the Docker build. Without it the images cannot install the SDK.
- **Per-process host turns** can push one host past 30 a minute until the 429 lands. The relay holds the rate; the cost is a slower read, not a blocked council.
