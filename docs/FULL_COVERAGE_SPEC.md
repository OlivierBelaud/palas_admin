# Prompt : Couverture de test complète — Core, Adapters, CLI

## Objectif

Quand `pnpm test` passe au vert, l'application fonctionne. Zéro vérification manuelle.

On a 551 tests verts et 34 skippés. À la fin de cette session :
- **0 skip** (sauf cas documenté et justifié)
- **3 couches de tests complètes** : unitaire, conformance adapter, intégration e2e
- **Tout est automatisé** : un seul `pnpm test` fait tout, y compris démarrer PG

---

## Partie 1 : Infrastructure de test

### 1.1 Docker Compose pour les tests

Crée un `docker-compose.test.yml` à la racine du monorepo :

```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: manta_test
      POSTGRES_PASSWORD: manta_test
      POSTGRES_DB: manta_test
    ports:
      - "5433:5432"  # Port 5433 pour ne PAS entrer en conflit avec ton PG local
    tmpfs:
      - /var/lib/postgresql/data  # En RAM = rapide + nettoyé à chaque run
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U manta_test"]
      interval: 1s
      timeout: 3s
      retries: 10
```

**Pourquoi** :
- Port 5433 → ton PG local sur 5432 n'est jamais touché
- `tmpfs` → la DB tourne en RAM, c'est ultra rapide et nettoyé automatiquement à l'arrêt
- `healthcheck` → les tests attendent que PG soit prêt avant de démarrer

### 1.2 Scripts dans le package.json racine

```json
{
  "scripts": {
    "test": "pnpm test:up && pnpm test:run; pnpm test:down",
    "test:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "test:run": "pnpm -r --filter './packages/*' run test",
    "test:down": "docker compose -f docker-compose.test.yml down",
    "test:unit": "pnpm -r --filter './packages/*' run test:unit",
    "test:integration": "pnpm test:up && pnpm -r --filter './packages/*' run test:integration; pnpm test:down"
  }
}
```

**Le flow** :
1. `pnpm test` → lance Docker (PG en RAM), exécute tous les tests, éteint Docker
2. `pnpm test:unit` → tests unitaires seuls, pas besoin de Docker
3. `pnpm test:integration` → lance Docker, tests intégration + conformance, éteint Docker

### 1.3 Variable d'environnement de test

Crée un `.env.test` à la racine :

```
TEST_DATABASE_URL=postgresql://manta_test:manta_test@localhost:5433/manta_test
```

Et un helper partagé `packages/test-utils/src/pg.ts` :

```typescript
import { Client } from 'pg'

const TEST_DB_URL = process.env.TEST_DATABASE_URL
  || 'postgresql://manta_test:manta_test@localhost:5433/manta_test'

/**
 * Crée une base de données isolée pour un fichier de test.
 * Retourne l'URL de connexion et une fonction cleanup.
 */
export async function createTestDatabase(name?: string): Promise<{
  url: string
  cleanup: () => Promise<void>
}> {
  const dbName = name || `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const client = new Client({ connectionString: TEST_DB_URL })
  await client.connect()
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`)
  await client.query(`CREATE DATABASE "${dbName}"`)
  await client.end()

  const url = TEST_DB_URL.replace(/\/[^/]+$/, `/${dbName}`)

  return {
    url,
    cleanup: async () => {
      const c = new Client({ connectionString: TEST_DB_URL })
      await c.connect()
      // Kill les connexions actives avant de drop
      await c.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${dbName}' AND pid <> pg_backend_pid()
      `)
      await c.query(`DROP DATABASE IF EXISTS "${dbName}"`)
      await c.end()
    },
  }
}

/**
 * Vérifie que PG est accessible. Utilisé dans le beforeAll global.
 */
