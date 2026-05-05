# CRM e-commerce — vision et modèle cible

**Date** : 2026-04-23
**Auteur** : Olivier (vision), Claude (transcription + structuration)
**Statut** : document de vision — décisions ouvertes en fin de doc

---

## 1. Cadrage

**On n'est pas en train de construire un outil d'emailing. On est en train de construire un CRM e-commerce.**

Ce qui implique que la DB est le substrat (pas un add-on analytics), que chaque interaction client est tracée, et que l'objectif n'est pas "envoyer des emails" mais "piloter la conversion d'opportunités commerciales".

## 2. Constat — pourquoi Klaviyo ne suffit plus

Klaviyo fonctionne par **flows indépendants** : un flow welcome, un flow panier abandonné, un flow checkout abandonné, un flow marketing, un flow bienvenue post-achat, etc. Chaque flow tire ses emails selon ses propres règles.

**Problème structurel** : les flows se télescopent.
- Même journée : un prospect reçoit l'email de bienvenue (-10% première commande) + l'email panier abandonné (-10% pour finaliser) + l'email marketing Fête des Mères.
- Les filtres d'exclusion qui tentent de gérer ça deviennent ingérables ("si cart_started ET NOT checkout_started ET NOT welcome_sent_last_3d…").
- Le message final n'est jamais contextualisé — c'est l'union des flows qui a tiré, pas un message pensé pour l'état du contact.

**Constat terrain** (audits du 2026-04-23 dans `klaviyo-abandon-perf-2026-04-23.md` et `klaviyo-fr-audit-2026-04-23.md`) :
- Email 1 = 100% du recovery. Emails 2-3 = 0 conversion. Les séquences longues sont du bruit.
- Le flow FR "040 Bis Checkout Abandonné" est resté en draft depuis le 2026-04-13 → les prospects FR en drop checkout ne reçoivent rien.
- 63% des paniers sont anonymes (`cart-tracking-stats-2026-04-23.md`) → aucun levier email possible.

## 3. Le modèle cible — 5 entités

Si on raisonne from scratch comme un CRM, il y a **5 entités, pas plus** :

| Entité | Définition |
|--------|------------|
| **Contact** | Personne identifiée (email minimum). Peut porter des attributs CRM (locale, nb commandes, LTV, tags…). |
| **Signal** | Événement brut : a vu produit X, a navigué 3 min, a ajouté au panier, a ouvert email Y, a cliqué. |
| **Opportunity** | Intention commerciale en vol : stage (`discovery` / `cart` / `checkout`) + date d'ouverture + TTL (7j pour cart, 14j pour discovery) + dernier touch + p(close). |
| **Touch** | Email envoyé, taggé par purpose : `transactional` / `marketing` / `reactivation`. Contient : contact, timestamp, slice(s) utilisé(s), opportunity liée, campaign liée, résultat (open, click, conversion attribuée). |
| **Campaign** | Surcouche marketing avec calendrier + audience cible : Fête des Mères, Black Friday, lancement produit… |

**Dynamique** :
- Les **Signals** promeuvent ou font progresser les **Opportunities**.
- Une **Opportunity** expire silencieusement à l'échéance de son TTL (close-lost) si aucun signal de progression.
- Un **Touch** est toujours attribué à au moins une Opportunity OU Campaign — jamais "orphelin".

## 4. Le scheduler — anti-télescoping par construction

**Un cron horaire**, une seule décision par contact par tick :

```
Pour chaque Contact avec une Opportunity active OU dans l'audience d'une Campaign active :
  éligibles = toutes les actions que je pourrais envoyer maintenant
  si déjà touché dans les dernières 24h → skip (frequency cap)
  sinon → prioriser (transactional > marketing, sauf exceptions configurables)
  composer le message = slice de l'action prioritaire + slice contextuelle si mergeable
  envoyer, logger un Touch avec sa raison (audit trail)
```

**Une seule décision par contact par tick** = zéro télescoping.

