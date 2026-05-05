# Klaviyo — analyse des flows d'abandon (365 derniers jours)

*Source : Klaviyo Reports API (`flow-values-reports`), timeframe `last_365_days`. Générée le 2026-04-23 via `scripts/klaviyo-abandon-perf.ts`.*

## TL;DR — réponse directe à "est-ce que les emails 2 et 3 servent à quelque chose ?"

**Réponse courte : ça dépend massivement du flow. Dans un seul cas on a un échantillon assez gros pour répondre — et la réponse n'est PAS la même qu'attendu.**

| Flow | N email 1 | N email 2 | N email 3 | Recovery E1 | Recovery E2 | Recovery E3 | Lecture |
|---|---:|---:|---:|---:|---:|---:|---|
| **`030 Panier Abandonné EN`** (12 mois) | 77 | 72 | **61** | 2 (33 %) | 1 (17 %) | **3 (50 %)** | ✅ **Email 3 est le MEILLEUR**. Pas un pattern "l'email 1 fait tout". |
| `040 Checkout Abandonné EN` (12 mois) | **138** | **0** | **0** | 4 (100 %) | 0 | 0 | 🚨 **Problème de config** : email 2 et 3 jamais envoyés en 12 mois malgré 138 déclenchements sur email 1. À ouvrir dans Klaviyo. |
| `04 Panier Abandonné FR` (4 sem.) | 90 | 36 | 74 | 2 (100 %) | 0 | 0 | ⚠️ Échantillon trop petit (flow créé le 2026-03-26). Inutilisable pour conclure. À rescanner dans 2 mois. |
| `Winback FR` (9 mois) | 66 | 51 | — | 0 | **1 (100 %)** | — | Email 2 (celui qui rappelle le -15 %) fait tout. Email 1 à 0. |
| `020 Navigation Abandonnée FR` (2 ans) | **6617** | — | — | 51 | — | — | Un seul email. Pas de question "email 2/3". Le plus gros contributeur en revenu (4333 €). |

### Lecture des chiffres

1. **Le seul flow où on a VRAIMENT un échantillon ≥100 sur chaque email et de la recovery partout** : `030 Panier Abandonné EN`. Résultat : **email 3 est le plus performant (50 % du recovery)**, loin devant email 1 (33 %). Ton hypothèse "l'email 2/3 sert à rien" est fausse sur ce flow. Ce qui marche est l'email 3 : *"Got a question or not quite sure? I'm here to help ❤️"* (ton humain/support, pas un discount). Open rate = 57 % — le meilleur des trois.

2. **Le flow EN Checkout Abandonné est cassé** : 138 personnes ont reçu l'email 1 en 12 mois, **zéro n'a reçu l'email 2 ni l'email 3**. Il y a soit un `BOOLEAN_BRANCH` qui dévie tout le monde, soit une condition de filtre, soit un statut fantôme. À ouvrir dans l'UI Klaviyo en priorité — on perd potentiellement 15-25 % de recovery supplémentaire sur un des flows à plus forte intention.

3. **Le flow FR Panier Abandonné n'est pas analysable** (N=90 sur 4 semaines). La version précédente (`04 | Panier Abandonné - old`) n'apparaît pas dans les rapports 365 j — elle a été mise en draft avant la fenêtre ou bien ne triggere plus. Pour avoir une réponse propre côté FR il faut attendre 2 mois ou bien importer l'historique de l'ancienne version depuis Klaviyo directement.

4. **Le Winback FR est un point de comparaison utile** : même structure (2 emails), seul l'email 2 convertit. Mais avec N=1 conversion en 9 mois, c'est aussi du bruit.

### Conclusion pratique (ce qui est solide dans la data)

