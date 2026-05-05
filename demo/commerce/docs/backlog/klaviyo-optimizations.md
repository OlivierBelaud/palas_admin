# Klaviyo — optimisations à faire

## P1 — Templates Klaviyo pointent sur `.myshopify.com` au lieu de `fancypalas.com`

**Constat.** Un lien cliqué dans l'email `B2C [FR] - Interest Médailles - 21/04`
(Julie, 21/04 12:12) renvoie vers `https://fancy-palas.myshopify.com/products/santa-maria-neckl...`
alors que le domaine canonique est `fancypalas.com`.

**Preuve.** HogQL sur `klaviyo_events` filtré `profile = 01KM91PPNQGS0C19KEJ2WVRZE7`
(lereboursj@gmail.com) — cf. rapport RGPD section Détail `lereboursj@gmail.com`.

**Conséquence.**
- Au redirect `myshopify.com → fancypalas.com`, le cookie PostHog 1st-party est perdu
  (Safari ITP strip sur cross-domain) → nouvelle session anonyme, pas d'attribution.
- Klaviyo continue de tracker via `?_kx=` URL param (identification server-side), donc
  "Active on Site" apparaît dans Klaviyo mais rien chez nous.
- Impact ampleur à mesurer : quelle proportion des clics Klaviyo de ces 30 derniers
  jours pointe sur `.myshopify.com` vs `fancypalas.com` ?

**Action.**
1. Klaviyo → Integrations → Shopify → vérifier "Store URL" : forcer `https://fancypalas.com`.
2. Klaviyo → Email Templates → passer en revue tous les liens product/collection.
   Chercher "fancy-palas.myshopify.com" dans le HTML des templates actifs.
3. Pour les Dynamic Product Blocks, vérifier que l'URL pattern utilise `{{ product.url }}`
   résolu sur le domaine custom (dépend du Store URL ci-dessus).

**Mesure d'impact (à lancer avant/après fix).**
```sql
-- HogQL sur klaviyo_events
SELECT
  countIf(JSONExtractString(event_properties,'URL') ILIKE '%myshopify.com%') AS broken,
  countIf(JSONExtractString(event_properties,'URL') ILIKE '%fancypalas.com%') AS canonical
FROM klaviyo_events
WHERE JSONExtractString(relationships,'metric','data','id') = 'U3fRug'  -- Clicked Email
  AND datetime > now() - INTERVAL 30 DAY
```

---

## P1 — Auditer les profils `method: SHOPIFY Customer Webhook`

**Constat.** Sur les 18 emails audités, 2 ont `method: SHOPIFY Customer Webhook` dans
Klaviyo (`aureli112@hotmail.com`, `brigitte170960@outlook.fr`). Ces profils sont créés
automatiquement par la sync Shopify, **sans que l'utilisateur n'ait rempli un form Klaviyo**.

Côté base globale : `$consent_method` est vide sur **10 311 / 16 536 profils (62%)** dans
le DataWarehouse PostHog. Le champ n'est pas 100% fiable (Klaviyo API est source de vérité)
mais l'ordre de grandeur suggère que les profils webhook-only sont majoritaires.

**Action.**
1. Lister tous les profils Klaviyo avec `method: SHOPIFY` via l'API Klaviyo directe
   (`GET /api/profiles/?additional-fields[profile]=subscriptions` avec filter sur
   `subscriptions.email.marketing.method`).
2. Pour chaque profil sans jamais de `$kla_id` cookie côté PostHog (= jamais identifié
   sur le site) ET `consent: SHOPIFY` → décider :
   - Suppress (= retirer des listes marketing)
   - Ou renvoyer un double-opt-in pour reconfirmer

**Script à écrire.** `scripts/audit-klaviyo-consent.ts` — exporte CSV
`email, consent_method, opt_in_level, posthog_kla_id_seen, last_activity, decision`.

---

## P2 — Consent gate à l'ingestion

**Constat.** Aujourd'hui rien dans notre stack ne filtre "est-ce que ce profil a vraiment
consenti sur notre site" avant de le considérer mailable.

**Action.** Quand on reçoit un webhook Shopify `customers/create` (cf.
[shopify-integration.md](./shopify-integration.md)), marquer le customer avec un flag
`consent_source: webhook | klaviyo_form | checkout` en fonction de :
- `email_marketing_consent.opt_in_level` (Shopify) : UNKNOWN → flag douteux
- Tag `Login with Shop` présent → flag cross-store
- Match avec un `kla_id` côté PostHog → flag propre

Exposer dans l'admin un segment "Consents douteux" pour review manuel.

---

## P3 — Tracker "Active on Site" dans notre stack aussi

**Constat.** Klaviyo a un metric "Active on Site" qui reconnaît un user loggué quand sa
session `_learnq` matche un profil. On n'a pas l'équivalent.

**Action.** Dans le PostHog proxy, quand un `$pageview` arrive avec un `$kla_id` cookie
résolvable en email, émettre un event interne `site:active` qu'on peut utiliser dans
nos flows (ex: trigger d'abandon après X minutes sans `cart:updated`). Utile comme
base pour nos propres flows RGPD-compliant.