export async function waitForPg(maxRetries = 30): Promise<void> {
  const client = new Client({ connectionString: TEST_DB_URL })
  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return
    } catch {
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  throw new Error(`PostgreSQL not reachable at ${TEST_DB_URL} after ${maxRetries}s`)
}
```

Chaque fichier de test qui touche PG crée sa propre base isolée → les tests sont parallélisables, pas de conflit.

### 1.4 Config Vitest par package

Chaque package a deux configs ou une config avec deux profils :

```typescript
// packages/cli/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    exclude: ['__tests__/**/*.integration.test.ts'],
  },
})

// packages/cli/vitest.integration.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.integration.test.ts'],
    globalSetup: ['__tests__/setup/pg-check.ts'],  // vérifie que PG tourne
    testTimeout: 30000,
  },
})
```

Et dans chaque `package.json` :

```json
{
  "scripts": {
    "test": "vitest run && vitest run -c vitest.integration.config.ts",
    "test:unit": "vitest run",
    "test:integration": "vitest run -c vitest.integration.config.ts"
  }
}
```

---

## Partie 2 : Déskipper les 34 tests

Reprends chaque test skippé et traite-le selon sa catégorie.

### Catégorie A : Need PG (6 tests)

Tests : database.test.ts (4), repository.test.ts (1), repository-pg.test.ts (1)

**Action** : déplace ces tests dans des fichiers `.integration.test.ts` ou déskippe-les et ajoute le setup PG.

```typescript
// __tests__/integration/database.integration.test.ts
import { createTestDatabase } from '@manta/test-utils/pg'
import { DrizzlePgAdapter } from '@manta/adapter-drizzle-pg'

describe('IDatabasePort — DrizzlePgAdapter conformance', () => {
  let db: DrizzlePgAdapter
  let cleanup: () => Promise<void>

  beforeAll(async () => {
    const testDb = await createTestDatabase()
    cleanup = testDb.cleanup
    db = new DrizzlePgAdapter()
    await db.initialize({ url: testDb.url, pool: { min: 1, max: 5 } })
  })

  afterAll(async () => {
    await db.dispose()
    await cleanup()
  })

  it('retry on transient connection error', async () => {
    // Le vrai test avec la vraie DB
  })

  it('serializable isolation', async () => {
    // Transaction avec SERIALIZABLE
  })

  it('nested transactions with savepoints', async () => {
    // BEGIN → SAVEPOINT → RELEASE/ROLLBACK
  })

  it('conflict detection', async () => {
    // INSERT conflit → erreur spécifique
  })
})
```

### Catégorie B : Need Nitro (7 tests)

Tests : http.test.ts (7) — rate limiting, pipeline, requestId

**Action** : crée un test d'intégration qui démarre un vrai serveur Nitro sur un port aléatoire.

```typescript
// __tests__/integration/http.integration.test.ts
import { createNitroTestServer } from '../setup/nitro-server'

