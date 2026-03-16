# Prompt : Audit qualité de tous les tests du monorepo Manta

## Mission

Tu vas auditer **tous les tests de tous les packages** du monorepo Manta. Pour chaque fichier de test, tu vérifies qu'il respecte les standards de qualité ci-dessous. Si un test est mauvais, tu le corriges. Si un stub vide empêche un test d'avoir de la valeur, tu le signales et tu le supprimes ou le remplace.

## Étape 0 : Inventaire

Commence par lister tous les fichiers de test du monorepo :

```bash
find packages/ -name "*.test.ts" -o -name "*.spec.ts" | sort
```

Et tous les fichiers source qui pourraient être des stubs vides :

```bash
# Fichiers source suspectés d'être des stubs (fonctions vides ou qui throw "Not implemented")
grep -rl "Not implemented\|throw new Error\|TODO\|FIXME" packages/*/src/ --include="*.ts" | sort
```

Affiche le résultat. C'est ta carte du terrain.

---

## Standards de qualité

### Standard 1 : Injection de dépendances

Toute fonction qui consomme un port (DB, locking, logger, event bus, cache, filesystem) **DOIT** accepter ses dépendances en paramètre via une interface `XDeps` ou `XCommandDeps`.

**Audit** : pour chaque commande CLI et chaque service, vérifie :
- [ ] La fonction accepte un objet `deps` typé
- [ ] Les ports sont des interfaces, pas des classes concrètes
- [ ] Le test crée des mocks pour chaque port via `vi.fn()`

**Si violation** : refactore la signature de la fonction pour accepter `deps`, puis corrige les tests.

### Standard 2 : Zéro test creux

Un test est **creux** s'il ne vérifie aucun comportement observable. Patterns interdits :

```typescript
// INTERDIT — teste que du vide ne crash pas
it('should work', async () => {
  await command()
  // aucune assertion, ou juste :
  expect(true).toBe(true)
})

// INTERDIT — teste l'existence
it('should be a function', () => {
  expect(typeof command).toBe('function')
})

// INTERDIT — not.toThrow seul sans autre vérification
it('should not throw', async () => {
  await expect(command()).resolves.not.toThrow()
})

// INTERDIT — teste un stub vide
it('should return', async () => {
  const result = await command()
  expect(result).toBeUndefined()  // la fonction est vide, évidemment undefined
})
```

**Audit** : pour chaque `it()` block, vérifie qu'il contient au moins UNE assertion substantielle :
- `toHaveBeenCalledWith(...)` — un mock a été appelé avec les bons args
- `toHaveBeenCalledTimes(...)` — un mock a été appelé le bon nombre de fois
- `toThrow(...)` / `rejects.toThrow(...)` avec un message spécifique
- `toEqual(...)` / `toContain(...)` sur un résultat non-trivial
- Vérification d'ordre d'appel entre mocks
- Vérification de side-effects (fichier créé, log émis avec message précis)

**Si violation** : réécris le test pour qu'il vérifie un vrai comportement. Réfère-toi à `docs/CLI_SPEC.md` et `docs/FRAMEWORK_SPEC.md` pour savoir quel comportement attendu tester.

### Standard 3 : Messages d'erreur vérifiés

Chaque message d'erreur documenté dans les specs DOIT être vérifié par au moins un test, par substring match.

```typescript
// BON — vérifie le message exact de la spec
await expect(migrateCommand({}, deps)).rejects.toThrow(
  /Migration lock timeout/
)

// BON — vérifie le message via le logger mock
expect(deps.logger.error).toHaveBeenCalledWith(
  expect.stringContaining('Cannot connect to database')
)

// MAUVAIS — vérifie juste "qu'une erreur" se produit sans vérifier laquelle
await expect(migrateCommand({}, deps)).rejects.toThrow()
```

**Audit** : pour chaque test d'erreur, vérifie que le message attendu matche la spec.

### Standard 4 : Zéro stub vide dans le code source

Un stub vide est une fonction qui :
- Ne fait rien (`return` immédiat ou `return undefined`)
- Throw "Not implemented"
- A un body `// TODO`

```typescript
// STUB VIDE — interdit
export async function migrateCommand(options: any): Promise<void> {
  // TODO: implement
}

// STUB VIDE — interdit
export async function rollbackCommand(): Promise<void> {
  throw new Error('Not implemented')
}
```

**Audit** :
- Scan tous les fichiers source de tous les packages
- Identifie chaque stub vide
- Pour chaque stub : soit implémente la logique (si la spec est claire), soit supprime le fichier et marque le test comme `it.todo(...)` ou `it.skip(...)` avec un commentaire expliquant ce qui manque

### Standard 5 : Couverture des specs

Pour chaque package, croise les tests existants avec la spec correspondante :

