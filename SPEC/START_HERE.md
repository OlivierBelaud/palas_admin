# Démarrage — Audit Medusa Framework

## Étape 1 — Setup (terminal, une seule fois)

```bash
# Dans ce dossier
bash setup.sh
```

Ça clone `medusajs/medusa` dans `medusa-source/` et crée la structure d'output.

---

## Étape 2 — Ouvre ce dossier dans Claude Code

```bash
claude .
```

---

## Étape 3 — Colle ce prompt dans Claude Code

```
Lis CLAUDE.md.

Lance l'audit Phase 1 en spawnant 4 sous-agents en parallèle via le tool Task :

Task 1 — Explorer A
  Instructions : agents/EXPLORER.md
  Tu es Explorer A
  Ordre de lecture : framework → medusa → utils → types
  Output : audit-output/phase1/explorer-A.json

Task 2 — Explorer B
  Instructions : agents/EXPLORER.md
  Tu es Explorer B
  Ordre de lecture : orchestration → workflows-sdk → modules-sdk → core-flows
  Output : audit-output/phase1/explorer-B.json

Task 3 — Explorer C
  Instructions : agents/EXPLORER.md
  Tu es Explorer C
  Ordre de lecture : types → utils → framework → medusa (ordre inversé de A)
  Output : audit-output/phase1/explorer-C.json

Task 4 — Explorer Tests
  Instructions : agents/EXPLORER_TESTS.md
  Output : audit-output/phase1/explorer-tests.json

Attends que les 4 soient terminés.
Ensuite lance le Challenger (agents/CHALLENGER.md).
Ensuite le Synthesizer (agents/SYNTHESIZER.md).
Ensuite la boucle de convergence (agents/CONVERGENCE.md).

Ne t'arrête pas avant d'avoir produit FRAMEWORK_SPEC.md et QUESTIONS_OLIVIER.md.
```

---

## Ce que tu obtiens à la fin

```
FRAMEWORK_SPEC.md       ← La spec exhaustive du framework
QUESTIONS_OLIVIER.md    ← Les 5-10 décisions architecturales à prendre
audit-output/           ← Toute la trace du raisonnement des agents
```

---

## Phase suivante (après validation de FRAMEWORK_SPEC.md)

Une fois que tu as validé le document et répondu aux questions :

```
La spec du framework est dans FRAMEWORK_SPEC.md.

Écris tous les tests du framework dans tests/framework/.
Un fichier de tests par catégorie (container.spec.ts, modules.spec.ts, workflows.spec.ts, etc.)
Les tests doivent être framework-agnostique — ils testent des interfaces, pas des implémentations.
Utilise Vitest.
Les tests doivent ÉCHOUER pour l'instant — c'est voulu. Ils définissent ce que le framework doit faire.
```
