# Klaviyo — analyse des flows d'abandon (90 derniers jours)

*Source : Klaviyo Reports API (`flow-values-reports`), timeframe `last_90_days`. Générée le 2026-04-23 via `scripts/klaviyo-abandon-perf.ts`.*

## Vue d'ensemble des flows actifs

On a 6 flows dits "d'abandon" en statut `live` dans Klaviyo, couvrant 3 étapes du funnel (browse → cart → checkout) × 2 langues (FR/EN), plus un flow winback.

| Flow | Lang | Étape | # emails live |
|---|:---:|---|---:|
| 04 \| Panier Abandonné | FR | cart | 3 |
| 030 \| Panier Abandonné \| B2C EN | EN | cart | 3 |
| 040 \| Checkout Abandonné \| B2C EN | EN | checkout | 3 |
| 020 \| Navigation Abandonnée \| B2C FR | FR | browse | 1 |
| 020 \| Navigation Abandonnée \| B2C EN | EN | browse | 1 |
| Winback - Last Cart was 2 months ago \| B2C FR | FR | winback | 2 |

> ⚠️ **Constat structurel immédiat** : il n'y a **pas de flow Checkout Abandonné FR en live** (`040 Bis | Checkout Abandonné SHOPI | B2C FR` est en status `draft`). Donc tous les prospects FR qui abandonnent au checkout ne reçoivent pas d'email de rattrapage — ils tombent uniquement dans le flow "Panier Abandonné" qui ne cible pas spécifiquement l'intention de commander.

## 04 | Panier Abandonné (FR · cart)

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

## 030 | Panier Abandonné | B2C EN (EN · cart)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Panier Abandonné EN - Email #1` | "Forgot something 👀" | 6 | 6 | 50.0 % | 0.0 % | 0 | 0 € |
| 2 | `Panier Abandonné EN - Email #2` | "Make it yours today 🌸" | 7 | 7 | 57.1 % | 14.3 % | 0 | 0 € |
| 3 | `Panier Abandonné - Email #3` | "Got a question or not quite sure? I'm here to help ❤️" | 5 | 5 | 60.0 % | 0.0 % | 0 | 0 € |

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 6 | — | 100.0 % |
| Email 2 | 7 | −-1 (-16.7 %) | 116.7 % |
| Email 3 | 5 | −2 (28.6 %) | 83.3 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## 040 | Checkout Abandonné | B2C EN (EN · checkout)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Checkout Abandonné EN - Email #1` | "We're almost out of the jewellery you love" | 16 | 16 | 62.5 % | 12.5 % | 3 | 155.50 € |
| 2 | `Checkout Abandonné EN - Email #2` | "Your new jewellery is waiting for you" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |
| 3 | `Checkout Abandonné EN - Email #3` | "Any doubts? Any questions? I'm here for you ❤️" | 0 | 0 | 0.0 % | 0.0 % | 0 | 0 € |

**Attribution dans la séquence** — de qui vient le recovery ?

- Email 1 : **3** commandes attribuées = **100.0 %** du recovery total du flow, 155.50 € de revenu.
- Email 2 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.
- Email 3 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.

Total flow : **3** commandes attribuées, 155.50 € de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 16 | — | 100.0 % |
| Email 2 | 0 | −16 (100.0 %) | 0.0 % |
| Email 3 | 0 | −0 (0.0 %) | 0.0 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## 020 | Navigation Abandonnée | B2C FR (FR · browse)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Browse Abandonment: Email #1` | "Vous y pensez encore ?" | 1323 | 1318 | 42.2 % | 3.7 % | 10 | 1036.35 € |

## 020 | Navigation Abandonnée | B2C EN (EN · browse)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Browse Abandonment: Email #1` | "Still thinking about it?" | 46 | 45 | 46.7 % | 6.7 % | 2 | 212.90 € |

## Winback - Last Cart was 2 months ago | B2C FR (FR · winback)

| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `Email #1 - WINBACK CART FLOW` | "-15% sur votre commande de bijoux ✨" | 11 | 11 | 54.5 % | 9.1 % | 0 | 0 € |
| 2 | `Email #2 - WINBACK CART FLOW` | "RE: votre commande Palas à -15%" | 6 | 6 | 50.0 % | 0.0 % | 1 | 143 € |

**Attribution dans la séquence** — de qui vient le recovery ?

