# Constraints — Constraint as Convention

## Philosophy

Manta follows a **"you can't make mistakes"** approach. The framework doesn't tell you "don't do X" — it makes X **structurally impossible**. When something is caught at runtime, the error message tells you exactly **what to do** to fix it.

This is designed for AI-first development: an AI reading these error messages can fix the issue in one pass.

## Structural constraints (impossible to bypass)

### Module isolation

**Service isolation:** `defineService('entity', ({ db, log }) => ({...}))` receives **only `{ db, log }`** (typed repository + logger). You cannot:
- Import another module's service
- Access `app` or `app.modules.*`
- Call external APIs

The TypeScript type system enforces this — `db: TypedRepository<T>` has no escape hatch.

**Module command isolation:** Commands in `src/modules/catalog/commands/` can ONLY use `step.service.catalog.*`. They cannot reference other modules' services. The step proxy in a module command only resolves the module's own entities. If you try to call `step.service.inventory.*` from a catalog module command, it will fail.

**Why?** Modules must be self-contained. Cross-module orchestration happens in **application commands** (`src/commands/`) which have no scope restriction.

### Compensation is automatic

Service methods are plain `async` functions. The framework auto-snapshots repository state before every mutation. In a workflow, if a step fails, all previous steps are automatically rolled back using the snapshots. No manual compensation logic needed.

```typescript
// Just write plain async functions — compensation is handled by the framework
activate: async (id: string) => {
  await db.update({ id, status: 'active' })
}
```

### step.action requires compensation

```typescript
// Runtime error: step.action("charge") requires a compensate function
step.action('charge', { invoke: async () => {...} })

// Correct:
step.action('charge', {
  invoke: async () => { ... },
  compensate: async (result) => { ... },
})
```

### Plugin-module separation

**Plugins CANNOT contain modules.** This is enforced at two levels:

1. **Build-time validation (`manta build`):** The build scans every plugin package. If a plugin contains `defineModel()` calls, the build fails:

```
Plugin "manta-plugin-ecommerce" contains entity definitions (found defineModel("Customer")
in commands/create-customer.ts). Plugins cannot embed modules.

Modules must be published as separate packages (manta-module-customer) and declared
as peerDependencies of the plugin.

Fix: extract the module first with `manta extract module customer`, then reference it
as a dependency in the plugin's package.json.
```

2. **Extract-time validation (`manta extract plugin`):** The CLI refuses to include entities or services in a plugin package. It prompts you to extract modules first.

**Why?** Modules are the fundamental data unit — independently publishable, versionable, ejectible. If a plugin embedded modules, they'd be locked inside. This constraint forces a healthy ecosystem where modules are reusable across plugins.

## Validation at definition time

Every `define*()` validates its arguments immediately. Errors are thrown when the file is loaded, not when the feature is used.

### defineModel / DmlEntity

| Validation | Error message |
|-----------|--------------|
| Empty name | `Entity name is required. Usage: defineModel("Product", { title: field.text() })` |
| Lowercase | `Entity name must be PascalCase (got "product"). Change to "Product"` |
| Empty schema | `Entity "X" must have at least one property. Add properties with field.text(), field.number(), etc.` |
| Reserved column | `Property "id" is implicit and cannot be redefined in entity "X"` |
| Reserved prefix | `Property "raw_price" uses reserved "raw_" prefix (reserved for bigNumber shadow columns)` |

### defineCommand

| Validation | Error message |
|-----------|--------------|
| Missing name | `Command name is required. Usage: defineCommand({ name: '...', description: '...', input: z.object({...}), workflow: async (input, { step }) => {...} })` |
| Missing description | `Command "X" requires a description (used for AI tool discovery and documentation)` |
| Missing input | `Command "X" requires an input Zod schema. Use z.object({}) for commands with no input.` |
| Missing workflow | `Command "X" workflow must be an async function: workflow: async (input, { step }) => {...}` |

### defineSubscriber

| Validation | Error message |
|-----------|--------------|
| Empty event | `Subscriber event must be a non-empty string or array` |
| Non-function handler | `Subscriber handler must be a function` |

### defineJob

| Validation | Error message |
|-----------|--------------|
| Missing name | `Job name is required` |
| Missing schedule | `Job schedule (cron expression) is required` |
| Non-function handler | `Job handler must be a function` |

### defineLink

| Validation | Error message |
|-----------|--------------|
| Missing entities | `Link requires exactly two entities in the selector tuple` |

### defineConfig

Validates `http`, `auth`, and `query` sections via Zod schemas. Errors include field path and issue:

```
Invalid http config:
  - port: Number must be greater than or equal to 1
```

## Duplicate detection

| Duplicate | When detected | Error |
|-----------|--------------|-------|
| Two modules with same name | `registerModule()` | `Module "X" is already registered. Each module name must be unique.` |
| Two commands with same name | `CommandRegistry.register()` | `Command "X" is already registered` |
| Two links between same entities | `defineLink()` | `Link between "X" and "Y" is already defined (table: "Z").` |
| Two queries with same name in same context | `QueryRegistry.register()` | `Query "X" is already registered in context "Y"` |

## Runtime protection

### Service method validation

At boot, when services are instantiated, every custom method is checked:

```
Service method "activate" on entity "Product" must be an async function.
```

### Service resolution in workflows

When `step.service.catalog.activate(id)` is called and the service doesn't exist:

```
Service for "catalog" not found. Available modules: [catalog, inventory, stats].
Check that the module is in src/modules/ and contains a service.ts with defineService().
```

### Link resolution

When auto-linking fails because an entity hasn't been created yet:

```
Cannot link: no Product created yet in this workflow. Call step.service.product.create() first.
```

### Command input validation

Invalid input returns HTTP 400 with Zod details:

```json
{
  "type": "INVALID_DATA",
  "message": "Validation failed",
  "details": [
    { "path": ["price"], "message": "Number must be greater than or equal to 0" }
  ]
}
```

## What an AI should know

1. **Every error message tells you what to do.** Read it, follow the instruction.
2. **If TypeScript complains, it's a real error.** The type system catches missing compensation, wrong entity names, invalid configs.
3. **If a define*() throws, the file has a problem.** Fix the arguments, not the framework.
4. **Module isolation is absolute.** Don't try to import from another module's directory. Use commands for cross-module orchestration.
5. **Module commands are scoped.** A command in `src/modules/catalog/commands/` can ONLY use `step.service.catalog.*`. For cross-module, use `src/commands/`.
6. **Application commands are unrestricted.** A command in `src/commands/` can call any module via `step.service.*` and any module command via `step.command.*`.
7. **Soft-delete is automatic.** All reads filter `deleted_at IS NULL`. Use `withDeleted: true` only when you need to see deleted records.
8. **Installed modules have AGENT.md.** When you encounter a Manta module in `node_modules/`, read its `AGENT.md` first — it explains what the module does, how to use it, and what events it emits.
9. **Package naming convention.** Modules: `manta-module-{name}`. Plugins: `manta-plugin-{name}`. Adapters: `manta-adapter-{port}-{impl}`. Always "manta" in the name — this enables automatic discovery on npm.
10. **Plugins NEVER contain modules.** A plugin is orchestration only (commands, subscribers, jobs, links, contexts). Entities and services MUST be in separate module packages. If you're building a plugin and need entities, extract them as a module first.
