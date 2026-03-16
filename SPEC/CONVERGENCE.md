# Phase 4 — Convergence Loop

## Condition d'arrêt

La boucle s'arrête quand **toutes** ces conditions sont vraies :
- Zéro nouvelle feature depuis le dernier run
- Confiance globale ≥ 85%
- Toutes les catégories ≥ 75%
- Zéro challenge "critical" ouvert

Maximum 5 itérations. Si pas convergé après 5 runs : marquer les zones `[PERSISTENTLY_UNCERTAIN]` et passer à la synthèse finale quand même.

## À chaque itération

1. Relis `audit-output/phase3/spec-draft.json`
2. Identifie features confidence ≤ 2 et catégories < 75%
3. Pour chaque zone faible, spawne un Explorer ciblé :

```
Tu es un Explorer ciblé. 

La catégorie "{CATEGORY}" a une confiance de {X}%.
Challenge non résolu : {CHAL-XXX description}

Lis UNIQUEMENT :
- {fichiers spécifiques identifiés par le Challenger}

Réponds UNIQUEMENT à :
1. {question précise}

Output : audit-output/phase4/explorer-targeted-{N}.json
```

4. Re-synthétise avec les nouveaux résultats
5. Mets à jour `audit-output/phase4/convergence-tracker.json` :

```json
{
  "runs": [
    { "run": 1, "features_total": 47, "features_new": 47, "confidence_global": 62 },
    { "run": 2, "features_total": 54, "features_new": 7, "confidence_global": 74 },
    { "run": 3, "features_total": 56, "features_new": 2, "confidence_global": 83 }
  ],
  "converged": false,
  "blockers": ["Job Scheduling: 58%, 2 challenges critiques"]
}
```
