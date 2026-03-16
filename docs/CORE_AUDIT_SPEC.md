# Prompt : Audit complet + Implémentation du framework core

## Situation

On a une CLI qui fonctionne, des adapters testés, mais le **framework core** (`packages/core/`) n'est pas réellement implémenté. Les composants fondamentaux sont des interfaces avec des mocks/stubs qui satisfont les tests unitaires mais ne font rien de réel.

On arrête tout développement de features. On audite et on implémente le core.

## Étape 1 : Audit — Qu'est-ce qui est réel vs stub ?

Pour CHAQUE composant ci-dessous dans `packages/core/`, fais l'inventaire :

```bash
# Liste tous les fichiers source du core
find packages/core/src -name "*.ts" | sort

# Identifie les stubs
grep -rn "Not implemented\|throw new Error\|// TODO\|// STUB\|return {}\|return \[\]\|return input\|return undefined" packages/core/src/ --include="*.ts"

# Identifie les classes/fonctions avec un body vide ou trivial
grep -A5 "export class\|export function\|export async function" packages/core/src/ --include="*.ts" | grep -B1 "return\|throw\|{}"
```

Pour chaque fichier, classe ou fonction, catégorise :

- **✅ RÉEL** — logique implémentée, fait ce que la spec dit
- **🟡 PARTIEL** — certaines méthodes marchent, d'autres sont des stubs
- **❌ STUB** — retourne une valeur bidon, throw "Not implemented", ou ne fait rien

Produis un tableau :

```
| Composant                | Fichier(s)              | État  | Détail                                    |
|--------------------------|-------------------------|-------|-------------------------------------------|
| Container DI (Awilix)    | container/              | ?     |                                           |
| WorkflowManager          | workflow/               | ?     |                                           |
| createWorkflow / step    | workflow/               | ?     |                                           |
| Compensation engine      | workflow/               | ?     |                                           |
| EventBus (InMemory)      | event-bus/              | ?     |                                           |
| DML model.define()       | dml/                    | ?     |                                           |
| DML fluent API           | dml/                    | ?     | .nullable(), .default(), .unique(), .enum()|
| DML → Drizzle pipeline   | dml/                    | ?     |                                           |
| Module system            | module/                 | ?     | Module(), IModuleLoader                   |
| Service base class       | service/                | ?     |                                           |
| Query / Query.graph()    | query/                  | ?     |                                           |
| Link system (defineLink) | link/                   | ?     |                                           |
| REMOTE_LINK              | link/                   | ?     |                                           |
| IFilePort (InMemory)     | ports/file/             | ?     | write, read, delete, exists, list         |
| ICachePort (InMemory)    | ports/cache/            | ?     |                                           |
| ILockingPort (InMemory)  | ports/locking/          | ?     |                                           |
| IAuthPort                | ports/auth/             | ?     |                                           |
| IJobSchedulerPort        | ports/job-scheduler/    | ?     |                                           |
| INotificationPort        | ports/notification/     | ?     |                                           |
| MantaError               | errors/                 | ?     |                                           |
| Feature flags            | feature-flags/          | ?     |                                           |
| defineConfig / types     | config/                 | ?     |                                           |
| Middleware system         | middleware/             | ?     |                                           |
| Subscriber system        | subscriber/             | ?     |                                           |
| Repository base          | repository/             | ?     |                                           |
| Translation              | translation/            | ?     |                                           |
```

## Étape 2 : Plan d'implémentation par priorité

Après l'audit, classe les composants en 3 tiers :

**Tier 1 — Fondations** (tout le reste en dépend, implémenter en premier) :
- Container DI
- MantaError
- EventBus (InMemory)
- DML model.define() + fluent API
- Module system (Module(), loader)
- Service base

