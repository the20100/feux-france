# 🔥 FEUX FRANCE

Plateforme de suivi **temps réel des feux de forêt en France** : détection
satellite, niveau de danger officiel, météo fine, moyens aériens et
renseignement en sources ouvertes — sur une seule carte.

![Next.js](https://img.shields.io/badge/Next.js-15-black) ![React](https://img.shields.io/badge/React-19-blue) ![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-lightgrey)

## Fonctionnalités

- **Foyers en temps réel** — clustering des points chauds satellites VIIRS
  (NASA FIRMS, 3 satellites, rafraîchis ~3 h), nommés par commune, avec
  contours, tendance (intensification/décroissance) et détection de **reprise**
  après 48 h de silence.
- **Score de menace 0-100** — intensité, activité, rafales (mesurées en station
  quand possible), sécheresse de l'air, population à 5 km, danger officiel et
  vigilances combinées. Tri par menace ou par intensité brute.
- **Risque officiel Météo-France** — niveaux de danger de feu J+1/J+2 par
  département (Météo des forêts), vigilance par phénomène avec chronologie,
  alerte « cocktail vent + canicule ».
- **Météo opérationnelle** — modèle AROME au point du foyer, **vent mesuré**
  par la station Météo-France la plus proche (pas de 6 min), détection de
  bascule de vent, trajectoire de propagation 6 h, prévision d'ensemble
  (incertitude sur les rafales), contexte climatique vs normales 1991-2020.
- **Moyens aériens** — suivi ADS-B des bombardiers d'eau et hélicos de la
  Sécurité Civile (+ renforts italiens/croates rescEU), trajectoires complètes,
  synchronisé à la timeline.
- **Renseignement** — feed unifié presse / réseaux sociaux / communiqués
  officiels (préfectures, vigilance) / vidéos via Exa, filtré par pertinence
  géographique stricte, avec synthèse IA sourcée (budget quotidien).
- **Couches carte** — animation de particules de vent, radar de pluie,
  qualité de l'air (îlots AQI lissés + étiquettes), heatmap, choroplèthes
  (activité / danger / vigilance), imagerie satellite NASA GIBS par foyer,
  fond satellite.
- **Timeline rejouable** — rejouez la semaine heure par heure : détections,
  vent d'époque et rotations aériennes.
- **Enjeux** — population et communes dans un rayon de 10 km, sites sensibles
  OSM (écoles, EHPAD, campings…) à 3 km.
- **Historique cumulatif** — tout est archivé en SQLite : détections
  (au-delà des 7 jours publiés par la NASA), snapshots de foyers, niveaux de
  danger, trajectoires d'avions. Plus le serveur tourne, plus la plateforme
  devient intelligente.

## Démarrage

```bash
npm install
cp .env.example .env    # renseigner les clés (toutes facultatives)
npm run dev             # http://localhost:8742
```

Production : `npm run build && npm start`.

Mise à jour périodique de l'historique (le serveur doit tourner) :

```bash
npm run update          # à mettre en cron toutes les ~30 min
```

## Déploiement

En ligne sur **https://omni.vima.work**, hébergé sur le VPS Hetzner via Dokploy.

Un push sur `main` déclenche `.github/workflows/deploy.yml` : le job `verify`
rejoue `typecheck` + `build` sur un runner GitHub, puis `deploy` sonne le
webhook Dokploy (secret `DOKPLOY_WEBHOOK_URL`), qui reconstruit l'image sur le
serveur depuis `docker-compose.prod.yml`. Le webhook accuse réception mais ne
garantit rien : le résultat du build se lit sur https://dock.vima.work.

Deux conteneurs : `feux-app` (Next.js en sortie `standalone`, exposé par
Traefik) et `feux-cron`, qui rejoue `npm run update` toutes les 30 min — sans
lui la base cesse d'ingérer dès que plus personne n'ouvre la page, l'ingestion
FIRMS étant déclenchée par l'appel API.

L'historique (`data/feux.db`) vit dans le volume Docker `feux-data`, hors du
cycle de vie des conteneurs : il survit aux redéploiements. C'est la seule
donnée non reconstructible du projet — la NASA ne rediffuse que 7 jours.

Les clés d'API se règlent dans Dokploy (onglet Environment du service), pas
dans le dépôt.

## Clés API (`.env`)

| Variable | Service | Rôle | Sans elle |
|---|---|---|---|
| `EXA_API_KEY` | [exa.ai](https://exa.ai) | feed presse/social/état/vidéos | pas de feed |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | synthèses IA | pas de synthèse |
| `MF_TOKEN_*` | [portail-api.meteofrance.fr](https://portail-api.meteofrance.fr) | danger forêts, vigilance, stations | risque officiel et vent mesuré absents |
| `OPENSKY_CLIENT_*` | [opensky-network.org](https://opensky-network.org) | trajectoires complètes des avions | traces moins denses |

Un seul token Météo-France d'application suffit (il couvre toutes les
souscriptions) — le serveur essaie chaque variable et retient celui qui marche.

Sources sans clé : NASA FIRMS, geo.api.gouv.fr, Open-Meteo (AROME, air,
archives ERA5), adsb.lol, RainViewer, NASA GIBS, Overpass OSM, RSS préfectures.

## Architecture

```
src/
  lib/            # métier côté serveur (Node)
    db.ts           SQLite (better-sqlite3, WAL) — data/feux.db
    firms.ts        ingestion NASA FIRMS (dédupliquée, cumulative)
    clusters.ts     clustering, reprises, score de menace, snapshots
    geocode.ts      communes (référentiel local 35 000 communes)
    meteoFrance.ts  danger forêts, vigilance, observations 6 min
    openMeteo.ts    météo AROME, grilles vent, air, climat, ensemble
    intel.ts        Exa + RSS préfectures + filtre de pertinence géo
    summary.ts      synthèses IA (cache 6 h + budget quotidien)
    aircraft.ts     ADS-B + trajectoires OpenSky
    extras.ts       Overpass, statistiques
  app/api/*       # routes HTTP (wrappers fins)
  instrumentation-node.ts  # tâches de fond (grilles, enregistreur avions)
  components/     # interface React
    WarRoom.tsx     état global et composition
    map/            carte Leaflet impérative + modules de couches
    dossier/        panneau foyer (risque, météo, climat, enjeux, satellite,
                    synthèse IA, feed)
```

Principes : tout appel externe passe par un **cache SQLite avec TTL** (aucun
re-scraping inutile, données partagées entre tous les utilisateurs), quotas
lissés (chunks séquentiels, backoff 429, précalcul en tâche de fond), et
**zéro animation continue éparpillée** côté UI (voir `globals.css`).

## Données & licences

Ce projet consomme des données publiques : NASA FIRMS/GIBS (cite « NASA
FIRMS »), Météo-France (Etalab-2.0), Open-Meteo (CC-BY 4.0, non commercial
pour le palier gratuit), geo.api.gouv.fr, OpenStreetMap (ODbL, via Overpass
et les fonds CARTO/Esri), adsb.lol, OpenSky Network (usage non commercial),
RainViewer. Vérifiez les conditions de chaque source avant tout usage
commercial ou intensif.

⚠️ **Cet outil est informatif** : les détections satellites ne remplacent en
aucun cas les canaux d'alerte officiels (112, préfectures, vigilance
Météo-France).
