Lis `docs/CLI_SPEC.md` section 7 (package @manta/cli) et `docs/FULL_COVERAGE_SPEC.md` partie 4 (tests e2e).

## Situation

- 582 tests verts, 0 fail, 0 skip, 22 todo
- 12 tests e2e CLI dans `cli/__tests__/integration/cli-lifecycle.integration.test.ts` sont en `todo` parce que le binaire CLI n'est pas câblé
- Les tests conformance `adapter-drizzle-pg` (12 tests) sont écrits mais l'adapter doit être branché sur la vraie PG Docker

## Étape 1 : Câbler le binaire CLI

Le fichier `bin/manta.ts` doit :
1. Parser les arguments avec Commander
2. Dispatcher vers les fonctions de commande (devCommand, initCommand, etc.)
3. Gérer les erreurs globalement (catch → message humain + exit(1))
4. Gérer les signaux (SIGINT, SIGTERM → graceful shutdown)

Le fichier `src/index.ts` doit :
1. Configurer Commander avec toutes les commandes de CLI_SPEC.md §2
2. Pour chaque commande : résoudre la config, construire le `deps` réel (pas les mocks), appeler la fonction
3. Les commandes non-v1 (plugin, user, migrate-from-medusa) → message "not available in v1" + exit(1)

La glue entre Commander et les fonctions de commande :
```
Commander parse les args
  → loadEnv(cwd)
  → loadConfig(cwd) 
  → resolveAdapters(config, profile)
  → construire le deps réel { db: realAdapter, locking: realAdapter, logger: realLogger, ... }
  → appeler xCommand(options, deps)
```

C'est cette glue qui n'existe pas encore. Les fonctions de commande et les tests existent.

## Étape 2 : Convertir les 12 e2e todo en vrais tests

Une fois le binaire câblé, déskippe les 12 tests e2e un par un. Ils spawent le vrai binaire, donc il faut que ça marche end-to-end. Boucle TDD : déskippe un test, exécute, corrige le code si rouge, passe au suivant.

## Étape 3 : Tests conformance adapter-drizzle-pg

Lance `pnpm test:up` (démarre PG Docker), puis exécute les 12 tests conformance de `adapter-drizzle-pg`. Si l'adapter n'est pas complet, implémente ce qui manque pour que les tests passent. L'adapter doit respecter le contrat IDatabasePort.

## Vérification finale

```bash
pnpm test        # unitaires sans Docker
pnpm test:all    # unitaires + intégration avec Docker
```

Objectif : 0 fail, 0 skip. Les todo restants (strict mode etc.) sont acceptés.