- Email 1 : **0** commandes attribuées = **0.0 %** du recovery total du flow, 0 € de revenu.
- Email 2 : **1** commandes attribuées = **100.0 %** du recovery total du flow, 143 € de revenu.

Total flow : **1** commandes attribuées, 143 € de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).

**Déperdition entre les étapes** — combien reçoivent l'email suivant ?

| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |
|---:|---:|---:|---:|
| Email 1 | 11 | — | 100.0 % |
| Email 2 | 6 | −5 (45.5 %) | 54.5 % |

> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).

## Synthèse inter-flows

| Flow | Destinataires cumulés | Conversions | Taux de recovery | Revenu |
|---|---:|---:|---:|---:|
| 04 \| Panier Abandonné (FR) | 200 | 2 | 1.0 % | 121.50 € |
| 030 \| Panier Abandonné (EN) | 18 | 0 | 0.0 % | 0 € |
| 040 \| Checkout Abandonné (EN) | 16 | 3 | 18.8 % | 155.50 € |
| 020 \| Navigation Abandonnée (FR) | 1323 | 10 | 0.8 % | 1036.35 € |
| 020 \| Navigation Abandonnée (EN) | 46 | 2 | 4.3 % | 212.90 € |
| Winback - Last Cart was 2 months ago (FR) | 17 | 1 | 5.9 % | 143 € |

> Le "taux de recovery" ci-dessus = conversions / destinataires cumulés sur le flow entier, **toutes étapes confondues**. C'est une borne basse utile pour comparer les flows entre eux, mais ce n'est pas le taux par email (qui est dans chaque tableau ci-dessus).

## Lecture — ce que la data dit vraiment

### 1. L'email 1 fait presque tout le boulot, les 2 et 3 n'apportent rien

Sur les 3 flows où on a de la donnée exploitable (FR Panier, EN Checkout, Winback FR) :

| Flow | Recovery email 1 | Recovery email 2 | Recovery email 3 |
|---|---:|---:|---:|
| 04 \| Panier Abandonné (FR) | **2 / 2 = 100 %** | 0 | 0 |
| 040 \| Checkout Abandonné (EN) | **3 / 3 = 100 %** | 0 | 0 |
| Winback FR | 0 | **1 / 1 = 100 %** (mais c'est l'email qui porte le -15 %) | — |

**Le pattern "l'email 1 convertit, les 2 et 3 sont du bruit" est confirmé sur nos données**. Le Winback FR est à part : le recovery arrive sur l'email 2 parce que c'est là qu'on insiste sur le -15 %. Le pattern type e-commerce (60-70 % du recovery sur email 1, 20-30 % sur le 2, 5-15 % sur le 3) est complètement écrasé ici : **100 % sur email 1, 0 % sur les suivants**.

Hypothèses pour expliquer :
- **Fenêtre d'attribution trop courte ?** Par défaut Klaviyo attribue sur 5 jours après click. Si email 2 part 24 h après email 1 et que la personne a cliqué sur email 1, son achat reste attribué à email 1 (dernier click). Ça inflate email 1 artificiellement.
- **Skip si converti** (saine) : Klaviyo sort les convertis du flow avant email 2 et 3, donc les emails 2 et 3 n'ont plus aucune chance de "récupérer" qui que ce soit qui a déjà acheté.
- **Emails 2 et 3 trop mous** : pas de discount, pas d'urgence. Le taux de click est de 0 % sur l'email 3 du FR Panier (73 destinataires, aucun click). Aucun signal d'engagement, aucune conversion.

### 2. Les taux d'ouverture sont corrects, donc l'email est bien livré

Open rates sur notre data : 42-62 %. Benchmarks Klaviyo e-commerce = 35-45 %. On est au-dessus. La délivrabilité n'est pas en cause — c'est bien le **contenu / incitation** des emails 2 et 3 qui n'engage pas.

### 3. FR Panier — anomalie d'ordre des emails à vérifier dans l'UI Klaviyo

Dans la table "Déperdition", la ligne Email 3 montre 74 destinataires vs 36 pour Email 2. **Email 3 ne peut pas avoir plus de destinataires que Email 2 dans un flow linéaire.** Deux explications possibles :

