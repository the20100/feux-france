/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image Docker autonome (`.next/standalone`) : le runner de production
  // n'embarque ni `node_modules` complet ni `next start`.
  output: "standalone",
  // Sans ça, Next déduit la racine de tracing du lockfile le plus haut trouvé
  // en remontant l'arborescence (il y en a un dans le home de la machine de
  // dev) et enfouit `server.js` sous une copie du chemin absolu. Le Dockerfile
  // l'attend à la racine : on fige la racine ici.
  outputFileTracingRoot: process.cwd(),
  // ⚠️ Ne PAS ajouter `outputFileTracingExcludes` pour écarter `data/` de la
  // sortie standalone (le tracing y recopie la base locale, 11 Mo) : avec
  // Next 15.5, la seule présence de cette clé ampute le tracing de modules
  // internes — `next/dist/lib/metadata/*` disparaît et le serveur meurt au
  // démarrage sur `Cannot find module '../../../lib/metadata/get-metadata-route'`.
  // Le `.dockerignore` exclut déjà `data/` du contexte de build, là où ça compte.
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        // ressources statiques publiques (geojson, images) accessibles cross-origin
        source: "/:file*(geojson|png|jpg)",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
