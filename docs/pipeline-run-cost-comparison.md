# Pipeline run cost: Google Cloud today against CircleCI, GitHub Actions and Cloudflare, all with R2 for state

Written 10 November 2026 from the metered usage of the biggest run so far, the chain of 29 and 30 October 2026. The project has no billing export, so every cost here is a list price applied to measured usage, not an invoice. Prices are the vendors' published rates as of November 2026. Check them again before a decision.

## The short answer

For the biggest run, compute plus storage requests:

| Where it runs | State store | Cost of the big run | Cost of an October-like month |
| --- | --- | --- | --- |
| Google Cloud Run jobs, today | Cloud Storage | $24 | $68 |
| Cloudflare Workflows + Containers | R2 | $25 | $69 (includes the $5 plan) |
| GitHub Actions, larger runners, shards packed | R2 | $36 | $92 (includes a Team seat) |
| GitHub Actions, standard runners | R2 | $52 | $111 |
| CircleCI, medium Docker | R2 | $52 | $136 |

What the table says:

- Cloudflare is the only one of the three that lands at the same price as today. It is the only one that bills by the vCPU-second instead of by the runner-minute.
- GitHub Actions and CircleCI cost 1.4 to 2 times more. A CI minute costs about $0.18 per vCPU-hour. Cloud Run costs $0.065 and Cloudflare Containers $0.072. On a 2-core CI runner a 1 vCPU shard leaves half the machine idle, so the gap doubles.
- Moving the state store to R2 on its own saves about $11 a month against Cloud Storage: a little on storage, more on requests, because R2 reads are cheaper and deletes are free.
- The relay and browser VPS, Grafana and the pipeline's own code are the same in every option and are not in these numbers.

Two things stop GitHub Actions and CircleCI being a simple swap. Both cut a job off after a fixed time, 6 hours on GitHub and 3 hours on CircleCI's Performance plan, and the deep parse shards ran for up to 9.7 hours. GitHub's terms also say Actions is not for work unrelated to building, testing or publishing the repository's software. A crawl pipeline is a poor fit for that rule.

## The run that was measured

The biggest run was two chains on the dev jobs in `govwatch-pipeline`, region `us-central1`. The first was a deep list of 60 days, the second the normal 7-day feed run that finished the stores.

| Step | Started (UTC) | Wall time | Tasks | Machine per task |
| --- | --- | --- | --- | --- |
| list, deep | 29 Oct 16:34 | 1 h 49 m | 1 | 1 vCPU, 4 GiB |
| read | 29 Oct 18:33 | 3 h 02 m | 1 | 1 vCPU, 4 GiB |
| parse | 29 Oct 21:35 | 9 h 43 m | 10 | 1 vCPU, 4 GiB |
| ocr | 30 Oct 07:26 | 4 h 33 m | 10 | 2 vCPU, 4 GiB |
| list, feed | 30 Oct 16:54 | 19 m | 1 | 1 vCPU, 4 GiB |
| read | 30 Oct 17:13 | 20 m | 1 | 1 vCPU, 4 GiB |
| parse | 30 Oct 17:33 | 1 h 04 m | 10 | 1 vCPU, 4 GiB |
| ocr | 30 Oct 18:37 | 54 m | 10 | 2 vCPU, 4 GiB |
| join | 30 Oct 19:31 | 3 m | 1 | 1 vCPU, 4 GiB |
| topic | 30 Oct 19:35 | 7 m | 1 | 1 vCPU, 4 GiB |
| index | 30 Oct 19:42 | 3 m | 1 | 1 vCPU, 4 GiB |

The parse wall time is longer than the 6-hour task timeout because some tasks were retried. Two OCR tasks failed. The output was 1,434 meetings, 1,406 with a readable file, 14,488 papers and 63.6 million words across 95 topics.

## What the run used

Cloud Monitoring, window 29 October 16:00 to 30 October 20:00 UTC.

### Compute, from the Cloud Run metric `billable_instance_time`

