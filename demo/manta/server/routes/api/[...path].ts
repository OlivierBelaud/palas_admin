// Catch-all Nitro handler for /api/** routes
// Boots the Manta container once via shared singleton, then dispatches

import { defineEventHandler, getMethod, readBody, getRequestURL } from "h3"
import { getContainer } from "../../lib/container"

// Lazy-loaded route modules
const routeModules = {
  "admin/products": () => import("~src/api/admin/products/route"),
  "admin/products/[id]": () => import("~src/api/admin/products/[id]/route"),
  "admin/registry": () => import("~src/api/admin/registry/route"),
  "admin/test": () => import("~src/api/admin/test/route"),
  "admin/crons": () => import("~src/api/admin/crons/route"),
}

// Route matching
function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = pathname.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]
    if (p.startsWith("[") && p.endsWith("]")) {
      params[p.slice(1, -1)] = pathParts[i]
    } else if (p !== pathParts[i]) {
      return null
    }
  }
  return params
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const method = getMethod(event)
  const fullPath = url.pathname
  const apiPath = fullPath.replace(/^\/api\//, "")

  // Match route
  for (const [pattern, loader] of Object.entries(routeModules)) {
    const params = matchRoute(pattern, apiPath)
    if (!params) continue

    const mod = await loader()
    const handlerFn = (mod as any)[method] || (mod as any)[method.toUpperCase()]
    if (!handlerFn) continue

    const { container, logger } = await getContainer()
    const scope = { resolve: <T = unknown>(key: string): T => container.resolve<T>(key) }

    let body = undefined
    if (method !== "GET" && method !== "HEAD") {
      try { body = await readBody(event) } catch {}
    }

    const req = new Request(url.toString(), { method })
    Object.defineProperty(req, "validatedBody", { value: body, enumerable: true })
    Object.defineProperty(req, "params", { value: params, enumerable: true })
    Object.defineProperty(req, "scope", { value: scope, enumerable: true })
    Object.defineProperty(req, "requestId", { value: crypto.randomUUID(), enumerable: true })

    logger.info(`[manta:nitro] ${method} ${fullPath}`)
    const response = await handlerFn(req)

    const responseBody = await response.text()
    event.node.res.statusCode = response.status || 200
    response.headers?.forEach((value: string, key: string) => {
      event.node.res.setHeader(key, value)
    })
    return responseBody
  }

  event.node.res.statusCode = 404
  return { type: "NOT_FOUND", message: "Route not found" }
})
