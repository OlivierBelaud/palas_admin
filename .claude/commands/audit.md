Run a full audit of the current state of the project. Do not implement anything.

## What to audit

### 1. Agent system health
- Read all files in `.claude/agents/`
- Are the agent contracts still accurate given the current codebase?
- Are there gaps — tasks that happen repeatedly with no dedicated agent?
- Flag any contract that seems outdated or incomplete

### 2. CLAUDE.md accuracy
- Read `CLAUDE.md`
- Cross-check against actual project structure (`packages/`, `demo/`, config files)
- Flag anything that's wrong, missing, or outdated

### 3. Test coverage gaps
- Look at recent changes (modified files in `packages/` and `demo/`)
- Are there untested behaviors?
- Are there acceptance criteria in specs (if any exist) with no corresponding test?

### 4. Documentation gaps
- Is there complex code with no documentation?
- Are there public APIs with no usage examples?

### 5. Technical debt
- Workarounds, `// TODO`, `// FIXME`, bypasses of framework patterns
- Flag but do NOT fix — just report

### 6. Build health
- Run `pnpm run check`
- Report current status

## Output

Produce a structured report via @reporter-agent:

---
## Audit report — [date]

**Agent system**: [health assessment + specific issues]
**CLAUDE.md**: [accurate / issues found]
**Test gaps**: [list]
**Doc gaps**: [list]
**Tech debt**: [list — location + description]
**Build status**: GREEN | RED

**Recommended actions** (priority order):
1. [most important]
2. ...
---

Do not fix anything during an audit. Flag, report, prioritize.