**Cas clé — Fête des Mères** : si un contact a une Opportunity cart en vol ET est dans l'audience de la Campaign Fête des Mères, la Campaign ne déclenche pas un email séparé. Elle **devient une slice overlay** dans l'email qu'on allait envoyer de toute façon :

> "On lance la Fête des Mères [slice campagne], d'ailleurs ton panier t'attend [slice opportunity]."

Un seul email, deux slices, message cohérent.

## 5. Le rôle de l'IA — sélection, pas génération

**L'IA ne rédige pas le copy à la volée.** Risque de ton brand cassé, hallucinations, inconsistance, indébuguable.

**L'IA choisit dans une librairie de slices** écrits humainement (15 à 30 par purpose) :
- "Slice panier abandonné — classique"
- "Slice panier abandonné — urgency (TTL < 48h)"
- "Slice panier abandonné — social proof"
- "Slice bienvenue — première commande -10%"
- etc.

À chaque décision, l'IA (ou un simple bandit Thompson, c'est équivalent à ce stade) sélectionne **quel slice tirer** selon : stage de l'opportunity, profil du contact (nouveau / répétiteur / VIP), historique de perf sur cohortes similaires.

**Humains = bibliothécaires. IA = sélecteur A/B/C/D.**

Phase 1 = règles déterministes (`stage=cart AND TTL<48h → slice urgency`). Phase 2 = bandit quand volume suffit (~5k touches/mois minimum).

## 6. Métriques prioritaires

Ordre du plus large au plus resserré. **C'est le tableau de bord minimum pour piloter.**

| # | Métrique | Définition |
|---|----------|------------|
| 1 | Taux de conversion global | visiteurs uniques → acheteurs |
| 2 | Taux d'ajout au panier | visiteurs → créent un panier |
| 3 | **Taux d'identification** `unknown → known` | **LA métrique critique** — conditionne toute capacité de relance. Si on ne choppe pas l'email, rien n'est activable côté CRM. |
| 4 | Taux de conversion panier | paniers créés → paniers convertis (à affiner : identifié vs anonyme) |

**Métrique explicitement rejetée** : drop `cart → checkout`. Raison : le checkout est sur Shopify, aucun levier d'optimisation côté Manta. Inutile de la tracker comme indicateur actionnable.

**Métriques CRM secondaires** (pour le pilotage du système lui-même, pas du business) :
- **Suppression rate** : combien de marketing ont été mergés en slice dans une opportunity vs envoyés tels quels → prouve que l'anti-télescoping fonctionne
- Win rate par stage d'opportunity
- Time-to-close par cohorte
- Revenue attribué par slice (quelle slice convertit)
- Dormants réactivés / mois

## 7. Exigences CRM (tracking DB)

