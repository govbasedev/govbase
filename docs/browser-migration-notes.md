# Browser service: migration notes

As of 7 October 2026. These notes list what the pipeline's Puppeteer code does today, what the new `apps/browser` service ports, and what it could not port. They live here because an app folder may hold no markdown but `README.md` and `AGENTS.md`.

## Where the browser code lives today

| File | What it does |
| --- | --- |
| `apps/pipeline/src/infrastructure/startSshTunnel/` | Writes the SSH private key to a temp file, spawns `ssh -N -L <port>:127.0.0.1:<port> user@host`, then polls `http://127.0.0.1:<port>/json/version` until Chrome answers. |
| `apps/pipeline/src/infrastructure/createBrowserSession/` | Connects Puppeteer to that Chrome with `puppeteer.connect({ browserURL })`. Opens the tunnel on the first browser read only. Reconnects once when the link drops. Times out each read. Saves and replays browser reads through the raw capture store. |
| `apps/pipeline/src/infrastructure/readBrowserPage/` | The page reader: reads one page in the connected browser. **Its maker and its test are owner-managed, and the agent may not read them.** What follows comes from its types, its callers, and the pipeline README. |
| `apps/pipeline/config/{development,production}/config.yaml` | The `sshTunnel` part, the `secrets.sshTunnel` part, and the `browser` part. |

The Chrome itself runs on a VPS in the UK and is reached over the SSH tunnel on port 9222. Its launch flags live on that VPS, not in any repository, so they could not be read.

## What the Puppeteer code does today

**Launch.** The pipeline launches nothing. It connects to a Chrome that is already running, over `--remote-debugging-port` through the tunnel. The one launch in the repository is in a test: `puppeteer.launch({ channel: "chrome", headless: true })`.

**Browser.** Real Google Chrome (`channel: "chrome"`), not Chromium.

**One connection, many pages.** One Puppeteer connection is shared by every read in a run. If the connection closes, the next read closes the tunnel, starts a new one, connects again, and logs `Browser link: the connection closed, so the browser is connected again`. A tunnel that fails is tried once; every later read fails fast.

**Per read.** From the public shape (`ReadBrowserPageOptions`, `FileInPage`, `PageReading`) and the pipeline README:

- Input: the browser, the `browser.userAgent` string, the url, `challengeWaitInMs` and `pageWaitInSeconds` for the request kind (`feed`, `service`, or `document`).
- Open the url and wait up to `pageWaitInSeconds` for the page to load.
- Wait `challengeWaitInMs` for a bot check, such as Cloudflare, to finish.
- Fetch the page's final address from inside the page. A redirect to another host works, and the check's cookie is used. The in-page fetch returns `status`, `contentType`, and the body as base64 (`FileInPage`).
- Output: `PageReading` = `{ status, finalUrl, contentType, fileBytes }`.
- The whole read must end within `pageWaitInSeconds + challengeWaitInMs + pageWaitInSeconds`, or it fails with `PageUnreachable`.

**User agent.** The declared bot agent, `Mozilla/5.0 (compatible; GovBase/0.1; +https://govbase.co.uk; agent@govbase.co.uk)`, is handed to the page reader. The same string is sent to the relay.

**Headers, cookies, proxy, stealth, retries.** None in the readable code. The pipeline does not use `puppeteer-extra` or any stealth plugin, so there is no plugin to carry over to `playwright-extra`. Cookies are whatever the browser earns during the read. There is no proxy. There is no retry inside the browser: one try per read, and the relay's failure is kept when the browser fails.

**Config today.** `browser.userAgent`, `browser.challengeWaitInMs.{feed,service,document}` (60000, 60000, 3000), `browser.pageWaitInSeconds.{feed,service,document}` (120, 60, 30), and the `sshTunnel` part: `keyFolder`, `chromePort`, `chromeWaitInSeconds`, `retryGapInMs`, `serverAliveIntervalInSeconds`, `serverAliveCountMax`, plus `secrets.sshTunnel.{host,user,privateKey}`.

