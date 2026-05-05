# Audit Klaviyo — flows d'abandon FR (365 derniers jours)

*Généré le 2026-04-23. Source : Klaviyo Reports API. Périmètre : tous les flows dont le nom contient "abandon", "panier", "cart" ou "checkout", tous statuts confondus (live + draft + manual + archived).*

## Inventaire complet des flows d'abandon

| Flow | Statut | Archivé | Trigger | Créé | MàJ | # emails | Destinataires 365j |
|---|---|:---:|---|---|---|---:|---:|
| [QTCHAz] Abandoned Cart Reminder - Added to Cart Trigger | manual | non | Metric | 2024-04-19 | 2024-04-19 | 2 | 0 |
| [RDTzMj] 040 Bis \| Checkout Abandonné SHOPI \| B2C FR | draft | non | Metric | 2026-04-13 | 2026-04-13 | 5 | 0 |
| [RrYMuk] Winback - Last Cart was 2 months ago \| B2C FR | live | non | Added to List | 2024-07-18 | 2025-08-26 | 2 | 117 |
| [SYA3es] 030 \| Panier Abandonné | draft | non | Metric | 2024-10-22 | 2025-08-26 | 3 | 3417 |
| [Tj89Zg] 030.Bis \| Panier Abandonné - Typeform | draft | non | Metric | 2025-05-26 | 2025-05-26 | 1 | 283 |
| [TuJa5e] 04 \| Panier Abandonné - old | draft | non | Metric | 2024-04-19 | 2024-10-22 | 6 | 0 |
| [VGzPTF] 040 \| Checkout Abandonné \| B2C EN | live | non | Metric | 2025-04-02 | 2025-08-26 | 3 | 138 |
| [VcXDTu] Abandoned Cart Reminder - Added to Cart Trigger (clone) | draft | non | Metric | 2024-10-07 | 2024-10-07 | 2 | 0 |
| [W4ruD9] 04 \| Panier Abandonné | live | non | Metric | 2026-03-26 | 2026-03-26 | 3 | 201 |
| [WCcxfn] 020 \| Navigation Abandonnée \| B2C FR | live | non | Metric | 2024-02-01 | 2025-08-26 | 1 | 6618 |
| [WHUTVf] 020 \| Navigation Abandonnée \| B2C EN | live | non | Metric | 2025-03-27 | 2025-08-26 | 1 | 300 |
| [WL5Bc6] 030 \| Panier Abandonné \| B2C EN | live | non | Metric | 2025-04-07 | 2025-08-26 | 3 | 210 |
| [XbpeqR] 010 \| Carte Cadeau | draft | non | Added to List | 2024-11-04 | 2024-11-04 | 2 | 0 |
| [YuzaSN] 040 \| Checkout Abandonné \| B2C FR | live | non | Metric | 2024-01-11 | 2025-08-26 | 5 | 2840 |

## Focus FR — chaque flow pouvant toucher le marché français

### [RDTzMj] 040 Bis \| Checkout Abandonné SHOPI \| B2C FR

- **Statut** : `draft` · **Trigger** : Metric · **Créé** : 2026-04-13 · **Dernière MàJ** : 2026-04-13

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `UPDATE_CUSTOMER` | draft | — |
| 2 | `TIME_DELAY` | live | — |
| 3 | `SEND_EMAIL` | draft | "Vous avez oublié quelque chose 👀" |
| 4 | `TIME_DELAY` | live | — |
| 5 | `AB_TEST` | draft | — |
| 6 | `SEND_EMAIL` | draft | "Votre bijou Palas n'attend plus que vous 💗" |
| 7 | `SEND_EMAIL` | draft | "Votre bijou Palas n'attend plus que vous 💗" |
| 8 | `SEND_EMAIL` | draft | "Votre bijou Palas n'attend plus que vous 💗" |
| 9 | `TIME_DELAY` | live | — |
| 10 | `SEND_EMAIL` | draft | "Un doute ? Une question ? Je suis là pour vous ❤️" |
| 11 | `TIME_DELAY` | live | — |
| 12 | `UPDATE_CUSTOMER` | draft | — |
| 13 | `BOOLEAN_BRANCH` | live | — |
| 14 | `SEND_SMS` | draft | — |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Vous avez oublié quelque chose 👀" | 0 | 0 | — | — | 0 | 0 € |
| 2 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| 3 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| 4 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| 5 | "Un doute ? Une question ? Je suis là pour vous ❤️" | 0 | 0 | — | — | 0 | 0 € |
| **Total flow** | — | 0 | — | — | — | **0** | **0 €** |