**Chaque email envoyé est loggé en DB.** Pas d'email qui part sans trace. Attributs minimum par Touch :
- `contact_id`
- `sent_at`
- `purpose` (transactional / marketing / reactivation)
- `slices_used[]` (IDs des slices composées dans l'email)
- `opportunity_id` (si applicable)
- `campaign_id` (si applicable)
- `reason` (pourquoi le scheduler a choisi cet email — audit trail)
- `result` : open, click, conversion attribuée (fenêtre d'attribution à définir)

**Framework de test intégré** :
- Cohortes assignables (par règle : "tous les nouveaux inscrits FR cette semaine")
- A/B testable sur : choix de slice, timing, fréquence, séquences entières
- Mesure de perf automatique par variante
- Objectif : converger par scénario (relance panier, navigation abandonnée, bienvenue, réactivation) vers la séquence optimale, data-driven

**Ce n'est pas un plugin analytics bolted-on.** La DB CRM est le substrat. Tout le reste lit depuis elle.

## 8. Build vs buy

On ne rebuilde pas un **sender**. Deliverability, warmup IP, DKIM/SPF/DMARC, bounce handling, unsubscribe compliance RGPD : c'est un gouffre qui ne crée pas de différenciation.

**Le scheduler + la composition de slices + la DB CRM vivent côté Manta.** Klaviyo (ou Resend / Postmark — à arbitrer) devient juste le **transport** : on lui passe un email déjà composé, on n'utilise plus ses flows ni son éditeur visuel.

**Reste ouvert** : continuer Klaviyo (deliverability établie, mais features payées non utilisées) vs migrer vers Resend / Postmark (API-first, moins cher, template-agnostic). Décision non urgente — le modèle ci-dessus est agnostique du transport.

## 9. Les 4 points durs à anticiper

**1. Journal d'audit obligatoire.** Pour chaque contact, pour chaque tick du scheduler, pourquoi on a envoyé X (ou pourquoi rien). Sans ça, le système est aveugle et la confiance s'effondre à la première anomalie perçue.

**2. Cold start du bandit.** Impossible d'apprendre sous ~5k touches/mois. Phase 1 = règles déterministes humainement écrites. Phase 2 = bandit quand volume suffit. Ne pas mettre l'IA trop tôt.

**3. UI admin avec simulateur.** Condition sine qua non. L'admin doit voir : opportunities en vol, règles de priorité actives, librairie de slices avec leurs perfs, et surtout un **simulateur "si le cron tournait maintenant, voici les emails qui partiraient et pourquoi"**. ~40% du boulot UI. Pas négociable.

**4. Gouvernance humaine.** Le système doit rester "humainement compréhensible". Un opérateur doit pouvoir : inspecter un contact, comprendre les décisions passées, désactiver une règle, ajouter un slice, pause une campagne. Pas de boîte noire.

## 10. Questions ouvertes — à trancher avant le doc de design détaillé

**Q1 — Opportunity : mono-stage ou multi-stages simultanés ?**
Ex. quelqu'un qui navigue ET a un panier : une seule Opportunity au stage le plus avancé (cart), ou deux Opportunities (discovery + cart) avec des TTL séparés ?
*Préférence Claude : mono-stage, plus simple, moins de cas de conflit.*

**Q2 — Campaign : toujours overlay, ou priorité configurable ?**
Est-ce qu'une Campaign peut être flaggée "high priority" et écraser l'Opportunity slice (ex. Black Friday qui remplace le rappel panier), ou est-elle **toujours** un overlay qui vient s'ajouter ?
*Préférence Claude : priorité configurable par Campaign (normal = overlay, high = écrase). Plus flexible sans complexifier le modèle.*

## 11. Prochaines étapes — options

**Option A — Commencer par le dashboard des 4 métriques prioritaires.**
Câbler les 4 métriques sur les données qu'on a déjà (carts + posthog + shopify). Pas de CRM, pas de refonte. Objectif : voir les chiffres de base bouger avant de toucher à l'architecture. Piloter la refonte par les données.

**Option B — Commencer par le doc de design détaillé du CRM.**
Schéma des 5 entités (tables Drizzle), règles de priorité entre purposes, cycle de vie d'une opportunity, format d'un slice (inputs / variables rendues), 5-8 règles de scheduling phase 1. Base solide avant toute ligne de code.

**Option C — Les deux en parallèle.**
Le dashboard des métriques est indépendant du CRM (il lit les données existantes). Le doc de design peut se faire pendant que le dashboard prend forme.

---

## Annexes — fichiers liés

- `demo/commerce/docs/klaviyo-abandon-perf-2026-04-23.md` — audit perf flows Klaviyo 90j
- `demo/commerce/docs/klaviyo-fr-audit-2026-04-23.md` — audit complet flows FR 365j
- `demo/commerce/docs/cart-tracking-stats-2026-04-23.md` — stats paniers identifiés vs anonymes
- `demo/commerce/docs/cart-abandonment-rules.md` — règles actuelles d'abandon
- `demo/commerce/docs/rgpd-audit-18-emails.md` — audit RGPD des emails existants
