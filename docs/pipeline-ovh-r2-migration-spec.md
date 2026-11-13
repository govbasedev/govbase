# Spec: move the pipeline from Cloud Run and Cloud Storage to an OVH instance per run, R2 for state, and UptimeRobot as the trigger

Draft 1, 10 November 2026. Status: for review. The cost working behind this spec is in `pipeline-run-cost-comparison.md`.

## Goal

Run the daily pipeline chain on one OVH Public Cloud instance that exists only while the chain runs, keep every store in Cloudflare R2, and start each run from an UptimeRobot ping. Keep the pipeline code, the relay, the browser service, Grafana and the site as they are, except where this spec names a change.

Why: at today's volume the compute drops from about $39 a month to about $20, the store from $45 to $31, and the egress charge that any move away from Google would otherwise add disappears. The saving grows with volume. The full numbers are in the comparison document.

## Decisions

1. One environment. There is no dev and prod split after the move. One OVH project, one R2 bucket, one trigger URL, one UptimeRobot monitor, one set of secrets. The `config/development/` folder stays only for runs on a laptop. The deployed box always runs with `PIPELINE_ENV=production`.
2. One instance per run. The run creates an OVH `b3-32` instance, 8 vCPU and 32 GB, billed by the hour, and deletes it when the chain ends. Nothing stays on at OVH between runs.
3. R2 is the only store. Cloud Storage is emptied and deleted after a holding period.
4. UptimeRobot pings a small endpoint every 5 minutes. The endpoint decides whether a run is due, starts it, watches it and cleans up. UptimeRobot's alert is the failure alert.
5. The endpoint is a Cloudflare Worker. It talks to R2 through a binding and to OVH through the OVH API. The alternative, a service on the browser VPS, is kept as a fallback if the Worker cannot do something.
6. The pipeline image is published to the GitHub Container Registry, as the browser image already is. Artifact Registry is left behind.
7. The run hour is 02:00 UTC, the hour the old production job used.

## What stays the same

- The pipeline code, its steps, its stores and their keys, the run guard, the Docker image and its entry script `tools/cloud/startTask.mjs`.
- The relay on the London VPS and the browser service behind its Cloudflare tunnel, and their tokens.
- Metrics and traces to Grafana Cloud over OTLP, with the same token.
- The parser SDK pin and the deploy key that fetches it in the image build.
- The site's data step and page templates. Only its snapshot reader changes.

## The target in one picture

```
UptimeRobot ──every 5 min──▶ Worker /tick/<secret>
                               │  reads guard markers in R2
                               │  lists OVH instances with the pipeline tag
                               ├─ deletes finished or stuck instances
                               └─ when a run is due: creates one b3-32 instance
                                        │ cloud-init: install Docker, fetch config, run the chain
                                        ├─ list ─ read ─ parse ×8 ─ ocr ×4 ─ join ─ topic ─ index
                                        │        all state read and written in R2
                                        │        metrics and traces to Grafana
                                        └─ POST /done/<runId> ──▶ Worker deletes the instance
```

## The Worker

One Worker, `govbase-pipeline-trigger`, on the Workers Free plan unless usage says otherwise. It holds these secrets: the UptimeRobot path secret, the OVH application key, secret and consumer key, and the pipeline's `PIPELINE_CONFIG` JSON with every secret in it.

### `GET /tick/<secret>`

UptimeRobot calls this every 5 minutes. On every call the Worker does, in order:

1. **Reap.** List OVH instances whose name starts with `govbase-pipeline-run-`. Delete any whose run marker in R2 says done, and any older than 8 hours. Log what it deleted.
2. **Check.** Read today's trigger marker, `trigger/v1/<yyyy-mm-dd>.json`. Read the newest guard markers, `guard/v1/<step>/<runId>.json`, to learn whether a run is live. A guard marker not refreshed for 10 minutes is stale, as the pipeline already defines.
3. **Start.** If the time is at or after 02:00 UTC, there is no trigger marker for today, and no run is live, then make a run id, write the trigger marker with the run id and the time, mint a one-time config token, and create the instance. The marker is written before the OVH call, so a second ping during the call cannot start a second instance.
4. **Reply.** `200` with a one-line body: `ok: idle`, `ok: started <runId>`, or `ok: running <runId> since <time>`. `500` with a reason when it cannot reach R2 or OVH, when the instance create fails, or when a run is older than 8 hours and could not be deleted.

