# Activer Pinterest et Google Ads dans le CRM Palas

Cette procédure concerne le CRM (`palas-admin` / `admin.fancypalas.com`), pas Signal. Déployer la branche validée via Git/Vercel avant activation. Aucun envoi réel n'a été effectué pendant le développement. Les emails et événements internes des paniers abandonnés restent dans le CRM.

## Pinterest

Dans Pinterest Ads Manager, générer le token Conversions API du compte publicitaire (Conversions > Conversions API). Dans Vercel, projet `palas-admin`, environnement Production, ajouter :

| Variable | Valeur |
| --- | --- |
| `PINTEREST_AD_ACCOUNT_ID` | ID numérique du compte publicitaire, pas l'ID du tag |
| `PINTEREST_ACCESS_TOKEN` | Token Conversions API autorisé sur ce compte |
| `PINTEREST_TEST_MODE` | `true` pour la première validation, puis `false` pour le réel |

Les événements pris en charge sont `page_view`, `view_item`, `view_item_list`, `search`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase`. Un achat devient `checkout` chez Pinterest. L'identifiant `epik` est conservé quand il est présent. Le rapprochement exige un email haché ou le couple IP + user-agent : un identifiant de clic seul ne suffit pas.

Les clés seules ne garantissent pas la réception : il faut aussi un événement valide, le consentement publicitaire et le déploiement de ce code. Le cron reprend les envois chaque minute. Il n'y a pas de reprise générale des anciens événements pour Pinterest.

## Google : préparer l'accès une fois

1. Créer ou choisir le projet Google Cloud et activer **Data Manager API**.
2. Dans Google Auth Platform, renseigner Branding et ajouter le scope `https://www.googleapis.com/auth/datamanager` dans Data Access.
3. Audience : pour ce pilote personnel, choisir External et passer le statut de publication à **In production**. Ce statut OAuth n'est pas une publication dans un store. Si vous restez en Testing, ajouter votre compte aux utilisateurs de test et refaire l'autorisation tous les sept jours.
4. Créer un client OAuth **Desktop app**, télécharger son JSON hors du dépôt et limiter ses droits de lecture. Le compte Google autorisant la connexion doit avoir accès au compte Google Ads cible (directement ou via son compte administrateur).
5. Sur l'ordinateur qui ouvre le navigateur, depuis la racine du dépôt, lancer :

```sh
node demo/commerce/scripts/google-ads-oauth.mjs \
  --credentials /chemin-prive/desktop-client.json \
  --output /chemin-prive/.env.google-ads
```

Ouvrir le lien affiché, autoriser l'accès. Le callback écoute uniquement sur `127.0.0.1`. Le fichier de sortie est créé avec des droits `0600` et contient le client ID, client secret et refresh token. Aucun secret n'est affiché et aucun événement n'est envoyé. Ne pas coller ces valeurs dans Git, une PR ou un terminal partagé.

**Pour éviter les sept jours**, passer en In production **puis refaire cette autorisation** avec un nouveau chemin de sortie pour obtenir un nouveau refresh token. Les applications à usage personnel ou avec quelques utilisateurs connus peuvent relever de l'exception de vérification ; l'avertissement « application non vérifiée » peut rester. La vérification OAuth de Signal public sera un travail distinct. Un refresh token reste révocable : ce n'est pas une garantie de durée illimitée.

## Google : compte et actions de conversion

Pour ce pilote serveur, créer/configurer une action de type **`UPLOAD_CLICKS`**, dont la source affichée dans Google Ads est **Website (Import from clicks)**. Le compte destinataire doit être celui qui possède l'action. Une action importée depuis GA4 ne remplace pas cette action. Vérifier les conditions d'utilisation des données clients et le paramétrage des conversions améliorées si l'on utilise des identifiants hachés. Relever l'ID numérique de l'action, pas son libellé. [Contrat Google officiel](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events)

| Variable Vercel Production | Valeur |
| --- | --- |
| `GOOGLE_ADS_CLIENT_ID` | Fichier OAuth privé |
| `GOOGLE_ADS_CLIENT_SECRET` | Fichier OAuth privé |
| `GOOGLE_ADS_REFRESH_TOKEN` | Fichier OAuth privé, scope Data Manager |
| `GOOGLE_ADS_CUSTOMER_ID` | Compte Google Ads destinataire (tirets acceptés) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Facultatif : compte administrateur utilisé pour accéder au compte cible |
| `GOOGLE_ADS_VALIDATE_ONLY` | `true` d'abord, `false` après validation |

Les six actions Palas sont configurées dans `src/modules/event-hub/google-ads-connector.ts`. Aucune variable d'action n'est nécessaire dans Vercel après déploiement de ce code.

