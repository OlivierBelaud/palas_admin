# Backlog — commerce demo (fancypalas)

Pistes et optimisations spécifiques au pilote commerce, identifiées pendant l'audit
RGPD 18 emails du 2026-04-22. Séparé du `BACKLOG.md` racine qui ne contient que les
tâches framework Manta.

| Document | Sujet | Priorité max |
|---|---|---|
| [klaviyo-optimizations.md](./klaviyo-optimizations.md) | URLs `.myshopify.com` dans les templates, source `SHOPIFY Customer Webhook`, consent gate | **P1** |
| [posthog-tracking-gaps.md](./posthog-tracking-gaps.md) | Multi-domaine, cookie scope, Shop Pay / Shop app invisibles, cart attributes orphelins | **P1** |
| [shopify-integration.md](./shopify-integration.md) | Webhooks natifs, Custom Pixel, Login with Shop cross-store leak | **P1** |
| [rgpd-consent-audit.md](./rgpd-consent-audit.md) | Audit global base : 46% `opt_in UNKNOWN`, 281 Shop Pay network, plan de remédiation | **P0** |

## Données source

- [`../rgpd-audit-18-emails.md`](../rgpd-audit-18-emails.md) — rapport détaillé par email, source de vérité des 18 cas investigués
- Requêtes SQL / HogQL utilisées : stockées dans `/tmp/*.py` (non-versionnées, à reproduire si besoin depuis les docs)

## Convention

- Chaque doc liste : **constat → preuve → action**, avec paths/commandes quand pertinent.
- Ne duplique pas les données du rapport `rgpd-audit-18-emails.md` — référence-le.
- Items prioritaires en tête de chaque doc.