- L'ordre retourné par l'API `/flow-actions/` ne reflète pas l'ordre d'exécution (Klaviyo ne garantit pas l'ordre sur les flows avec branches).
- L'un des 3 SEND_EMAIL est en fait une branche parallèle / email AB, pas un email 3 séquentiel.

**À vérifier dans l'UI Klaviyo** : l'enchaînement réel des 3 emails du flow `W4ruD9`. Ça ne change pas la conclusion principale (l'email 1 = 100 % du recovery), mais ça change la lecture de l'attribution pour les emails 2 et 3.

### 4. FR Checkout Abandonné : absent

Le flow `040 Bis | Checkout Abandonné SHOPI | B2C FR` est en status `draft`. Donc :
- Un prospect FR qui ajoute au panier SANS cliquer "Commander" → tombe dans `04 | Panier Abandonné`. OK.
- Un prospect FR qui clique "Commander" et abandonne sur l'écran email/adresse → tombe aussi dans `04 | Panier Abandonné` au lieu d'un flow checkout dédié. **Perte**.

L'EN a bien son flow checkout-abandonné séparé avec un taux de recovery de **18.8 %** sur 16 destinataires, soit presque 20× meilleur que le flow cart. C'est normal — un prospect qui a cliqué "Commander" a une intention beaucoup plus forte qu'un "mettre au panier". Le fait qu'on n'ait pas l'équivalent en FR laisse de l'argent sur la table.

### 5. Volumes comparés

Le Navigation-Abandonnée FR domine tout (1323 destinataires, 10 conversions, **1036 € de revenu**) — simplement parce que le trigger se déclenche sur la page produit, donc volume 10× supérieur aux autres flows. Le taux de recovery est bas (0.8 %) mais le revenu brut est le plus gros de tous les flows abandon combinés.

Leçon : un "mauvais" taux de recovery sur un flow à gros volume vaut plus qu'un "bon" taux sur un flow à faible volume.

## Actions concrètes (par priorité)

1. **Activer le flow Checkout Abandonné FR** (`RDTzMj`). Il existe déjà en draft avec 14 actions. L'EN tourne à 18.8 % de recovery → extrapolation naive : si on a le même volume de checkouts FR abandonnés qu'EN, on récupère +~3-4 commandes par période de 90 jours uniquement en activant ce flow. Facile, gratuit.

2. **Retirer ou repenser l'email 3 du FR Panier Abandonné**. Actuellement : 74 destinataires, 49.3 % d'open rate, **0 % de click**, 0 conversion. Il est ouvert puis abandonné → le contenu ne promet rien. Deux options :
   - Supprimer : on économise 74 envois / 90 jours, on protège la délivrabilité (chaque envoi inouvert-non-cliqué érode légèrement la réputation).
   - Redesigner avec une vraie incitation (discount, urgence stock, produit similaire). À A/B-tester.

3. **Déplacer un discount sur l'email 2** du FR Panier Abandonné, comme c'est fait pour le Winback FR. Sur le Winback, l'email 2 (celui qui rappelle le -15 %) convertit là où l'email 1 ne convertit pas. Le même schéma appliqué au flow cart pourrait débloquer ces personnes qui ouvrent l'email 1 sans cliquer.

4. **Investiguer l'ordre des emails du FR Panier** dans l'UI Klaviyo (74 destinataires sur email 3 > 36 sur email 2 = incohérent). Possible anomalie de structure de flow (branche parallèle mal classée ?).

5. **Pas urgent** : l'EN Panier Abandonné a 18 destinataires cumulés seulement sur 90 jours → trop peu de trafic pour en tirer quoi que ce soit statistiquement. À rescanner dans 3 mois.

## Méthodologie / limites

- **Fenêtre d'attribution** : par défaut Klaviyo attribue une commande au dernier email ouvert/cliqué dans les 5 jours précédents. Ça avantage systématiquement le premier email du flow (car envoyé plus tôt, donc plus souvent dans la fenêtre du click→achat).
- **Skip if converted** : les gens qui convertissent après email 1 ne reçoivent pas email 2 et 3, et n'apparaissent donc pas dans les dénominateurs des emails 2 et 3. Ça rend la comparaison "email 1 vs email 2" honnête, mais pas le calcul "qui convertit le plus", qui est forcément biaisé pour email 1.
- **Périmètre** : 90 derniers jours, ce qui inclut ~2-3 flux de Winback complets (trigger à 2 mois post-cart). Les chiffres Winback sont donc à moitié statistiquement stables.
- **Ordre des emails** : basé sur l'ordre retourné par `/api/flows/{id}/flow-actions/`. Klaviyo ne documente pas explicitement que c'est l'ordre d'exécution. Vérifier dans l'UI pour les flows à branches.
