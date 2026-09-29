# Parser SDK split: what is left to do

As of 7 October 2026. Terms follow [CONTEXT.md](CONTEXT.md). The parser moved out of `apps/pipeline` into its own app, `apps/parser-sdk`, and the pipeline now consumes it as a package. Both changes sit uncommitted in their repos.

Status: the code is done and checked as far as the agent's sandbox allows. The steps below need a person, in this order.

## What was done

- `apps/parser-sdk` holds the parser: raw bytes in, lines, blocks, tags, ModernGov XML readings and unread reasons out. It has its own `make check`, 147 tests, full coverage, and a corpus of real replies.
- `apps/pipeline` depends on `govbase-parser-sdk` as a git tag. Its own copies of the reader, OCR pool, blocks, tags, XML parsing and unread reasons are deleted. The replay reader tools are gone. `replay:index` and `replay:get` stay, and feed raw files into the SDK corpus.
- The workspace `Makefile` and `AGENTS.md` list the new app.

## Replay of the 7 October run

The agent replayed the read run of 7 October 2026 through the SDK with the new `tools/replay/` tools. Of 7,499 documents, 22 were unread for a parsing reason. 21 are plans, maps, photographs and handwritten letters, which have no machine-readable text, and "no text" is right for them. One, an A0 policies map, failed every run because pdf.js spent minutes decoding its pictures. A regression sample of 128 read documents, one per council, is identical to the saved text after two SDK changes: a symbol-font bullet now starts its own line, and a page with no text larger than `largestPageSideInPoints` is not drawn for OCR. Both changes sit uncommitted in `apps/parser-sdk`, with the pipeline config key that goes with them in `apps/pipeline`.

## To do

- [x] Copy the two new corpus bodies into the SDK repo and run `make check` there. Done on 7 October: 151 tests, full coverage, corpus suite green.
- [x] Commit the SDK and tag it `v0.1.1`. The tag sits on commit `3291954`. The pipeline now depends on `v0.1.1`, moved by the new `make bump-sdk` target, and its `bun.lock` resolves to that commit.
- [ ] In `apps/pipeline`, delete `.claude/skills/replay-read-failures/`. It fails `make check-docs`, and it drives a replay reader that no longer exists. The workspace `.claude/skills/replay-read-failures/` is its replacement. Or exempt skills in the `check-docs` target and the hook, if skills should live there.
- [ ] In `apps/pipeline`, run `make check`. The agent could not run the store, config, tunnel or browser tests in its sandbox, nor lint `index.ts`.
- [ ] Once both repositories are on GitHub, install the Renovate app on the pipeline repository. `renovate.json` there is set to watch only the parser SDK and to open a pull request for each new tag. It needs the dependency in its `github:<owner>/parser-sdk#v0.1.1` form, which is the same change Docker needs.

## Run of 7 October: errors and time

The read run took 90 minutes for 299 councils, 42 hours of council time at about 28 councils at once. Where it went, and what changed on 7 October:

- **Empty meetings.** 251 of 873 meetings were stubs: the web service answered a meeting with id 0 and no date, and the pipeline saved them as read meetings with no items. Fetched directly, every one tested was a real meeting. The SDK now refuses a stub as `Unreadable` with `EMPTY_MEETING_TEXT`, and the pipeline sends a stub to the browser fallback the way it sends a block page. A stub the browser gets too is a `parse` failure, retried next run.
- **Timeouts.** 46,000 seconds, 30 percent of council time, were 60-second web service timeouts, each retried twice. 136 of the 308 timed-out calls succeeded on a later try, 172 never did. The relay's own `proxy_read_timeout` is also 60 seconds, so raising one needs the other. Good replies were logged at debug level only, so how close they came to 60 seconds is unknown. The pipeline now logs a good reply that took `http.slowRequestInMs` or longer, 15 seconds by default, so the next run gives the numbers to set the time limit and the retries from.
- **Relay places.** Timeouts held a relay place while they waited. `http.mostRequestsAtOnce` went from 15 to 18 and `councils.councilsAtOnce` from 30 to 36, as a trial against the relay's limit of 20. Set both back if `Relay request: 429` lines appear.
- **Wrong sites.** Charnwood, Watford and Rossendale pointed at their county's site, so Leicestershire, Hertfordshire and Lancashire were read twice. They now point at `charnwood.moderngov.co.uk`, `watford.moderngov.co.uk` and `rossendale.moderngov.co.uk`, which exist behind Cloudflare. Five more pairs share one site on purpose: Adur and Worthing, Babergh and Mid Suffolk, Broadland and South Norfolk, Eastbourne and Lewes, South Hams and West Devon. Each pair reads the same meetings twice and saves them under two source ids. That is a data decision, not changed.
- **Browser reads.** 581 documents on ten hosts went through the browser after the relay was blocked, at 12 to 31 seconds each. Nothing changed there; the browser code is owner-managed.
- **Unread documents.** 21 of 22 were plans, maps, photographs and handwriting. See the earlier section.