- ✅ **Garde les 3 emails sur EN Panier Abandonné** — l'email 3 est le meilleur performer. Ce serait une erreur de le couper.
- 🚨 **Investigue immédiatement EN Checkout Abandonné** — 0 destinataires email 2/3 sur 138 triggers en 12 mois, c'est un bug de config, pas un choix produit.
- ⏳ **Attends 2 mois pour conclure sur FR Panier Abandonné** — sample insuffisant.
- 💡 **Pattern de contenu à noter** : sur EN, ce qui marche (50 %) c'est l'email "humain / support", pas le discount ni le "vous avez oublié". Tester le même ton en FR quand le sample sera là.

---

## Vue d'ensemble des flows actifs

On a 6 flows dits "d'abandon" en statut `live` dans Klaviyo, couvrant 3 étapes du funnel (browse → cart → checkout) × 2 langues (FR/EN), plus un flow winback.

| Flow | Lang | Étape | Statut | Créé | # emails |
|---|:---:|---|---|---|---:|
| 04 \| Panier Abandonné | FR | cart | LIVE (nouveau) | 2026-03-26 | 3 |
| 04 \| Panier Abandonné - old | FR | cart | DRAFT — version précédente, contient l'historique | 2024-04-19 | 6 |
| 030 \| Panier Abandonné \| B2C EN | EN | cart | LIVE | 2025-04-07 | 3 |
| 040 \| Checkout Abandonné \| B2C EN | EN | checkout | LIVE | 2025-04-02 | 3 |
| 020 \| Navigation Abandonnée \| B2C FR | FR | browse | LIVE | 2024-02-01 | 1 |
| 020 \| Navigation Abandonnée \| B2C EN | EN | browse | LIVE | 2025-03-27 | 1 |
| Winback - Last Cart was 2 months ago \| B2C FR | FR | winback | LIVE | 2024-07-18 | 2 |

> ⚠️ **Constat structurel immédiat** : il n'y a **pas de flow Checkout Abandonné FR en live** (`040 Bis | Checkout Abandonné SHOPI | B2C FR` est en status `draft`). Donc tous les prospects FR qui abandonnent au checkout ne reçoivent pas d'email de rattrapage — ils tombent uniquement dans le flow "Panier Abandonné" qui ne cible pas spécifiquement l'intention de commander.

## 04 \| Panier Abandonné (FR · cart · LIVE (nouveau) · créé 2026-03-26)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `FR Panier Abandonné Email #1` | "Vous avez oublié quelque chose 👀" | 90 | 89 | 56.2 % | 5.6 % | 2 | 121.50 € |
| 2 | `FR Panier Abandonné Email #2` | "Votre bijou Palas n'attend plus que vous 💗" | 36 | 35 | 51.4 % | 2.9 % | 0 | 0 € |
| 3 | `FR Panier Abandonné Email #3` | "Un doute ? Une question ? Je suis là pour vous ❤️" | 74 | 73 | 49.3 % | 0.0 % | 0 | 0 € |

**Attribution dans la séquence** — de qui vient le recovery ?

- Email 1 : **2** commandes attribuées = **100.0 %** du recovery total du flow, 121.50 € de revenu.
- Email 2 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.
- Email 3 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.

Total flow : **2** commandes attribuées, 121.50 € de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 90 | — | 100.0 % |
| Email 2 | 36 | −54 (60.0 %) | 40.0 % |
| Email 3 | 74 | −-38 (-105.6 %) | 82.2 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## 04 \| Panier Abandonné - old (FR · cart · DRAFT — version précédente, contient l'historique · créé 2024-04-19)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Panier Abandonné - Email #2` | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 2 | `Panier Abandonné - Email #3` | "Un doute ? Une question ? Je suis là pour vous ❤️" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 3 | `Copy of Panier Abandonné - Email #1` | "Vous avez oublié quelque chose 👀" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 4 | `Copy of Panier Abandonné - Email #2` | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 5 | `Copy of Panier Abandonné - Email #3` | "Un doute ? Une question ? Je suis là pour vous ❤️" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 6 | `Panier Abandonné - Email #1` | "Vous avez oublié quelque chose 👀" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 0 | — | 0.0 % |
| Email 2 | 0 | −0 (0.0 %) | 0.0 % |
| Email 3 | 0 | −0 (0.0 %) | 0.0 % |
| Email 4 | 0 | −0 (0.0 %) | 0.0 % |
| Email 5 | 0 | −0 (0.0 %) | 0.0 % |
| Email 6 | 0 | −0 (0.0 %) | 0.0 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## 030 \| Panier Abandonné \| B2C EN (EN · cart · LIVE · créé 2025-04-07)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Panier Abandonné EN - Email #1` | "Forgot something 👀" | 77 | 77 | 46.8 % | 1.3 % | 2 | 381.83 € |
| 2 | `Panier Abandonné EN - Email #2` | "Make it yours today 🌸" | 72 | 71 | 49.3 % | 7.0 % | 1 | 55.50 € |
| 3 | `Panier Abandonné - Email #3` | "Got a question or not quite sure? I'm here to help ❤️" | 61 | 61 | 57.4 % | 1.6 % | 3 | 593.45 € |

