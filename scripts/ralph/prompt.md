# Ralph Prompt — `intervals-spa`

You are working on the `intervals-spa` project: a React SPA backed by a Python FastAPI.

## Task

Work through the stories in `scripts/ralph/prd.json` in ascending `priority` order.

For each story:
1. Read the acceptance criteria.
2. Make the minimal code changes necessary to pass all criteria.
3. Run `make quality` to verify all quality gates pass.
4. Set `passes: true` for the story in `scripts/ralph/prd.json`.
5. Append a one-line summary to `scripts/ralph/progress.txt`.

## Rules

- Keep edits scoped to the active story.
- Preserve architectural import direction (see `AGENT.md` and `docs/ARCHITECTURE.md`).
- Do not bundle unrelated refactors.
- Update docs only when the story changes canonical contracts.
