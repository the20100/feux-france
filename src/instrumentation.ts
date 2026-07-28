export async function register() {
  // l'import dynamique DANS ce bloc est le pattern officiel : le bundle edge
  // ne suit pas les dépendances Node (better-sqlite3, fs…)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorkers } = await import("./instrumentation-node");
    startWorkers();
  }
}
