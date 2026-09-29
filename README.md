# govbase workspace

A small "meta-repo". `apps/` holds each govbase app side by
side, and each app is its own git repository. `docs/` holds the
shared design documents. This repository tracks the glue and the docs,
and never an app.

```
git clone <this repo> govbase
cd govbase
make clone GITHUB_ORG=<org>   # clones every app repo into apps/
make install                  # installs every app's dependencies
make check                    # runs every app's own checks
```

See `AGENTS.md` for the rules and the list of app repositories.
