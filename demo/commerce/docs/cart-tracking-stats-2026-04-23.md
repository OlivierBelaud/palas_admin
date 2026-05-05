# Cart tracking — stats 2026-04-23

*Source: table `carts` en base Neon prod (2026-04-08 → 2026-04-23). Les 5 paniers de test Olivier ont été purgés (DB + posthog_event_log + email_captures) avant calcul.*

**Note méthodo** : un panier est "identifié" quand on connaît son email (soit via checkout soumis, soit via notre capture email). Le `distinct_id` seul n'est pas une identification (c'est un cookie PostHog anonyme).

## En un coup d'œil

- **237** paniers trackés sur la période, valeur cumulée **23408.90 €**.
- **87** identifiés (36.7 %, 8641.67 €), **150** anonymes (63.3 %, 14767.23 €).
- **78** ont atteint le checkout (32.9 %), dont **44** payés (18.6 %).
- **159** restés au stade cart (67.1 %).

## Jour par jour (last_action_at)

| Jour | Paniers | Montant | Identifiés | % id. | Checkout | % ckt. | Payés |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-04-23 | 19 | 1445.05 € | 3 | 15.8 % | 4 | 21.1 % | 1 |
| 2026-04-22 | 20 | 1976.95 € | 9 | 45.0 % | 7 | 35.0 % | 4 |
| 2026-04-21 | 20 | 2543.85 € | 9 | 45.0 % | 8 | 40.0 % | 5 |
| 2026-04-20 | 24 | 2969.07 € | 11 | 45.8 % | 9 | 37.5 % | 6 |
| 2026-04-19 | 21 | 1818.70 € | 7 | 33.3 % | 7 | 33.3 % | 4 |
| 2026-04-18 | 30 | 2973.91 € | 12 | 40.0 % | 12 | 40.0 % | 5 |
| 2026-04-17 | 32 | 3678.75 € | 13 | 40.6 % | 8 | 25.0 % | 6 |
| 2026-04-16 | 14 | 946.10 € | 5 | 35.7 % | 6 | 42.9 % | 4 |
| 2026-04-10 | 22 | 1966.75 € | 8 | 36.4 % | 10 | 45.5 % | 4 |
| 2026-04-09 | 17 | 1576.10 € | 7 | 41.2 % | 7 | 41.2 % | 5 |
| 2026-04-08 | 18 | 1513.65 € | 3 | 16.7 % | 0 | 0.0 % | 0 |

## Funnel par stage

| Stage | Total | % total | Identifiés | Anonymes | Montant |
|---|---:|---:|---:|---:|---:|
| `cart` | 159 | 67.1 % | 33 | 126 | 16778.10 € |
| `checkout_started` | 18 | 7.6 % | 2 | 16 | 2061.16 € |
| `checkout_engaged` | 14 | 5.9 % | 7 | 7 | 1042.00 € |
| `payment_attempted` | 2 | 0.8 % | 1 | 1 | 144.00 € |
| `completed` | 44 | 18.6 % | 44 | 0 | 3383.60 € |

## Identifiés vs anonymes — comportement dans le funnel

### Identifiés (email connu)

- Base : **87** paniers (8641.67 €)
- Sont arrivés au checkout : **54** / 87 = **62.1 %**
- Ont payé : **44** / 87 = **50.6 %**
- Restés au stade cart : **33** / 87 = **37.9 %**

### Anonymes (pas d'email)

- Base : **150** paniers (14767.23 €)
- `highest_stage ∈ checkout_*` (sont passés par le checkout au moins une fois) : **24** / 150 = **16.0 %**
- `highest_stage = cart` (jamais passés au checkout) : **126** / 150 = **84.0 %**
- Ont payé : **0** / 150 = **0.0 %** (tout panier `completed` = identifié par construction)

**Zoom par `last_action` (là où ils sont *maintenant*, pas "où ils sont allés"):**

| Dernière action | N | % des 150 |
|---|---:|---:|
| `checkout:*` | **22** | **14.7 %** |
| `cart:*` | **128** | **85.3 %** |

Détail des 22 anonymes dont la dernière action est un événement checkout :

| `last_action` | N |
|---|---:|
| `checkout:started` | 15 |
| `checkout:shipping_info_submitted` | 5 |
| `checkout:address_info_submitted` | 1 |
| `checkout:payment_info_submitted` | 1 |

→ **68 %** de ces 22 se sont arrêtés pile après "Commander" (`checkout:started`) sans commencer à remplir quoi que ce soit. Plus gros gisement d'optimisation côté anonymes.

L'écart avec les 24 du funnel `highest_stage` : 2 paniers sont revenus au cart après être passés par le checkout (donc ils comptent dans le parcours, pas dans l'état courant).

## Lecture

**Attention à l'interprétation — effet tautologique partiel** : un panier qui atteint `checkout_engaged` ou `completed` a nécessairement fourni un email au passage (le formulaire Shopify le demande). Donc dire "les identifiés convertissent mieux" mélange deux effets : la causalité réelle (un client engagé convertit plus) et la mécanique (avancer dans le funnel rend identifié). Les chiffres à regarder honnêtement :

- **Parmi les 87 identifiés** : 50.6 % ont payé (44), 37.9 % sont restés au stade cart (33) — ce dernier chiffre est le **signal marketing actionnable** : on connaît leur email, on peut les relancer.
- **Parmi les 150 anonymes** : 84 % ont bounce au stade cart sans laisser d'adresse. Le levier direct, c'est la capture d'email avant le cart drop — soit via le formulaire "surprise" (fraîchement déployé), soit via un `$identify` Klaviyo plus précoce.
- **Les 18 paniers `checkout_started` anonymes** (16 vs 2 identifiés) sont une curiosité : ils ont cliqué "Commander" mais n'ont rien rempli. Probablement des ouvertures d'onglet checkout sans validation. Marginal pour les KPI.
- La colonne "% id." par jour donne un signal plus propre : le **20 avril** on tourne à 45.8 % d'identifiés, le **08 avril** à 16.7 %. L'écart vient probablement du volume de trafic payant vs organique sur ces jours.

## Ce qu'on exclut

- Les paniers de test d'Olivier (emails `*@yahoo.fr`, `olivierbelaudpro+*`, first_name="Olivier") : purgés de la DB avant calcul.
- Les paniers "completed" qui n'auraient aucun montant ne sont pas exclus — si `total_price` était à 0, on le compte quand même car c'est un signal de commande réussie.
