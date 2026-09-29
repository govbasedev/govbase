---
name: replay-read-failures
description: Debug every document a read run could not parse, with no regressions, by replaying raw files from the bucket through the parser SDK. Use after a dev:step:read run, when the run report shows unread documents, or when the user asks to debug parsing errors.
---

# Replay read failures

Work autonomously. Do not ask the user questions; take the recommended choice at each fork. Do not stop until every document that can be read is read, the regression sample is unchanged or better, and the checks of both apps pass.

The pipeline fetches and classifies. The SDK parses. So the index and the download happen in `apps/pipeline`, the reading and the fixes happen in `apps/parser-sdk`, and the pipeline only moves its SDK tag at the end.

## 1. Find the run

- A `dev:step:read` run writes `apps/pipeline/data/bundles/<run name>/`, one folder per council with `meetings.ndjson.gz`, plus `run-report.json`. The newest run name sorts last. Older runs kept for comparison sit in `data/run-N/bundles/`.
- `run-report.json` → `totals.unreadByClass` gives the counts to beat. Parsing classes are `no-text`, `garbled`, `not-supported`, `link` and `broken-file`. The others (`restricted`, `blocked`, `gateway`, `gone`, `skipped`, `empty`) are fetch failures, not parsing, and are out of scope.

## 2. Build the indexes

```
cd apps/pipeline
mkdir -p data/replay
bun run replay:index data/bundles/<run name> data/replay/failed.json no-text garbled not-supported link broken-file
bun run replay:index data/bundles/<run name> data/replay/sample.json read --most-per-council=1
```

`failed.json` holds the parsing failures. `sample.json` is the regression sample: read documents with the text the pipeline saved. Each document appears twice, as a relay key and a `browser-` key; the browser one is the one the pipeline read when both exist.

## 3. Mind the disk

- `df -m .` first. The download tool stops under 150 MB free. Free space before you start: the Bun install cache under `$TMPDIR` is safe to delete, raw files already judged are safe to delete, and nothing else is yours.
- Split a large sample into chunks of about 30 documents, one index file each, so a chunk can be downloaded, replayed and deleted without the tool downloading it again.

## 4. Download the raw files

```
bun run replay:get data/replay/failed.json data/replay/store 120
bun run replay:get data/replay/sample-1.json data/replay/store 120
```

- In the Claude Code sandbox the command needs `allowed_domains`: `storage.googleapis.com`, `oauth2.googleapis.com`, `www.googleapis.com`. Credentials come from `gcloud auth application-default login`, already on the machine. A refused `169.254.169.254` is the library probing for a cloud server and is harmless.
- The last argument caps the download in MB. Files already on disk are skipped.

## 5. Replay with the SDK

The SDK's own folder is not writable from a session started in `apps/pipeline`, and `bun --bun` is ignored there, so:

- Copy the SDK to a staging folder inside the pipeline: `rsync -a --exclude node_modules --exclude .git ../parser-sdk/ .sdk-staging/parser-sdk/` and add `/.sdk-staging/` to `.git/info/exclude`. The copy needs no install: Bun finds every package in the pipeline's `node_modules`.
- Run tools with their file, not their bin: `bun tools/replay/readRawIndex.mjs ...`, `bun ../../node_modules/vitest/vitest.mjs run`, `bun ../../node_modules/eslint/bin/eslint.js .`.
- In a loop, use absolute paths for `bun`, `head` and `grep`: the shell can lose its PATH inside a loop.

```
cd .sdk-staging/parser-sdk
bun tools/replay/readRawIndex.mjs ../../data/replay/failed.json ../../data/replay/store ../../data/replay/failed-results.json corpus/reading.json 3 > ../../data/replay/failed.log 2>&1
bun tools/replay/readReplayResults.mjs ../../data/replay/failed-results.json
```

Run a replay in the background and watch its log for `^row |FINISHED|Crash|Timeout|rror`. A `beat` line each minute names the documents in flight. A document gets at most 15 minutes.

## 6. Judge each unread document

For every document still unread, find the cause before changing code:

```
bun tools/replay/probeDocument.mjs <file.body> application/pdf 2
bun tools/replay/renderPage.mjs <file.body> 1 ../../data/replay/probe/<name>.png 1
```

- The probe shows what pdf.js extracts and every word OCR sees with its confidence. Real words at 70 percent or more mean text was dropped by a rule. Symbols such as `\ | /` at high confidence and no real words mean a drawing.
- Look at the rendered page with the Read tool. A plan, a map, a photograph and handwriting all give OCR noise, and "no text" is right for them. Do not keep a rendered page of a letter from a private individual.
- Acceptable leftovers, and only these: an empty file, a video or other file that is not a document (`not-supported`), and plans, maps, photos and handwriting with no machine-readable text (`no-text`).
- Everything else is a parser gap. Fix it in the SDK, following its `AGENTS.md`: a new rule gets a unit test; a new threshold is a reading option, which also means a key in `corpus/reading.json`, in `test/helpers/readingOptions.ts`, in the SDK README, in the pipeline config schema and in both pipeline config files.
- A page that blocks for minutes is a bug too: a document the pipeline marks `broken-file` is fetched and read again on every run.

## 7. Check for regressions

- Replay each sample chunk. Every row must be `same`, or an improvement you can explain line by line. A `lost` row or a worse text is a regression: fix it. Note that the saved text of a reused document may come from an older reader, so a `changed` row needs reading, not an assumption.
- After a fix, replay the chunks again with the raw files still on disk, and compare: `bun tools/replay/readReplayResults.mjs new.json old.json`.
- Add a small public document for each new rule to the corpus with `bun run corpus:add`, then `corpus:write`, and read the expected file. Keep the corpus small and free of personal documents.

## 8. Finish

- In staging run prettier, eslint, tsc and the full vitest suite with coverage. Write every changed text file into `apps/parser-sdk` with the file tool. A binary corpus body cannot be written that way: copy it to `data/replay/corpus-bodies/` and list it for the user.
- Delete `.sdk-staging` before the pipeline's own checks, or its sources are counted in the pipeline's coverage.
- The pipeline side: the new config key, `README.md`, and the typecheck. The user commits the SDK, runs `make patch` or `make minor` there, which commits the new version and tags it through the post-commit hook, then runs `make bump-sdk` in the pipeline, which moves the tag and runs the checks.
- Delete `data/replay/store` and the rendered pages. Keep the indexes, logs and results.
- Report in short plain sentences: counts before and after by class, each cause with the file changed, what is left and why, and what the user must run. Nothing is committed unless the user asks.
