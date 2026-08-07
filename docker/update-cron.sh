#!/bin/sh
# Remplace le cron « toutes les ~30 min » du README : appelle l'API du serveur
# pour déclencher l'ingestion FIRMS des trois plages et l'archivage du snapshot
# des foyers. Une boucle `sleep` plutôt qu'un vrai crond : un seul processus,
# ses logs partent directement dans Dokploy, et l'intervalle se règle par
# variable d'environnement.
set -eu

INTERVAL="${UPDATE_INTERVAL:-1800}"

# L'app a un healthcheck et le compose attend qu'il passe, mais le premier
# `getRows` à froid prend ~7 s : on laisse la place plutôt que de compter un
# échec au premier tour.
sleep 30

while :; do
  echo "--- mise à jour $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"
  # Un échec (source FIRMS indisponible, app qui redémarre) ne doit pas tuer la
  # boucle : le tour suivant réessaiera.
  node scripts/update.mjs || echo "mise à jour en échec, nouvel essai dans ${INTERVAL}s"
  sleep "$INTERVAL"
done
