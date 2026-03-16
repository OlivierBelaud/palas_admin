// SPEC-070 — CLI program definition with Commander
// Glue between Commander argv parsing and command functions

import { resolve } from 'node:path'
import { Command } from 'commander'
import { loadEnv } from './config/load-env.js'
import { loadConfig, validateConfigForCommand } from './config/load-config.js'
import { resolveAdapters } from './config/resolve-adapters.js'
import { initCommand } from './commands/init.js'
import { devCommand } from './commands/dev.js'
import { startCommand } from './commands/start.js'
import { buildCommand } from './commands/build.js'
import { execCommand } from './commands/exec.js'
import { generateCommand } from './commands/db/generate.js'
import { migrateCommand } from './commands/db/migrate.js'
import { rollbackCommand } from './commands/db/rollback.js'
import { diffCommand } from './commands/db/diff.js'
import { createCommand } from './commands/db/create.js'
import {
  createPgClient,
  createPgCreateDeps,
  createMigrationLock,
  createMigrationTracker,
  createMigrationFs,
} from './commands/db/pg-deps.js'
import type { LoadedConfig } from './types.js'

const VERSION = '0.1.0'

const NOT_AVAILABLE_V1 = [
  'plugin',
  'user',
  'migrate-from-medusa',
]

/**
 * Resolve profile from APP_ENV / NODE_ENV.
 */
function resolveProfile(config?: LoadedConfig): 'dev' | 'prod' {
  const appEnv = config?.appEnv ?? process.env['APP_ENV']
  if (appEnv === 'prod' || appEnv === 'production') return 'prod'
  if (appEnv === 'dev' || appEnv === 'development') return 'dev'

  const nodeEnv = process.env['NODE_ENV']
  if (nodeEnv === 'production') return 'prod'
  return 'dev'
}

/**
 * Load config and validate for a given command.
 * Returns the loaded config or exits with error.
 */
async function loadAndValidate(
  command: string,
  cwd: string,
): Promise<LoadedConfig> {
  loadEnv(cwd)
  const config = await loadConfig(cwd)
  const errors = validateConfigForCommand(config, command)
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`❌ ${err}`)
    }
    process.exit(1)
  }
  return config
}

/**
 * Handle a command result that has exitCode/errors/warnings.
 */
function handleResult(result: {
  exitCode: number
  errors?: string[]
  warnings?: string[]
}): void {
  if (result.warnings) {
    for (const w of result.warnings) {
      if (!w.startsWith('⚠') && !w.startsWith('No .env')) {
        console.warn(`⚠ ${w}`)
      } else {
        console.warn(w)
      }
    }
  }
  if (result.errors) {
    for (const e of result.errors) {
      console.error(`❌ ${e}`)
    }
  }
  if (result.exitCode !== 0) {
    process.exit(result.exitCode)
  }
}

