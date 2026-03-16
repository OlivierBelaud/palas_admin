On vient de finir les Priorités 1 et 2. Avant de passer à autre chose, vérifie que TOUT est propre.

## 1. Tests complets

```bash
# Unitaires + conformance
pnpm test

# Intégration (avec PG local)
pnpm test:all

# Si test:all n'existe pas, lance manuellement :
npx vitest run --config vitest.integration.config.ts
```

Les 3 commandes doivent passer. Si un test d'intégration échoue (notamment les smoke tests dev/build/start), c'est probablement parce que le server-bootstrap a changé (module loading dynamique, pipeline HTTP avec auth). Corrige jusqu'au vert.

## 2. Les 10 todo restants

Liste les 10 todo qui restent :

```bash
grep -rn "it.todo\|it\.todo" packages/ --include="*.test.ts" | grep -v node_modules
```

Pour chacun, décide :
- Si c'est une feature hors scope v1 → garde le todo, documente pourquoi
- Si c'est une feature qu'on vient d'implémenter → déskippe et fais passer au vert
- Si c'est un bug dans le test → corrige

## 3. Les stubs restants

```bash
grep -rn "// STUB\|Not implemented\|// TODO" packages/*/src/ --include="*.ts" | grep -v node_modules | grep -v test
```

Il ne devrait plus y avoir de stub dans boot.ts (les 8 steps sont implémentés). S'il en reste ailleurs, liste-les.

## 4. Smoke tests e2e — vérifier avec les changements

Le smoke test `dev-smoke.integration.test.ts` a été écrit quand ProductService était hardcodé. Maintenant que le module loading est dynamique, vérifie que :

- Le smoke test crée un vrai module (pas un hardcode) dans le tmpdir
- Le smoke test POST/GET fonctionne toujours
- L'auth fonctionne (si le pipeline HTTP a maintenant l'auth activée, le smoke test doit envoyer un JWT ou les routes store doivent être publiques)

Même chose pour `build-start-smoke.integration.test.ts`.

Si les smoke tests sont cassés par les changements de P1/P2, corrige-les.

## 5. Rapport

```
VÉRIFICATION POST-P1/P2
  pnpm test          → XXX pass / X fail
  pnpm test:all      → XXX pass / X fail
  Todo restants      → X (liste + justification)
  Stubs restants     → X (liste)
  Smoke tests e2e    → pass / fail
  Régressions        → X (liste si oui)
```
