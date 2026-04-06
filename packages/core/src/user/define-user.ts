// defineUserModel() — An augmented defineModel that adds authentication.
//
// Used INSTEAD of defineModel when an entity represents a user that can log in.
// Returns a DmlEntity (like defineModel) + auth metadata.
// The framework auto-generates: auth routes, middleware, invite table, dev seed.
//
// Usage:
//   // src/modules/customer/entities/customer/model.ts
//   export default defineUserModel('customer', {
//     company_name: field.text().nullable(),
//     phone: field.text().nullable(),
//     has_account: field.boolean().default(false),
//   })
//
//   // src/modules/admin-user/entities/admin/model.ts
//   export default defineUserModel('admin', {
//     role: field.enum(['super_admin', 'editor', 'viewer']),
//   })

import { DmlEntity } from '../dml/entity'
import type { BaseProperty } from '../dml/properties/base'
import { BooleanProperty } from '../dml/properties/boolean'
import { DateTimeProperty } from '../dml/properties/date-time'
import { JSONProperty } from '../dml/properties/json'
import { TextProperty } from '../dml/properties/text'
import { MantaError } from '../errors/manta-error'

/**
 * What defineUserModel() returns — a DmlEntity augmented with auth metadata.
 * It's a valid DmlEntity (works with defineService, defineLink, queries, etc.)
 * AND it signals to the framework that this entity needs auth routes + middleware.
 */
export interface UserDefinition {
  /** Context name (e.g. 'admin', 'customer'). Also used as actor_type in JWT. */
  contextName: string
  /** DML entity for the user table — works like any defineModel entity. */
  model: DmlEntity<Record<string, unknown>>
  /** DML entity for the invite table. */
  inviteModel: DmlEntity<Record<string, unknown>>
  /** Actor type = contextName. */
  actorType: string
  /** Discriminator — tells the resource loader this is a user entity, not a regular model. */
  __type: 'user'
}

/** Base user fields — always included in every defineUserModel() entity. */
function baseUserFields(): Record<string, unknown> {
  return {
    first_name: new TextProperty().nullable().searchable(),
    last_name: new TextProperty().nullable().searchable(),
    email: new TextProperty().unique().searchable(),
    avatar_url: new TextProperty().nullable(),
    metadata: new JSONProperty().nullable(),
  }
}

/** Base invite fields — always included for every user context. */
function baseInviteFields(): Record<string, unknown> {
  return {
    email: new TextProperty().index(),
    accepted: new BooleanProperty().default(false),
    token: new TextProperty(),
    expires_at: new DateTimeProperty(),
    metadata: new JSONProperty().nullable(),
  }
}

/**
 * Define a user entity — an augmented defineModel with authentication.
 *
 * Used instead of `defineModel()` when the entity represents a user that can log in.
 * Place it in `src/modules/{mod}/entities/{entity}/model.ts` like any other entity.
 *
 * The framework auto-generates:
 * - Auth routes (login, logout, forgot-password, reset-password) on `/api/{contextName}/`
 * - CRUD routes (me, users, create-user, update-user, delete-user)
 * - Invite routes (create-invite, accept-invite, refresh-invite)
 * - Invite table (`{contextName}_invite`)
 * - Middleware (JWT + actor_type verification on `/api/{contextName}/*`)
 * - Dev seed (`{contextName}@manta.local` / `admin`)
 *
 * The entity itself works exactly like a defineModel entity:
 * - Has a defineService (optional)
 * - Can have defineLink relations
 * - Can be used in defineWorkflow
 * - Appears in the query graph
 *
 * @param contextName - The context name (e.g. 'admin', 'customer'). Must be lowercase.
 * @param customFields - Additional fields beyond the base user fields (optional).
 *
 * @example
 * ```typescript
 * // src/modules/customer/entities/customer/model.ts
 * export default defineUserModel('customer', {
 *   company_name: field.text().nullable(),
 *   phone: field.text().nullable(),
 *   has_account: field.boolean().default(false),
 * })
 * ```
 */
export function defineUserModel(
  contextName: string,
  customFields?: Record<string, BaseProperty<unknown> | unknown>,
): UserDefinition {
  if (!contextName) {
    throw new MantaError('INVALID_DATA', 'defineUserModel() requires a context name (e.g. "admin", "customer").')
  }
  if (contextName !== contextName.toLowerCase()) {
    throw new MantaError(
      'INVALID_DATA',
      `defineUserModel() context name "${contextName}" must be lowercase. Use "${contextName.toLowerCase()}" instead.`,
    )
  }

  // Build the PascalCase entity name: 'customer' → 'Customer', 'admin' → 'Admin'
  const pascalContext = contextName.charAt(0).toUpperCase() + contextName.slice(1)
  const inviteEntityName = `${pascalContext}Invite`

  // Merge base fields + custom fields
  const userFields = { ...baseUserFields(), ...(customFields ?? {}) }
  const inviteFields = baseInviteFields()

  // Create DML entities — the user entity name comes from the entity folder, not from defineUserModel
  // We use PascalContext as a fallback but the resource-loader will use the actual entity folder name
  const userModel = new DmlEntity(pascalContext, userFields)
  const inviteModel = new DmlEntity(inviteEntityName, inviteFields)

  return {
    contextName,
    model: userModel,
    inviteModel,
    actorType: contextName,
    __type: 'user',
  }
}
