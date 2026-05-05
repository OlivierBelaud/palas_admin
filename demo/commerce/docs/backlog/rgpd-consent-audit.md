# Audit RGPD — plan de remédiation

Cross-ref : données brutes dans [`../rgpd-audit-18-emails.md`](../rgpd-audit-18-emails.md).

## État des lieux (au 2026-04-22)

### Base Shopify — 19 146 customers

| marketingState | opt_in_level | # | % |
|---|---|---:|---:|
| SUBSCRIBED | **UNKNOWN** | **8 958** | **47%** |
| SUBSCRIBED | SINGLE_OPT_IN | 2 793 | 15% |
| UNSUBSCRIBED | UNKNOWN | 3 554 | 19% |
| NOT_SUBSCRIBED | SINGLE_OPT_IN | 3 212 | 17% |
| SUBSCRIBED via Login with Shop | UNKNOWN | 159 | 0.8% |
| SUBSCRIBED via Login with Shop | SINGLE_OPT_IN | 122 | 0.6% |
| Autres | | 348 | 1.8% |

→ **47% de la base est marquée SUBSCRIBED avec `opt_in_level=UNKNOWN`** — opt-in dont
on ne peut pas prouver l'origine. C'est le noyau du risque.

### Base Klaviyo — 16 422 profils

- 99.4% sont aussi dans Shopify (intersection = 16 332)
- 90 profils Klaviyo-only (leads pop-up sans commande, consent clair)
- 2 714 Shopify-only (majoritairement UNSUBSCRIBED, normal de ne pas être dans Klaviyo)

## Les 3 vecteurs de consentement douteux identifiés

### 1. `consent_method: SHOPIFY Customer Webhook` (API Klaviyo)

Création automatique du profil Klaviyo à partir d'un customer Shopify, sans form rempli.
Constaté sur 2/12 des emails audités (`aureli112`, `brigitte170960`).

**Caractéristique.** `opt_in_level` est `SINGLE_OPT_IN` ou `UNKNOWN`, **jamais**
`CONFIRMED_OPT_IN`. Pas de `consent_form_id` associé.

### 2. Tag Shopify `Login with Shop` (Shop Pay cross-store)

281 customers sur toute la base. Shopify les reconnaît depuis son réseau cross-boutique
(compte Shop ouvert chez un autre marchand) et les déclare `SUBSCRIBED` chez nous sans
qu'aucune action n'ait été faite sur fancypalas.com.

### 3. Checkout Shopify avec case opt-in potentiellement pré-cochée

Les 8 958 "SUBSCRIBED/UNKNOWN sans tag Shop" sont probablement des clients qui ont
validé un checkout Shopify pendant une période où la case "Je souhaite recevoir les
emails marketing" était pré-cochée par défaut. **À vérifier manuellement** dans les
settings checkout actuels.

## Plan de remédiation — ordre de priorité

### P0 (à faire cette semaine)

1. **Vérifier la case opt-in au checkout Shopify** — Settings → Checkout → Customer
   consent. Si pré-cochée : décocher immédiatement. Enregistrer screenshots avant/après.
2. **Exporter la liste des 159 "Login with Shop + opt_in UNKNOWN"** + décision
   (suppress vs re-opt-in).

### P1 (ce mois)

3. **Webhooks Shopify** `customers/create` pour logger chaque nouveau customer avec
   son metadata consent → cf. [shopify-integration.md](./shopify-integration.md).
4. **Re-opt-in campaign** pour les 8 958 "SUBSCRIBED/UNKNOWN" : envoyer UN dernier
   email avec CTA "Confirmez que vous souhaitez continuer à recevoir nos emails". Après
   X jours sans action → move to suppressed.
5. **Consent gate dans Klaviyo** : désactiver la sync automatique Shopify → Klaviyo
   pour les customers sans `opt_in_level` clair (Klaviyo → Integrations → Shopify →
   "Sync settings").

### P2 (suivant)

6. **Shopify Custom Pixel** pour bridger browser Shopify ↔ PostHog — cf.
   [shopify-integration.md](./shopify-integration.md).
7. **Flag "Consent source" sur chaque profil** côté notre stack — exposé dans l'admin
   pour filtrer les segments marketing.
8. **Audit Klaviyo direct** via API (`GET /api/profiles/`) sur toute la base pour
   lister les `method: SHOPIFY` — cf. [klaviyo-optimizations.md](./klaviyo-optimizations.md).

## Risques à documenter pour toi (CEO/founder)

- **CNIL plainte individuelle** : si un des 8 958 UNKNOWN porte plainte, on n'aura pas
  de preuve de consentement → amende potentielle + obligation de purger.
- **Baisse de délivrabilité** : une base avec beaucoup d'inactifs / non-désirés dégrade
  la réputation du sender. Klaviyo a des règles de smart sending mais un re-opt-in
  peut faire chuter de 50-70% la liste active — ça peut faire mal court-terme mais
  c'est sain long-terme.
- **Transparence** : considérer une page publique "Notre engagement données" qui
  documente ce qu'on fait (accessible depuis footer). Plus facile à défendre en cas
  de contrôle.

## Preuves à conserver pour compliance

- Screenshot Shopify Settings → Checkout avec la case opt-in configurée correctement
- Liste des 159 "Login with Shop" + action prise par email (CSV archivé)
- Log des webhooks `customers/create` (database retention ≥ 3 ans recommandée)
- Exemples de form Klaviyo (YuFpT5, R7f72x) archivés avec mention RGPD visible
