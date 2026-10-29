import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
export { mapPointId } from '../src/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '..');
const workspace = path.resolve(project, '../../..');
const sourceRoot = path.join(workspace, '日本全域地图-v3.0.0');
const output = path.join(project, 'data/national');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const writeJson = async (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value));

export function buildNavigationRegions() {
  return [
    ['hokkaido', '北海道', ['01']],
    ['tohoku', '东北', ['02', '03', '04', '05', '06', '07']],
    ['kanto', '关东', ['08', '09', '10', '11', '12', '13', '14']],
    ['chubu', '中部', ['15', '16', '17', '18', '19', '20', '21', '22', '23']],
    ['kinki', '近畿', ['24', '25', '26', '27', '28', '29', '30']],
    ['chugoku', '中国', ['31', '32', '33', '34', '35']],
    ['shikoku', '四国', ['36', '37', '38', '39']],
    ['kyushu-okinawa', '九州·冲绳', ['40', '41', '42', '43', '44', '45', '46', '47']],
  ].map(([code, name, regionCodes]) => ({ id: `navigation:${code}`, code, name, regionCodes }));
}

export function deriveAdministration(regions, baseData = {}) {
  const old = new Map((baseData.adminNodes || []).map(n => [n.id, n]));
  const oldPath = n => n ? [...oldPath(old.get(n.parentId)), n.nameJa || n.label] : [];
  const oldByPath = new Map([...old.values()].map(n => [oldPath(n).join('/'), n]));
  const root = { id: 'admin:jp', name: '日本', nameJa: '日本', label: '日本', kind: 'country', parentId: null, adminPath: [] };
  const result = [root], byId = new Map([[root.id, root]]);
  function add(pref, name, nameJa, kind, code, parent, officialPath) {
    const aliases = new Set([name, nameJa, ...(baseData.placeNameAliases?.administrativeNames?.[nameJa] || []), ...(baseData.placeNameAliases?.administrativeNames?.[name] || [])]);
    const priorCandidates = [...old.values()].filter(n => (n.parentId || 'admin:jp') === parent.id && (aliases.has(n.nameJa) || aliases.has(n.label)));
    const prior = oldByPath.get(officialPath.join('/')) || (priorCandidates.length === 1 ? priorCandidates[0] : null);
    const id = prior?.id || (code ? `admin:jp:${code}` : `admin:jp:city:${pref}:${nameJa}`);
    if (byId.has(id)) return byId.get(id);
    const node = { id, name, label: name, nameJa, kind, parentId: parent.id, adminPath: [...parent.adminPath, parent.id], regionCode: pref,
      aliases: [...new Set([name, nameJa])], ...(code ? { officialCode: code } : {}),
      source: { namespace: 'MLIT-N03-2026', method: code ? 'source-administrative-code' : 'source-municipality-name-before-ward', originalPath: officialPath } };
    byId.set(id, node); result.push(node); return node;
  }
  for (const region of regions.filter(r => r.code !== '00')) {
    const pref = add(region.code, region.name, region.name_ja, 'prefecture', region.code, root, [region.name_ja]);
    for (const land of region.land || []) {
      const ja = land.ja || land.n, cn = land.n || ja, match = ja.match(/^(.+市)(.+区)$/), cnMatch = cn.match(/^(.+市)(.+区)$/);
      let parent = pref, names = [region.name_ja], name = cn, nameJa = ja;
      if (match) { parent = add(region.code, cnMatch?.[1] || match[1], match[1], 'city', null, pref, [...names, match[1]]); names.push(match[1]); name = cnMatch?.[2] || match[2]; nameJa = match[2]; }
      const kind = match ? 'ward' : /区$/.test(ja) && region.code === '13' ? 'special_ward' : /市$/.test(ja) ? 'city' : /町$/.test(ja) ? 'town' : /村$/.test(ja) ? 'village' : 'unassigned_area';
      add(region.code, name, nameJa, kind, land.code, parent, [...names, nameJa]);
    }
  }
  return result;
}