UptimeRobot is set as a keyword monitor that expects `ok`, so a `500` or a missing keyword raises the alert. The Worker never does more than a few hundred milliseconds of work in a tick. Creating the instance is one API call; it does not wait for the instance to boot.

### `GET /config/<token>`

The instance calls this once at boot. The Worker checks the token against the one it minted for that run id, returns the `PIPELINE_CONFIG` JSON, and burns the token. A second call with the same token gets `404`. This keeps the secrets out of the instance's user-data, which project members can read in the OVH panel.

### `POST /done/<runId>`

The instance calls this at the end of the chain, with the run's exit status and the key of its uploaded log. The Worker marks the trigger marker done and deletes the instance. If the call never comes, the reaper deletes the instance at 8 hours.

### Idempotence

Every tick is safe to repeat. UptimeRobot checks again from other locations when a check fails, so a tick may arrive twice within a minute. The trigger marker and the pipeline's own run guard together make a double start impossible: the Worker will not create a second instance for a day that has a marker, and the pipeline will not run a step twice at once on the same bucket.

### A deep run on request

An object `trigger/v1/next-run.json` with `{"listScope":"deep"}` makes the next run a deep list run, and the Worker deletes the object when it starts that run. This replaces running `runChain.sh` by hand from the Mac. It is optional for the first version.

## The instance

| Setting | Value |
| --- | --- |
| Flavour | `b3-32`, 8 vCPU, 32 GB, 400 GB local NVMe, hourly billing |
| Region | the UK region, London, to sit next to the relay |
| Image | Debian 12 |
| Name | `govbase-pipeline-run-<runId>` |
| User-data | cloud-init: install Docker, write the run script, start it under systemd, with the run id and the one-time config token as the only values |
| Network | public IPv4 so it can reach the relay, the browser, R2 and Grafana; no inbound ports |

The run script, `tools/cloud/runOnInstance.sh` in the pipeline repository, does:

1. Fetch `PIPELINE_CONFIG` from the Worker with the one-time token. Keep it in memory and in a root-only file.
2. Log in to the GitHub Container Registry with a read-only token from the config, and pull the pipeline image at the tag the config names.
3. Run the steps in order. Each step is one or more `docker run` calls of the same image, with `PIPELINE_ENV=production`, the config, and the same three variables the Cloud Run entry script reads today: the task index, the task count and the execution name, which becomes the run id so the shards share one run guard group.

| Step | Processes | Each process | Why |
| --- | --- | --- | --- |
| list | 1 | `--cpus 1 --memory 4g` | single task today |
| read | 1 | `--cpus 1 --memory 4g` | single task today |
| parse | 8, shares 0 to 7 of 8 | `--cpus 1 --memory 3.5g` | 8 vCPU; shards peaked at 3 GiB on Cloud Run |
| ocr | 4, shares 0 to 3 of 4 | `--cpus 2 --memory 4g` | 8 vCPU; the OCR step is 2 vCPU per task today |
| join | 1 | `--cpus 2 --memory 8g` | single task; more memory is free on the box |
| topic | 1 | `--cpus 2 --memory 8g` | single task |
| index | 1 | `--cpus 2 --memory 8g` | single task |

The `--memory` flag sets the cgroup limit the pipeline's memory watchdog already reads, so the watchdog behaves as it does on Cloud Run. A step whose process exits 1, no work and a problem, is tried once more, as Cloud Run retried a task. A step that exits 1 twice ends the chain and the script reports a failed run; the next day's run picks the work up, which is the pipeline's crash rule already.

4. Write each process's output to a file. At the end, upload the files to R2 under `logs/v1/<runId>/<step>-<share>.log`, so the run can be read without Cloud Logging. The Grafana metrics and traces go out during the run as today, with `metrics.instanceId` set to the share index.
5. Call `POST /done/<runId>` and stop. The Worker deletes the instance.

The instance also carries a systemd timer that powers it off at 8 hours as a last resort. A powered-off instance still bills at OVH, so the reaper's delete is what ends the cost.

### Expected run times

| Chain | Wall time today on Cloud Run | Wall time on the box |
| --- | --- | --- |
| Daily feed chain | 2 h 50 m | about 3 h, plus 3 to 5 minutes of boot and image pull |
| Deep chain, 60 days | about 22 h | about 23 h; this needs the 8-hour limit raised for that run |

