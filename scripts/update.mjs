/**
 * Mise à jour périodique (cron) : déclenche l'ingestion FIRMS des 3 plages et
 * le snapshot des foyers via l'API du serveur (qui doit tourner).
 * Usage : npm run update  — ou dans un cron :
 *   *\/30 * * * * cd /chemin/du/projet && npm run update
 */
const BASE = process.env.FEUX_URL || "http://localhost:8742";

for (const range of ["24h", "48h", "7d"]) {
  const r = await fetch(`${BASE}/api/fires?range=${range}`);
  const d = await r.json();
  console.log(`${range}: ${d.meta?.count ?? "?"} détections en fenêtre`);
}
const c = await (await fetch(`${BASE}/api/clusters?range=24h`)).json();
console.log(`clusters 24h : ${c.meta?.count ?? "?"} foyers (snapshot archivé)`);
