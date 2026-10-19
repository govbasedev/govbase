# Jev long context: spec

Written 2026-10-15. Status: proposal, not built. App: `apps/pipeline`, the `judge` step.

## Summary

Jev can now take much larger requests. To use this, the pipeline sends one extra header on a request. The limit for the whole request and the limit for one question then both become 262k tokens. Without the header, Jev keeps its default limits.

This spec proposes:

1. A config switch, `jev.longContext.mode`, with three values: `never`, `when-needed` and `always`.
2. A second pair of token limits in config, for long-context requests. The limits stay config values, as today.
3. The judge step sends the header only on the requests that need it (`when-needed`), so short requests are unchanged.
4. Each judgment records whether it used long context, and the Jev calls metric counts both kinds.

The first release ships with `mode: never`, so nothing changes until the owner turns it on.

## What Jev offers

- Header: `TypeSafe-Danger-Zone-Long-Context: true`.
- Models: Jev 1.14 and Jev 1.13. Our config uses `jev-latest`.
- With the header: 262k tokens for the whole request ("per-request context"), and 262k tokens for the state plus one question ("per-question context").
- Without the header: the default limits do not change.
- The header goes on each request that needs it. It is not an account setting.

## How the pipeline uses the limits today

The limits are already config values. They are in `config/<environment>/config.yaml`, in the `jev` part:

| Key | Value now | Meaning |
| --- | --- | --- |
| `stateAndLongestQuestionLimitTokens` | 24000 | State plus the longest question must fit. This is Jev's per-question limit. |
| `stateAndAllQuestionsLimitTokens` | 56000 | State plus all questions must fit. This is Jev's per-request limit. |

The code uses them in three places:

1. **Config check at startup** (`createPipelineConfig.schema.ts`). The run fails if the per-question limit is more than the per-request limit.
2. **Judging files check** (`readJudgingFiles.ts`, `readLimitIssues`). The run fails if a recipe's `stateLimitTokens` in `config/recipes.yaml` is more than `stateAndLongestQuestionLimitTokens`. The largest recipe now is 12000.
3. **Each request** (`buildJudgeStep.ts`, `buildLimitedState`). The step adds the state's estimated tokens to the question tokens. If the sum is over either limit, it does not send the state. It saves the state with the skip reason `REQUEST_OVER_LIMIT_REASON`.

The client (`createJudgmentClient.ts`, `sendWith`) sends a POST with a bearer token and a JSON body. It sends no other headers.

The pipeline only estimates tokens: characters divided by `tokens.charactersPerToken` (4). Jev counts real tokens. So a request near a limit can be a little over it.

## Decisions

These are recommendations. The owner confirms them before the build.

1. **The switch has three modes, not on and off.**
   - `never`: the default limits only. This is today's behaviour.
   - `when-needed`: a request that fits the default limits is sent as today. A request that is too big for them, but fits the long limits, is sent with the header.
   - `always`: every request has the header and uses the long limits.

   `when-needed` is the recommended mode. Most states are small (recipes are 1,500 to 12,000 tokens), so most requests stay as they are.
2. **Do not write the mode as `off` or `on`.** Some YAML parsers read `off` and `on` as booleans. The values are `never`, `when-needed` and `always`.
3. **Keep the existing two keys for the default limits.** Add the long limits under a new `longContext` part. Then no current config, local config or `PIPELINE_CONFIG` breaks.
4. **Set the long limits a little below 262k**, at 250000. Our token count is only an estimate. A request at the edge could still go over Jev's real limit. The README says why. If the owner asks for it, a config comment can say this too.
5. **Recipes do not change in the first release.** Larger states are a judging experiment, not part of the switch. They come later, in their own recipe set (see "Later: recipes that use the space").

## Config

```yaml
jev:
  url: https://api.typesafe.ai/v1/systemone
  model: jev-latest
  stateAndLongestQuestionLimitTokens: 24000
  stateAndAllQuestionsLimitTokens: 56000
  longContext:
    mode: never
    stateAndLongestQuestionLimitTokens: 250000
    stateAndAllQuestionsLimitTokens: 250000
  requestsAtOnce: 5
  mostCallsPerRun: 500
```