| Job | Machine | Billed instance time | vCPU-seconds | GiB-seconds |
| --- | --- | --- | --- | --- |
| govbase-pipeline-dev | 1 vCPU, 4 GiB | 316,557 s (87.9 h) | 316,557 | 1,266,228 |
| govbase-pipeline-dev-ocr | 2 vCPU, 4 GiB | 106,894 s (29.7 h) | 213,788 | 427,576 |
| Total | | 7,058 instance-minutes | 530,345 (147 vCPU-h) | 1,693,804 (470 GiB-h) |

### Storage requests on the bucket `govbase-pipeline-documents-dev`

| Request | Count | Cloud Storage class | R2 class |
| --- | --- | --- | --- |
| ReadObject | 5,936,662 | B | B |
| WriteObject | 1,699,716 | A | A |
| DeleteObject | 1,510,673 | free | free |
| ListObjects | 21,345 | A | A |

Bytes written into the bucket: 302 GB. Bytes read out: 163 GB. The bucket is in the same region as the jobs, so no network charge today.

### The bucket

528 GB in 2,429,263 objects, Standard class, single region `us-central1`.

### October as a whole

Over the month the dev jobs billed 1,152,785 vCPU-seconds and 3,664,221 GiB-seconds, about 2.2 times the big run. The dev buckets took 6.09 million class A requests and 9.47 million class B requests, 3.5 and 1.6 times the big run. The month view below scales by these factors.

## What it costs on Google Cloud today

Cloud Run jobs, Tier 1 region: $0.000018 per vCPU-second and $0.000002 per GiB-second. The free tier is 240,000 vCPU-seconds and 450,000 GiB-seconds a month. Cloud Storage Standard in `us-central1`: $0.020 per GB-month, class A $0.005 per 1,000, class B $0.0004 per 1,000.

| Item | Big run | October |
| --- | --- | --- |
| Cloud Run CPU | $9.55 | $20.75 |
| Cloud Run memory | $3.39 | $7.33 |
| Free tier | | −$5.22 |
| Cloud Storage class A requests | $8.61 | $30.45 |
| Cloud Storage class B requests | $2.37 | $3.79 |
| Cloud Storage, 528 GB | | $10.57 |
| Total | $23.91 | $67.67 |

Storage requests cost almost as much as compute. The pipeline writes and deletes a great many small objects. That shape matters on every option below.

## R2 as the state store for all three

R2 prices: $0.015 per GB-month, class A (writes and lists) $4.50 per million, class B (reads) $0.36 per million, deletes free, no egress charge. The free tier is 10 GB, 1 million class A and 10 million class B a month.

| Item | Big run | October |
| --- | --- | --- |
| Class A, 1.72 million per run | $7.74 | $22.90 after the free million |
| Class B, 5.94 million per run | $2.14 | $0, inside the free 10 million |
| Storage, 518 GB after the free 10 GB | | $7.77 |
| Total | $9.88 | $30.67 |

Why R2 matters beyond its own price: once compute leaves Google, reading 163 GB a run out of Cloud Storage would cost about $0.12 per GB, roughly $20 a run. R2 charges nothing for that.

The pipeline already talks S3. Its `bucket` config is `store: s3` with `endpoint: https://storage.googleapis.com` and `region: auto`. R2 needs the endpoint changed to the account's R2 address and an R2 API token in the two key fields. The step chain today starts each step from a bucket notification on the snapshot of the step before. On R2 that becomes an event notification into a Queue, with a small Worker that starts the next step.

Moving the existing 528 GB and 2.4 million objects once would cost about $63 of Cloud Storage egress plus $11 of R2 writes. The other choice is to start R2 empty and let the pipeline fill it again from the relay.

## Cloudflare Workflows and Containers

Workflows on its own cannot run this pipeline. A Workflow step runs in the Workers runtime: 128 MB of memory, at most 5 minutes of CPU per invocation and a 1 MiB step payload. The parse step needs 4 GiB per task, worker threads and native PDF and OCR code. So Workflows is the scheduler and Containers do the work.

