# Shopify Cart Permalinks — référence et playbook

Sources officielles :
- https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks
- https://help.shopify.com/en/manual/checkout-settings/cart-permalink

## Principe

Une URL du type

```
https://<shop>/cart/<variant_id>:<qty>[,<variant_id>:<qty>...]
```

pré-construit un cart Shopify côté serveur et redirige l'utilisateur. **Cross-device, sans cookie, sans session préalable.** C'est l'outil de choix pour nos emails d'abandon ou tout lien externe qui doit "remettre des items dans le panier de quelqu'un".

Exemple minimal :
```
https://fancypalas.com/cart/51628602491227:1,51909754585435:1
```

## Comportement par défaut — piège

Par défaut, Shopify redirige **directement vers `/checkout`** (pensé pour les liens "buy now"). Si on veut laisser l'utilisateur voir son cart avant paiement, il faut explicitement `?storefront=true`.

## Paramètres supportés (liste complète)

| Paramètre | Effet | Exemple |
|---|---|---|
| `storefront=true` | Redirige vers `/cart` au lieu de `/checkout` | `?storefront=true` |
| `discount=CODE` | Applique un code promo (virgule pour multi) | `?discount=WELCOME10` ou `?discount=SUMMER,SHIP` |
| `note=texte` | Note interne (visible admin, pas client) | `?note=abandoned_recovery_job` |
| `attributes[key]=value` | Attributs custom propagés à la commande | `?attributes[source]=abandon_email&attributes[cart_id]=abc123` |
| `ref=code` | Référence affiliation / sales channel | `?ref=palas_abandon_mailer` |
| `access_token=xxx` | Attribue à un sales channel spécifique | — |
| `payment=shop_pay` | Skip direct vers un mode de paiement | `?payment=shop_pay` |
| `properties=<base64>` | Line item properties (JSON base64url) | max 25 propriétés |
| `checkout[email]=xxx` | Pré-remplit email au checkout | `?checkout[email]=user@ex.com` |
| `checkout[shipping_address][first_name]=xxx` | Pré-remplit prénom | idem `last_name`, `address1`, `city`, etc. |
| `checkout[shipping_address][country]=FR` | Pré-remplit pays (ISO 3166-1 alpha-2) | |
| `checkout[shipping_address][zip]=75001` | Pré-remplit CP | |
| `checkout[shipping_address][province]=XX` | Pré-remplit région | |

**Limitations** :
- Max 25 `properties` line-item
- Les `checkout[...]` ne remplissent que les champs au chargement — l'utilisateur peut toujours modifier
- `attributes` sont conservés jusqu'à la commande et visibles dans l'admin Shopify / exportables via API

## Patterns pour Palas

### 1. Email d'abandon avec cart restauré (cross-device)

```
https://fancypalas.com/cart/<variant1>:<qty1>,<variant2>:<qty2>
  ?storefront=true
  &attributes[source]=abandoned_cart_email
  &attributes[internal_cart_id]=<cart_uuid_en_DB>
  &ref=palas_abandon_mailer
```

L'utilisateur atterrit sur `/cart` avec ses items. Pas de checkout forcé, il voit ce qu'il avait. Les `attributes` permettent de **mesurer la conversion de notre propre email** dans Shopify (filtre "attributes.source = abandoned_cart_email" sur les orders).

### 2. Email d'abandon avec promo personnalisée

```
https://fancypalas.com/cart/<variant1>:<qty1>
  ?storefront=true
  &discount=ABANDON10
  &attributes[source]=abandoned_email_tier_a
  &note=auto_promo_abandon_10pct
```

Le code `ABANDON10` doit exister dans Shopify Admin > Discounts. Utile pour segmenter :
- Carts > €150 → code `-15%`
- Carts < €50 → pas de code (ne pas cannibaliser la marge)
- Retour 2ème relance → code plus agressif

### 3. Newsletter welcome avec produit best-seller pré-rempli

```
https://fancypalas.com/cart/<best_seller_variant>:1
  ?storefront=true
  &discount=WELCOME
  &ref=newsletter_welcome
```

### 4. Retargeting ads avec cart préservé (pub → cart direct)