To do for this round:

- [ ] In `apps/parser-sdk`, `git init`, then `make install` once to turn on the git hooks, then `git add -A` and commit the work. Then `make minor`: it moves `package.json` from `0.0.0` to `0.1.0`, commits that file alone, and the hook tags the commit `v0.1.0`. Then in `apps/pipeline`, `make bump-sdk`, which moves the tag, writes a new `bun.lock`, and runs `make check`. Until then the pipeline's checks fail: `bun.lock` pins SDK commit `3291954`, which no longer exists after the reset on 7 October, and the code imports `EMPTY_MEETING_TEXT`.
- [ ] Run `bun run dev:step:read`. Then compare: lost meetings should fall as stubs go to the browser, the `parse` class shows the stubs the browser could not mend, `Relay request: 200 in` lines show how long good web service calls take, and `429` lines show whether 18 at once is too many for the relay.
- [ ] From those numbers decide the time limit and the retries for web service calls, and whether the relay's `proxy_read_timeout` moves with them.

## Decide later

- [ ] How an SDK change reaches the pipeline. Today: `make patch`, `make minor` or `make major` in the SDK commits the new `package.json` version alone, and `tools/git-hooks/post-commit` tags it, then `make bump-sdk` in the pipeline moves the tag and runs the checks. Any other commit changes nothing. Still open: once there are pull requests on GitHub, whether a GitHub Action should tag the merge to `main` instead of the local hook, so a feature branch does not make tags as it goes. A branch dependency is not an option: the frozen lockfile pins one commit, so it still needs a bump by hand.
- [ ] Whether to use Renovate at all. `renovate.json` is in the pipeline, set to watch only the SDK. Nothing happens until the app is installed on GitHub, so it can be ignored or deleted with no effect.
- [x] What to name the tags. Decided on 7 October: `make patch` moves the patch number, `make minor` the minor number, and `make major` the major number. Each commits only `package.json`, and the hook tags that commit. Any other commit makes no tag.

## Moving the SDK tag from now on

1. In `apps/parser-sdk`: `make install` once, so git uses `tools/git-hooks`. Commit the work, then `make patch`, `make minor` or `make major`. It commits the new version in `package.json` alone, and the post-commit hook tags it. Any other commit makes no tag.
2. In `apps/pipeline`: `make bump-sdk`. It reads the SDK's newest tag, rewrites the dependency in `package.json`, runs `bun install` to update `bun.lock`, then runs `make check`. Then commit.
3. On GitHub, Renovate does step 2 as a pull request. `make install` in the SDK sets `push.followTags`, so `git push` carries the tags.
- [ ] Create the `parser-sdk` and `pipeline` repositories on GitHub and add each as `origin`. Neither app repo has a remote yet.
- [ ] Push `apps/parser-sdk` with its tag.
- [ ] In `apps/pipeline/package.json`, change the dependency from `git+file:///Users/shauncarmody/govbase/apps/parser-sdk#v0.1.0` to `github:<owner>/parser-sdk#v0.1.0`, then run `bun install`. The local path cannot build in Docker.
- [ ] Commit and push `apps/pipeline`.
- [ ] Commit the workspace: `Makefile`, `AGENTS.md`, and this file.

## Later, if wanted

- [ ] Let the SDK's Effect layer return the tagged document read itself, so `readModernGovCouncil` no longer rebuilds one from an Effect failure.
- [ ] Add the first failed documents from a real run to the SDK corpus with `corpus:add`, so every parser change is checked against them.