### [RrYMuk] Winback - Last Cart was 2 months ago \| B2C FR

- **Statut** : `live` · **Trigger** : Added to List · **Créé** : 2024-07-18 · **Dernière MàJ** : 2025-08-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `SEND_EMAIL` | live | "-15% sur votre commande de bijoux ✨" |
| 2 | `TIME_DELAY` | live | — |
| 3 | `TIME_DELAY` | live | — |
| 4 | `SEND_EMAIL` | live | "RE: votre commande Palas à -15%" |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "-15% sur votre commande de bijoux ✨" | 66 | 65 | 53.8 % | 4.6 % | 0 | 0 € |
| 2 | "RE: votre commande Palas à -15%" | 51 | 50 | 66.0 % | 2.0 % | 1 | 143 € |
| **Total flow** | — | 117 | — | — | — | **1** | **143 €** |

### [SYA3es] 030 \| Panier Abandonné

- **Statut** : `draft` · **Trigger** : Metric · **Créé** : 2024-10-22 · **Dernière MàJ** : 2025-08-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `TIME_DELAY` | live | — |
| 2 | `SEND_EMAIL` | draft | "Vous avez oublié quelque chose 👀" |
| 3 | `TIME_DELAY` | live | — |
| 4 | `SEND_EMAIL` | draft | "Votre bijou Palas n'attend plus que vous 💗" |
| 5 | `TIME_DELAY` | live | — |
| 6 | `SEND_EMAIL` | draft | "Un doute ? Une question ? Je suis là pour vous ❤️" |
| 7 | `AB_TEST` | draft | — |
| 8 | `UPDATE_CUSTOMER` | draft | — |
| 9 | `UPDATE_CUSTOMER` | draft | — |
| 10 | `AB_TEST` | draft | — |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Vous avez oublié quelque chose 👀" | 1201 | 1195 | 46.8 % | 6.1 % | 21 | 1592.99 € |
| 2 | "Votre bijou Palas n'attend plus que vous 💗" | 1182 | 1177 | 46.2 % | 8.8 % | 24 | 1853.87 € |
| 3 | "Un doute ? Une question ? Je suis là pour vous ❤️" | 1034 | 1026 | 46.2 % | 1.2 % | 6 | 466.55 € |
| **Total flow** | — | 3417 | — | — | — | **51** | **3913.41 €** |

### [Tj89Zg] 030.Bis \| Panier Abandonné - Typeform

- **Statut** : `draft` · **Trigger** : Metric · **Créé** : 2025-05-26 · **Dernière MàJ** : 2025-05-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `SEND_EMAIL` | draft | "{{ first_name|default:'' }}, vous avez une minute ?" |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "{{ first_name|default:'' }}, vous avez une minute ?" | 283 | 283 | 74.6 % | 35.3 % | 16 | 1559.30 € |
| **Total flow** | — | 283 | — | — | — | **16** | **1559.30 €** |

### [TuJa5e] 04 \| Panier Abandonné - old

