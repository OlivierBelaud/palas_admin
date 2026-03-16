import { defineNitroConfig } from "nitropack/config"
import { resolve } from "path"

export default defineNitroConfig({
  compatibilityDate: "2026-03-16",

  // Deploy preset — Nitro compiles for Vercel serverless
  preset: "vercel",

  // Server directory with h3 route handlers
  srcDir: "server",

  // Aliases so server code can import from src/
  alias: {
    "~src": resolve(__dirname, "src"),
    "@manta/core/ports": resolve(__dirname, "../../packages/core/src/ports/index.ts"),
    "@manta/core/errors": resolve(__dirname, "../../packages/core/src/errors/manta-error.ts"),
    "@manta/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    "@manta/adapter-logger-pino": resolve(__dirname, "../../packages/adapter-logger-pino/src/index.ts"),
    "@manta/adapter-drizzle-pg": resolve(__dirname, "../../packages/adapter-drizzle-pg/src/index.ts"),
  },

  // Static files — admin dashboard goes in public/admin after Vite build
  publicAssets: [
    { dir: resolve(__dirname, "public"), baseURL: "/" },
  ],

  // SPA fallback for /admin/*
  routeRules: {
    "/admin/**": { prerender: false },
  },
})
