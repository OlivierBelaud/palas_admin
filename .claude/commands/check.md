Run QA validation on the current state of the project. Do not implement or fix anything — only report.

Invoke @qa-agent with the following scope: $ARGUMENTS

If no scope is specified, validate everything:
- Full `pnpm run check` (lint + typecheck + tests)
- Playwright smoke test on the running dev server if available (navigate to the app, take a screenshot, check console for errors)
- Report any failures with exact error messages

## Output
One clear report:
- What passed
- What failed (with exact errors)
- What couldn't be checked (e.g. dev server not running)

No fixes. No suggestions. Just current state.