function fitProjection(stations) {
  const samples = stations.filter(s => Number.isFinite(s.longitude) && Number.isFinite(s.latitude) && Number.isFinite(s.x) && Number.isFinite(s.y));
  const fit = (key, outputKey) => {
    const n = samples.length, mx = samples.reduce((a, s) => a + s[key], 0) / n, my = samples.reduce((a, s) => a + s[outputKey], 0) / n;
    const scale = samples.reduce((a, s) => a + (s[key] - mx) * (s[outputKey] - my), 0) / samples.reduce((a, s) => a + (s[key] - mx) ** 2, 0);
    return { scale, offset: my - mx * scale };
  };
  const x = fit('longitude', 'x'), y = fit('latitude', 'y');
  const maxResidual = Math.max(...samples.map(s => Math.hypot(s.x - (s.longitude * x.scale + x.offset), s.y - (s.latitude * y.scale + y.offset))));
  if (!Number.isFinite(maxResidual) || maxResidual > 0.1) throw new Error(`地图来源坐标转换不一致：${maxResidual}`);
  return { crs: 'japan-map-v3-local', xScale: x.scale, xOffset: x.offset, yScale: y.scale, yOffset: y.offset, method: 'linear-fit-to-published-map-station-coordinates', samples: samples.length, maxResidualMapUnits: maxResidual };
}

