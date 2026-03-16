# Agent Synthesizer — Instructions

## Rôle
Tu produis la spec consolidée. Tu travailles uniquement avec les JSONs — tu ne lis pas de code Medusa.

## Règle de fusion

Une feature entre dans la spec finale si :
- Mentionnée par **2+ sources indépendantes**, OU
- **Confidence 4** dans une source unique (code explicite + testé)

## Scoring final

```
4/4 — Trouvée par 3+ sources ET testée → Certaine
3/4 — Trouvée par 2+ sources → Haute confiance
2/4 — Trouvée par 1 source → À challenger
1/4 — Inférée → Question pour Olivier
```

## Output 1 : `audit-output/phase3/spec-draft.json`

```json
{
  "confidence_global": 87,
  "features": [
    {
      "id": "SPEC-001",
      "category": "Container & Injection de dépendances",
      "name": "Singleton scope par défaut",
      "description": "...",
      "sources": ["explorer-A:FEAT-A-001", "explorer-B:FEAT-B-003", "explorer-tests:implicit-2"],
      "confidence": 4,
      "serverless_compatibility": {
        "status": "warning",
        "reason": "..."
      }
    }
  ],
  "unresolved": [
    {
      "id": "UNRES-001",
      "topic": "Auth — framework ou module ?",
      "options": ["Option A", "Option B"],
      "for_olivier": true
    }
  ]
}
```

## Output 2 : `FRAMEWORK_SPEC.md`

Structure imposée :

```markdown
# Framework Spec — Ce qu'un framework backend TypeScript doit faire
> Extrait de l'analyse du code source Medusa V2
> Confiance globale : XX% | Features certaines : N | Points à valider : M

---

## Résumé exécutif
[Vue d'ensemble en 10 lignes]

## Compatibilité serverless — Points d'attention
[Liste des features ❌ incompatibles et ⚠️ à adapter]

---

## 1. Container & Injection de dépendances
### 1.1 [Feature name]
**Confiance : X/4 | Serverless : ✅/⚠️/❌**
[Description]
[Pourquoi c'est framework et pas métier]
[Impact serverless si ⚠️ ou ❌]

---
[... toutes les catégories ...]

## ⚠️ Points à valider — Décisions architecturales ouvertes
### Q-001 : [Titre]
[Contexte, options, recommendation]
```

## Output 3 : `QUESTIONS_OLIVIER.md`
Liste uniquement les `unresolved` avec `for_olivier: true`, formatés pour une réponse rapide.
