# PostHog — gaps de tracking à corriger

## P1 — Pixel non-fonctionnel sur `.myshopify.com`

**Constat.** Quand un utilisateur arrive sur `fancy-palas.myshopify.com` (par ex. via
un lien Klaviyo mal formé — cf. [klaviyo-optimizations.md](./klaviyo-optimizations.md)),
notre pixel PostHog ne trace rien. Klaviyo si.

**Hypothèse la plus vraisemblable.** Le thème Shopify initialise PostHog avec un
`api_host` relatif à `fancypalas.com` (notre proxy `/api/posthog/` est hosté là). Sur
le domaine `.myshopify.com`, ces requêtes soit échouent (CORS, cross-origin), soit ne
partent jamais si le script vérifie `window.location.hostname`.

**Action.**
1. Auditer le thème Shopify (`layout/theme.liquid` ou snippet dédié) — chercher
   l'init PostHog. Vérifier :
   - `api_host` est-il hardcodé `fancypalas.com` ou dynamique ?
   - Un `if (window.location.hostname !== 'fancypalas.com') return` qui bloquerait ?
2. Fix : rendre l'init PostHog fonctionnel sur les deux domaines, OU au minimum
   envoyer un `$pageview` même en anonyme depuis `.myshopify.com` pour ne pas perdre
   complètement la session.
3. À long terme : fermer `fancy-palas.myshopify.com` aux utilisateurs finaux (noindex
   + redirect 301 permanent vers `fancypalas.com`), pour que ce cas n'existe plus.

**Cas de test.** Julie / `lereboursj@gmail.com`, 21/04 12:12 — cf. rapport.

---

## P1 — Visiteurs Shop Pay / Shop app invisibles à notre pixel

**Constat.** `aureli112@hotmail.com` a un Shopify order (Apr 14, €61, `source: web`) avec
`custom_attributes: posthog_distinct_id=019d8c08-...` MAIS PostHog a 0 event pour ce
distinct_id. Shopify Flow a tourné sur elle aujourd'hui (22/04, BROWSE abandonment)
sans qu'on voie aucune trace non plus.

**Hypothèse.** Elle browse via **l'app Shop** (discovery feed) ou **Shop Pay one-tap** sans
jamais charger notre thème dans un browser standard. Les cart.attributes `posthog_*`
sont peut-être inherités d'une session précédente (shared device) ou générés par le
checkout UI extension sans que PostHog puisse sender ses events dans ce sandbox.

**Action.**
1. Vérifier dans le thème si les cart attributes `posthog_distinct_id` / `posthog_cart_token`
   sont set côté serveur (via `/cart/update.js`) ou uniquement côté client.
   Fichier probable : `assets/posthog-bridge.js` ou similaire dans le thème.
2. Ajouter un **Shopify Custom Pixel** (cf. [shopify-integration.md](./shopify-integration.md))
   qui fire dans le sandbox Shopify — il voit ces sessions invisibles.
3. Pour les orders avec `posthog_distinct_id` en custom_attributes mais 0 event PostHog,
   émettre un `$identify` server-side après réception du webhook `orders/create` pour
   créer quand même la personne dans PostHog avec son email.

---

## P2 — Identity resolution ne catch pas les visiteurs qui n'atteignent jamais le checkout

**Constat.** Le module `cart-tracking/identity-resolver.ts` résout le `distinct_id → email`
via `person.properties.email` dans PostHog. Ça marche **seulement si** un `$identify`
a déjà tourné (via checkout bridge ou cookie Klaviyo décrypté).

Pour un visiteur qui :
- Clique un email Klaviyo avec `?_kx=...`
- Arrive sur une product page
- N'ajoute jamais au panier
- Repart

→ Klaviyo le voit. On ne le verra **jamais** comme email connu dans PostHog car pas de
`$identify` triggered.

**Action.**
1. Dans le PostHog proxy (`packages/plugin-posthog-proxy`), parser le `_kx` URL param
   sur les `$pageview`, décoder le cid Klaviyo, faire un lookup profile → email,
   puis fire un `$identify` automatique.
2. Documenter ce comportement dans le proxy.

---

## P3 — `custom_attributes: posthog_distinct_id` inherited between sessions

**Constat.** Le thème pose `posthog_distinct_id` comme cart attribute. Shopify persiste
les cart attributes tant que le cart est actif. Si deux utilisateurs partagent un device,
le 2e hérite du distinct_id du 1er sur le cart.

**Action.** Renouveler l'attribut à chaque nouveau `$identify` (quand l'email change) —
ou mieux, stocker `posthog_distinct_id_history` avec timestamps pour permettre
l'investigation a posteriori.

---

## P4 — Retention warehouse PostHog — impact sur les replays

**Constat.** Lors des queries sur `shopify_orders` très anciens (ex. order de 2024 si il
y en avait), certains events PostHog ne sont plus disponibles. Retention actuelle
PostHog EU = 7 ans full events, 12 mois data warehouse (à confirmer).

**Action.** Documenter la fenêtre de replay effective pour `rebuildCarts`. Si on purge
les events > 12 mois, le replay est limité à 1 an d'historique max, même si les Shopify
orders remontent plus loin.
