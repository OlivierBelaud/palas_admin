// SPEC-070 — manta init command

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import type { InitOptions } from '../types'

export interface InitCommandResult {
  exitCode: number
  created: string[]
  skipped: string[]
  warnings: string[]
}

const DIRS_TO_CREATE = [
  'src/api/admin',
  'src/api/store',
  'src/modules',
  'src/subscribers',
  'src/workflows',
  'src/jobs',
  'src/links',
]

/**
 * manta init — Initialize a new Manta project.
 * Never destroys existing files. Skips files that already exist.
 */
export async function initCommand(
  options: InitOptions = {},
): Promise<InitCommandResult> {
  const dir = resolve(options.dir ?? process.cwd())
  const result: InitCommandResult = { exitCode: 0, created: [], skipped: [], warnings: [] }

  // Create directories (idempotent)
  for (const d of DIRS_TO_CREATE) {
    mkdirSync(resolve(dir, d), { recursive: true })
  }

  // Generate files (only if they don't exist)
  const projectName = basename(dir)
  const files = getTemplateFiles(projectName)

  for (const [filename, content] of Object.entries(files)) {
    const filePath = resolve(dir, filename)
    if (existsSync(filePath)) {
      result.skipped.push(filename)
    } else {
      writeFileSync(filePath, content)
      result.created.push(filename)
    }
  }

  // If ALL files already exist
  if (result.created.length === 0 && result.skipped.length > 0) {
    // Nothing to do
  }

  return result
}

function getTemplateFiles(projectName: string): Record<string, string> {
  return {
    'manta.config.ts': `import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL!,
  },
  http: {
    port: Number(process.env.PORT) || 9000,
  },
})
`,
    '.env': `DATABASE_URL=postgresql://localhost:5432/manta_dev
PORT=9000
# JWT_SECRET=
# COOKIE_SECRET=
`,
    '.env.example': `DATABASE_URL=postgresql://localhost:5432/manta_dev
PORT=9000
# JWT_SECRET=
# COOKIE_SECRET=
`,
    'package.json': JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'manta dev',
          build: 'manta build',
          start: 'manta start',
          'db:generate': 'manta db:generate',
          'db:migrate': 'manta db:migrate',
        },
        dependencies: {
          '@manta/core': '^0.1.0',
          '@manta/cli': '^0.1.0',
        },
      },
      null,
      2,
    ) + '\n',
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src/**/*.ts', 'manta.config.ts'],
      },
      null,
      2,
    ) + '\n',
    'drizzle.config.ts': `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './drizzle/schema/*.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
`,
  }
}