```
https://fancypalas.com/cart/<var>:1?storefront=true&attributes[source]=facebook_retarget
```

Dans l'ad URL, on inclut déjà les items consultés. Clic → cart pré-rempli → conversion accélérée.

### 5. Checkout express pour un upsell post-achat

Sans `storefront=true` → redirect direct checkout, idéal pour un email "complétez votre collection" avec paiement en 1 clic.

```
https://fancypalas.com/cart/<complementary_variant>:1
  ?checkout[email]=<customer_email>
  &discount=UPSELL20
```

## Comment obtenir les variant_id depuis nos events

Tous les events cart:* PostHog embarquent dans `properties.cart.items[]` :
- `id` = variant_id Shopify (celui à mettre dans la permalink)
- `product_id` = product_id Shopify (pas utilisable en permalink, c'est le variant_id qu'il faut)
- `quantity`
- `title`
- `price`, `original_price`, `total_discount`, `discounts[]`

Exemple extract depuis un cart snapshot :
```ts
function buildRecoveryUrl(cartItems: CartItem[], opts: {
  storefront?: boolean
  discount?: string
  attributes?: Record<string, string>
}): string {
  const parts = cartItems
    .filter((it) => it.id && it.quantity > 0)
    .map((it) => `${it.id}:${it.quantity}`)
    .join(',')
  const params = new URLSearchParams()
  if (opts.storefront) params.set('storefront', 'true')
  if (opts.discount) params.set('discount', opts.discount)
  for (const [k, v] of Object.entries(opts.attributes ?? {})) {
    params.set(`attributes[${k}]`, v)
  }
  const qs = params.toString()
  return `https://fancypalas.com/cart/${parts}${qs ? '?' + qs : ''}`
}
```

## Bundles (Marc - Bracelet & Charms Set)

Certains products sont des bundles Shopify (ex: `Marc - Bracelet & Charms Set`, variant_id `51909754585435` = 1 SKU parent qui expand en 5 sous-items Françoise + 4 Madonne Enamelled Mini). Côté permalink, il suffit d'utiliser le **variant_id du parent** — Shopify résout le bundle automatiquement à la construction du cart. Les sous-items apparaissent sur le cart page avec "Hide 5 items".

Nos events PostHog ne voient QUE le variant parent (1 ligne à €162.30) — c'est le bon comportement pour la permalink.

## Gotchas

1. **Sold-out** : si un variant est out-of-stock, Shopify affiche le cart sans cet item (silencieux). À surveiller si les emails partent après une rupture.
2. **Prix mis à jour** : le prix côté Shopify est toujours "live" au moment du clic, **pas** celui figé dans nos events. Si le produit a augmenté, l'utilisateur voit le nouveau prix → potentiel désaccord avec ce qu'il avait vu.
3. **Variant supprimé** : 404 ou item filtré. Vérifier avant envoi d'email que les variants sont toujours valides.
4. **Limite d'URL** : ~2000 caractères pratiques. Pour des carts à 20+ items distincts, shortener ou cart API server-side.
5. **Encoding** : URL-encode tout ce qui passe dans `attributes[key]=value` ou `checkout[email]`. Pas d'espace brut, accents, `&`, `#`.

## Intégration future dans Manta

Sur l'entité `cart`, ajouter :
- `recovery_url` (text nullable) — cart permalink générée au moment de l'ingest
- `recovery_url_generated_at` (timestamp) — pour audit / refresh

Au moment du `ingestCartEvent`, appeler `buildRecoveryUrl(input.items, { storefront: true, attributes: { internal_cart_id: cartId } })` et stocker. Le job d'abandon cron lira `carts.recovery_url` et poussera dans l'email.

## Tests manuels

Tester avant de déployer en email :
```bash
# Cas simple
curl -I "https://fancypalas.com/cart/51909754585435:1?storefront=true"
# Attendu: 302 Found → Location: /cart

# Cas avec discount
curl -I "https://fancypalas.com/cart/51909754585435:1?storefront=true&discount=TEST"

# Cas checkout direct
curl -I "https://fancypalas.com/cart/51909754585435:1"
# Attendu: 302 Found → Location: /checkouts/...
```

Ouvrir en onglet privé pour vérifier le comportement cross-session.