| Événement du site / nom de l'action | Événement canonique | ID Google Ads | Surcharge facultative |
| --- | --- | --- | --- |
| `cart:product_added` | `add_to_cart` | `7795313739` | `GOOGLE_ADS_ADD_TO_CART_CONVERSION_ACTION_ID` |
| `checkout:started` | `begin_checkout` | `7795331743` | `GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION_ACTION_ID` |
| `checkout:contact_info_submitted` | `add_contact_info` | `7795191722` | `GOOGLE_ADS_LEAD_CONVERSION_ACTION_ID` |
| `checkout:shipping_info_submitted` | `add_shipping_info` | `7795323285` | `GOOGLE_ADS_ADD_SHIPPING_INFO_CONVERSION_ACTION_ID` |
| `checkout:payment_info_submitted` | `add_payment_info` | `7795326363` | `GOOGLE_ADS_ADD_PAYMENT_INFO_CONVERSION_ACTION_ID` |
| `checkout:completed` | `purchase` | `7795320871` | `GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID` |

Ces IDs non secrets ont été fournis lors de la configuration du 25 septembre 2026. Pour le paiement, le lien fourni affichait le numéro des coordonnées dans son texte, mais sa destination contenait bien `ctId=7795326363`. Le panier a été associé au premier lien donné dans la séquence de création ; les noms des actions n'ont pas été relus dans le compte Google authentifié.

Les variables d'action existantes restent prioritaires : les retirer si l'on veut utiliser uniquement le mapping du code. Une surcharge non vide mais invalide bloque l'événement au lieu de choisir silencieusement une action Palas. L'alias `GOOGLE_ADS_ADD_CONTACT_INFO_CONVERSION_ACTION_ID` reste accepté. Pour un autre compte Google Ads, fournir les six IDs appartenant à ce compte ; les IDs Palas ne sont pas portables. Les secrets OAuth et le compte destinataire restent obligatoires dans l'environnement. Aucun developer token n'est requis par ce connecteur Data Manager. Supprimer d'anciens overrides `GOOGLE_ADS_ENDPOINT` / `GOOGLE_OAUTH_TOKEN_ENDPOINT` pour utiliser les origines officielles par défaut.

Les anciens payloads Google non envoyés sont remappés, par lots bornés, à partir de l'événement canonique encore conservé. Les reçus envoyés, les validations de test et les envois en cours ne sont pas rouverts. Un événement dont la source a été compactée ne peut pas être reconstruit.

## Validation, puis envoi réel

Toute modification des variables Vercel exige un nouveau déploiement utilisant ces valeurs. Respecter le déploiement Git du projet ; ne pas lancer de `vercel deploy` local.

1. Déployer avec les deux modes de test activés.
2. Produire un événement de test consenti et identifiable depuis la boutique. Dans Tracking health, vérifier la colonne Pinterest/Google et le statut **Test validé**. Ce statut signifie validation de la requête, pas conversion publicitaire enregistrée.
3. Corriger les éventuelles erreurs de configuration, de données ou de consentement. Le pixel Shopify checkout doit transmettre les consentements réels. Le problème de consentement achat identifié précédemment peut bloquer aussi Pinterest/Google ; les connecteurs ne le contournent pas.
4. Passer les flags à `false`, redéployer, puis vérifier un nouvel achat réel. **Accepté API** signifie que l'API a accepté l'envoi ; cela ne prouve pas l'attribution à une publicité. Pour un test complet Google, utiliser une visite issue d'une annonce et vérifier la conversion dans Google Ads après traitement.
5. Google conserve le `request_id` du reçu : contrôler le traitement asynchrone avec le script ci-dessous, puis l'attribution dans Google Ads. Pinterest expose son résultat par événement ; vérifier aussi Events Manager.

```sh
node --env-file=/chemin-prive/.env.google-ads \
  demo/commerce/scripts/google-ads-diagnostics.mjs --request-id ID_DU_RECU
```

Le script n'envoie aucun événement et masque les données de rapprochement. Un statut `PROCESSING` demande une nouvelle lecture plus tard ; `FAILED` / `PARTIAL_SUCCESS` demande de traiter les raisons retournées.

Les événements **Test validé** ne repartent pas automatiquement quand les flags changent. Si un véritable achat validé doit finalement être envoyé, utiliser la commande admin `requeueValidatedAdDispatches` avec `{ "destination": "pinterest", "eventIds": ["ID_EXACT"] }` (ou `google_ads`), après avoir vérifié le mode et la légitimité des IDs. Maximum 20 IDs par demande ; le cron assure l'envoi. Ne pas reprendre de faux achats en réel. Les payloads de validation restent conservés pour cette reprise explicite.

## Arrêt et migration Signal

Pour suspendre un connecteur, retirer son token/refresh token de l'environnement actif puis redéployer ; la file reste conservée. Une révocation côté régie coupe aussi les accès. Au passage à Signal, attribuer chaque destination à un seul système émetteur avant activation. Conserver les paniers abandonnés dans le CRM jusqu'au remplacement prévu.

## Références officielles

- [Pinterest Conversions API](https://dev.pinterest.com/docs/track-conversions/track-conversions-in-the-api/)
- [Google Data Manager : accès et OAuth](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access)
- [Expiration des refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Exceptions à la vérification OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification#exceptions_to_verification_requirements)
- [Diagnostic d'une requête Data Manager](https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve)
