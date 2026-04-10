Fix the following issue: $ARGUMENTS

## Pipeline

### Step 0 — Think
Invoke @thinker-agent with the issue: "$ARGUMENTS"
If the root cause is architectural (wrong layer, wrong store, wrong pattern) → stop, surface the reframing to user via @reporter-agent before fixing anything.

### Step 1 — Diagnose
Read the relevant code. Understand the root cause. Do NOT start fixing yet.
If the issue is ambiguous, ask 1 question max.

### Step 2 — Classify
Is this a FRAMEWORK fix (`packages/*`) or APP fix (`demo/*`)?
- If FRAMEWORK → invoke @architect-agent to validate the approach before touching anything
- If APP → proceed directly to Step 3

### Step 3 — Fix
Invoke @builder-agent with the diagnosis and classification.
One fix. No cascades. Run check after.

### Step 4 — Validate
Invoke @qa-agent to confirm the fix works and nothing regressed.
If RED → back to builder-agent, max 2 retries before surfacing to user.

### Step 5 — Report
Invoke @reporter-agent. One paragraph max: what was broken, what was fixed, what was verified.

## Rules
- No spec document needed — this is a fix, not a feature
- No architecture debate unless it's a framework change
- Speed matters but correctness matters more — never skip QA
