# Radar rules

Layer B — temporary lint rules that catch anti-patterns TypeScript cannot express at the type level. Each rule documents WHY it exists and WHEN it can be removed (when Layer A makes the pattern impossible).

## Active rules

### R-01: No `@manta/core` imports in app code
- **Tool**: Biome `noRestrictedImports` (built-in)
- **Scope**: `demo/**/*.ts`, `demo/**/*.tsx`
- **Why**: Manta's 9 primitives are globals (zero imports). Apps should never import from `@manta/core` directly.
- **Escape hatch**: `manta.config.ts` (runs before globals are injected), value exports not yet exposed as globals (e.g. `MantaError`, `defineCommandGraph`). Use `// biome-ignore lint/style/noRestrictedImports: <reason>` per line.
- **Removable when**: type imports are also automated (e.g., via `tsc --declaration` auto-generating globals for editors) AND `MantaError`/`defineCommandGraph`/`defineConfig` are also exposed as globals.

### R-02: No raw `fetch()` in SPA React code
- **Tool**: Biome `noRestrictedGlobals` (built-in)
- **Scope**: `demo/**/*.tsx`, `demo/**/src/spa/**/*.ts`
- **Why**: `@manta/sdk` provides `useCommand`/`useQuery`/`useGraphQuery` hooks with caching, typing, and error handling.
- **Removable when**: `fetch` is not needed because the SDK covers all HTTP interactions by design.

### R-03: No raw `throw new Error()` in app code
- **Tool**: Biome GritQL plugin (`.claude/biome-plugins/no-raw-error.grit`)
- **Scope**: `demo/**/*.ts` (excluding `*.test.*` and `/tests/`). Scoping is enforced inside the GritQL plugin via `$filename <: includes "demo/"` because Biome plugins are loaded globally (not per `overrides` entry).
- **Why**: `MantaError` carries a typed error category (`INVALID_DATA`, `NOT_FOUND`, etc.) that the framework uses for HTTP status mapping, CLI exit codes, and AI tool error reporting.
- **Removable when**: `MantaError.internal(message)` shortcut exists and is as ergonomic as `new Error()`.

## Closed rules (constrained by design)

### R-04: No raw HTTP routes for mutations
- **Status**: Closed — constrained by design (Layer A).
- **Why**: `host-nitro` generates HTTP routes from `defineCommand()` declarations. There is no convention for apps to write raw `api/` route files. The escape hatch simply doesn't exist.
- **If escape hatch is added later**: reopen this rule.

## How to add a new rule

1. Identify an anti-pattern that violates SPIRIT.md
2. Check if Layer A (types, constraint by design) can prevent it
3. If not, add a Layer B rule here with `Tool`, `Scope`, `Why`, and `Removable when`
4. Prefer built-in Biome rules over GritQL over manual enforcement
