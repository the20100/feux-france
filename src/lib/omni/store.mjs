import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sources, topics, referenceObservations } from './catalog.mjs';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function safeUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export function iso(value) { const d = new Date(value); if (!value || !Number.isFinite(+d)) throw new Error('Date invalide'); return d.toISOString(); }

export function openStore(filename = process.env.OMNI_DB_PATH || join(process.cwd(), 'data', 'omni.db')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 10000'); db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS omni_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ingestion_runs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, added INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE INDEX IF NOT EXISTS runs_source ON ingestion_runs(source_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS source_state (source_id TEXT PRIMARY KEY REFERENCES sources(id), last_attempt TEXT, last_success TEXT, next_attempt TEXT, lease_until TEXT, lease_owner TEXT, failures INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), url TEXT NOT NULL, fetched_at TEXT NOT NULL, checksum TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(source_id,url,checksum));
    CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), external_id TEXT NOT NULL, domain TEXT NOT NULL, topic TEXT NOT NULL, occurred_at TEXT NOT NULL, published_at TEXT NOT NULL, recorded_at TEXT NOT NULL, checksum TEXT NOT NULL, document_id TEXT REFERENCES documents(id), payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS observations_identity ON observations(source_id,external_id,id DESC);
    CREATE INDEX IF NOT EXISTS observations_time ON observations(domain,topic,occurred_at,recorded_at);
    CREATE TABLE IF NOT EXISTS territory_snapshots (id INTEGER PRIMARY KEY, topic TEXT NOT NULL, dataset_id TEXT NOT NULL, valid_at TEXT NOT NULL, recorded_at TEXT NOT NULL, checksum TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS territory_time ON territory_snapshots(topic,valid_at,recorded_at);
  `);
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO omni_migrations VALUES (1,?)').run(new Date().toISOString());
    const register = db.prepare('INSERT INTO sources VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
    for (const s of sources) register.run(s.id, JSON.stringify(s));
  })();
  return db;
}

export function seedReferences(db, now = new Date().toISOString()) {
  for (const o of referenceObservations) {
    // Do not overwrite later reviewed corrections; never make a future publication visible early.
    if (iso(o.publishedAt) > now) continue;
    if (!db.prepare('SELECT 1 FROM observations WHERE source_id=? AND external_id=?').get(o.sourceId, o.externalId)) appendObservation(db, o, null, now);
  }
}
export function archiveDocument(db, sourceId, url, payload, now = new Date().toISOString()) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const checksum = hash(raw), id = hash(`${sourceId}:${url}:${checksum}`);
  db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?,?)').run(id, sourceId, url, now, checksum, raw);
  return id;
}
export function appendObservation(db, observation, documentId = null, now = new Date().toISOString()) {
  if (!sources.some(s => s.id === observation.sourceId) || !topics.some(t => t.id === observation.topic && t.domain === observation.domain)) throw new Error('Source ou sujet inconnu');
  if (!observation.externalId || !observation.title || !safeUrl(observation.url)) throw new Error('Observation incomplète');
  if ((observation.lat != null || observation.lon != null) && (!Number.isFinite(observation.lat) || !Number.isFinite(observation.lon) || Math.abs(observation.lat)>90 || Math.abs(observation.lon)>180)) throw new Error('Coordonnées invalides');
  const o = { ...observation, occurredAt: iso(observation.occurredAt), publishedAt: iso(observation.publishedAt) };
  if (o.publishedAt > now) throw new Error('Publication future refusée');
  const payload = JSON.stringify(o), checksum = hash(payload);
  return db.transaction(() => {
    const latest = db.prepare('SELECT checksum FROM observations WHERE source_id=? AND external_id=? ORDER BY id DESC LIMIT 1').get(o.sourceId,o.externalId);
    if (latest?.checksum === checksum) return 0;
    db.prepare('INSERT INTO observations (source_id,external_id,domain,topic,occurred_at,published_at,recorded_at,checksum,document_id,payload) VALUES (?,?,?,?,?,?,?,?,?,?)').run(o.sourceId,o.externalId,o.domain,o.topic,o.occurredAt,o.publishedAt,now,checksum,documentId,payload);
    return 1;
  })();
}

export function validateTerritory(input) {
  if (input?.type !== 'FeatureCollection' || !Array.isArray(input.features) || !input.metadata) throw new Error('FeatureCollection et metadata requis');
  const m = input.metadata;
  if (!topics.some(t => t.id === m.topic && t.domain === 'war')) throw new Error('Théâtre inconnu');
  if (!m.datasetId || !m.publisher || !m.license || !safeUrl(m.sourceUrl)) throw new Error('datasetId, publisher, license et sourceUrl requis');
  iso(m.validAt);
  if (input.features.length > 20000) throw new Error('Relevé trop volumineux');
  const ids = new Set();
  function coordinates(c) {
    if (!Array.isArray(c) || !c.length) throw new Error('Coordonnées invalides');
    if (typeof c[0] === 'number') {
      if (c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) throw new Error('Coordonnées hors limites');
    } else c.forEach(coordinates);
  }
  for (const f of input.features) {
    if (f.type !== 'Feature' || !['Polygon','MultiPolygon'].includes(f.geometry?.type)) throw new Error('Polygones requis');
    const p = f.properties;
    if (!p?.id || ids.has(p.id) || !p.actor || !['controlled','contested','claimed'].includes(p.status)) throw new Error('Identité unique, acteur et statut requis');
    ids.add(p.id); coordinates(f.geometry.coordinates);
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw new Error('Anneau non fermé');
    }
  }
  return { ...input, metadata: { ...m, validAt: iso(m.validAt) } };
}
export function appendTerritory(db, input, now = new Date().toISOString()) {
  const data = validateTerritory(input);
  if (data.metadata.validAt > now) throw new Error('Relevé futur refusé');
  const payload = JSON.stringify(data), checksum = hash(payload), m = data.metadata;
  return db.transaction(() => {
    const last = db.prepare('SELECT checksum FROM territory_snapshots WHERE topic=? AND dataset_id=? AND valid_at=? ORDER BY id DESC LIMIT 1').get(m.topic,m.datasetId,m.validAt);
    if (last?.checksum === checksum) return 0;
    db.prepare('INSERT INTO territory_snapshots (topic,dataset_id,valid_at,recorded_at,checksum,payload) VALUES (?,?,?,?,?,?)').run(m.topic,m.datasetId,m.validAt,now,checksum,payload);
    return 1;
  })();
}
export function claimSource(db, source, now = new Date().toISOString(), force = false) {
  return db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO source_state (source_id) VALUES (?)').run(source.id);
    const s = db.prepare('SELECT * FROM source_state WHERE source_id=?').get(source.id);
    if (s.lease_until > now || (!force && s.next_attempt > now)) return null;
    const id = randomUUID();
    db.prepare('UPDATE source_state SET last_attempt=?,lease_until=?,lease_owner=? WHERE source_id=?').run(now,new Date(+new Date(now)+600000).toISOString(),id,source.id);
    db.prepare("UPDATE ingestion_runs SET status='error', finished_at=?, error='Collecte interrompue ; bail expiré' WHERE source_id=? AND status='running'").run(now,source.id);
    db.prepare("INSERT INTO ingestion_runs (id,source_id,started_at,status) VALUES (?,?,?,'running')").run(id,source.id,now);
    return id;
  })();
}
export function finishSource(db, source, runId, added, error = null, now = new Date().toISOString()) {
  db.transaction(() => {
    const s = db.prepare('SELECT * FROM source_state WHERE source_id=?').get(source.id);
    if (s?.lease_owner !== runId) return;
    const failures = error ? s.failures + 1 : 0;
    const wait = error ? Math.min(86400, 300 * 2 ** Math.min(failures - 1, 8)) : source.interval;
    db.prepare('UPDATE source_state SET last_success=?,next_attempt=?,lease_until=NULL,lease_owner=NULL,failures=?,error=? WHERE source_id=?').run(error ? s.last_success : now,new Date(+new Date(now)+wait*1000).toISOString(),failures,error,source.id);
    db.prepare('UPDATE ingestion_runs SET finished_at=?,status=?,added=?,error=? WHERE id=?').run(now,error ? 'error' : 'ok',added,error,runId);
  })();
}

export function readDashboard(db, { domain = 'global', topic = '', at = null, knownAt = null, limit = 400 } = {}) {
  const now = new Date().toISOString(), validCutoff = at ? iso(at) : now, knowledgeCutoff = knownAt ? iso(knownAt) : now;
  const args = [knowledgeCutoff, knowledgeCutoff, validCutoff];
  let where = '';
  if (domain !== 'global') { where += ' AND domain=?'; args.push(domain); }
  if (topic) { where += ' AND topic=?'; args.push(topic); }
  // Rank first, then filter valid time: a correction can move an event outside the selected period.
  const rows = db.prepare(`WITH versions AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY source_id,external_id ORDER BY id DESC) AS rank, COUNT(*) OVER (PARTITION BY source_id,external_id) AS revision_count FROM observations WHERE recorded_at<=? AND published_at<=?) SELECT * FROM versions WHERE rank=1 AND occurred_at<=? ${where} ORDER BY occurred_at DESC,id DESC LIMIT ?`).all(...args,limit+1);
  const observations = rows.slice(0,limit).map(r => ({ ...JSON.parse(r.payload), id:r.id, recordedAt:r.recorded_at, revisions:r.revision_count }));
  const states = db.prepare('SELECT * FROM source_state').all();
  const sourceList = sources.filter(s => domain === 'global' || s.domain === domain).map(s => {
    const state = states.find(x => x.source_id === s.id);
    const lastDataAt = s.id === 'viina' ? db.prepare("SELECT MAX(valid_at) date FROM territory_snapshots WHERE dataset_id='viina-consensus'").get().date : db.prepare('SELECT MAX(published_at) date FROM observations WHERE source_id=?').get(s.id).date;
    return { ...s, ...state, lastDataAt, health: s.id === 'territories' && !process.env.OMNI_TERRITORY_FEED_URL ? 'manual' : !s.connector ? 'reference' : !state?.last_attempt ? 'pending' : state.error ? 'error' : (!state.last_success || +new Date(now)-+new Date(state.last_success) > s.interval*2000) ? 'stale' : 'ok' };
  });
  const territoryRows = db.prepare(`WITH versions AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY topic,dataset_id ORDER BY valid_at DESC,id DESC) AS rank FROM territory_snapshots WHERE valid_at<=? AND recorded_at<=? ${topic ? 'AND topic=?' : ''}) SELECT * FROM versions WHERE rank=1`).all(validCutoff,knowledgeCutoff,...(topic ? [topic] : []));
  const territories = domain === 'pandemic' ? [] : territoryRows.map(r => ({ ...JSON.parse(r.payload), recordedAt:r.recorded_at, snapshotId:r.id }));
  const history = db.prepare(`SELECT occurred_at AS date FROM observations WHERE recorded_at<=? ${domain !== 'global' ? 'AND domain=?' : ''} ${topic ? 'AND topic=?' : ''} UNION SELECT valid_at AS date FROM territory_snapshots WHERE recorded_at<=? ${domain === 'pandemic' ? 'AND 0=1' : ''} ${topic ? 'AND topic=?' : ''} ORDER BY date`).all(knowledgeCutoff,...(domain !== 'global' ? [domain] : []),...(topic ? [topic] : []),knowledgeCutoff,...(topic ? [topic] : []));
  return { observations, territories, sources: sourceList, topics, timeline: [...new Set(history.map(r=>r.date))], truncated: rows.length > limit, fetchedAt:now, at:validCutoff, knownAt:knowledgeCutoff, runs:db.prepare('SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 20').all() };
}
export function observationHistory(db, id) {
  const row = db.prepare('SELECT source_id,external_id FROM observations WHERE id=?').get(id);
  if (!row) return [];
  return db.prepare('SELECT * FROM observations WHERE source_id=? AND external_id=? ORDER BY id DESC').all(row.source_id,row.external_id).map(r=>({...JSON.parse(r.payload),id:r.id,recordedAt:r.recorded_at}));
}
