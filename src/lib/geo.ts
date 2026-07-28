import fs from "fs";
import path from "path";

export const BBOX = [-5.6, 41.2, 10.0, 51.3] as const; // lonMin, latMin, lonMax, latMax

let _rings: number[][][] | null = null;

function rings(): number[][][] {
  if (!_rings) {
    const gj = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), "public", "france-metropole.geojson"), "utf-8"));
    _rings = gj.geometry.coordinates.map((poly: number[][][]) => poly[0]);
  }
  return _rings!;
}

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  let j = ring.length - 1;
  for (let i = 0; i < ring.length; i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

export function inFrance(lon: number, lat: number): boolean {
  if (!(BBOX[0] <= lon && lon <= BBOX[2] && BBOX[1] <= lat && lat <= BBOX[3])) return false;
  return rings().some((r) => inRing(lon, lat, r));
}

export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dx = (lon2 - lon1) * 111.32 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const dy = (lat2 - lat1) * 110.57;
  return Math.hypot(dx, dy);
}

export function convexHull(pts: [number, number][]): [number, number][] {
  const uniq = Array.from(new Set(pts.map((p) => p.join(",")))).map(
    (s) => s.split(",").map(Number) as [number, number]);
  uniq.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (uniq.length <= 2) return uniq;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...uniq].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function hullAreaKm2(hull: [number, number][], lat0: number): number {
  if (hull.length < 3) return 0;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.57;
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = [hull[i][0] * kx, hull[i][1] * ky];
    const j = (i + 1) % hull.length;
    const [x2, y2] = [hull[j][0] * kx, hull[j][1] * ky];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export const DEPTS: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence",
  "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes",
  "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron",
  "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente",
  "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud",
  "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse",
  "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure",
  "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne",
  "32": "Gers", "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine",
  "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
  "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
  "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne",
  "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
  "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle", "55": "Meuse",
  "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
  "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme",
  "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales",
  "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône",
  "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
  "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines",
  "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne",
  "83": "Var", "84": "Vaucluse", "85": "Vendée", "86": "Vienne",
  "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
  "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne", "95": "Val-d'Oise",
};