**Tier 2 — Moteur** (les systèmes d'exécution) :
- WorkflowManager + createWorkflow + step + compensation
- Subscriber system (register, dispatch)
- Query + Query.graph()
- Link system (defineLink, tables de jointure)
- Repository base

**Tier 3 — Ports InMemory** (implémentations de dev) :
- IFilePort InMemory (write, read, delete, exists, list)
- ICachePort InMemory
- ILockingPort InMemory
- IJobSchedulerPort InMemory
- IAuthPort
- INotificationPort

## Étape 3 : Implémentation — TDD 3 couches

Pour CHAQUE composant, dans l'ordre des tiers :

### Couche 1 : Test unitaire

Teste la logique interne du composant avec des dépendances mockées.

```typescript
// Exemple : WorkflowManager
describe('WorkflowManager', () => {
  it('executes steps in order', async () => {
    const steps = [
      { name: 'step1', handler: vi.fn().mockResolvedValue({ a: 1 }) },
      { name: 'step2', handler: vi.fn().mockResolvedValue({ b: 2 }) },
    ]
    const wf = createWorkflow({ name: 'test', steps })
    const manager = new WorkflowManager()
    manager.register(wf)
    const result = await manager.run('test', { input: {} })
    
    expect(steps[0].handler).toHaveBeenCalledBefore(steps[1].handler)
    expect(result.output).toEqual({ b: 2 })
  })

  it('runs compensation on step failure in reverse order', async () => {
    const compensations: string[] = []
    const steps = [
      {
        name: 'step1',
        handler: vi.fn().mockResolvedValue({ id: '123' }),
        compensation: vi.fn().mockImplementation(async () => { compensations.push('comp1') }),
      },
      {
        name: 'step2',
        handler: vi.fn().mockRejectedValue(new Error('fail')),
        compensation: vi.fn(), // ne devrait PAS être appelé (step2 a échoué, pas réussi)
      },
    ]
    const wf = createWorkflow({ name: 'test-comp', steps })
    const manager = new WorkflowManager()
    manager.register(wf)
    
    await expect(manager.run('test-comp', { input: {} })).rejects.toThrow('fail')
    expect(steps[0].compensation).toHaveBeenCalled()      // step1 réussi → compensation
    expect(steps[1].compensation).not.toHaveBeenCalled()   // step2 échoué → pas de compensation
    expect(compensations).toEqual(['comp1'])
  })

  it('supports sub-workflows', async () => {
    // ...
  })

  it('passes previous step outputs to next step', async () => {
    // ...
  })
})
```

### Couche 2 : Test conformance (pour les ports InMemory)

Teste que l'implémentation InMemory respecte le contrat du port.

```typescript
// Exemple : InMemoryFileAdapter conformance
describe('InMemoryFileAdapter — IFilePort conformance', () => {
  let adapter: IFilePort

  beforeEach(() => {
    adapter = new InMemoryFileAdapter()
  })

  it('write then read returns the same content', async () => {
    await adapter.write('test/file.txt', Buffer.from('hello'))
    const content = await adapter.read('test/file.txt')
    expect(content.toString()).toBe('hello')
  })

  it('exists returns true after write', async () => {
    await adapter.write('test/file.txt', Buffer.from('hello'))
    expect(await adapter.exists('test/file.txt')).toBe(true)
  })

  it('exists returns false for unknown path', async () => {
    expect(await adapter.exists('nonexistent')).toBe(false)
  })

  it('delete removes the file', async () => {
    await adapter.write('test/file.txt', Buffer.from('hello'))
    await adapter.delete('test/file.txt')
    expect(await adapter.exists('test/file.txt')).toBe(false)
  })

  it('list returns files with prefix', async () => {
    await adapter.write('dir/a.txt', Buffer.from('a'))
    await adapter.write('dir/b.txt', Buffer.from('b'))
    await adapter.write('other/c.txt', Buffer.from('c'))
    const files = await adapter.list('dir/')
    expect(files).toHaveLength(2)
    expect(files).toContain('dir/a.txt')
    expect(files).toContain('dir/b.txt')
  })

  it('read throws on nonexistent file', async () => {
    await expect(adapter.read('nonexistent')).rejects.toThrow()
  })
})
```

### Couche 3 : Test d'intégration (composants assemblés)

Teste que plusieurs composants fonctionnent ensemble sans mocks.

```typescript
// Exemple : Workflow + EventBus + Services (pas de mock)
describe('Workflow integration — real components', () => {
  let container: MantaContainer
  let workflowManager: WorkflowManager
  let eventBus: InMemoryEventBusAdapter
  let events: Array<{ event: string; data: any }>

  beforeEach(() => {
    eventBus = new InMemoryEventBusAdapter()
    events = []
    eventBus.subscribe('*', (event, data) => events.push({ event, data }))
    
    workflowManager = new WorkflowManager({ eventBus })
    // Register un vrai workflow avec de vrais handlers (pas des mocks)
  })

  it('workflow emits events that subscribers receive', async () => {
    // Vrai workflow → vrai emit → vrai subscriber → vérifier le side-effect
  })

  it('workflow compensation cleans up on failure', async () => {
    // Vrai workflow avec step qui fail → compensation → vérifier que le side-effect est annulé
  })
})
```

## Règles

1. **Lis FRAMEWORK_SPEC.md** pour chaque composant avant d'implémenter. C'est la source de vérité.

2. **Un composant n'est "done" que quand les 3 couches de tests passent.**

3. **Ne touche PAS aux tests CLI et adapter existants.** Ils doivent continuer à passer. Vérifie avec `pnpm test` entre chaque composant.

4. **Les implémentations InMemory sont des vraies implémentations**, pas des stubs. InMemoryFileAdapter doit stocker en RAM et retourner les bons résultats. InMemoryEventBusAdapter doit dispatcher les events aux subscribers. InMemoryWorkflowEngine doit exécuter les steps et gérer la compensation.

5. **Chaque port doit avoir son interface clairement définie** dans `packages/core/src/ports/`. Si l'interface est incomplète (il manque des méthodes), complète-la en te basant sur FRAMEWORK_SPEC.md.

## Boucle d'exécution

```
Pour chaque tier (1, 2, 3) :
  Pour chaque composant du tier :
    1. Audit : c'est quoi l'état actuel ? (✅/🟡/❌)
    2. Si ❌ ou 🟡 :
       a. Lis la section FRAMEWORK_SPEC.md correspondante
       b. Écris les tests (couches 1 + 2, et 3 si applicable)
       c. Exécute → rouge
       d. Implémente → vert
       e. Refactor
    3. Vérifie que TOUT passe : pnpm test
    4. Log ce qui a été fait (comme le rapport d'audit précédent)
    5. Passe au composant suivant
```

## Rapport attendu

À la fin, produis :

```
══════════════════════════════════════════
  AUDIT CORE FRAMEWORK — RAPPORT FINAL
══════════════════════════════════════════

INVENTAIRE
| Composant              | Avant  | Après | Tests U | Tests C | Tests I |
|------------------------|--------|-------|---------|---------|---------|
| Container DI           | ✅     | ✅    | 12      | -       | 3       |
| MantaError             | ✅     | ✅    | 8       | -       | -       |
| EventBus InMemory      | 🟡     | ✅    | 15      | 10      | 5       |
| WorkflowManager        | ❌     | ✅    | 20      | -       | 8       |
| createWorkflow/step    | ❌     | ✅    | 12      | -       | -       |
| Compensation           | ❌     | ✅    | 10      | -       | 5       |
| DML model.define       | 🟡     | ✅    | 18      | -       | -       |
| DML fluent API         | ❌     | ✅    | 15      | -       | -       |
| DML → Drizzle pipeline | ❌     | ✅    | 10      | -       | 4       |
| Module system          | 🟡     | ✅    | 12      | -       | 3       |
| Service base           | 🟡     | ✅    | 8       | -       | -       |
| Query / Query.graph    | ❌     | ✅    | 15      | -       | 6       |
| defineLink             | ❌     | ✅    | 10      | -       | 4       |
| IFilePort InMemory     | 🟡     | ✅    | -       | 12      | -       |
| ICachePort InMemory    | ✅     | ✅    | -       | 8       | -       |
| ILockingPort InMemory  | ✅     | ✅    | -       | 6       | -       |
| IJobSchedulerPort      | 🟡     | ✅    | -       | 8       | -       |
| IAuthPort              | 🟡     | ✅    | -       | 9       | -       |
| Feature flags          | ?      | ✅    | 6       | -       | -       |
| Subscriber system      | ❌     | ✅    | 10      | -       | 5       |
| Middleware system       | ?      | ✅    | 8       | -       | 3       |
| Repository base        | 🟡     | ✅    | 10      | 6       | -       |

TESTS
  Avant  : 618 pass, 0 fail
  Après  : XXX pass, 0 fail
  Ajoutés : XXX tests (U: XX, C: XX, I: XX)

ÉTAT
  Composants ❌ stub  : 0 (tous implémentés)
  Composants 🟡 partiel : 0 (tous complétés)
  Composants ✅ réel  : TOUS
  
VÉRIFICATION
  pnpm test → TOUT passe
  pnpm test:integration → TOUT passe
══════════════════════════════════════════
```
