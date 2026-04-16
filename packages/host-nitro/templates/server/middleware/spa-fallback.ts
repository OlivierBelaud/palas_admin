// SPA fallback middleware — runs BEFORE route handlers.
// In dev mode, proxies SPA routes (e.g. /admin/paniers) to Vite dev server
// with Accept: text/html so Vite returns index.html for client-side routing.

import { defineEventHandler, setResponseHeader } from 'h3'

export default defineEventHandler(async (event) => {
  const pathname = event.path ?? ''
  const vitePort = process.env.__MANTA_VITE_PORT

  // Only in dev (vitePort set), only GET, only SPA sub-routes (not root, not API, not files)
  if (!vitePort) return
  if (event.method !== 'GET') return
  if (pathname === '/admin' || pathname === '/admin/') return // root is handled by devProxy
  if (!pathname.startsWith('/admin/')) return
  if (pathname.startsWith('/api/')) return
  if (pathname.match(/\.\w{2,5}$/)) return // skip .js, .css, .png etc

  // Fetch from Vite with Accept: text/html — triggers Vite's SPA fallback
  try {
    const viteRes = await fetch(`http://localhost:${vitePort}${pathname}`, {
      headers: { Accept: 'text/html' },
    })
    if (viteRes.ok) {
      const html = await viteRes.text()
      setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
      return html
    }
  } catch {
    // Vite not ready yet — fall through
  }
})
