// SPA fallback for /admin/* — serves index.html for all admin routes
// React Router handles the client-side routing

import { defineEventHandler, sendStream, setResponseHeader } from "h3"
import { createReadStream, existsSync } from "fs"
import { resolve } from "path"

export default defineEventHandler((event) => {
  // Try to serve the static file first (assets, etc.)
  const url = event.path || ""
  const staticPath = resolve("public/admin", url.replace(/^\/admin\/?/, ""))

  if (existsSync(staticPath) && !staticPath.endsWith("/")) {
    // Let Nitro's static handler serve it
    return
  }

  // For all other /admin/* routes, serve index.html (SPA fallback)
  const indexPath = resolve("public/admin/index.html")
  if (existsSync(indexPath)) {
    setResponseHeader(event, "content-type", "text/html")
    return sendStream(event, createReadStream(indexPath))
  }

  // Fallback if no index.html built
  return "<!DOCTYPE html><html><body><p>Admin dashboard not built. Run: npx vite build</p></body></html>"
})
