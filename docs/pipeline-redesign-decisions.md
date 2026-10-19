# Pipeline redesign: decisions

Agreed on 2026-10-14 in a grilling session over a redesign concept, after the 13 October read run retrospective. Terms are in `CONTEXT.md` under Pipeline. Nothing here is built yet.

## Targets

| Measure | Target |
| --- | --- |
| Interval | During the proof of concept the whole chain runs once every 24 hours on the Mac (settled 2026-10-15). After the proof of concept is validated and there is product-market fit, about six months on, every step runs on its own interval, the read step every hour with a goal of every 20 minutes. |
| Time | A read run finishes inside its interval. A first run of a council is capped by the first-listing cap, not by time. |
| Coverage | 97% of listed documents read. No council lost for a reason inside our control. |
| Budget | 100 to 200 dollars a month for machines and storage, spread across providers. |

## Struck from the concept

- "Known-document reuse failed." It did not. The 13 October run was the first run against a new text bucket, and old local runs were never uploaded by rule. The next run is the test: it must read far fewer than 53,839 documents.
- A Postgres job ledger, queues, leases, a run controller, worker pools and a validation stage. None was adopted. The reasons are under each decision below.

## Decisions

### Shape

1. **One process per step**, each its own Docker image, built from the one pipeline repository with one Docker target per step, run under systemd like the relay. Steps: list, read, ocr, judge, plan, send. The report step is retired; Grafana is the report.
2. **Each step is a loop on its own interval** from config. A failure in one step never stops another. If a run is still going when the next is due, the next is skipped and logged.
3. **`run.steps` picks which step a process runs.** The server runs one step per unit. A dev script runs one run of one step on the Mac and exits.
4. **List and read are separate.** List checks each council for change on its interval and writes changed councils to its store. Read drains them.
5. **OCR is its own step** so it can be scaled on its own. Read writes a scan's outcome as a pending scan and moves on; no council waits for a scan. One OCR process takes all pending scans in first-seen order. When a second is needed, each takes its share by document id, n of m from config. No leases.

### Stores

6. **Stores live in an S3-compatible bucket** behind the pipeline's own `ObjectBucket` shape. One S3 client replaces the Google SDK. Config picks endpoint and keys. Storage should sit with the machine, to avoid egress fees.
7. **A folder per step.** A step writes only inside its own store and reads the store of the step before it. No object ever has two writers. A lint test enforces the rule, as the layer rules are enforced today.
8. **Each store has `state/` and `events/`.** State holds the latest outcome per thing, replaced on each attempt. Events are append-only under an hour prefix, read by people, the retrospective tool and Grafana, never by the next step.
9. **Item versions and judgments are append-only.** Every change to an item's evidence makes a new item version, and every version is judged. Document outcomes are replaced but keep the previous content hash and the attempt count.
10. **A document's identity is its address.** The outcome records the content hash and the SDK version that read it. An unchanged file at a known address is not parsed again. Old text is never read again when the SDK changes.
11. **Every store object carries a schema version.** Changes are additive only: a new field is optional and a reader ignores fields it does not know. A breaking change writes to a new folder, such as `read/v2/`, and the old folder drains.
12. **Crash recovery is the next run.** A document with no outcome is read again. No in-progress markers. Each step sends a heartbeat metric from its run loop; a stale heartbeat raises an alarm and systemd's watchdog restarts the unit.

### Listing

13. **Change detection first.** For page-based systems (own-site, CMIS, COINS, Decision Time, Amber Valley) the committee page is fetched and its ETag, Last-Modified or a hash of the listing is compared with the last run. Deeper pages are read only when it changed. A fallback interval per system, in config, covers sites with no useful headers.
14. **Feed systems read from the council's own last-listed time**, kept in the list store, and `feedWindowInDays` cuts instead of only logging.
15. **First listing has a one-time cap in days by meeting date.** It applies only the first time a council is listed. After that, the rule stays: a document not read before is new, whatever its meeting date, because minutes are published late.
16. **No backfill lane.** There is no backfill. The first-listing cap is the only control over history.
17. **A council is lost** after a period in hours with no listing, from config.

### Failures

18. **Nothing is permanent** during the proof of concept. A failed document is tried again when its council is next listed. No permanent-failure window, no second pass.
19. **Too-large stays cheap**: the client already stops at the headers when Content-Length is over the limit, so a retry costs one header exchange.

### Judging