- **Statut** : `draft` · **Trigger** : Metric · **Créé** : 2024-04-19 · **Dernière MàJ** : 2024-10-22

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `TIME_DELAY` | live | — |
| 2 | `TIME_DELAY` | live | — |
| 3 | `SEND_EMAIL` | draft | "Votre bijou Palas n'attend plus que vous 💗" |
| 4 | `TIME_DELAY` | live | — |
| 5 | `SEND_EMAIL` | draft | "Un doute ? Une question ? Je suis là pour vous ❤️" |
| 6 | `AB_TEST` | draft | — |
| 7 | `AB_TEST` | draft | — |
| 8 | `BOOLEAN_BRANCH` | live | — |
| 9 | `TIME_DELAY` | live | — |
| 10 | `AB_TEST` | draft | — |
| 11 | `SEND_EMAIL` | draft | "Vous avez oublié quelque chose 👀" |
| 12 | `TIME_DELAY` | live | — |
| 13 | `AB_TEST` | draft | — |
| 14 | `SEND_EMAIL` | draft | "Votre bijou Palas n'attend plus que vous 💗" |
| 15 | `TIME_DELAY` | live | — |
| 16 | `AB_TEST` | draft | — |
| 17 | `SEND_EMAIL` | draft | "Un doute ? Une question ? Je suis là pour vous ❤️" |
| 18 | `AB_TEST` | draft | — |
| 19 | `SEND_EMAIL` | draft | "Vous avez oublié quelque chose 👀" |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| 2 | "Un doute ? Une question ? Je suis là pour vous ❤️" | 0 | 0 | — | — | 0 | 0 € |
| 3 | "Vous avez oublié quelque chose 👀" | 0 | 0 | — | — | 0 | 0 € |
| 4 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| 5 | "Un doute ? Une question ? Je suis là pour vous ❤️" | 0 | 0 | — | — | 0 | 0 € |
| 6 | "Vous avez oublié quelque chose 👀" | 0 | 0 | — | — | 0 | 0 € |
| **Total flow** | — | 0 | — | — | — | **0** | **0 €** |

### [W4ruD9] 04 \| Panier Abandonné

- **Statut** : `live` · **Trigger** : Metric · **Créé** : 2026-03-26 · **Dernière MàJ** : 2026-03-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `SEND_EMAIL` | live | "Vous avez oublié quelque chose 👀" |
| 2 | `TIME_DELAY` | live | — |
| 3 | `UPDATE_CUSTOMER` | live | — |
| 4 | `TIME_DELAY` | live | — |
| 5 | `SEND_EMAIL` | live | "Votre bijou Palas n'attend plus que vous 💗" |
| 6 | `TIME_DELAY` | live | — |
| 7 | `SEND_EMAIL` | live | "Un doute ? Une question ? Je suis là pour vous ❤️" |
| 8 | `UPDATE_CUSTOMER` | live | — |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Vous avez oublié quelque chose 👀" | 91 | 90 | 55.6 % | 5.6 % | 2 | 121.50 € |
| 2 | "Votre bijou Palas n'attend plus que vous 💗" | 36 | 35 | 51.4 % | 2.9 % | 0 | 0 € |
| 3 | "Un doute ? Une question ? Je suis là pour vous ❤️" | 74 | 73 | 49.3 % | 0.0 % | 0 | 0 € |
| **Total flow** | — | 201 | — | — | — | **2** | **121.50 €** |

### [WCcxfn] 020 \| Navigation Abandonnée \| B2C FR

- **Statut** : `live` · **Trigger** : Metric · **Créé** : 2024-02-01 · **Dernière MàJ** : 2025-08-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `TIME_DELAY` | live | — |
| 2 | `SEND_EMAIL` | live | "Vous y pensez encore ?" |
| 3 | `WEBHOOK` | live | — |
| 4 | `TIME_DELAY` | live | — |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Vous y pensez encore ?" | 6618 | 6580 | 32.8 % | 3.8 % | 51 | 4333.20 € |
| **Total flow** | — | 6618 | — | — | — | **51** | **4333.20 €** |

### [WL5Bc6] 030 \| Panier Abandonné \| B2C EN

- **Statut** : `live` · **Trigger** : Metric · **Créé** : 2025-04-07 · **Dernière MàJ** : 2025-08-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `TIME_DELAY` | live | — |
| 2 | `SEND_EMAIL` | live | "Forgot something 👀" |
| 3 | `TIME_DELAY` | live | — |
| 4 | `SEND_EMAIL` | live | "Make it yours today 🌸" |
| 5 | `TIME_DELAY` | live | — |
| 6 | `SEND_EMAIL` | live | "Got a question or not quite sure? I'm here to help ❤️" |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Forgot something 👀" | 77 | 77 | 46.8 % | 1.3 % | 2 | 381.83 € |
| 2 | "Make it yours today 🌸" | 72 | 71 | 49.3 % | 7.0 % | 1 | 55.50 € |
| 3 | "Got a question or not quite sure? I'm here to help ❤️" | 61 | 61 | 57.4 % | 1.6 % | 3 | 593.45 € |
| **Total flow** | — | 210 | — | — | — | **6** | **1030.78 €** |

