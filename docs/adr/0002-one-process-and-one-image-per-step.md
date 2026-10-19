---
status: accepted
date: 2026-10-14
---

# One process and one Docker image per step

The 13 October 2026 read run took 19 hours because OCR, fetching and parsing shared one process and one queue, and the whole run waited for the slowest part. We decided that each step (list, read, ocr, judge, plan, send) runs as its own process, each a loop on its own interval from config, each built as its own Docker image from the one pipeline repository with one Docker target per step, and run under systemd on a plain machine like the relay is. `run.steps` picks the step a process runs, so a dev script runs one step for one run on the Mac. The reasons: a failure in one step never stops another, OCR can be sized and moved on its own, and an image carries only the dependencies its step uses, so only the OCR image holds Tesseract. The cost is that steps can run at different versions, so every store object carries a schema version and changes are additive, and six units are deployed instead of one.

## Considered options

- One process with a loop per step: rejected because OCR would still share the machine's main thread with fetching and parsing, and could not be moved to its own box without a split later.
- One image for every step: rejected because every image would carry Tesseract and its language data, and a release of one step would redeploy all.
- A container platform or a managed job runner: rejected; the owner does not want a platform to run, and a Docker image under systemd runs on any provider.

## Consequences

- A step is split into its own repository only when its release cadence really differs; OCR is the first candidate, and the store shapes then move to a shared package like the parser SDK.
- The parser SDK gains two readers: one with no OCR engine for list, read and judge, and one with the engine for the OCR step.
