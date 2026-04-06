# Creating Hosts

A host bridges Manta's HTTP adapter (H3Adapter) to a specific runtime or server framework. The default host is Nitro (which powers Nuxt). You can create hosts for Express, Fastify, Hono, AWS Lambda, Cloudflare Workers, etc.

## What a host does

1. Bootstraps the Manta app (calls `bootstrapApp()`)
2. Mounts the H3Adapter's routes on the target server
3. Handles request/response translation (if the target uses a different API than Web `Request`/`Response`)
4. Manages lifecycle (startup, shutdown, health checks)

## Default host: Nitro

Manta ships with a Nitro host (`packages/host-nitro/`). It:
- Starts a Nitro dev server with HMR
- Mounts the H3Adapter as middleware
- Handles the catch-all route `server/routes/[...].ts`
- Passes requests through to Manta's 12-step pipeline

## Creating a custom host

### Example: Express host

```typescript
// packages/manta-host-express/src/index.ts
import express from 'express'
import { bootstrapApp } from '@manta/cli/bootstrap'

export async function startExpressHost(options: { port?: number; cwd?: string } = {}) {
  const port = options.port ?? 3000
  const cwd = options.cwd ?? process.cwd()

  // Bootstrap the Manta app (same as manta dev / manta start)
  const { app, adapter, logger, shutdown } = await bootstrapApp({
    cwd,
    mode: 'production',
  })

  // Create Express app
  const server = express()

  // Mount Manta's H3 adapter — translate Express req/res to Web Request/Response
  server.all('*', async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const webRequest = new Request(url, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([_, v]) => v != null) as [string, string][],
      ),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    })

    const webResponse = await adapter.handleRequest(webRequest)

    res.status(webResponse.status)
    for (const [key, value] of webResponse.headers.entries()) {
      res.setHeader(key, value)
    }
    const body = await webResponse.text()
    res.send(body)
  })

  // Start
  server.listen(port, () => {
    logger.info(`Manta (Express) running at http://localhost:${port}`)
  })

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await shutdown()
    process.exit(0)
  })
}
```

### Example: AWS Lambda host

```typescript
// packages/manta-host-lambda/src/index.ts
import { bootstrapApp } from '@manta/cli/bootstrap'

let bootstrapped: Awaited<ReturnType<typeof bootstrapApp>> | null = null

export async function handler(event: APIGatewayProxyEventV2) {
  // Cold start: bootstrap once
  if (!bootstrapped) {
    bootstrapped = await bootstrapApp({ cwd: process.cwd(), mode: 'production' })
  }

  // Translate Lambda event to Web Request
  const url = `https://${event.requestContext.domainName}${event.rawPath}${event.rawQueryString ? '?' + event.rawQueryString : ''}`
  const request = new Request(url, {
    method: event.requestContext.http.method,
    headers: event.headers as Record<string, string>,
    body: event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf-8') : undefined,
  })

  // Delegate to Manta
  const response = await bootstrapped.adapter.handleRequest(request)

  // Translate back to Lambda response
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  }
}
```

## The host interface

A host must:

1. **Call `bootstrapApp()`** — This returns the fully wired `MantaApp` + `H3Adapter` + `logger` + `shutdown()`
2. **Translate requests** — Convert the target runtime's request format to Web `Request`, call `adapter.handleRequest(request)`, convert `Response` back
3. **Handle lifecycle** — Call `shutdown()` on SIGTERM/SIGINT for graceful cleanup (connection pools, pending jobs, etc.)

The H3Adapter's `handleRequest(request: Request): Promise<Response>` is the single entry point. It runs the full 12-step pipeline (auth, validation, routing, error handling).

## What the pipeline provides

Every request passing through `adapter.handleRequest()` goes through:

| Step | What it does |
|------|-------------|
| 1. RequestID | Adds correlation ID header |
| 2. CORS | Origin validation |
| 3. Rate limit | Sliding window by IP (if enabled) |
| 4. Scope | Creates AsyncLocalStorage context |
| 5. Body parser | Parses JSON body |
| 6. Auth | Extracts AuthContext from Bearer/API key/Cookie |
| 7. Publishable key | Adds to context (if applicable) |
| 8. Validation | Zod schema check (for commands) |
| 9. Custom | App-defined middleware |
| 10. RBAC | Role-based access (if enabled) |
| 11. Handler | Route execution |
| 12. Error handler | Catch + format MantaError → HTTP response |

## Naming convention

Published hosts: `manta-host-{runtime}`

Examples:
- `manta-host-express`
- `manta-host-fastify`
- `manta-host-hono`
- `manta-host-lambda`
- `manta-host-cloudflare`
- `manta-host-bun`
- `manta-host-deno`

Include `AGENT.md` with deployment instructions and `README.md` with setup docs.

## Package structure

```
manta-host-express/
├── src/
│   └── index.ts         # startExpressHost() + Lambda handler
├── package.json         # name: "manta-host-express"
├── AGENT.md             # AI instructions for deployment
└── README.md            # Setup & config docs
```
