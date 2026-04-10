Use the following agents in sequence to implement the feature described in $ARGUMENTS. Do not ask the user for anything unless spec-agent determines it is strictly necessary (maximum 2 questions, only if truly ambiguous).

## Pipeline

### Step 0 — Think
Invoke @thinker-agent with the full request: "$ARGUMENTS"
If thinker-agent determines we're solving the wrong problem → stop, report to user via @reporter-agent with the reframing. Do not proceed until the request is confirmed or revised.

### Step 1 — Spec
Invoke @spec-agent with the full request: "$ARGUMENTS"
Wait for the spec to be complete before proceeding.

### Step 2 — Architecture
Invoke @architect-agent with the spec.
Wait for the implementation plan before proceeding.
If architect-agent sends the spec back to spec-agent, restart from Step 1 with the updated context.

### Step 3 — Parallel: Audit start
Invoke @auditor-agent to begin observing. It runs in parallel for the rest of the pipeline.

### Step 4 — Build
Invoke @builder-agent with the implementation plan.
If builder-agent reports RED after 3 attempts, stop and report to user via reporter-agent.

### Step 5 — QA
Invoke @qa-agent with the spec, implementation plan, and build report.
If qa-agent reports RED:
  - Send the blocking issues back to builder-agent
  - builder-agent fixes and re-reports
  - qa-agent re-validates
  - Maximum 3 QA cycles before escalating to user

### Step 6 — Audit complete
Signal @auditor-agent that the pipeline is complete.
Wait for the audit report.

### Step 7 — Report
Invoke @reporter-agent with all reports from all previous agents.
This is the only output shown to the user.

## Rules for orchestration
- Never show intermediate agent output to the user. Only reporter-agent talks to the user.
- If any agent is blocked and cannot continue, surface the blocker via reporter-agent immediately — do not spin in loops.
- The auditor-agent runs in parallel and does not block the pipeline.
- If a framework change is required (BOTH classification), always complete the framework change and its tests before implementing the app-level feature.
