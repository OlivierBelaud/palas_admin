# ORCHESTRATOR_PROMPT.md — Paste this into Claude Code to start

## Prompt

```
Read CLAUDE.md for your complete instructions.

You are the Test Generation Orchestrator for the Manta framework. Your job is to generate the complete test suite for all ports, integration scenarios, and edge cases defined in the spec documents.

## Your workflow

Execute the 3-phase process described in CLAUDE.md (WRITE → REVIEW → FIX) for each batch of test files, in the order specified.

### Step-by-step execution:

1. **Start with Batch 1** (cache, logger, locking, file conformance suites)

2. For each test file in the batch:
   a. Read the relevant sections from FRAMEWORK_SPEC.md and TEST_STRATEGY.md
   b. Write the complete test file following CLAUDE.md conventions
   c. Self-review: check every test ID exists, assertions match specs, cleanup is present
   d. If issues found, fix them immediately (up to 3 iterations)
   e. If something is ambiguous, document it in CLARIFICATIONS.md and proceed

3. After completing each batch, update COVERAGE_REPORT.md with the SPECs covered

4. Move to the next batch and repeat

5. After ALL batches are done:
   a. Do a final cross-check: every SPEC in FRAMEWORK_SPEC.md appears in COVERAGE_REPORT.md
   b. Every test ID in TEST_STRATEGY.md has an `it()` block somewhere
   c. CLARIFICATIONS.md is complete
   d. Write a summary at the top of COVERAGE_REPORT.md with stats

## Critical rules:

- NEVER block on ambiguity. Make a choice, document it in CLARIFICATIONS.md, move on.
- Use Vitest, not Jest.
- Every `it()` block has a traceability comment (test ID + SPEC reference).
- Tests are written against interfaces (@manta/core types), not implementations.
- Use @manta/testing helpers (createTestContainer, withScope, spyOnEvents, etc.)
- All timing tests use vi.useFakeTimers(), never real delays.
- Files go in tests/ directory as specified in CLAUDE.md.

## Start now. Begin with Batch 1: conformance/cache.test.ts
```
