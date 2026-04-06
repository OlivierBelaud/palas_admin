# Manta + Nuxt — AI Agent Instructions

You are working in a **Nuxt project with Manta backend**. The frontend is Nuxt (Vue, auto-imports). The backend is Manta — a tool-first runtime for AI agents with an integrated database.

## Stack

- **Frontend**: Nuxt 3 (Vue 3, auto-imports, Nitro server)
- **Backend**: Manta (CQRS commands, DML models, compensable workflows)
- **Database**: PostgreSQL (managed by Manta)
- **API**: Auto-generated from Manta commands and contexts

## How they connect

Nuxt calls Manta's auto-generated API endpoints via `$fetch` or `useFetch`:

```typescript
// In a Nuxt page or composable:
const { data: posts } = await useFetch('http://localhost:9000/api/store/query/blog', {
  method: 'POST',
  body: { filters: { status: 'published' }, limit: 10 },
})

// Execute a command:
const result = await $fetch('http://localhost:9000/api/admin/command/create-post', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: { title: 'Hello World', slug: 'hello-world', content: '...' },
})
```

## Manta backend structure

The Manta backend lives alongside Nuxt:

```
my-app/
├── pages/                # Nuxt pages (frontend)
├── components/           # Nuxt components
├── composables/          # Nuxt composables
├── server/               # Nuxt server routes (if needed)
├── src/                  # Manta backend
│   ├── modules/
│   │   └── blog/
│   │       ├── entities/
│   │       │   └── post/
│   │       │       ├── model.ts
│   │       │       └── service.ts
│   │       └── index.ts
│   ├── commands/
│   ├── subscribers/
│   ├── jobs/
│   ├── links/
│   └── contexts/
├── manta.config.ts       # Manta configuration
├── nuxt.config.ts        # Nuxt configuration
└── AGENT.md              # This file
```

## Manta backend rules

Same rules as standalone Manta. See documentation links below.

### The 8 primitives

| Function | Purpose | Location |
|----------|---------|----------|
| `defineModel()` | Data entity schema | `src/modules/{mod}/entities/{entity}/model.ts` |
| `defineService()` | Mutations with compensation | `src/modules/{mod}/entities/{entity}/service.ts` |
| `defineCommand()` | Workflow entry point | `src/commands/{name}.ts` |
| `defineSubscriber()` | Event reaction | `src/subscribers/{name}.ts` |
| `defineJob()` | Cron task | `src/jobs/{name}.ts` |
| `defineLink()` | Cross-module relation | `src/links/{name}.ts` |
| `defineContext()` | API surface | `src/contexts/{name}.ts` |
| `defineConfig()` | Configuration | `manta.config.ts` |

### Critical rules

1. **No API routes in Manta** — Commands are the API. Use Nuxt `server/` routes only for frontend-specific needs.
2. **1 entity = 1 service** — `model.ts` + `service.ts` per entity.
3. **Compensation is mandatory** in `service.method()`.
4. **Use `step.service.*` in commands**.
5. **Entity names are PascalCase**.

## Running both

```bash
# Terminal 1: Manta backend
manta dev

# Terminal 2: Nuxt frontend
nuxt dev
```

## Documentation

Complete Manta documentation in `node_modules/@manta/core/docs/` — see [00-overview.md](node_modules/@manta/core/docs/00-overview.md) to start.

**Read the relevant doc BEFORE writing Manta backend code.**
