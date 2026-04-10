// SPA entry point generator — generates .manta/spa/{name}/ with:
// - index.html (auto-generated)
// - entry.tsx (imports dashboard shell + routes)
// - routes.ts (filesystem-derived routing)
// - vite.config.ts (Vite build config)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { DiscoveredSpa } from '../resource-loader'

export interface SpaGenerateOptions {
  cwd: string
  spa: DiscoveredSpa
  dashboard?: string
  preset?: string
  /** Backend server port (from PORT env or default 3000) */
  port?: number
}

/**
 * Generate all build artifacts for a SPA.
 * Returns the path to the generated vite.config.ts.
 */
export function generateSpaArtifacts(options: SpaGenerateOptions): string {
  const { cwd, spa, dashboard, preset, port = 3000 } = options
  const outDir = resolve(cwd, '.manta', 'spa', spa.name)
  mkdirSync(outDir, { recursive: true })

  // Generate routes.ts
  writeFileSync(join(outDir, 'routes.ts'), generateRoutes(spa, cwd))

  // Generate entry.tsx
  writeFileSync(join(outDir, 'entry.tsx'), generateEntry(spa, cwd, outDir, dashboard, preset))

  // Generate index.html
  writeFileSync(join(outDir, 'index.html'), generateHtml(spa))

  // Generate vite.config.ts
  const viteConfigPath = join(outDir, 'vite.config.ts')
  writeFileSync(viteConfigPath, generateViteConfig(spa, cwd, outDir, dashboard, preset, port))

  return viteConfigPath
}

function generateRoutes(spa: DiscoveredSpa, cwd: string): string {
  const lines = [
    '// Auto-generated — do not edit',
    `// Pages discovered from src/spa/${spa.name}/`,
    '',
    "import { lazy } from 'react'",
    '',
  ]

  // Config import (defineSpa)
  if (spa.configPath) {
    const relPath = relative(resolve(cwd, '.manta', 'spa', spa.name), spa.configPath).replace(/\.ts$/, '')
    lines.push(`import spaConfig from '${relPath}'`)
    lines.push('')
  }

  const imports: string[] = []
  const routeDefs: string[] = []
  const specImports: string[] = []
  const specDefs: string[] = []

  for (const page of spa.pages) {
    const varName = routeToVarName(page.route)
    const relPath = relative(resolve(cwd, '.manta', 'spa', spa.name), page.path).replace(/\.tsx?$/, '')
    const isSpec = page.path.endsWith('.ts') && !page.path.endsWith('.tsx')

    if (isSpec) {
      // Spec page (definePage/defineForm) — static import
      specImports.push(`import ${varName}Spec from '${relPath}'`)
      specDefs.push(`  { route: '${page.route}', spec: ${varName}Spec },`)
    } else {
      // React page — lazy import
      imports.push(`const ${varName} = lazy(() => import('${relPath}'))`)
      routeDefs.push(`  { path: '${page.route}', component: ${varName} },`)
    }
  }

  // Block imports
  const blockImports: string[] = []
  const blockDefs: string[] = []
  for (const block of spa.blocks) {
    const relPath = relative(resolve(cwd, '.manta', 'spa', spa.name), block.path).replace(/\.tsx?$/, '')
    blockImports.push(`import ${block.type} from '${relPath}'`)
    blockDefs.push(`  '${block.type}': ${block.type},`)
  }

  lines.push(...specImports)
  lines.push(...imports)
  if (blockImports.length > 0) {
    lines.push('')
    lines.push(...blockImports)
  }
  lines.push('')

  // Export React routes (legacy)
  lines.push('export const routes = [')
  lines.push(...routeDefs)
  lines.push(']')
  lines.push('')

  // Export spec pages (definePage/defineForm)
  lines.push('export const pageSpecs = [')
  lines.push(...specDefs)
  lines.push(']')
  lines.push('')

  // Export custom blocks
  if (blockDefs.length > 0) {
    lines.push('export const customBlocks = {')
    lines.push(...blockDefs)
    lines.push('}')
  } else {
    lines.push('export const customBlocks = {}')
  }
  lines.push('')

  // Export SPA config
  if (spa.configPath) {
    lines.push('export { spaConfig }')
  } else {
    lines.push('export const spaConfig = null')
  }
  lines.push('')

  // Export command schemas (for form validation)
  const schemasPath = relative(
    resolve(cwd, '.manta', 'spa', spa.name),
    resolve(cwd, '.manta', 'command-schemas'),
  ).replace(/\\/g, '/')
  lines.push(`export { commandSchemas } from '${schemasPath}'`)
  lines.push('')

  return lines.join('\n')
}

