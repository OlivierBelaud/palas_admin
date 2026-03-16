# Strategie de Migration Medusa -> Manta

> Guide pour migrer un projet Medusa existant vers le framework Manta

---

## Principes fondamentaux

1. **Les tables ne changent pas** : le plugin medusa-commerce utilise les memes modeles DML, memes noms de tables, memes colonnes que Medusa V2.
2. **Le SQL c'est du SQL** : que tu lises les tables avec MikroORM ou Drizzle, les donnees sont les memes.
3. **Le framework change, pas les donnees** : Manta remplace le "moteur", pas le "garage".

---

## Scenarios de migration

### Scenario 1 — Nouveau projet (zero donnees)

```bash
npx create-manta-app my-project
cd my-project
npm install @manta/plugin-medusa-commerce
manta db:migrate
manta dev
```

Aucune migration. Les tables se creent. Termine.

### Scenario 2 — Projet Medusa existant, meme PostgreSQL

**Ce qui change :** le framework (Medusa -> Manta)
**Ce qui ne change PAS :** la base de donnees, les tables, les donnees

Etapes :
1. Installer Manta dans le projet
2. Configurer l'adapter database (meme connection string)
3. Installer le plugin medusa-commerce
4. Copier les fichiers custom (routes, workflows, subscribers) dans la structure Manta
5. Verifier la compatibilite : `manta db:diff` (zero diff attendu)
6. Demarrer : `manta dev`

**Zero migration de donnees. Zero migration de schema.**

### Scenario 3 — Projet Medusa existant, migration vers Neon (serverless)

**Sous-probleme A : migrer l'hebergement PostgreSQL -> Neon**

```bash
# Export depuis l'ancien serveur
pg_dump -h old-server -U postgres medusa_db > dump.sql

# Import dans Neon
psql "postgresql://user:pass@my-project.neon.tech/medusa_db" < dump.sql
```

Neon c'est du PostgreSQL standard. pg_dump/pg_restore fonctionne.

**Sous-probleme B : changer d'ORM (MikroORM -> Drizzle)**

Deux approches :

**Approche pragmatique (recommandee)** :
```bash
# Drizzle introspect la DB existante et genere les schemas
npx drizzle-kit introspect --connection "postgresql://...neon.tech/medusa_db"
# Verifie que le schema genere correspond au DML Manta
manta db:diff
```

**Approche propre** :
- Le DML Manta genere le schema Drizzle
- On compare avec le schema Medusa existant
- S'il matche -> rien a faire
- S'il y a des differences -> migration de reconciliation generee automatiquement

### Scenario 4 — Migration progressive (recommande pour gros projets)

1. **Phase 1** : Manta + adapter MikroORM (meme ORM que Medusa)
   - Zero risque, meme comportement exact
   - On change juste le framework, pas l'infra

2. **Phase 2** : Swap adapter MikroORM -> Drizzle
   - `manta db:introspect` pour verifier la compatibilite
   - Tests de non-regression

3. **Phase 3** : Swap hebergement PG -> Neon
   - pg_dump/pg_restore
   - Swap adapter database vers Neon serverless driver

4. **Phase 4** : Deploiement serverless (Vercel)
   - Swap adapter HTTP vers Nitro/Next.js
   - Swap tous les adapters in-memory vers adapters durables

---

## Commandes CLI pour la migration

| Commande | Role |
|----------|------|
| `manta db:introspect` | Lit une DB existante et verifie la compatibilite avec le schema DML |
| `manta db:diff` | Compare le schema DML attendu avec le schema DB reel (read-only, voir SPEC-087) |
| `manta db:migrate` | Applique les migrations |
| `manta db:generate` | Genere une migration depuis les changements DML |
| `manta migrate-from-medusa` | Assistant de migration automatise |

### `manta migrate-from-medusa` (outil dedie)

Cet outil :
1. Detecte la config Medusa existante (`medusa-config.ts`)
2. Genere la config Manta equivalente (`manta-config.ts`)
3. Copie les fichiers custom dans la structure plugin Manta :
   - `src/api/` -> routes
   - `src/workflows/` -> workflows
   - `src/subscribers/` -> subscribers
   - `src/jobs/` -> jobs
   - `src/modules/` -> modules custom
   - `src/links/` -> links
4. Verifie la compatibilite DB : `manta db:diff`
5. Genere un rapport de migration avec les actions manuelles restantes

---

## Contrat de retro-compatibilite

### Ce que le plugin medusa-commerce DOIT garantir

1. **Memes interfaces de modules** : `IProductModuleService`, `IOrderModuleService`, etc. identiques a Medusa V2
2. **Memes noms de tables** : `product`, `order`, `cart`, etc.
3. **Memes colonnes** : memes types, memes contraintes, memes indexes
4. **Memes API routes** : `/admin/products`, `/store/carts`, etc. avec memes signatures request/response
5. **Memes workflows** : `create-order-workflow`, etc. avec memes steps et compensation
6. **Memes events** : `product.created`, `order.placed`, etc.

### Ce qui change (et c'est OK)

1. **L'ORM** : MikroORM -> Drizzle (mais les tables sont les memes)
2. **Le container DI** : Awilix -> potentiellement autre chose (mais les interfaces sont les memes). ServiceLifetime explicite (SINGLETON/SCOPED/TRANSIENT) formalise les conventions implicites de Medusa.
3. **Le serveur HTTP** : Express -> Nitro (mais les routes sont les memes)
4. **Les modules infra** : Redis -> Upstash Redis, etc. (mais les ports ICachePort, IEventBusPort sont les memes)
5. **Les erreurs** : MedusaError -> MantaError (memes types, mapping 1:1). Le dbErrorMapper passe de MikroORM-specifique a generique (chaque adapter ORM fournit le sien).
6. **L'auth** : `extractAuthContext` n'existe plus comme methode unique — l'extraction des credentials est la responsabilite du trigger adapter (HTTP, queue, cron). Les methodes de verification (verifyJwt, verifyApiKey) restent identiques.

---

## Matrice de compatibilite

| Composant | Medusa V2 | Manta (local) | Manta (Vercel) |
|-----------|-----------|---------------|----------------|
| Framework | @medusajs/framework | @manta/core | @manta/core |
| HTTP | Express | Nitro (preset node) | Nitro (preset vercel) |
| ORM | MikroORM | Drizzle | Drizzle + Neon |
| Cache | Redis | In-memory | Upstash Redis |
| Events | Redis | In-memory | Vercel Queues |
| Workflow | Redis | PG local | Neon |
| Files | S3 | Local FS (static/) | Vercel Blob |
| Auth | Session + JWT | JWT | JWT |
| DB | PostgreSQL | PG local | Neon |
| Commerce | Built-in | Plugin | Plugin |
