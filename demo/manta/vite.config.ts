import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  root: path.resolve(__dirname, "src/admin"),
  base: "/admin/",
  plugins: [react()],
  resolve: {
    alias: {
      "@manta/dashboard": path.resolve(__dirname, "../../packages/dashboard/src/index.tsx"),
      "@manta/dashboard-core": path.resolve(__dirname, "../../packages/dashboard-core/src"),
      "@manta/dashboard-core/index.css": path.resolve(__dirname, "../../packages/dashboard-core/src/index.css"),
    },
  },
  server: {
    // Vite dev server port — proxied by the Manta backend
    port: 5199,
    strictPort: true,
    hmr: {
      // HMR connects through the Manta backend proxy
      port: 5199,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/admin"),
    emptyOutDir: true,
  },
})
