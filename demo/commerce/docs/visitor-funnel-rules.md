# Visitor Funnel — Règles & Attribution

Spec de la table `visitor_sessions` qui alimente `/admin/visitor-stats`. Une ligne par `(distinct_id, $session_id)` PostHog. Snapshot live alimenté par le proxy + filet cron + backfill historique 90j. Source unique pour les KPI funnel commerce (segments × paid/organic × had_paid_7d).

Code source : `src/modules/visitor-session/` (helpers purs + entity), `src/commands/admin/{upsert,attribute,mark}-*.ts` (orchestration), `src/queries/admin/visitor-stats-*.ts` (lecture).

> **Principe directeur** : on stocke les **faits** (timestamps, attribution gelée à T=0, compteurs idempotents). Les dérivations (was-active-at-N-minutes-ago, had_paid_7d, etc.) se calculent **à la lecture** sur `last_event_at`. Aucune notion de `closed_at` matérialisée.

---

## 1. Ce qu'est une session

Une session = `(distinct_id, $session_id)` PostHog. PostHog forge un nouveau `$session_id` après 30 minutes d'inactivité du `distinct_id`, ou après changement de tab/onglet selon la config. On reprend cette définition telle quelle.

**Pas de `closed_at` matérialisé.** Si une query a besoin de "sessions terminées", elle utilise le proxy de lecture :
```sql
WHERE last_event_at < NOW() - INTERVAL '30 minutes'
```
Le cron rattrapage écrit dans la même session pendant ~30min, donc l'inégalité est stable.

**Index** : `(distinct_id, session_id) UNIQUE`, `(started_at)`, `(distinct_id, started_at, is_paid_session)` (pour `had_paid_7d`), `(cart_converted) WHERE cart_converted = true` (partiel — small set).

---

## 2. Classification de segment (D1, D3)

`segment_at_session_start` est **gelé** sur le premier event de la session. Trois valeurs :

| Segment | Règle |
|---|---|
| `unknown` | Aucun `contact` dans notre DB pour ce `distinct_id` au moment du premier event |
| `known_no_purchase` | Contact existe MAIS `first_order_at IS NULL` OU `first_order_at >= started_at` |
| `returning_customer` | Contact existe ET `first_order_at < started_at` |

**Edge case — contact créé pendant la session** (newsletter signup, checkout). Le segment **ne change pas** — il reste celui de T=0. La transition d'identité est capturée séparément via `email_acquired_in_session = true` + `email_acquired_via`. Conséquence : un visiteur peut être `unknown` pendant toute la session et finir par convertir ; le segment stocké reflète "ce qu'on savait quand il est arrivé", pas "ce qu'on a appris après".

Code : `src/commands/admin/upsert-visitor-session-from-event.ts` (résolution Contact → segment) + `src/modules/visitor-session/upsert-session.ts` (planSessionUpsert verrouille `segment_at_session_start` sur `existing === undefined`).

---

## 3. Règle paid_session (D2)

`is_paid_session = true` ssi **au moins une** des conditions suivantes au premier event :

- `utm_medium IN ('cpc', 'paid', 'ppc')`
- `utm_source IN ('google_ads', 'meta_ads', 'tiktok_ads', 'facebook_ads', 'bing_ads', 'klaviyo')`
- Le `$current_url` contient `?gclid=…`, `?fbclid=…` ou `?ttclid=…` (et leurs variantes `&...`)

Comparaisons utm_* : **insensibles à la casse** (PostHog normalise en lowercase mais on tolère). Match `gclid|fbclid|ttclid` : substring entre `[?&]` et `=` (pas un simple `includes`, pour éviter les faux positifs type `gclidfoo`).

**Source unique** : `src/modules/visitor-session/attribution.ts` (`isPaidSession`). Toute modification de la whitelist DOIT mettre à jour cette doc EN MÊME TEMPS.

