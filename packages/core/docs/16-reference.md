# API Reference

## define*() functions

### defineModel(name, schema)

```typescript
function defineModel<Schema>(name: string, schema: Schema): DmlEntity<Schema>
```

### defineService(entitySelector, factory, options?)

```typescript
function defineService<E, Methods>(
  entitySelector: (model: ModelRegistry) => DmlEntity<E>,
  factory: (db: TypedRepository<InferEntity<E>>) => Methods,
  options?: { publicMethods?: (keyof Methods & string)[] },
): ServiceDescriptor<E, Methods>
```

### defineCommand(config)

```typescript
function defineCommand<TOutput, TSchema extends z.ZodType>(config: {
  name: string
  description: string
  input: TSchema
  workflow: (input: z.output<TSchema>, ctx: { step: TypedStep; app: MantaApp }) => Promise<TOutput>
}): CommandDefinition<z.output<TSchema>, TOutput>
```

### defineSubscriber(config)

```typescript
function defineSubscriber<T>(config: {
  event: string | string[]
  subscriberId?: string
  handler: (ctx: { event: Message<T>; app: MantaApp }) => Promise<void> | void
}): SubscriberDefinition<T>
```

### defineJob(config)

```typescript
function defineJob<TResult>(config: {
  name: string
  schedule: string  // cron expression
  handler: (ctx: { app: MantaApp }) => Promise<TResult>
}): JobDefinition<TResult>
```

### defineLink(selector, extraColumns?)

```typescript
function defineLink(
  selector: (model: ModelRegistry) => [DmlEntity | Many<DmlEntity>, DmlEntity | Many<DmlEntity>],
  extraColumns?: Record<string, Property>,
): ResolvedLink
```

### defineContext(config)

```typescript
function defineContext(config: {
  name: string
  basePath: string
  actors: string[]
  modules?: Record<string, { expose: '*' | string[]; public?: boolean }>
  commands?: string[]
  ai?: { enabled: boolean; commands?: string[] }
}): ContextDefinition
```

### defineConfig(config?)

```typescript
function defineConfig(config?: Partial<MantaConfig>): MantaConfig
```

## Helpers

### field property types

| Factory | Returns | TS type |
|---------|---------|---------|
| `field.text()` | `TextProperty` | `string` |
| `field.number()` | `NumberProperty` | `number` |
| `field.boolean()` | `BooleanProperty` | `boolean` |
| `field.float()` | `FloatProperty` | `number` |
| `field.bigNumber()` | `BigNumberProperty` | `number` |
| `field.serial()` | `AutoIncrementProperty` | `number` |
| `field.dateTime()` | `DateTimeProperty` | `Date` |
| `field.json()` | `JSONProperty` | `Record<string, unknown>` |
| `field.enum(values)` | `EnumProperty` | Union |
| `field.array()` | `ArrayProperty` | `unknown[]` |

Modifiers: `.nullable()`, `.unique()`, `.indexed()`, `.searchable()`, `.default(v)`

### many(entity)

```typescript
function many(entity: DmlEntity): Many<DmlEntity>
```

Cardinality modifier for `defineLink()`. See [Links](./07-links.md).

### Globals

All `define*` functions and helpers are globals — zero imports needed:

| Global | Purpose |
|--------|---------|
| `defineModel`, `defineService`, `defineLink`, `defineCommand` | Core primitives |
| `defineAgent`, `defineSubscriber`, `defineJob`, `defineContext` | Extended primitives |
| `defineConfig` | Configuration |
| `field` | Property type factory |
| `many` | Cardinality modifier |
| `z` | Zod schema builder |
| `service` | Service method wrapper |

### service.method(forward, compensate)

```typescript
function method<Args, R>(
  handler: (...args: Args) => Promise<R>,
  compensate: (result: R, ...args: Args) => Promise<void>,
): CompensableMethod
```

### makeIdempotent(cache, handler, options?)

```typescript
function makeIdempotent<T>(
  cache: ICachePort,
  handler: (event: Message<T>) => Promise<void>,
  options?: { keyFn?: (event: Message<T>) => string; ttl?: number },
): (event: Message<T>) => Promise<void>
```

## step API

Used inside `defineCommand({ workflow: (input, { step }) => {...} })`:

### step.service.MODULE

```typescript
step.service.catalog.create(data)           // → Promise<Entity>
step.service.catalog.update(id, data)       // → Promise<Entity>
step.service.catalog.delete(id)             // → Promise<DeleteResult>
step.service.catalog.activate(id)           // → Promise<unknown> (custom method)
step.service.catalog.link.inventoryItem()   // → Promise<{ linkId: string }>
```

### step.command

```typescript
step.command.createProduct(input)           // → Promise<CommandResult>
```

### step.action

```typescript
step.action('name', {
  invoke: async (input) => result,
  compensate: async (result) => void,
})(input)                                   // → Promise<TOutput>
```

### step.emit

```typescript
step.emit('event.name', data)               // → Promise<void>
```

## MantaApp interface

```typescript
interface MantaApp {
  id: string                          // UUID for correlation
  modules: MantaAppModules            // Typed module services
  workflows: Record<string, Function> // Registered workflows
  commands: Record<string, Function>  // Registered command callables
  infra: MantaInfra                   // Infrastructure ports
  emit(eventName: string, data: unknown): Promise<void>
  resolve<T>(key: string): T          // Dynamic access
  dispose(): Promise<void>            // Graceful shutdown
}
```

## MantaInfra

```typescript
interface MantaInfra {
  eventBus: IEventBusPort
  logger: ILoggerPort
  cache: ICachePort
  locking: ILockingPort
  file: IFilePort
}
```

## MantaError types

| Type | HTTP status | Usage |
|------|-------------|-------|
| `NOT_FOUND` | 404 | Entity not found |
| `INVALID_DATA` | 400 | Validation failure |
| `DUPLICATE_ERROR` | 409 | Unique constraint violation |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `CONFLICT` | 409 | Concurrent modification |
| `UNKNOWN_MODULES` | 500 | Module not found in registry |
| `INVALID_STATE` | 500 | Framework state error |
| `UNEXPECTED_STATE` | 500 | Unexpected condition |
| `NOT_IMPLEMENTED` | 501 | Feature not available |

## Key types

### Message<T>

```typescript
interface Message<T = unknown> {
  eventName: string
  data: T
  metadata: {
    timestamp: number
    auth_context?: AuthContext
    eventGroupId?: string
    transactionId?: string
    idempotencyKey?: string
    source?: string
  }
}
```

### AuthContext

```typescript
interface AuthContext {
  actor_type: string    // 'customer', 'admin', etc.
  actor_id: string      // User ID
  auth_identity_id?: string
  scope?: string
  session_id?: string
  app_metadata?: Record<string, unknown>
}
```

### ServiceConfig

```typescript
interface ServiceConfig {
  select?: string[]
  relations?: string[]
  withDeleted?: boolean
  order?: Record<string, 'ASC' | 'DESC'>
  skip?: number
  take?: number
}
```

## Port interfaces (for type annotations)

```typescript
import type {
  IEventBusPort,    // emit(message), subscribe(event, handler)
  ICachePort,       // get(key), set(key, value, ttl), invalidate(key)
  ILockingPort,     // acquire(key, ttl), release(key)
  IFilePort,        // upload(key, data), download(key), delete(key), list(prefix)
  ILoggerPort,      // debug(msg), info(msg), warn(msg), error(msg)
  IAuthPort,        // verifyJwt(token), createJwt(context)
  IRepository,      // find, create, update, delete, softDelete, restore
} from '@manta/core'
```
