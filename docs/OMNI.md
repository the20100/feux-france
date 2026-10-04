# OMNI — exploitation, données et limites

## Ce qui est livré

- `/` : vue globale ; `/feux` : poste FEUX existant ; `/pandemic` : hantavirus et veille peste ; `/war` : sept théâtres.
- Cartes, filtres, dossier source, chronologie UTC, historique des versions, état des collectes. Les filtres/périodes sont dans les URL ; le dernier contexte de chaque panneau et la caméra restent dans la session du navigateur.
- OMS : 100 derniers Disease Outbreak News, filtrés sur les maladies suivies. ReliefWeb : 20 dernières publications par dossier. Ce sont des fenêtres de collecte, **pas des historiques exhaustifs**. Les publications déjà acquises restent conservées.
- VIINA : contrôle territorial évalué en Ukraine, dernier relevé disponible + relevés les plus proches de J−7 et J−30, puis accumulation quotidienne. Au 4 octobre 2026, dernier relevé réellement trouvé : **29 septembre**, jamais présenté comme un relevé du 4 octobre.
- Les autres théâtres ont des publications humanitaires ; leurs territoires ne sont pas renseignés tant qu’aucune source autorisée n’a été intégrée.
- FEUX conserve son historique et ses routes API. Sa période est conservée entre changements de panneau. La vue globale montre les foyers actuels ; leur rejeu détaillé reste dans FEUX.

## Démarrage

```sh
npm install
npm run dev
# localhost:8742 — collecte OMNI autonome en développement
npm run omni:sync       # exécution ponctuelle, respect des échéances
npm run omni:sync -- --force
npm run omni:worker     # processus continu pour exécution hors Next
npm test
npm run typecheck
npm run build
npm run backup
```

Node 22, Python 3 (bibliothèque standard, extraction CSV/ZIP VIINA). Les conteneurs incluent Python. Mettre `OMNI_WORKER_ENABLED=0` dans l’app lorsqu’un worker séparé tourne. La collecte s’exécute indépendamment des pages visitées. Les erreurs de sources sont conservées et n’effacent jamais les observations précédentes. Le CLI ponctuel retourne un code non nul si une source obligatoire échoue ; le daemon continue avec backoff.

## Persistance

La première version conserve SQLite/WAL pour éviter une migration du service FEUX et de son historique pendant l’extension. Deux bases dans le **même volume existant `feux-data`** :

- `data/feux.db` : inchangée, historique incendies et caches existants ;
- `data/omni.db` : schéma OMNI versionné (migration 1), sources, collectes, baux, métadonnées de documents, observations append-only, relevés territoriaux.

Ne pas renommer/supprimer le volume. Les sources sont déclarées dans `src/lib/omni/catalog.mjs`. Les tables métier ne partagent pas un « score de gravité » artificiel. Les prochains changements de schéma doivent avoir leur propre migration et test de restauration. PostgreSQL/PostGIS reste la cible si plusieurs instances d’app ou des analyses spatiales massives sont nécessaires ; il **n’est pas provisionné** ici.

Les imports sont idempotents : contenu identique au dernier état = aucune nouvelle version. Une correction puis un retour à la version initiale produisent bien trois versions. Les relevés territoriaux sont complets pour leur jeu et leur date ; un relevé vide peut explicitement remplacer le précédent à partir de sa date.

Les documents archivés OMS/ReliefWeb sont des métadonnées, liens et empreintes, **pas une republication intégrale des articles**. L’empreinte du texte RSS et la date de modification OMS permettent de distinguer des mises à jour de contenu même si le titre reste identique. On ne peut pas reconstruire le texte intégral ancien depuis ces seules métadonnées.

## Deux chronologies

- `at` : situation à une date de référence, avec les corrections disponibles aujourd’hui ;
- `knownAt` : seulement les versions enregistrées et publiées avant cette date.

Les versions sont sélectionnées avant de filtrer la date de l’événement : une correction qui déplace la date n’entraîne pas la réapparition d’une version périmée. Aucun état n’est interpolé entre deux relevés territoriaux. En l’absence de date d’incident vérifiée, la date de référence d’un bulletin est sa **date de publication**, explicitement libellée dans le dossier.

Exemple :

```text
/api/omni?domain=war&topic=ukraine&at=2026-09-23T23:59:59Z
/api/omni?domain=pandemic&at=2026-07-02T23:59:59Z&knownAt=2026-07-02T23:59:59Z
/api/omni?history=1
```

« Connu à l’époque » sera vide avant le premier archivage OMNI même si les articles sont antérieurs : on ne fabrique pas de date d’acquisition. Le registre de sources affiche l’état des collectes **actuel**, même en mode historique. L’historique explicite d’une publication montre toutes ses versions et précise qu’il peut inclure des corrections postérieures au curseur.

## Sources intégrées