Comme `segment`, `is_paid_session` est **gelé** sur le premier event. Si un user arrive en organique puis revient via une pub dans la même session PostHog (improbable mais possible), il reste `is_paid_session = false`.

---

## 4. Attribution de conversion panier (D3 — cohort)

Quand un panier passe en `highest_stage = 'completed'`, on cherche la session active au moment de la naissance du panier (`cart_birth_at`) :

```
SELECT * FROM visitor_sessions
 WHERE distinct_id = $cart.distinct_id
   AND started_at <= cart_birth_at
   AND last_event_at >= cart_birth_at - INTERVAL '30 minutes'
 ORDER BY started_at DESC
 LIMIT 1
```

Le **plus récent `started_at` gagne** quand plusieurs sessions chevauchent. On UPDATE `cart_converted = true, order_id = X`.

**Conséquence importante** — les lignes session ne sont **pas append-only**. `cart_converted` peut passer à `true` après que tous les events de la session ont été ingérés. Idempotence : si `cart_converted` est déjà `true`, l'update est skippé (côté commande + côté backfill via la clause `WHERE vs.cart_converted = false`).

**Cohort vs same-day** : un panier né jour D et converti jour D+5 compte sur la session de jour D (sa cohort de naissance). C'est le bon comportement pour le funnel "j'ai créé un panier, combien finissent par acheter ?".

Code : `src/commands/admin/attribute-session-conversion.ts` + helper pur `src/utils/attribute-session-conversion-helper.ts`. Wiring dans `ingest-cart-event.ts` sur `checkout:completed` (transition). Pass cohort backfill : end-of-run UPDATE dans `scripts/backfill-visitor-sessions.ts`.

---

## 5. Acquisition d'identité (D4)

`email_acquired_in_session = true` quand on capte l'email du visiteur **pendant** la session (= session démarrée anonyme, `email_at_session_start IS NULL`). Deux chemins :

### 5.1 `email_acquired_via = 'newsletter'`

Le proxy `packages/plugin-posthog-proxy` capture les requêtes `/identify` (Klaviyo cookie decrypt + bridge serveur). Après avoir appelé `identifyInPostHog(distinctId, email)`, le proxy émet :
```
posthog.klaviyo-identity-resolved → { distinct_id, email }
```

Le subscriber `klaviyo-identity-to-session` écoute cet event et appelle `markSessionEmailAcquired({ distinct_id, email, via: 'newsletter' })`. La commande cherche la session ouverte (`last_event_at >= NOW() - 30min`) la plus récente pour ce `distinct_id` et la marque.

Si aucune session ouverte n'existe (= contact Klaviyo enregistré sans concurrent PostHog session — typique import CSV), `matched: 0` est retourné, no-op.

### 5.2 `email_acquired_via = 'checkout_started'`

Détection inline dans `planSessionUpsert` : si l'event est `checkout:started` ET porte un email ET la session était anonyme (`existing.email_at_session_start IS NULL`), on stamp `email_acquired_in_session=true, email_acquired_via='checkout_started'`.

Aucun subscriber séparé. Le même chemin de upsert qui maintient les compteurs `carts_created_in_session` fait la transition d'identité.

Code : `src/modules/visitor-session/upsert-session.ts` (transition checkout_started inline) + `src/subscribers/klaviyo-identity-to-session.ts` (transition newsletter via event proxy).

---

## 6. Chemins d'écriture : live + cron + backfill

Trois sources écrivent dans `visitor_sessions`, toutes idempotentes via `seen_event_uuids[]` (FIFO cap 200 par session).

### 6.1 Live (subscriber)

`src/subscribers/posthog-cart-tracker.ts` écoute `posthog.events.received` (émis par `/posthog-proxy/*`). Pour chaque event du batch avec `$session_id` ET `distinct_id`, dispatch `upsertVisitorSessionFromEvent`. Bot emails (storebotmail, joonix, mailinator, guerrillamail) sont skippés AVANT le dispatch session — le contrat est : si on ne crée pas le cart, on ne crée pas la session non plus.

