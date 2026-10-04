"""Convert VIINA's open territorial dataset, preserving its assessment semantics.
No interpolation or inference of a precise front line. Standard-library only.
"""
import csv, io, json, sys, zipfile, datetime, pathlib
root = pathlib.Path(sys.argv[1])
archive = zipfile.ZipFile(root / 'control.zip')
entry = next(x for x in archive.infolist() if x.filename.endswith('.csv'))
if entry.file_size > 900_000_000:
    raise ValueError('VIINA archive exceeds 900 MB decompressed')
# A streaming pass finds the actual latest observation, independent of fetch/release date.
dates = set()
with archive.open(entry) as raw:
    reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
    columns = next(reader)
    idx = {name: columns.index(name) for name in ('date', 'geonameid', 'status', 'vcontrol_version')}
    for row in reader:
        if not row: continue
        dates.add(row[idx['date']])
if not dates: raise ValueError('VIINA returned no dates')
latest = max(dates)
end = datetime.datetime.strptime(latest, '%Y%m%d').date()
targets = sorted({max(d for d in dates if d <= (end-datetime.timedelta(days=n)).strftime('%Y%m%d')) for n in (0, 7, 30) if any(d <= (end-datetime.timedelta(days=n)).strftime('%Y%m%d') for d in dates)})
states = {d: {} for d in targets}
release = ''
with archive.open(entry) as raw:
    reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig')); next(reader)
    for row in reader:
        if not row or row[idx['date']] not in states: continue
        states[row[idx['date']]][row[idx['geonameid']]] = row[idx['status']]
        release = max(release, row[idx['vcontrol_version']])
places = json.loads((root / 'places.geojson').read_text())
def rounded(coords):
    if isinstance(coords[0], (int, float)): return [round(coords[0], 5), round(coords[1], 5)]
    return [rounded(c) for c in coords]
previous = None
paths = []
for day in targets:
    current = states[day]
    counts = {k: sum(1 for s in current.values() if s == k) for k in ('RU', 'UA', 'CONTESTED')}
    counts['UNKNOWN'] = len(current) - sum(counts.values())
    features = []
    for f in places['features']:
        p = f['properties']; key = str(int(p['geonameid'])); status = current.get(key)
        if status not in ('RU', 'CONTESTED'): continue
        features.append({'type': 'Feature', 'geometry': {'type': f['geometry']['type'], 'coordinates': rounded(f['geometry']['coordinates'])}, 'properties': {'id': key, 'name': p['name'], 'actor': 'Assessed Russian control' if status == 'RU' else 'Contested control', 'status': 'controlled' if status == 'RU' else 'contested'}})
    meta = {'topic': 'ukraine', 'datasetId': 'viina-consensus', 'publisher': 'Yuri Zhukov & Natalie Ayers · VIINA 2.0', 'sourceUrl': 'https://github.com/zhukovyuri/VIINA', 'license': 'ODbL 1.0 · OMNI derived database under ODbL 1.0', 'validAt': datetime.datetime.strptime(day, '%Y%m%d').strftime('%Y-%m-%dT00:00:00.000Z'), 'release': release, 'method': 'VIINA majority status (Wikipedia, enriched Wikipedia, DeepStateMap), projected onto GeoNames locality cells. Geometry rounded to 5 decimal places. RU and contested cells only; an absent cell does not imply Ukrainian control. These are not precise military boundaries.', 'counts': counts, 'coverage': 'RU/CONTESTED cells only'}
    if previous:
        old = states[previous]
        shared = set(old) & set(current)
        meta['changes'] = {'since': datetime.datetime.strptime(previous, '%Y%m%d').strftime('%Y-%m-%d'), 'toRU': sum(current[k] == 'RU' and old[k] in ('UA','CONTESTED') for k in shared), 'fromRU': sum(old[k] == 'RU' and current[k] in ('UA','CONTESTED') for k in shared), 'changed': sum(current[k] != old[k] for k in shared)}
    output = root / ('snapshot-' + day + '.geojson')
    output.write_text(json.dumps({'type': 'FeatureCollection', 'metadata': meta, 'features': features}, ensure_ascii=False, separators=(',', ':')))
    paths.append(str(output))
    previous = day
print(json.dumps({'latest': latest, 'paths': paths}))