## R2

| Item | Value |
| --- | --- |
| Bucket | `govbase-pipeline-documents`, one bucket, location hint Western Europe |
| Access | one API token scoped to that bucket with object read and write, held in `PIPELINE_CONFIG` as `secrets.bucket.accessKeyId` and `secretAccessKey` |
| Pipeline config | `bucket.store: s3`, `bucket.endpoint: https://<account id>.r2.cloudflarestorage.com`, `bucket.region: auto`. No code change |
| Lifecycle rules | delete `guard/v1/` objects after 30 days; delete `*/snapshot/` objects after 30 days; delete `logs/v1/` after 90 days; abort unfinished multipart uploads after 1 day |
| Soft delete | none exists on R2, so nothing to turn off |

The pipeline's S3 client, retries and key layout work unchanged on R2. The one behaviour to test is the listing used by the run guard and by the snapshot reader, which must show a new object straight after it is written. R2 gives that.

### Moving the data

The live bucket holds 30 GB in 187,125 objects. Copy it once with `rclone sync` from Cloud Storage to R2, from the Mac or from a one-off OVH instance. Cost: about $4 of Cloud Storage egress and $1 of R2 writes, under an hour. The pipeline is not running during the copy. Starting empty is the fallback if the copy fails: the pipeline rebuilds its stores from the relay, and only the history of past runs is lost.

## The image

The GitHub workflow in the pipeline repository keeps its `check` job. Its `deploy` job changes: build the image with the commit sha as the tag, push it to `ghcr.io/govbasedev/pipeline`, and write the new tag into the Worker's config by updating one Worker secret through the Cloudflare API. No `gcloud` call remains. The `PARSER_SDK_DEPLOY_KEY` secret stays; `GCP_SA_KEY` goes.

The instance pulls with a read-only GitHub token that is part of the config. Rolling back is setting the tag back in the Worker's config.

## The site

`src/lib/readSnapshots.ts` in the site reads the bucket with the Google client today. It changes to an S3 client against the R2 endpoint, with the same key layout, and reads the two R2 keys from the environment. `bun run data` then reads R2 by default and the `--snapshots <folder>` path stays for local work. The site's `README.md` and `AGENTS.md` follow.

## Secrets

| Secret | Where it lives after the move |
| --- | --- |
| UptimeRobot path secret | Worker secret, and in the monitor's URL |
| OVH application key, secret and consumer key, limited to the instance endpoints of one project | Worker secret |
| `PIPELINE_CONFIG` with the relay token, browser token, R2 keys, Grafana token, registry token and image tag | Worker secret; handed to the instance once per run |
| Parser SDK deploy key | GitHub Actions secret, unchanged |
| Cloudflare API token that may update the Worker's secrets | GitHub Actions secret |

Nothing secret is baked into the image or written into cloud-init. The config file on the instance is root-only and the instance is deleted within hours.

## Observability

- **UptimeRobot** alerts when the tick fails or a run is stuck. Its status page shows the last reply body, which names the run id.
- **Grafana** keeps every pipeline metric and trace. The `instance` label becomes the share index on the box, as it is the task index today. Add one alert: no `govbase_pipeline_runs_total` increase in 30 hours.
- **Logs** are files in R2 under `logs/v1/<runId>/`. A small `bun run cloud:log <runId>` tool in the pipeline repository fetches and prints them, in place of the `gcloud logging read` lines the scripts print today.
- **OVH** shows the instance list and the hourly bill. An instance older than a day in that list means the reaper is broken.

## Failure cases

| What goes wrong | What happens | Who notices |
| --- | --- | --- |
| Worker down or wrong secret | UptimeRobot gets no `ok` | UptimeRobot alert |
| OVH API refuses the create, quota or outage | Worker answers `500`; the trigger marker is removed so the next tick tries again | UptimeRobot alert after the second failed check |
| Instance boots but cannot fetch the config | Run script exits; no `/done`; reaper deletes it at 8 hours; a day's run is lost | Grafana alert at 30 hours; UptimeRobot shows `running` for 8 hours |
| A step crashes | Tried once more, then the chain stops; stores are consistent because every step writes a record only after its work; next run continues | Run log in R2; Grafana counters |
| A run overruns 8 hours | Reaper deletes the instance mid-run; the next run continues from the stores | UptimeRobot body shows the stuck run; log tail in R2 is missing, so the systemd timer uploads what it has before power-off |
| R2 unreachable | The run guard cannot reach the bucket, the step exits 1, the script retries once, then stops | Grafana bucket call errors; UptimeRobot stays green, so the Grafana 30-hour alert is the backstop |
| Two ticks within a second | Second tick sees today's trigger marker and does nothing | Nothing to notice |
| Laptop run while the box runs | The run guard makes the later one skip | `run skipped` in its log |