| Source | Usage | Cadence | Limites |
|---|---|---|---|
| [OMS DON](https://www.who.int/emergencies/disease-outbreak-news) | Bulletins sanitaires officiels | 1 h | Extraction bibliographique ; pas d’interprétation automatique de chiffres |
| [ReliefWeb](https://reliefweb.int/updates) | Publications humanitaires, auteur d’origine et lien | 1 h par dossier | Pas une base d’incidents militaires ; doublons entre éditeurs possibles, jamais additionnés comme des cas |
| [Hantavirus 2026 sur data.gouv](https://www.data.gouv.fr/datasets/hantavirus-2026) | Métadonnées du catalogue | 24 h | Contribution Ludwig Boudeweel, non autorité sanitaire ; ressource en erreur 500 à l’intégration, aucun chiffre importé |
| [VIINA 2.0](https://github.com/zhukovyuri/VIINA) | Contrôle majoritaire par localité | 24 h | Évaluation automatique/OSINT, date réelle visible, couverture Ukraine uniquement |
| Références éditoriales | OMS 2 juillet et signal Irkoutsk | Manuel | Aucune promesse de mise à jour automatique des bilans éditoriaux |

Le [MCP officiel data.gouv](https://github.com/datagouv/datagouv-mcp), `https://mcp.data.gouv.fr/mcp`, a été interrogé via JSON-RPC : `search_datasets`, `get_dataset_info`, `list_dataset_resources`. Jeu Hantavirus `6a00e457c5bc7667066b44a2`, ressource `12404ed0-7fa9-490f-8fac-b55d9d171bc7`. Le connecteur de production lit l’API catalogue directement et ne dépend pas d’une session MCP.

### Hantavirus / peste

Le bilan éditorial OMS au 2 juillet 2026 concerne uniquement le MV Hondius (12 confirmés, 1 probable, 3 décès inclus dans les cas), épisode décrit comme contenu. Ce n’est ni un compteur mondial ni une pandémie déclarée. [Référence OMS](https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON611).

Le dossier Irkoutsk conserve le statut **signal non confirmé** d’après les références d’intégration. Aucun nombre de cas de peste confirmé ou de contacts infectés n’est inféré. [Article de référence](https://www.euronews.com/2026/10/04/has-plague-returned-to-siberia-panic-in-russia-after-death-of-lab-worker). Une confirmation future nécessite une observation sourcée, pas une modification silencieuse de cette référence.

### VIINA et territoires

Attribution : **Zhukov, Yuri and Natalie Ayers (2023), VIINA 2.0: Violent Incident Information from News Articles on the 2022 Russian Invasion of Ukraine.** Source et mises à jour : https://github.com/zhukovyuri/VIINA. [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Transformation OMNI : champ `status` (vote majoritaire Wikipedia, Wikipedia enrichi, DeepStateMap), jointure `geonameid` avec `gn_UA_tess.geojson`, conservation graphique des cellules RU/CONTESTED, coordonnées arrondies à cinq décimales. Le jeu dérivé territorial est fourni sous ODbL 1.0 par `/api/omni/territory?snapshot=ID` et par le lien de téléchargement du dossier. La licence s’applique à ce jeu dérivé, pas au code de l’application.

Les cellules sont des tessellations de localités, **pas des limites de contrôle observées au mètre**. L’absence de cellule affichée ne signifie pas contrôle ukrainien. Les variations sont des changements d’évaluation de localités entre deux relevés, pas des surfaces conquises. Les sommes incluent le statut inconnu ; il n’est jamais converti en contrôle ukrainien.

Les géodonnées ISW consultées demandent un accord écrit. Aucune extraction directe ISW n’est activée. Pour les autres conflits, ajouter des sources avec une licence et un schéma adaptés avant d’afficher des territoires.

## Import de relevés autorisés

```sh
npm run omni:import -- /chemin/releve.geojson
```

Le fichier est un `FeatureCollection`, ou un tableau de collections. Champs additionnels requis :

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "topic": "ukraine",
    "datasetId": "identifiant-stable-du-jeu",
    "publisher": "Éditeur",
    "sourceUrl": "https://source.example/releve",
    "license": "Licence autorisant cet usage",
    "validAt": "2026-09-29T00:00:00Z"
  },
  "features": []
}
```

Chaque entité doit être un Polygon/MultiPolygon WGS84 avec des anneaux fermés et `properties.id` unique, `properties.actor`, `properties.status` (`controlled`, `contested`, `claimed`). Une collection vide est un relevé vide explicite, **pas un exemple à importer en production**. Les imports sont atomiques. Aucune route HTTP publique n’autorise l’écriture. `OMNI_TERRITORY_FEED_URL` peut pointer vers un flux HTTPS respectant exactement ce contrat.

## CARTO et fond de secours

`CARTO_API_KEY` reste dans `.env.local` en local, et dans les variables Dokploy en production. Le navigateur charge `/api/omni/tiles/{z}/{x}/{y}` ; la clé n’est pas renvoyée au client ni committée. `CARTO_MAP_ORIGIN` indique l’origine autorisée par la clé de ce projet (par défaut `https://omni.vima.work`). Le proxy borne les coordonnées et utilise un cache de 24 h. Attribution CARTO/OpenStreetMap visible. Le fond mondial Natural Earth est embarqué et reste disponible si CARTO échoue ; FEUX revient à OpenStreetMap.

`public/world-countries.geojson` : Natural Earth 1:110m, [source](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson), propriétés réduites aux noms, codes et coordonnées des libellés ; domaine public, [conditions](https://www.naturalearthdata.com/about/terms-of-use/). Les frontières du fond ne sont pas les relevés militaires.

## Production et sauvegardes

`docker-compose.prod.yml` conserve `feux-app` et `feux-cron`, ajoute :

- `omni-worker` : collecte hors HTTP, reprise après redémarrage, baux exclusifs par source, backoff ;
- `omni-backup` : sauvegardes quotidiennes des deux bases dans le volume distinct `omni-backups`, via l’API de sauvegarde SQLite, puis `integrity_check`.

Un volume distinct sur le même hôte **ne protège pas de la perte du serveur**. Une réplication hors serveur et sa rétention restent à configurer selon la destination choisie ; aucun accès à un stockage tiers n’est créé par cette livraison. Les snapshots ne sont pas supprimés automatiquement : surveiller le volume et appliquer une politique de rétention après réplication.

Pour restaurer : arrêter l’app et les collecteurs, conserver une copie du volume courant, restaurer les deux bases d’un même répertoire de sauvegarde vérifiée dans le volume vide, démarrer et vérifier `/api/status` et `/api/omni`. Ne pas écraser une base active ni mélanger ses anciens fichiers WAL avec la sauvegarde. Un test automatisé restaure une sauvegarde contenant des écritures WAL et vérifie l’intégrité et les observations.

La clé CARTO locale n’est pas transmise automatiquement à Dokploy. Pour déployer, la configurer dans le service avant le redéploiement. Le push sur `main` déclenche la CI et le webhook existants ; pas de changement de domaine ni suppression du volume historique.

## Iran & Gulf

WAR includes `iran-gulf`, covering Iran, Iraq, the Gulf states and the Strait of Hormuz. An hourly English UN News feed is filtered for regional security and humanitarian relevance; ReliefWeb searches all eight countries. Reports retain publication dates, attribution and revisions, without invented incident coordinates or territorial polygons. The UN feed is a rolling window, so initial coverage is not a complete conflict history.

## Iran & Gulf discovery and maritime indicators

The hourly worker searches Exa for maritime, hostilities, diplomacy and humanitarian coverage. UKMTO searches are restricted to its official domain; only dated official PDF metadata is published. Publication dates and explicit report times remain distinct from unknown event times. Undated or future records are excluded, and unknown coordinates remain unset. Related coverage is a reading aid, not independent corroboration.

Canonical URLs remove tracking parameters. Discovery responses are cached for one hour in SQLite; observations retain revisions. `EXA_API_KEY` is server-side. `OMNI_EXA_DAILY_BUDGET_USD` defaults to 1 USD per UTC day, with an atomic conservative 0.01 USD reservation per request and a 120-request ceiling. Failures retain their reservation. The daily budget may pause hourly discovery; FIRES Exa usage is separate. Sources show actual reported costs and reserved budget usage.

IMF PortWatch's Daily Chokepoints dataset is fetched every six hours for `chokepoint6` (Strait of Hormuz). Daily total, tanker and cargo transit indicators have their own append-only revision history. Historical views honor observation dates and archive knowledge times. Missing observations are not zeros. AIS coverage is incomplete and the latest source date is shown explicitly. PortWatch does not provide live vessel positions in this integration.

Both archive tables and discovery budget/cache tables live in the existing persistent SQLite volume and are covered by the database backups. Failed refreshes preserve archived data and expose the source error.

### Social posts and videos

The Iran & Gulf feed offers All, News, Official, Social and Videos filters, persisted in the URL. Social discovery runs every three hours with English, Arabic and Persian queries, plus a video query, within the existing shared 1 USD/day Exa budget. Exhausting that budget pauses additional searches until the next UTC day; it does not remove the archive.

Only dated, relevant individual post/video URLs from supported platforms are retained. Profile and search pages, future/undated results and unrelated results are excluded. Twitter/X URLs, YouTube variants and Reddit share links are canonicalized. Each run retains one result per canonical URL; subsequent changes create archive revisions. Social posts and videos always enter as unverified signals without inferred coordinates or event times. Cards retain original-language excerpts (up to 280 characters), source previews when supplied, and links to the original platform. Midnight timestamps from search metadata are displayed as dates rather than pretending to establish the post's precise time.

Platform coverage depends on Exa indexing. Initial live checks returned usable Bluesky posts, but no relevant dated video results; this is not a guarantee of X, Instagram or video coverage. Empty feeds remain explicit, without substituting unrelated content. Public post excerpts may include linked headlines and do not establish eyewitness status or independent corroboration.
