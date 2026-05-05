# Shopify — intégration à mettre en place

## P1 — Webhooks natifs `customers/*` et `checkouts/*`

**Pourquoi.** Shopify Flow "Send HTTP request" est verrouillé derrière un upgrade de
plan. Les webhooks Admin API sont **gratuits sur tous les plans** et donnent une payload
plus riche que Flow.

**Topics à activer.**
- `customers/create` — tout nouveau customer, avec `email_marketing_consent` complet
  (`state`, `opt_in_level`, `consent_updated_at`) + `tags` (dont "Login with Shop")
- `customers/update` — modif opt-in / tags
- `checkouts/create` / `checkouts/update` — email saisi au checkout
- `orders/create` — commande validée (on l'a déjà ? à vérifier)

**Où configurer.** Settings → Notifications → Webhooks (tout en bas).

**Endpoint à créer côté Manta.** `POST /api/admin/_ingest/shopify-webhook` dans
`demo/commerce/src/commands/admin/` avec :
- Vérification HMAC signature (header `X-Shopify-Hmac-Sha256`)
- Dispatch sur `X-Shopify-Topic`
- Écriture dans une table `shopify_webhook_events` (nouvelle model)
- Side-effect : enrichissement customer / flag RGPD / $identify PostHog

**Template de structure du receiver.**
```
src/modules/shopify-webhooks/
  index.ts              — defineModule
  entities/
    event/
      model.ts          — shopify_webhook_event (topic, payload, processed_at)
      service.ts
  subscribers/
    process-customer-create.ts
    process-checkout-update.ts
```

---

## P1 — Shopify Custom Pixel (browser-side bridge)

**Pourquoi.** Le Custom Pixel tourne dans le **sandbox Shopify** (même contexte que le
Web Pixel Manager natif). Il voit des événements que notre thème ne voit pas :
- `checkout_started` / `checkout_contact_info_submitted` — même quand l'utilisateur
  passe par Shop Pay one-tap (= nos scripts dans `<head>` ne chargent pas)
- `product_viewed`, `collection_viewed` — depuis n'importe quel canal Shopify (app, web)

**Données exploitables.**
- `event.clientId` = identifiant Shopify browser-side stable (= `_shopify_y` cookie)
- `event.data.checkout.email` au moment du `checkout_contact_info_submitted`
- `event.context.document.location` / referrer

**Action.** Settings → Customer events → **Add custom pixel**. Coller un script qui :
1. Écoute `checkout_contact_info_submitted`
2. Lit l'email
3. POST vers notre endpoint `POST /api/admin/_ingest/shopify-pixel` avec
   `{ shopify_clientId, email, posthog_distinct_id?: <if accessible>, event_timestamp }`
4. Côté Manta, persiste la correspondance `(shopify_clientId ↔ posthog_distinct_id ↔ email)`
   dans une table `identity_bridge`

**Résultat.** On peut **définitivement** cross-référencer les sessions Shopify et
PostHog, même quand le thème ne charge pas.

---

## P1 — Audit "Login with Shop" — cross-store leak

**Constat.** 281 customers Shopify ont le tag `Login with Shop` + `marketingState=SUBSCRIBED`
(dont 159 avec `opt_in_level=UNKNOWN`). Ces profils sont poussés par Shopify depuis son
réseau cross-store. Pour l'utilisateur c'est du leak : il n'a jamais opt-in chez nous.

**Cas concret audité.** `brigitte170960@outlook.fr` — tag `["Login with Shop","Shop"]`,
156 emails Klaviyo reçus depuis Sept 2025 sans action sur notre site avant Apr 2026.

**Action.**
1. Requête d'export de la liste :
   ```sql
   SELECT lower(JSONExtractString(default_email_address,'emailAddress')) AS email,
          id, created_at, tags,
          JSONExtractString(default_email_address,'marketingOptInLevel') AS opt_in
   FROM shopify_customers
   WHERE position(toString(tags), 'Login with Shop') > 0
     AND JSONExtractString(default_email_address,'marketingState') = 'SUBSCRIBED'
     AND JSONExtractString(default_email_address,'marketingOptInLevel') = 'UNKNOWN'
   ```
2. Décision : soit suppress automatique dans Klaviyo, soit re-opt-in par email.
3. Désactiver la sync "auto-subscribe Login with Shop customers" si possible (Shopify
   Settings → Customer accounts → configuration Shop Pay).

---

## P2 — Documenter les sources d'order (`source_name` / `source_identifier`)

**Constat.** Les 2 orders audités (`aureli112`, `lereboursj`) ont `source_name: web` mais
pas de `source_identifier`. Ça ne suffit pas à distinguer :
- Checkout depuis notre thème fancypalas.com
- Checkout depuis Shop Pay 1-tap (lien email)
- Checkout depuis l'app Shop (discovery feed)

**Action.** Regarder si d'autres champs discriminent (app_id, checkout_source, referring_site)
en interrogeant des orders de différents canaux connus. Écrire une query HogQL qui
catégorise les orders par canal réel.

---

## P3 — Flow "Customer left without purchase" — on en fait quoi ?

**Constat.** Le trigger Shopify Flow fire sur des browses qu'on ne voit pas de notre côté
(cf. Aurélie 22/04 14:00). Tant que notre Custom Pixel n'est pas en place, on ne peut
pas savoir qui Shopify voit.

**Action.** Une fois le Custom Pixel en place, corréler : pour chaque Flow run, a-t-on
vu la session côté PostHog ? Si jamais → c'est soit du Shop app soit du leak.