export function createProgram(): Command {
  const program = new Command()

  program
    .name('manta')
    .description('Manta framework CLI')
    .version(VERSION)

  // ── manta init ──────────────────────────────────────────────────────
  program
    .command('init')
    .description('Initialize a new Manta project')
    .option('--dir <path>', 'Target directory')
    .action(async (opts: { dir?: string }) => {
      const result = await initCommand({ dir: opts.dir })

      if (result.created.length > 0) {
        for (const f of result.created) {
          console.log(`  + ${f}`)
        }
      }
      for (const f of result.skipped) {
        console.log(`  ⊘ ${f} already exists. Skipped.`)
      }

      if (result.created.length === 0 && result.skipped.length > 0) {
        console.log('✓ Project already initialized. Nothing to do.')
      } else if (result.created.length > 0) {
        console.log('✓ Manta project initialized.')
        console.log('  Next steps:')
        console.log('  1. Edit .env and set DATABASE_URL')
        console.log('  2. Create your first module in src/modules/')
        console.log('  3. Run: manta dev')
      }

      handleResult(result)
    })

  // ── manta dev ───────────────────────────────────────────────────────
  program
    .command('dev')
    .description('Start the development server')
    .option('--port <number>', 'HTTP port', parseInt)
    .option('--no-migrate', 'Skip auto-migration')
    .option('--verbose', 'Enable debug logging')
    .action(async (opts: { port?: number; migrate?: boolean; verbose?: boolean }) => {
      const cwd = process.cwd()
      const result = await devCommand(
        {
          port: opts.port,
          noMigrate: opts.migrate === false,
          verbose: opts.verbose,
        },
        cwd,
      )
      handleResult(result)
    })

  // ── manta start ─────────────────────────────────────────────────────
  program
    .command('start')
    .description('Start the production server')
    .option('--port <number>', 'HTTP port', parseInt)
    .action(async (opts: { port?: number }) => {
      const cwd = process.cwd()
      const result = await startCommand({ port: opts.port }, cwd)
      handleResult(result)
    })

  // ── manta build ─────────────────────────────────────────────────────
  program
    .command('build')
    .description('Build the project for deployment')
    .option('--preset <preset>', 'Nitro preset (node, vercel, aws-lambda, cloudflare, bun)', 'node')
    .action(async (opts: { preset?: string }) => {
      const cwd = process.cwd()
      const result = await buildCommand({ preset: opts.preset }, cwd)

      if (result.manifest) {
        const m = result.manifest
        console.log(
          `✓ Build complete (preset: ${opts.preset ?? 'node'})`,
        )
        console.log(
          `  Manifest: ${m.routes.length} routes, ${m.subscribers.length} subscribers, ` +
          `${m.workflows.length} workflows, ${m.jobs.length} jobs`,
        )
      }

      handleResult(result)
    })

  // ── manta exec ──────────────────────────────────────────────────────
  program
    .command('exec')
    .description('Execute a script with the framework container')
    .argument('<script>', 'Script file to execute')
    .option('--dry-run', 'Wrap in transaction and rollback')
    .allowUnknownOption(true)
    .action(async (script: string, opts: { dryRun?: boolean }, cmd: Command) => {
      const cwd = process.cwd()
      // Args after -- are passed to the script
      const extraArgs = cmd.args.slice(1) // first arg is the script itself
      const result = await execCommand(
        { script, dryRun: opts.dryRun, args: extraArgs },
        cwd,
      )
      handleResult(result)
    })

  // ── manta db ────────────────────────────────────────────────────────
  const db = program
    .command('db')
    .description('Database management commands')

  // manta db:generate
  db
    .command('generate')
    .description('Generate SQL migration files from DML changes')
    .option('--name <name>', 'Migration name')
    .action(async (opts: { name?: string }) => {
      const cwd = process.cwd()
      await loadAndValidate('db:generate', cwd)

      const migrationsDir = resolve(cwd, 'drizzle', 'migrations')
      const { mkdirSync, writeFileSync } = await import('node:fs')

      const result = await generateCommand(
        { name: opts.name },
        cwd,
        {
          drizzleKit: {
            async generate(entities) {
              // Stub: generate a simple CREATE TABLE migration from entities
              if (entities.length === 0) return { migrationFile: null, sql: null }
              const timestamp = new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14)
              const name = opts.name ?? 'migration'
              const migrationFile = `${timestamp}_${name}`
              const sql = entities
                .map(
                  (e) =>
                    `CREATE TABLE IF NOT EXISTS "${e.name}" (\n  "id" TEXT PRIMARY KEY,\n  "created_at" TIMESTAMPTZ DEFAULT NOW(),\n  "updated_at" TIMESTAMPTZ DEFAULT NOW(),\n  "deleted_at" TIMESTAMPTZ\n);`,
                )
                .join('\n\n')

              // Write migration file
              mkdirSync(migrationsDir, { recursive: true })
              writeFileSync(resolve(migrationsDir, `${migrationFile}.sql`), sql)
              return { migrationFile, sql }
            },
          },
          migrationFs: {
            async writeRollbackSkeleton(migrationFile) {
              mkdirSync(migrationsDir, { recursive: true })
              writeFileSync(
                resolve(migrationsDir, `${migrationFile}.down.sql`),
                '-- TODO: Write rollback SQL for this migration\n',
              )
            },
            async writeDrizzleSchema() {
              // No-op for now — DML→Drizzle schema generation is a future step
            },
          },
        },
      )

      if (result.noChanges) {
        console.log('✓ No changes detected.')
      } else if (result.migrationFile) {
        console.log(`✓ Migration generated: ${result.migrationFile}`)
      }

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.warn(`⚠ ${w}`)
        }
      }

      handleResult(result)
    })

  // manta db:migrate
  db
    .command('migrate')
    .description('Apply pending SQL migrations')
    .option('--force', 'Apply dangerous changes without confirmation')
    .option('--dry-run', 'Show SQL without applying')
    .option('--json', 'JSON output')
    .option('--all-or-nothing', 'Wrap all migrations in a single transaction')
    .option('--force-unlock', 'Force release the migration lock')
    .action(async (opts: {
      force?: boolean
      dryRun?: boolean
      json?: boolean
      allOrNothing?: boolean
      forceUnlock?: boolean
    }) => {
      const cwd = process.cwd()
      const config = await loadAndValidate('db:migrate', cwd)

      const migrationsDir = resolve(cwd, 'drizzle', 'migrations')
      const db = createPgClient(config.database!.url!)
      try {
        const result = await migrateCommand(
          {
            forceUnlock: opts.forceUnlock,
            dryRun: opts.dryRun,
            allOrNothing: opts.allOrNothing,
          },
          {
            db,
            lock: createMigrationLock(db),
            tracker: createMigrationTracker(db),
            fs: createMigrationFs(migrationsDir),
          },
        )

        if (result.dryRunSql) {
          for (const sql of result.dryRunSql) {
            console.log(sql)
          }
        } else if (result.appliedCount > 0) {
          console.log(`✓ Applied ${result.appliedCount} migration(s).`)
        } else if (result.pendingCount === 0) {
          console.log('✓ No pending migrations.')
        }

        handleResult(result)
      } finally {
        await db.close()
      }
    })

  // manta db:rollback
  db
    .command('rollback')
    .description('Rollback the last N migrations')
    .option('--steps <number>', 'Number of migrations to rollback', parseInt)
    .action(async (opts: { steps?: number }) => {
      const cwd = process.cwd()
      const config = await loadAndValidate('db:rollback', cwd)

      const migrationsDir = resolve(cwd, 'drizzle', 'migrations')
      const db = createPgClient(config.database!.url!)
      try {
        const result = await rollbackCommand(
          { steps: opts.steps },
          {
            db,
            tracker: createMigrationTracker(db),
            fs: createMigrationFs(migrationsDir),
          },
        )

        if (result.rolledBack.length > 0) {
          console.log(`✓ Rolled back ${result.rolledBack.length} migration(s).`)
        } else if (result.exitCode === 0) {
          console.log('✓ No migrations to roll back.')
        }

        handleResult(result)
      } finally {
        await db.close()
      }
    })

  // manta db:diff
  db
    .command('diff')
    .description('Compare DML schema vs actual DB (read-only)')
    .option('--json', 'JSON output')
    .action(async (opts: { json?: boolean }) => {
      const cwd = process.cwd()
      const config = await loadAndValidate('db:diff', cwd)

      const db = createPgClient(config.database!.url!)
      try {
        // For now, pass empty expected schema — real DML scan will be added later
        const { scanDmlModels } = await import('./commands/db/generate.js')
        const dmlScan = scanDmlModels(cwd)
        const expectedSchema = dmlScan.entities.map((e) => ({
          table: e.name,
          columns: [] as string[],
        }))

        const result = await diffCommand(opts, expectedSchema, { db })

        if (opts.json) {
          console.log(JSON.stringify({ diffs: result.diffs, notifications: result.notifications }, null, 2))
        } else {
          if (result.diffs.length === 0 && result.notifications.length === 0) {
            console.log('✓ Schema is in sync.')
          } else {
            for (const d of result.diffs) {
              console.log(`  ✗ ${d.type} ${d.entity}: ${d.name}`)
            }
            for (const n of result.notifications) {
              console.log(`  ℹ ${n.type} ${n.entity}: ${n.name}`)
            }
          }
        }

        handleResult(result)
      } finally {
        await db.close()
      }
    })

  // manta db:create
  db
    .command('create')
    .description('Create the database if it does not exist')
    .action(async () => {
      const cwd = process.cwd()
      const config = await loadAndValidate('db:create', cwd)

      const result = await createCommand(config.database!.url!, createPgCreateDeps())

      if (result.created) {
        console.log(`✓ Database "${result.dbName}" created.`)
      } else if (result.exitCode === 0) {
        console.log(`✓ Database "${result.dbName}" already exists.`)
      }

      handleResult(result)
    })

  // ── Not available in v1 ─────────────────────────────────────────────
  for (const cmd of NOT_AVAILABLE_V1) {
    program
      .command(cmd)
      .description(`(not available in v1)`)
      .action(() => {
        console.error(`❌ '${cmd}' is not available in v1.`)
        process.exit(1)
      })
  }

  // ── Unknown command handler ─────────────────────────────────────────
  program.on('command:*', (operands: string[]) => {
    console.error(`❌ Unknown command '${operands[0]}'.`)
    console.error(`Run 'manta --help' to see available commands.`)
    process.exit(1)
  })

  return program
}