The same keys go in `config/development/config.yaml` and `config/production/config.yaml`, as the AGENTS.md rules require.

Checks the config schema adds (in the `Schema.filter` list of `createPipelineConfig.schema.ts`, beside the current limit check):

- `longContext.stateAndLongestQuestionLimitTokens` is no more than `longContext.stateAndAllQuestionsLimitTokens`.
- Each long limit is at least its default limit. A long limit below the default would be a mistake.

To turn it on in development only, use the local config, or this:

```
PIPELINE_CONFIG='{"run":{"steps":["judge"]},"jev":{"longContext":{"mode":"when-needed"}}}'
```

Note: `PIPELINE_CONFIG` merges field by field, so this keeps the two long limits from the file.

## Code changes

All in `apps/pipeline`. One maker per folder, no comments, string constants at the top of the file, as AGENTS.md says.

### 1. Config schema and types

`src/infrastructure/createPipelineConfig/createPipelineConfig.schema.ts`

- Add `LongContextModeSchema = Schema.Literal("never", "when-needed", "always")`.
- Add `LongContextSchema = Schema.Struct({ mode, stateAndLongestQuestionLimitTokens: CountSchema, stateAndAllQuestionsLimitTokens: CountSchema })`.
- Add `longContext: LongContextSchema` to `JevConfigSchema`.
- Add the two checks above, each with its own message constant and path.

`createPipelineConfig.types.ts`: export `LongContextMode` from the schema with `typeof ... .Type`.

`test/infrastructure/createPipelineConfig/createPipelineConfig.test.ts`:
- Add the new keys to the decoded config.
- Add one test for each new check.

### 2. Jev client sends the header when asked

`src/infrastructure/createJudgmentClient/createJudgmentClient.ts` and `.types.ts`

- Add `readonly isLongContext: boolean` to a new `JudgmentOptions` shape, or as a second parameter of `sendQuestions`. Do not put it in `JudgmentRequest`, because that object is the JSON body. Jev must not get an unknown field.
- Add constants `LONG_CONTEXT_HEADER = "TypeSafe-Danger-Zone-Long-Context"` and `LONG_CONTEXT_VALUE = "true"`.
- In `sendWith`, when `isLongContext` is true, add the header with `HttpClientRequest.setHeader`.
- Test against a real local server on port 0, as the infrastructure test rules require:
  - The header arrives when the flag is true.
  - The header is absent when the flag is false.
  - The body has no extra field in either case.

### 3. The judge step picks the limits for each request

`src/domain/buildJudgeStep/buildJudgeStep.ts`, `buildLimitedState`

Today the function returns the state, or the state with the over-limit skip reason. The new rule:

| Mode | Fits the default limits | Fits only the long limits | Fits neither |
| --- | --- | --- | --- |
| `never` | send, no header | skip, over limit | skip, over limit |
| `when-needed` | send, no header | send, with header | skip, over limit |
| `always` | send, with header | send, with header | skip, over limit |

- Put the fit test in one small function that takes a limit pair. The function's complexity must stay at 6 or below.
- Add `isLongContext` to `BuiltState` in `buildJudgeStep.types.ts`.
- Pass it on to `sendQuestions` where the step sends the state (near line 710, inside the `requestsAtOnce` loop).
- Keep the skip reason text for "fits neither". Add a second reason constant for a state that the long limits would fit while the mode is `never`. Then a run with `never` shows how many states the switch would rescue.
- Tests in `test/domain/buildJudgeStep/buildJudgeStep.test.ts`: one test per cell of the table above, using a typed fake `JudgmentClient` that records the flag.

### 4. The judging files check uses the largest limit in use

`src/domain/readJudgingFiles/readJudgingFiles.ts`, `readJudgingFiles` and `readLimitIssues`

- `recipeLimitTokens` is `stateAndLongestQuestionLimitTokens` when the mode is `never`. Otherwise it is `longContext.stateAndLongestQuestionLimitTokens`.
- The issue message names the key that applies, so the owner knows which limit to raise.
- Test both modes.

### 5. Record which context a judgment used

`src/infrastructure/createJudgeStore/createJudgeStore.schema.ts`, `JudgmentSchema`

