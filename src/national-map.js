import { projectCoordinates } from './catalog.js';

// LJ-NATIONAL-MAP-01: canvas viewport; selection and name append are separate actions.
export function createNationalMap(container, { catalog, onSelect = () => {}, onAppend = () => {}, onError = () => {} } = {}) {
  if (!container || !catalog) throw new Error('地图缺少容器或资料目录');
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.setAttribute('aria-label', 'Living Japan 地图，可拖动、缩放和选择地点');
  canvas.setAttribute('role', 'img');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' });
  if (!container.style.position) container.style.position = 'relative';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d'), handlers = [], paths = new Map(), overlayPaths = new Map(), touches = new Map();
  let width = 800, height = 500, center = [0, 0], scale = 1, detail = 'standard', mode = 'detail', code = 'metro', map = null, focusRegionCode = null;
  let selected = null, route = [null, null], visible = [], roads = [], dead = false, regionEpoch = 0, viewEpoch = 0, pendingRefresh = null, frame = null;
  let drag = null, lastTouch = null, pinch = null, suppressDoubleClickUntil = 0, refreshDeferred = false, labelHits = [];
  let overlays = null;
  const frameRequest = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
  const frameCancel = globalThis.cancelAnimationFrame || clearTimeout;
  const xy = entity => {
    if (mode === 'schem' && map?.schematic) {
      const station = map.schematic.stations.find(s => s.id === entity?.id || s.id === entity?.legacyPlaceId);
      return station ? [station.x, station.y] : null;
    }
    return projectCoordinates(entity?.coordinates, catalog.projection());
  };
  const screen = point => [(point[0] - center[0]) * scale + width / 2, (point[1] - center[1]) * scale + height / 2];
  const world = point => [(point[0] - width / 2) / scale + center[0], (point[1] - height / 2) / scale + center[1]];
  const bounds = () => [center[0] - width / scale / 2, center[1] - height / scale / 2, center[0] + width / scale / 2, center[1] + height / scale / 2];
  const localPoint = event => { const r = canvas.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top]; };
  const path = (d, cache = paths) => { if (typeof Path2D === 'undefined') return null; if (!cache.has(d)) cache.set(d, new Path2D(d)); return cache.get(d); };
  function drawPath(record, fill, stroke, strokeWidth, cache = paths) {
    const p = path(record.d, cache); if (!p) return;
    if (fill) { ctx.fillStyle = fill; ctx.fill(p); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth / scale; ctx.stroke(p); }
  }
  // LJ-MAP-LABELS-01: fixed geographic label anchors and full-text hit targets.
  const labelCell = (point, pixelWidth, pixelHeight) => {
    const w = 2 ** Math.ceil(Math.log2(pixelWidth / scale)), h = 2 ** Math.ceil(Math.log2(pixelHeight / scale));
    return `${Math.floor(point[0] / w)},${Math.floor(point[1] / h)}`;
  };
  function dot(entity, active = false, label = false, color = null, text = entity.name || '') {
    const p = xy(entity); if (!p) return;
    const [x, y] = screen(p); if (x < -200 || y < -30 || x > width + 200 || y > height + 30) return;
    const radius = active ? 7 : entity.type === '车站' ? 3.5 : 3;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = color || (active ? '#a74d5b' : entity.type === '车站' ? '#658070' : '#8d7c6b'); ctx.fill();
    if (active) { ctx.strokeStyle = '#fffaf5'; ctx.lineWidth = 2; ctx.stroke(); }
    if (label || active) {
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(255,252,248,.92)'; ctx.fillRect(x + 9, y - 10, textWidth + 8, 21);
      ctx.fillStyle = active ? '#723b45' : '#665d56'; ctx.fillText(text, x + 13, y + 5);
      labelHits.push({ entity, left: x + 9, right: x + textWidth + 17, top: y - 10, bottom: y + 11 });
    }
  }
  function render() {
    frame = null; if (dead) return; labelHits = [];
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#edf0eb'; ctx.fillRect(0, 0, width, height);
    if (!map) return;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (width / 2 - center[0] * scale), ratio * (height / 2 - center[1] * scale));
    if (mode === 'schem' && map.schematic) {
      ctx.fillStyle = '#faf6ef';
      for (const line of map.schematic.lines) {
        ctx.beginPath(); line.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (line.closed) ctx.closePath();
        ctx.strokeStyle = line.color || '#8b9b78'; ctx.lineWidth = 3 / scale; ctx.stroke();
      }
    } else {
      if (mode !== 'schem') {
        for (const land of map.land || []) drawPath(land, '#faf6ef', null, 0);
        for (const park of map.parks || []) drawPath(park, '#dfe8d4', null, 0);
        for (const river of (map.rivers || []).filter(r => mode !== 'map' || !r.w || r.w >= 4)) drawPath(river, null, '#b7cfd1', 1.6);
      }
      const usePbf = mode !== 'schem' && map.pbfRailways;
      const rails = usePbf ? [] : mode === 'map' ? (map.railways || []).filter(r => /山手|中央|東海道|东海道|東北|东北|総武|总武|京浜|京滨/.test(r.n)) : map.railways || [];
      for (const rail of rails) drawPath(rail, null, rail.c || '#a9aca2', mode === 'schem' ? 2.4 : 0.8);
      if (mode === 'ultra') for (const road of roads) drawPath(road, null, '#d5c9b6', 1);
      // LJ-PBF-RENDER-01: verified lines replace old rail strokes; viewport paths are disposable.
      if (mode !== 'schem') {
        for (const boundary of overlays?.boundaries || []) drawPath(boundary, null, boundary.adminLevel === 4 ? '#c6c1b5' : '#d5d0c5', boundary.adminLevel === 4 ? 0.9 : 0.6, overlayPaths);
        if (usePbf && overlays?.railwaysActive) for (const rail of overlays.railways) {
          const color = { rail: '#a9aca2', subway: '#9c7d6b', light_rail: '#658070', tram: '#8d7c6b' }[rail.kind] || '#a9aca2';
          const branch = rail.service && rail.service !== 'main';
          drawPath(rail, null, branch ? '#b7b9b0' : color, branch ? 0.55 : rail.kind === 'subway' ? 1.1 : 0.9, overlayPaths);
        }
      }
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.font = '13px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    if (mode !== 'schem') {
      const labelCells = new Set(); ctx.fillStyle = '#78756b';
      for (const label of map.labels || []) {
        const point = [label.x, label.y], [x, y] = screen(point), cell = labelCell(point, 110, 32);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > width - 25 || y < 14 || y > height || labelCells.has(cell)) continue;
        labelCells.add(cell); ctx.fillText(label.n || '', x, y);
      }
      for (const park of map.parks || []) {
        if (!park.n || !Number.isFinite(park.x) || !Number.isFinite(park.y) || park.a * scale * scale < 500 || (mode === 'map' && park.a < 300)) continue;
        const [x, y] = screen([park.x, park.y]); if (x < 0 || x > width || y < 0 || y > height) continue;
        const left = x - ctx.measureText(park.n).width / 2;
        ctx.strokeStyle = '#faf8f2'; ctx.lineWidth = 3; ctx.strokeText(park.n, left, y + 5);
        ctx.fillStyle = '#748067'; ctx.fillText(park.n, left, y + 5);
      }
    }
    const a = xy(route[0]), b = xy(route[1]);
    if (a && b) {
      const [ax, ay] = screen(a), [bx, by] = screen(b); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = '#9c7d6b'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#776355'; ctx.fillText('端点连线', (ax + bx) / 2 + 5, (ay + by) / 2 - 5);
    }
    const labeled = new Set();
    const namesVisible = mode === 'schem' || (mode !== 'map' && (scale >= 0.6 || detail === 'fine' || detail === 'detailed'));
    for (const e of visible) {
      const point = xy(e); if (!point) continue; const cell = labelCell(point, 130, 28);
      const showLabel = namesVisible && !labeled.has(cell); if (showLabel) labeled.add(cell);
      dot(e, false, showLabel);
    }
    for (const [i, entity] of route.entries()) if (entity) dot(entity, true, true, '#7a8a68', `${i ? '终点' : '起点'} · ${entity.name}`);
    if (selected) dot(selected, true, true);
  }
  function schedule() { if (frame == null && !dead) frame = frameRequest(render); }
  async function refresh() {
    if (!map || dead) return;
    if (touches.size) { refreshDeferred = true; return; }
    const epoch = ++viewEpoch, region = code, rect = bounds();
    try {
      if (mode === 'schem' && map.schematic) {
        visible = map.schematic.stations.map(s => catalog.schematicEntity?.(s.id) || { id: s.id, legacyPlaceId: s.id, name: s.name, type: '车站', coordinates: { x: s.x, y: s.y } }); roads = []; schedule(); return;
      }
      const result = await catalog.viewport(region, rect, { detail, mode, focusRegionCode, scale, limit: detail === 'detailed' ? 1000 : detail === 'fine' ? 700 : 350 });
      if (dead || epoch !== viewEpoch || region !== code) return;
      if (touches.size) { refreshDeferred = true; return; }
      visible = result.entities; roads = result.roads || [];
      if (!overlays?.cacheKey || overlays.cacheKey !== result.overlays?.cacheKey) overlayPaths.clear();
      overlays = result.overlays || null; schedule();
    } catch (error) { if (!dead && epoch === viewEpoch) onError(error); }
  }
  function changed() { ++viewEpoch; schedule(); if (pendingRefresh) clearTimeout(pendingRefresh); pendingRefresh = setTimeout(() => { pendingRefresh = null; refresh(); }, 100); }
  function resize() {
    const box = container.getBoundingClientRect(); width = Math.max(1, box.width); height = Math.max(1, box.height);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); changed();
  }
  function fit() {
    if (!map) return;
    const [x1, y1, x2, y2] = mode === 'schem' && map.schematic ? map.schematic.bounds : map.defaultBounds || map.bounds || [0, 0, 1000, 1000];
    center = [(x1 + x2) / 2, (y1 + y2) / 2]; scale = Math.max(0.0001, Math.min(width / Math.max(1, x2 - x1), height / Math.max(1, y2 - y1)) * 0.92); changed();
  }
  function zoom(delta, anchor = [width / 2, height / 2]) {
    const before = world(anchor); scale = Math.max(0.0001, Math.min(120, scale * Math.exp(delta * 0.25)));
    const after = world(anchor); center[0] += before[0] - after[0]; center[1] += before[1] - after[1]; changed();
  }
  function hit(point) {
    for (const e of [selected, ...route.slice().reverse(), ...visible.slice().reverse()].filter(Boolean)) {
      const p = xy(e); if (!p) continue;
      const s = screen(p), radius = e === selected || route.includes(e) ? 7 : e.type === '车站' ? 3.5 : 3;
      if (Math.hypot(s[0] - point[0], s[1] - point[1]) <= radius) return e;
    }
    for (let i = labelHits.length - 1; i >= 0; i--) {
      const label = labelHits[i];
      if (point[0] >= label.left && point[0] <= label.right && point[1] >= label.top && point[1] <= label.bottom) return label.entity;
    }
    let closest = null, distance = 18;
    for (const e of [selected, ...visible].filter(Boolean)) { const p = xy(e); if (!p) continue; const s = screen(p), d = Math.hypot(s[0] - point[0], s[1] - point[1]); if (d < distance) { closest = e; distance = d; } }
    return closest;
  }
  function selectLocal(entity) { selected = entity; schedule(); onSelect(entity); }
  const listen = (name, handler, options) => { canvas.addEventListener(name, handler, options); handlers.push([name, handler, options]); };
  listen('wheel', event => { event.preventDefault(); zoom(-Math.sign(event.deltaY), localPoint(event)); }, { passive: false });
  listen('pointerdown', event => {
    const p = localPoint(event); touches.set(event.pointerId, p); canvas.setPointerCapture?.(event.pointerId);
    drag = { id: event.pointerId, start: p, point: p, moved: false }; canvas.style.cursor = 'grabbing';
    if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; }
  });
  listen('pointermove', event => {
    if (!touches.has(event.pointerId)) return; const p = localPoint(event); touches.set(event.pointerId, p);
    if (touches.size === 2 && pinch) {
      const [a, b] = [...touches.values()], distance = Math.hypot(a[0] - b[0], a[1] - b[1]), middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (distance > 0 && pinch.distance > 0) zoom(Math.log(distance / pinch.distance) * 4, middle); pinch = { distance, center: middle }; if (drag) drag.moved = true; return;
    }
    if (drag?.id !== event.pointerId) return;
    if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 4) drag.moved = true;
    center[0] -= (p[0] - drag.point[0]) / scale; center[1] -= (p[1] - drag.point[1]) / scale; drag.point = p; changed();
  });
  const pointerEnd = event => {
    const was = drag; touches.delete(event.pointerId); canvas.releasePointerCapture?.(event.pointerId); if (touches.size < 2) pinch = null;
    if (was?.id === event.pointerId && !was.moved && event.type !== 'pointercancel') {
      const entity = hit(localPoint(event)); if (entity) {
        selectLocal(entity);
        if (event.pointerType === 'touch') { const now = Date.now(); if (lastTouch?.id === entity.id && now - lastTouch.time < 350) { onAppend(entity); suppressDoubleClickUntil = now + 500; lastTouch = null; } else lastTouch = { id: entity.id, time: now }; }
      }
    }
    drag = null; canvas.style.cursor = 'grab';
    if (!touches.size && (was?.moved || refreshDeferred)) { refreshDeferred = false; changed(); }
  };
  listen('pointerup', pointerEnd); listen('pointercancel', pointerEnd);
  listen('dblclick', event => { event.preventDefault(); if (Date.now() < suppressDoubleClickUntil) return; const entity = hit(localPoint(event)); if (entity) { selectLocal(entity); onAppend(entity); } });
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; observer?.observe(container);
  resize();
  async function setRegion(nextCode) {
    const epoch = ++regionEpoch; code = String(nextCode).padStart(2, '0'); const requested = code; ++viewEpoch;
    map = null; visible = []; roads = []; labelHits = []; overlays = null; overlayPaths.clear(); schedule();
    try {
      const result = await catalog.loadRegion(requested); if (dead || epoch !== regionEpoch) return null;
      map = result.map; paths.clear(); visible = []; roads = []; fit(); await refresh(); return result;
    } catch (error) { if (!dead && epoch === regionEpoch) onError(error); throw error; }
  }
  function setMode(value) {
    if (!['schem', 'map', 'detail', 'ultra'].includes(value)) return;
    const coordinateChange = (mode === 'schem') !== (value === 'schem'); mode = value; ++viewEpoch; roads = []; overlays = null; overlayPaths.clear();
    if (coordinateChange) fit(); else changed(); refresh();
  }
  async function locate(entity) {
    if (!entity || dead) return;
    focusRegionCode = entity.regionCode;
    if (entity.regionCode && entity.regionCode !== code && !(code === 'metro' && ['11', '12', '13', '14'].includes(entity.regionCode))) await setRegion(entity.regionCode);
    if (dead) return;
    if (mode === 'schem' && map?.schematic && !map.schematic.stations.some(s => s.id === entity.id || s.id === entity.legacyPlaceId)) setMode('detail');
    const p = xy(entity); if (p) { center = p; scale = Math.max(scale, mode === 'schem' ? 1 : 1.6); changed(); } await refresh();
  }
  return { setRegion,
    async select(entity, { locate: shouldLocate = true } = {}) {
      if (!entity) { selected = null; schedule(); return; }
      if (shouldLocate) await locate(entity); if (!dead) selectLocal(entity);
    },
    locate, setMode,
    setRoute(origin, destination) { route = [origin, destination]; schedule(); }, zoom, fit,
    setDetail(value) { const names = { 0: 'overview', 1: 'standard', 2: 'fine', 3: 'detailed' }; detail = names[value] || (['overview', 'standard', 'fine', 'detailed'].includes(value) ? value : 'standard'); changed(); },
    getView: () => ({ regionCode: code, center: [...center], scale, detail, mode, selectedId: selected?.id || null }),
    async setView(value) { if (value.regionCode && value.regionCode !== code) await setRegion(value.regionCode); if (value.mode) mode = value.mode; if (Array.isArray(value.center)) center = [...value.center]; if (Number.isFinite(value.scale) && value.scale > 0) scale = value.scale; if (value.detail) detail = value.detail; changed(); await refresh(); },
    destroy() { dead = true; ++regionEpoch; ++viewEpoch; observer?.disconnect(); if (frame != null) frameCancel(frame); if (pendingRefresh) clearTimeout(pendingRefresh); for (const args of handlers) canvas.removeEventListener(...args); canvas.remove(); paths.clear(); overlayPaths.clear(); overlays = null; visible = []; map = null; } };
}
