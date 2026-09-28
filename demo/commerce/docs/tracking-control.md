# Contrôle des destinations

Les pages `/tracking-health/meta`, `/tracking-health/google-ads`,
`/tracking-health/pinterest` et `/tracking-health/ga4` sont des outils de lecture
réservés aux administrateurs. Le dashboard et Tracking Health gardent leur comportement.

## Lire les chiffres

- **Réception CRM** : événements reçus dans `[début, fin)`, avec leur statut actuel.
  Un événement compte une fois par destination, même après plusieurs tentatives.
- **Envois dans la période** : sélection sur l'heure du dernier succès enregistrée
  dans `sent_at`. Un événement reçu avant la période peut y figurer.
- **Plateforme** : données relues auprès de la destination. Chaque section précise
  son périmètre, sa période effective quand elle est disponible, et ses limites.
  Une donnée inaccessible est inconnue, jamais zéro.
- **Publicité** : attribution publicitaire indépendante de la réception technique.
  Un événement reçu ne devient pas nécessairement une conversion attribuée.

Les noms des connecteurs peuvent regrouper plusieurs événements CRM : comparer
un seul total `ViewContent` à la somme des événements correspondants, pas à chaque
ligne séparément. Même une égalité ne prouve pas une correspondance événement par
événement. D'autres intégrations peuvent envoyer au même pixel ou à la même propriété.

Les détails existants sont allégés après 24 heures. Ce changement ne crée aucune
table, aucun journal supplémentaire et ne change pas la rétention. Le rafraîchissement
est manuel ; aucune nouvelle tâche planifiée n'appelle les plateformes.

## Accès de lecture

Les secrets restent dans l'environnement serveur Vercel, jamais dans le navigateur.
Un token d'envoi ne prouve pas que son détenteur peut lire les statistiques.

| Destination | Configuration de lecture |
| --- | --- |
| Meta | `META_PIXEL_ID`, version existante, `META_READ_ACCESS_TOKEN` facultatif (sinon token CAPI existant). Autoriser les statistiques du pixel et Dataset Quality. `META_AD_ACCOUNT_ID` active la lecture publicitaire facultative. |
| Google Ads | Identifiants OAuth existants `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, compte `GOOGLE_ADS_CUSTOMER_ID`. Le token doit pouvoir lire Data Manager. |
| Pinterest | `PINTEREST_AD_ACCOUNT_ID` et `PINTEREST_ACCESS_TOKEN` existants, avec accès `ads:read`. |
| GA4 | `GA4_PROPERTY_ID` numérique et accès Data API en lecture. Les paramètres Measurement Protocol `GA4_MEASUREMENT_ID` et `GA4_API_SECRET` ne donnent pas cet accès. Voir les variables de lecture indiquées dans la page. |

Les modes affichés sont ceux configurés **maintenant**. Ils ne permettent pas de
reconstituer le mode utilisé par une ancienne requête. Pour GA4 en particulier,
un succès HTTP du validateur ne prouve pas une collecte dans les rapports.

## Validation après déploiement

Ouvrir chaque page avec un compte administrateur. Vérifier les IDs affichés, puis
une période de 7 heures et une période personnalisée. Les traces locales doivent
rester accessibles même si une plateforme refuse la lecture. Vérifier les droits
manquants dans la section distante, sans renouveler les tokens d'envoi par défaut.
Comparer les noms, périodes, fuseaux et sources avant d'interpréter un écart.

Un refus de lecture ne nécessite pas de rejouer les événements. Aucun bouton de
ces pages n'envoie, ne rejoue ou ne modifie les événements.

## Signal : décision de stockage distincte

Recommandation pour un travail ultérieur, non activée dans le CRM : conserver des
reçus compacts séparés des événements métier. Chaque reçu porte `event_id`,
destination, identifiant de tentative, date, état, code d'erreur et identifiant de
requête fournisseur, sans recopier le payload client. Une interrogation d'API est
une observation distincte avec sa date et son périmètre ; un agrégat distant ne
doit jamais marquer tous les événements individuels comme confirmés.

PostHog documente un modèle d'événements immuable. Une observation peut être
envoyée comme nouvel événement technique, liée à l'événement métier par son ID,
sans modifier celui-ci. La capture supplémentaire compte dans le volume ingéré :
ce n'est pas un stockage gratuit. Une rétention de sept jours et des agrégats
horaires doivent être vérifiés selon l'offre et les mécanismes de rétention,
pas supposés disponibles par type d'événement.

PostgreSQL peut également stocker ces petits reçus pendant une semaine. Le choix
entre une table opérationnelle bornée et un stockage analytique dépend du nombre
d'événements, des destinations, des tentatives et des lectures. Estimation de
volume : événements/jour × destinations × observations × jours × taille du reçu,
à laquelle s'ajoutent index et coûts d'exploitation. Mesurer avant d'introduire
une base supplémentaire. Garder les observations techniques hors des conversions
et des volumes métier, et leur donner des IDs idempotents pour éviter les doublons.

Sources : [modèle PostHog](https://posthog.com/docs/cdp/batch-exports),
[Meta](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/signals/signals-health-dashboard.md),
[Data Manager](https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve),
[Pinterest](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml),
[GA4](https://developers.google.com/analytics/devguides/reporting/data/v1).