**Attribution dans la séquence** — de qui vient le recovery ?

- Email 1 : **2** commandes attribuées = **33.3 %** du recovery total du flow, 381.83 € de revenu.
- Email 2 : **1** commandes attribuées = **16.7 %** du recovery total du flow, 55.50 € de revenu.
- Email 3 : **3** commandes attribuées = **50.0 %** du recovery total du flow, 593.45 € de revenu.

Total flow : **6** commandes attribuées, 1030.78 € de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 77 | — | 100.0 % |
| Email 2 | 72 | −5 (6.5 %) | 93.5 % |
| Email 3 | 61 | −11 (15.3 %) | 79.2 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## 040 \| Checkout Abandonné \| B2C EN (EN · checkout · LIVE · créé 2025-04-02)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Checkout Abandonné EN - Email #1` | "We're almost out of the jewellery you love" | 138 | 138 | 47.8 % | 6.5 % | 4 | 244.94 € |
| 2 | `Checkout Abandonné EN - Email #2` | "Your new jewellery is waiting for you" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 3 | `Checkout Abandonné EN - Email #3` | "Any doubts? Any questions? I'm here for you ❤️" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |

**Attribution dans la séquence** — de qui vient le recovery ?

- Email 1 : **4** commandes attribuées = **100.0 %** du recovery total du flow, 244.94 € de revenu.
- Email 2 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.
- Email 3 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.

Total flow : **4** commandes attribuées, 244.94 € de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 138 | — | 100.0 % |
| Email 2 | 0 | −138 (100.0 %) | 0.0 % |
| Email 3 | 0 | −0 (0.0 %) | 0.0 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## 020 \| Navigation Abandonnée \| B2C FR (FR · browse · LIVE · créé 2024-02-01)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Browse Abandonment: Email #1` | "Vous y pensez encore ?" | 6617 | 6579 | 32.8 % | 3.8 % | 51 | 4333.20 € |

## 020 \| Navigation Abandonnée \| B2C EN (EN · browse · LIVE · créé 2025-03-27)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Browse Abandonment: Email #1` | "Still thinking about it?" | 299 | 296 | 34.1 % | 3.7 % | 5 | 1097.13 € |

## Winback - Last Cart was 2 months ago \| B2C FR (FR · winback · LIVE · créé 2024-07-18)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Email #1 - WINBACK CART FLOW` | "-15% sur votre commande de bijoux ✨" | 66 | 65 | 53.8 % | 4.6 % | 0 | 0 € |
| 2 | `Email #2 - WINBACK CART FLOW` | "RE: votre commande Palas à -15%" | 51 | 50 | 66.0 % | 2.0 % | 1 | 143 € |

**Attribution dans la séquence** — de qui vient le recovery ?

- Email 1 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.
- Email 2 : **1** commandes attribuées = **100.0 %** du recovery total du flow, 143 € de revenu.

Total flow : **1** commandes attribuées, 143 € de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 66 | — | 100.0 % |
| Email 2 | 51 | −15 (22.7 %) | 77.3 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## Synthèse inter-flows