- Workflows: one instance per run, a step per pipeline step, a few hundred steps in all. Workers Paid includes 500,000 steps, 10 million requests and 30 million CPU-milliseconds a month. The cost rounds to nothing.
- Containers, generally available since April 2026, priced per second: $0.000020 per vCPU, $0.0000025 per GiB of memory, $0.00000007 per GB of disk. Workers Paid, $5 a month, includes 375 vCPU-minutes, 25 GiB-hours and 200 GB-hours. Custom instance types allow 1 to 4 vCPU with at least 3 GiB per vCPU, so the shards map to 1 vCPU with 4 GiB and the OCR tasks to 2 vCPU with 6 GiB. The account limit is 1,500 concurrent vCPU, so 10 or 20 shards at once is no problem. The pipeline image is `oven/bun:1` on linux/amd64, which Containers run as is.

| Item | Big run |
| --- | --- |
| Parse, list, read, join, topic, index shards: 316,557 vCPU-s, 4 GiB | $9.59 |
| OCR shards: 213,788 vCPU-s, 6 GiB | $5.94 |
| Workflows | $0 |
| Compute total | $15.53 |
| With R2 requests | $25.41 |

With the predefined `standard-2` and `standard-3` types instead of custom ones the compute is $17.90, because they carry more memory than the pipeline needs.

What has to change: a Workflow and a Worker to start container shards and to wait for their snapshots, R2 event notifications in place of bucket notifications, and a check that no container limit cuts off a 6 to 10 hour shard. The docs list no maximum lifetime, but confirm it with a trial run.

## GitHub Actions

Hosted Linux runner prices per minute: standard 2-core x64 $0.006, 2-core arm64 $0.005, and larger runners 4-core $0.012, 8-core $0.022. Larger runners need a Team or Enterprise plan and are billed from the first minute. Private repositories on the Free plan include 2,000 standard minutes a month, Team 3,000. Each job is rounded up to a whole minute.

Simple mapping, one shard per standard 2-core runner, 7 GB of memory:

| Item | Big run |
| --- | --- |
| 7,058 runner-minutes at $0.006 | $42.35 |
| Same on arm64 at $0.005 | $35.29 |
| With R2 requests | $52.23 |

Packed mapping, four 1 vCPU shards per 4-core 16 GB runner, which needs the task code to run several shards in one job:

| Item | Big run |
| --- | --- |
| 1,319 runner-minutes for the 1 vCPU work at $0.012 | $15.83 |
| 891 runner-minutes for the OCR work at $0.012 | $10.69 |
| With R2 requests | $36.40 |

Limits that bite: a job stops at 6 hours, so the deep parse needs at least twice as many shards, or a restart from the stores part way through. Concurrency is 20 jobs on Free and 60 on Team, enough for 10 or 20 shards. The R2 notification has to call the GitHub API to dispatch the next workflow. And GitHub's terms for Actions say it is not for serverless computing or work unrelated to building, testing, deploying or publishing the repository's software. Running a crawl on it is a risk to the account, whatever the price.

## CircleCI

Credits cost $0.0006 each, sold as 25,000 for $15. Docker resource classes per minute: medium, 2 vCPU 4 GB, 10 credits ($0.006); large, 4 vCPU 8 GB, 20 credits; xlarge, 8 vCPU 16 GB, 40 credits. The price per vCPU is the same at every size, so packing shards saves nothing. The Performance plan costs $15 a month and includes 25,000 credits. The Free plan includes 30,000 credits a month but stops a job after 1 hour. Performance stops a job after 3 hours and Scale after 5.

| Item | Big run |
| --- | --- |
| 7,058 medium-minutes, 70,580 credits | $42.35 |
| With R2 requests | $52.23 |

An October-like month needs about 153,000 credits: the plan's 25,000 plus six more packs, $105 in all. The 3-hour job limit means the deep parse needs three to four times as many shards as today, and a trigger from R2 has to call the CircleCI pipeline API.

## Unit prices side by side

The cost of running one of the pipeline's 1 vCPU, 4 GiB shards for one hour:

| Platform | Price per shard-hour | Why |
| --- | --- | --- |
| Cloud Run jobs | $0.094 | $0.065 for the vCPU plus $0.029 for 4 GiB |
| Cloudflare Containers, custom type | $0.108 | $0.072 for the vCPU plus $0.036 for 4 GiB |
| GitHub Actions, 4-core larger runner, packed | $0.180 | a quarter of $0.72 an hour |
| GitHub Actions, standard 2-core | $0.360 | the whole runner for one shard |
| CircleCI medium | $0.360 | the whole class for one shard |