describe('IHttpPort — NitroAdapter conformance', () => {
  let server: { url: string; close: () => Promise<void> }

  beforeAll(async () => {
    server = await createNitroTestServer({ port: 0 }) // port 0 = random
  })

  afterAll(async () => {
    await server.close()
  })

  it('rate limiting returns 429 after max requests', async () => {
    // Envoie maxRequests+1 requêtes, vérifie 429
  })

  it('requestId header is set on every response', async () => {
    const res = await fetch(`${server.url}/health`)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})
```

### Catégorie C : Feature pas implémentée (20 tests)

Tests : strict-mode.test.ts (12), lazy boot timeout (1), job scheduler timeout (1), lifecycle inversion (1), auth expiration (1), notification partial failure (2), Query.graph (2)

**Action** : pour chaque feature, il y a deux cas possibles.

**Cas 1 — La feature est dans la spec et doit exister en v1** :
→ Implémente la feature. Le test est déjà écrit, déskippe-le, fais-le passer au vert.

**Cas 2 — La feature est reportée (pas dans le scope immédiat)** :
→ Convertis le `it.skip` en `it.todo` avec une explication :

```typescript
it.todo('strict mode rejects unknown fields — blocked on: StrictModeEnforcer not implemented (SPEC-XXX)')
```

`it.todo` est différent de `it.skip` : skip = temporairement désactivé, todo = feature pas encore codée. C'est un signal clair.

**Décision à prendre** : lis la spec pour chaque feature et détermine si c'est v1 ou pas.

Pour les features v1 qui doivent être implémentées, voici l'ordre :

```
1. strict mode (12 tests) — FRAMEWORK_SPEC, c'est de la validation de config
2. auth expiration (1 test) — logique de token, pas besoin de PG
3. lazy boot timeout (1 test) — timer + reject, pas besoin de PG
4. job scheduler timeout (1 test) — timer + cancel, pas besoin de PG
5. notification partial failure (2 tests) — logique d'agrégation d'erreurs
6. Query.graph (2 tests) — plus complexe, dépend du module Query
7. lifecycle inversion (1 test) — container ordering
```

Les items 1-5 sont de la logique pure, pas besoin de PG ni Nitro. Implémente-les et déskippe.
Les items 6-7 sont plus complexes. Si pas v1, marque `it.todo`.

---

## Partie 3 : Tests conformance adapters

Pour chaque adapter dans `packages/adapter-*/`, crée un fichier de test conformance qui vérifie le contrat du port.

### Principe

Un test conformance dit : "cet adapter implémente ce port, et voici les comportements que le port garantit."

```
packages/adapter-drizzle-pg/   → teste IDatabasePort
packages/adapter-logger-pino/  → teste ILoggerPort
packages/adapter-nitro/        → teste IHttpPort
```

### Template de test conformance

```typescript
// packages/adapter-drizzle-pg/__tests__/conformance.integration.test.ts
import { createTestDatabase } from '@manta/test-utils/pg'
import { DrizzlePgAdapter } from '../src'
import type { IDatabasePort } from '@manta/core/ports'

describe('DrizzlePgAdapter — IDatabasePort conformance', () => {
  let adapter: IDatabasePort
  let cleanup: () => Promise<void>

  beforeAll(async () => {
    const testDb = await createTestDatabase()
    cleanup = testDb.cleanup
    adapter = new DrizzlePgAdapter()
    await adapter.initialize({ url: testDb.url, pool: { min: 1, max: 3 } })
  })

  afterAll(async () => {
    await adapter.dispose()
    await cleanup()
  })

  // --- Contrat IDatabasePort ---

  describe('initialize / dispose', () => {
    it('healthcheck returns true after initialize', async () => {
      expect(await adapter.healthcheck()).toBe(true)
    })

    it('healthcheck returns false after dispose', async () => {
      const tempAdapter = new DrizzlePgAdapter()
      const tempDb = await createTestDatabase()
      await tempAdapter.initialize({ url: tempDb.url })
      await tempAdapter.dispose()
      expect(await tempAdapter.healthcheck()).toBe(false)
      await tempDb.cleanup()
    })
  })

  describe('query execution', () => {
    it('executes raw SQL', async () => {
      const result = await adapter.query('SELECT 1 as num')
      expect(result[0].num).toBe(1)
    })

    it('supports parameterized queries', async () => {
      const result = await adapter.query('SELECT $1::text as name', ['manta'])
      expect(result[0].name).toBe('manta')
    })
  })

  describe('transactions', () => {
    it('commits on success', async () => {
      await adapter.executeSql('CREATE TABLE test_tx (id serial PRIMARY KEY, val text)')
      await adapter.transaction(async (tx) => {
        await tx.executeSql("INSERT INTO test_tx (val) VALUES ('hello')")
      })
      const rows = await adapter.query('SELECT val FROM test_tx')
      expect(rows[0].val).toBe('hello')
    })

    it('rolls back on error', async () => {
      await adapter.executeSql('CREATE TABLE IF NOT EXISTS test_tx2 (id serial, val text)')
      try {
        await adapter.transaction(async (tx) => {
          await tx.executeSql("INSERT INTO test_tx2 (val) VALUES ('should_not_exist')")
          throw new Error('abort')
        })
      } catch {}
      const rows = await adapter.query("SELECT * FROM test_tx2 WHERE val = 'should_not_exist'")
      expect(rows).toHaveLength(0)
    })

    it('nested transactions use savepoints', async () => {
      // Test SAVEPOINT + RELEASE/ROLLBACK TO SAVEPOINT
    })
  })

  describe('connection pool', () => {
    it('respects pool min/max', async () => {
      // Ouvre N connexions concurrentes, vérifie le comportement
    })
  })

  describe('error handling', () => {
    it('wraps PG errors in MantaError', async () => {
      await expect(
        adapter.executeSql('SELECT * FROM table_qui_nexiste_pas')
      ).rejects.toThrow(/relation.*does not exist/)
    })
  })
})
```

Fais le même pattern pour chaque adapter. Le test conformance teste le **contrat du port**, pas les détails internes de l'adapter.

---

## Partie 4 : Tests d'intégration e2e CLI

Ces tests spawent le vrai binaire `manta` et vérifient le comportement complet.

```typescript
// packages/cli/__tests__/integration/cli-lifecycle.integration.test.ts
import { execa } from 'execa'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDatabase } from '@manta/test-utils/pg'

const MANTA_BIN = join(__dirname, '../../bin/manta.ts')

describe('CLI lifecycle e2e', () => {
  let projectDir: string
  let dbUrl: string
  let cleanupDb: () => Promise<void>

  beforeAll(async () => {
    // Crée un dossier projet temporaire
    projectDir = await mkdtemp(join(tmpdir(), 'manta-test-'))
    // Crée une DB de test isolée
    const testDb = await createTestDatabase()
    dbUrl = testDb.url
    cleanupDb = testDb.cleanup
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true })
    await cleanupDb()
  })

  it('manta init creates project structure', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'init'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Manta project initialized')

    // Vérifie les fichiers créés
    const { stdout } = await execa('ls', ['-la'], { cwd: projectDir })
    expect(stdout).toContain('manta.config.ts')
    expect(stdout).toContain('package.json')
    expect(stdout).toContain('.env')
  })

  it('manta init is idempotent (skip existing files)', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'init'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('already exists')
  })

  it('manta db:create creates the database', async () => {
    // Écris le DATABASE_URL dans .env du projet
    const envContent = `DATABASE_URL=${dbUrl}`
    await writeFile(join(projectDir, '.env'), envContent)

    const result = await execa('npx', ['tsx', MANTA_BIN, 'db:create'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/created|already exists/)
  })

  it('manta db:generate creates migration files', async () => {
    // Crée un module avec un model DML
    // ... (créer src/modules/product/models/product.ts)

    const result = await execa('npx', ['tsx', MANTA_BIN, 'db:generate'], {
      cwd: projectDir,
      env: { MANTA_NON_INTERACTIVE: 'true' },
    })
    expect(result.exitCode).toBe(0)
    // Vérifie qu'un fichier .sql a été créé dans drizzle/migrations/
  })

  it('manta db:migrate applies pending migrations', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'db:migrate'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('applied')
  })

  it('manta db:diff shows no changes after migrate', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'db:diff'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    // Pas de changement attendu
  })

  it('manta db:rollback reverts last migration', async () => {
    // Il faut d'abord écrire un .down.sql valide
    // ...

    const result = await execa('npx', ['tsx', MANTA_BIN, 'db:rollback'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Rolled back')
  })

  it('manta build generates manifest', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'build'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Build complete')
    // Vérifie les fichiers manifest
  })

  it('manta dev starts and responds to SIGINT', async () => {
    const proc = execa('npx', ['tsx', MANTA_BIN, 'dev'], {
      cwd: projectDir,
      timeout: 15000,
    })

    // Attends que le serveur soit prêt
    await new Promise<void>((resolve) => {
      proc.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('Server ready')) resolve()
      })
    })

    // Vérifie que le serveur répond
    const res = await fetch('http://localhost:9000/health')
    expect(res.ok).toBe(true)

    // Graceful shutdown
    proc.kill('SIGINT')
    const result = await proc.catch(e => e) // execa throw sur kill
    expect(result.stdout).toContain('Shutting down')
  })

  it('manta start fails without JWT_SECRET in prod', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'start'], {
      cwd: projectDir,
      env: { NODE_ENV: 'production' },
      reject: false,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('JWT_SECRET is required')
  })

  it('manta exec runs a script with container', async () => {
    // Crée un script de test
    const scriptContent = `
      export default async ({ container, args }) => {
        console.log('EXEC_OK', args.join(','))
      }
    `
    // ... écrire le fichier

    const result = await execa('npx', ['tsx', MANTA_BIN, 'exec', 'scripts/test.ts', '--', '--flag', 'value'], {
      cwd: projectDir,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('EXEC_OK')
    expect(result.stdout).toContain('--flag,value')
  })

  it('unknown command shows helpful error', async () => {
    const result = await execa('npx', ['tsx', MANTA_BIN, 'plugin'], {
      cwd: projectDir,
      reject: false,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not available in v1')
  })
})
```

---

## Partie 5 : Exécution complète

### Ordre d'exécution

```
1. Crée docker-compose.test.yml, .env.test, packages/test-utils/

2. Déskippe les 34 tests :
   a. Catégorie A (PG) → convertis en .integration.test.ts avec createTestDatabase()
   b. Catégorie B (Nitro) → convertis en .integration.test.ts avec Nitro test server
   c. Catégorie C (feature) → implémente la feature OU marque it.todo avec justification

3. Écris les tests conformance pour chaque adapter existant

4. Écris les tests d'intégration e2e CLI

5. Exécute tout :
   pnpm test
   # Doit lancer Docker, exécuter tous les tests, éteindre Docker
```

### Boucle de correction

Pour chaque test qui fail :
1. Si le test est correct et le code est faux → corrige le code
2. Si le test est faux (mauvaise assertion) → corrige le test
3. Si le test a besoin d'une feature pas implémentée et qui est v1 → implémente
4. Si la feature n'est pas v1 → `it.todo` avec explication

**Ne jamais supprimer un test qui échoue.** Le corriger ou le justifier.

### Rapport final attendu

```
══════════════════════════════════════════
  COUVERTURE COMPLÈTE — RAPPORT FINAL
══════════════════════════════════════════

TESTS UNITAIRES (sans Docker)
  packages/core/           : XXX pass | 0 fail | 0 skip
  packages/cli/            : XXX pass | 0 fail | 0 skip
  packages/adapter-*/      : XXX pass | 0 fail | 0 skip

TESTS CONFORMANCE ADAPTERS (avec PG Docker)
  adapter-drizzle-pg       : XX pass | 0 fail
  adapter-logger-pino      : XX pass | 0 fail
  adapter-nitro            : XX pass | 0 fail

TESTS INTÉGRATION E2E (avec PG Docker)
  cli-lifecycle            : XX pass | 0 fail
  cli-dev                  : XX pass | 0 fail
  cli-db                   : XX pass | 0 fail

RÉSUMÉ
  Total                    : XXX pass | 0 fail | Y todo
  Skip                     : 0
  Todo                     : Y (features hors scope, justifiées)
  
DOCKER
  PG démarré automatiquement : ✓
  PG éteint automatiquement  : ✓
  Bases de test isolées       : ✓ (une par fichier de test)
  Conflit avec PG local       : ✓ aucun (port 5433)

COMMANDE
  pnpm test                → TOUT passe
══════════════════════════════════════════
```
