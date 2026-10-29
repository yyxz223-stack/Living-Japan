// LJ-EXT-LEGACY-MODULE
const isolatedModule = { exports: {} };
const isolatedRoot = {};
(function(module, exports, globalThis, self, window) {
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.LivingJapanTransitTime = api;
    root.LivingJapanTransitTimeV3 = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EARTH_RADIUS_KM = 6371.0088;
  var WEB_MERCATOR_RADIUS_M = 6378137;
  // LJ001-V3-GRID-RAIL-TIME: rail uses materialized adjacent edges; other modes share the offline road grid.

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function round(value, digits) {
    var scale = Math.pow(10, digits || 0);
    return Math.round(value * scale) / scale;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function radians(value) {
    return value * Math.PI / 180;
  }

  function haversineKm(left, right) {
    if (!left || !right) return NaN;
    var lat1 = finite(left.latitude !== undefined ? left.latitude : left.lat, NaN);
    var lon1 = finite(left.longitude !== undefined ? left.longitude : left.lon, NaN);
    var lat2 = finite(right.latitude !== undefined ? right.latitude : right.lat, NaN);
    var lon2 = finite(right.longitude !== undefined ? right.longitude : right.lon, NaN);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return NaN;
    var deltaLat = radians(lat2 - lat1);
    var deltaLon = radians(lon2 - lon1);
    var first = radians(lat1);
    var second = radians(lat2);
    var value = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(first) * Math.cos(second) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(value)));
  }

  function normalizeMode(value) {
    var mode = String(value || '').toLowerCase();
    if (mode === 'transit' || mode === 'public_transit' || mode === 'public-transport') return 'public_transit';
    if (mode === 'driving' || mode === 'drive' || mode === 'car') return 'driving';
    if (mode === 'walking' || mode === 'walk' || mode === 'foot') return 'walking';
    if (mode === 'bicycle' || mode === 'bike' || mode === 'cycling') return 'bicycle';
    return '';
  }

  function canonicalContextKind(value) {
    if (value === 'bridge' || value === 'named_bridge' || value === 'famous_bridge') return 'famous_bridge';
    if (value === 'expressway' || value === 'famous_expressway') return 'famous_expressway';
    if (value === 'road' || value === 'famous_road') return 'famous_road';
    if (value === 'tunnel' || value === 'famous_tunnel') return 'famous_tunnel';
    if (value === 'bay' || value === 'famous_bay') return 'famous_bay';
    if (value === 'port' || value === 'famous_port') return 'famous_port';
    if (value === 'pier' || value === 'famous_pier') return 'famous_pier';
    if (value === 'ferry' || value === 'ferry_crossing') return 'ferry_crossing';
    return '';
  }

  function exactVerifiedWaypointKind(value) {
    return value === 'famous_bridge' || value === 'famous_expressway' || value === 'famous_road' ||
      value === 'famous_tunnel' || value === 'famous_bay' || value === 'famous_port' ||
      value === 'famous_pier' || value === 'ferry_crossing'
      ? value
      : '';
  }

  function waypointKindAllowedForMode(mode, kind) {
    if (mode === 'driving') return [
      'famous_bridge', 'famous_expressway', 'famous_road', 'famous_tunnel',
      'famous_bay', 'famous_port', 'famous_pier', 'ferry_crossing'
    ].indexOf(kind) >= 0;
    if (mode === 'walking' || mode === 'bicycle') return [
      'famous_bridge', 'famous_road', 'famous_tunnel', 'famous_bay',
      'famous_port', 'famous_pier', 'ferry_crossing'
    ].indexOf(kind) >= 0;
    return false;
  }

  function coordinateObject(value) {
    if (Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      return { longitude: Number(value[0]), latitude: Number(value[1]) };
    }
    if (!value || typeof value !== 'object') return null;
    var longitude = finite(value.longitude !== undefined ? value.longitude : value.lon, NaN);
    var latitude = finite(value.latitude !== undefined ? value.latitude : value.lat, NaN);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? { longitude: longitude, latitude: latitude }
      : null;
  }

  function createIndexes(data) {
    var stationById = new Map();
    var canonicalStationById = new Map();
    var areaById = new Map();
    var lineById = new Map();
    var edgeById = new Map();
    var adjacency = new Map();
    var cellById = new Map();
    var pairByDirectedKey = new Map();
    var contextRecordById = new Map();

    array(data && data.stationAnchors).forEach(function (station) {
      if (!station || !station.stationId) return;
      var canonicalId = String(station.stationId);
      canonicalStationById.set(canonicalId, station);
      [station.stationId, station.mapStationId, station.railStationId].concat(array(station.aliases)).forEach(function (id) {
        if (id !== undefined && id !== null && String(id)) stationById.set(String(id), station);
      });
      adjacency.set(canonicalId, []);
    });
    array(data && data.areaAnchors).forEach(function (area) {
      if (area && area.areaId) areaById.set(String(area.areaId), area);
    });
    array(data && data.railNetwork && data.railNetwork.lines).forEach(function (line) {
      if (line && line.lineId) lineById.set(String(line.lineId), line);
    });
    array(data && data.railNetwork && data.railNetwork.edges).forEach(function (edge) {
      if (!edge || !edge.edgeId) return;
      var from = String(edge.fromStationId || '');
      var to = String(edge.toStationId || '');
      if (!adjacency.has(from) || !adjacency.has(to)) return;
      edgeById.set(String(edge.edgeId), edge);
      adjacency.get(from).push({ edge: edge, nextStationId: to, forward: true });
      adjacency.get(to).push({ edge: edge, nextStationId: from, forward: false });
    });
    array(data && data.railNetwork && data.railNetwork.transferLinks).forEach(function (edge) {
      if (!edge || !edge.edgeId || edge.kind !== 'station_internal_transfer') return;
      var from = String(edge.fromStationId || '');
      var to = String(edge.toStationId || '');
      if (!adjacency.has(from) || !adjacency.has(to) || finite(edge.referenceTravelSeconds, 0) <= 0) return;
      edgeById.set(String(edge.edgeId), edge);
      adjacency.get(from).push({ edge: edge, nextStationId: to, forward: true, stationInternalTransfer: true });
      adjacency.get(to).push({ edge: edge, nextStationId: from, forward: false, stationInternalTransfer: true });
    });
    adjacency.forEach(function (records) {
      records.sort(function (left, right) { return String(left.edge.edgeId).localeCompare(String(right.edge.edgeId)); });
    });
    array(data && data.roadGrid && data.roadGrid.cells).forEach(function (cell) {
      if (cell && cell.id) cellById.set(String(cell.id), cell);
    });
    array(data && data.roadGrid && data.roadGrid.pairs).forEach(function (pair) {
      if (!pair || !pair.fromCellId || !pair.toCellId) return;
      pairByDirectedKey.set(String(pair.fromCellId) + '|' + String(pair.toCellId), pair);
      pairByDirectedKey.set(String(pair.toCellId) + '|' + String(pair.fromCellId), pair);
    });
    array(data && data.transportContext && data.transportContext.records).forEach(function (record) {
      if (record && record.transportContextId) contextRecordById.set(String(record.transportContextId), record);
    });
    return {
      data: data || {},
      model: data && data.model || {},
      stationById: stationById,
      canonicalStationById: canonicalStationById,
      stations: Array.from(canonicalStationById.values()),
      areaById: areaById,
      lineById: lineById,
      edgeById: edgeById,
      adjacency: adjacency,
      cellById: cellById,
      pairByDirectedKey: pairByDirectedKey,
      contextRecordById: contextRecordById
    };
  }

  function canonicalStationId(value, indexes) {
    var station = indexes.stationById.get(String(value || ''));
    return station ? String(station.stationId) : '';
  }

  function uniqueStationIds(values, indexes) {
    var seen = new Set();
    return array(values).map(function (value) { return canonicalStationId(value, indexes); }).filter(function (value) {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function averageStationPoint(stationIds, indexes) {
    var stations = uniqueStationIds(stationIds, indexes).map(function (id) {
      return indexes.canonicalStationById.get(id);
    }).filter(Boolean);
    if (!stations.length) return null;
    return {
      longitude: stations.reduce(function (sum, item) { return sum + finite(item.longitude, 0); }, 0) / stations.length,
      latitude: stations.reduce(function (sum, item) { return sum + finite(item.latitude, 0); }, 0) / stations.length,
      regionId: stations[0].regionId || '',
      stationIds: stations.map(function (item) { return String(item.stationId); })
    };
  }

  function resolveEndpointWithIndexes(endpoint, indexes) {
    if (!endpoint || typeof endpoint !== 'object') return null;
    var type = String(endpoint.type || 'place');
    var endpointId = endpoint.id === undefined || endpoint.id === null ? '' : String(endpoint.id);
    var directStation = type === 'station' ? indexes.stationById.get(endpointId) : null;
    if (!directStation && endpoint.stationId) directStation = indexes.stationById.get(String(endpoint.stationId));
    if (directStation) {
      return {
        type: 'station',
        id: String(directStation.stationId),
        sourceId: endpointId || String(directStation.stationId),
        canonicalKey: 'station:' + String(directStation.stationId),
        label: String(endpoint.label || directStation.label || directStation.nameJa || directStation.stationId),
        latitude: finite(directStation.latitude, NaN),
        longitude: finite(directStation.longitude, NaN),
        regionId: String(endpoint.regionId || directStation.regionId || ''),
        areaId: endpoint.areaId || null,
        stationIds: [String(directStation.stationId)],
        quality: 'station_reference',
        precision: directStation.precision || 'official_station_representative_point'
      };
    }

    var stationIds = uniqueStationIds(endpoint.stationIds, indexes);
    var directCoordinates = coordinateObject(endpoint.coordinates) || coordinateObject(endpoint);
    var areaId = endpoint.areaId || (type === 'area' ? endpointId : '');
    var area = areaId ? indexes.areaById.get(String(areaId)) : null;
    var point = directCoordinates;
    var quality = 'exact_coordinate_reference';
    var precision = 'selected_endpoint_coordinate';
    var regionId = String(endpoint.regionId || '');

    if (!point && area) {
      point = coordinateObject(area);
      quality = 'area_reference';
      precision = area.precision || 'representative_neighborhood_only';
      regionId = regionId || String(area.regionId || '');
      if (!stationIds.length) stationIds = uniqueStationIds(area.stationIds, indexes);
    }
    if (!point) {
      var average = averageStationPoint(stationIds, indexes);
      if (average) {
        point = average;
        quality = 'station_reference';
        precision = 'station_anchor_mean';
        regionId = regionId || average.regionId;
      }
    }
    if (!point) return null;
    var relationType = type === 'place' || type === 'object' ? type : type === 'area' ? 'area' : 'place';
    return {
      type: relationType,
      id: endpointId,
      sourceId: endpointId,
      canonicalKey: relationType + ':' + endpointId,
      label: String(endpoint.label || (area && area.label) || endpointId || '地点'),
      latitude: point.latitude,
      longitude: point.longitude,
      regionId: regionId,
      areaId: areaId ? String(areaId) : null,
      stationIds: stationIds,
      quality: quality,
      precision: precision
    };
  }

  function resolveEndpoint(endpoint, data) {
    return resolveEndpointWithIndexes(endpoint, createIndexes(data));
  }

  function sameEndpoint(origin, destination) {
    return Boolean(origin && destination && origin.canonicalKey && origin.canonicalKey === destination.canonicalKey);
  }

  function qualityOf(origin, destination) {
    if (origin.quality === 'area_reference' || destination.quality === 'area_reference') return 'area_reference';
    if (origin.quality === 'exact_coordinate_reference' || destination.quality === 'exact_coordinate_reference') return 'exact_coordinate_reference';
    return 'station_reference';
  }

  function notesFor(origin, destination, data) {
    var notes = [];
    if (qualityOf(origin, destination) === 'area_reference') notes.push('片区尺度粗估：使用片区代表点，不代表具体入口。');
    if (data && data.disclaimer) notes.push(String(data.disclaimer));
    return notes;
  }

  function rangeObject(minimum, maximum, digits) {
    return {
      min: round(Math.max(0, minimum), digits || 0),
      max: round(Math.max(minimum, maximum), digits || 0)
    };
  }

  function relationEndpointKey(endpoint) {
    if (!endpoint || ['station', 'place', 'object'].indexOf(endpoint.type) < 0 || !endpoint.id) return '';
    return endpoint.type + ':' + endpoint.id;
  }

  function collectTransportRecords(source, fallback, target) {
    array(source && source.records).forEach(function (record) {
      if (record && record.transportContextId) target.set(String(record.transportContextId), record);
    });
    ['bridge', 'expressway', 'road', 'tunnel', 'bay', 'port', 'pier', 'ferry'].forEach(function (group) {
      array(source && source[group]).forEach(function (record) {
        if (!record || !record.transportContextId) return;
        var copy = Object.assign({}, record, { kind: canonicalContextKind(record.kind) || canonicalContextKind(group) });
        target.set(String(record.transportContextId), copy);
      });
    });
    if (fallback) fallback.forEach(function (record, id) { if (!target.has(id)) target.set(id, record); });
  }

  function collectRouteRelations(source, fallback) {
    var relations = [];
    array(source && source.routeRelations).forEach(function (relation) { relations.push(relation); });
    ['bridge', 'expressway', 'road', 'tunnel', 'bay', 'port', 'pier', 'ferry'].forEach(function (group) {
      array(source && source[group]).forEach(function (record) {
        array(record && record.routeRelations).forEach(function (relation) { relations.push(relation); });
      });
    });
    if (!relations.length) array(fallback).forEach(function (relation) { relations.push(relation); });
    return relations;
  }

  function verifiedWaypointsFor(mode, origin, destination, request, indexes) {
    var fromKey = relationEndpointKey(origin);
    var toKey = relationEndpointKey(destination);
    if (!fromKey || !toKey) return { waypoints: [], error: '' };
    var source = request && request.transportContext && typeof request.transportContext === 'object'
      ? request.transportContext
      : null;
    var defaultContext = indexes.data.transportContext || {};
    var relations = collectRouteRelations(source, defaultContext.routeRelations);
    var records = new Map();
    collectTransportRecords(source, indexes.contextRecordById, records);
    var matches = relations.filter(function (relation) {
      if (!relation || (relation.status !== 'verified' && relation.status !== 'reference') || !relation.match) return false;
      if (array(relation.match.modes).map(normalizeMode).indexOf(mode) < 0) return false;
      var forward = relation.match.from === fromKey && relation.match.to === toKey;
      var reverse = relation.match.direction === 'both' && relation.match.from === toKey && relation.match.to === fromKey;
      if (!forward && !reverse) return false;
      var evidence = array(relation.evidence);
      var structurallyValid = evidence.length > 0 && evidence.every(function (item) {
        return item && (item.sourceClass === 'official_or_first_party' || item.sourceClass === 'open_routing_reference') && item.sourceId && item.exactText && /^\d{4}-\d{2}-\d{2}$/u.test(String(item.checkedAt || ''));
      });
      if (!structurallyValid) return false;
      if (relation.status === 'verified') return evidence.every(function (item) { return item.sourceClass === 'official_or_first_party'; });
      return evidence.some(function (item) { return item.sourceClass === 'open_routing_reference'; });
    });
    if (matches.length > 1) return { waypoints: [], error: 'ambiguous_route_relation' };
    if (!matches.length) return { waypoints: [], error: '' };
    var relation = matches[0];
    var reverseMatch = relation.match.direction === 'both' && relation.match.from === toKey && relation.match.to === fromKey;
    var seen = new Set();
    var projected = [];
    var orderedWaypoints = array(relation.waypoints).slice();
    if (reverseMatch) orderedWaypoints.reverse();
    orderedWaypoints.forEach(function (waypoint) {
      if (!waypoint || seen.has(String(waypoint.transportContextId || ''))) return;
      var kind = exactVerifiedWaypointKind(waypoint.kind);
      var record = records.get(String(waypoint.transportContextId || ''));
      if (!kind || !waypointKindAllowedForMode(mode, kind) || !record || !record.name || record.routeWaypointEligible !== true) return;
      var recordKind = canonicalContextKind(record.kind);
      if (recordKind && recordKind !== kind) return;
      seen.add(String(waypoint.transportContextId));
      projected.push({
        transportContextId: String(waypoint.transportContextId),
        kind: kind,
        name: String(record.name),
        verified: true,
        sourceId: String(relation.routeRelationId || '')
      });
    });
    return { waypoints: projected, error: '' };
  }

  function resultBase(mode, minutes, distanceKm, method, methodLabel, formula, origin, destination, indexes, request, extra) {
    var waypoints = verifiedWaypointsFor(mode, origin, destination, request || {}, indexes);
    var value = {
      ok: true,
      mode: mode,
      minutes: Math.max(0, Math.round(minutes)),
      distanceKm: Number.isFinite(distanceKm) ? round(distanceKm, 2) : null,
      method: method,
      methodLabel: methodLabel,
      formula: formula,
      quality: qualityOf(origin, destination),
      adjustable: true,
      verifiedWaypoints: waypoints.waypoints,
      origin: { id: origin.id, label: origin.label, areaId: origin.areaId, regionId: origin.regionId, quality: origin.quality },
      destination: { id: destination.id, label: destination.label, areaId: destination.areaId, regionId: destination.regionId, quality: destination.quality },
      notes: notesFor(origin, destination, indexes.data)
    };
    if (waypoints.error) value.waypointStatus = waypoints.error;
    Object.keys(extra || {}).forEach(function (key) { value[key] = extra[key]; });
    return value;
  }

  function gridCellId(longitude, latitude, grid) {
    if (!grid || !array(grid.origin).length || !Number.isFinite(Number(grid.cellDegrees))) return '';
    var column = Math.floor((longitude - Number(grid.origin[0])) / Number(grid.cellDegrees));
    var row = Math.floor((latitude - Number(grid.origin[1])) / Number(grid.cellDegrees));
    var columnPart = column < 0 ? '-' + String(Math.abs(column)).padStart(2, '0') : String(column).padStart(2, '0');
    var rowPart = row < 0 ? '-' + String(Math.abs(row)).padStart(2, '0') : String(row).padStart(2, '0');
    return 'grid_' + columnPart + '_' + rowPart;
  }

  function cellRepresentativePoint(cell) {
    var coordinates = cell && cell.representative && cell.representative.coordinates;
    return Array.isArray(coordinates) ? { longitude: Number(coordinates[0]), latitude: Number(coordinates[1]) } : null;
  }

  function locateRoadCell(endpoint, indexes) {
    var grid = indexes.data.roadGrid && indexes.data.roadGrid.grid;
    var bounds = array(grid && grid.bounds);
    if (bounds.length >= 4 && (
      endpoint.longitude < Number(bounds[0]) || endpoint.longitude > Number(bounds[2]) ||
      endpoint.latitude < Number(bounds[1]) || endpoint.latitude > Number(bounds[3])
    )) return null;
    var expectedId = gridCellId(endpoint.longitude, endpoint.latitude, grid);
    var exact = indexes.cellById.get(expectedId);
    var cellBounds = array(exact && exact.bounds);
    if (cellBounds.length >= 4 && (
      endpoint.longitude < Number(cellBounds[0]) || endpoint.longitude > Number(cellBounds[2]) ||
      endpoint.latitude < Number(cellBounds[1]) || endpoint.latitude > Number(cellBounds[3])
    )) return null;
    return exact ? { cell: exact, snapped: false, snapDistanceKm: 0 } : null;
  }

  function effectiveStraightDistance(origin, destination, indexes) {
    var direct = haversineKm(origin, destination);
    if (!Number.isFinite(direct)) return NaN;
    if (sameEndpoint(origin, destination)) return 0;
    if (direct === 0 && (origin.quality === 'area_reference' || destination.quality === 'area_reference')) {
      return Math.max(0, finite(indexes.model.sameAreaDifferentPoiMinimumDistanceKm, 0.35));
    }
    return direct;
  }

  function roadDistanceReference(mode, origin, destination, indexes) {
    var originCell = locateRoadCell(origin, indexes);
    var destinationCell = locateRoadCell(destination, indexes);
    if (!originCell || !destinationCell) return null;
    var pair = indexes.pairByDirectedKey.get(originCell.cell.id + '|' + destinationCell.cell.id);
    if (!pair) return null;
    var modeReference = pair.modeReferences && pair.modeReferences[mode]
      ? pair.modeReferences[mode]
      : pair;
    var straightKm = effectiveStraightDistance(origin, destination, indexes);
    if (!Number.isFinite(straightKm)) return null;
    var columnGap = Math.abs(finite(originCell.cell.column, 0) - finite(destinationCell.cell.column, 0));
    var rowGap = Math.abs(finite(originCell.cell.row, 0) - finite(destinationCell.cell.row, 0));
    var isLocalPair = columnGap <= 1 && rowGap <= 1;
    var pairRange = array(modeReference.rangeKm);
    var routeKm;
    var distanceRange;
    var basis;
    if (isLocalPair) {
      var leftPoint = cellRepresentativePoint(originCell.cell);
      var rightPoint = cellRepresentativePoint(destinationCell.cell);
      var representativeStraight = haversineKm(leftPoint, rightPoint);
      var factor = originCell.cell.id === destinationCell.cell.id
        ? 1.2
        : clamp(finite(modeReference.referenceRoadKm, straightKm * 1.2) / Math.max(0.2, representativeStraight), 1.05, 1.65);
      routeKm = straightKm * factor;
      if (!sameEndpoint(origin, destination)) routeKm = Math.max(0.3, routeKm);
      if (Number.isFinite(pairRange[0]) && Number.isFinite(pairRange[1])) routeKm = clamp(routeKm, pairRange[0], pairRange[1]);
      distanceRange = rangeObject(routeKm * 0.85, routeKm * 1.22, 2);
      basis = 'same_or_adjacent_grid_endpoint_refinement';
    } else {
      routeKm = finite(modeReference.referenceRoadKm, NaN);
      if (!Number.isFinite(routeKm)) return null;
      var extra = 0;
      distanceRange = Number.isFinite(pairRange[0]) && Number.isFinite(pairRange[1])
        ? rangeObject(pairRange[0] + extra, pairRange[1] + extra, 2)
        : rangeObject(routeKm * 0.8, routeKm * 1.25, 2);
      basis = 'fixed_distant_grid_pair_reference';
    }
    return {
      routeKm: round(routeKm, 2),
      distanceRangeKm: distanceRange,
      straightDistanceKm: round(straightKm, 2),
      gridPair: {
        originCellId: originCell.cell.id,
        destinationCellId: destinationCell.cell.id,
        originCellSnapped: originCell.snapped,
        destinationCellSnapped: destinationCell.snapped,
        basis: basis,
        routeMode: mode
      }
    };
  }

  function zeroResult(mode, origin, destination, indexes, request) {
    var extra = {
      routeDistanceKm: 0,
      distanceRangeKm: { min: 0, max: 0 },
      minutesRange: { min: 0, max: 0 }
    };
    if (mode === 'public_transit') {
      extra.railPath = {
        originStationId: origin.stationIds[0] || null,
        destinationStationId: destination.stationIds[0] || null,
        stationIds: origin.stationIds[0] ? [origin.stationIds[0]] : [],
        edgeIds: [],
        lineSegments: [],
        edgeCount: 0,
        transferCount: 0,
        geometryPaths: [],
        selectionMethod: 'same_endpoint'
      };
    }
    return resultBase(mode, 0, 0, 'same_endpoint', '同一点', '起终点相同', origin, destination, indexes, request, extra);
  }

  function estimateWalking(origin, destination, request, indexes) {
    var distance = roadDistanceReference('walking', origin, destination, indexes);
    if (!distance) return { ok: false, mode: 'walking', error: 'missing_road_grid_pair' };
    var model = indexes.model.walking || {};
    var speed = Math.max(1, finite(model.speedKmh, 4));
    var speedRange = array(model.speedRangeKmh);
    var slow = Math.max(1, finite(speedRange[0], speed * 0.85));
    var fast = Math.max(slow, finite(speedRange[1], speed * 1.15));
    var minutes = distance.routeKm / speed * 60;
    var minutesRange = rangeObject(distance.distanceRangeKm.min / fast * 60, distance.distanceRangeKm.max / slow * 60, 0);
    return resultBase('walking', minutes, distance.routeKm, 'road_grid_walking_reference', '网格道路距离步行粗估',
      distance.routeKm + 'km网格道路距离÷' + speed + 'km/h（正常人偏慢步速）', origin, destination, indexes, request, {
        straightDistanceKm: distance.straightDistanceKm,
        routeDistanceKm: distance.routeKm,
        distanceRangeKm: distance.distanceRangeKm,
        minutesRange: minutesRange,
        referenceSpeedKmh: speed,
        gridPair: distance.gridPair
      });
  }

  function estimateBicycle(origin, destination, request, indexes) {
    var distance = roadDistanceReference('bicycle', origin, destination, indexes);
    if (!distance) return { ok: false, mode: 'bicycle', error: 'missing_road_grid_pair' };
    var model = indexes.model.bicycle || {};
    var speed = Math.max(1, finite(model.speedKmh, 15));
    var speedRange = array(model.speedRangeKmh);
    var slow = Math.max(1, finite(speedRange[0], 12));
    var fast = Math.max(slow, finite(speedRange[1], 18));
    var access = Math.max(0, finite(model.accessParkingMinutes, 4));
    var accessRange = array(model.accessParkingRangeMinutes);
    var minutes = distance.routeKm / speed * 60 + access;
    var minutesRange = rangeObject(
      distance.distanceRangeKm.min / fast * 60 + finite(accessRange[0], 3),
      distance.distanceRangeKm.max / slow * 60 + finite(accessRange[1], 7),
      0
    );
    return resultBase('bicycle', minutes, distance.routeKm, 'road_grid_bicycle_reference', '网格道路距离自行车粗估',
      distance.routeKm + 'km网格道路距离÷' + speed + 'km/h＋' + access + '分钟取用与停车', origin, destination, indexes, request, {
        straightDistanceKm: distance.straightDistanceKm,
        routeDistanceKm: distance.routeKm,
        distanceRangeKm: distance.distanceRangeKm,
        minutesRange: minutesRange,
        referenceSpeedKmh: speed,
        accessParkingMinutes: access,
        gridPair: distance.gridPair
      });
  }

  function regionSpeedProfile(regionId, model) {
    var profiles = model.regionSpeedsKmh || {};
    return profiles[regionId] || profiles.default || { general: 20.4, highway: 46.9 };
  }

  function drivingHighwayShare(distanceKm) {
    if (distanceKm <= 5) return 0;
    if (distanceKm <= 20) return (distanceKm - 5) / 15 * 0.45;
    return clamp(0.45 + (distanceKm - 20) / 40 * 0.25, 0.45, 0.7);
  }

  function estimateDriving(origin, destination, request, indexes) {
    var distance = roadDistanceReference('driving', origin, destination, indexes);
    if (!distance) return { ok: false, mode: 'driving', error: 'missing_road_grid_pair' };
    var model = indexes.model.driving || {};
    var left = regionSpeedProfile(origin.regionId, model);
    var right = regionSpeedProfile(destination.regionId, model);
    var general = (finite(left.general, 20.4) + finite(right.general, 20.4)) / 2;
    var highway = (finite(left.highway, 46.9) + finite(right.highway, 46.9)) / 2;
    var share = drivingHighwayShare(distance.routeKm);
    var speed = general * (1 - share) + highway * share;
    var fixed = Math.max(0, finite(model.fixedEndpointMinutes, 3));
    var fixedRange = array(model.fixedEndpointRangeMinutes);
    var speedRangeFactors = array(model.speedRangeFactors);
    var slowSpeed = Math.max(1, speed * finite(speedRangeFactors[0], 0.75));
    var fastSpeed = Math.max(slowSpeed, speed * finite(speedRangeFactors[1], 1.2));
    var minutes = distance.routeKm / speed * 60 + fixed;
    var minutesRange = rangeObject(
      distance.distanceRangeKm.min / fastSpeed * 60 + finite(fixedRange[0], 2),
      distance.distanceRangeKm.max / slowSpeed * 60 + finite(fixedRange[1], 8),
      0
    );
    return resultBase('driving', minutes, distance.routeKm, 'road_grid_driving_reference', '网格道路距离驾车粗估',
      distance.routeKm + 'km网格道路距离÷' + round(speed, 1) + 'km/h＋' + fixed + '分钟端点余量', origin, destination, indexes, request, {
        straightDistanceKm: distance.straightDistanceKm,
        routeDistanceKm: distance.routeKm,
        distanceRangeKm: distance.distanceRangeKm,
        minutesRange: minutesRange,
        referenceSpeedKmh: round(speed, 1),
        assumedHighwayShare: round(share, 2),
        gridPair: distance.gridPair
      });
  }

  function compareCost(left, right) {
    return left.referenceSeconds - right.referenceSeconds ||
      left.adjacentSegmentCount - right.adjacentSegmentCount ||
      left.transferCount - right.transferCount ||
      String(left.tieKey || '').localeCompare(String(right.tieKey || ''));
  }

  function heapPush(heap, item) {
    heap.push(item);
    var index = heap.length - 1;
    while (index > 0) {
      var parent = Math.floor((index - 1) / 2);
      if (compareCost(heap[parent].cost, item.cost) <= 0) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = item;
  }

  function heapPop(heap) {
    if (!heap.length) return null;
    var root = heap[0];
    var tail = heap.pop();
    if (heap.length) {
      heap[0] = tail;
      var index = 0;
      while (true) {
        var left = index * 2 + 1;
        var right = left + 1;
        var smallest = index;
        if (left < heap.length && compareCost(heap[left].cost, heap[smallest].cost) < 0) smallest = left;
        if (right < heap.length && compareCost(heap[right].cost, heap[smallest].cost) < 0) smallest = right;
        if (smallest === index) break;
        var swap = heap[index];
        heap[index] = heap[smallest];
        heap[smallest] = swap;
        index = smallest;
      }
    }
    return root;
  }

  function stateKey(stationId, lineId, hasBoarded) {
    return stationId + '\u0000' + (lineId || '') + '\u0000' + (hasBoarded ? '1' : '0');
  }

  function accessSeconds(endpoint, station, model) {
    if (endpoint.type === 'station' && endpoint.stationIds.indexOf(String(station.stationId)) >= 0) return 0;
    var distance = haversineKm(endpoint, station);
    if (!Number.isFinite(distance)) return Math.round(finite(model.nonStationAccessMinutes, 6) * 60);
    return Math.round(Math.max(2, distance * 1.25 / 4 * 60) * 60);
  }

  function endpointStationCandidates(endpoint, indexes) {
    var model = indexes.model.rail || {};
    var candidates = uniqueStationIds(endpoint.stationIds, indexes).map(function (stationId) {
      var station = indexes.canonicalStationById.get(stationId);
      return station ? { stationId: stationId, accessSeconds: accessSeconds(endpoint, station, model) } : null;
    }).filter(Boolean);
    return candidates;
  }

  function localPointToLongitudeLatitude(point, projection) {
    var origin = array(projection && projection.originEpsg3857Metres);
    if (!Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1])) || origin.length < 2) return null;
    var x = Number(origin[0]) + Number(point[0]);
    var y = Number(origin[1]) + Number(point[1]);
    var longitude = x / WEB_MERCATOR_RADIUS_M * 180 / Math.PI;
    var latitude = (2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI;
    return [round(longitude, 6), round(latitude, 6)];
  }

  function lineLabel(lineId, indexes) {
    var line = indexes.lineById.get(String(lineId || ''));
    return line ? String(line.label || line.nameJa || line.lineId) : String(lineId || '');
  }

  function buildLineSegments(traversals, indexes) {
    var segments = [];
    traversals.forEach(function (step) {
      if (step.stationInternalTransfer) return;
      var last = segments[segments.length - 1];
      if (!last || last.lineId !== step.edge.lineId) {
        last = {
          lineId: step.edge.lineId,
          lineLabel: lineLabel(step.edge.lineId, indexes),
          fromStationId: step.fromStationId,
          toStationId: step.toStationId,
          stationIds: [step.fromStationId, step.toStationId],
          edgeIds: [step.edge.edgeId],
          edgeCount: 1,
          referenceTravelSeconds: finite(step.edge.referenceTravelSeconds, 0)
        };
        segments.push(last);
      } else {
        last.toStationId = step.toStationId;
        last.stationIds.push(step.toStationId);
        last.edgeIds.push(step.edge.edgeId);
        last.edgeCount += 1;
        last.referenceTravelSeconds += finite(step.edge.referenceTravelSeconds, 0);
      }
    });
    return segments;
  }

  function findRailRoute(origin, destination, indexes) {
    var originCandidates = endpointStationCandidates(origin, indexes);
    var destinationCandidates = endpointStationCandidates(destination, indexes);
    if (!originCandidates.length || !destinationCandidates.length) return null;
    var destinationAccess = new Map();
    destinationCandidates.forEach(function (candidate) {
      var known = destinationAccess.get(candidate.stationId);
      if (known === undefined || candidate.accessSeconds < known) destinationAccess.set(candidate.stationId, candidate.accessSeconds);
    });
    var transferSeconds = Math.round(Math.max(0, finite(indexes.model.rail && indexes.model.rail.transferMinutes, 5)) * 60);
    var initialWaitSeconds = Math.round(Math.max(0, finite(indexes.model.rail && indexes.model.rail.initialWaitMinutes, 3)) * 60);
    var best = new Map();
    var previous = new Map();
    var heap = [];
    originCandidates.forEach(function (candidate) {
      var key = stateKey(candidate.stationId, '', false);
      var cost = {
        referenceSeconds: candidate.accessSeconds,
        adjacentSegmentCount: 0,
        transferCount: 0,
        tieKey: candidate.stationId
      };
      var known = best.get(key);
      if (known && compareCost(known, cost) <= 0) return;
      best.set(key, cost);
      previous.set(key, { previousStateKey: null, originStationId: candidate.stationId, originAccessSeconds: candidate.accessSeconds });
      heapPush(heap, { stateKey: key, stationId: candidate.stationId, lineId: '', hasBoarded: false, cost: cost });
    });

    var finalItem = null;
    var finalCost = null;
    var finalDestinationAccessSeconds = 0;
    while (heap.length) {
      var current = heapPop(heap);
      if (!current || compareCost(current.cost, best.get(current.stateKey)) !== 0) continue;
      if (finalCost && current.cost.referenceSeconds > finalCost.referenceSeconds) break;
      if (destinationAccess.has(current.stationId)) {
        var completed = {
          referenceSeconds: current.cost.referenceSeconds + destinationAccess.get(current.stationId),
          adjacentSegmentCount: current.cost.adjacentSegmentCount,
          transferCount: current.cost.transferCount,
          tieKey: current.cost.tieKey + '>destination'
        };
        if (!finalCost || compareCost(completed, finalCost) < 0) {
          finalItem = current;
          finalCost = completed;
          finalDestinationAccessSeconds = destinationAccess.get(current.stationId);
        }
      }
      array(indexes.adjacency.get(current.stationId)).forEach(function (neighbor) {
        var edge = neighbor.edge;
        var stationInternalTransfer = neighbor.stationInternalTransfer === true || edge.kind === 'station_internal_transfer';
        var isTransfer = !stationInternalTransfer && Boolean(current.lineId && current.lineId !== edge.lineId);
        var nextLineId = stationInternalTransfer ? '' : edge.lineId;
        var nextHasBoarded = current.hasBoarded || !stationInternalTransfer;
        var firstBoardingWaitSeconds = !current.hasBoarded && !stationInternalTransfer ? initialWaitSeconds : 0;
        var nextCost = {
          referenceSeconds: current.cost.referenceSeconds + finite(edge.referenceTravelSeconds, 0) + (isTransfer ? transferSeconds : 0) + firstBoardingWaitSeconds,
          adjacentSegmentCount: current.cost.adjacentSegmentCount + (stationInternalTransfer ? 0 : 1),
          transferCount: current.cost.transferCount + (isTransfer || stationInternalTransfer ? 1 : 0),
          tieKey: current.cost.tieKey + '>' + edge.edgeId + '>' + neighbor.nextStationId
        };
        var nextKey = stateKey(neighbor.nextStationId, nextLineId, nextHasBoarded);
        var known = best.get(nextKey);
        if (known && compareCost(known, nextCost) <= 0) return;
        best.set(nextKey, nextCost);
        previous.set(nextKey, {
          previousStateKey: current.stateKey,
          fromStationId: current.stationId,
          toStationId: neighbor.nextStationId,
          edge: edge,
          forward: neighbor.forward,
          isTransfer: isTransfer,
          stationInternalTransfer: stationInternalTransfer
        });
        heapPush(heap, { stateKey: nextKey, stationId: neighbor.nextStationId, lineId: nextLineId, hasBoarded: nextHasBoarded, cost: nextCost });
      });
    }
    if (!finalItem || !finalCost) return null;

    var traversals = [];
    var cursor = finalItem.stateKey;
    var startRecord = null;
    while (cursor) {
      var step = previous.get(cursor);
      if (!step) return null;
      if (!step.previousStateKey) {
        startRecord = step;
        break;
      }
      traversals.push(step);
      cursor = step.previousStateKey;
    }
    traversals.reverse();
    var originStationId = startRecord.originStationId;
    var stationIds = [originStationId].concat(traversals.map(function (step) { return step.toStationId; }));
    var physicalTraversals = traversals.filter(function (step) { return !step.stationInternalTransfer; });
    var railSeconds = physicalTraversals.reduce(function (sum, step) { return sum + finite(step.edge.referenceTravelSeconds, 0); }, 0);
    var railDistanceKm = physicalTraversals.reduce(function (sum, step) { return sum + finite(step.edge.trackDistanceKm, 0); }, 0);
    var ordinaryTransferCount = traversals.filter(function (step) { return step.isTransfer; }).length;
    var internalTransferTraversals = traversals.filter(function (step) { return step.stationInternalTransfer; });
    var stationInternalTransferSeconds = internalTransferTraversals.reduce(function (sum, step) {
      return sum + finite(step.edge.referenceTravelSeconds, 0);
    }, 0);
    var geometryPaths = physicalTraversals.map(function (step) {
      var points = array(step.edge.trackPointPath).map(function (point) {
        return localPointToLongitudeLatitude(point, indexes.data.projection);
      }).filter(Boolean);
      return step.forward ? points : points.reverse();
    }).filter(function (points) { return points.length >= 2; });
    return {
      originStationId: originStationId,
      destinationStationId: finalItem.stationId,
      originAccessSeconds: startRecord.originAccessSeconds || 0,
      destinationAccessSeconds: finalDestinationAccessSeconds,
      stationIds: stationIds,
      edgeIds: traversals.map(function (step) { return String(step.edge.edgeId); }),
      lineSegments: buildLineSegments(traversals, indexes),
      edgeCount: physicalTraversals.length,
      transferCount: finalCost.transferCount,
      ordinaryTransferCount: ordinaryTransferCount,
      stationInternalTransferCount: internalTransferTraversals.length,
      railSeconds: railSeconds,
      transferSeconds: ordinaryTransferCount * transferSeconds + stationInternalTransferSeconds,
      stationInternalTransferSeconds: stationInternalTransferSeconds,
      initialWaitSeconds: physicalTraversals.length ? initialWaitSeconds : 0,
      railDistanceKm: railDistanceKm,
      geometryPaths: geometryPaths,
      selectionMethod: 'lowest_reference_seconds_then_fewest_segments_then_fewest_transfers',
      objectivePriority: ['lowest_reference_total_seconds', 'fewest_adjacent_segments', 'fewest_transfers']
    };
  }

  function estimateRail(origin, destination, request, indexes) {
    var route = findRailRoute(origin, destination, indexes);
    if (!route) return { ok: false, mode: 'public_transit', error: 'missing_rail_path' };
    var model = indexes.model.rail || {};
    var waitMinutes = route.initialWaitSeconds / 60;
    var accessSecondsTotal = route.originAccessSeconds + route.destinationAccessSeconds;
    var totalSeconds = route.railSeconds + route.transferSeconds + accessSecondsTotal + route.initialWaitSeconds;
    var transferRange = array(model.transferRangeMinutes);
    var waitRange = array(model.waitRangeMinutes);
    var rangeFactors = array(model.rangeFactors);
    var minimumSeconds = route.railSeconds * finite(rangeFactors[0], 0.88) +
      route.ordinaryTransferCount * finite(transferRange[0], 3) * 60 + route.stationInternalTransferSeconds * 0.85 +
      (route.edgeCount ? finite(waitRange[0], 2) * 60 : 0) + accessSecondsTotal * 0.85;
    var maximumSeconds = route.railSeconds * finite(rangeFactors[1], 1.2) +
      route.ordinaryTransferCount * finite(transferRange[1], 8) * 60 + route.stationInternalTransferSeconds * 1.2 +
      (route.edgeCount ? finite(waitRange[1], 7) * 60 : 0) + accessSecondsTotal * 1.2;
    var railPath = {
      originStationId: route.originStationId,
      destinationStationId: route.destinationStationId,
      stationIds: route.stationIds,
      edgeIds: route.edgeIds,
      lineSegments: route.lineSegments,
      edgeCount: route.edgeCount,
      transferCount: route.transferCount,
      ordinaryTransferCount: route.ordinaryTransferCount,
      stationInternalTransferCount: route.stationInternalTransferCount,
      geometryPaths: route.geometryPaths,
      selectionMethod: route.selectionMethod,
      objectivePriority: route.objectivePriority
    };
    var routeSummary = route.lineSegments.map(function (segment) {
      return segment.lineLabel + ' ' + segment.edgeCount + '站间';
    }).join('；');
    var formula = route.edgeCount + '个相邻站参考时长求和＋' + route.ordinaryTransferCount + '次普通换乘×' +
      finite(model.transferMinutes, 5) + '分钟' + (route.stationInternalTransferCount ? '＋' + route.stationInternalTransferCount + '次显式站内换乘' : '') + '＋候车' + waitMinutes + '分钟' +
      (accessSecondsTotal ? '＋端点接驳约' + Math.round(accessSecondsTotal / 60) + '分钟' : '');
    return resultBase('public_transit', totalSeconds / 60, route.railDistanceKm, 'full_station_graph_reference',
      '全站邻接图电车粗估', formula, origin, destination, indexes, request, {
        routeDistanceKm: round(route.railDistanceKm, 2),
        distanceRangeKm: rangeObject(route.railDistanceKm, route.railDistanceKm, 2),
        minutesRange: rangeObject(minimumSeconds / 60, maximumSeconds / 60, 0),
        accessMinutes: Math.round(accessSecondsTotal / 60),
        railMinutes: Math.round(route.railSeconds / 60),
        transferMinutes: Math.round(route.transferSeconds / 60),
        waitMinutes: Math.round(waitMinutes),
        routeSummary: routeSummary,
        railPath: railPath,
        breakdown: route.lineSegments.map(function (segment) {
          return {
            lineId: segment.lineId,
            lineLabel: segment.lineLabel,
            edgeCount: segment.edgeCount,
            minutes: round(segment.referenceTravelSeconds / 60, 1)
          };
        })
      });
  }

  function estimateWithIndexes(request, indexes) {
    var mode = normalizeMode(request && request.mode);
    if (!mode) return { ok: false, mode: String(request && request.mode || ''), error: 'unsupported_mode' };
    var origin = resolveEndpointWithIndexes(request && request.origin, indexes);
    var destination = resolveEndpointWithIndexes(request && request.destination, indexes);
    if (!origin || !destination) return { ok: false, mode: mode, error: 'missing_geographic_anchor' };
    if (sameEndpoint(origin, destination)) return zeroResult(mode, origin, destination, indexes, request);
    if (mode === 'walking') return estimateWalking(origin, destination, request, indexes);
    if (mode === 'bicycle') return estimateBicycle(origin, destination, request, indexes);
    if (mode === 'driving') return estimateDriving(origin, destination, request, indexes);
    return estimateRail(origin, destination, request, indexes);
  }

  function createEstimator(data) {
    var indexes = createIndexes(data);
    return {
      estimateRoute: function (request) {
        return estimateWithIndexes(request || {}, indexes);
      },
      estimateAll: function (request) {
        var base = request || {};
        return {
          estimates: {
            public_transit: estimateWithIndexes(Object.assign({}, base, { mode: 'public_transit' }), indexes),
            driving: estimateWithIndexes(Object.assign({}, base, { mode: 'driving' }), indexes),
            walking: estimateWithIndexes(Object.assign({}, base, { mode: 'walking' }), indexes),
            bicycle: estimateWithIndexes(Object.assign({}, base, { mode: 'bicycle' }), indexes)
          }
        };
      },
      resolveEndpoint: function (endpoint) {
        return resolveEndpointWithIndexes(endpoint, indexes);
      }
    };
  }

  function estimateRoute(request, data) {
    return createEstimator(data).estimateRoute(request);
  }

  function estimateAll(request, data) {
    return createEstimator(data).estimateAll(request);
  }

  return {
    createEstimator: createEstimator,
    estimateRoute: estimateRoute,
    estimateAll: estimateAll,
    resolveEndpoint: resolveEndpoint,
    haversineKm: haversineKm,
    normalizeMode: normalizeMode
  };
});

})(isolatedModule, isolatedModule.exports, isolatedRoot, isolatedRoot, isolatedRoot);
export default isolatedModule.exports;
