import { defineNitroConfig } from "nitropack/config"
import { resolve } from "path"

export default defineNitroConfig({
  compatibilityDate: "2025-07-15",

  // Server directory with h3 route handlers
  srcDir: "server",

  // Static files — public/ is served as static assets
  publicAssets: [
    { dir: resolve(__dirname, "public"), baseURL: "/" },
  ],

  // Aliases so server code can import from src/ and workspace packages
  alias: {
    "~src": resolve(__dirname, "src"),
    "@manta/core/ports": resolve(__dirname, "../../packages/core/src/ports/index.ts"),
    "@manta/core/errors": resolve(__dirname, "../../packages/core/src/errors/manta-error.ts"),
    "@manta/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    "@manta/adapter-logger-pino": resolve(__dirname, "../../packages/adapter-logger-pino/src/index.ts"),
    "@manta/adapter-drizzle-pg": resolve(__dirname, "../../packages/adapter-drizzle-pg/src/index.ts"),
    "@manta/adapter-neon": resolve(__dirname, "../../packages/adapter-neon/src/index.ts"),
  },
})