### [YuzaSN] 040 \| Checkout Abandonné \| B2C FR

- **Statut** : `live` · **Trigger** : Metric · **Créé** : 2024-01-11 · **Dernière MàJ** : 2025-08-26

**Structure du flow :**

| # | Action | Statut | Subject |
|---:|---|---|---|
| 1 | `TIME_DELAY` | live | — |
| 2 | `TIME_DELAY` | live | — |
| 3 | `SEND_EMAIL` | live | "Votre bijou Palas n'attend plus que vous 💗" |
| 4 | `SEND_EMAIL` | live | "Vous avez oublié quelque chose 👀" |
| 5 | `TIME_DELAY` | live | — |
| 6 | `SEND_EMAIL` | live | "Un doute ? Une question ? Je suis là pour vous ❤️" |
| 7 | `BOOLEAN_BRANCH` | live | — |
| 8 | `SEND_SMS` | live | — |
| 9 | `TIME_DELAY` | live | — |
| 10 | `AB_TEST` | live | — |
| 11 | `AB_TEST` | live | — |
| 12 | `AB_TEST` | live | — |
| 13 | `SEND_EMAIL` | manual | "Votre bijou Palas n'attend plus que vous 💗" |
| 14 | `SEND_EMAIL` | manual | "Votre bijou Palas n'attend plus que vous 💗" |
| 15 | `UPDATE_CUSTOMER` | live | — |
| 16 | `UPDATE_CUSTOMER` | live | — |

**Performance 365 jours par email :**

| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | "Votre bijou Palas n'attend plus que vous 💗" | 932 | 929 | 57.3 % | 8.8 % | 22 | 1942.18 € |
| 2 | "Vous avez oublié quelque chose 👀" | 1007 | 1002 | 58.8 % | 10.1 % | 28 | 2405.25 € |
| 3 | "Un doute ? Une question ? Je suis là pour vous ❤️" | 901 | 895 | 53.7 % | 5.4 % | 7 | 465.05 € |
| 4 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| 5 | "Votre bijou Palas n'attend plus que vous 💗" | 0 | 0 | — | — | 0 | 0 € |
| **Total flow** | — | 2840 | — | — | — | **57** | **4812.48 €** |

## Diagnostic

- **[RDTzMj] 040 Bis \| Checkout Abandonné SHOPI \| B2C FR** — 🟡 DRAFT — n'a jamais envoyé (ou pas en 365 j) · 0 destinataires cumulés, 0 conv.
- **[RrYMuk] Winback - Last Cart was 2 months ago \| B2C FR** — 🟢 LIVE — tourne · 117 destinataires cumulés, 1 conv.
- **[SYA3es] 030 \| Panier Abandonné** — 🟡 DRAFT mais a tourné historiquement · 3417 destinataires cumulés, 51 conv.
- **[Tj89Zg] 030.Bis \| Panier Abandonné - Typeform** — 🟡 DRAFT mais a tourné historiquement · 283 destinataires cumulés, 16 conv.
- **[TuJa5e] 04 \| Panier Abandonné - old** — 🟡 DRAFT — n'a jamais envoyé (ou pas en 365 j) · 0 destinataires cumulés, 0 conv.
- **[W4ruD9] 04 \| Panier Abandonné** — 🟢 LIVE — tourne · 201 destinataires cumulés, 2 conv.
- **[WCcxfn] 020 \| Navigation Abandonnée \| B2C FR** — 🟢 LIVE — tourne · 6618 destinataires cumulés, 51 conv.
- **[WL5Bc6] 030 \| Panier Abandonné \| B2C EN** — 🟢 LIVE — tourne · 210 destinataires cumulés, 6 conv.
- **[YuzaSN] 040 \| Checkout Abandonné \| B2C FR** — 🟢 LIVE — tourne · 2840 destinataires cumulés, 57 conv.