Couvre 100% du trafic qui passe par le proxy.

### 6.2 Cron rattrapage (5 min)

`src/commands/admin/sync-posthog-events.ts` (job `sync-posthog-events` toutes les 5min). Pull HogQL des events `cart:%` + `checkout:%` depuis la high-water mark, dispatch `ingestCartEvent` ET (pour les events avec `$session_id` + `distinct_id`) `upsertVisitorSessionFromEvent` en parallèle.

Cible **les events qui contournent notre proxy** : principalement le Shopify Web Pixel qui pousse `checkout:%` directement vers PostHog (CHECKOUT-FIX-04). Toutes les requêtes de mesure d'Apple Pay aussi.

### 6.3 Backfill (one-shot)

`scripts/backfill-visitor-sessions.ts --prod --apply`. Replay paginé 90 jours de PostHog vers la table. Mêmes événements (`cart:%`, `checkout:%`, `$identify`, `$pageview`), même planner pur, même UPSERT idempotent. Pass cohort final pour `cart_converted` rétroactif. Durée attendue : 5-15min.

### 6.4 Idempotence — comment ça tient

- Premier event d'une session → INSERT (la session est créée avec attribution gelée).
- Events suivants → UPDATE via `ON CONFLICT (distinct_id, session_id) DO UPDATE SET …`. Les champs gelés (started_at, segment, attribution, email_at_session_start) ne sont JAMAIS dans le SET.
- `seen_event_uuids[]` skip les compteurs si on a déjà vu cet `event_uuid`.
- `cart_converted` est gardé par `WHERE vs.cart_converted = false` côté backfill et idempotent côté commande.

Re-jouer 100x la même séquence d'events produit le même état final.

---

## 7. Limitations V1 connues

| ID | Limitation | Suivi |
|---|---|---|
| VS-FU-01 | Le cron rattrapage ne pull QUE `cart:%` + `checkout:%`. Les `$pageview` qui contournent le proxy ne remontent pas dans le cron — leurs compteurs `pageviews_count` restent à ce que le live a capté. Pas bloquant pour le funnel commerce mais pertinent pour les sessions purement "browsing". | BACKLOG (VS-FU-01) |
| VS-FU-06 | Achats anonymes (event sans `distinct_id` — typiquement Apple Pay sur Shopify) ne sont pas attribués à une session. Le panier existe en DB, la conversion existe, mais aucune `visitor_session.cart_converted = true` ne s'allume. | BACKLOG (VS-FU-06) |
| VS-FU-XX | Cross-device contact merging : si un user merge deux distinct_ids via PostHog `$identify`, les anciennes lignes session restent attachées à leurs distinct_ids d'origine — pas de propagation rétroactive. | Note d'archi (à arbitrer si volumétrie justifie) |

---

## Références code

- Helpers purs : `src/modules/visitor-session/{attribution,upsert-session}.ts`
- Entity : `src/modules/visitor-session/entities/visitor-session/{model,service}.ts`
- Commands : `src/commands/admin/{upsert-visitor-session-from-event,attribute-session-conversion,mark-session-email-acquired}.ts`
- Helpers commande (testés purement) : `src/utils/{attribute-session-conversion,mark-session-email-acquired}-helper.ts`
- Subscribers : `src/subscribers/{posthog-cart-tracker,klaviyo-identity-to-session}.ts`
- Queries (lecture) : `src/queries/admin/visitor-{session-daily-stats,stats-*}.ts`
- Aggregator helper : `src/utils/visitor-stats-aggregator.ts` (testable sans framework)
- Backfill : `scripts/backfill-visitor-sessions.ts`
- Bootstrap migration : `scripts/bootstrap-visitor-sessions.ts`

Spec complète et décisions actées : `.claude/plans/visitor-session-snapshot.md`.