export function parseWorldbook(book) {
  const chunks = [];
  for (const entry of Object.values(book.entries || {})) {
    const match = String(entry.content || '').match(/\/\* JPF-DATA:v1\s*([\s\S]*?)\*\//);
    if (match) chunks.push(JSON.parse(match[1].replace(/\s*JPF-DATA-END\s*$/, '').trim()));
  }
  return chunks;
}

async function splitPoints(code, points) {
  const tiles = new Map(), parts = [], folder = `poi-${code}`;
  await fs.mkdir(path.join(output, folder), { recursive: true });
  for (const row of points) { const key = `${Math.floor(row[0] / 1024)}_${Math.floor(row[1] / 1024)}`; if (!tiles.has(key)) tiles.set(key, []); tiles.get(key).push(row); }
  function partition(rows) {
    if (rows.length <= 20000) return [rows];
    const bounds = rows.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[0]), Math.max(b[3], r[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const axis = bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? 0 : 1;
    rows.sort((a, b) => a[axis] - b[axis] || a[1 - axis] - b[1 - axis] || String(a[3]).localeCompare(String(b[3])));
    const middle = Math.floor(rows.length / 2); return [...partition(rows.slice(0, middle)), ...partition(rows.slice(middle))];
  }
  for (const [key, rows] of [...tiles].sort(([a], [b]) => a.localeCompare(b))) {
    const chunks = partition(rows);
    for (let i = 0; i < chunks.length; i++) {
      const slice = chunks[i], filename = `${folder}/${key}_${i}.json.gz`;
      const body = Buffer.from(JSON.stringify({ rows: slice })), packed = gzipSync(body, { level: 6 });
      await fs.writeFile(path.join(output, filename), packed);
      parts.push({ path: filename, count: slice.length, bytes: packed.length, jsonBytes: body.length, sha256: hash(packed), bounds: [Math.min(...slice.map(r => r[0])), Math.min(...slice.map(r => r[1])), Math.max(...slice.map(r => r[0])), Math.max(...slice.map(r => r[1]))], municipalities: [...new Set(slice.map(r => r[5]))] });
    }
  }
  return parts;
}

async function baseData() {
  try { return await readJson(path.join(project, 'data/base.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const release = await readJson(path.resolve(project, '../交付/酒馆助手脚本-Living Japan重构版_v3.6.json'));
  const match = release.content.match(/var DATA = (.+);\r?\n/);
  if (!match) throw new Error('正式 v3.6 DATA 未找到');
  return JSON.parse(match[1]);
}

export async function buildNational() {
  await fs.mkdir(output, { recursive: true });
  const base = await baseData();
  const binPath = path.join(sourceRoot, '日本全域地图-分区数据-v3.0.0.bin');
  const file = await fs.open(binPath, 'r'); const header = Buffer.alloc(12); await file.read(header, 0, 12, 0);
  if (header.subarray(0, 8).toString() !== 'JPMAP01\n') throw new Error('全国数据格式不符');
  const length = header.readUInt32LE(8), indexBytes = Buffer.alloc(length); await file.read(indexBytes, 0, length, 12);
  const sourceIndex = JSON.parse(indexBytes), regions = [], adminRegions = []; let projection;
  try {
    for (const entry of sourceIndex.regions) {
      const bytes = Buffer.alloc(entry.bytes); await file.read(bytes, 0, bytes.length, 12 + length + entry.offset);
      if (hash(bytes) !== entry.sha256) throw new Error(`原始分包损坏：${entry.code}`);
      const raw = JSON.parse(gunzipSync(bytes));
      if (raw.poi.list.length !== entry.poi) throw new Error(`地点条数不一致：${entry.code}`);
      if (entry.code === '00') projection = fitProjection(raw.transport.stations);
      adminRegions.push({ code: entry.code, name: entry.name, name_ja: entry.name_ja, land: raw.geo.land.map(({ code, n, ja }) => ({ code, n, ja })) });
      const poiParts = await splitPoints(entry.code, raw.poi.list);
      // Only the geographic resource is published: no legacy script, characters, tasks or interiors.
      const clean = { region: raw.region, geo: { land: raw.geo.land, rivers: raw.geo.rivers, bounds: raw.geo.bounds, labels: raw.geo.labels, parkPolys: raw.geo.parkPolys }, roads: raw.roads, subs: raw.subs,
        poi: { cats: raw.poi.cats, list: [] }, transport: { stations: raw.transport.stations, railways: raw.transport.railways }, meta: raw.meta };
      const json = Buffer.from(JSON.stringify(clean)), packed = gzipSync(json, { level: 9 }), filename = `region-${entry.code}.json.gz`;
      if (packed.length >= 95 * 1024 * 1024) throw new Error(`分包超过发布单文件上限：${filename}`);
      await fs.writeFile(path.join(output, filename), packed);
      regions.push({ code: entry.code, name: entry.name, nameJa: entry.name_ja, mapPath: filename, poiCount: raw.poi.list.length, stationCount: raw.transport.stations.length,
        bytes: packed.length, jsonBytes: json.length, sha256: hash(packed), sourceSha256: entry.sha256, poiParts, version: '3.0.0' });
      console.log(`地区 ${entry.code}：${raw.poi.list.length} 个展示记录，${packed.length} 字节`);
    }
  } finally { await file.close(); }
  const clothingPath = path.join(workspace, '服装世界书与配套插件_全目录完善版_v1_3_0_20260909/日本日常服装世界书_全目录完善版_v1_3_0_20260909.json');
  const clothingBytes = await fs.readFile(clothingPath), chunks = parseWorldbook(JSON.parse(clothingBytes.toString('utf8').replace(/^\uFEFF/, '')));
  const brands = (chunks.find(c => c.id === 'brands')?.items || []).map(({ id, name, aliases, category, source, checkedAt, coverage }) => ({ id, name, aliases, category, source, checkedAt, coverage }));
  let storeCount = 0, locatedStores = 0; const storeIds = new Set();
  for (const chunk of chunks.filter(c => /^stores\d\d$/.test(c.id))) {
    const code = chunk.id.slice(-2), spec = regions.find(r => r.code === code), name = `stores-${code}.json`;
    for (const store of chunk.items) { if (storeIds.has(store.id)) throw new Error(`门店ID重复：${store.id}`); storeIds.add(store.id); if (Number.isFinite(store.longitude) && Number.isFinite(store.latitude)) locatedStores++; }
    const body = JSON.stringify({ version: '1.3.0', checkedAt: '2026-09-07', regionCode: code, stores: chunk.items });
    await fs.writeFile(path.join(output, name), body); spec.storesPath = name; spec.storeCount = chunk.items.length; spec.storesSha256 = hash(body); storeCount += chunk.items.length;
  }
  if (regions.length !== 48 || storeCount !== 12656) throw new Error('全国分包或服装记录数未保全');
  await writeJson('brands.json', { version: '1.3.0', brands });
  const adminNodes = deriveAdministration(adminRegions, base);
  const views = [await buildMetroView(regions)];
  const sources = await readJson(path.join(sourceRoot, '来源记录.json'));
  await writeJson('sources.json', { map: sources, mapInput: { name: path.basename(binPath), bytes: (await fs.stat(binPath)).size }, clothing: { name: path.basename(clothingPath), bytes: clothingBytes.length, sha256: hash(clothingBytes), checkedAt: '2026-09-07', reference: 'Per-store source, otherSources and address evidence retained.' },
    pbf: { name: '日本全域地图japan-261027.osm.pbf', bytes: (await fs.stat(path.join(workspace, '日本全域地图japan-261027.osm.pbf'))).size, included: false, processed: false, purpose: 'Future offline geographic source; existing nationwide packages used in this release.' } });
  await fs.cp(path.join(sourceRoot, 'licenses'), path.join(output, 'licenses'), { recursive: true });
  await writeJson('manifest.json', { schemaVersion: 1, version: '2026-10-29.1', mapVersion: '3.0.0', rootId: 'admin:jp', navigationRegions: buildNavigationRegions(), defaultView: 'metro', projection, regions, views, adminNodes,
    counts: { regionPackages: regions.length, poiRecords: regions.reduce((n, r) => n + r.poiCount, 0), clothingRecords: storeCount, locatedClothingRecords: locatedStores, unlocatedClothingRecords: storeCount - locatedStores, brands: brands.length },
    identities: { poi: 'map:<database_namespace>:<database_id>; zero uses exact source name/coordinate/address identity', store: 'clothing:<source store id>', station: 'rail:<source station id>', noCrossSourceMerge: true },
    policy: { geographicDataIsNotProse: true, sourceRecordsAreNotUniqueNationalEntities: true, pbfIncluded: false, runtimeRegionCache: 2, runtimePointBlockCache: 4, pointBlockMaxRecords: 20000, bodyBaseline: 'Living Japan v3.6', sources: 'sources.json' } });
  console.log(JSON.stringify({ regions: regions.length, adminNodes: adminNodes.length, stores: storeCount, locatedStores, projection }, null, 2));
}

export async function buildMetroView(regions) {
  const codes = ['13', '14', '11', '12'], land = [], rivers = [], parks = [], labels = [], stations = new Map(), railways = new Map(), coverage = [], stores = new Map();
  for (const code of codes) {
    const spec = regions.find(r => r.code === code), raw = JSON.parse(gunzipSync(await fs.readFile(path.join(output, spec.mapPath))));
    coverage.push({ code, bounds: raw.region.defaultBounds });
    land.push(...raw.geo.land); rivers.push(...raw.geo.rivers); parks.push(...(raw.geo.parkPolys || [])); labels.push(...(raw.geo.labels || []));
    for (const s of raw.transport.stations) stations.set(s.id, s);
    for (const r of raw.transport.railways) railways.set(r.id, r);
    const storeData = await readJson(path.join(output, spec.storesPath)); for (const store of storeData.stores) stores.set(store.id, { ...store, regionCode: code });
  }
  const defaultBounds = [Math.min(...coverage.map(r => r.bounds[0])), Math.min(...coverage.map(r => r.bounds[1])), Math.max(...coverage.map(r => r.bounds[2])), Math.max(...coverage.map(r => r.bounds[3]))];
  const release = await readJson(path.resolve(project, '../交付/酒馆助手脚本-Living Japan重构版_v3.6.json'));
  const fullBase = JSON.parse(release.content.match(/var DATA = (.+);\r?\n/)[1]), schematic = fullBase.transitMap;
  const stationLookup = new Map(schematic.stations.map(s => [s.id, s]));
  const diagram = { bounds: [Math.min(...schematic.stations.map(s => s.x)) - 60, Math.min(...schematic.stations.map(s => s.y)) - 60, Math.max(...schematic.stations.map(s => s.x)) + 100, Math.max(...schematic.stations.map(s => s.y)) + 80],
    stations: schematic.stations.map(s => ({ id: `place:station:${s.id}`, name: s.label, nameJa: s.nameJa, x: s.x, y: s.y })),
    lines: schematic.lines.map(line => ({ id: line.id, name: line.label, color: line.color, closed: line.closed, points: line.stationIds.map(id => stationLookup.get(id)).filter(Boolean).map(s => [s.x, s.y]) })) };
  const clean = { region: { code: 'metro', name: '首都圈', defaultBounds, coverage }, geo: { land, rivers, parkPolys: parks, labels, bounds: defaultBounds }, roads: [], poi: { cats: '', list: [] }, transport: { stations: [...stations.values()], railways: [...railways.values()] }, schematic: diagram, meta: { version: '3.0.0', viewOnly: true, sourceRegions: codes } };
  const json = Buffer.from(JSON.stringify(clean)), packed = gzipSync(json, { level: 9 });
  await fs.writeFile(path.join(output, 'view-metro.json.gz'), packed);
  await writeJson('stores-metro.json', { version: '1.3.0', stores: [...stores.values()] });
  return { code: 'metro', name: '首都圈', nameJa: '首都圏', mapPath: 'view-metro.json.gz', storesPath: 'stores-metro.json', regionCodes: codes, poiCount: 0, stationCount: stations.size, storeCount: stores.size, bytes: packed.length, jsonBytes: json.length, sha256: hash(packed), coverage, purpose: 'Light initial geography; detailed POIs stay in prefecture packages.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildNational();
