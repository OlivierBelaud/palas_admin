# IMPLEMENTATION_PROMPT.md — Paste this into Claude Code to start building

## Prompt

```
Read CLAUDE.md for your complete instructions.

You are the Framework Implementation Agent for the Manta framework. The tests are already written in tests/. Your job is to implement @manta/core and the dev adapters until all tests pass.

## Your workflow

1. Start with Batch 1 (MantaError, Container, MessageAggregator)
2. For each batch:
   a. Read the relevant SPECs from FRAMEWORK_SPEC.md
   b. Create the file structure described in CLAUDE.md
   c. Implement the code following the spec contracts
   d. Run the relevant conformance tests: `npx vitest run tests/conformance/<file>.test.ts`
   e. If tests fail → read the failure, fix the implementation, re-run
   f. If tests pass → log progress in IMPLEMENTATION_LOG.md, move to next batch

3. After ALL batches: run `npx vitest run` — everything must pass

## Critical rules:

- The tests are the contract. Make the tests pass. Do NOT modify tests.
- Use TypeScript strict mode, no `any`.
- Always throw MantaError, never raw Error.
- Check FRAMEWORK_SPEC.md before implementing each feature.
- Document decisions in IMPLEMENTATION_LOG.md.
- Follow the file structure exactly as described in CLAUDE.md.

## Environment setup (do this first):

1. Update root package.json to add workspaces:
   ```json
   { "workspaces": ["packages/*"] }
   ```

2. Create packages/core/package.json with dependencies (awilix, zod)

3. Run `npm install`

4. Verify tests infrastructure works:
   ```bash
   npx vitest run tests/conformance/cache.test.ts
   ```
   (Should fail with import errors — that's expected, it means vitest runs)

5. Start implementing Batch 1.

## Start now. Begin with Batch 1: MantaError + Container + MessageAggregator.
```
