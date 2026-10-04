/**
 * Tâches de fond (runtime Node uniquement) :
 *  - référentiel des communes (une fois)
 *  - grilles vent + qualité de l'air, rafraîchies toutes les heures avec
 *    espacement (quotas Open-Meteo lissés)
 *  - enregistreur des bombardiers d'eau, cadence adaptative
 */
import { ensureCommunes } from "./lib/geocode";
import { windGrids, getAirGrid } from "./lib/openMeteo";
import { aircraftTick } from "./lib/aircraft";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startWorkers() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as any;
  if (g.__feuxWorkersStarted) return; // hot-reload de next dev
  g.__feuxWorkersStarted = true;

  ensureCommunes().catch((e) => console.warn("communes:", e.message));

  (async () => {
    await sleep(65000); // laisse passer le quota-minute consommé au démarrage
    for (;;) {
      for (const job of [
        () => windGrids.fetchWindSeries(windGrids.GRID_FINE),
        () => windGrids.fetchWindSeries(windGrids.GRID_HIST),
        () => getAirGrid(),
      ]) {
        await job().catch(() => {});
        await sleep(30000);
      }
      await sleep(3600000 - 90000);
    }
  })();

  (async () => {
    await sleep(5000);
    for (;;) {
      let airborne = false;
      try {
        airborne = await aircraftTick();
      } catch { /* réessaiera */ }
      // 15 min au repos, 2 min tant qu'un appareil est en vol
      await sleep(airborne ? 120000 : 900000);
    }
  })();

  // Production uses the dedicated worker container. Local dev collects without a visitor.
  if (process.env.OMNI_WORKER_ENABLED !== "0") {
    (async () => {
      const { openStore } = await import("./lib/omni/store.mjs");
      const { syncSources } = await import("./lib/omni/collect.mjs");
      const store = openStore();
      for (;;) {
        await syncSources(store).catch((e) => console.warn("OMNI:", e.message));
        await sleep(60000);
      }
    })().catch((e) => console.warn("OMNI worker:", e.message));
  }

  console.log("FEUX FRANCE — tâches de fond démarrées");
}
