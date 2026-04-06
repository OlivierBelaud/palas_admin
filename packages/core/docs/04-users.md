# Users — defineUserModel()

`defineUserModel()` is an augmented `defineModel()` for entities that represent users who can log in. It creates a regular entity (with services, links, workflows, query graph access) AND auto-generates auth routes, middleware, and an invite system.

Use it **instead of** `defineModel()` in a module's `entities/{entity}/model.ts`.

## Declaration

```typescript
// src/modules/admin/entities/admin/model.ts
export default defineUserModel('admin', {
  role: field.enum(['super_admin', 'editor', 'viewer']),
  department: field.text().nullable(),
})
```

```typescript
// src/modules/customer/entities/customer/model.ts
export default defineUserModel('customer', {
  company_name: field.text().nullable(),
  phone: field.text().nullable(),
  has_account: field.boolean().default(false),
})
```

The entity works exactly like a `defineModel` entity — it can have a `service.ts`, be used in `defineLink`, appear in `defineWorkflow`, and is accessible in the query graph. The only difference is the auto-generated auth layer.

## What it generates

### Tables

**`admin_user`** — base fields + your custom fields:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `email` | text | Unique, indexed |
| `first_name` | text | Nullable |
| `last_name` | text | Nullable |
| `avatar_url` | text | Nullable |
| `metadata` | JSON | Nullable |
| `role` | enum | Custom field |
| `department` | text | Custom field |
| `created_at` | timestamp | Auto |
| `updated_at` | timestamp | Auto |
| `deleted_at` | timestamp | Soft-delete |

**`admin_invite`** — invitation records:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `email` | text | Indexed |
| `accepted` | boolean | Default: false |
| `token` | text | Random UUID, 7-day expiry |
| `expires_at` | timestamp | |
| `metadata` | JSON | Nullable |

### Auth routes

All on `/api/admin/`:

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/login` | POST | Public | Email/password → JWT (`{ id, type: 'admin' }`) |
| `/logout` | DELETE | Public | Blacklists token in cache |
| `/refresh` | POST | Public | Exchange refresh token for new JWT |
| `/forgot-password` | POST | Public | Generates reset token |
| `/reset-password` | POST | Public | Validates token + resets password |
| `/accept-invite` | POST | Public | Accepts invite, creates user + auth |
| `/me` | GET | Required | Returns current user from `admin_user` |
| `/users` | GET | Required | Lists all `admin_user` records |
| `/create-user` | POST | Required | Creates user + auth identity |
| `/update-user` | POST | Required | Updates user fields |
| `/delete-user` | POST | Required | Soft-deletes user |
| `/create-invite` | POST | Required | Creates invitation with 7-day token |
| `/refresh-invite` | POST | Required | Regenerates invite token |

### Middleware

All `/api/admin/*` routes (except public auth routes):
1. Verify JWT Bearer token
2. Check `auth.type === 'admin'`
3. Reject with 401/403 if invalid

### Dev seed

In dev mode: `admin@manta.local` / `admin` created automatically.

## Multiple user types

```typescript
// src/modules/admin/entities/admin/model.ts
export default defineUserModel('admin', {
  role: field.enum(['super_admin', 'editor']),
})

// src/modules/customer/entities/customer/model.ts — in a module with other entities
export default defineUserModel('customer', {
  company_name: field.text().nullable(),
  phone: field.text().nullable(),
})
// The customer module can also have: customer-address, customer-group entities,
// links, workflows — defineUserModel is just a model, in a regular module.
```

Each user type has independent: tables, auth routes, middleware, JWT actor type.

## Override auto-generated routes

Create a command in `src/commands/{context}/` with the same name:

```typescript
// src/commands/admin/login.ts — replaces auto-generated login
export default defineCommand({
  name: 'login',
  description: 'Custom admin login with 2FA',
  input: z.object({ email: z.string(), password: z.string(), totp: z.string() }),
  workflow: async (input, { step }) => {
    // Custom 2FA logic
  },
})
```

## Override middleware

Create `src/middleware/{context}.ts`:

```typescript
// src/middleware/admin.ts — replaces auto-generated middleware
export default defineMiddleware(async (req, next) => {
  const auth = await req.verifyAuth('admin')
  if (!auth) throw new MantaError('UNAUTHORIZED')

  // Custom RBAC
  if (auth.entity.role === 'viewer' && req.method !== 'GET') {
    throw new MantaError('FORBIDDEN', 'Viewers have read-only access')
  }

  return next()
})
```

## Auth context in handlers

Commands and queries receive the authenticated user:

```typescript
workflow: async (input, { step, auth, headers }) => {
  // auth.id — user ID (from admin_user.id)
  // auth.type — 'admin'
  // auth.email — user email
  // headers['x-property-id'] — custom header
}
```

## JWT structure

The JWT is signed with `JWT_SECRET` (env variable). It contains:
- `id` — user ID from the context's user table
- `type` — context name (e.g., 'admin')
- `auth_identity_id` — internal auth identity reference
- `email` — user email

The JWT cannot be tampered with (signature verification). Token expiry: 1h access + 30d refresh.