20. **A version with a pending scan is not judged.** Judging waits for the OCR step.
21. **Every judgment records its inputs**: item version, question version, issue definition version and model version, so Jev can reproduce it.
22. **Jev sits behind an adapter**, like storage, in case the vendor or its API shape changes.
23. **A cap on Jev calls per run**, in config, with an alarm when the cap is in play. Work over the cap waits for the next run, oldest first.

### Politeness

24. **Per-site rate stays at 30 requests a minute**, enforced by the host turn with a 2 second gap in the client and by the relay. Documents of a council at once is a config value, default 1; raising it does not change the rate to any site.

### Observability

25. **Metrics by reason, system and host class only.** Per-council detail goes to logs, which carry the council id. A small tool reads the stores and prints what the run report used to print, for retrospectives.
26. **Fix the metrics exporter** that stopped five hours into the 13 October run before anything else is measured.

### Parser SDK

29. **Parsing stays in the SDK**, OCR parsing included: page drawing, image turning, line building and the merge with typed text are knowledge about documents.
30. **One SDK, two readers.** `createTextReader` takes no recognizer and is what list, read and judge use. `createScanReader` takes a recognizer and the page time limit and is what only the OCR step uses. The OCR step's process is the only one that imports the `govbase-parser-sdk/tesseract` export.
31. **The engine stays behind `ImageRecognizer`.** Tesseract is one implementation, under its own export path. It becomes its own package only if a second engine needs a different release cadence. It is never a service.
32. **The OCR queue leaves the SDK.** The OCR step's loop over pending scans is the queue. The read guard keeps only the per-page time limit.
33. **The SDK gains `readPdfText` and `readPdfPages`, plus the merge**, so the OCR step reads only the pages it needs and merges them into the typed result the read step stored.
34. **The read outcome points at the text.** The read step owns a document's outcome; the OCR step owns its text object; the outcome carries the key where the text will appear. Judge reads outcomes and follows the key, so one writer per object holds.
35. **Change detection hashes the parsed listing.** The list step parses the committee page with the SDK's listing reader, as today, and hashes the meeting list it gets back, not the raw HTML. No new SDK function and no per-system hashing rule.

### Machine and cost

27. **One VPS now**, running all six units. The OCR unit moves to its own box when the pending-scan metric says so; with one image per step that move is one systemd unit on another host. Size and price are in decision 39.
28. **Budget check**: box under €40, bucket under $1 at 40 GB on a no-egress provider, Grafana Cloud free tier, Jev by use. Well inside 100 to 200 dollars a month.

## Order of work

Item 1 is built. Items 2 to 6 are specified as two updates: `pipeline-update-1-stores-and-steps.md` (items 2, 4, 6, and the steps and store tool of 3 and 5) and `pipeline-update-2-processes-on-a-box.md` (the processes of 3 and the heartbeats and alarms of 5). Update 2 is parked until product-market fit; providers and prices are decided then. Settled on 2026-10-15: the judge step includes the Jev calls, and plan and send are the delivery steps with no work in the proof of concept.

1. Relay path fix: build the upstream path from the raw request URI so `%20` survives. Then metrics exporter. Then OCR readers in worker threads. These stand on their own and are measured by the next run.
2. Store layout: `state/` and `events/` per step, schema version, S3 adapter.
3. Split the steps into processes behind `run.steps`, OCR first.
4. Change detection, per-council last-listed time, first-listing cap.
5. Heartbeats, alarms, the store tool, retire the report step.
6. Jev adapter, judgment inputs, Jev cap.

### Settled open items

36. **The OCR step reads a pending scan's bytes from the raw store.** Capture is always on in production, so the raw store is the read step's store of fetched bytes, keyed by address, not a dev switch. The read outcome carries the content hash; the OCR step compares it with the body it reads and leaves the scan pending with a reason if they differ.
37. **Documents of a council at once is 1**, as the config value `documentsAtOnce`.
38. **A full re-read of a page-based council every 24 hours**, in config, catches a document added to an old meeting's page when the committee list did not change. The first-listing cap is 60 days by meeting date.
39. **Machine: a 4-core, 16 GB box** from Netcup or the relay's provider, chosen later. Steady state is about two cores of OCR an hour. Prices checked on 2026-10-14: Hetzner CCX33 about €138 after the June 2026 increase, Netcup RS 4000 about €32 on a yearly term (2024 figure), R2 $0.015 per GB-month with no egress, Grafana Cloud free at 10,000 series.

## Open

- [ ] Pick the provider for the 4-core box and confirm its current price.
