Fais un audit complet de TOUT le monorepo Manta. Chaque package, chaque fichier, chaque fonction exportée.

## Mission

On veut un état des lieux exhaustif. Pour chaque composant du monorepo, on veut savoir : est-ce que c'est implémenté pour de vrai, est-ce que c'est testé avec les 3 couches, est-ce qu'il manque quelque chose par rapport aux specs.

## Procédure

### 1. Inventaire automatique

```bash
# Tous les fichiers source
find packages/ -path "*/src/*.ts" -not -path "*/node_modules/*" | sort

# Tous les fichiers de test
find packages/ -name "*.test.ts" -not -path "*/node_modules/*" | sort

# Toutes les fonctions/classes exportées
grep -rn "^export " packages/*/src/**/*.ts | grep -v "node_modules" | sort

# Stubs et TODO restants
grep -rn "Not implemented\|// TODO\|// STUB\|// FIXME\|throw new Error('TODO')\|return {}\|return input" packages/*/src/ --include="*.ts" | grep -v "node_modules" | grep -v "test"
```

### 2. Audit par package

Pour CHAQUE package, produis un tableau avec CHAQUE fonction/classe exportée :

#### packages/core/

```
| Export                    | Fichier                     | État | Tests U | Tests C | Tests I | Manque |
|---------------------------|-----------------------------|------|---------|---------|---------|--------|
| MantaContainer            | container/index.ts          | ?    | ?       | ?       | ?       |        |
| createContainer           | container/index.ts          | ?    | ?       | ?       | ?       |        |
| MantaError                | errors/index.ts             | ?    | ?       | ?       | ?       |        |
| ...chaque export...       |                             |      |         |         |         |        |
```

État :
- ✅ = logique réelle, fait ce que la spec dit
- 🟡 = partiel (certains cas manquent)
- ❌ = stub / mock / retourne une valeur bidon
- 🚫 = n'existe pas encore (dans la spec mais pas codé)

#### packages/cli/

Même tableau pour chaque commande et chaque utilitaire.

#### packages/adapter-*/

Même tableau pour chaque adapter et chaque méthode du port.

#### packages/test-utils/

Même tableau.

### 3. Croisement avec les specs

Ouvre `docs/FRAMEWORK_SPEC.md` et `docs/CLI_SPEC.md`. Pour chaque comportement documenté dans les specs, vérifie qu'il existe :
1. Du code qui l'implémente
2. Un test qui le vérifie

Liste les comportements specs qui n'ont NI code NI test.

### 4. Vérification des interfaces de ports

Pour chaque port (interface I*Port) :
- Liste toutes les méthodes de l'interface
- Vérifie que l'implémentation InMemory implémente CHAQUE méthode
- Vérifie que l'adapter réel (drizzle-pg, pino, nitro) implémente CHAQUE méthode
- Vérifie que chaque méthode a un test conformance

```bash
# Trouver toutes les interfaces de ports
grep -rn "export interface I.*Port" packages/core/src/ --include="*.ts"

# Pour chaque port, lister les méthodes
grep -A50 "export interface IDatabasePort" packages/core/src/ports/database.port.ts | grep "  [a-z]"
```

### 5. Vérification des tests

Pour chaque fichier de test :
- Compte les `it()`, `it.skip()`, `it.todo()`
- Vérifie qu'aucun test n'est creux (Standard 2 de l'audit précédent)
- Vérifie que les assertions sont substantielles

```bash
# Compter les tests par état
grep -rn "it(" packages/ --include="*.test.ts" | grep -v node_modules | wc -l
grep -rn "it.skip(" packages/ --include="*.test.ts" | grep -v node_modules | wc -l
grep -rn "it.todo(" packages/ --include="*.test.ts" | grep -v node_modules | wc -l

# Détecter les tests potentiellement creux
grep -B1 -A3 "it(" packages/ --include="*.test.ts" | grep -v node_modules | grep "expect(true)\|\.toBeDefined()\|\.not\.toThrow()$"
```

### 6. Exécution

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration 2>&1 || pnpm test:all 2>&1

# Le résultat EXACT — pas d'approximation
```

## Rapport final

```
══════════════════════════════════════════════════════
  AUDIT COMPLET MONOREPO MANTA — ÉTAT DES LIEUX
══════════════════════════════════════════════════════

PACKAGES
  packages/core/           : XX exports, XX testés, XX manquants
  packages/cli/            : XX exports, XX testés, XX manquants
  packages/adapter-drizzle-pg/ : XX exports, XX testés, XX manquants
  packages/adapter-logger-pino/: XX exports, XX testés, XX manquants
  packages/adapter-nitro/  : XX exports, XX testés, XX manquants
  packages/test-utils/     : XX exports, XX testés, XX manquants

COMPOSANTS PAR ÉTAT
  ✅ Réel + testé         : XX
  🟡 Partiel              : XX (liste)
  ❌ Stub                 : XX (liste)
  🚫 Manquant (dans spec) : XX (liste)

TESTS
  Total                    : XXX
  Pass                     : XXX
  Fail                     : XXX
  Skip                     : XXX
  Todo                     : XXX
  Creux détectés           : XXX (liste)

COUVERTURE PAR COUCHE
  Unitaires                : XXX tests
  Conformance              : XXX tests
  Intégration              : XXX tests
  E2E smoke                : XXX tests

INTERFACES DE PORTS
  | Port              | Méthodes | InMemory | Adapter réel | Tests conf |
  |-------------------|----------|----------|--------------|------------|
  | IDatabasePort     | XX       | XX/XX    | XX/XX        | XX         |
  | ILoggerPort       | XX       | XX/XX    | XX/XX        | XX         |
  | ICachePort        | XX       | XX/XX    | -            | XX         |
  | IEventBusPort     | XX       | XX/XX    | -            | XX         |
  | ILockingPort      | XX       | XX/XX    | -            | XX         |
  | IFilePort         | XX       | XX/XX    | -            | XX         |
  | IHttpPort         | XX       | XX/XX    | XX/XX        | XX         |
  | IAuthPort         | XX       | XX/XX    | -            | XX         |
  | IJobSchedulerPort | XX       | XX/XX    | -            | XX         |
  | INotificationPort | XX       | XX/XX    | -            | XX         |
  | IWorkflowStorage  | XX       | XX/XX    | -            | XX         |

COMPORTEMENTS SPEC SANS CODE NI TEST
  (liste exhaustive — chaque item = une dette technique identifiée)

ACTIONS REQUISES
  Priorité 1 (bloquant) :
    - ...
  Priorité 2 (important) :
    - ...
  Priorité 3 (nice to have) :
    - ...

COMMANDE DE VÉRIFICATION
  pnpm test       → XXX pass / X fail
  pnpm test:all   → XXX pass / X fail
══════════════════════════════════════════════════════
```
