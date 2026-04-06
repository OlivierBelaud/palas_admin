# Getting Started

## Prerequisites

- Node.js 18+ (AsyncLocalStorage required)
- PostgreSQL (local or cloud — Neon, Supabase, etc.)
- pnpm

## Create a project

```bash
manta init my-app
cd my-app
pnpm install
```

This creates:

```
my-app/
├── manta.config.ts
├── .env
├── src/
│   ├── modules/
│   ├── commands/
│   ├── subscribers/
│   ├── jobs/
│   ├── links/
│   └── contexts/
├── drizzle/migrations/
└── tsconfig.json
```

## Step 1 — Configure the database

Edit `.env`:

```
DATABASE_URL=postgresql://localhost:5432/my_app
```

Create the database:

```bash
manta db:create
```

## Step 2 — Define a model

Create `src/modules/blog/entities/post/model.ts`:

```typescript
export default defineModel('Post', {
  title: field.text(),
  slug: field.text().unique(),
  content: field.text(),
  status: field.enum(['draft', 'published', 'archived']),
  published_at: field.dateTime().nullable(),
})
```

## Step 3 — Define the service

Create `src/modules/blog/entities/post/service.ts`:

```typescript
export default defineService(
  (model) => model.post,
  (db) => ({
    publish: service.method(
      async (id: string) => {
        const [post] = await db.find({ where: { id } })
        const previousStatus = post.status
        await db.update({ id, status: 'published', published_at: new Date() })
        return { previousStatus }
      },
      async (result, id: string) => {
        await db.update({ id, status: result.previousStatus, published_at: null })
      },
    ),
  }),
)
```

This gives you 8 CRUD methods for free + the custom `publish` method. No imports needed — `defineService`, `service`, and `model` are all globals.

## Step 4 — Define a command

Create `src/commands/create-post.ts`:

```typescript
export default defineCommand({
  name: 'create-post',
  description: 'Create a new blog post',
  input: z.object({
    title: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    content: z.string(),
    publish: z.boolean().default(false),
  }),
  workflow: async (input, { step }) => {
    const post = await step.service.blog.create({
      title: input.title,
      slug: input.slug,
      content: input.content,
      status: 'draft',
    })

    if (input.publish) {
      await step.service.blog.publish(post.id)
    }

    await step.emit('post.created', { id: post.id, slug: input.slug })

    return { id: post.id, slug: input.slug, status: input.publish ? 'published' : 'draft' }
  },
})
```

## Step 5 — Define a subscriber (optional)

Create `src/subscribers/post-created.ts`:

```typescript
export default defineSubscriber({
  event: 'post.created',
  handler: async ({ event, app }) => {
    const { slug } = event.data as { slug: string }
    app.infra.logger.info(`New post created: ${slug}`)
  },
})
```

## Step 6 — Define a context

Create `src/contexts/admin.ts`:

```typescript
export default defineContext({
  name: 'admin',
  basePath: '/api/admin',
  actors: ['admin'],
  modules: {
    blog: { expose: '*' },
  },
  commands: ['create-post'],
  ai: { enabled: true },
})
```

## Step 7 — Generate migrations and run

```bash
manta db:generate     # Creates SQL migration from Post model
manta db:migrate      # Applies migration to database
```

## Step 8 — Start the dev server

```bash
manta dev
```

Output:
```
  [codegen] .manta/types/ (1 modules, 3 events)
  Module: blog (Post) ✓
  Subscriber: post.created → post-created ✓
  Command: create-post ✓
  Context: admin → /api/admin ✓

  Server running at http://localhost:9000
  API docs at http://localhost:9000/api/docs
```

## Step 9 — Test it

Create a post:
```bash
curl -X POST http://localhost:9000/api/admin/command/create-post \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "title": "Hello World",
    "slug": "hello-world",
    "content": "My first Manta post",
    "publish": true
  }'
```

Query posts:
```bash
curl -X POST http://localhost:9000/api/admin/query/blog \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{"filters": {"status": "published"}}'
```

View API docs:
```
open http://localhost:9000/api/docs
```

## What happened automatically

From your 4 files (model, service, command, context), Manta generated:

- PostgreSQL table `posts` with all columns + indexes
- 8 CRUD methods on `app.modules.blog`
- HTTP endpoint `POST /api/admin/command/create-post`
- HTTP endpoint `POST /api/admin/query/blog`
- AI tool schema for `create-post` (Zod → JSON Schema)
- OpenAPI spec with full schema documentation
- TypeScript types for autocomplete (`.manta/types/`)
- Event wiring for `post.created` subscriber
- Compensation logic (if create-post fails, the post is deleted)

## Next steps

- Add more modules (see [Models](./02-models.md) and [Services](./03-services.md))
- Add cross-module relations (see [Links](./07-links.md))
- Add scheduled tasks (see [Events](./06-events.md))
- Expose a storefront API (see [Contexts](./08-contexts.md))
- Deploy to production (see [Config](./09-config.md))