## Monthly view, October-like usage

Compute scaled by 2.17, R2 by the October request counts.

| Option | Compute | Plan or seats | R2 | Total |
| --- | --- | --- | --- | --- |
| Google Cloud today | $22.86 | | $44.81 Cloud Storage | $67.67 |
| Cloudflare Workflows + Containers | $32.97 | $5 | $30.67 | $68.64 |
| GitHub Actions larger, packed | $57.53 | $4, one Team seat | $30.67 | $92.20 |
| GitHub Actions standard | $79.90 after 2,000 free minutes | | $30.67 | $110.57 |
| CircleCI Performance | $90.00 in credit packs | $15 | $30.67 | $135.67 |

## Cheaper on any platform

Two changes cut the bill wherever the pipeline runs:

- Fewer small writes. 1.7 million writes and 1.5 million deletes a run are the single biggest line after compute. Batching store records would cut class A requests on R2 or Cloud Storage alike.
- More shards for shorter jobs. On every platform but Cloud Run and Containers a 3 to 6 hour job limit forces this anyway, and it shortens the wall time.

## What to verify before deciding

- Enable the billing export to BigQuery on `govwatch-pipeline`, so the next comparison uses invoiced costs. Today there is none.
- Cloud Run jobs rates: Google's pages show $0.000018 per vCPU-second and 240,000 free vCPU-seconds, but older copies show $0.000024 and 180,000. The newer figures are used here.
- Cloud Storage: $0.020 per GB-month is the US single-region rate in Google's own examples. One third-party table says $0.022 for Iowa.
- CircleCI Docker xlarge is listed at 40 credits by one source and 100 by another. Only medium is used in the sums here.
- Cloudflare Containers: confirm there is no cap on how long one instance may run, and that the beta instance limits do not apply any more.
- GitHub: the serverless clause appears in a mirror of the Actions terms. Read the live terms page before relying on Actions for this.

## Sources

Usage: Cloud Run job executions and Cloud Monitoring metrics `run.googleapis.com/container/billable_instance_time`, `storage.googleapis.com/api/request_count`, `network/sent_bytes_count`, `network/received_bytes_count`, `storage/total_bytes` and `storage/object_count` for project `govwatch-pipeline`.

