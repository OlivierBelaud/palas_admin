# Cart Abandonment — Rules & Attribution

Règles définissant le cycle de vie d'un panier, les fenêtres d'abandon, et l'attribution de la récupération à un email. Une seule source de vérité pour la query `abandoned-carts`, le job `detect-abandoned-carts`, les stats, et tout calcul de KPI de recovery.

> **Principe directeur** : la DB stocke des **faits bruts** (`last_action_at`, `highest_stage`, l'historique d'emails envoyés). Toutes les interprétations (dormant, dead, recovered…) sont **dérivées à la lecture**. Un tick de cron raté ne peut donc pas faire mentir la vue — la seule chose qui peut être en retard c'est l'envoi de l'email, récupéré au tick suivant.

Le code de dérivation vit dans `src/modules/cart-tracking/abandonment.ts` et est consommé par les queries + les jobs.

---

## 1. États du panier (axe activité)

Un cart est dans **un seul état** à un instant T, dérivé de `last_action_at` + `highest_stage`.

| État | Règle | Délai depuis `last_action_at` |
|---|---|---|
| `browsing` | Dernière action récente, l'user est probablement encore en session | < 2h |
| `dormant` | Panier abandonné, fenêtre de récupération ouverte | 2h – 7j |
| `dead` | Panier perdu, recovery flow épuisé, probabilité de conversion ~0 | > 7j |
| `completed` | Paiement confirmé (`highest_stage = 'completed'`) | — |

**Colonne DB `status`** : seulement deux valeurs légales — `active` ou `completed`. C'est la seule distinction qu'on persiste parce qu'elle est déclenchée par un event observable (`checkout:completed`). Les anciennes valeurs `cart_abandoned` / `checkout_abandoned` / `payment_abandoned` ne sont plus écrites — les lignes existantes peuvent encore les contenir mais aucune query ne les consulte.

**Sous-stade (pour `dormant` / `dead`)** — projection sur `highest_stage`, affichée dans les KPI :

| Sous-stade | `highest_stage` |
|---|---|
| `cart_abandoned` | `cart` |
| `checkout_abandoned` | `checkout_started` OU `checkout_engaged` |
| `payment_abandoned` | `payment_attempted` |

**Pourquoi 2h** : fenêtre standard Shopify. Sous 2h, l'utilisateur est probablement encore actif (déjeuner, pause). Au-delà, on considère que la session est terminée.

**Pourquoi 7j** : notre flow d'emails de relance s'étale sur 3 jours (2h → J+1 → J+3). Au-delà de J+7, aucun email ne sera plus envoyé et statistiquement la probabilité de conversion tombe sous 5% (industrie : Klaviyo, Rejoiner, Yotpo). Un cart `dead` n'est plus actionnable — il pollue le dashboard s'il est traité comme recoverable.

**Transition `dead`** : calculée on-the-fly. Si la personne revient et déclenche un nouvel event, `last_action_at` est mis à jour → le cart redevient `dormant` puis `browsing` automatiquement.

---

## 2. Cadence d'envoi des emails de relance

Déclenché par le job `detect-abandoned-carts` (hourly) + les flows Klaviyo. Valeurs actuelles :

| # | Délai depuis `last_action_at` | Canal | Contenu |
|---|---|---|---|
| 1 | 2h | Klaviyo email | "Vous avez oublié quelque chose" |
| 2 | J+1 (24h) | Klaviyo email | "On pense encore à votre panier" |
| 3 | J+3 (72h) | Klaviyo email | "On vous attend plus que vous" |

Au-delà de J+3, **aucun email supplémentaire**. Le cart bascule en `dead` à J+7.

> ⚠️ Si on change cette cadence, il faut mettre à jour **la fenêtre d'attribution** (§4) et **le seuil `dead`** (§1) en cohérence.

---

## 3. Attribution d'un email à un cart (fenêtre 2j)

L'email envoyé à l'adresse `X` peut concerner **plusieurs carts différents** (client récurrent). Il faut attribuer chaque email au cart auquel il se rapporte réellement.

### Règle — fenêtre d'attribution de 2 jours

Un email d'abandon est attribué à un cart si **toutes** les conditions sont vraies :