| Package | Spec de référence |
|---------|-------------------|
| `packages/cli/` | `docs/CLI_SPEC.md` |
| `packages/core/` | `docs/FRAMEWORK_SPEC.md` |
| `packages/adapter-*` | Le port (interface) qu'il implémente |

**Audit** : identifie les comportements documentés qui n'ont AUCUN test. Liste-les dans le rapport.

---

## Procédure par package

Pour chaque package dans `packages/` :

### 1. Scanner les stubs

```bash
cd packages/<package>
# Fonctions vides ou not-implemented
grep -n "Not implemented\|throw new Error('TODO')\|// TODO" src/**/*.ts
# Fonctions avec body vide (return sans logique)
grep -A2 "async function\|export function\|export async" src/**/*.ts | grep -B1 "^--$\|return$\|return;$\|{}"
```

Pour chaque stub trouvé :
- Si le comportement est dans la spec → **implémente-le**
- Si le comportement dépend d'un adapter pas encore écrit → **garde le test mais marque-le `it.skip('needs adapter implementation')`** et laisse un `// STUB:` dans le code source pour qu'on le retrouve facilement
- Si le stub n'a aucune raison d'exister → **supprime le fichier ET les tests associés**

### 2. Auditer chaque fichier de test

Ouvre le fichier. Pour chaque `it()` :

```
□ A-t-il une assertion substantielle ? (Standard 2)
□ Les dépendances sont-elles injectées/mockées ? (Standard 1)
□ Si test d'erreur : le message est-il vérifié ? (Standard 3)
□ Le comportement testé est-il dans la spec ? (Standard 5)
```

Si un `it()` échoue à un check → **corrige-le immédiatement**.

### 3. Exécuter les tests après correction

```bash
pnpm --filter @manta/<package> vitest run
```

- Si des tests sont **rouges parce que le code source est un stub** → c'est NORMAL et ATTENDU. C'est du TDD correct. Le test est bon, l'implémentation viendra.
- Si des tests sont **rouges à cause du test lui-même** → corrige le test.
- Si des tests sont **verts mais creux** → c'est le pire cas. Réécris-les.

### 4. Log des corrections

Pour chaque fichier modifié, log ce que tu as fait :

```
[AUDIT] packages/cli/__tests__/unit/commands/db/migrate.test.ts
  - SUPPRIMÉ: 3 tests creux (not.toThrow sur stub vide)
  - RÉÉCRIT: "should acquire lock" → ajout mock locking + toHaveBeenCalledWith
  - RÉÉCRIT: "should handle timeout" → ajout message check /Migration lock timeout/
  - AJOUTÉ: "should release lock in finally block" (manquait dans la spec coverage)
  - REFACTORÉ: migrateCommand signature → ajout MigrateCommandDeps injection

[AUDIT] packages/cli/src/commands/db/migrate.ts
  - STUB DÉTECTÉ: fonction vide "Not implemented"
  - ACTION: implémenté la logique d'orchestration (lock → read → apply → release)
```

---

## Exécution

Traite les packages dans cet ordre :

```
1. packages/core/          ← fondation, pas de dépendance
2. packages/cli/           ← dépend de core
3. packages/adapter-*/     ← dépendent de core (ports)
```

Pour chaque package :
1. Inventaire stubs + tests
2. Audit test par test
3. Corrections
4. Exécution vitest
5. Log

## Rapport final

À la fin, affiche :

```
══════════════════════════════════════════
  AUDIT QUALITÉ TESTS — RAPPORT FINAL
══════════════════════════════════════════

STUBS VIDES
  Supprimés          : X
  Implémentés        : Y
  Marqués skip       : Z (en attente adapter)

TESTS
  Total avant audit  : N
  Supprimés (creux)  : A
  Réécrits           : B
  Ajoutés            : C
  Total après audit  : M

RÉSULTATS VITEST
  packages/core/     : XX pass / YY fail / ZZ skip
  packages/cli/      : XX pass / YY fail / ZZ skip
  packages/adapter-* : XX pass / YY fail / ZZ skip

COMPORTEMENTS SPEC SANS TEST
  - CLI_SPEC §2.1: HMR debounce 100ms par fichier (aucun test)
  - CLI_SPEC §2.3: --all-or-nothing + CREATE INDEX CONCURRENTLY (aucun test)
  - FRAMEWORK_SPEC §074: lazy boot backoff cap 16s (aucun test)
  - ...

ÉTAT ATTENDU
  Tests verts   → logique correctement implémentée
  Tests rouges  → implémentation manquante (TDD red phase, normal)
  Tests skip    → en attente d'un adapter (Batch B)
  Tests creux   → ZÉRO (tous éliminés)
══════════════════════════════════════════
```
