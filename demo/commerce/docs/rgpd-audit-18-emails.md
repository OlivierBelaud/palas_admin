# Audit identification 18 emails — Fancypalas

*Généré le 2026-04-22. Source locale : `postgresql://localhost/commerce`. Sources distantes : PostHog EU (eu.i.posthog.com), Klaviyo API, DataWarehouse Shopify synchronisé via PostHog.*

## Légende des buckets

| Bucket | Signification |
|---|---|
| 🟢 **GREEN** | Cart présent dans Manta local + PostHog + Shopify + Klaviyo — cas sain |
| 🟠 **ORANGE** | Identifié par PostHog avec KLA_ID, mais pas de cart Manta — visiteur/leads propre |
| 🟡 **YELLOW** | Identifié PostHog via $identify checkout, sans cookie Klaviyo |
| 🔴 **RED** | Shopify + Klaviyo le connaissent, **0 event PostHog** — probable leak cross-store |

## Tableau synthèse

| Email | 🪣 | Manta cart | PH events | PV | KLA_ID | Shopify | Shop-orders | Shop-abnd | Klaviyo consent | Sent/Open/Click |
|---|---|---|---:|---:|:---:|:---:|---:|---:|---|---|
| `aureli112@hotmail.com` | 🔴 | — | 0 | 0 | — | ✅ | 1 | 0 | — | 1/1/0 |
| `lereboursj@gmail.com` | 🔴 | — | 0 | 0 | — | ✅ | 1 | 0 | Klaviyo Form (YuFpT5) | 3/4/1 |
| `doudounet2@free.fr` | 🟡 | — | 1 | 0 | — | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 2/0/0 |
| `ijfowler@aol.com` | 🟡 | ✅ completed | 11 | 0 | — | ✅ | 1 | 0 | — | 0/0/0 |
| `arenavi77@outlook.com` | 🟠 | — | 26 | 3 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 1/0/0 |
| `barti13@live.fr` | 🟠 | — | 6 | 0 | ✅ | ✅ | 1 | 0 | Klaviyo Form (YuFpT5) | 18/0/0 |
| `brigitte170960@outlook.fr` | 🟠 | — | 8 | 1 | ✅ | ✅ 🛍️ | 1 | 0 | Klaviyo Form (YuFpT5) | 156/55/21 |
| `christianefourcadeb@gmail.com` | 🟠 | — | 53 | 7 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 2/2/2 |
| `doloresqueron@gmail.com` | 🟠 | — | 41 | 6 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 2/0/0 |
| `fabienneclanet@yahoo.fr` | 🟠 | — | 67 | 6 | ✅ | ✅ | 1 | 0 | Klaviyo Form (R7f72x) | 1/1/0 |
| `rodine.younes@gmail.com` | 🟠 | — | 41 | 15 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 8/4/0 |
| `tiffanylps@hotmail.fr` | 🟠 | — | 4 | 0 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 42/8/0 |
| `valeriechemin35@gmail.com` | 🟠 | — | 16 | 2 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 48/37/0 |
| `barbara.socrate@gmail.com` | 🟢 | ✅ active | 30 | 5 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 3/3/0 |
| `carriestephanie27@gmail.com` | 🟢 | ✅ active | 33 | 4 | ✅ | ✅ | 0 | 0 | — | 15/9/5 |
| `isa.morin003@gmail.com` | 🟢 | ✅ completed | 105 | 8 | ✅ | ✅ | 3 | 0 | Klaviyo Form (R7f72x) | 86/42/6 |
| `justinecottyt@gmail.com` | 🟢 | ✅ active | 107 | 19 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 2/0/0 |
| `perrineansel@laposte.net` | 🟢 | ✅ active | 224 | 38 | ✅ | ✅ | 0 | 0 | Klaviyo Form (YuFpT5) | 203/30/10 |

*🛍️ = tag Shopify 'Login with Shop' détecté (cross-store Shop Pay network)*

## Détail par email

### 🔴 `aureli112@hotmail.com`

**Bucket** : RED — Shopify+Klaviyo only — 0 event PostHog (leak candidat)

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- ❌ **Aucun event PostHog jamais observé**

