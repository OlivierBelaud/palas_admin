// Demo app config — loaded by `manta dev`

export default {
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/manta_demo',
    pool: { min: 2, max: 10 },
  },
  http: { port: 9001 },
  admin: {
    // Enable admin dashboard on /admin
    enabled: true,
    // Vite dev server port (auto-spawned in dev mode)
    vitePort: 5174,
  },
  appEnv: 'dev',
}
