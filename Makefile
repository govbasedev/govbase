# Workspace Makefile. It never runs app tooling directly.
# It only calls `make <target>` inside each app folder that exists.

GITHUB_ORG   ?=
APPS_DIR     := apps
REPOS        := $(addprefix $(APPS_DIR)/,pipeline parser-sdk browser relay)
PRESENT      := $(wildcard $(REPOS))

.PHONY: help clone pull status install check check-agents

help:
	@echo "make clone           clone any app repo that is missing"
	@echo "make pull            git pull in every app folder"
	@echo "make status          git status in every app folder"
	@echo "make install         run make install in every app folder"
	@echo "make check           run make check in every app folder"
	@echo "make check-agents    fail if a CLAUDE.md hides the AGENTS.md files"
	@echo ""
	@echo "Present on disk: $(if $(PRESENT),$(PRESENT),none)"

clone:
	@if [ -z "$(GITHUB_ORG)" ]; then \
	  echo "GITHUB_ORG is not set. Run: make clone GITHUB_ORG=<org>"; exit 1; \
	fi
	@for repo in $(REPOS); do \
	  if [ -d "$$repo" ]; then \
	    echo "== $$repo already present"; \
	  else \
	    echo "== cloning $$repo"; \
	    git clone "git@github.com:$(GITHUB_ORG)/$$(basename $$repo).git" "$$repo" || exit 1; \
	  fi; \
	done

pull:
	@for repo in $(PRESENT); do \
	  echo "== $$repo"; git -C "$$repo" pull --ff-only || exit 1; \
	done

status:
	@for repo in $(PRESENT); do \
	  echo "== $$repo ($$(git -C "$$repo" branch --show-current 2>/dev/null || echo 'not a git repo'))"; \
	  git -C "$$repo" status --short 2>/dev/null; \
	done

install:
	@for repo in $(PRESENT); do \
	  echo "== $$repo"; $(MAKE) -C "$$repo" install || exit 1; \
	done

check: check-agents
	@for repo in $(PRESENT); do \
	  echo "== $$repo"; $(MAKE) -C "$$repo" check || exit 1; \
	done

# Claude Code reads AGENTS.md only when no CLAUDE.md or CLAUDE.local.md
# exists in the working folder or above it.
check-agents:
	@found=$$(find . -path '*/node_modules' -prune -o \
	  \( -name CLAUDE.md -o -name CLAUDE.local.md \) -print); \
	dir=$$(cd .. && pwd); \
	while [ "$$dir" != "/" ]; do \
	  for name in CLAUDE.md CLAUDE.local.md; do \
	    [ -f "$$dir/$$name" ] && found="$$found $$dir/$$name"; \
	  done; \
	  dir=$$(dirname "$$dir"); \
	done; \
	if [ -n "$$(echo $$found)" ]; then \
	  echo "check-agents: these files stop Claude Code from reading AGENTS.md:"; \
	  echo "$$found" | tr ' ' '\n' | sed '/^$$/d'; \
	  exit 1; \
	fi; \
	echo "check-agents: ok"