**Results.** The ModernGov client decides what a browser reply means: an error status is `failed`, a block page is `blocked`, an HTML page for a feed or web service call is `failed`, a redirect to `ieLogon.aspx` is `needs a login`, and anything else is `read`. That logic stays in the pipeline. The service only fetches.

**Capture.** With `capture.mode: save`, each browser reply is saved under `browser-<url>` with `content-type` and `x-browser-final-url` headers. With `capture.mode: replay`, reads come from the store and no browser is used. This stays in the pipeline.

## What the service ports

| Today | Service |
| --- | --- |
| Chrome on a VPS behind an SSH tunnel | Chrome on a VPS behind an HTTP service with a bearer token, reached as `https://browser.govbase.co.uk` through a Cloudflare Tunnel, so the VPS opens no inbound port |
| `puppeteer.connect` to a running Chrome | The service launches and owns Chrome with Playwright, `channel: "chrome"` |
| One shared connection | One browser process; a new browser context for each request, closed when the request ends |
| Reconnect when the link drops | The browser is launched again when it crashes, and after `MAX_REQUESTS_PER_BROWSER` requests |
| `userAgent` passed to the reader | `headers["user-agent"]` in the request body sets the context's user agent |
| Load with `pageWaitInSeconds` | `timeoutMs` in the request body |
| Wait `challengeWaitInMs` | `waitFor` in the request body: a number of milliseconds, or a CSS selector to wait for |
| In-page fetch of the final address | The same: `fetch(location.href, { credentials: "include" })` inside the page, body as base64 |
| `PageReading` | `{ status, finalUrl, html, headers, contentType, bodyBase64, timingMs }` |
| Whole-read limit in the session | The service caps each request at `MAX_TIMEOUT_MS`; the pipeline keeps its own limit too |

A document that the browser downloads instead of showing, such as a PDF, is a case the readable code does not cover. The service handles it: if the navigation starts a download, the file bytes come from the download, and the status and headers from the navigation response.

## Choices made in this port

- **Bun only, no Node.** The service runs on Bun, like the pipeline. Playwright's own CLI is run with `bun node_modules/playwright/cli.js`.
- **Real Chrome, not headless.** Chrome stable from Google, run with a window under `Xvfb` inside the container, `headless: false`. Headless Chrome is what bot checks look for.
- **Image base.** The brief asked for the official Playwright image. That image exists to ship Chromium, Firefox, WebKit and Node, none of which this service uses. The Dockerfile starts from `oven/bun` instead, pinned to the Bun version, and installs Google Chrome and its system packages with Playwright's own installer. Chrome stable is whatever Google serves when the image is built; the image tag is the git SHA, so a build is reproducible as an image but not as a Chrome version.
- **Why Playwright and not `Bun.WebView`.** Bun 1.4 ships `Bun.WebView`, a browser API built into the runtime that can drive an installed Chrome over the DevTools protocol. It was checked against this job and does not fit, for these reasons from its own types in `bun-types` 1.4.2:
  - It is marked experimental: "This API is experimental and may change in future releases."
  - `headless`: "Only `true` (headless) is implemented." This service must run a visible Chrome.
  - One Chrome per Bun process, and every view is a tab in it. The cookie store (`dataStore`) is per process, not per view, so there is no isolated context for each request.
  - `navigate(url)` has no timeout.
  - No download support. Setting a user agent, extra headers, and reading a response status all go through the raw `cdp()` escape hatch, which is only usable after a first navigation.
  - Playwright gives all of these as first-class API, and the probe in this session showed it launching real Chrome under Bun 1.4.2. The launch failed only on the sandbox's refusal of Chrome's startup socket.

## What could not be done in this session

- The page reader's maker and its test are owner-managed and could not be read. The port follows the public shape and the README. If the file does something the README does not say, such as a second try or a particular `waitUntil`, the owner must compare.
- No browser can start inside the agent's sandbox, so the service tests that need Chrome could not be run here. They run in the GitHub Actions workflow and with `make check` on a machine with Chrome.
- Docker is installed but its daemon is not reachable from the sandbox, so the image was not built here.
- The pipeline cannot be freed of Puppeteer by the agent alone: the page reader's maker imports it, and the agent may not delete that file. The pipeline README lists the two steps the owner takes.