**Shopify**
- Customer : `gid://shopify/Customer/10505246671195`
- Created : `2026-04-14T16:37:24`  /  Orders : **1**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `SINGLE_OPT_IN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KP6DNPTW94A7Q0R89V91T92T`
- Consent method : `(empty)`  /  form id : `—`
- Consent timestamp : `2026-04-14T16:37:26`
- Emails reçus : **1** — Ouverts : 1 — Cliqués : 0

---

### 🔴 `lereboursj@gmail.com`

**Bucket** : RED — Shopify+Klaviyo only — 0 event PostHog (leak candidat)

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- ❌ **Aucun event PostHog jamais observé**

**Shopify**
- Customer : `gid://shopify/Customer/10375353663835`
- Created : `2026-03-21T20:34:38`  /  Orders : **1**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KM91PPNQGS0C19KEJ2WVRZE7`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-03-21T20:34:36`
- Emails reçus : **3** — Ouverts : 4 — Cliqués : 1

---

### 🟡 `doudounet2@free.fr`

**Bucket** : YELLOW — Identifié PostHog via checkout, pas de cookie Klaviyo

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 1  (pageviews 0, $identify 1, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ❌ absent
- First seen : 2026-04-21T12:59:13
- Last seen : 2026-04-21T12:59:13

**Shopify**
- Customer : `gid://shopify/Customer/10533992399195`
- Created : `2026-04-21T12:58:14`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPR1X7PYABD88WYRW9F7QQK1`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-21T12:58:10`
- Emails reçus : **2** — Ouverts : 0 — Cliqués : 0

---

### 🟡 `ijfowler@aol.com`

**Bucket** : YELLOW — Identifié PostHog via checkout, pas de cookie Klaviyo

**Manta (DB locale)**
- Cart : `64494e83-7123-4a08-9e50-9a398e0e1ae3`  token=`hWNBHYSYoLFWaT4LlE41…`
- Status : `completed` / stage `completed` / last action `2026-04-21 15:49:59.874+01`
- Cart events : 0

**PostHog** (events 180j)
- Total events : 11  (pageviews 0, $identify 2, cart/checkout 8)
- Cookie Klaviyo ($kla_id) : ❌ absent
- First seen : 2026-04-21T14:43:26
- Last seen : 2026-04-21T14:51:13

**Shopify**
- Customer : `gid://shopify/Customer/10534246547803`
- Created : `2026-04-21T14:49:13`  /  Orders : **1**  /  Abandoned checkouts : **0**
- Marketing state : `NOT_SUBSCRIBED` / opt-in level : `SINGLE_OPT_IN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPR7Y09KGD6X0HYRQP9Y9Q1W`
- Consent method : `(empty)`  /  form id : `—`
- Consent timestamp : `—`
- Emails reçus : **0** — Ouverts : 0 — Cliqués : 0

---

### 🟠 `arenavi77@outlook.com`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 26  (pageviews 3, $identify 7, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-20T19:20:48
- Last seen : 2026-04-20T19:22:27

**Shopify**
- Customer : `gid://shopify/Customer/10530530885979`
- Created : `2026-04-20T19:21:53`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPP5CSWECQ6DW5G11TTP6VBN`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-20T19:20:37`
- Emails reçus : **1** — Ouverts : 0 — Cliqués : 0

---

### 🟠 `barti13@live.fr`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 6  (pageviews 0, $identify 3, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-21T18:05:05
- Last seen : 2026-04-21T18:05:53

**Shopify**
- Customer : `gid://shopify/Customer/10302751539547`
- Created : `2026-03-10T16:06:56`  /  Orders : **1**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KKC80D19Q2W73VWNKH5T575T`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-03-11T12:43:20`
- Emails reçus : **18** — Ouverts : 0 — Cliqués : 0

---

### 🟠 `brigitte170960@outlook.fr`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 8  (pageviews 1, $identify 1, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-21T07:54:34
- Last seen : 2026-04-21T07:55:14

**Shopify**
- Customer : `gid://shopify/Customer/9610070393179`
- Created : `2025-09-30T07:58:03`  /  Orders : **1**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `SINGLE_OPT_IN`
- Tags : `["Login with Shop","Shop"]`

**Klaviyo**
- Profile ID : `01K6CSA1JXXPTYVK67B8Z63VV7`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-21T07:54:28`
- Emails reçus : **156** — Ouverts : 55 — Cliqués : 21

---

### 🟠 `christianefourcadeb@gmail.com`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 53  (pageviews 7, $identify 10, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-21T14:10:17
- Last seen : 2026-04-22T16:21:07

**Shopify**
- Customer : `gid://shopify/Customer/10534159745371`
- Created : `2026-04-21T14:10:24`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPR616R3K59D2V5TR4T7TPAK`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-21T14:10:15`
- Emails reçus : **2** — Ouverts : 2 — Cliqués : 2

---

### 🟠 `doloresqueron@gmail.com`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 41  (pageviews 6, $identify 7, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-20T20:31:44
- Last seen : 2026-04-20T20:34:42

**Shopify**
- Customer : `gid://shopify/Customer/10530720907611`
- Created : `2026-04-20T20:33:39`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPP9EWRXGXJYEZ2PBKE90R0J`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-20T20:31:41`
- Emails reçus : **2** — Ouverts : 0 — Cliqués : 0

---

### 🟠 `fabienneclanet@yahoo.fr`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 67  (pageviews 6, $identify 16, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-22T11:08:24
- Last seen : 2026-04-22T13:02:07

**Shopify**
- Customer : `gid://shopify/Customer/10504824586587`
- Created : `2026-04-14T13:45:39`  /  Orders : **1**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KP63V1MVR2ZNAHF5HSPSE5YH`
- Consent method : `Klaviyo Form`  /  form id : `R7f72x`
- Consent timestamp : `2026-04-14T13:45:36`
- Emails reçus : **1** — Ouverts : 1 — Cliqués : 0

---

### 🟠 `rodine.younes@gmail.com`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 41  (pageviews 15, $identify 20, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-16T16:27:56
- Last seen : 2026-04-22T19:09:39

**Shopify**
- Customer : `gid://shopify/Customer/10507436949851`
- Created : `2026-04-15T10:36:05`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KP8BCQ1JAA8AJJN8SZQ03X3J`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-15T10:36:04`
- Emails reçus : **8** — Ouverts : 4 — Cliqués : 0

---

### 🟠 `tiffanylps@hotmail.fr`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 4  (pageviews 0, $identify 2, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-21T09:50:39
- Last seen : 2026-04-21T09:50:55

**Shopify**
- Customer : `gid://shopify/Customer/10390748954971`
- Created : `2026-03-25T11:48:36`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KMJD67NGBTB1ERZK2VPKWBRV`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-03-25T11:48:29`
- Emails reçus : **42** — Ouverts : 8 — Cliqués : 0

---

### 🟠 `valeriechemin35@gmail.com`

**Bucket** : ORANGE — Vu par PostHog + KLA_ID mais pas dans Manta local

**Manta (DB locale)**
- ❌ Aucun cart trouvé dans la DB locale

**PostHog** (events 180j)
- Total events : 16  (pageviews 2, $identify 6, cart/checkout 0)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-21T18:51:54
- Last seen : 2026-04-21T18:54:57

**Shopify**
- Customer : `gid://shopify/Customer/10296828920155`
- Created : `2026-03-08T21:06:13`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KK7MB150BDPSNJV2XNVMYZS5`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-21T18:51:39`
- Emails reçus : **48** — Ouverts : 37 — Cliqués : 0

---

### 🟢 `barbara.socrate@gmail.com`

**Bucket** : GREEN — Connu dans tous les systèmes, cart Manta présent

**Manta (DB locale)**
- Cart : `f3080a5a-5369-4af9-8bcd-0a9cbff6cb9c`  token=`hWNBFBuFoi2bPpepUJk5…`
- Status : `active` / stage `cart` / last action `2026-04-20 14:52:48.887+01`
- Cart events : 0

**PostHog** (events 180j)
- Total events : 30  (pageviews 5, $identify 5, cart/checkout 2)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-20T13:51:30
- Last seen : 2026-04-20T13:53:01

**Shopify**
- Customer : `gid://shopify/Customer/10529535426907`
- Created : `2026-04-20T13:51:14`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPNJHKRNHH1FNDR18QSRX43W`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-20T13:51:12`
- Emails reçus : **3** — Ouverts : 3 — Cliqués : 0

---

### 🟢 `carriestephanie27@gmail.com`

**Bucket** : GREEN — Connu dans tous les systèmes, cart Manta présent

**Manta (DB locale)**
- Cart : `48ae6a88-1459-40e4-813b-17ca2d2464f6`  token=`hWNAUrd9r4gXO6AUNSWp…`
- Status : `active` / stage `cart` / last action `2026-04-17 17:46:42.712+01`
- Cart events : 0

**PostHog** (events 180j)
- Total events : 33  (pageviews 4, $identify 7, cart/checkout 4)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-17T16:46:04
- Last seen : 2026-04-21T19:17:21

**Shopify**
- Customer : `gid://shopify/Customer/10450815648091`
- Created : `2026-03-31T21:27:24`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `SINGLE_OPT_IN`
- Tags : `["newsletter","prospect"]`

**Klaviyo**
- Profile ID : `01KN2WPMTEY6XDZBNT3J8ETPX6`
- Consent method : `(empty)`  /  form id : `—`
- Consent timestamp : `2026-04-12T09:49:31`
- Emails reçus : **15** — Ouverts : 9 — Cliqués : 5

---

### 🟢 `isa.morin003@gmail.com`

**Bucket** : GREEN — Connu dans tous les systèmes, cart Manta présent

**Manta (DB locale)**
- Cart : `a54e2fe1-9808-49db-a952-000f2b37b9ce`  token=`hWNBFEiyvzd7gMss3uK7…`
- Status : `completed` / stage `completed` / last action `2026-04-22 11:18:17.402+01`
- Cart events : 0

**PostHog** (events 180j)
- Total events : 105  (pageviews 8, $identify 19, cart/checkout 20)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-20T14:19:02
- Last seen : 2026-04-22T10:18:47

**Shopify**
- Customer : `gid://shopify/Customer/8022315270491`
- Created : `2024-04-25T07:26:37`  /  Orders : **3**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPNM4BTS30KH983Y2AKRPX1J`
- Consent method : `Klaviyo Form`  /  form id : `R7f72x`
- Consent timestamp : `2026-04-20T14:18:55`
- Emails reçus : **86** — Ouverts : 42 — Cliqués : 6

---

### 🟢 `justinecottyt@gmail.com`

**Bucket** : GREEN — Connu dans tous les systèmes, cart Manta présent

**Manta (DB locale)**
- Cart : `6caac21c-77e2-46aa-828c-6afb88484fc2`  token=`hWNBJCQIvph9ucwJ6UN1…`
- Status : `active` / stage `cart` / last action `2026-04-22 07:44:53.577+01`
- Cart events : 0

**PostHog** (events 180j)
- Total events : 107  (pageviews 19, $identify 12, cart/checkout 8)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-22T06:43:50
- Last seen : 2026-04-22T19:13:50

**Shopify**
- Customer : `gid://shopify/Customer/10536016445787`
- Created : `2026-04-22T06:43:47`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01KPSYWCP255ENQMBV5DH5N9TY`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2026-04-22T06:43:46`
- Emails reçus : **2** — Ouverts : 0 — Cliqués : 0

---

### 🟢 `perrineansel@laposte.net`

**Bucket** : GREEN — Connu dans tous les systèmes, cart Manta présent

**Manta (DB locale)**
- Cart : `79bccb4e-515f-4796-b08e-87551445e7a2`  token=`hWNBJcCHHgvbogDo3lUJ…`
- Status : `active` / stage `cart` / last action `2026-04-22 12:25:33.518+01`
- Cart events : 0

**PostHog** (events 180j)
- Total events : 224  (pageviews 38, $identify 25, cart/checkout 9)
- Cookie Klaviyo ($kla_id) : ✅ présent
- First seen : 2026-04-22T10:57:49
- Last seen : 2026-04-22T19:58:51

**Shopify**
- Customer : `gid://shopify/Customer/9403893776731`
- Created : `2025-07-21T10:52:50`  /  Orders : **0**  /  Abandoned checkouts : **0**
- Marketing state : `SUBSCRIBED` / opt-in level : `UNKNOWN`
- Tags : `[]`

**Klaviyo**
- Profile ID : `01K0P9TSXBACT9KY7DHYMRWEWV`
- Consent method : `Klaviyo Form`  /  form id : `YuFpT5`
- Consent timestamp : `2025-07-21T10:52:50`
- Emails reçus : **203** — Ouverts : 30 — Cliqués : 10

---

## Focus — personnes pas dans Manta : visiteurs ou carts fantômes ?

Pour chaque email absent de notre DB locale (`carts`), on distingue :
- **Visiteur** : PostHog a des pageviews mais aucun cart:* event
- **Cart fantôme** : cart events PostHog OU abandoned checkout Shopify — un panier existe quelque part mais on ne l'a pas localement
- **Pur leak** : aucune trace PostHog du tout, mais Shopify/Klaviyo le connaît

| Email | PH pageviews | PH cart events | Shopify abandoned | Shopify orders | → Classification |
|---|---:|---:|---:|---:|---|
| `arenavi77@outlook.com` | 3 | 0 | 0 | 0 | 🟢 Pur visiteur (a browsé, aucun cart) |
| `aureli112@hotmail.com` | 0 | 0 | 0 | 1 | 🔴 **Pur leak** (Shopify only, jamais vu) |
| `barti13@live.fr` | 0 | 0 | 0 | 1 | 🟠 Commande sans passage sur site tracké |
| `brigitte170960@outlook.fr` | 1 | 0 | 0 | 1 | 🟢 Pur visiteur (a browsé, aucun cart) |
| `christianefourcadeb@gmail.com` | 7 | 0 | 0 | 0 | 🟢 Pur visiteur (a browsé, aucun cart) |
| `doloresqueron@gmail.com` | 6 | 0 | 0 | 0 | 🟢 Pur visiteur (a browsé, aucun cart) |
| `doudounet2@free.fr` | 0 | 0 | 0 | 0 | — |
| `fabienneclanet@yahoo.fr` | 6 | 0 | 0 | 1 | 🟢 Pur visiteur (a browsé, aucun cart) |
| `lereboursj@gmail.com` | 0 | 0 | 0 | 1 | 🔴 **Pur leak** (Shopify only, jamais vu) |
| `rodine.younes@gmail.com` | 15 | 0 | 0 | 0 | 🟢 Pur visiteur (a browsé, aucun cart) |
| `tiffanylps@hotmail.fr` | 0 | 0 | 0 | 0 | — |
| `valeriechemin35@gmail.com` | 2 | 0 | 0 | 0 | 🟢 Pur visiteur (a browsé, aucun cart) |

## Synthèse stratégique

- 🟢 **5** cas sains (cart Manta + tous systèmes)
- 🟠 **9** visiteurs identifiés KLA_ID sans cart
- 🟡 **2** identifiés PostHog via checkout sans cookie Klaviyo
- 🔴 **2** *pur leak* Shopify/Klaviyo — jamais vus côté PostHog

### Ce qu'il manque pour fermer la boucle

1. **Webhook Shopify `customers/create`** (Settings → Notifications → Webhooks, gratuit sur tous les plans) → capter chaque customer créé avec ses metadata consent (`marketing_opt_in_level`, `tags`, `source_name`) + sa source réelle.
2. **Shopify Custom Pixel** (Settings → Customer events) → poser un bridge browser-side entre `_shopify_y` / `shopify_clientId` et notre distinct_id PostHog. Dès qu'un user fait `checkout_contact_info_submitted` sur le site, on scelle la correspondance email ↔ distinct_id — plus aucun leak cross-store ne peut passer inaperçu.
3. **Flag RGPD côté ingestion** : tout profil Klaviyo avec `consent_method = SHOPIFY Customer Webhook` OU `opt_in_level = UNKNOWN` doit être marqué non-mailable tant qu'aucune action client-side n'a été enregistrée.