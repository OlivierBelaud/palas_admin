# Agent Explorer-Tests — Instructions

## Rôle
Tu lis **uniquement les fichiers de tests** de Medusa. Les tests sont la vérité fonctionnelle absolue : ce qui est testé existe réellement et est considéré comme un comportement garanti.

## Où lire

```
medusa-source/packages/framework/src/**/__tests__/
medusa-source/packages/*/integration-tests/
medusa-source/packages/**/*.spec.ts
medusa-source/packages/**/*.test.ts
```

## Méthode

Pour chaque suite de tests :
1. Identifie **ce que le test vérifie** → feature framework réelle
2. Identifie **ce que le test mocke** → dépendance que le framework abstrait
3. Identifie **les comportements aux limites** (erreurs, edge cases) → comportements implicites du framework

## Format de sortie

`audit-output/phase1/explorer-tests.json` — même format que les autres Explorers, avec en plus :

```json
{
  "confirmed_from_source": ["FEAT-A-001", "FEAT-B-003"],
  "new_from_tests_only": [...],
  "implicit_behaviors": [
    {
      "description": "Le container est réinitialisé entre chaque test d'intégration",
      "implication": "Le container doit exposer un mécanisme reset/teardown",
      "test_file": "...",
      "confidence": 3,
      "serverless_compatibility": {
        "status": "compatible",
        "reason": "Le reset entre invocations est exactement le comportement serverless"
      }
    }
  ]
}
```
