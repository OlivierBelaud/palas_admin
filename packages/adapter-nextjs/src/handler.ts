// Next.js App Router route handler that forwards every request to Manta.
//
// Usage (in a consumer project):
//
//   // app/api/[...manta]/route.ts
//   export { GET, POST, PUT, DELETE, PATCH, OPTIONS } from '@manta/adapter-nextjs/handler'
//
// The Manta core speaks Web Fetch (IHttpPort.handleRequest(Request): Promise<Response>),
// which is exactly what Next App Router route handlers expect. Zero translation layer.

import { getMantaAdapter } from './bootstrap'

async function handler(req: Request): Promise<Response> {
  const adapter = await getMantaAdapter()
  return adapter.handleRequest(req)
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
export const OPTIONS = handler
export const HEAD = handler
