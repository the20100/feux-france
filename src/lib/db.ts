import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(path.join(DATA_DIR, "feux.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS hotspots (
      lat REAL NOT NULL, lon REAL NOT NULL, epoch INTEGER NOT NULL,
      sat TEXT NOT NULL, frp REAL, conf TEXT, daynight TEXT,
      PRIMARY KEY (lat, lon, epoch, sat)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_hotspots_epoch ON hotspots(epoch);
    CREATE TABLE IF NOT EXISTS fetch_log (
      range_key TEXT PRIMARY KEY, fetched_at INTEGER, rows_added INTEGER, errors TEXT);
    CREATE TABLE IF NOT EXISTS geocode (
      key TEXT PRIMARY KEY, commune TEXT, dept TEXT, population INTEGER, ts INTEGER);
    CREATE TABLE IF NOT EXISTS meteo_cache (key TEXT PRIMARY KEY, ts INTEGER, payload TEXT);
    CREATE TABLE IF NOT EXISTS intel_cache (key TEXT PRIMARY KEY, ts INTEGER, payload TEXT);
    CREATE TABLE IF NOT EXISTS misc_cache (key TEXT PRIMARY KEY, ts INTEGER, payload TEXT);
    CREATE TABLE IF NOT EXISTS clusters_history (
      ts INTEGER NOT NULL, fid TEXT NOT NULL, lat REAL, lon REAL,
      frp REAL, n INTEGER, area_km2 REAL, active INTEGER, score INTEGER,
      commune TEXT, dept TEXT, PRIMARY KEY (ts, fid));
    CREATE INDEX IF NOT EXISTS idx_ch_fid ON clusters_history(fid);
    CREATE TABLE IF NOT EXISTS communes (
      code TEXT PRIMARY KEY, nom TEXT, dept TEXT, population INTEGER,
      lat REAL, lon REAL);
    CREATE TABLE IF NOT EXISTS mf_forets_history (
      day TEXT NOT NULL, dept TEXT NOT NULL, j1 INTEGER, j2 INTEGER,
      PRIMARY KEY (day, dept));
    CREATE TABLE IF NOT EXISTS aircraft_tracks (
      icao TEXT NOT NULL, ts INTEGER NOT NULL, callsign TEXT, reg TEXT,
      actype TEXT, lat REAL, lon REAL, alt_ft INTEGER, gs_kt REAL, track REAL,
      PRIMARY KEY (icao, ts));
    CREATE INDEX IF NOT EXISTS idx_aircraft_ts ON aircraft_tracks(ts);
  `);
  return _db;
}
