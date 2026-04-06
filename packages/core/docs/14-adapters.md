# Creating Adapters

An adapter is a concrete implementation of a port interface. The framework ships with in-memory adapters for dev and production adapters for cloud platforms. You can create your own for any service.

## Port interfaces

Every infrastructure concern is abstracted behind a port. Here are all ports you can implement:

| Port | Responsibility | Dev adapter | Prod adapter |
|------|---------------|-------------|--------------|
| `ICachePort` | Key-value cache | InMemoryCacheAdapter | UpstashCacheAdapter |
| `IEventBusPort` | Event pub/sub | InMemoryEventBusAdapter | Upstash Queues |
| `IFilePort` | File storage | InMemoryFileAdapter | VercelBlobAdapter |
| `ILoggerPort` | Structured logging | TestLogger | PinoLoggerAdapter |
| `ILockingPort` | Distributed locks | InMemoryLockingAdapter | Neon advisory locks |
| `IJobSchedulerPort` | Cron scheduling | InMemoryJobScheduler | VercelCronAdapter |
| `IDatabasePort` | Database connection | InMemoryDatabaseAdapter | DrizzlePgAdapter |
| `IHttpPort` | HTTP server | InMemoryHttpAdapter | H3Adapter |
| `IRepository` | Entity CRUD | InMemoryRepository | DrizzleRepository |
| `INotificationPort` | Notifications | InMemoryNotificationAdapter | (custom) |
| `IAuthPort` | JWT/API key crypto | MockAuthPort | (built-in) |

## Creating a cache adapter (example)

### 1. Implement the port interface

```typescript
// packages/manta-adapter-cache-redis/src/adapter.ts
import type { ICachePort } from '@manta/core'
import { MantaError } from '@manta/core'
import { createClient } from 'redis'

export interface RedisCacheOptions {
  url?: string
}

export class RedisCacheAdapter implements ICachePort {
  private client: ReturnType<typeof createClient>

  constructor(options: RedisCacheOptions = {}) {
    const url = options.url ?? process.env.REDIS_URL
    if (!url) throw new MantaError('INVALID_DATA', 'REDIS_URL is required for RedisCacheAdapter')
    this.client = createClient({ url })
  }

  async get(key: string): Promise<unknown> {
    const value = await this.client.get(key)
    return value ? JSON.parse(value) : null
  }

  async set(key: string, data: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(data)
    if (ttl) {
      await this.client.set(key, serialized, { EX: Math.ceil(ttl / 1000) })
    } else {
      await this.client.set(key, serialized)
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.client.del(key)
  }

  async clear(): Promise<void> {
    await this.client.flushDb()
  }
}
```

### 2. Create the barrel export

```typescript
// packages/manta-adapter-cache-redis/src/index.ts
export type { RedisCacheOptions } from './adapter'
export { RedisCacheAdapter } from './adapter'
```

### 3. Package metadata

```json
{
  "name": "manta-adapter-cache-redis",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "peerDependencies": { "@manta/core": ">=0.1.0" },
  "dependencies": { "redis": "^4.0.0" }
}
```

### 4. Register in config

```typescript
// manta.config.ts
export default defineConfig({
  adapters: {
    ICachePort: {
      adapter: 'manta-adapter-cache-redis',
      options: { url: process.env.REDIS_URL },
    },
  },
})
```

## Port interface reference

### ICachePort

```typescript
interface ICachePort {
  get(key: string): Promise<unknown>
  set(key: string, data: unknown, ttl?: number): Promise<void>
  invalidate(key: string): Promise<void>
  clear(): Promise<void>
}
```

### IEventBusPort

```typescript
interface IEventBusPort {
  emit(event: Message | Message[]): Promise<void>
  subscribe(eventName: string, handler: (event: Message) => Promise<void> | void, options?: { subscriberId?: string }): void
  unsubscribe(subscriberId: string): void
  releaseGroupedEvents(eventGroupId: string): Promise<void>
  clearGroupedEvents(eventGroupId: string): Promise<void>
}
```

### IFilePort

```typescript
interface IFilePort {
  upload(key: string, data: Buffer | ReadableStream, contentType?: string): Promise<{ key: string; url: string }>
  delete(key: string | string[]): Promise<void>
  getPresignedDownloadUrl(key: string): Promise<string>
  getDownloadStream(key: string): Promise<ReadableStream>
  getAsBuffer(key: string): Promise<Buffer>
  list(prefix?: string): Promise<string[]>
}
```

### ILockingPort

```typescript
interface ILockingPort {
  execute<T>(keys: string[], job: () => Promise<T>, options?: { timeout?: number }): Promise<T>
  acquire(keys: string | string[], options?: { ownerId?: string; expire?: number }): Promise<boolean>
  release(keys: string | string[], options?: { ownerId?: string }): Promise<void>
  releaseAll(options?: { ownerId?: string }): Promise<void>
}
```

### ILoggerPort

```typescript
interface ILoggerPort {
  error(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  setLogLevel(level: string): void
}
```

### IJobSchedulerPort

```typescript
interface IJobSchedulerPort {
  register(name: string, schedule: string, handler: (ctx: { app: MantaApp }) => Promise<JobResult>, options?: { concurrency?: 'allow' | 'forbid'; timeout?: number }): void
  runJob(name: string): Promise<JobResult>
  getJobHistory(jobName: string, limit?: number): Promise<JobExecution[]>
}
```

### IDatabasePort

```typescript
interface IDatabasePort {
  initialize(config: DatabaseConfig): Promise<void>
  dispose(): Promise<void>
  healthCheck(): Promise<boolean>
  getClient(): unknown
  getPool(): unknown
  transaction<T>(fn: (tx: unknown) => Promise<T>, options?: TransactionOptions): Promise<T>
}
```

## Naming convention

Published adapters: `manta-adapter-{port}-{implementation}`

Examples:
- `manta-adapter-cache-redis`
- `manta-adapter-cache-memcached`
- `manta-adapter-file-s3`
- `manta-adapter-file-gcs`
- `manta-adapter-eventbus-kafka`
- `manta-adapter-locking-redis`
- `manta-adapter-database-mysql` (if supported in the future)

Include `AGENT.md` with instructions for AI and `README.md` with setup/config docs.
