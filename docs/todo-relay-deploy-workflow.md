# Todo: turn on the relay deploy workflow

Written 13 November 2026. Status: open. Owner: Shaun.

## What is done

The relay now has a GitHub Actions workflow, `apps/relay/.github/workflows/deploy.yml`. It follows the same pattern as the pipeline's `check.yml` and the browser's `publish.yml`:

- The `check` job runs `make check` on every push and every pull request.
- The `deploy` job runs only after a green check on a push to `main`. It loads the SSH key, trusts the VPS host key, and runs the existing `deploy.sh` against the London VPS. The script installs the files, reloads nginx and runs the live check on the server. Two deploys cannot overlap.

The workflow uses `deploy.sh` unchanged, so the relay's AGENTS rule "deploy only with `deploy.sh`" still holds. The relay README describes the push-to-deploy flow, keeps the manual command as the fallback, and lists the secrets. The relay checks pass.

The three relay files are not committed yet: the workflow file, `README.md` and `AGENTS.md`.

With this, three apps deploy themselves on a push to `main`: the pipeline to its Cloud Run jobs, the browser to its image registry, and the relay to its VPS. The site, the parser SDK and the document viewer have no deploy workflow.

## Todo

Do these in order. The first push runs the deploy itself, so the secrets must exist first.

- [ ] Get the VPS host key. Run this on your Mac and keep the output:

  ```
  ssh-keyscan 195.58.134.177
  ```

- [ ] Add three repository secrets to the relay repository on GitHub, under Settings, Secrets and variables, Actions:

  | Secret                | Value                                                                                   |
  | --------------------- | --------------------------------------------------------------------------------------- |
  | `RELAY_SSH_KEY`       | the private key that logs in as root on the VPS, the content of `~/.ssh/id_ed25519_vm6` |
  | `RELAY_KNOWN_HOSTS`   | the VPS host key, the output of the `ssh-keyscan` command above                         |
  | `GOVBASE_RELAY_TOKEN` | the relay token, the same value the pipeline holds as its relay token                   |

- [ ] Commit the three relay files on `main` and push.

- [ ] Watch the `deploy` workflow run on GitHub. Both jobs must end green, and the deploy log must end with `ALL CHECKS PASSED` from the live check on the server.

- [ ] Run the check from outside once, to be sure:

  ```
  GOVBASE_RELAY_TOKEN='<relay token>' bash check.sh https://relay.govbase.co.uk
  ```

## Why the host key secret

The host key secret means the runner trusts only your server. Without it, the first SSH connection would trust whatever answered, and the relay token travels over that connection.