Prices and limits:

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing) and [pricing examples](https://cloud.google.com/storage/pricing-examples)
- [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), [Actions limits](https://docs.github.com/en/actions/reference/actions-limits), [larger runner costs](https://www.warpbuild.com/guides/github-actions-larger-runners-cost), [2026 price change](https://craci.com/compare/github-actions-runner-providers), [GitHub terms for additional products](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
- [CircleCI pricing explained](https://cicdcalculator.com/circleci), [CircleCI resource classes](https://circleci.com/docs/resource-class-overview/), [Gen1 and Gen2 classes](https://support.circleci.com/hc/en-us/articles/53295013820187-Gen1-vs-Gen2-Resource-Classes-Summary), [job run time limits](https://discuss.circleci.com/t/reminder-performance-plan-updates-and-dec-1-max-runtime-change/42032), [free tier 1-hour timeout](https://support.circleci.com/hc/en-us/articles/4410707277083)
- [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits), [Workflows step billing](https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/), [Workflows GA](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/)
- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), [Containers limits](https://developers.cloudflare.com/containers/platform/limits/), [custom instance types](https://developers.cloudflare.com/changelog/2026-01-05-custom-instance-types), [Containers GA](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/), [higher resource limits](https://developers.cloudflare.com/changelog/post/2026-02-25-higher-container-resource-limits), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [R2 pricing 2026](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills), [R2 costs explained](https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/)

## One year of daily runs, storage only: Cloud Storage against R2

Added 10 November 2026. This part leaves compute out and prices only the state store for a pipeline that runs the feed chain once a day for a year.

### What one daily run does to the store

Measured on the feed chain of 30 October 2026, 16:50 to 19:50 UTC, the same run that the national page is built from.

| Per daily run | Count |
| --- | --- |
| Writes and lists, class A | 190,693 |
| Reads, class B | 462,754 |
| Bytes written | 30 GB |
| Bytes read | 16.5 GB |

The bucket's live size after the big run settled at 30 GB in 187,125 objects. Almost all of the 30 GB written each day is overwrites: run markers, store records written again and new snapshots. That 30 GB covers 1,434 meetings, so each meeting keeps about 21 MB. Each run also leaves 108 MB of snapshots, and no lifecycle rule expires them yet.

Two growth cases: 25 new meetings a day, the average of the 60-day deep list, and 90 a day, the busiest week seen so far.

| Case | Growth | Size after a year | Average over the year |
| --- | --- | --- | --- |
| Base | 0.63 GB a day | 260 GB | 145 GB |
| High | 1.99 GB a day | 757 GB | 393 GB |

### Where the 30 GB sits

Measured on 10 November 2026, by top-level folder of the live bucket.

| Folder | Size | Objects | What it holds |
| --- | --- | --- | --- |
| `parse/` | 19.3 GB | 116,027 | the markdown and the page images of every parsed paper |
| `read/` | 10.1 GB | 32,248 | the raw bytes of every fetched document |
| `join/` | 0.4 GB | 2,813 | one markdown file per meeting and the join records |
| `topic/` | 0.2 GB | 15,849 | one record of mentions per document |
| `index/` | 28 MB | 96 | one record per topic |
| `list/` | 19 MB | 17,798 | meetings and links |
| `ocr/` | 7 MB | 2,268 | OCR records and text |
| `guard/` | 4 KB | 26 | run markers |

Two thirds of the space is page images under `parse/`, and the raw bytes under `read/` are most of the rest. Both grow with every new paper. The records and texts the site reads are under 1 GB.

### Prices

Cloud Storage Standard in `us-central1`: $0.020 per GB-month, class A $0.005 per 1,000, class B $0.0004 per 1,000. The dev bucket has the 7-day soft delete that Google turns on by default, which bills deleted and overwritten bytes for seven days at the storage rate. With 30 GB of churn a day that is about 210 GB billed all year. After the October clean-up it held 875 GB of soft-deleted data for a week.

R2: $0.015 per GB-month, class A $4.50 per million, class B $0.36 per million, deletes free, no soft delete, no egress charge. Free each month: 10 GB, 1 million class A, 10 million class B.

### One year, base case

| Line | Cloud Storage | R2 |
| --- | --- | --- |
| Storage, average 145 GB | $35 | $24 |
| Soft delete, 210 GB | $50 | $0 |
| Class A, 69.6 million | $348 | $259 |
| Class B, 168.9 million | $68 | $18 |
| Total | $501 | $301 |

R2 is $200 a year less, 40 percent. In the high growth case it is $560 against $346, a saving of $215.

Requests are 83 percent of the Cloud Storage bill and 92 percent of the R2 bill. Storage itself is small on both. The place to save more is the request count: fewer small writes per run would cut both bills by the same share.

### Things that move the numbers

- Compute outside Google. Reading 16.5 GB a day out of Cloud Storage to another cloud is 6 TB a year of egress, about $670. R2 charges nothing for it. That alone is bigger than the whole R2 bill.
- Soft delete. Setting the bucket's soft delete retention to zero removes the $50 line on Cloud Storage. R2 has nothing to switch off.
- A monthly deep run adds about $10 on Cloud Storage and $9 on R2 each time.
- Lifecycle rules. Snapshots and run markers add 40 GB a year if nothing expires them. Both stores have lifecycle rules. A 30-day rule keeps that line near zero.
- The R2 free tier covers about five days of runs a month, which is why its class A line is 25 percent lower than the raw rate would give.

## CPU and memory: Cloud Run against a VM of the same size

Added 10 November 2026. This part prices only the compute, on Cloud Run jobs as today and on a virtual machine sized like the jobs, at Google, Hetzner, netcup and OVH. Storage is left out. Prices are in US dollars, with 1 euro taken as $1.12 and 1 pound as $1.34, the rates of early November 2026.

### What the jobs really use

Cloud Monitoring for the big run: the parse and OCR tasks sat at 98 to 100 percent of their allocated vCPU at the median, so one shard needs one real vCPU and shared or overbooked cores slow it down. Memory peaked at 71 percent of 4 GiB for the parse shards, about 3 GiB, and 52 percent for OCR. So a box needs 1 vCPU and 3 GiB per parse shard and 2 vCPU and 2 GiB per OCR shard.

| Work | vCPU-hours | Of which single-task steps at 1 vCPU | Of which parallel shards |
| --- | --- | --- | --- |
| Big run, 29 to 30 October | 147.3 | 5.7 hours | 141.6 |
| One daily feed run, 30 October | 17.0 | 0.9 hours | 16.1 |

A VM bills for the whole box while it is on. During the single-task steps, list, read, join, topic and index, one vCPU works and the rest wait. The box-hours below are the single-task hours plus the parallel vCPU-hours divided by the box's vCPU count.

### Unit prices, one vCPU with 4 GB for one hour

| Platform | Price | Billed when |
| --- | --- | --- |
| Cloud Run jobs | $0.094 | only while a task runs, by the second |
| Compute Engine e2, on demand | $0.034 | while the VM is on, by the second |
| Compute Engine e2, Spot | $0.010 to $0.020 | while on, and Google may stop it |
| OVH Public Cloud b3, hourly | $0.030 | while the instance exists |
| Hetzner CCX, hourly | $0.026 | while the server exists, even when powered off |

Cloud Run costs about three times the on-demand VM rate per unit, and five to nine times the Spot rate. It wins only when the box would otherwise sit idle.

### Cloud Run today

| | Cost |
| --- | --- |
| The big run | $12.93 |
| One daily feed run | $1.49 |
| A month of daily runs | $44.58, $39.36 after the free tier |
| A year of daily runs | about $480 |

### A VM started for each run and stopped after

Start and stop needs a scheduler and a start script, and the pipeline's task sharding becomes N processes on one box. Compute Engine and OVH Public Cloud bill while the machine exists and is on, by the second or hour. Hetzner bills a server as long as it exists, so start and stop there means create and delete through the API.

| Box | Big run | Daily run | Month of daily runs | Year |
| --- | --- | --- | --- | --- |
| GCE e2-standard-8, 8 vCPU 32 GB, on demand $0.268/h | 23.4 h, $6.28 | 2.9 h, $0.77 | $25 | $306 |
| GCE e2-standard-8, Spot at 40% off | $3.77 | $0.46 | $16 | $193 |
| GCE e2-standard-8, Spot at 70% off | $1.88 | $0.23 | $9 | $109 |
| GCE e2-standard-4, 4 vCPU 16 GB, on demand $0.134/h | 41.1 h, $5.51 | 4.9 h, $0.66 | $22 | $264 |
| GCE e2-standard-16, 16 vCPU 64 GB, on demand $0.536/h | 14.6 h, $7.81 | 1.9 h, $1.01 | $32 | $392 |
| OVH b3-32, 8 vCPU 32 GB, £0.176/h | 23.4 h, $5.52 | 2.9 h, $0.68 | $20 | $249 |
| OVH b3-16, 4 vCPU 16 GB, £0.088/h | 41.1 h, $4.85 | 4.9 h, $0.58 | $17 | $211 |
| Hetzner CCX33, 8 dedicated vCPU 32 GB, €0.1891/h, create and delete per run | 23.4 h, $4.96 | 2.9 h, $0.61 | $18 | $221 |

The Compute Engine rows include $2 a month for a 20 GB boot disk. Spot is the natural fit here: the stores are idempotent, so a stopped run carries on at the next start.

### A VM that is always on

The daily run keeps an 8 vCPU box busy for 2.9 hours a day, 9 percent of the month. A flat-rate box only makes sense when the flat rate is low.

| Box | vCPU | RAM | Per month | Per year | Daily run takes |
| --- | --- | --- | --- | --- | --- |
| OVH VPS-3, shared vCores | 6 | 12 GB | $12 | $145 | 3.6 h |
| OVH VPS-4, shared vCores | 8 | 24 GB | $23 | $279 | 2.9 h |
| netcup VPS 2000 G12.5, shared vCores | 8 | 16 GB | $30 | $362 | 2.9 h |
| netcup RS 2000 G12.5, dedicated cores | 8 | 16 GB | $46 | $547 | 2.9 h |
| netcup VPS 4000 G12.5, shared vCores | 12 | 32 GB | $51 | $610 | 2.2 h |
| GCE e2-standard-4, 1-year commitment | 4 | 16 GB | $62 | $739 | 4.9 h |
| Hetzner CPX42, shared vCPU | 8 | 16 GB | $67 | $800 | 2.9 h |
| netcup RS 4000 G12.5, dedicated cores | 12 | 32 GB | $87 | $1,046 | 2.2 h |
| GCE e2-standard-8, 1-year commitment | 8 | 32 GB | $123 | $1,479 | 2.9 h |
| Hetzner CCX33, dedicated vCPU | 8 | 32 GB | $132 | $1,586 | 2.9 h |
| OVH b3-32, 12-month plan | 8 | 32 GB | $146 | $1,756 | 2.9 h |
| GCE e2-standard-8, on demand | 8 | 32 GB | $196 | $2,348 | 2.9 h |

Prices are without VAT. netcup and OVH VPS prices need a 12-month term. Hetzner prices are the EU locations in euros, including an IPv4 address. A 16 GB box runs five parse shards at a time instead of ten, so its daily run takes about four hours instead of three.

### How to read it

- For the current daily shape, a start-and-stop VM costs half of Cloud Run on demand, a fifth on Spot. A cheap flat VPS from OVH or netcup lands in the same band as a start-and-stop VM, between $150 and $360 a year, with no scheduling to build.
- Dedicated cores cost two to four times the shared ones at Hetzner and netcup. The pipeline pins its CPU for hours, which is what shared plans are not sold for. OVH's new VPS range and netcup's VPS line are shared too. Expect a slower run on shared cores, and read the fair use terms before relying on them.
- Any VM outside Google with the state still in Cloud Storage pays egress on every read: 16.5 GB a day is about $59 a month, more than the VM. The VPS rows assume R2 or another store with free egress.
- A VM carries work that Cloud Run does today: OS patches, Docker, a scheduler, a supervisor that starts the shards and retries them, and log shipping. Cloud Run also scales the big run across ten tasks without a bigger box.
- The big run is a one-off and cheap everywhere: $13 on Cloud Run, $5 to $8 on an on-demand VM, $2 to $4 on Spot.

### What to verify

- Compute Engine rates come from price trackers that quote Google's list: e2-standard-4 at $0.134 an hour on demand, $0.0844 with a one-year commitment and $0.0603 with three years. Spot is quoted at both 40 and 50 percent off, and Google's own Spot table has shown e2 at up to 70 percent off. The Cloud Billing catalogue API would give the exact figures, but it is not enabled on `govwatch-pipeline`.
- Hetzner, netcup and OVH prices were read from their price pages on 10 November 2026 and change often. netcup raised prices in September 2026 and Hetzner in June 2026.
- Hetzner's hourly rate is billed while the server exists. Confirm that creating and deleting a server around each run is acceptable before counting on the hourly row.

Sources: [Compute Engine pricing guide](https://www.cloudzero.com/blog/google-cloud-compute-engine-pricing-guide/), [e2-standard-4 pricing](https://cloudprice.net/gcp/compute/instances/e2-standard-4), [Compute Engine CUDs and Spot](https://www.usage.ai/blogs/gcp/compute-engine/), [Hetzner general purpose](https://www.hetzner.com/cloud/general-purpose/), [Hetzner regular performance](https://www.hetzner.com/cloud/regular-performance/), [netcup VPS](https://www.netcup.com/en/server/vps), [netcup root server](https://www.netcup.com/en/server/root-server), [netcup G12.5 price change](https://netcupvoucher.com/blog/netcup-g12-5-price-increase-2026), [OVH VPS](https://www.ovhcloud.com/en-gb/vps/), [OVH Public Cloud prices](https://www.ovhcloud.com/en-gb/public-cloud/prices/), [OVH October 2026 price change](https://blog.ovhcloud.com/en/posts/public-cloud-pricing-update-october-2026/), [EUR to USD history](https://www.poundsterlinglive.com/history/EUR-usd-2026), [GBP near $1.34](https://bestexchangerates.com/news/british-pound-update).