function generateEntry(spa: DiscoveredSpa, cwd: string, _outDir: string, dashboard?: string, preset?: string): string {
  // When @manta/dashboard is the dashboard shell, generate an entry that uses MantaDashboard
  // which provides the full admin shell (sidebar, auth, registry, etc.)
  if (dashboard === '@manta/dashboard') {
    // Resolve the CSS path relative to the generated entry file
    let cssImport = '// @manta/dashboard-core CSS not found'
    try {
      const pkgDir = dirname(require.resolve('@manta/dashboard-core/package.json', { paths: [cwd] }))
      const cssPath = join(pkgDir, 'src', 'index.css').replace(/\\/g, '/')
      cssImport = `import '${cssPath}'`
    } catch {
      /* not found */
    }

    const lines = [
      '// Auto-generated — do not edit',
      "import { Suspense } from 'react'",
      "import { createRoot } from 'react-dom/client'",
      "import { MantaDashboard } from '@manta/dashboard'",
      "import { routes, pageSpecs, customBlocks, spaConfig, commandSchemas } from './routes'",
      cssImport,
      '',
      'const apiUrl = window.location.origin',
      '',
      '// Convert filesystem routes to React Router route objects (wrapped in Suspense for lazy loading)',
      'const customRoutes = routes.map((r) => ({',
      "  path: r.path === '/' ? undefined : r.path.replace(/^\\//, ''),",
      '  element: <Suspense fallback={null}><r.component /></Suspense>,',
      '}))',
      '',
      "createRoot(document.getElementById('root')!).render(",
      `  <MantaDashboard apiUrl={apiUrl} basename="/${spa.name}" customRoutes={customRoutes} pageSpecs={pageSpecs} customBlocks={customBlocks} spaConfig={spaConfig} commandSchemas={commandSchemas} />,`,
      ')',
      '',
    ]
    return lines.join('\n')
  }

  // Fallback: bare BrowserRouter for custom SPAs without a dashboard shell
  const lines = [
    '// Auto-generated — do not edit',
    "import React, { Suspense } from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import { BrowserRouter, Routes, Route } from 'react-router-dom'",
    "import { routes } from './routes'",
  ]

  if (preset && preset !== '@manta/ui') {
    lines.push(`import '${preset}/styles.css'`)
  }

  lines.push('')
  lines.push('function App() {')
  lines.push(`  return (
    <BrowserRouter basename="/${spa.name}">
      <Suspense fallback={<div>Loading...</div>}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={<r.component />} />
          ))}
        </Routes>
      </Suspense>
    </BrowserRouter>
  )`)

  lines.push('}')
  lines.push('')
  lines.push("createRoot(document.getElementById('root')!).render(<App />)")
  lines.push('')

  return lines.join('\n')
}

function generateHtml(spa: DiscoveredSpa): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${spa.name.charAt(0).toUpperCase() + spa.name.slice(1)}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./entry.tsx"></script>
</body>
</html>
`
}

function generateViteConfig(
  spa: DiscoveredSpa,
  cwd: string,
  outDir: string,
  dashboard?: string,
  _preset?: string,
  port = 3000,
): string {
  const lines = [
    `import { defineConfig } from 'vite'`,
    `import react from '@vitejs/plugin-react'`,
    `import tailwindcss from '@tailwindcss/vite'`,
    '',
    `export default defineConfig({`,
    `  root: '${outDir.replace(/\\/g, '/')}',`,
    `  base: '/${spa.name}/',`,
    `  appType: 'spa',`,
    `  plugins: [`,
    `    react(),`,
    `    tailwindcss(),`,
    `    {`,
    `      name: 'manta-trailing-slash',`,
    `      configureServer(server) {`,
    `        server.middlewares.use((req, _res, next) => {`,
    `          if (req.url === '/${spa.name}') req.url = '/${spa.name}/'`,
    `          next()`,
    `        })`,
    `      },`,
    `    },`,
    `  ],`,
    `  server: {`,
    `    hmr: true,`,
    `    strictPort: true,`,
    `    proxy: {`,
    `      '/api': {`,
    `        target: 'http://localhost:${port}',`,
    `        changeOrigin: true,`,
    `      },`,
    `    },`,
    `  },`,
    `  build: {`,
    `    outDir: '${resolve(cwd, 'public', spa.name).replace(/\\/g, '/')}',`,
    `    emptyOutDir: true,`,
    `  },`,
    `  resolve: {`,
    `    alias: {`,
    `      '~spa': '${spa.path.replace(/\\/g, '/')}',`,
  ]

  // Deduplicate React — monorepo packages may resolve different copies
  // Point to the package directory so sub-path imports (react/jsx-runtime) still work
  for (const reactPkg of ['react', 'react-dom']) {
    try {
      const pkgDir = dirname(require.resolve(`${reactPkg}/package.json`, { paths: [cwd] })).replace(/\\/g, '/')
      lines.push(`      '${reactPkg}': '${pkgDir}',`)
    } catch {
      /* not found */
    }
  }

  // Resolve Manta packages for Vite alias
  const pkgsToResolve = ['@manta/sdk', '@manta/ui', '@manta/dashboard-core']
  if (dashboard) pkgsToResolve.push(dashboard)

  for (const pkg of pkgsToResolve) {
    try {
      const pkgDir = dirname(require.resolve(`${pkg}/package.json`, { paths: [cwd] }))
      const srcDir = join(pkgDir, 'src').replace(/\\/g, '/')
      // Detect actual entry file — some packages use .tsx, others .ts
      const hasTsx = existsSync(join(pkgDir, 'src', 'index.tsx'))
      const entryFile = hasTsx ? 'src/index.tsx' : 'src/index.ts'
      // Exact import → entry file, sub-path imports (e.g. /index.css) → src directory
      lines.push(`      '${pkg}': '${join(pkgDir, entryFile).replace(/\\/g, '/')}',`)
      lines.push(`      '${pkg}/': '${srcDir}/',`)
    } catch {
      // Not resolved — let Vite handle it
    }
  }

  lines.push(`    },`)
  lines.push(`  },`)
  lines.push(`})`)

  return lines.join('\n')
}

function routeToVarName(route: string): string {
  if (route === '/') return 'PageHome'
  return (
    'Page' +
    route
      .split('/')
      .filter(Boolean)
      .map((s) =>
        s
          .replace(/^:/, '')
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(''),
      )
      .join('')
  )
}
