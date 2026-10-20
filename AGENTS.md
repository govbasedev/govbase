# govbase workspace

This folder is a workspace, not one project. It has two top-level
folders. `apps/` holds independent app repositories side by
side so an agent can work across them. `docs/` holds the shared design
documents.

| Folder                 | GitHub repository | Language           |
| ---------------------- | ----------------- | ------------------ |
| `apps/pipeline`        | pipeline          | TypeScript, on Bun |
| `apps/parser-sdk`      | parser-sdk        | TypeScript, on Bun |
| `apps/browser`         | browser           | TypeScript, on Bun |
| `apps/relay`           | relay             | nginx config, bash |
| `apps/document-viewer` | document-viewer   | JavaScript, on Bun |

Each app folder is its own git repository. The workspace repository
ignores them. The workspace tracks this file, `README.md`, `Makefile`,
`.gitignore`, `.claude/`, and `docs/`.

There is no `CLAUDE.md` anywhere in this workspace. Claude Code reads
`AGENTS.md` only when no `CLAUDE.md` or `CLAUDE.local.md` exists in the
working folder or above it. `make check-agents` fails if one appears.

## Rules

1. Before you edit inside an app folder, read that folder's
   `AGENTS.md`. Its rules win over this file inside that folder.
2. Every app owns its own linting, formatting, type checking,
   tests, test fixtures, and tooling. Do not add shared code, config,
   or fixtures at the workspace root.
3. Run each app's checks with that app's own tools. From the
   workspace root, `make check` runs them all.
4. Do not import code across app folders. Do not copy files
   between app folders unless the task says so.
5. Branches, commits, and pull requests happen inside each app
   folder. A change that spans apps is one branch per app, all
   with the same branch name.
6. Never run `git add`, `git commit`, or `git push` from the workspace
   root for app code. The workspace `.gitignore` hides the app
   folders, so it would not work anyway.
7. Skills that apply to every app live in `.claude/skills/` here.
   Skills for one app live in that app's own `.claude/skills/`.
8. Each app holds one `README.md` at its root and no other
   documentation. Do not add any other markdown file, a `docs/`
   folder, a `CHANGELOG`, or design notes inside an app. The only
   other markdown file allowed is `AGENTS.md` at the app root.
   Shared documentation goes in the workspace `docs/` folder. A hook
   in `.claude/settings.json` blocks writes that break this rule, and
   `make check-docs` in each app fails if a stray file exists.
9. As an agent, do not add comments to code. This covers inline
   comments, block comments, notes such as `TODO` or `FIXME`, and
   commented-out code. Put any explanation in your reply to the user,
   not in the file. Leave existing comments as they are. This is a
   rule for agents only. It is not a code standard for the people who
   work in these repositories. Each app has its own lint rules for
   comments, and those rules decide what a human may write.
10. Documentation always goes in the workspace `docs/` folder, as a
    markdown file in this repository. Never write it as a hosted
    artifact, such as a Claude Doc or a claude.ai page. When the user
    asks for a doc, an explanation to keep, or notes on code, write
    a file in `docs/`, and give the user its path.

## The name

The product is named Govbase. Write `Govbase` in text, titles,
dashboards, alerts and messages. Write `govbase` where lowercase is
needed, such as in a host name, a package name, a metric name, a label
or a file path. Never write `GovBase` or any other spelling.

## Conventions every app follows

- An `AGENTS.md` at the app root with that app's rules. No
  `CLAUDE.md`.
- A `Makefile` at the app root with these targets:
  - `install` installs dependencies.
  - `check` runs format check, lint, type check, and tests. It exits
    non-zero on any failure.
- One `README.md` at the app root is the only documentation. The
  `check` target depends on `check-docs`, which fails if any other
  documentation file exists.

## Adding an app

1. Create its GitHub repository.
2. Add its folder name to `REPOS` in the `Makefile`.
3. Add a row to the table above.
4. Give it an `AGENTS.md`, a `README.md`, and a `Makefile` with
   `install`, `check`, and `check-docs`.

## Workspace commands

```
make clone           clone any app repo that is missing
make pull            git pull in every app folder
make status          git status in every app folder
make install         run make install in every app folder
make check           run check-agents, then make check in every app
make check-agents    fail if a CLAUDE.md hides the AGENTS.md files
```

A target only touches app folders that exist on disk, so you can
work with one app cloned and the rest absent.
