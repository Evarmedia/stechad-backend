# Issue tracker: GitHub

Issues and specs live in this repository's GitHub Issues.
Use the gh CLI from this repository's directory.

## Conventions

- Verify the target with `gh repo view --json nameWithOwner`.
  It must match this repository's origin remote.
- Create: `gh issue create --title "..." --body-file <path>`.
  Use a file for multiline bodies.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,labels`.
  Add label or state filters as needed.
- Comment: `gh issue comment <number> --body-file <path>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."`
  or `--remove-label "..."`.
- Close: post the explanation as a comment, then run
  `gh issue close <number>`.
- Use native sub-issues and issue dependencies when supported.
  Otherwise, put `Part of #<parent>` and `Blocked by: #<number>`
  near the top of child issues and maintain a task list in the parent.
  An issue is unblocked when every blocker is closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the referenced issue.

## Wayfinding operations

- Map: an issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child: an issue linked to the map, labelled `wayfinder:<type>`
  where type is research, prototype, grilling, or task.
- Frontier: open, unblocked, unassigned children; first in map order wins.
- Claim: assign the issue to yourself before starting work.
- Resolve: comment with the answer, close the issue, and append
  a brief finding and issue link to the map's Decisions-so-far.