- Add `isLongContext: Schema.optionalWith(Schema.Boolean, { default: () => false })`. AGENTS.md allows a new optional field with a default. Old records then read as `false`. No new `v2` folder is needed.
- The judge step fills it from `BuiltState`.
- This lets a later comparison split answers by context. It does not change which judgments count as already done.

### 6. Metrics

`buildJudgeStep.ts`, `govbase_pipeline_jev_calls`

- Add a `context` label with two values, `default` and `long`. This is a small closed set, as the metric rules require.
- Grafana: in the "Judge step" row, add a panel of calls by `context`, and a panel of input tokens by `context` if the token metric exists. Rename nothing, so `alertsNameSentMetrics.test.mjs` stays green.

### 7. README

In the judging part of `apps/pipeline/README.md`, describe:

- The three modes.
- The two pairs of limits.
- The header.
- The new skip reason.
- Why the long limits are set below 262k.

## Later: recipes that use the space

The switch alone only rescues the states that are now too big. Today that should be few, because no recipe goes over 12000 tokens. The real gain comes from recipes that send more text, for example a whole agenda pack in one state, not cut into parts.

- Add a new recipe set in `config/recipes.yaml`, such as `long-state`, with a high `stateLimitTokens` (up to 250000) and no `partLimitTokens`.
- Add an experiment in `config/experiments.yaml` that uses it, beside `baseline`.
- Compare the answers and the cost with `baseline` on the same items before making it the default.
- A new recipe has a new `recipeHash`, so its states and judgments are new. Old judgments stay as they are.

This is a judging decision, so it is out of scope for the first release.

## Rollout

1. Build with `mode: never` in both config files. Run `make check`. Behaviour does not change, but the new skip reason shows how many states are too big today.
2. In development, set `mode: when-needed` and run `bun run dev:step:judge` with a small `jev.mostCallsPerRun`. Check that:
   - the log and the `context` label show long calls only for the large states;
   - Jev answers them, with no 4xx error;
   - the cost per call is acceptable.
3. Set `mode: when-needed` in production.
4. Then, as a separate decision, try the long-state recipe set.

## Risks

- **"Danger Zone" in the header name.** TypeSafe may change or remove it. The `never` mode is the way back, with no code change.
- **Cost.** A 250k-token request costs many times more than a 24k one. `jev.mostCallsPerRun` caps the number of calls, not the tokens. If cost matters, a later change could cap tokens per run.
- **Time.** A long request may take much longer. The client has no timeout of its own today, so a slow answer holds one of the `requestsAtOnce` places. Measure it in step 2 of the rollout before raising `requestsAtOnce`.
- **Estimate error.** Our token count is characters divided by 4. Text with many numbers, tables or Welsh may need more tokens than that. The 250000 limit leaves room for this. A request that Jev still refuses fails as `JudgmentUnanswered`, as today, and is tried again on the next run.

## Open questions for TypeSafe or the owner

1. Is "262k" exactly 262,144 tokens or 262,000? Is it counted on input only, or on input plus output?
2. What does a long-context request cost per token? Does the header make a short request cost more? If it does, `always` should not be used.
3. Are there rate limits for long-context requests that differ from the default ones?
4. What are Jev's default limits now? Our 24000 and 56000 should stay at or below them.
5. Can the same model give different answers with and without the header? If it can, we should judge in one mode only, so that answers stay comparable.

## Files touched

| File | Change |
| --- | --- |
| `config/development/config.yaml`, `config/production/config.yaml` | `jev.longContext` part |
| `src/infrastructure/createPipelineConfig/createPipelineConfig.schema.ts`, `.types.ts` | schema, checks, type |
| `src/infrastructure/createJudgmentClient/createJudgmentClient.ts`, `.types.ts` | header, flag |
| `src/domain/buildJudgeStep/buildJudgeStep.ts`, `.types.ts` | limit choice, flag, skip reason, metric label |
| `src/domain/readJudgingFiles/readJudgingFiles.ts` | recipe check against the limit in use |
| `src/infrastructure/createJudgeStore/createJudgeStore.schema.ts` | `isLongContext` on a judgment |
| Tests for each of the above, at their mirrored paths | |
| `apps/pipeline/README.md` | judging part |
| Grafana pipeline dashboard | two panels in "Judge step" |
