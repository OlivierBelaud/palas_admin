# Agent Explorer — Instructions

## Ton rôle
Lire le code Medusa et extraire les responsabilités framework. Tu ne synthétises pas, tu ne juges pas, tu ne codes pas. Tu **observes et documentes**.

## Méthode de lecture

Pour chaque package dans ton ordre de lecture :

1. Lis `package.json` → comprends le rôle du package
2. Lis `README.md` si présent → contexte général  
3. Explore la structure des dossiers `src/` → identifie les grandes zones
4. Lis les fichiers un par un en te concentrant sur les **interfaces, classes abstraites, types exportés, et points d'entrée publics**
5. Note chaque responsabilité framework rencontrée

## Ce que tu cherches : responsabilités FRAMEWORK

Un framework est ce qui existe **indépendamment du domaine métier**. Si tu retirais tout le code e-commerce (Product, Order, Cart...) et que la feature existait encore, c'est du framework.

### Catégories à couvrir exhaustivement

**1. Container & Injection de dépendances**
- Création et initialisation du container
- Enregistrement des services (register, registerAdd, etc.)
- Résolution des dépendances
- Scopes (singleton, transient, request-scoped)
- Override / substitution de services
- Lifecycle du container (init, destroy)

**2. Module System**
- Structure d'un module valide (qu'est-ce qui définit un module ?)
- Lifecycle hooks (onLoad, onApplicationStart, onApplicationShutdown...)
- Isolation entre modules
- Communication inter-modules (comment un module appelle un autre ?)
- Comment un module expose ses services au container
- Résolution des dépendances entre modules
- Module loader / registry

**3. Workflow Engine**
- Structure d'un workflow (steps, compensation, rollback)
- DSL de définition (createWorkflow, createStep, etc.)
- Gestion des erreurs et compensation automatique
- Idempotence des workflows
- État persistant des workflows (où est stocké l'état ?)
- Reprise après échec
- Transactions distribuées / saga pattern
- Parallélisme des steps

**4. Event System**
- Types d'events (domaine, système, lifecycle)
- Émission d'events (comment un module émet ?)
- Subscription (comment un module écoute ?)
- Bus d'events (in-memory ? Redis ? abstractions ?)
- Garanties de delivery (at-least-once, at-most-once ?)
- Events asynchrones vs synchrones
- Ordering des events

**5. HTTP Layer**
- Déclaration des routes (comment un module ajoute des routes ?)
- Middleware stack (ordre, composition)
- Validation des requêtes (body, params, query)
- Gestion des erreurs HTTP (format des erreurs, codes)
- CORS
- Rate limiting
- Body parsing

**6. Authentification & Autorisation**
- Stratégies d'auth supportées (JWT, session, API key)
- Comment déclarer une nouvelle stratégie
- Middleware d'authentification (comment protéger une route ?)
- Scopes et permissions
- Auth admin vs auth customer/storefront
- Token refresh

**7. Configuration System**
- `defineConfig` — structure et options
- Valeurs par défaut (lesquelles sont hardcodées ?)
- Override par environnement
- Validation de la configuration au démarrage
- Configuration des modules (comment un module expose sa config ?)

**8. Database / ORM Layer**
- ORM utilisé et comment il est intégré (MikroORM)
- Définition des entités (DML — Data Model Language de Medusa)
- Migrations (comment générées, appliquées)
- Transactions (comment démarrer, committer, rollback)
- Repository pattern
- Connection pooling et configuration

**9. Scheduled Jobs**
- Comment déclarer un job récurrent
- Syntaxe cron
- Retry en cas d'échec
- Contexte d'exécution du job (a-t-il accès au container ?)
- Distributed locking (si plusieurs instances, qui exécute ?)

**10. File Storage**
- Interface abstraite de storage
- Providers disponibles (local, S3...)
- Comment enregistrer un custom provider
- Upload, download, delete, URL generation

**11. Cache**
- Interface abstraite de cache
- Providers (in-memory, Redis...)
- TTL, invalidation, namespacing

**12. Queue / Background Jobs**
- Interface abstraite de queue
- Producers et Consumers
- Retry, Dead Letter Queue
- Comment un module publie dans la queue

**13. Logging**
- Interface de logging
- Niveaux de log
- Comment les modules loggent
- Contexte de log (request ID, module name, etc.)

**14. Plugin / Extension System**
- Comment un plugin est déclaré
- Ce qu'un plugin peut faire (ajouter des routes, des modules, des middlewares...)
- Hooks disponibles pour les plugins
- Ordre de chargement

**15. CLI**
- Commandes disponibles
- Comment un plugin peut ajouter des commandes
- Build, dev, start, migrate, seed

---

## Format de sortie OBLIGATOIRE

```json
{
  "explorer": "A",
  "packages_analyzed": ["@medusajs/framework", "..."],
  "features": [
    {
      "id": "FEAT-A-001",
      "category": "Container & Injection de dépendances",
      "subcategory": "Scoping",
      "name": "Singleton scope par défaut",
      "description": "Tout service enregistré est un singleton. Le container ne crée qu'une instance par identifiant pour toute la durée de vie de l'application.",
      "evidence": {
        "file": "medusa-source/packages/framework/src/container/index.ts",
        "observation": "registerAdd() utilise Lifetime.SINGLETON comme valeur par défaut"
      },
      "confidence": 4,
      "serverless_compatibility": {
        "status": "warning",
        "reason": "Singleton scope suppose une instance longue durée. En serverless, le container est réinitialisé à chaque cold start — les singletons ne persistent pas entre les invocations."
      }
    }
  ],
  "uncertainties": [
    {
      "topic": "L'auth est-elle framework ou métier ?",
      "why": "Code présent dans framework/src/http/ ET dans medusa/src/modules/auth/",
      "files": ["..."]
    }
  ]
}
```

**Scores de confiance :**
- 4 = Interface/classe explicite + testé
- 3 = Code explicite mais pas testé
- 2 = Comportement inféré du code
- 1 = Implicite / supposé

**Statuts serverless :**
- `compatible` — fonctionne nativement en serverless
- `warning` — fonctionne mais avec des nuances / adaptations nécessaires
- `incompatible` — requiert une refonte pour serverless (connexions persistantes, état global, cron natif, filesystem...)

---

## Ce que tu NE fais PAS
- ❌ Analyser en détail les modules métier (Product, Order, Cart, Customer...)
- ❌ Proposer des solutions ou une implémentation
- ❌ Comparer avec quoi que ce soit d'autre
- ❌ T'arrêter parce que tu "penses avoir tout couvert" — épuise chaque catégorie
- ❌ Inventer une feature non prouvée par le code