1. `email.datetime >= cart.first_action_at` (email envoyé après la création du cart)
2. `email.datetime <= cart.last_action_at + 2j` (email envoyé dans la fenêtre d'influence de 2 jours post-dernière-action)
3. Pour les carts `completed` : `completed_at - email.datetime <= 2j` (le paiement doit survenir dans les 2 jours suivant la réception de l'email)

**Pourquoi 2 jours** : délai raisonnable entre "la personne voit l'email" (parfois le lendemain) et "la personne repasse commande". Au-delà, l'attribution devient spéculative — l'achat a probablement une autre cause (reminder personnel, passage à l'action naturel).

### Priorité A — match exact par `checkout_token`

Klaviyo `Shopify_Checkout_Abandonned` n'envoie pas `cart_token` en clair, **mais** l'event contient un `checkout_url` de la forme :

```
https://fancypalas.com/<shop_id>/checkouts/ac/<checkout_token>/recover?key=<hmac>
```

Extraction HogQL : `extract(event_properties->>'checkout_url', 'checkouts/ac/([^/?"]+)')`. Notre modèle `cart` stocke `checkout_token` (nullable, peuplé dès `checkout:started`).

Quand un event Klaviyo porte un `checkout_token` qui matche **exactement** celui du cart courant, l'email est attribué — peu importe la distance temporelle. Zéro faux positif, fonctionne pour clients récurrents.

**Limite** : ne fonctionne que pour les carts ayant atteint le checkout (`highest_stage >= checkout_started`). Un cart abandonné au stade `cart` pur n'a pas de `checkout_token` et ne peut pas être matché par token → fallback sur la fenêtre 2j.

### Priorité B — fenêtre temporelle de 2 jours (fallback)

Si pas de match par token, on cherche le dernier email qui passe les 3 règles :

1. `email.datetime >= cart.created_at` (email envoyé après la création du cart)
2. `email.datetime <= cart.last_action_at + 2j` (email envoyé dans la fenêtre d'influence de 2 jours post-dernière-action)
3. Pour les carts `completed` : `completed_at - email.datetime <= 2j` (le paiement doit survenir dans les 2 jours suivant la réception de l'email)

**Pourquoi 2 jours** : délai raisonnable entre "la personne voit l'email" (parfois le lendemain) et "la personne repasse commande". Au-delà, l'attribution devient spéculative — l'achat a probablement une autre cause (reminder personnel, passage à l'action naturel).

---

## 4. Catégories de recovery (dérivées)

Appliquées **uniquement aux carts qui ont reçu ≥1 email d'abandon attribué** (§3). Carts sans email = hors funnel.

| Catégorie | Règle | Signification business |
|---|---|---|
| `recovered` | Cart `completed` ET un email attribué a été envoyé ≤ 2j avant `completed_at` | **L'email a converti.** À mesurer, à optimiser. |
| `pending_recovery` | Cart `dormant` ET dernier email attribué < 3j | Recovery flow actif, cible chaude. Ne rien faire (laisser le flow finir). |
| `assisted_dead` | Cart `dead` ET recovery flow complet envoyé (3 emails) | **Email a échoué.** Feedback loop pour ajuster le contenu / la cadence. |
| `not_picked_up` | Cart `dormant` OU `dead` SANS aucun email attribué | **Gap dans le flow**. Candidat pour action manuelle OU debug de la chaîne Klaviyo. |
| `normal_conversion` | Cart `completed` SANS email attribué dans la fenêtre 2j | Conversion organique, hors funnel d'abandon. **Exclu** de la vue "abandonned-carts". |

---

## 5. Exemple — le cas Schirrer (22 avril 2026)

Pour valider les règles, trace sur le cas qui a motivé ce doc :

| Event | Date |
|---|---|
| Cart créé / `last_action_at` | ~19 avril 2026 (jour de la complétion, donc cart court) |
| Email Klaviyo d'abandon trouvé | 5 décembre 2025 |
| Cart `completed` | 19 avril 2026 à 10:17 |

**Avant (logique actuelle buggée)** :
- "Un email a été envoyé avant la complétion" → `recovered` ❌

**Après (règle §3)** :
- Priorité A (token exact) : aucun match (l'email de décembre porte un autre `checkout_token` que le cart d'avril)
- Priorité B (fenêtre 2j) : `completed_at - email.datetime` = 135 jours ≫ 2j → rejeté
- Email non attribué au cart
- Catégorie : `normal_conversion` ✅ (exclu de la vue "abandoned-carts")

L'email de décembre était pour un autre cart (probablement `dead` aujourd'hui) de la même personne — cart distinct, ne doit pas polluer l'analyse du cart d'avril.

---

## 6. Architecture — qui écrit, qui lit

```
┌─────────────────┐        ┌──────────────────┐
│ ingestCartEvent │───────▶│      carts       │
│  (subscriber)   │        │ ─────────────    │
└─────────────────┘        │ status:          │
                           │   'active' ∨     │
                           │   'completed'    │
                           │ last_action_at   │
                           │ highest_stage    │
                           │ abandon_*_at/cnt │◀─┐
                           └────────┬─────────┘  │
                                    │            │
                    ┌───────────────┤            │
                    ▼               ▼            │
         ┌──────────────────┐  ┌───────────────┐ │
         │  cart-stats      │  │ abandoned-    │ │ (write only
         │  abandoned-carts │  │ carts queries │ │  notification
         │  (dérivent tout) │  └───────────────┘ │  history for
         └──────────────────┘                    │  idempotence)
                                                 │
                           ┌─────────────────┐   │
                           │ notifyAbandoned │───┘
                           │ Carts (hourly)  │
                           └─────────────────┘
```

- **Écritures DB** : 2 chemins seulement.
  - `ingestCartEvent` met à jour l'état factuel (items, tokens, `last_action_at`, `highest_stage`, `status`).
  - `notifyAbandonedCarts` met à jour uniquement `abandon_notified_at` + `abandon_notified_count` (idempotence).
- **Lectures** : toutes les vues/stats passent par `abandonment.ts` pour dériver les catégories. Aucune lecture ne discrimine sur `status` (qui est devenu quasi-binaire).

---

## 7. Références

- `src/modules/cart-tracking/abandonment.ts` — **helper central** (constantes + `computeActivityState` / `computeSubStage` / `isEmailAttributed` / `computeCategory`)
- `src/modules/cart-tracking/entities/cart/model.ts` — schéma cart (status = `active`|`completed`)
- `src/modules/cart-tracking/apply-event.ts` — mise à jour du cart depuis les events PostHog (écrit `status`)
- `src/queries/admin/abandoned-carts.ts` — query admin (consomme `computeCategory`, enrichit via Klaviyo + Shopify DW)
- `src/queries/admin/cart-stats.ts` — KPIs (consomme `computeActivityState` + `computeSubStage`)
- `src/commands/admin/notify-abandoned-carts.ts` — envoi Klaviyo + marque `abandon_notified_*`
- `src/jobs/detect-abandoned-carts.ts` — cron hourly (prod-only) qui appelle le command ci-dessus
- Klaviyo Shopify integration — metric `Shopify_Checkout_Abandonned`, port `checkout_token` via `checkout_url`