## Costs after the move

| Item | Per month |
| --- | --- |
| OVH b3-32, about 3 hours a day at £0.176 an hour | about £16, $21 |
| R2 storage and requests, October-like usage | about $31 |
| Workers, UptimeRobot | free tiers |
| Total | about $52, against about $68 on Google today |

A deep run adds about £4 of instance time. The relay and browser VPS costs do not change.

## Migration plan

Each phase ends with a check. The old system keeps running until phase 4.

### Phase 0: prepare

- OVH Public Cloud project with the UK region enabled, quota for one `b3-32`, and an API key limited to that project's instance endpoints.
- R2 bucket, API token and lifecycle rules.
- GitHub Container Registry package for the pipeline image, a read-only token, and the workflow change that publishes there.
- Cloudflare Worker scaffold with its secrets.
- UptimeRobot account and one monitor, paused.

Check: a manual `curl` of `/tick/<secret>` answers `ok: idle` and the OVH instance list is empty.

### Phase 1: one run by hand

- Stop the Cloud Run chain for one day. Copy the live bucket to R2 with `rclone`.
- Create a `b3-32` by hand with the cloud-init from this spec and the config pointing at R2. Let it run the daily chain.

Check: the chain finishes in under 4 hours, the run log is in R2, Grafana shows the run, and `bun run data` on the site against R2 prints a `Data report:` line with the same counts as the last Cloud Run data file plus one day of meetings.

### Phase 2: the Worker starts it

- Finish the Worker and the run script. Set the monitor live.
- Let the Worker start the run at 02:00 UTC for five days in a row, while the Cloud Run jobs stay deployed but are not started.

Check: five trigger markers, five runs done, five instances deleted, no UptimeRobot alert that was not a real failure. Break the OVH key on purpose once and see the alert arrive.

### Phase 3: the site and the deploy

- Switch the site's snapshot reader to R2.
- Switch the pipeline workflow's deploy job to the registry push and the Worker secret update. Deploy one commit through it and see the next run use the new tag.

Check: a commit to `main` reaches the next day's run without a `gcloud` command.

### Phase 4: take the old system down

- Pause the Cloud Scheduler job for `govwatch-pipeline`, which still starts the old image every night.
- Delete the four Cloud Run jobs and the deployer service account key.
- Keep the Cloud Storage bucket read-only for 30 days, then delete it.
- Remove the `-dev` names from config, scripts and docs. Update the pipeline `README.md`, the workspace `AGENTS.md` table if the Worker gets its own repository, and `pipeline-event-driven-steps.md`, whose bucket notification design is replaced by this spec.

Check: the Google project bills nothing for Cloud Run and only the bucket for storage, then nothing.

### Rollback

Until phase 4, rollback is to point the pipeline config back at Cloud Storage, start the Cloud Run chain by hand with `tools/cloud/runChain.sh`, and pause the UptimeRobot monitor. The stores on both sides are the same shape, so a run on either side after a copy is correct, only the newest records differ.

## Acceptance

- Five daily runs in a row started by the ping alone, each under 4 hours, each deleting its instance.
- One forced failure of each kind in the failure table, with the named alert arriving.
- The site builds from R2 with no Google credentials on the machine.
- The OVH and Cloudflare bills for the first full month within 25 percent of the estimate above.

## Open questions

1. Which OVH region: London, or Gravelines in France, which is often cheaper and has more stock? London keeps the box next to the relay, but all council traffic goes through the relay either way.
2. Does the Worker get its own repository under the workspace, `apps/trigger`, with the workspace conventions, or live inside the pipeline repository under `tools/`?
3. Should the deep run be a config object as described, or stay a command run from the Mac?
4. How long do run logs stay in R2: 90 days as written, or longer?
5. Who holds the OVH account and the UptimeRobot account, and who gets the alerts?

## Out of scope

- Changing the pipeline's steps, stores or sharding rule.
- Running more than one instance per run.
- Moving the relay or the browser service.
- The site's hosting.