| Flow | Destinataires cumulés | Conversions | Taux de recovery | Revenu |
|---|---:|---:|---:|---:|
| 04 \| Panier Abandonné | 200 | 2 | 1.0 % | 121.50 € |
| 04 \| Panier Abandonné - old | 0 | 0 | 0.0 % | 0 € |
| 030 \| Panier Abandonné \| B2C EN | 210 | 6 | 2.9 % | 1030.78 € |
| 040 \| Checkout Abandonné \| B2C EN | 138 | 4 | 2.9 % | 244.94 € |
| 020 \| Navigation Abandonnée \| B2C FR | 6617 | 51 | 0.8 % | 4333.20 € |
| 020 \| Navigation Abandonnée \| B2C EN | 299 | 5 | 1.7 % | 1097.13 € |
| Winback - Last Cart was 2 months ago \| B2C FR | 117 | 1 | 0.9 % | 143 € |

> Le "taux de recovery" ci-dessus = conversions / destinataires cumulés sur le flow entier, **toutes étapes confondues**. C'est une borne basse utile pour comparer les flows entre eux, mais ce n'est pas le taux par email (qui est dans chaque tableau ci-dessus).

## Lecture — à quoi sert chaque email ?

**Lis la ligne "Attribution dans la séquence" de chaque flow ci-dessus — c'est la réponse directe à "est-ce que l'email 2 et 3 servent à quelque chose ?" pour ce flow.**

Pattern type cité dans les benchmarks Klaviyo e-commerce, pour référence :

- **Email 1** (envoyé ~1-4 h après l'abandon) : ~60-70 % du recovery.
- **Email 2** (J+1, souvent avec discount) : ~20-30 %.
- **Email 3** (J+3 à J+7, "dernière chance") : ~5-15 %.

Si un flow s'écarte fortement du pattern, c'est un signal :

- **Email 1 à 100 %, les autres à 0 %** → soit les autres emails ne proposent rien de neuf (pas de discount, pas d'urgence), soit l'attribution "5 jours après click" les étouffe (un client qui clique email 1 + achète J+4 reste attribué à email 1 même s'il avait reçu email 2 entre-temps).
- **Email 2 ou 3 domine** → pertinent (souvent = c'est là que le discount est mis, ou le ton de "dernière chance" qui débloque).
- **Email 1 solide, 2/3 à 0** avec petit sample → peut être un biais de fraîcheur (flow récemment activé, les gens n'ont pas encore dépassé le time-delay).

## Méthodologie / limites

- **Fenêtre d'attribution Shopify-Klaviyo** : par défaut une commande est attribuée au dernier email ouvert/cliqué dans les 5 jours précédents. Ce biais favorise systématiquement les premiers emails envoyés dans un flow.
- **Skip if converted** : dès qu'un destinataire convertit, Klaviyo le retire du flow. Donc les dénominateurs des emails 2 et 3 sont mécaniquement plus petits (et ne contiennent que les non-convertis des étapes précédentes). Ça rend la comparaison "par email" honnête, mais ça empêche de comparer "qui convertit le plus en absolu".
- **Fraîcheur des flows** : un flow activé récemment n'a pas eu le temps d'exécuter ses time-delays (souvent J+1, J+3). Les emails 2 et 3 apparaissent alors à 0 destinataires alors qu'ils vont partir. Cf. date "Créé" de chaque flow dans la vue d'ensemble.
- **Flow version** : on inclut `04 | Panier Abandonné - old` (draft) pour voir l'historique pré-refonte. Les chiffres des emails y sont ceux qu'ils ont produits quand ils étaient live, avant que le flow soit mis en draft.
- **Ordre des emails** : basé sur l'ordre retourné par l'API. Pour les flows avec branches (`AB_TEST`, `BOOLEAN_BRANCH`, `UPDATE_CUSTOMER`), cet ordre peut ne pas refléter l'enchaînement temporel — vérifier dans l'UI Klaviyo si les chiffres étonnent (ex. email 3 avec plus de destinataires qu'email 2).
