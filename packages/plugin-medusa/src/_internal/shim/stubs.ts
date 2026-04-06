// MikroORM and Awilix stubs — no-ops for Manta (we use Drizzle + MantaApp)

// ====================================================================
// MikroORM decorator stubs
// ====================================================================

// biome-ignore lint/suspicious/noExplicitAny: polymorphic decorator stub
function mikroDecorator(opts?: any): any {
  if (opts === undefined || opts === null || typeof opts === 'object' || typeof opts === 'string') {
    // Factory mode: @Entity({}) or @Property({})
    // biome-ignore lint/suspicious/noExplicitAny: decorator stub
    return (target: any, _key?: any, desc?: any) => desc || target
  }
  // Direct mode: @Entity (no parens)
  return opts
}

export const Entity = mikroDecorator
export const Property = mikroDecorator
export const PrimaryKey = mikroDecorator
export const ManyToOne = mikroDecorator
export const OneToMany = mikroDecorator
export const ManyToMany = mikroDecorator
export const OneToOne = mikroDecorator
export const Index = mikroDecorator
export const Unique = mikroDecorator
export const Enum = mikroDecorator
export const Filter = mikroDecorator
export const BeforeCreate = mikroDecorator
export const BeforeUpdate = mikroDecorator
export const OnInit = mikroDecorator
export const Cascade = { ALL: 'ALL', PERSIST: 'PERSIST', MERGE: 'MERGE', REMOVE: 'REMOVE' }

// biome-ignore lint/suspicious/noExplicitAny: MikroORM wrap() stub
export const wrap = (entity: any) => ({
  assign: (data: Record<string, unknown>) => Object.assign(entity, data),
  toObject: () => ({ ...entity }),
  isInitialized: () => true,
  init: async () => entity,
})

// ====================================================================
// MikroORM PostgreSQL driver stubs
// ====================================================================
export class PostgreSqlDriver {}
export class PostgreSqlConnection {}
export class PostgreSqlPlatform {}

// ====================================================================
// Awilix stubs
// ====================================================================
export const asValue = (value: unknown) => ({ resolve: () => value })
export const asClass = (cls: new (...args: unknown[]) => unknown) => ({ resolve: () => new cls() })
export const asFunction = (fn: (...args: unknown[]) => unknown) => ({ resolve: fn })
export const Lifetime = { SINGLETON: 'SINGLETON', SCOPED: 'SCOPED', TRANSIENT: 'TRANSIENT' }
