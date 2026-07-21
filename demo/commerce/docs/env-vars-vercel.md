# Vercel environment variables — `demo/commerce`

Liste consolidée des variables à configurer dans le projet Vercel pour que
l'unsubscribe + le cron Resend + les sync sources fonctionnent en prod. Toutes
sont à mettre côté `Production` (et `Preview` si on veut tester en preview).

---

## Sécurité / signatures

| Variable | Rôle |
|----------|------|
| `UNSUBSCRIBE_SECRET` | HMAC-SHA256 secret qui signe le token RFC-8058 du lien unsubscribe dans les emails Resend. Sans ça, les liens unsubscribe ne se vérifient pas. **No TTL** sur le token — l'email peut être ouvert 6 mois plus tard, le lien doit toujours marcher. |
| `MANTA_UID_SECRET` | HMAC-SHA256 secret pour le token `manta-uid` (identification visiteur cross-device dans `/api/cart-tracking/c?u=…`). 90 jours de TTL. Si absent en prod le code throw `INVALID_STATE` au premier sign. |
| `CRON_SECRET` | Bearer token attendu sur `/api/crons/*`. Vercel Cron l'injecte automatiquement sur chaque trigger. Sans ça, n'importe qui peut faire tourner un cron en GET. |

Générer la valeur hors du dépôt, puis la stocker directement dans Vercel ou
dans le gestionnaire de secrets approuvé. Ne jamais la committer :

```dotenv
UNSUBSCRIBE_SECRET=<generate-and-store-in-secret-manager>
```

Pour générer un nouveau secret quand on en a besoin :

```bash
openssl rand -hex 32
```

---

## Resend / Email transactionnel

| Variable | Rôle |
|----------|------|
| `RESEND_API_KEY` | Clé API Resend (à récupérer sur le dashboard Resend → API Keys). Utilisée par `@mantajs/adapter-notification-resend` pour envoyer les emails. |
| `RESEND_FROM_EMAIL` | Adresse `From` par défaut. Ex : `Fancy Palas <hello@fancypalas.com>`. Le domaine doit être vérifié dans Resend (DNS SPF + DKIM). |
| `RESEND_REPLY_TO` | (Optionnel) `Reply-To` par défaut. Ex : `support@fancypalas.com`. |

---

## URLs publiques

| Variable | Rôle |
|----------|------|
| `ADMIN_BASE_URL` | Base publique du host Manta (le projet Vercel lui-même). Ex : `https://admin.fancypalas.com`. C'est la base utilisée pour construire le lien unsubscribe (`{ADMIN_BASE_URL}/api/contact/unsubscribe?t=…`). Sans ça, le lien dans l'email pointe sur `http://localhost:3000`. |
| `FRONT_BASE_URL` | URL publique de la boutique Shopify. Ex : `https://fancypalas.com`. Utilisée par les helpers de recovery URL. |
| `ALLOWED_CORS_ORIGIN` | Liste séparée par virgules des origines autorisées sur les routes publiques (`/api/cart-tracking/c`, `/api/cart-email-capture/e`). Ex : `https://fancypalas.com,https://*.fancypalas.com`. |

---

## Base de données

| Variable | Rôle |
|----------|------|
| `DATABASE_URL` | URL de la base Postgres (Neon en prod). Format : `postgresql://user:password@host/db?sslmode=require`. |

---

## Upstash Redis (cache visitor / rate limit)

| Variable | Rôle |
|----------|------|
| `UPSTASH_REDIS_REST_URL` | Endpoint Upstash REST (forme `https://<id>.upstash.io`). Le code accepte aussi `UPSTASH_REDIS_KV_REST_API_URL` (intégration Vercel KV). |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST Upstash. Idem alias `UPSTASH_REDIS_KV_REST_API_TOKEN`. |

Si les deux paires sont absentes, le cache visitor passe en no-op (la route répond toujours, juste sans cache).

---

## Klaviyo (sync events + profile resolution)

| Variable | Rôle |
|----------|------|
| `KLAVIYO_API_KEY` | Clé API privée Klaviyo (`pk_…`). Utilisée par les jobs de sync, la résolution `$exchange_id`, et le bridge Klaviyo dans `plugin-posthog-proxy`. |
| `KLAVIYO_HOST` | (Optionnel) Override de l'hôte Klaviyo. Default `https://a.klaviyo.com`. |

---

## PostHog (sync cart events + capture côté serveur)

| Variable | Rôle |
|----------|------|
| `POSTHOG_API_KEY` | Personal API Key PostHog (HogQL queries via `/api/projects/.../query/`). |
| `POSTHOG_TOKEN` | Project token PostHog (capture / identify). Public par design. **Requis en prod** : utilisé en plus du capture browser pour l'event `manta_abandoned_cart_sent` émis par le cron Resend après chaque envoi (analytics + funnels + debugging). Sans ce token, le cron continue d'envoyer mais l'event PostHog est silencieusement skippé. |
| `POSTHOG_HOST` | (Optionnel) Hôte PostHog. Default `https://us.posthog.com`. |

---

## Shopify (sync customers + customer lookup)

| Variable | Rôle |
|----------|------|
| `SHOPIFY_ADMIN_STORE` | Sous-domaine `*.myshopify.com` du store. |
| `SHOPIFY_SHOP_DOMAIN` | Domaine Admin API approuvé pour la publication catalogue : `fancy-palas.myshopify.com`. Une autre cible est refusée. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Admin API access token (custom app). |
| `SHOPIFY_ADMIN_API_VERSION` | (Optionnel) Version API Shopify, ex : `2025-01`. Default codé dans les helpers. |
| `SHOPIFY_CATALOG_WRITES_ENABLED` | Kill switch catalogue. Les écritures sont bloquées sauf si la valeur est exactement `true` **et** que le runtime est Production. Ne jamais activer sur Preview. |
| `SHOPIFY_CATALOG_PUBLICATION_ID` | Publication Shopify approuvée des collections miroir PALAS : `gid://shopify/Publication/234170581339`. L’ID fait partie du fingerprint d’audit et une autre cible est refusée. |

---

## Récap minimum pour faire tourner unsubscribe + relance panier

```dotenv
UNSUBSCRIBE_SECRET=<generate-and-store-in-secret-manager>
RESEND_API_KEY=<from Resend dashboard>
RESEND_FROM_EMAIL=Fancy Palas <hello@fancypalas.com>
ADMIN_BASE_URL=https://admin.fancypalas.com
CRON_SECRET=<openssl rand -hex 32>
DATABASE_URL=<Neon prod connection string>
```

Le reste (Klaviyo / PostHog / Shopify / Upstash) est nécessaire pour les
autres workflows (sync, identify visiteur) mais pas pour la relance Resend
elle-même.
