## Git delivery and phase workflow

The user has authorized agents to manage branches, commits, pushes, PRs and merges in both repositories. Use `multi-tenancy` as the integration and delivery branch in each repository; never merge this work into `main` or change the GitHub default branch.

Start each approved phase from the current `multi-tenancy` tip. Use phase/work branches and isolated worktrees as needed. Finalize implementation, tests and independent reviews before creating the phase PR; target `multi-tenancy`. Merge the reviewed PR after checks pass without requesting another merge approval. Respect branch protections and preserve unrelated work. Finish with clean local `multi-tenancy` checkouts matching GitHub, completed issues closed in each repository's own tracker, and temporary worktrees removed.

Report the completed phase and wait for the user's explicit instruction before starting the next phase. Git authorization does not authorize production deployment, application-database migrations or real-account privilege grants.

## Agent skills

### Issue tracker

Issues and specs live in this repository's GitHub Issues.
Before working with tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels.
Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` and `docs/adr/`.
Before exploring the codebase, read `docs/agents/domain.md`.
