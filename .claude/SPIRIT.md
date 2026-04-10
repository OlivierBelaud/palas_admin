# Spirit of the Framework

This document defines what Manta IS and what it is NOT. Every agent in the pipeline must internalize these principles. The QA agent uses them as a checklist. The auditor enforces them.

## Core thesis

Manta is a **constraint-first framework**. The developer writes 9 `define*()` functions, and the framework generates everything else. The developer should NOT be able to make architectural mistakes.

## Two layers of enforcement

Framework principles (zero imports, constraint by design, module isolation, etc.) are enforced in two complementary ways:

### Layer A — Constraint by design (preferred)
TypeScript + framework architecture make violations impossible or surface them as compile errors:
- Services only receive their repository → impossible to call other modules
- Core primitives are globals → no imports needed
- Commands auto-generate HTTP routes → no manual routing
- etc.

When a principle is enforced by Layer A, it's invisible to the developer — the wrong thing simply cannot be expressed.

### Layer B — Radar (temporary, see `.claude/RADAR.md`)
When a principle cannot (yet) be enforced at the type level, a Biome lint rule detects violations and warns at edit time. Each Layer B rule is **temporary** — it documents a "gap in the framework" and can be removed once Layer A catches the pattern.

Rules:
- Prefer built-in Biome rules (`noRestrictedImports`, `noRestrictedGlobals`) over custom plugins
- Custom GritQL plugins only when built-ins don't fit
- Every Layer B rule must document its "Removable when" condition in RADAR.md
- If a rule has many false positives or generates noise, it's a sign the framework ergonomics need improvement (Layer A), not more lint rules

The goal is to shrink Layer B over time as Layer A gets better.

## Principles

### 1. Zero imports
All primitives (`defineModel`, `defineService`, `defineCommand`, `defineQuery`, `defineLink`, `defineSubscriber`, `defineJob`, `defineAgent`, `defineCommandGraph`, `defineQueryGraph`, `defineWorkflow`, `defineUserModel`, `defineMiddleware`, `defineMiddlewares`, `defineConfig`, `definePreset`) and helpers (`field`, `many`, `z`, `MantaError`, `service`) are globals. If a solution requires the developer to `import` something from `@manta/core`, it's wrong. The only exception is type imports for advanced TypeScript usage.

### 2. Constraint by design
The framework makes wrong things impossible, not just discouraged:
- Services only receive their own repository — **impossible** to call another module's DB
- Service methods **must** be compensable — no uncompensated mutations
- Commands **must** have name, description, input schema, workflow — no partial definitions
- Entity names **must** be camelCase — runtime error otherwise
- Duplicate modules/links/commands are detected and rejected

If a developer CAN bypass a constraint, the framework has a bug.

### 3. One artifact, many interfaces
A `defineCommand()` is simultaneously an HTTP endpoint, an AI tool, a dashboard action, a CLI command, and a programmable step. Solutions that only work for one interface (e.g., "add an HTTP route") violate this principle.

### 4. Filesystem is the API
Directory structure IS configuration. `src/modules/catalog/entities/product/model.ts` is discovered automatically. No registration, no barrel imports needed. If a solution requires manual registration, it's wrong.

### 5. Module isolation
- 1 module = N entities + N services (always paired). No exceptions.
- Services only access their own repository
- Cross-module data flow goes through `defineLink()` (data) and `defineCommand()` (orchestration)
- Module commands can only use their own module's steps
- Application commands (in `src/commands/`) can orchestrate any module

If a solution allows a service to reach into another module's data, it's wrong.

### 6. Compensation everywhere
Every mutation must be reversible. `defineService()` methods have `forward` and `compensate` functions. `defineCommand()` workflows are automatically compensated on failure. If a solution introduces a mutation without compensation, it needs justification.

### 7. AI-safe errors
Error messages must tell the developer (or AI agent) **what to do**, not just what went wrong. "Entity name must be camelCase. Use 'customerGroup' instead of 'customer_group'" — not just "Invalid entity name".

### 8. No framework lock-in
Modules are extractable, publishable, and ejectible. `manta extract` → `npm publish` → `manta eject`. If a solution couples the developer to framework internals, it's wrong.

## Anti-patterns to reject

| Anti-pattern | Why it's wrong | What to do instead |
|-------------|---------------|-------------------|
| Manual HTTP routes | Bypasses the multi-interface contract | Use `defineCommand()` |
| Direct DB access in commands | Bypasses compensation and module isolation | Use `step.service.*` |
| Importing from `@manta/core` in app code | Breaks the zero-import contract | Use globals |
| Cross-module service calls | Breaks module isolation | Use `defineLink()` + `defineCommand()` |
| Uncompensated mutations | Breaks rollback guarantees | Add compensate function |
| Manual registration/config | Breaks filesystem-as-API | Use directory conventions |
| Raw SQL in app code | Bypasses the service layer | Use `defineService()` methods |
| Feature flags for framework behavior | Adds complexity, hides bugs | Change the code directly |

## When reviewing code

Ask these questions:
1. Could a developer misuse this? If yes, can we make misuse impossible (not just documented)?
2. Does this work for all 5 interfaces (HTTP, AI, dashboard, CLI, step)?
3. Is there an import the developer has to remember? Can we eliminate it?
4. Would an AI agent reading the error message know exactly what to fix?
5. Is this extractable? Could someone `manta eject` and own this code?
