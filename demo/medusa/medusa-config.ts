import { loadEnv, defineConfig } from "@medusajs/framework/utils"
import path from "path"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// ──────────────────────────────────────────────
// Single QueryClient plugin
// Medusa form routes do relative imports of their own query-client module.
// This plugin intercepts those imports and redirects them to the dashboard-core
// createQueryClient, so the entire app shares one QueryClient instance.
// ──────────────────────────────────────────────

function singleQueryClientPlugin() {
  // Resolve the dashboard-core query-client module
  const coreQueryClientPath = path.resolve(
    __dirname,
    "../../packages/dashboard-core/src/lib/query-client.ts"
  )

  return {
    name: "single-query-client",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      // Only transform Medusa dashboard source files
      if (!id.includes("@medusajs/dashboard") && !id.includes("medusa-dashboard")) return null
      if (!code.includes("lib/query-client")) return null
      const replaced = code.replace(
        /from\s+["']([^"']*lib\/query-client)["']/g,
        `from "${coreQueryClientPath.replace(/\\/g, "/")}"`
      )
      if (replaced !== code) {
        return { code: replaced, map: null }
      }
      return null
    },
  }
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    vite: () => {
      // Resolve paths to form routes from the installed @medusajs/dashboard package
      const medusaDashboardRoot = path.dirname(
        require.resolve("@medusajs/dashboard/package.json")
      )
      const medusaDashboardSrc = path.join(medusaDashboardRoot, "src")
      const medusaRoutesDir = path.join(medusaDashboardSrc, "routes")
      const medusaI18nDir = path.join(medusaDashboardSrc, "i18n/translations")
      const medusaAdminSharedRoot = path.dirname(
        require.resolve("@medusajs/admin-shared/package.json")
      )

      return {
        plugins: [singleQueryClientPlugin()],
        server: {
          fs: {
            allow: [
              // Allow serving files from the monorepo root
              path.resolve(__dirname, "../.."),
            ],
          },
        },
        resolve: {
          alias: [
            // Replace the Medusa dashboard entry with our dashboard-medusa
            {
              find: "@medusajs/dashboard/css",
              replacement: path.resolve(
                __dirname,
                "../../packages/dashboard-core/src/index.css"
              ),
            },
            {
              find: "@medusajs/dashboard",
              replacement: path.resolve(
                __dirname,
                "../../packages/dashboard-medusa/src/index.tsx"
              ),
            },
            // Stub unresolvable Medusa plugin imports
            {
              find: "@medusajs/draft-order/admin",
              replacement: path.resolve(__dirname, "src/stubs/empty-plugin.ts"),
            },
            // Medusa dashboard source — providers, hooks used by form routes
            {
              find: "@medusa-dashboard-src",
              replacement: medusaDashboardSrc,
            },
            // Medusa internal packages — required by form route transitive imports
            {
              find: "@medusajs/admin-shared",
              replacement: path.join(medusaAdminSharedRoot, "src/index.ts"),
            },
            // Medusa form routes — lazy-loaded from installed @medusajs/dashboard
            {
              find: "@medusa-routes",
              replacement: medusaRoutesDir,
            },
            // Medusa translations — for i18n in form routes
            {
              find: "@medusa-i18n",
              replacement: medusaI18nDir,
            },
          ],
        },
      }
    },
  },
})
