# Manta Test Generation System — Setup & Usage

## What's in this folder

```
test-agents/
├── CLAUDE.md              ← Master instructions for Claude Code (the orchestrator)
├── ORCHESTRATOR_PROMPT.md ← The exact prompt to paste into Claude Code to start
├── CLARIFICATIONS.md      ← Pre-seeded with known ambiguities + empty section for runtime discoveries
├── COVERAGE_REPORT.md     ← Traceability matrix template (SPEC → Test)
└── README.md              ← This file
```

## Setup — Before Running

### Step 1: Create the project folder

Create a folder for the test generation project, e.g. `manta-tests/`

### Step 2: Copy your spec documents + @manta/testing package

Place these files in the root of `manta-tests/`:

```
manta-tests/
├── FRAMEWORK_SPEC.md        ← (your existing file)
├── TEST_STRATEGY.md          ← (your existing file)
├── BOOTSTRAP_SEQUENCE.md     ← (your existing file)
├── ADAPTERS_CATALOG.md       ← (your existing file)
├── MIGRATION_STRATEGY.md     ← (your existing file)
├── CLAUDE.md                 ← (from test-agents/ folder)
├── CLARIFICATIONS.md         ← (from test-agents/ folder)
├── COVERAGE_REPORT.md        ← (from test-agents/ folder)
├── packages/
│   └── testing/              ← (the manta-testing/ folder — rename to testing/)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── core-types.ts   ← All port interfaces (ICachePort, IEventBusPort, etc.)
│           └── index.ts        ← All in-memory implementations + helpers
└── tests/                    ← (empty — Claude Code will populate it)
```

### Step 3: Create the tests directory

```bash
mkdir -p tests/{conformance,integration,strict-mode,migration,plugin}
```

### Step 4: Initialize the project

```bash
cd manta-tests
npm init -y
npm install -D vitest typescript
```

Create a `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@manta/testing": ["./packages/testing/src/index.ts"]
    }
  },
  "include": ["tests/**/*.ts", "packages/**/*.ts"]
}
```

Create a `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@manta/testing': path.resolve(__dirname, './packages/testing/src/index.ts'),
    },
  },
})
```

This wires up `@manta/testing` so all test imports resolve to the real in-memory implementations.

### Step 5: Open Claude Code in the project folder

```bash
cd manta-tests
claude
```

### Step 6: Paste the orchestrator prompt

Open `ORCHESTRATOR_PROMPT.md` and paste the prompt content into Claude Code.
Claude Code will read `CLAUDE.md` and begin generating tests batch by batch.

## What happens next

1. Claude Code generates test files in `tests/` following the batch order
2. For each file, it self-reviews and fixes issues (up to 3 iterations)
3. Ambiguities are logged in `CLARIFICATIONS.md`
4. Coverage is tracked in `COVERAGE_REPORT.md`
5. When complete, you'll have:
   - ~32 test files covering 253+ test cases
   - A complete traceability matrix
   - A list of decisions and items needing your review

## After Completion

1. Review `CLARIFICATIONS.md` for any `[NEEDS_HUMAN]` items
2. Review `COVERAGE_REPORT.md` for any ❌ or ⚠️ items
3. The test files serve as the **contract** for implementing the framework
4. As you implement each port/adapter, the conformance suite tells you when you're done

## Expected Output Volume

| Category | Files | Test cases |
|----------|-------|------------|
| Conformance suites | 19 | ~180 |
| Integration tests | 10 | ~40 |
| Strict mode | 1 | 6 |
| Migration | 1 | 16 |
| Plugin | 1 | 4 |
| **Total** | **32** | **~246** |

## Troubleshooting

- **Claude Code stops mid-batch**: Just tell it "Continue where you left off. Check COVERAGE_REPORT.md for progress."
- **Claude Code generates Jest syntax**: Remind it "Use Vitest, not Jest. Check CLAUDE.md."
- **A test seems wrong**: Check CLARIFICATIONS.md — there may be a documented decision about it.
- **Missing SPECs in coverage**: Tell Claude Code "Check COVERAGE_REPORT.md and fill in any missing SPECs."
