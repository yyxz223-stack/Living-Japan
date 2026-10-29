// LJ-EXT-LEGACY-MODULE
const isolatedModule = { exports: {} };
const isolatedRoot = {};
(function(module, exports, globalThis, self, window) {
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LivingJapanTransitMap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '3.0.0-map-workbench';
  var instanceCounter = 0;
  var SVG_WIDTH = 1000;
  var SVG_HEIGHT = 720;
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 14;
  var FAVORITE_SLOT_IDS = ['favorite_1', 'favorite_2', 'favorite_3'];
  var TRAVEL_MODES = ['public_transit', 'driving', 'walking', 'bicycle'];
  var PRIMARY_STATIONS = new Set([
    'tokyo', 'shinjuku', 'shibuya', 'ikebukuro', 'ueno', 'shinagawa', 'yokohama',
    'kawasaki', 'omiya', 'chiba', 'hachioji', 'tachikawa', 'kitasenju', 'akihabara',
    'kichijoji', 'funabashi', 'matsudo', 'musashi_kosugi', 'haneda_airport', 'narita_airport'
  ]);

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function objectValues(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).map(function (key) {
      var item = value[key] && typeof value[key] === 'object' ? value[key] : {};
      return item.objectId || item.placeId ? item : Object.assign({ objectId: key }, item);
    });
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function normalizeText(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (typeof text.normalize === 'function') text = text.normalize('NFKC');
    return text.toLocaleLowerCase().replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ').trim();
  }

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function clamp(value, minimum, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = minimum;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function asPromise(value) {
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  function unique(values) {
    return Array.from(new Set(array(values).filter(Boolean).map(String)));
  }

  function endpointKey(endpoint) {
    return endpoint ? String(endpoint.type || '') + ':' + String(endpoint.id || '') : '';
  }

  function normalizeBrowse(input) {
    var value = input && typeof input === 'object' ? input : {};
    return {
      regions: array(value.regions).slice(),
      areas: array(value.areas).slice(),
      objects: Array.isArray(value.objects) ? value.objects.slice() : objectValues(value.objects)
    };
  }

  function normalizeTransitData(input) {
    var value = input && typeof input === 'object' ? input : {};
    return {
      schemaVersion: Number(value.schemaVersion) || 1,
      datasetId: String(value.datasetId || ''),
      title: String(value.title || '首都圈交通地图'),
      checkedAt: String(value.checkedAt || ''),
      scope: value.scope && typeof value.scope === 'object' ? value.scope : {},
      policies: value.policies && typeof value.policies === 'object' ? value.policies : {},
      routePlanning: value.routePlanning && typeof value.routePlanning === 'object' ? value.routePlanning : {},
      sources: array(value.sources).slice(),
      operators: array(value.operators).slice(),
      lines: array(value.lines).slice(),
      stations: array(value.stations).slice(),
      edges: array(value.edges).slice(),
      areaAnchors: array(value.areaAnchors).slice()
    };
  }

  function normalizeGeometry(value) {
    if (!value) return null;
    if (value.type === 'Feature') return normalizeGeometry(value.geometry);
    if (value.type === 'LineString' && Array.isArray(value.coordinates)) {
      return { type: 'LineString', coordinates: value.coordinates };
    }
    if (value.type === 'MultiLineString' && Array.isArray(value.coordinates)) {
      return { type: 'MultiLineString', coordinates: value.coordinates };
    }
    if (value.type === 'Polygon' && Array.isArray(value.coordinates)) {
      return { type: 'MultiLineString', coordinates: value.coordinates };
    }
    if (value.type === 'MultiPolygon' && Array.isArray(value.coordinates)) {
      var rings = [];
      value.coordinates.forEach(function (polygon) {
        array(polygon).forEach(function (ring) { rings.push(ring); });
      });
      return { type: 'MultiLineString', coordinates: rings };
    }
    if (Array.isArray(value) && value.length && Array.isArray(value[0])) {
      if (finite(value[0][0]) && finite(value[0][1])) return { type: 'LineString', coordinates: value };
      return { type: 'MultiLineString', coordinates: value };
    }
    return null;
  }

  function normalizeBounds(value, fallbackPoints) {
    var bounds = null;
    if (Array.isArray(value) && value.length >= 4) {
      bounds = { west: Number(value[0]), south: Number(value[1]), east: Number(value[2]), north: Number(value[3]) };
    } else if (value && typeof value === 'object') {
      bounds = {
        west: Number(value.west !== undefined ? value.west : value.minLongitude),
        south: Number(value.south !== undefined ? value.south : value.minLatitude),
        east: Number(value.east !== undefined ? value.east : value.maxLongitude),
        north: Number(value.north !== undefined ? value.north : value.maxLatitude)
      };
    }
    if (bounds && finite(bounds.west) && finite(bounds.south) && finite(bounds.east) && finite(bounds.north) && bounds.west < bounds.east && bounds.south < bounds.north) return bounds;
    var points = array(fallbackPoints).filter(function (point) { return point && finite(point.longitude) && finite(point.latitude); });
    if (!points.length) return { west: 139.2, south: 35.25, east: 140.25, north: 36.05 };
    return {
      west: Math.min.apply(null, points.map(function (point) { return Number(point.longitude); })),
      south: Math.min.apply(null, points.map(function (point) { return Number(point.latitude); })),
      east: Math.max.apply(null, points.map(function (point) { return Number(point.longitude); })),
      north: Math.max.apply(null, points.map(function (point) { return Number(point.latitude); }))
    };
  }

  function normalizeGeoFeature(item, fallbackKind) {
    if (!item || typeof item !== 'object') return null;
    var properties = item.properties && typeof item.properties === 'object' ? item.properties : item;
    var geometry = normalizeGeometry(item.geometry || item.coordinates || properties.geometry);
    if (!geometry) return null;
    return {
      id: String(item.id || properties.id || properties.featureId || ''),
      label: String(properties.label || properties.name || properties.nameJa || ''),
      kind: String(properties.kind || fallbackKind || ''),
      level: String(properties.level || properties.lod || properties.adminLevel || ''),
      lineId: String(properties.lineId || item.lineId || ''),
      operator: String(properties.operator || ''),
      color: String(properties.color || item.color || ''),
      tier: String(properties.tier || properties.labelTier || properties.networkTier || ''),
      priority: finite(properties.priority) ? Number(properties.priority) : 0,
      sourceId: String(properties.sourceId || item.sourceId || ''),
      geometry: geometry
    };
  }

  function localMercatorPointToLongitudeLatitude(point, projection) {
    if (!Array.isArray(point) || !finite(point[0]) || !finite(point[1])) return null;
    var origin = projection && Array.isArray(projection.originEpsg3857Metres) ? projection.originEpsg3857Metres : null;
    if (!origin || !finite(origin[0]) || !finite(origin[1])) return [Number(point[0]), Number(point[1])];
    var radius = 6378137;
    var x = Number(origin[0]) + Number(point[0]);
    var y = Number(origin[1]) + Number(point[1]);
    return [x / radius * 180 / Math.PI, (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI];
  }

  function decodeLocalPaths(paths, projection) {
    return array(paths).map(function (path) {
      return array(path).map(function (point) { return localMercatorPointToLongitudeLatitude(point, projection); }).filter(Boolean);
    }).filter(function (path) { return path.length >= 2; });
  }

  function normalizeGeoData(input) {
    var value = input && typeof input === 'object' ? input : {};
    var projection = value.projection && typeof value.projection === 'object' ? value.projection : { type: 'web_mercator_fit' };
    var adminNameById = new Map();
    array(value.administration && value.administration.prefectures).forEach(function (item) {
      if (!item || !item.id) return;
      var label = String(item.nameJa || item.label || item.id);
      adminNameById.set(String(item.id), label);
      adminNameById.set('pref_' + String(item.id).replace(/^pref_/u, ''), label);
    });
    array(value.administration && value.administration.units).forEach(function (item) {
      if (!item) return;
      var label = String(item.fullNameJa || item.nameJa || item.label || item.id || '');
      [item.id, item.adminNodeId, item.registryAdminNodeId].concat(array(item.adminPath).slice(-1)).forEach(function (id) {
        if (id) adminNameById.set(String(id), label);
      });
      var parentId = array(item.adminPath).length >= 2 ? array(item.adminPath)[array(item.adminPath).length - 2] : null;
      if (parentId && item.parentMunicipalityNameJa) adminNameById.set(String(parentId), String(item.parentMunicipalityNameJa));
    });
    var crosswalkByRailStationId = new Map();
    array(value.routingTopology && value.routingTopology.stationCrosswalk).forEach(function (item) {
      if (item && item.railStationId && item.legacyStationId) crosswalkByRailStationId.set(String(item.railStationId), String(item.legacyStationId));
    });
    var nestedStations = value.railNetwork && Array.isArray(value.railNetwork.stations) ? value.railNetwork.stations : null;
    var stationPoints = array(value.stationPoints || value.stations || nestedStations).map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var coordinates = item.coordinates;
      var longitude = item.longitude;
      var latitude = item.latitude;
      if (Array.isArray(coordinates)) {
        longitude = coordinates[0];
        latitude = coordinates[1];
      }
      var railStationId = item.stationId || item.id || item.mapStationId;
      var stationId = crosswalkByRailStationId.get(String(railStationId || '')) || railStationId;
      if (!stationId || !finite(longitude) || !finite(latitude)) return null;
      return Object.assign({}, item, {
        stationId: String(stationId),
        railStationId: String(railStationId || stationId),
        longitude: Number(longitude),
        latitude: Number(latitude),
        label: String(item.label || item.name || item.nameJa || stationId),
        tier: String(item.tier || item.labelTier || item.lodTier || ''),
        adminPath: array(item.adminPath).map(function (id) { return adminNameById.get(String(id)) || String(id); })
      });
    }).filter(Boolean);
    var nestedLines = value.railNetwork && Array.isArray(value.railNetwork.lines) ? value.railNetwork.lines.map(function (item) {
      return {
        id: item.id,
        lineId: item.id,
        label: item.nameJa,
        operator: item.operatorId,
        tier: item.lodTier,
        geometry: { type: 'MultiLineString', coordinates: decodeLocalPaths(item.paths, projection) }
      };
    }) : null;
    var lineSource = value.lineGeometries || value.railLines || value.railways || nestedLines || [];
    var lineGeometries = array(lineSource).map(function (item) { return normalizeGeoFeature(item, 'railway'); }).filter(Boolean);
    var nestedAdministrativeBoundaries = value.administration ? [
      { id: 'prefecture_boundaries', label: '都县边界', level: 'prefecture', geometry: { type: 'MultiLineString', coordinates: decodeLocalPaths(value.administration.prefectureBoundaryPaths, projection) } },
      { id: 'municipality_boundaries', label: '市区町村边界', level: 'municipality', geometry: { type: 'MultiLineString', coordinates: decodeLocalPaths(value.administration.municipalityBoundaryPaths, projection) } }
    ] : null;
    var administrativeBoundaries = array(value.administrativeBoundaries || value.boundaries || nestedAdministrativeBoundaries).map(function (item) { return normalizeGeoFeature(item, 'administrative'); }).filter(Boolean);
    var administrativeLabels = [];
    if (value.administration) {
      var prefecturePoints = new Map();
      array(value.administration.units).forEach(function (item) {
        var coordinate = localMercatorPointToLongitudeLatitude(item && item.labelPoint, projection);
        if (!item || !item.id || !coordinate) return;
        administrativeLabels.push({
          id: String(item.id),
          label: String(item.fullNameJa || item.nameJa || item.id),
          level: 'municipality',
          tier: String(item.lodTier || 'near'),
          priority: finite(item.labelPriority) ? Number(item.labelPriority) : 0,
          longitude: coordinate[0],
          latitude: coordinate[1]
        });
        var prefectureId = String(item.prefectureId || '');
        if (!prefectureId) return;
        if (!prefecturePoints.has(prefectureId)) prefecturePoints.set(prefectureId, []);
        prefecturePoints.get(prefectureId).push(coordinate);
      });
      array(value.administration.prefectures).forEach(function (item) {
        var points = prefecturePoints.get(String(item && item.id || '')) || [];
        if (!item || !item.id || !points.length) return;
        administrativeLabels.push({
          id: 'pref_' + String(item.id).replace(/^pref_/u, ''),
          label: String(item.nameJa || item.label || item.id),
          level: 'prefecture',
          tier: 'far',
          longitude: points.reduce(function (sum, point) { return sum + point[0]; }, 0) / points.length,
          latitude: points.reduce(function (sum, point) { return sum + point[1]; }, 0) / points.length
        });
      });
      array(value.administration.labels).forEach(function (item) {
        var coordinate = Array.isArray(item.coordinates)
          ? item.coordinates
          : localMercatorPointToLongitudeLatitude(item.labelPoint, projection);
        if (!item || !item.id || !coordinate || !finite(coordinate[0]) || !finite(coordinate[1])) return;
        administrativeLabels.push({
          id: String(item.id),
          label: String(item.label || item.nameJa || item.id),
          level: String(item.level || 'municipality'),
          tier: String(item.tier || item.lodTier || 'mid'),
          priority: finite(item.priority) ? Number(item.priority) : 0,
          longitude: Number(coordinate[0]),
          latitude: Number(coordinate[1])
        });
      });
    }
    array(value.waterLabels).forEach(function (item) {
      var coordinate = Array.isArray(item.coordinates)
        ? item.coordinates
        : localMercatorPointToLongitudeLatitude(item.labelPoint, projection);
      if (!item || !item.id || !coordinate || !finite(coordinate[0]) || !finite(coordinate[1])) return;
      administrativeLabels.push({
        id: String(item.id),
        label: String(item.label || item.nameJa || item.id),
        level: 'water',
        tier: String(item.tier || 'overview'),
        priority: finite(item.priority) ? Number(item.priority) : 0,
        longitude: Number(coordinate[0]),
        latitude: Number(coordinate[1])
      });
    });
    var nestedRivers = Array.isArray(value.waterways) ? value.waterways.map(function (item) {
      return {
        id: item.id,
        label: item.nameJa,
        tier: item.lodTier,
        geometry: { type: 'MultiLineString', coordinates: decodeLocalPaths(item.paths, projection) }
      };
    }) : null;
    var rivers = array(value.rivers || nestedRivers || value.waterways).map(function (item) { return normalizeGeoFeature(item, 'river'); }).filter(Boolean);
    var landSurfacePaths = decodeLocalPaths(value.landSurfacePaths, projection);
    var nestedEdges = value.routingTopology && Array.isArray(value.routingTopology.edges) ? value.routingTopology.edges.map(function (item) {
      return {
        edgeId: item.id,
        lineId: item.lineId,
        geometry: { type: 'LineString', coordinates: decodeLocalPaths([item.geometry], projection)[0] || [] }
      };
    }) : null;
    var edgePaths = array(value.edgePaths || nestedEdges).map(function (item) {
      if (!item || !item.edgeId) return null;
      var geometry = normalizeGeometry(item.geometry || item.coordinates);
      return geometry ? { edgeId: String(item.edgeId), lineId: String(item.lineId || ''), sourceId: String(item.sourceId || ''), geometry: geometry } : null;
    }).filter(Boolean);
    var placePoints = array(value.placePoints).map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var coords = item.coordinates;
      var lon = Array.isArray(coords) ? coords[0] : item.longitude;
      var lat = Array.isArray(coords) ? coords[1] : item.latitude;
      var objectId = item.objectId || item.placeId || item.id;
      if (!objectId || !finite(lon) || !finite(lat)) return null;
      return Object.assign({}, item, { objectId: String(objectId), longitude: Number(lon), latitude: Number(lat) });
    }).filter(Boolean);
    return {
      schemaVersion: Number(value.schemaVersion) || 1,
      datasetId: String(value.datasetId || ''),
      checkedAt: String(value.checkedAt || ''),
      projection: projection,
      sources: array(value.sources).slice(),
      bounds: normalizeBounds(value.bounds || value.extent || (value.scope && value.scope.geographicBounds), stationPoints),
      lineGeometries: lineGeometries,
      edgePaths: edgePaths,
      stationPoints: stationPoints,
      placePoints: placePoints,
      administrativeBoundaries: administrativeBoundaries,
      administrativeLabels: administrativeLabels,
      landSurfacePaths: landSurfacePaths,
      rivers: rivers
    };
  }

  function normalizeFavoritePlaces(input) {
    var source = input && typeof input === 'object' && Array.isArray(input.slots) ? input.slots : array(input);
    var byId = new Map();
    source.forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;
      var slotId = FAVORITE_SLOT_IDS.indexOf(String(item.slotId || '')) >= 0 ? String(item.slotId) : FAVORITE_SLOT_IDS[index];
      if (slotId && !byId.has(slotId)) byId.set(slotId, item);
    });
    return {
      schemaVersion: 1,
      slots: FAVORITE_SLOT_IDS.map(function (slotId) {
        var item = byId.get(slotId) || {};
        var rawEndpoint = item.endpoint && typeof item.endpoint === 'object' ? item.endpoint : null;
        var type = rawEndpoint ? String(rawEndpoint.type || '') : '';
        var id = rawEndpoint ? String(rawEndpoint.id || '').trim() : '';
        var endpoint = (type === 'station' || type === 'object' || type === 'area' || type === 'place') && id ? { type: type, id: id } : null;
        return {
          slotId: slotId,
          displayName: String(item.displayName || '').replace(/[\r\n]+/g, ' ').trim(),
          endpoint: endpoint
        };
      })
    };
  }

  function normalizeRegistry(options) {
    var registry = options.registry && typeof options.registry === 'object' ? options.registry : {};
    return {
      places: array(options.places || registry.places).slice(),
      walkingInterests: array(options.walkingInterests || registry.walkingInterests || options.interestLinks).slice(),
      adminNodes: array(options.adminNodes || registry.adminNodes).slice()
    };
  }

  function makeProjector(bounds) {
    var padding = 34;
    var safe = normalizeBounds(bounds, []);
    function mercatorX(longitude) {
      return Number(longitude) * Math.PI / 180;
    }
    function mercatorY(latitude) {
      var lat = clamp(latitude, -85, 85) * Math.PI / 180;
      return Math.log(Math.tan(Math.PI / 4 + lat / 2));
    }
    var minX = mercatorX(safe.west);
    var maxX = mercatorX(safe.east);
    var minY = mercatorY(safe.south);
    var maxY = mercatorY(safe.north);
    var scale = Math.min((SVG_WIDTH - padding * 2) / Math.max(0.000001, maxX - minX), (SVG_HEIGHT - padding * 2) / Math.max(0.000001, maxY - minY));
    var drawnWidth = (maxX - minX) * scale;
    var drawnHeight = (maxY - minY) * scale;
    var offsetX = (SVG_WIDTH - drawnWidth) / 2;
    var offsetY = (SVG_HEIGHT - drawnHeight) / 2;
    return {
      bounds: safe,
      forward: function (longitude, latitude) {
        return {
          x: offsetX + (mercatorX(longitude) - minX) * scale,
          y: SVG_HEIGHT - offsetY - (mercatorY(Number(latitude)) - minY) * scale
        };
      },
      inverse: function (x, y) {
        var lon = (minX + (Number(x) - offsetX) / scale) * 180 / Math.PI;
        var mercY = minY + (SVG_HEIGHT - offsetY - Number(y)) / scale;
        var lat = (2 * Math.atan(Math.exp(mercY)) - Math.PI / 2) * 180 / Math.PI;
        return { longitude: lon, latitude: lat };
      }
    };
  }

  function geometryLines(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return [geometry.coordinates];
    if (geometry.type === 'MultiLineString') return geometry.coordinates;
    return [];
  }

  function pathFromCoordinates(coordinates, projector) {
    var points = array(coordinates).filter(function (item) { return Array.isArray(item) && finite(item[0]) && finite(item[1]); });
    if (points.length < 2) return '';
    return points.map(function (point, index) {
      var xy = projector.forward(point[0], point[1]);
      return (index ? 'L' : 'M') + xy.x.toFixed(2) + ' ' + xy.y.toFixed(2);
    }).join(' ');
  }

  function rectsIntersect(left, right) {
    return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
  }

  function stableStationBucket(stationId, modulo) {
    var text = String(stationId || '');
    var hash = 0;
    for (var index = 0; index < text.length; index += 1) hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
    return hash % Math.max(1, Number(modulo) || 1);
  }

  function lodForZoom(zoom) {
    if (zoom < 1.85) return 'far';
    if (zoom < 4.2) return 'mid';
    if (zoom < 6.8) return 'near';
    if (zoom < 10) return 'detail';
    return 'max';
  }

  function stationVisibleAtLod(lod, tier, forced, stationId) {
    if (forced) return true;
    if (lod === 'far') return PRIMARY_STATIONS.has(String(stationId || ''));
    if (lod === 'mid') return tier === 'primary';
    if (lod === 'near') return tier === 'primary' || (tier === 'secondary' && stableStationBucket(stationId, 4) === 0);
    if (lod === 'detail') return tier === 'primary' || tier === 'secondary';
    return true;
  }

  function validTravelMode(mode) {
    return TRAVEL_MODES.indexOf(String(mode || '')) >= 0;
  }

  function travelModeLabel(mode) {
    if (mode === 'public_transit') return '公共交通';
    if (mode === 'driving') return '驾车';
    if (mode === 'walking') return '步行';
    if (mode === 'bicycle') return '自行车';
    return '';
  }

  function compactRailLineLabel(value) {
    // LJ-V3-TRAFFIC-LINE-20261024：交通注释只使用最终路线中的具体线路名。
    var label = String(value || '').trim();
    if (!label) return '';
    label = label.replace(/^[^・]+・/u, '');
    var withoutRouteNumber = label.replace(/^\d+号線(?=.+線$)/u, '');
    return withoutRouteNumber || label;
  }

  function travelModePhrase(mode, railPath) {
    if (mode === 'public_transit' && railPath && array(railPath.lineSegments).length) {
      var names = railPath.lineSegments.map(function (item) { return compactRailLineLabel(item.lineLabel); }).filter(Boolean);
      return names.length ? '乘坐（' + names.join('→') + '）' : '';
    }
    if (mode === 'public_transit') return '';
    if (mode === 'driving') return '驾车（或出租）';
    if (mode === 'walking') return '步行';
    if (mode === 'bicycle') return '骑自行车';
    return '';
  }

  function stationFormalLabel(station) {
    var label = String(station && (station.nameJa || station.label || station.id) || '');
    return /[站駅]$/u.test(label) ? label : label + '駅';
  }

  function buildTrafficCommentPure(input) {
    var value = input && typeof input === 'object' ? input : {};
    var origin = value.origin;
    var destination = value.destination;
    var mode = value.mode;
    var estimate = value.estimate;
    if (!origin || !destination || !validTravelMode(mode) || !estimate || !finite(estimate.minutes)) return '';
    var phrase = travelModePhrase(mode, value.railPath || estimate.railPath);
    if (!phrase) return '';
    var journey = '从' + origin.label + '处出发 ' + phrase;
    var modeKinds = mode === 'driving'
      ? ['famous_bridge', 'famous_expressway', 'famous_road', 'famous_tunnel', 'famous_bay', 'famous_port', 'famous_pier', 'ferry_crossing']
      : mode === 'walking' || mode === 'bicycle'
        ? ['famous_bridge', 'famous_road', 'famous_tunnel', 'famous_bay', 'famous_port', 'famous_pier', 'ferry_crossing']
        : [];
    var verified = array(estimate.verifiedWaypoints).filter(function (item) {
      return item && item.verified === true && modeKinds.indexOf(item.kind) >= 0 && item.name;
    });
    if (verified.length) journey += '，将途经' + verified.map(function (item) { return item.name; }).join('、');
    journey += '，至 ' + destination.label + '（目的地），所需时间约' + Math.round(Number(estimate.minutes)) + '分钟';
    return '<!--traffic info： ' + journey.replace(/[\r\n]+/g, ' ').replace(/--/g, '—') + ' -->';
  }

  function normalizeView(value, fallback) {
    var source = value && typeof value === 'object' ? value : {};
    var center = source.center && typeof source.center === 'object' ? source.center : {};
    var fallbackCenter = fallback && fallback.center ? fallback.center : { longitude: 139.75, latitude: 35.68 };
    var longitude = finite(center.longitude) ? Number(center.longitude) : finite(source.longitude) ? Number(source.longitude) : fallbackCenter.longitude;
    var latitude = finite(center.latitude) ? Number(center.latitude) : finite(source.latitude) ? Number(source.latitude) : fallbackCenter.latitude;
    var zoom = clamp(source.zoom, MIN_ZOOM, MAX_ZOOM);
    return { center: { longitude: longitude, latitude: latitude }, zoom: zoom };
  }

  function createTransitMap(rootElement, rawOptions) {
    if (!rootElement || typeof rootElement.appendChild !== 'function') throw new Error('createTransitMap 需要一个可挂载的页面元素');
    var doc = rootElement.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('当前环境没有可用的 document');
    var options = Object.assign({}, rawOptions || {});
    var browse = normalizeBrowse(options.browse || options.locationBrowse);
    var transit = normalizeTransitData(options.transitData);
    var geo = normalizeGeoData(options.geoData);
    var registry = normalizeRegistry(options);
    var favoritePlaces = normalizeFavoritePlaces(options.favoritePlaces);
    var projector = makeProjector(geo.bounds);
    var homeCenter = projector.inverse(SVG_WIDTH / 2, SVG_HEIGHT / 2);
    var homeView = { center: homeCenter, zoom: MIN_ZOOM };
    var initialState = options.initialState && typeof options.initialState === 'object' ? options.initialState : {};
    var initialView = options.initialView || initialState.view || homeView;
    // LJ001-V3-MAP-SESSION: restore the same endpoint, search and view fields returned by getState; estimates are recalculated.
    var restoredTravelMode = options.initialTravelMode || initialState.selectedTravelMode || initialState.travelMode || (initialState.route && initialState.route.mode);
    var selectedTravelMode = validTravelMode(restoredTravelMode) ? String(restoredTravelMode) : 'public_transit';
    var uid = 'lj-transit-v3-' + (++instanceCounter);
    var destroyed = false;
    var listeners = [];
    var pointerState = new Map();
    var gesture = null;
    var suppressClickUntil = 0;
    var pendingPlaceClick = null;
    var pressedPlaceTarget = null;
    var releasedPlaceTarget = null;
    var resizeObserver = null;
    var indexes = null;
    var lastStationLabelBoxes = [];
    // LJ001-V34-MAP-PERF: retain geometry; preview gestures as one CSS layer, then commit the clear map once.
    var presentationCache = new Map();
    var layerMarkup = new WeakMap();
    var interactionView = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    var interactionMetrics = null;
    var renderMetrics = null;
    var paintedView = null;
    var previewView = null;
    var interactionFrame = 0;
    var pointerUpdatePending = false;
    var wheelCommitTimer = null;
    var state = {
      mode: 'map',
      regionId: options.initialRegionId || 'all',
      activeLineIds: new Set(),
      query: String(initialState.query || ''),
      searchOpen: false,
      searchHistory: array(initialState.searchHistory).slice(0, 4),
      selectedStationId: null,
      selectedAreaId: null,
      selectedObjectId: null,
      focus: null,
      candidateIds: [],
      candidatePoint: null,
      routeOrigin: null,
      routeDestination: null,
      selectedTravelMode: selectedTravelMode,
      railPath: null,
      travelEstimates: {},
      estimateRevision: 0,
      estimatePending: false,
      appendStatus: '',
      appendCopyText: '',
      appendPending: false,
      expanded: true,
      drawerState: ['collapsed', 'half', 'reading'].indexOf(options.initialDrawerState || initialState.drawerState) >= 0 ? String(options.initialDrawerState || initialState.drawerState) : (mapUsesSlice() ? 'half' : 'reading'),
      evidencePackageIds: new Set(),
      evidenceAreaIds: new Set(),
      evidenceObjectIds: new Set(),
      view: normalizeView(initialView, homeView),
      homeView: clone(homeView),
      lod: 'far',
      status: '单击查看，快速双击地图地点追加名称；起点和终点请用明确按钮设置。'
    };

    var container = doc.createElement('section');
    container.className = 'lj-transit-map lj-transit-map-v3';
    container.setAttribute('data-transit-instance', uid);
    container.setAttribute('data-role', 'map-workbench');
    container.innerHTML = [
      '<h2 class="lj-map-visually-hidden">首都圈交通地图</h2>',
      '<section class="lj-map-stage" data-role="map-stage">',
      '<div class="lj-map-viewport" data-role="map-viewport" tabindex="0" aria-label="可平移缩放的首都圈简化地图">',
      '<svg class="lj-map-svg" data-role="map-svg" viewBox="0 0 ' + SVG_WIDTH + ' ' + SVG_HEIGHT + '" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="' + uid + '-title ' + uid + '-desc">',
      '<title id="' + uid + '-title">首都圈主要电车线路、车站、行政边界与知名边界河流</title>',
      '<desc id="' + uid + '-desc">地图单击查看地点，快速双击追加地点名；设置路线请使用地图下方的起点和终点按钮。</desc>',
      '<g data-role="map-world"><g data-role="map-land-water"></g><g data-role="map-admin"></g><g data-role="map-landmark-rivers"></g><g data-role="map-admin-labels"></g><g data-role="map-railways"></g><g data-role="map-route-highlight"></g><g data-role="map-place-points"></g><g data-role="map-stations"></g></g>',
      '</svg></div>',
      '<aside class="lj-map-favorite-rail" data-role="favorite-rail" aria-label="三个常用地点"></aside>',
      '<div class="lj-map-zoom-controls" data-role="zoom-controls" role="group" aria-label="地图缩放"><button type="button" data-action="transit-zoom-in" aria-label="放大">＋</button><button type="button" data-action="transit-zoom-out" aria-label="缩小">−</button></div>',
      '<button type="button" class="lj-map-reset" data-action="transit-reset-view" data-role="reset-view">复原</button>',
      '<div class="lj-map-endpoint-shortcuts" data-role="endpoint-shortcuts" role="group" aria-label="起点与终点快捷操作"></div>',
      '<div class="lj-map-candidates" data-role="map-candidates" hidden></div>',
      '</section>',
      '<section class="lj-map-search-zone" data-role="map-search-zone">',
      '<div class="lj-map-search-shell" data-role="map-search-shell">',
      '<div class="lj-map-search-input-anchor" data-role="map-search-input-anchor">',
      '<label class="lj-map-search"><span>搜索站点或地点</span><input type="search" data-role="transit-search" placeholder="输入名称、类型或行政区" autocomplete="off" aria-controls="' + uid + '-search-results" aria-expanded="false"></label>',
      '<div class="lj-map-search-results" id="' + uid + '-search-results" data-role="transit-search-results" hidden></div>',
      '</div>',
      '<div class="lj-map-search-history" data-role="transit-search-history" aria-label="最近选择的四个地点" hidden></div>',
      '</div>',
      '</section>',
      '<nav class="lj-map-mode-picker" data-role="travel-mode-picker" aria-label="出行方式与参考时间"></nav>',
      '<aside class="lj-map-side-panel" data-role="map-side-panel" aria-label="当前地点与路线">',
      '<header class="lj-map-drawer-header"><button type="button" class="lj-map-drawer-toggle" data-role="map-drawer-toggle" data-action="transit-drawer-toggle" aria-controls="' + uid + '-drawer-content" aria-expanded="true"><span>地点与路线</span><strong data-role="drawer-summary">尚未选择地点</strong><small data-role="drawer-route-status">起点待选 · 终点待选</small></button><button type="button" class="lj-map-drawer-reading-toggle" data-action="transit-drawer-state" data-drawer-state="reading" aria-label="展开地点详情">详情</button><button type="button" class="lj-map-depart" data-action="transit-depart" data-role="depart">出发</button></header>',
      '<div class="lj-map-drawer-controls" id="' + uid + '-drawer-content" data-role="drawer-controls">',
      '<div class="lj-map-focus-summary" data-role="focus-summary"></div>',
      '<section class="lj-map-route-summary" data-role="route-summary"></section>',
      '</div>',
      '<div class="lj-map-drawer-reading" data-role="drawer-reading">',
      '<div class="lj-map-route-details" data-role="route-details"></div>',
      '<section class="lj-map-focus-details" data-role="focus-details"></section>',
      '</div>',
      '<p class="lj-map-live-status" data-role="transit-status" aria-live="polite"></p>',
      '<div class="lj-transit-copy-fallback" data-role="transit-copy-fallback" hidden></div>',
      '</aside>'
    ].join('');
    rootElement.appendChild(container);

    var viewport = container.querySelector('[data-role="map-viewport"]');
    var mapSvg = container.querySelector('[data-role="map-svg"]');
    var worldGroup = container.querySelector('[data-role="map-world"]');
    var searchInput = container.querySelector('[data-role="transit-search"]');

    function on(target, type, handler, settings) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler, settings);
      listeners.push(function () { target.removeEventListener(type, handler, settings); });
    }

    function registryPlaces() {
      return registry.places.map(function (place) {
        var copy = Object.assign({}, place);
        copy.placeId = String(place.placeId || place.id || '');
        copy.kind = String(place.kind || 'content_object');
        copy.label = String(place.label || place.nameJa || copy.placeId);
        copy.aliases = array(place.aliases).slice();
        copy.coordinates = Array.isArray(place.coordinates) && finite(place.coordinates[0]) && finite(place.coordinates[1]) ? [Number(place.coordinates[0]), Number(place.coordinates[1])] : null;
        return copy;
      }).filter(function (place) { return place.placeId; });
    }

    function stationAdditions() {
      var raw = options.stationAdditions;
      return array(raw && raw.stations ? raw.stations : raw).map(function (item) {
        if (!item || typeof item !== 'object') return null;
        var stationId = item.stationId || item.id || item.mapStationId;
        if (!stationId) return null;
        var coords = item.coordinates;
        var longitude = Array.isArray(coords) ? coords[0] : item.longitude;
        var latitude = Array.isArray(coords) ? coords[1] : item.latitude;
        return Object.assign({}, item, {
          id: String(stationId),
          stationId: String(stationId),
          label: String(item.label || item.nameJa || stationId),
          longitude: finite(longitude) ? Number(longitude) : null,
          latitude: finite(latitude) ? Number(latitude) : null,
          lineCodes: item.lineCodes && typeof item.lineCodes === 'object' ? item.lineCodes : {}
        });
      }).filter(Boolean);
    }

    function rebuildIndexes() {
      var regionById = new Map();
      var areaById = new Map();
      var objectById = new Map();
      var objectsByArea = new Map();
      var lineById = new Map();
      var stationById = new Map();
      var stationAliasToId = new Map();
      var ambiguousStationAliases = new Set();
      var stationPositionById = new Map();
      var placeById = new Map();
      var placeByMapStationId = new Map();
      var placeBySourceObjectId = new Map();
      var placePointByObjectId = new Map();
      var anchorByArea = new Map();
      var areasByStation = new Map();
      var packageToArea = new Map();
      var packageToObject = new Map();
      var railNeighbors = new Map();
      var interestByAnchorKey = new Map();
      var edgePathById = new Map();

      function registerStationAlias(alias, canonicalId) {
        var key = String(alias || '').trim();
        var canonical = String(canonicalId || '').trim();
        if (!key || !canonical || ambiguousStationAliases.has(key)) return;
        var existing = stationAliasToId.get(key);
        if (existing && existing !== canonical) {
          stationAliasToId.delete(key);
          ambiguousStationAliases.add(key);
          return;
        }
        stationAliasToId.set(key, canonical);
      }

      browse.regions.forEach(function (item) { regionById.set(String(item.id), item); });
      browse.areas.forEach(function (item) {
        areaById.set(String(item.id), item);
        if (item.parentPackageId) packageToArea.set(String(item.parentPackageId), String(item.id));
      });
      browse.objects.forEach(function (item) {
        var objectId = String(item.objectId || '');
        if (!objectId) return;
        objectById.set(objectId, item);
        if (!objectsByArea.has(item.areaId)) objectsByArea.set(item.areaId, []);
        objectsByArea.get(item.areaId).push(item);
        array(item.packageIds).forEach(function (packageId) { packageToObject.set(String(packageId), objectId); });
      });
      transit.lines.forEach(function (item) { if (item && item.id) lineById.set(String(item.id), item); });
      geo.lineGeometries.forEach(function (item) {
        var lineId = String(item.lineId || item.id || '');
        if (lineId && !lineById.has(lineId)) lineById.set(lineId, { id: lineId, label: item.label || lineId, color: item.color || '', operator: item.operator || '', tier: item.tier || '' });
      });
      transit.stations.forEach(function (item) {
        if (!item || !item.id) return;
        var stationId = String(item.id);
        stationById.set(stationId, Object.assign({}, item, { id: stationId }));
        registerStationAlias(stationId, stationId);
      });
      stationAdditions().forEach(function (item) {
        if (stationById.has(item.id)) stationById.set(item.id, Object.assign({}, stationById.get(item.id), item));
        else stationById.set(item.id, item);
        [item.id, item.stationId, item.mapStationId, item.railStationId].forEach(function (alias) {
          registerStationAlias(alias, item.id);
        });
        if (finite(item.longitude) && finite(item.latitude)) stationPositionById.set(item.id, item);
      });
      geo.stationPoints.forEach(function (item) {
        stationPositionById.set(item.stationId, item);
        [item.stationId, item.railStationId, item.mapStationId].forEach(function (alias) {
          registerStationAlias(alias, item.stationId);
        });
        if (stationById.has(item.stationId)) stationById.set(item.stationId, Object.assign({}, stationById.get(item.stationId), item, { id: item.stationId }));
        else stationById.set(item.stationId, Object.assign({}, item, { id: item.stationId, lineCodes: item.lineCodes || {} }));
      });
      registryPlaces().forEach(function (place) {
        placeById.set(place.placeId, place);
        if (place.mapStationId) placeByMapStationId.set(String(place.mapStationId), place);
        if (place.sourceObjectId) placeBySourceObjectId.set(String(place.sourceObjectId), place);
        if (place.kind === 'station' && place.mapStationId) {
          var stationId = String(place.mapStationId);
          var existing = stationById.get(stationId) || { id: stationId, lineCodes: {} };
          stationById.set(stationId, Object.assign({}, existing, {
            id: stationId,
            label: place.label || existing.label || stationId,
            nameJa: place.nameJa || existing.nameJa || '',
            aliases: unique(array(existing.aliases).concat(place.aliases || [])),
            regionId: place.regionId || existing.regionId || '',
            adminNodeId: place.adminNodeId || '',
            adminPath: array(place.adminPath).slice(),
            placeId: place.placeId
          }));
          if (place.coordinates) stationPositionById.set(stationId, { stationId: stationId, longitude: place.coordinates[0], latitude: place.coordinates[1], label: place.label, sourceId: 'registry_place' });
        }
      });
      stationById.forEach(function (station, stationId) {
        [stationId, station.stationId, station.mapStationId, station.railStationId].concat(array(station.aliases)).forEach(function (alias) {
          registerStationAlias(alias, stationId);
        });
      });
      geo.placePoints.forEach(function (item) { placePointByObjectId.set(item.objectId, item); });
      transit.edges.forEach(function (edge) {
        if (!edge || !edge.from || !edge.to) return;
        if (!railNeighbors.has(edge.from)) railNeighbors.set(edge.from, []);
        if (!railNeighbors.has(edge.to)) railNeighbors.set(edge.to, []);
        railNeighbors.get(edge.from).push({ stationId: edge.to, lineId: edge.lineId, edgeId: edge.id });
        railNeighbors.get(edge.to).push({ stationId: edge.from, lineId: edge.lineId, edgeId: edge.id });
      });
      transit.areaAnchors.forEach(function (item) {
        if (!item || !item.areaId) return;
        anchorByArea.set(item.areaId, item);
        array(item.stationIds).forEach(function (stationId) {
          if (!areasByStation.has(stationId)) areasByStation.set(stationId, []);
          areasByStation.get(stationId).push(item.areaId);
        });
      });
      geo.edgePaths.forEach(function (item) { edgePathById.set(item.edgeId, item); });

      registry.walkingInterests.forEach(function (record, index) {
        if (!record || typeof record !== 'object') return;
        var anchorKeys = [];
        if (record.anchorPlaceId) {
          anchorKeys.push('place:' + String(record.anchorPlaceId));
          var anchorPlace = placeById.get(String(record.anchorPlaceId));
          if (anchorPlace && anchorPlace.mapStationId) anchorKeys.push('station:' + String(anchorPlace.mapStationId));
          if (anchorPlace && anchorPlace.sourceObjectId) anchorKeys.push('object:' + String(anchorPlace.sourceObjectId));
        }
        if (record.anchorType && record.anchorId) anchorKeys.push(String(record.anchorType) + ':' + String(record.anchorId));
        if (record.stationId) anchorKeys.push('station:' + String(record.stationId));
        if (record.objectId) anchorKeys.push('object:' + String(record.objectId));
        var targetPlace = record.targetPlaceId ? placeById.get(String(record.targetPlaceId)) : null;
        var targetObjectId = String(record.targetObjectId || (targetPlace && targetPlace.sourceObjectId) || '');
        var row = {
          relationId: String(record.relationId || 'interest-' + index),
          objectId: targetObjectId,
          placeId: String(record.targetPlaceId || ''),
          label: String(record.fullName || (targetPlace && targetPlace.label) || record.label || targetObjectId || record.targetPlaceId || ''),
          reviewedWalkingBand: record.reviewedWalkingBand || null,
          mapPoint: targetPlace && targetPlace.coordinates ? { longitude: targetPlace.coordinates[0], latitude: targetPlace.coordinates[1] } : null,
          displayOrder: finite(record.displayOrder) ? Number(record.displayOrder) : index
        };
        unique(anchorKeys).forEach(function (key) {
          if (!interestByAnchorKey.has(key)) interestByAnchorKey.set(key, []);
          interestByAnchorKey.get(key).push(row);
        });
      });
      interestByAnchorKey.forEach(function (rows) {
        rows.sort(function (left, right) { return left.displayOrder - right.displayOrder || left.label.localeCompare(right.label, 'zh-CN'); });
      });

      indexes = {
        regionById: regionById,
        areaById: areaById,
        objectById: objectById,
        objectsByArea: objectsByArea,
        lineById: lineById,
        stationById: stationById,
        stationAliasToId: stationAliasToId,
        stationPositionById: stationPositionById,
        placeById: placeById,
        placeByMapStationId: placeByMapStationId,
        placeBySourceObjectId: placeBySourceObjectId,
        placePointByObjectId: placePointByObjectId,
        anchorByArea: anchorByArea,
        areasByStation: areasByStation,
        packageToArea: packageToArea,
        packageToObject: packageToObject,
        railNeighbors: railNeighbors,
        interestByAnchorKey: interestByAnchorKey,
        edgePathById: edgePathById
      };
      if (state.regionId !== 'all' && !regionById.has(state.regionId)) state.regionId = 'all';
      var renderedLineIds = unique(geo.lineGeometries.map(function (feature) { return String(feature.lineId || feature.id || ''); }).filter(Boolean));
      var selectableLineIds = new Set(renderedLineIds.length ? renderedLineIds : Array.from(lineById.keys()));
      if (Array.isArray(options.initialLineIds) && options.initialLineIds.length) {
        state.activeLineIds = new Set(options.initialLineIds.map(String).filter(function (id) { return selectableLineIds.has(id); }));
      } else {
        state.activeLineIds = new Set(renderedLineIds.length ? renderedLineIds : Array.from(lineById.keys()));
      }
    }

    function canonicalStationId(stationId) {
      var id = String(stationId || '');
      return indexes.stationAliasToId.get(id) || id;
    }

    function stationLineIds(station) {
      if (!station) return [];
      if (Array.isArray(station.lineIds)) return unique(station.lineIds);
      return Object.keys(station.lineCodes && typeof station.lineCodes === 'object' ? station.lineCodes : {});
    }

    function regionForArea(areaId) {
      var area = indexes.areaById.get(String(areaId || ''));
      return area ? String(area.regionId || '') : '';
    }

    function firstAreaRegion(areaIds) {
      var ids = array(areaIds);
      for (var index = 0; index < ids.length; index += 1) {
        var regionId = regionForArea(ids[index]);
        if (regionId) return regionId;
      }
      return '';
    }

    function exportEndpoint(endpoint) {
      if (!endpoint) return null;
      return {
        type: endpoint.type,
        id: endpoint.id,
        label: endpoint.label,
        placeId: endpoint.placeId || null,
        objectId: endpoint.objectId || null,
        areaId: endpoint.areaId || null,
        regionId: endpoint.regionId || null,
        stationIds: array(endpoint.stationIds).slice(),
        areaIds: array(endpoint.areaIds).slice(),
        coordinates: endpoint.coordinates ? clone(endpoint.coordinates) : null,
        adminPath: array(endpoint.adminPath).slice()
      };
    }

    function endpointFromStation(stationId) {
      var station = indexes.stationById.get(canonicalStationId(stationId));
      if (!station) return null;
      var position = indexes.stationPositionById.get(station.id);
      var place = indexes.placeByMapStationId.get(station.id);
      var areaIds = (indexes.areasByStation.get(station.id) || []).slice();
      return {
        type: 'station',
        id: station.id,
        label: stationFormalLabel(station),
        placeId: place ? place.placeId : station.placeId || null,
        stationIds: [station.id],
        areaIds: areaIds,
        regionId: String((position && position.regionId) || station.regionId || (place && place.regionId) || firstAreaRegion(areaIds) || ''),
        coordinates: position ? { longitude: position.longitude, latitude: position.latitude } : null,
        adminPath: place ? array(place.adminPath).slice() : array(station.adminPath).slice()
      };
    }

    function endpointFromObject(objectId) {
      var id = String(objectId || '');
      var object = indexes.objectById.get(id);
      var place = indexes.placeBySourceObjectId.get(id) || indexes.placeById.get(id);
      if (!object && !place) return null;
      var areaId = object ? object.areaId : array(place.editorialAreaIds)[0] || '';
      var area = indexes.areaById.get(String(areaId || ''));
      var anchor = indexes.anchorByArea.get(areaId);
      var point = indexes.placePointByObjectId.get(id);
      if (!point && place && place.coordinates) point = { longitude: place.coordinates[0], latitude: place.coordinates[1] };
      return {
        type: 'object',
        id: id,
        label: String((place && place.label) || (object && (object.browseLabel || object.displayName)) || id),
        placeId: place ? place.placeId : null,
        objectId: id,
        areaId: areaId || null,
        regionId: String((place && place.regionId) || (object && object.regionId) || (area && area.regionId) || (anchor && anchor.regionId) || ''),
        stationIds: anchor ? array(anchor.stationIds).slice() : place && place.mapStationId ? [String(place.mapStationId)] : [],
        areaIds: areaId ? [areaId] : [],
        coordinates: point && finite(point.longitude) && finite(point.latitude) ? { longitude: Number(point.longitude), latitude: Number(point.latitude) } : null,
        adminPath: place ? array(place.adminPath).slice() : []
      };
    }

    function endpointFromPlace(placeId) {
      var place = indexes.placeById.get(String(placeId || ''));
      if (!place) return null;
      if (place.kind === 'station' && place.mapStationId) return endpointFromStation(place.mapStationId);
      if (place.sourceObjectId) return endpointFromObject(place.sourceObjectId);
      var placeAreaIds = array(place.editorialAreaIds).slice();
      return {
        type: 'place',
        id: place.placeId,
        label: place.label,
        placeId: place.placeId,
        areaId: placeAreaIds[0] || null,
        regionId: String(place.regionId || firstAreaRegion(placeAreaIds) || ''),
        stationIds: place.mapStationId ? [String(place.mapStationId)] : [],
        areaIds: placeAreaIds,
        coordinates: place.coordinates ? { longitude: place.coordinates[0], latitude: place.coordinates[1] } : null,
        adminPath: array(place.adminPath).slice()
      };
    }

    function endpointFromArea(areaId) {
      var area = indexes.areaById.get(String(areaId || ''));
      if (!area) return null;
      var anchor = indexes.anchorByArea.get(area.id);
      return {
        type: 'area',
        id: area.id,
        label: String(area.label || area.id),
        areaId: area.id,
        regionId: String(area.regionId || (anchor && anchor.regionId) || ''),
        stationIds: anchor ? array(anchor.stationIds).slice() : [],
        areaIds: [area.id],
        coordinates: finite(anchor && anchor.longitude) && finite(anchor && anchor.latitude) ? { longitude: Number(anchor.longitude), latitude: Number(anchor.latitude) } : null,
        adminPath: []
      };
    }

    function endpointFromDescriptor(descriptor) {
      if (!descriptor || typeof descriptor !== 'object') return null;
      if (descriptor.type === 'station') return endpointFromStation(descriptor.id);
      if (descriptor.type === 'object') return endpointFromObject(descriptor.id);
      if (descriptor.type === 'area') return endpointFromArea(descriptor.id);
      if (descriptor.type === 'place') return endpointFromPlace(descriptor.id);
      return null;
    }

    function favoriteSlot(slotId) {
      return favoritePlaces.slots.find(function (item) { return item.slotId === slotId; }) || null;
    }

    function resolvedFavorite(slotId) {
      var slot = favoriteSlot(slotId);
      if (!slot) return null;
      var endpoint = endpointFromDescriptor(slot.endpoint);
      return { slot: slot, endpoint: endpoint, stale: Boolean(slot.endpoint && !endpoint) };
    }

    function endpointInterests(endpoint) {
      if (!endpoint) return [];
      var keys = [endpointKey(endpoint)];
      if (endpoint.placeId) keys.push('place:' + endpoint.placeId);
      if (endpoint.type === 'station') {
        var stationPlace = indexes.placeByMapStationId.get(endpoint.id);
        if (stationPlace) keys.push('place:' + stationPlace.placeId);
      }
      if (endpoint.objectId) {
        keys.push('object:' + endpoint.objectId);
        var objectPlace = indexes.placeBySourceObjectId.get(endpoint.objectId);
        if (objectPlace) keys.push('place:' + objectPlace.placeId);
      }
      var byIdentity = new Map();
      unique(keys).forEach(function (key) {
        array(indexes.interestByAnchorKey.get(key)).forEach(function (row) {
          var identity = row.objectId || row.placeId || row.label;
          if (identity && !byIdentity.has(identity)) byIdentity.set(identity, row);
        });
      });
      return Array.from(byIdentity.values());
    }

    function findRailPath(originStationIds, destinationStationIds) {
      var origins = array(originStationIds).filter(function (id) { return indexes.stationById.has(id); });
      var destinations = new Set(array(destinationStationIds).filter(function (id) { return indexes.stationById.has(id); }));
      if (!origins.length || !destinations.size) return null;
      var distance = new Map();
      var previous = new Map();
      var queue = [];
      origins.forEach(function (stationId) {
        var key = stationId + '\u001f';
        distance.set(key, 0);
        queue.push({ key: key, stationId: stationId, lineId: '', cost: 0 });
      });
      var target = null;
      while (queue.length) {
        queue.sort(function (left, right) { return left.cost - right.cost; });
        var current = queue.shift();
        if (current.cost !== distance.get(current.key)) continue;
        if (destinations.has(current.stationId)) { target = current; break; }
        array(indexes.railNeighbors.get(current.stationId)).forEach(function (neighbor) {
          var transfer = current.lineId && current.lineId !== neighbor.lineId ? 1 : 0;
          var nextCost = current.cost + 1 + transfer * 0.001;
          var nextKey = neighbor.stationId + '\u001f' + neighbor.lineId;
          if (!distance.has(nextKey) || nextCost < distance.get(nextKey)) {
            distance.set(nextKey, nextCost);
            previous.set(nextKey, { key: current.key, from: current.stationId, to: neighbor.stationId, lineId: neighbor.lineId, edgeId: neighbor.edgeId });
            queue.push({ key: nextKey, stationId: neighbor.stationId, lineId: neighbor.lineId, cost: nextCost });
          }
        });
      }
      if (!target) return null;
      var steps = [];
      var cursor = target.key;
      while (previous.has(cursor)) {
        var record = previous.get(cursor);
        steps.push(record);
        cursor = record.key;
      }
      steps.reverse();
      var segments = [];
      steps.forEach(function (step) {
        var last = segments[segments.length - 1];
        if (!last || last.lineId !== step.lineId) {
          var line = indexes.lineById.get(step.lineId);
          last = {
            lineId: step.lineId,
            lineLabel: line ? line.label : step.lineId,
            fromStationId: step.from,
            toStationId: step.to,
            stationIds: [step.from, step.to],
            edgeCount: 1
          };
          segments.push(last);
        } else {
          last.toStationId = step.to;
          last.stationIds.push(step.to);
          last.edgeCount += 1;
        }
      });
      var stationIds = steps.length ? [steps[0].from].concat(steps.map(function (step) { return step.to; })) : [target.stationId];
      return {
        originStationId: stationIds[0],
        destinationStationId: stationIds[stationIds.length - 1],
        stationIds: stationIds,
        edgeIds: steps.map(function (step) { return step.edgeId; }),
        lineSegments: segments,
        edgeCount: steps.length,
        transferCount: Math.max(0, segments.length - 1),
        selectionMethod: 'verified_topology_min_edges_then_transfers'
      };
    }

    function updateRailPath() {
      state.railPath = state.routeOrigin && state.routeDestination ? findRailPath(state.routeOrigin.stationIds, state.routeDestination.stationIds) : null;
    }

    function normalizeEstimate(item, mode) {
      if (!item || item.ok === false || !finite(item.minutes)) return null;
      return Object.assign({}, item, { mode: mode, minutes: Math.max(0, Math.round(Number(item.minutes))) });
    }

    function normalizeEstimateResult(value) {
      var source = value && value.estimates && typeof value.estimates === 'object' ? value.estimates : value && typeof value === 'object' ? value : {};
      var result = {};
      TRAVEL_MODES.forEach(function (mode) {
        var aliases = mode === 'public_transit' ? [source.public_transit, source.transit] : [source[mode]];
        var item = aliases.find(Boolean);
        var normalized = normalizeEstimate(item, mode);
        if (normalized) result[mode] = normalized;
      });
      var singleMode = value && value.mode === 'transit' ? 'public_transit' : value && value.mode;
      if (value && validTravelMode(singleMode)) {
        var single = normalizeEstimate(value, singleMode);
        if (single) result[single.mode] = single;
      }
      return result;
    }

    function effectiveRailPath() {
      var estimate = state.travelEstimates && state.travelEstimates.public_transit;
      return estimate && estimate.railPath && typeof estimate.railPath === 'object'
        ? estimate.railPath
        : state.railPath;
    }

    function requestTravelEstimates() {
      updateRailPath();
      state.estimateRevision += 1;
      var revision = state.estimateRevision;
      state.travelEstimates = {};
      state.appendStatus = '';
      if (!state.routeOrigin || !state.routeDestination) {
        state.estimatePending = false;
        renderAllDynamic();
        renderMapLayers();
        return Promise.resolve({});
      }
      var service = options.timeEstimator || options.transitTime || options.onEstimateTravel;
      if (!service) {
        state.estimatePending = false;
        state.appendStatus = '参考耗时服务尚未接入。';
        renderAllDynamic();
        renderMapLayers();
        return Promise.resolve({});
      }
      state.estimatePending = true;
      renderAllDynamic();
      renderMapLayers();
      var base = {
        schemaVersion: 1,
        origin: exportEndpoint(state.routeOrigin),
        destination: exportEndpoint(state.routeDestination),
        railPath: state.railPath ? clone(state.railPath) : null,
        datasetId: transit.datasetId,
        transportContext: options.transportContext && typeof options.transportContext === 'object' ? options.transportContext : null,
        waypointPolicy: {
          source: 'explicit_text_evidence_only',
          allowedKinds: ['famous_bridge', 'famous_expressway', 'famous_road', 'famous_tunnel', 'famous_bay', 'famous_port', 'famous_pier', 'ferry_crossing'],
          forbiddenKinds: ['station', 'administrative_area']
        },
        note: '地图只提交真实端点、核定拓扑与文字交通资料，不使用图上像素估时，也不从地图几何推断途经点'
      };
      var pending;
      try {
        if (typeof service === 'function') pending = service(base);
        else if (typeof service.estimateAll === 'function') pending = service.estimateAll(base);
        else if (typeof service.estimateRoute === 'function') {
          pending = Promise.all(TRAVEL_MODES.map(function (mode) {
            var requestMode = mode === 'public_transit' ? 'transit' : mode;
            return asPromise(service.estimateRoute(Object.assign({}, base, { mode: requestMode }))).then(function (item) { return { mode: mode, item: item }; }, function () { return { mode: mode, item: null }; });
          })).then(function (rows) {
            var estimates = {};
            rows.forEach(function (row) { if (row.item && row.item.ok !== false) estimates[row.mode] = row.item; });
            return estimates;
          });
        } else if (typeof service.estimate === 'function') pending = service.estimate(base);
        else pending = {};
      } catch (error) {
        pending = Promise.reject(error);
      }
      return asPromise(pending).then(function (value) {
        if (destroyed || revision !== state.estimateRevision) return state.travelEstimates;
        state.travelEstimates = normalizeEstimateResult(value);
        state.estimatePending = false;
        if (!state.travelEstimates[state.selectedTravelMode]) state.appendStatus = '当前方式暂时没有可用参考耗时。';
        renderAllDynamic();
        renderMapLayers();
        notifyRouteChange();
        return state.travelEstimates;
      }, function () {
        if (!destroyed && revision === state.estimateRevision) {
          state.estimatePending = false;
          state.appendStatus = '参考耗时暂时无法更新。';
          renderAllDynamic();
          renderMapLayers();
          notifyRouteChange();
        }
        return state.travelEstimates;
      });
    }

    function setRouteEndpoint(endpoint, slot) {
      if (!endpoint || (slot !== 'origin' && slot !== 'destination')) return false;
      var current = slot === 'origin' ? state.routeOrigin : state.routeDestination;
      if (current && endpointKey(current) === endpointKey(endpoint)) {
        state.status = slot === 'origin' ? '这个地点已经是起点。' : '这个地点已经是目的地。';
        renderFocus();
        renderStatus();
        return true;
      }
      var other = slot === 'origin' ? state.routeDestination : state.routeOrigin;
      if (other && endpointKey(other) === endpointKey(endpoint)) {
        state.status = '起点和终点需要不同；请先取消另一端，或选择其他地点。';
        renderStatus();
        return false;
      }
      if (slot === 'origin') state.routeOrigin = endpoint;
      else state.routeDestination = endpoint;
      state.status = state.routeOrigin && state.routeDestination ? '起点和终点已更新，正在重新估算。' : slot === 'origin' ? '起点已选，请再选择终点。' : '终点已选，请再选择起点。';
      requestTravelEstimates();
      renderFocus();
      notifyRouteChange();
      return true;
    }

    function clearRouteEndpoint(slot) {
      if (slot !== 'origin' && slot !== 'destination') return false;
      var current = slot === 'origin' ? state.routeOrigin : state.routeDestination;
      if (!current) return false;
      if (slot === 'origin') state.routeOrigin = null;
      else state.routeDestination = null;
      state.railPath = null;
      state.travelEstimates = {};
      state.estimatePending = false;
      state.estimateRevision += 1;
      state.appendStatus = '';
      state.appendCopyText = '';
      state.status = slot === 'origin' ? '已取消起点；另一端、当前地点和出行方式均已保留。' : '已取消目的地；另一端、当前地点和出行方式均已保留。';
      renderAllDynamic();
      renderMapLayers();
      notifyRouteChange();
      return true;
    }

    function toggleFocusedEndpoint(slot) {
      if (!state.focus) {
        state.status = '请先选择一个明确地点。';
        renderStatus();
        return false;
      }
      var current = slot === 'origin' ? state.routeOrigin : slot === 'destination' ? state.routeDestination : null;
      if (current && endpointKey(current) === endpointKey(state.focus)) return clearRouteEndpoint(slot);
      return setRouteEndpoint(state.focus, slot);
    }

    function clearRoute() {
      state.routeOrigin = null;
      state.routeDestination = null;
      state.railPath = null;
      state.travelEstimates = {};
      state.estimatePending = false;
      state.estimateRevision += 1;
      state.appendStatus = '';
      state.appendCopyText = '';
      state.status = '路线已清空；当前焦点、地图视野和出行方式均已保留。';
      renderAllDynamic();
      renderMapLayers();
      notifyRouteChange();
    }

    function setFocus(endpoint, reveal, reason) {
      if (!endpoint) return false;
      state.focus = endpoint;
      state.selectedStationId = endpoint.type === 'station' ? endpoint.id : null;
      state.selectedAreaId = endpoint.areaId || null;
      state.selectedObjectId = endpoint.objectId || null;
      state.candidateIds = [];
      state.candidatePoint = null;
      if (reveal && endpoint.coordinates) {
        state.view.center = { longitude: endpoint.coordinates.longitude, latitude: endpoint.coordinates.latitude };
        state.view.zoom = Math.max(5, state.view.zoom);
        clampView();
        applyViewTransform();
        emitViewChange(reason || 'focus');
      }
      state.status = '正在查看' + endpoint.label + '；路线端点没有自动改变。';
      renderFocus();
      renderSearchHistory();
      renderMapLayers();
      renderStatus();
      if (typeof options.onFocusChange === 'function') {
        options.onFocusChange({ focus: exportEndpoint(endpoint), interests: clone(endpointInterests(endpoint)) });
      }
      return true;
    }

    function useFavorite(slotId) {
      var resolved = resolvedFavorite(slotId);
      if (!resolved || !resolved.endpoint) {
        state.status = resolved && resolved.stale ? '这个常用地点需要重新选择。' : '这个常用地点尚未设置。';
        renderStatus();
        return false;
      }
      var endpoint = resolved.endpoint;
      setFocus(endpoint, Boolean(endpoint.coordinates), 'favorite_focus');
      var key = endpointKey(endpoint);
      if (state.routeOrigin && endpointKey(state.routeOrigin) === key) {
        state.status = endpoint.label + '当前是起点；如需取消，请使用下方红色“取消起点”。';
        renderStatus();
        return true;
      }
      if (state.routeDestination && endpointKey(state.routeDestination) === key) {
        state.status = endpoint.label + '当前是目的地；如需取消，请使用下方绿色“取消目的地”。';
        renderStatus();
        return true;
      }
      if (!state.routeOrigin) return setRouteEndpoint(endpoint, 'origin');
      if (!state.routeDestination) return setRouteEndpoint(endpoint, 'destination');
      state.status = '起点和终点都已保留；本次只查看' + endpoint.label + '。';
      renderStatus();
      return true;
    }

    function lineColor(feature) {
      if (feature && feature.color) return feature.color;
      var line = feature && feature.lineId ? indexes.lineById.get(feature.lineId) : null;
      return line && line.color ? line.color : '#77928a';
    }

    function featurePaths(feature) {
      return geometryLines(feature.geometry).map(function (coordinates) { return pathFromCoordinates(coordinates, projector); }).filter(Boolean);
    }

    function renderStaticBase() {
      var landTarget = container.querySelector('[data-role="map-land-water"]');
      var adminTarget = container.querySelector('[data-role="map-admin"]');
      var riverTarget = container.querySelector('[data-role="map-landmark-rivers"]');
      var railwayTarget = container.querySelector('[data-role="map-railways"]');
      if (landTarget) {
        landTarget.innerHTML = '<rect class="lj-map-sea-surface" x="0" y="0" width="' + SVG_WIDTH + '" height="' + SVG_HEIGHT + '"></rect>' +
          geo.landSurfacePaths.map(function (coordinates) {
            var path = pathFromCoordinates(coordinates, projector);
            return path ? '<path class="lj-map-land-surface" d="' + path + ' Z"></path>' : '';
          }).join('');
      }
      if (adminTarget) {
        adminTarget.innerHTML = geo.administrativeBoundaries.map(function (feature) {
          var level = feature.level || 'municipality';
          return featurePaths(feature).map(function (path) {
            return '<path class="lj-map-admin-line" data-admin-level="' + escapeAttribute(level) + '" d="' + path + '" vector-effect="non-scaling-stroke"><title>' + escapeHtml(feature.label) + '</title></path>';
          }).join('');
        }).join('');
      }
      if (riverTarget) {
        riverTarget.innerHTML = geo.rivers.map(function (feature) {
          return featurePaths(feature).map(function (path) {
            return '<path class="lj-map-landmark-river" d="' + path + '" vector-effect="non-scaling-stroke"><title>' + escapeHtml(feature.label) + '</title></path>';
          }).join('');
        }).join('');
      }
      if (railwayTarget) {
        railwayTarget.innerHTML = geo.lineGeometries.map(function (feature) {
          var color = lineColor(feature);
          var path = featurePaths(feature).join(' ');
          return path ? '<path class="lj-map-rail-line" data-line-id="' + escapeAttribute(feature.lineId || feature.id) + '" data-network-tier="' + escapeAttribute(feature.tier || 'secondary') + '" d="' + path + '" style="--lj-map-line-color:' + escapeAttribute(color) + '" vector-effect="non-scaling-stroke"><title>' + escapeHtml(feature.label) + '</title></path>' : '';
        }).join('');
      }
    }

    function worldCenter() {
      return projector.forward(state.view.center.longitude, state.view.center.latitude);
    }

    function legacyTransform() {
      var center = worldCenter();
      return {
        x: SVG_WIDTH / 2 - center.x * state.view.zoom,
        y: SVG_HEIGHT / 2 - center.y * state.view.zoom,
        scale: state.view.zoom
      };
    }

    function clampView() {
      state.view.zoom = clamp(state.view.zoom, MIN_ZOOM, MAX_ZOOM);
      var center = worldCenter();
      var metrics = mapUsesSlice() ? viewportMetrics() : null;
      var visibleCanvasWidth = metrics ? metrics.width / metrics.fit : SVG_WIDTH;
      var visibleCanvasHeight = metrics ? metrics.height / metrics.fit : SVG_HEIGHT;
      var halfX = visibleCanvasWidth / (2 * state.view.zoom);
      var halfY = visibleCanvasHeight / (2 * state.view.zoom);
      var overlapX = Math.min(halfX * 0.7, SVG_WIDTH * 0.2);
      var overlapY = Math.min(halfY * 0.7, SVG_HEIGHT * 0.2);
      center.x = clamp(center.x, -halfX + overlapX, SVG_WIDTH + halfX - overlapX);
      center.y = clamp(center.y, -halfY + overlapY, SVG_HEIGHT + halfY - overlapY);
      state.view.center = projector.inverse(center.x, center.y);
      state.lod = lodForZoom(state.view.zoom);
      return state.view;
    }

    function applyViewTransform() {
      if (!worldGroup) return;
      clearInteractionPreview();
      clampView();
      if (mapSvg) mapSvg.setAttribute('preserveAspectRatio', mapUsesSlice() ? 'xMidYMid slice' : 'xMidYMid meet');
      var center = worldCenter();
      worldGroup.setAttribute('transform', 'translate(' + (SVG_WIDTH / 2).toFixed(2) + ' ' + (SVG_HEIGHT / 2).toFixed(2) + ') scale(' + state.view.zoom.toFixed(5) + ') translate(' + (-center.x).toFixed(2) + ' ' + (-center.y).toFixed(2) + ')');
      container.setAttribute('data-map-lod', state.lod);
      paintedView = { center: worldCenter(), zoom: state.view.zoom };
    }

    function mapUsesSlice() {
      if (!rootElement || typeof rootElement.getAttribute !== 'function') return false;
      var host = typeof rootElement.closest === 'function' ? rootElement.closest('#living-japan-panel') : null;
      host = host || rootElement;
      return host.getAttribute('data-effective-layout') === 'vertical' || host.getAttribute('data-device') === 'mobile';
    }

    function viewportMetrics() {
      if (interactionMetrics || renderMetrics) return interactionMetrics || renderMetrics;
      var rect = viewport && viewport.getBoundingClientRect ? viewport.getBoundingClientRect() : { left: 0, top: 0, width: SVG_WIDTH, height: SVG_HEIGHT, right: SVG_WIDTH, bottom: SVG_HEIGHT };
      var width = rect.width || SVG_WIDTH;
      var height = rect.height || SVG_HEIGHT;
      var fit = (mapUsesSlice() ? Math.max(width / SVG_WIDTH, height / SVG_HEIGHT) : Math.min(width / SVG_WIDTH, height / SVG_HEIGHT)) || 1;
      var drawnWidth = SVG_WIDTH * fit;
      var drawnHeight = SVG_HEIGHT * fit;
      return {
        rect: rect,
        width: width,
        height: height,
        fit: fit,
        offsetX: (width - drawnWidth) / 2,
        offsetY: (height - drawnHeight) / 2
      };
    }

    function beginInteractionPreview() {
      if (!interactionMetrics) interactionMetrics = viewportMetrics();
      if (!previewView) {
        previewView = paintedView || { center: worldCenter(), zoom: state.view.zoom };
        if (renderFrame && interactionView && typeof interactionView.cancelAnimationFrame === 'function') interactionView.cancelAnimationFrame(renderFrame);
        renderFrame = 0;
      }
    }

    function clearInteractionPreview() {
      if (interactionFrame && interactionView && typeof interactionView.cancelAnimationFrame === 'function') interactionView.cancelAnimationFrame(interactionFrame);
      interactionFrame = 0;
      pointerUpdatePending = false;
      if (wheelCommitTimer !== null) {
        if (interactionView && typeof interactionView.clearTimeout === 'function') interactionView.clearTimeout(wheelCommitTimer);
        else clearTimeout(wheelCommitTimer);
      }
      wheelCommitTimer = null;
      if (previewView && mapSvg && mapSvg.style) {
        mapSvg.style.transform = '';
        mapSvg.style.willChange = '';
        mapSvg.style.transformOrigin = '';
      }
      previewView = null;
      interactionMetrics = null;
    }

    function paintInteractionPreview() {
      if (!previewView || !mapSvg || !mapSvg.style) return;
      clampView();
      var metrics = viewportMetrics();
      var center = worldCenter();
      var scale = state.view.zoom / previewView.zoom;
      var x = (metrics.offsetX + SVG_WIDTH / 2 * metrics.fit) * (1 - scale) + (previewView.center.x - center.x) * metrics.fit * state.view.zoom;
      var y = (metrics.offsetY + SVG_HEIGHT / 2 * metrics.fit) * (1 - scale) + (previewView.center.y - center.y) * metrics.fit * state.view.zoom;
      mapSvg.style.willChange = 'transform';
      mapSvg.style.transformOrigin = '0 0';
      mapSvg.style.transform = 'translate(' + x.toFixed(3) + 'px,' + y.toFixed(3) + 'px) scale(' + scale.toFixed(6) + ')';
    }

    function flushInteractionPreview() {
      if (interactionFrame && interactionView && typeof interactionView.cancelAnimationFrame === 'function') interactionView.cancelAnimationFrame(interactionFrame);
      interactionFrame = 0;
      if (pointerUpdatePending) {
        pointerUpdatePending = false;
        updatePointerGesture();
      }
      paintInteractionPreview();
    }

    function scheduleInteractionPreview() {
      if (interactionFrame) return;
      if (interactionView && typeof interactionView.requestAnimationFrame === 'function') {
        interactionFrame = interactionView.requestAnimationFrame(function () {
          interactionFrame = 0;
          if (!destroyed) flushInteractionPreview();
        });
      } else flushInteractionPreview();
    }

    function commitInteractionPreview(reason) {
      if (!previewView) return;
      flushInteractionPreview();
      applyViewTransform();
      renderMapLayers();
      if (reason) emitViewChange(reason);
    }

    function onViewportGeometryChange(event) {
      if (previewView) commitInteractionPreview('viewport_change');
      interactionMetrics = null;
      if (pointerState.size) startGesture();
      if (!event || event.type !== 'scroll') renderMapLayers();
      updateSearchResultsBounds();
    }

    function setLayerMarkup(target, markup) {
      if (!target || layerMarkup.get(target) === markup) return;
      layerMarkup.set(target, markup);
      target.innerHTML = markup;
    }

    function worldToCanvas(point) {
      var center = worldCenter();
      return {
        x: SVG_WIDTH / 2 + (point.x - center.x) * state.view.zoom,
        y: SVG_HEIGHT / 2 + (point.y - center.y) * state.view.zoom
      };
    }

    function canvasToWorld(point) {
      var center = worldCenter();
      return {
        x: center.x + (point.x - SVG_WIDTH / 2) / state.view.zoom,
        y: center.y + (point.y - SVG_HEIGHT / 2) / state.view.zoom
      };
    }

    function clientToCanvas(clientX, clientY) {
      var metrics = viewportMetrics();
      return {
        x: (Number(clientX) - metrics.rect.left - metrics.offsetX) / metrics.fit,
        y: (Number(clientY) - metrics.rect.top - metrics.offsetY) / metrics.fit
      };
    }

    function canvasToScreen(point, metrics) {
      var value = metrics || viewportMetrics();
      return { x: value.offsetX + point.x * value.fit, y: value.offsetY + point.y * value.fit };
    }

    function emitViewChange(reason) {
      if (typeof options.onViewChange === 'function') options.onViewChange(clone(state.view), { reason: reason || 'programmatic' });
    }

    function setView(value, reason) {
      state.view = normalizeView(value, state.view || homeView);
      clampView();
      applyViewTransform();
      renderMapLayers();
      emitViewChange(reason || 'set_view');
      return clone(state.view);
    }

    function resetView() {
      state.view = clone(state.homeView);
      applyViewTransform();
      renderMapLayers();
      state.status = '地图视野已复原；路线与当前焦点均未改变。';
      renderStatus();
      emitViewChange('reset');
      return clone(state.view);
    }

    // LJ001-V3-MAP-RESET: user reset clears route roles while keeping focus, search text and search history.
    function resetMap() {
      state.candidateIds = [];
      state.candidatePoint = null;
      clearRoute();
      resetView();
      state.status = '地图已复原；起点和终点已清空，当前地点与搜索历史已保留。';
      renderStatus();
      return getState();
    }

    function zoomAt(nextZoom, clientPoint, reason, live) {
      if (live) beginInteractionPreview();
      else if (previewView) commitInteractionPreview();
      var next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      var canvas = clientPoint ? clientToCanvas(clientPoint.x, clientPoint.y) : { x: SVG_WIDTH / 2, y: SVG_HEIGHT / 2 };
      var anchorWorld = canvasToWorld(canvas);
      var center = {
        x: anchorWorld.x - (canvas.x - SVG_WIDTH / 2) / next,
        y: anchorWorld.y - (canvas.y - SVG_HEIGHT / 2) / next
      };
      state.view.zoom = next;
      state.view.center = projector.inverse(center.x, center.y);
      if (live) {
        clampView();
        scheduleInteractionPreview();
        if (wheelCommitTimer !== null) {
          if (interactionView && typeof interactionView.clearTimeout === 'function') interactionView.clearTimeout(wheelCommitTimer);
          else clearTimeout(wheelCommitTimer);
        }
        var commitWheel = function () {
          wheelCommitTimer = null;
          if (!destroyed && !pointerState.size) commitInteractionPreview(reason || 'zoom');
        };
        wheelCommitTimer = interactionView && typeof interactionView.setTimeout === 'function' ? interactionView.setTimeout(commitWheel, 140) : setTimeout(commitWheel, 140);
      } else {
        applyViewTransform();
        renderMapLayers();
        emitViewChange(reason || 'zoom');
      }
      return clone(state.view);
    }

    function stationTier(station, position) {
      var tier = String((position && (position.labelTier || position.tier)) || station.labelTier || station.tier || '').toLowerCase();
      if (tier === 'primary' || tier === 'major' || tier === 'far') return 'primary';
      if (tier === 'secondary' || tier === 'mid') return 'secondary';
      if (tier === 'local' || tier === 'near') return 'local';
      if (PRIMARY_STATIONS.has(station.id) || stationLineIds(station).length >= 3) return 'primary';
      if (stationLineIds(station).length >= 2) return 'secondary';
      return 'local';
    }

    function roleForStation(stationId) {
      if (state.routeOrigin && state.routeOrigin.type === 'station' && state.routeOrigin.id === stationId) return 'origin';
      if (state.routeDestination && state.routeDestination.type === 'station' && state.routeDestination.id === stationId) return 'destination';
      return '';
    }

    function isFocusedStation(stationId) {
      return Boolean(state.focus && state.focus.type === 'station' && state.focus.id === stationId);
    }

    function collectReservedRects(metrics) {
      var selectors = ['[data-role="travel-mode-picker"]', '[data-role="favorite-rail"]', '[data-role="depart"]', '[data-role="zoom-controls"]', '[data-role="reset-view"]', '[data-role="endpoint-shortcuts"]', '[data-role="map-search-shell"]', '[data-role="transit-search-history"]', '[data-role="map-side-panel"]'];
      return selectors.map(function (selector) {
        var node = container.querySelector(selector);
        if (!node || !node.getBoundingClientRect) return null;
        var rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
          left: rect.left - metrics.rect.left - 5,
          top: rect.top - metrics.rect.top - 5,
          right: rect.right - metrics.rect.left + 5,
          bottom: rect.bottom - metrics.rect.top + 5
        };
      }).filter(Boolean);
    }

    function visibleStationRecords() {
      var metrics = viewportMetrics();
      var rows = [];
      indexes.stationById.forEach(function (station, stationId) {
        var position = indexes.stationPositionById.get(stationId);
        if (!position || !finite(position.longitude) || !finite(position.latitude)) return;
        var point = projector.forward(position.longitude, position.latitude);
        var canvas = worldToCanvas(point);
        var screen = canvasToScreen(canvas, metrics);
        var focused = isFocusedStation(stationId);
        var role = roleForStation(stationId);
        var forced = focused || Boolean(role);
        var tier = stationTier(station, position);
        if (!stationVisibleAtLod(state.lod, tier, forced, stationId)) return;
        if (screen.x < -70 || screen.y < -70 || screen.x > metrics.width + 70 || screen.y > metrics.height + 70) return;
        rows.push({ station: station, position: position, point: point, canvas: canvas, screen: screen, focused: focused, role: role, forced: forced, tier: tier });
      });
      return { rows: rows, metrics: metrics };
    }

    function collisionPriority(row) {
      if (row.role) return 10000;
      if (row.focused) return 9000;
      var source = row.position && finite(row.position.collisionPriority) ? Number(row.position.collisionPriority) : 0;
      if (row.tier === 'primary') return 5000 + source;
      if (row.tier === 'secondary') return 3000 + source;
      return 1000 + source;
    }

    function layoutStationLabels(records, metrics) {
      var reserved = collectReservedRects(metrics);
      var accepted = [];
      var result = new Map();
      var ordered = records.slice().sort(function (left, right) {
        return collisionPriority(right) - collisionPriority(left) || String(left.station.id).localeCompare(String(right.station.id));
      });
      ordered.forEach(function (row) {
        var label = String(row.station.label || row.station.nameJa || row.station.id);
        var presentation = presentationForUI({ type: 'station', id: row.station.id, label: label });
        if (presentation.translated) label = presentation.displayLabel;
        var font = row.forced ? 15 : row.tier === 'primary' ? 14 : 12;
        var roleText = row.role === 'origin' ? '起点 ' : row.role === 'destination' ? '终点 ' : '';
        var displayLabel = roleText + label;
        var width = Math.max(28, Array.from(displayLabel).length * font * 0.95 + 10);
        var height = font + 8;
        var gap = 11;
        var anchors = [
          { key: 'right', x: gap, y: -height / 2 },
          { key: 'left', x: -gap - width, y: -height / 2 },
          { key: 'upper-right', x: gap, y: -height - 6 },
          { key: 'lower-right', x: gap, y: 7 },
          { key: 'above', x: -width / 2, y: -height - 9 },
          { key: 'below', x: -width / 2, y: 9 },
          { key: 'far-right', x: gap + 18, y: -height / 2 },
          { key: 'far-left', x: -gap - width - 18, y: -height / 2 },
          { key: 'far-above', x: -width / 2, y: -height - 28 },
          { key: 'far-below', x: -width / 2, y: 28 }
        ];
        if (row.forced) {
          reserved.forEach(function (rect, reservedIndex) {
            anchors.push(
              { key: 'reserved-' + reservedIndex + '-left', x: rect.left - row.screen.x - width - 8, y: clamp(row.screen.y - height / 2, 4, metrics.height - height - 4) - row.screen.y },
              { key: 'reserved-' + reservedIndex + '-right', x: rect.right - row.screen.x + 8, y: clamp(row.screen.y - height / 2, 4, metrics.height - height - 4) - row.screen.y },
              { key: 'reserved-' + reservedIndex + '-above', x: clamp(row.screen.x - width / 2, 4, metrics.width - width - 4) - row.screen.x, y: rect.top - row.screen.y - height - 8 },
              { key: 'reserved-' + reservedIndex + '-below', x: clamp(row.screen.x - width / 2, 4, metrics.width - width - 4) - row.screen.x, y: rect.bottom - row.screen.y + 8 }
            );
          });
        }
        var chosen = null;
        anchors.some(function (anchor) {
          var box = { left: row.screen.x + anchor.x, top: row.screen.y + anchor.y, right: row.screen.x + anchor.x + width, bottom: row.screen.y + anchor.y + height };
          var outside = box.left < 4 || box.top < 4 || box.right > metrics.width - 4 || box.bottom > metrics.height - 4;
          var blocked = reserved.some(function (rect) { return rectsIntersect(box, rect); }) || accepted.some(function (rect) { return rectsIntersect(box, rect); });
          if (!outside && !blocked) {
            chosen = { anchor: anchor, box: box, font: font, label: label };
            return true;
          }
          return false;
        });
        if (chosen) {
          accepted.push(chosen.box);
          result.set(row.station.id, chosen);
        }
      });
      lastStationLabelBoxes = accepted.slice();
      return result;
    }

    function renderAdministrativeLabels() {
      var target = container.querySelector('[data-role="map-admin-labels"]');
      if (!target) return;
      var metrics = viewportMetrics();
      var reserved = collectReservedRects(metrics);
      var accepted = lastStationLabelBoxes.slice();
      var rows = geo.administrativeLabels.filter(function (item) {
        if (item.level === 'prefecture') return true;
        if (state.lod === 'far') return item.tier === 'overview';
        if (state.lod === 'mid' || state.lod === 'near') return item.tier === 'overview' || item.tier === 'medium' || item.tier === 'mid';
        return true;
      }).map(function (item) {
        var world = projector.forward(item.longitude, item.latitude);
        var screen = canvasToScreen(worldToCanvas(world), metrics);
        return { item: item, world: world, screen: screen };
      }).filter(function (row) {
        return row.screen.x >= 0 && row.screen.y >= 0 && row.screen.x <= metrics.width && row.screen.y <= metrics.height;
      }).sort(function (left, right) {
        if (left.item.level !== right.item.level) return left.item.level === 'prefecture' ? -1 : 1;
        if (left.item.priority !== right.item.priority) return right.item.priority - left.item.priority;
        if (left.item.tier !== right.item.tier) return left.item.tier === 'overview' || left.item.tier === 'medium' ? -1 : 1;
        return left.item.id.localeCompare(right.item.id);
      });
      var markup = [];
      rows.forEach(function (row) {
        var font = row.item.level === 'prefecture' ? 18 : row.item.level === 'water' ? 15 : row.item.tier === 'overview' ? 14 : row.item.tier === 'medium' || row.item.tier === 'mid' ? 13 : 12;
        var width = Math.max(28, Array.from(row.item.label).length * font * 0.9 + 10);
        var box = { left: row.screen.x - width / 2, top: row.screen.y - font / 2 - 3, right: row.screen.x + width / 2, bottom: row.screen.y + font / 2 + 3 };
        var blocked = reserved.some(function (rect) { return rectsIntersect(box, rect); }) || accepted.some(function (rect) { return rectsIntersect(box, rect); });
        if (blocked) return;
        accepted.push(box);
        var worldFont = font / (metrics.fit || 1);
        var worldY = font * 0.34 / (metrics.fit || 1);
        markup.push('<g class="lj-map-admin-label is-' + escapeAttribute(row.item.level) + '" transform="translate(' + row.world.x.toFixed(2) + ' ' + row.world.y.toFixed(2) + ')"><text transform="scale(' + (1 / state.view.zoom).toFixed(6) + ')" x="0" y="' + worldY.toFixed(2) + '" style="font-size:' + worldFont.toFixed(2) + 'px">' + escapeHtml(row.item.label) + '</text></g>');
      });
      setLayerMarkup(target, markup.join(''));
    }

    function renderStations() {
      var target = container.querySelector('[data-role="map-stations"]');
      if (!target) return;
      var recordSet = visibleStationRecords();
      var records = recordSet.rows;
      var metrics = recordSet.metrics;
      var layouts = layoutStationLabels(records, metrics);
      var zoom = state.view.zoom;
      var fit = metrics.fit || 1;
      setLayerMarkup(target, records.map(function (row) {
        var station = row.station;
        var layout = layouts.get(station.id);
        var dotPx = row.tier === 'primary' ? 5.5 : row.tier === 'secondary' ? 4.5 : 3.6;
        var dotRadius = dotPx / (fit * zoom);
        var hitRadius = 22 / (fit * zoom);
        var focusRadius = 12 / (fit * zoom);
        var roleRadius = 9 / (fit * zoom);
        var classes = ['lj-map-station', 'is-' + row.tier];
        if (row.focused) classes.push('is-focused');
        if (row.role) classes.push('is-route-' + row.role);
        var labelMarkup = '';
        if (layout) {
          var x = layout.anchor.x / fit;
          var y = (layout.anchor.y + layout.font) / fit;
          var font = layout.font / fit;
          var roleText = row.role === 'origin' ? '起点 ' : row.role === 'destination' ? '终点 ' : '';
          labelMarkup = '<text class="lj-map-station-label" transform="scale(' + (1 / zoom).toFixed(6) + ')" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" style="font-size:' + font.toFixed(2) + 'px">' + escapeHtml(roleText + layout.label) + '</text>';
        }
        return [
          '<g class="' + classes.join(' ') + '" data-action="transit-focus-station" data-station-id="' + escapeAttribute(station.id) + '" transform="translate(' + row.point.x.toFixed(2) + ' ' + row.point.y.toFixed(2) + ')" tabindex="0" role="button" aria-label="查看' + escapeAttribute(stationFormalLabel(station)) + '">',
          '<circle class="lj-map-station-hit" r="' + hitRadius.toFixed(3) + '"></circle>',
          row.role ? '<circle class="lj-map-station-role-ring" r="' + roleRadius.toFixed(3) + '"></circle>' : '',
          row.focused ? '<circle class="lj-map-station-focus-ring" r="' + focusRadius.toFixed(3) + '"></circle>' : '',
          '<circle class="lj-map-station-dot" r="' + dotRadius.toFixed(3) + '"></circle>',
          labelMarkup,
          '<title>' + escapeHtml(stationFormalLabel(station)) + '</title>',
          '</g>'
        ].join('');
      }).join(''));
    }

    function renderRouteHighlight() {
      var target = container.querySelector('[data-role="map-route-highlight"]');
      if (!target) return;
      if (state.selectedTravelMode !== 'public_transit') { setLayerMarkup(target, ''); return; }
      var railPath = effectiveRailPath();
      if (!railPath) { setLayerMarkup(target, ''); return; }
      var geometryMarkup = array(railPath.geometryPaths).map(function (coordinates) {
        var path = pathFromCoordinates(coordinates, projector);
        return path ? '<path class="lj-map-route-highlight-outline" d="' + path + '" vector-effect="non-scaling-stroke"></path><path class="lj-map-route-highlight" d="' + path + '" vector-effect="non-scaling-stroke"></path>' : '';
      }).filter(Boolean).join('');
      if (geometryMarkup) { setLayerMarkup(target, geometryMarkup); return; }
      setLayerMarkup(target, array(railPath.edgeIds).map(function (edgeId) {
        var feature = indexes.edgePathById.get(edgeId);
        if (!feature) return '';
        return featurePaths(feature).map(function (path) { return '<path class="lj-map-route-highlight" d="' + path + '" vector-effect="non-scaling-stroke"></path>'; }).join('');
      }).join(''));
    }

    function renderPlacePoints() {
      var target = container.querySelector('[data-role="map-place-points"]');
      if (!target) return;
      var focusKey = state.focus && (state.focus.objectId || state.focus.placeId || state.focus.id);
      var records = [];
      var seen = new Set();
      geo.placePoints.forEach(function (point) {
        var object = indexes.objectById.get(point.objectId);
        seen.add(String(point.objectId));
        records.push({ id: point.objectId, placeId: point.placeId || '', label: String(point.label || (object && (object.browseLabel || object.displayName)) || point.objectId), longitude: point.longitude, latitude: point.latitude });
      });
      indexes.placeById.forEach(function (place) {
        if (place.kind === 'station' || !place.coordinates) return;
        var id = String(place.sourceObjectId || place.placeId);
        if (!id || seen.has(id)) return;
        seen.add(id);
        records.push({ id: id, placeId: place.placeId, label: place.label, longitude: place.coordinates[0], latitude: place.coordinates[1] });
      });
      function endpointMatchesItem(endpoint, item) {
        if (!endpoint) return false;
        return Boolean(
          (endpoint.objectId && endpoint.objectId === item.id) ||
          (endpoint.placeId && endpoint.placeId === item.placeId) ||
          (endpoint.type !== 'station' && endpoint.id && (endpoint.id === item.id || endpoint.id === item.placeId))
        );
      }
      var metrics = viewportMetrics();
      var fit = metrics.fit || 1;
      setLayerMarkup(target, records.map(function (item) {
        var xy = projector.forward(item.longitude, item.latitude);
        var focused = focusKey === item.id || focusKey === item.placeId;
        var role = endpointMatchesItem(state.routeOrigin, item) ? 'origin' : endpointMatchesItem(state.routeDestination, item) ? 'destination' : '';
        if (!focused && !role) return '';
        var scale = fit * Math.max(1, state.view.zoom);
        var radius = (focused ? 7 : 4) / scale;
        var hitRadius = 22 / scale;
        var roleRadius = 9 / scale;
        var focusRadius = 12 / scale;
        var action = indexes.objectById.has(item.id) || indexes.placeBySourceObjectId.has(item.id) ? 'transit-focus-object' : 'transit-focus-place';
        var identityAttribute = action === 'transit-focus-object' ? ' data-object-id="' + escapeAttribute(item.id) + '"' : ' data-place-id="' + escapeAttribute(item.placeId || item.id) + '"';
        var classes = ['lj-map-place-point'];
        if (focused) classes.push('is-focused');
        if (role) classes.push('is-route-' + role);
        var presentation = presentationForUI({ type: action === 'transit-focus-object' ? 'object' : 'place', id: item.id, objectId: action === 'transit-focus-object' ? item.id : null, placeId: item.placeId, label: item.label });
        return '<g class="' + classes.join(' ') + '" data-action="' + action + '"' + identityAttribute + ' transform="translate(' + xy.x.toFixed(2) + ' ' + xy.y.toFixed(2) + ')" tabindex="0" role="button" aria-label="查看' + escapeAttribute(presentation.displayLabel) + '"><circle class="lj-map-place-hit" r="' + hitRadius.toFixed(3) + '"></circle>' + (role ? '<circle class="lj-map-place-role-ring" r="' + roleRadius.toFixed(3) + '"></circle>' : '') + (focused ? '<circle class="lj-map-place-focus-ring" r="' + focusRadius.toFixed(3) + '"></circle>' : '') + '<circle class="lj-map-place-dot" r="' + radius.toFixed(3) + '"></circle><title>' + escapeHtml(presentation.displayLabel) + '</title></g>';
      }).join(''));
    }

    var renderFrame = 0;
    function renderMapLayers() {
      if (previewView) return;
      var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (renderFrame) return;
      var run = function () {
        renderFrame = 0;
        if (destroyed || previewView) return;
        renderMetrics = viewportMetrics();
        try {
          applyViewTransform();
          renderRouteHighlight();
          renderPlacePoints();
          renderStations();
          renderAdministrativeLabels();
        } finally { renderMetrics = null; }
      };
      if (view && typeof view.requestAnimationFrame === 'function') renderFrame = view.requestAnimationFrame(run);
      else run();
    }

    function renderModePicker() {
      var target = container.querySelector('[data-role="travel-mode-picker"]');
      if (!target) return;
      target.innerHTML = TRAVEL_MODES.map(function (mode) {
        var active = state.selectedTravelMode === mode;
        var estimate = state.travelEstimates[mode];
        var sub = state.estimatePending && state.routeOrigin && state.routeDestination ? '估算中' : estimate ? '约' + estimate.minutes + '分钟' : '—';
        return '<button type="button" data-action="transit-select-travel-mode" data-travel-mode="' + mode + '" aria-pressed="' + (active ? 'true' : 'false') + '"><strong>' + travelModeLabel(mode) + '</strong>' + (sub ? '<span>' + escapeHtml(sub) + '</span>' : '') + '</button>';
      }).join('');
    }

    function renderFavorites() {
      var target = container.querySelector('[data-role="favorite-rail"]');
      if (!target) return;
      target.innerHTML = favoritePlaces.slots.map(function (slot, index) {
        var resolved = resolvedFavorite(slot.slotId);
        var endpoint = resolved && resolved.endpoint;
        var nickname = slot.displayName || '常用' + (index + 1);
        var formal = endpoint ? presentationForUI(endpoint).displayLabel : resolved && resolved.stale ? '需要重选' : '未设置';
        var favoriteKey = endpoint ? endpointKey(endpoint) : '';
        var routeRole = favoriteKey && state.routeOrigin && favoriteKey === endpointKey(state.routeOrigin) ? 'origin' : favoriteKey && state.routeDestination && favoriteKey === endpointKey(state.routeDestination) ? 'destination' : '';
        var roleLabel = routeRole === 'origin' ? '，当前起点' : routeRole === 'destination' ? '，当前目的地' : '';
        return '<button type="button" class="' + (routeRole ? 'is-route-' + routeRole : '') + '" data-action="transit-use-favorite" data-favorite-slot="' + escapeAttribute(slot.slotId) + '" data-route-role="' + routeRole + '" ' + (endpoint ? '' : 'disabled') + ' aria-pressed="' + (routeRole ? 'true' : 'false') + '" aria-label="' + escapeAttribute(nickname + '，' + formal + roleLabel) + '"><strong>' + escapeHtml(nickname) + '</strong><span>' + escapeHtml(formal) + '</span></button>';
      }).join('');
    }

    function renderDepart() {
      var target = container.querySelector('[data-role="depart"]');
      if (!target) return;
      var ready = Boolean(state.routeOrigin && state.routeDestination && state.travelEstimates[state.selectedTravelMode] && !state.estimatePending && !state.appendPending);
      target.disabled = !ready;
      target.setAttribute('aria-disabled', ready ? 'false' : 'true');
      target.setAttribute('data-ready', ready ? 'true' : 'false');
      target.textContent = state.appendPending ? '追加中…' : '出发';
    }

    function endpointCard(endpoint, slot) {
      var role = slot === 'origin' ? '起点' : '终点';
      var presentation = presentationForUI(endpoint);
      var typeLabel = endpoint ? presentation.typeLabels[0] || (endpoint.type === 'station' ? '站点' : endpoint.type === 'object' ? '地点' : endpoint.type === 'area' ? '片区' : '位置') : '';
      return [
        '<article class="lj-map-endpoint-card ' + (endpoint ? 'is-filled' : 'is-empty') + '" data-endpoint-role="' + slot + '">',
        '<span>' + role + (typeLabel ? ' · ' + typeLabel : '') + '</span>',
        '<strong>' + escapeHtml(endpoint ? presentation.displayLabel : '待选择') + '</strong>',
        '</article>'
      ].join('');
    }

    function railPathSummary() {
      var railPath = effectiveRailPath();
      if (!railPath || !array(railPath.lineSegments).length) return '';
      return railPath.lineSegments.map(function (segment) {
        var from = indexes.stationById.get(segment.fromStationId);
        var to = indexes.stationById.get(segment.toStationId);
        var line = indexes.lineById.get(String(segment.lineId || ''));
        var label = segment.lineLabel || (line && (line.label || line.nameJa)) || segment.lineId || '电车';
        return label + ' ' + (from ? from.label : segment.fromStationId) + '→' + (to ? to.label : segment.toStationId);
      }).join('；');
    }

    function renderRouteSummary() {
      var target = container.querySelector('[data-role="route-summary"]');
      if (!target) return;
      var estimate = state.travelEstimates[state.selectedTravelMode];
      var estimateText = state.estimatePending ? '正在重新估算' : estimate ? travelModeLabel(state.selectedTravelMode) + '约' + estimate.minutes + '分钟' : state.routeOrigin && state.routeDestination ? '当前方式暂无参考耗时' : '选择两个端点后显示参考耗时';
      var railSummary = state.selectedTravelMode === 'public_transit' ? railPathSummary() : '';
      var details = container.querySelector('[data-role="route-details"]');
      if (details) details.innerHTML = railSummary ? '<p class="lj-map-rail-summary">' + escapeHtml(railSummary) + '</p>' : '';
      target.innerHTML = [
        '<header><div><span>路线</span><strong>' + escapeHtml(estimateText) + '</strong></div></header>',
        '<div class="lj-map-endpoint-grid">', endpointCard(state.routeOrigin, 'origin'), endpointCard(state.routeDestination, 'destination'), '</div>',
        state.appendStatus ? '<p class="lj-map-append-status">' + escapeHtml(state.appendStatus) + '</p>' : ''
      ].join('');
    }

    function presentationForUI(value) {
      value = value || {};
      var key = JSON.stringify([value.type, value.id, value.placeId, value.objectId, value.label]);
      if (presentationCache.has(key)) return presentationCache.get(key);
      var result = typeof options.getPlacePresentation === 'function' ? options.getPlacePresentation(value) || {} : {};
      var presentation = { displayLabel: String(result.displayLabel || value.label || ''), typeLabels: array(result.typeLabels), searchTerms: array(result.searchTerms), translated: Boolean(result.translated) };
      presentationCache.set(key, presentation);
      return presentation;
    }

    function focusTypeLabel(endpoint) {
      if (!endpoint) return '';
      var typeLabel = presentationForUI(endpoint).typeLabels[0];
      if (typeLabel) return typeLabel;
      if (endpoint.type === 'station') return '车站';
      if (endpoint.type === 'object') return '正式地点';
      if (endpoint.type === 'area') return '资料片区';
      return '位置';
    }

    // LJ-V3-ENDPOINT-SHORTCUTS: map shortcuts share the existing focus and route endpoints.
    function renderEndpointShortcuts() {
      var target = container.querySelector('[data-role="endpoint-shortcuts"]');
      if (!target) return;
      target.innerHTML = ['origin', 'destination'].map(function (slot) {
        var endpoint = slot === 'origin' ? state.routeOrigin : state.routeDestination;
        var role = slot === 'origin' ? '起点' : '终点';
        var same = endpoint && state.focus && endpointKey(endpoint) === endpointKey(state.focus);
        var action = same ? '取消' + role : endpoint ? '将当前焦点替换为' + role : '将当前焦点设为' + role;
        var label = endpoint ? presentationForUI(endpoint).displayLabel : role;
        var hint = endpoint ? role + '已锁定为' + label + '；' : role + '尚未锁定；';
        hint += state.focus ? action + '：' + presentationForUI(state.focus).displayLabel : '请先选择地点';
        return '<button type="button" data-action="transit-assign-focus" data-endpoint-slot="' + slot + '" data-locked="' + (endpoint ? 'true' : 'false') + '" aria-pressed="' + (endpoint ? 'true' : 'false') + '" title="' + escapeAttribute(hint) + '" aria-label="' + escapeAttribute(hint) + '"' + (state.focus ? '' : ' disabled') + '>' + (endpoint ? '<span>' + role + '</span>' : '') + '<strong>' + escapeHtml(label) + '</strong></button>';
      }).join('');
    }

    // LJ001-V35-MAP-LAYOUT: one edge drawer shares the existing focus, endpoints and map session.
    function renderDrawerState() {
      state.expanded = state.drawerState !== 'collapsed';
      container.setAttribute('data-drawer-state', state.drawerState);
      var toggle = container.querySelector('[data-role="map-drawer-toggle"]');
      var summary = container.querySelector('[data-role="drawer-summary"]');
      var routeStatus = container.querySelector('[data-role="drawer-route-status"]');
      var readingToggle = container.querySelector('[data-action="transit-drawer-state"]');
      if (toggle) {
        toggle.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
        toggle.setAttribute('aria-label', state.drawerState === 'collapsed' ? '展开地点与路线' : '收起地点与路线');
      }
      if (summary) summary.textContent = state.focus ? presentationForUI(state.focus).displayLabel : '点选地图或搜索地点';
      if (routeStatus) {
        var origin = state.routeOrigin ? presentationForUI(state.routeOrigin).displayLabel : '起点待选';
        var destination = state.routeDestination ? presentationForUI(state.routeDestination).displayLabel : '终点待选';
        var estimate = state.travelEstimates[state.selectedTravelMode];
        routeStatus.textContent = origin + ' → ' + destination + (estimate ? ' · 约' + estimate.minutes + '分钟' : '');
      }
      if (readingToggle) {
        readingToggle.setAttribute('data-drawer-state', state.drawerState === 'reading' ? 'half' : 'reading');
        readingToggle.setAttribute('aria-label', state.drawerState === 'reading' ? '收起地点详情' : '展开地点详情');
        readingToggle.textContent = state.drawerState === 'reading' ? '收起' : '详情';
      }
    }

    function setDrawerState(value) {
      var next = String(value || '');
      if (['collapsed', 'half', 'reading'].indexOf(next) < 0) return false;
      if (previewView) commitInteractionPreview();
      state.drawerState = next;
      renderDrawerState();
      renderMapLayers();
      updateSearchResultsBounds();
      if (typeof options.onDrawerChange === 'function') options.onDrawerChange(next);
      return next;
    }

    function renderFocus() {
      renderEndpointShortcuts();
      renderDrawerState();
      var summary = container.querySelector('[data-role="focus-summary"]');
      var details = container.querySelector('[data-role="focus-details"]');
      if (!summary || !details) return;
      var focus = state.focus;
      if (!focus) {
        summary.innerHTML = '<div class="lj-map-focus-empty"><strong>尚未选择地点</strong><span>地图单击与搜索用于查看；快速双击地点追加名称，不会自动改变路线。</span></div>';
        details.innerHTML = '<div class="lj-map-details-empty">选择一个车站或正式地点后，这里显示行政归属与已核定的附近兴趣点。</div>';
        return;
      }
      var isOrigin = state.routeOrigin && endpointKey(state.routeOrigin) === endpointKey(focus);
      var isDestination = state.routeDestination && endpointKey(state.routeDestination) === endpointKey(focus);
      var originLabel = isOrigin ? '取消起点' : state.routeOrigin ? '替换起点' : '设为起点';
      var destinationLabel = isDestination ? '取消目的地' : state.routeDestination ? '替换目的地' : '设为目的地';
      summary.innerHTML = [
        '<div class="lj-map-focus-heading"><span title="' + escapeAttribute(presentationForUI(focus).typeLabels.join('、')) + '">' + focusTypeLabel(focus) + ' · 当前焦点</span><strong>' + escapeHtml(presentationForUI(focus).displayLabel) + '</strong></div>',
        '<div class="lj-map-assign-buttons">',
        '<button type="button" data-action="transit-assign-focus" data-endpoint-slot="origin" aria-pressed="' + (isOrigin ? 'true' : 'false') + '">' + originLabel + '</button>',
        '<button type="button" data-action="transit-assign-focus" data-endpoint-slot="destination" aria-pressed="' + (isDestination ? 'true' : 'false') + '">' + destinationLabel + '</button>',
        '</div>'
      ].join('');
      var interests = endpointInterests(focus);
      var admin = array(focus.adminPath).filter(Boolean).join(' → ');
      var station = focus.type === 'station' ? indexes.stationById.get(focus.id) : null;
      var lines = stationLineIds(station).map(function (lineId) {
        var line = indexes.lineById.get(lineId);
        return line ? line.label : lineId;
      });
      var interestMarkup = interests.length ? interests.map(function (item) {
        var action = item.objectId ? ' data-action="transit-focus-object" data-object-id="' + escapeAttribute(item.objectId) + '"' : item.placeId ? ' data-action="transit-focus-place" data-place-id="' + escapeAttribute(item.placeId) + '"' : '';
        return '<li><button type="button"' + action + (action ? '' : ' disabled') + '><strong>' + escapeHtml(presentationForUI(item).displayLabel) + '</strong>' + (item.reviewedWalkingBand ? '<span>' + escapeHtml(String(item.reviewedWalkingBand).replace('about_10_20_minutes_flexible_human_review', '步行约10～20分钟')) + '</span>' : '') + '</button></li>';
      }).join('') : '<li class="is-empty">暂无已核定的附近兴趣点</li>';
      details.innerHTML = [
        '<header><span>地点资料</span><h3>' + escapeHtml(presentationForUI(focus).displayLabel) + '</h3></header>',
        admin ? '<p class="lj-map-admin-path">' + escapeHtml(admin) + '</p>' : '',
        lines.length ? '<p class="lj-map-line-list">线路：' + escapeHtml(lines.join('、')) + '</p>' : '',
        '<section><h4>相关兴趣点</h4><p>这里只显示人工核定的明确关系，不按同片区或图上距离推断。</p><ul>' + interestMarkup + '</ul></section>',
        focus.type === 'station' && typeof options.onOpenStation === 'function' ? '<button type="button" class="lj-map-open-object" data-action="transit-open-station" data-station-id="' + escapeAttribute(focus.id) + '">到地点资料页查看</button>' : '',
        focus.objectId && typeof options.onOpenObject === 'function' ? '<button type="button" class="lj-map-open-object" data-action="transit-open-object" data-object-id="' + escapeAttribute(focus.objectId) + '">到地点资料页查看</button>' : ''
      ].join('');
    }

    function searchableRows() {
      var rows = [];
      indexes.stationById.forEach(function (station) {
        var place = indexes.placeByMapStationId.get(station.id);
        var admin = place ? array(place.adminPath).join(' ') : array(station.adminPath).join(' ');
        var presentation = presentationForUI({ type: 'station', id: station.id, placeId: place && place.placeId, label: stationFormalLabel(station) });
        rows.push({
          type: 'station',
          id: station.id,
          label: presentation.displayLabel,
          meta: [presentation.typeLabels[0], admin || '车站'].filter(Boolean).join(' · '),
          searchText: normalizeText([stationFormalLabel(station), station.label, station.nameJa, station.id, array(station.aliases).join(' '), place && array(place.aliases).join(' '), place && array(place.administrativeSearchAliases).join(' '), admin].concat(presentation.searchTerms).join(' '))
        });
      });
      indexes.placeById.forEach(function (place) {
        if (place.kind === 'station' && place.mapStationId) return;
        var presentation = presentationForUI({ type: 'place', id: place.placeId, placeId: place.placeId, objectId: place.sourceObjectId, label: place.label });
        rows.push({ type: 'place', id: place.placeId, label: presentation.displayLabel, meta: [presentation.typeLabels[0], array(place.adminPath).join(' ') || focusTypeLabel({ type: place.kind === 'content_object' ? 'object' : 'place' })].filter(Boolean).join(' · '), searchText: normalizeText([place.label, place.nameJa, place.placeId, array(place.aliases).join(' '), array(place.administrativeSearchAliases).join(' '), array(place.adminPath).join(' ')].concat(presentation.searchTerms).join(' ')) });
      });
      browse.objects.forEach(function (object) {
        var place = indexes.placeBySourceObjectId.get(object.objectId);
        if (place) return;
        var area = indexes.areaById.get(object.areaId);
        var presentation = presentationForUI({ type: 'object', id: object.objectId, objectId: object.objectId, label: object.browseLabel || object.displayName || object.objectId });
        rows.push({ type: 'object', id: object.objectId, label: presentation.displayLabel, meta: [presentation.typeLabels[0], area ? area.label : '正式地点'].filter(Boolean).join(' · '), searchText: normalizeText([object.browseLabel, object.displayName, object.objectId, area && area.label].concat(presentation.searchTerms).join(' ')) });
      });
      return rows;
    }

    function resolvedSearchHistory() {
      var resolved = [];
      var descriptors = [];
      state.searchHistory.forEach(function (descriptor) {
        var endpoint = endpointFromDescriptor(descriptor);
        if (!endpoint) return;
        var key = endpointKey(endpoint);
        if (!key || resolved.some(function (item) { return endpointKey(item) === key; })) return;
        resolved.push(endpoint);
        descriptors.push({ type: endpoint.type, id: endpoint.id });
      });
      state.searchHistory = descriptors.slice(0, 4);
      return resolved.slice(0, 4);
    }

    function rememberSearchChoice(endpoint) {
      if (!endpoint) return;
      var descriptor = { type: endpoint.type, id: endpoint.id };
      var key = endpointKey(descriptor);
      state.searchHistory = [descriptor].concat(state.searchHistory.filter(function (item) {
        return endpointKey(item) !== key;
      })).slice(0, 4);
      renderSearchHistory();
    }

    function useSearchHistory(type, id) {
      var endpoint = endpointFromDescriptor({ type: type, id: id });
      if (!endpoint) {
        state.searchHistory = state.searchHistory.filter(function (item) { return endpointKey(item) !== String(type || '') + ':' + String(id || ''); });
        state.status = '这个历史地点已经不可用。';
        renderSearchHistory();
        renderStatus();
        return false;
      }
      closeSearchResults();
      return setFocus(endpoint, Boolean(endpoint.coordinates), 'search_history');
    }

    function renderSearchHistory() {
      var target = container.querySelector('[data-role="transit-search-history"]');
      if (!target) return;
      var endpoints = resolvedSearchHistory();
      target.hidden = !endpoints.length;
      target.setAttribute('data-covered', state.searchOpen ? 'true' : 'false');
      target.setAttribute('aria-hidden', state.searchOpen ? 'true' : 'false');
      target.innerHTML = endpoints.map(function (endpoint) {
        var key = endpointKey(endpoint);
        var role = state.routeOrigin && endpointKey(state.routeOrigin) === key ? 'origin' : state.routeDestination && endpointKey(state.routeDestination) === key ? 'destination' : '';
        var focused = state.focus && endpointKey(state.focus) === key;
        var roleLabel = role === 'origin' ? '，当前起点' : role === 'destination' ? '，当前目的地' : '';
        var label = presentationForUI(endpoint).displayLabel;
        return '<button type="button" class="' + (focused ? 'is-current-focus' : '') + '" data-action="transit-use-search-history" data-history-type="' + escapeAttribute(endpoint.type) + '" data-history-id="' + escapeAttribute(endpoint.id) + '" data-route-role="' + role + '" aria-label="查看' + escapeAttribute(label + roleLabel) + '" title="' + escapeAttribute(label) + '"' + (state.searchOpen ? ' tabindex="-1"' : '') + '><span>' + escapeHtml(label) + '</span></button>';
      }).join('');
    }

    function renderSearchResults() {
      var target = container.querySelector('[data-role="transit-search-results"]');
      if (!target) return;
      var query = normalizeText(state.query);
      if (!query || !state.searchOpen) {
        target.hidden = true;
        target.innerHTML = '';
        if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
        renderSearchHistory();
        return;
      }
      var terms = query.split(' ').filter(Boolean);
      var rows = searchableRows().filter(function (row) { return terms.every(function (term) { return row.searchText.indexOf(term) >= 0; }); }).slice(0, 30);
      target.hidden = false;
      if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
      target.innerHTML = rows.length ? rows.map(function (row) {
        var action = row.type === 'station' ? 'transit-focus-station' : row.type === 'object' ? 'transit-focus-object' : 'transit-focus-place';
        var attr = row.type === 'station' ? 'data-station-id' : row.type === 'object' ? 'data-object-id' : 'data-place-id';
        return '<button type="button" data-action="' + action + '" ' + attr + '="' + escapeAttribute(row.id) + '"><strong>' + escapeHtml(row.label) + '</strong><span>' + escapeHtml(row.meta) + '</span></button>';
      }).join('') : '<div class="lj-map-search-empty">没有找到匹配的正式站点或地点。</div>';
      updateSearchResultsBounds();
      renderSearchHistory();
    }

    function searchBoundaryBottom(shellRect) {
      var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      var values = [];
      if (view && view.visualViewport && finite(view.visualViewport.height)) values.push(Number(view.visualViewport.offsetTop || 0) + Number(view.visualViewport.height));
      else if (view && finite(view.innerHeight)) values.push(Number(view.innerHeight));
      var boundaryNodes = [];
      if (container.closest) {
        boundaryNodes.push(container.closest('.lt-d132-body'));
        boundaryNodes.push(container.closest('#living-japan-panel'));
      }
      boundaryNodes.push(rootElement);
      boundaryNodes.push(container);
      boundaryNodes.filter(Boolean).forEach(function (node) {
        if (!node.getBoundingClientRect) return;
        var rect = node.getBoundingClientRect();
        if (finite(rect.bottom) && rect.bottom > shellRect.bottom) values.push(Number(rect.bottom));
      });
      return values.length ? Math.min.apply(Math, values) : shellRect.bottom + 258;
    }

    function updateSearchResultsBounds() {
      var target = container.querySelector('[data-role="transit-search-results"]');
      var anchor = container.querySelector('[data-role="map-search-input-anchor"]');
      if (!target || target.hidden || !anchor || !anchor.getBoundingClientRect) return;
      var rect = anchor.getBoundingClientRect();
      var available = Math.max(0, Math.floor(searchBoundaryBottom(rect) - rect.bottom - 12));
      var value = Math.min(258, available) + 'px';
      if (target.style && typeof target.style.setProperty === 'function') target.style.setProperty('--lj-map-search-results-max-height', value);
      else if (target.style) target.style['--lj-map-search-results-max-height'] = value;
    }

    function closeSearchResults() {
      state.searchOpen = false;
      renderSearchResults();
    }

    function insideRole(start, role) {
      var current = start;
      while (current && current !== container) {
        if (current.getAttribute && current.getAttribute('data-role') === role) return true;
        current = current.parentNode;
      }
      return false;
    }

    function renderCandidates() {
      var target = container.querySelector('[data-role="map-candidates"]');
      if (!target) return;
      if (!state.candidateIds.length) { target.hidden = true; target.innerHTML = ''; return; }
      target.hidden = false;
      if (state.candidatePoint) {
        target.style.left = state.candidatePoint.x + 'px';
        target.style.top = state.candidatePoint.y + 'px';
      }
      target.innerHTML = '<strong>请选择具体车站</strong>' + state.candidateIds.map(function (stationId) {
        var station = indexes.stationById.get(stationId);
        return '<button type="button" data-action="transit-choose-candidate" data-station-id="' + escapeAttribute(stationId) + '">' + escapeHtml(station ? presentationForUI({ type: 'station', id: stationId, label: stationFormalLabel(station) }).displayLabel : stationId) + '</button>';
      }).join('');
    }

    function renderStatus() {
      var target = container.querySelector('[data-role="transit-status"]');
      if (target) target.textContent = state.status;
      var fallback = container.querySelector('[data-role="transit-copy-fallback"]');
      if (fallback) {
        fallback.hidden = !state.appendCopyText;
        fallback.innerHTML = state.appendCopyText ? '<label><span>未能自动追加，可复制以下内容</span><textarea readonly data-role="transit-copy-text">' + escapeHtml(state.appendCopyText) + '</textarea></label><button type="button" data-action="transit-copy-fallback">复制全文</button>' : '';
      }
    }

    function renderAllDynamic() {
      renderModePicker();
      renderFavorites();
      renderDepart();
      renderRouteSummary();
      renderFocus();
      renderSearchResults();
      renderCandidates();
      renderStatus();
    }

    function buildTrafficComment(mode) {
      return buildTrafficCommentPure({
        origin: state.routeOrigin,
        destination: state.routeDestination,
        mode: mode,
        estimate: state.travelEstimates[mode],
        railPath: effectiveRailPath()
      });
    }

    function buildTrafficPayload(mode, comment) {
      return {
        schemaVersion: 2,
        mode: mode,
        modeLabel: travelModeLabel(mode),
        origin: exportEndpoint(state.routeOrigin),
        destination: exportEndpoint(state.routeDestination),
        referenceMinutes: state.travelEstimates[mode] ? state.travelEstimates[mode].minutes : null,
        estimate: state.travelEstimates[mode] ? clone(state.travelEstimates[mode]) : null,
        railPath: effectiveRailPath() ? clone(effectiveRailPath()) : null,
        relatedInterests: { origin: clone(endpointInterests(state.routeOrigin)), destination: clone(endpointInterests(state.routeDestination)) },
        comment: comment
      };
    }

    function appendTraffic(mode) {
      if (!validTravelMode(mode)) return Promise.resolve({ ok: false, error: '未知出行方式' });
      if (state.appendPending) return Promise.resolve({ ok: false, error: '交通备注正在追加' });
      var comment = buildTrafficComment(mode);
      if (!comment) {
        state.status = '当前路线与参考耗时尚未准备好。';
        renderStatus();
        return Promise.resolve({ ok: false, error: state.status });
      }
      state.appendPending = true;
      state.appendStatus = '正在追加' + travelModeLabel(mode) + '参考……';
      state.appendCopyText = '';
      renderAllDynamic();
      if (typeof options.onAppendTraffic !== 'function') {
        state.appendPending = false;
        state.appendStatus = '当前页面尚未接入输入框。';
        state.appendCopyText = comment;
        renderAllDynamic();
        return Promise.resolve({ ok: false, error: state.appendStatus, copyText: comment });
      }
      var payload = buildTrafficPayload(mode, comment);
      var pending;
      try { pending = options.onAppendTraffic(payload, comment); }
      catch (error) { pending = Promise.reject(error); }
      return asPromise(pending).then(function (value) {
        state.appendPending = false;
        if (value && value.ok === true) {
          state.appendStatus = '已追加到输入框，未发送。';
          state.status = state.appendStatus;
          state.appendCopyText = '';
          renderAllDynamic();
          return value;
        }
        var message = value && value.error ? String(value.error) : '未能自动追加到输入框。';
        state.appendStatus = message;
        state.status = message;
        state.appendCopyText = value && value.copyText ? String(value.copyText) : comment;
        renderAllDynamic();
        return { ok: false, error: message, copyText: state.appendCopyText };
      }, function (error) {
        state.appendPending = false;
        state.appendStatus = '未能自动追加到输入框。';
        state.status = state.appendStatus;
        state.appendCopyText = comment;
        renderAllDynamic();
        return { ok: false, error: String(error && error.message ? error.message : error), copyText: comment };
      });
    }

    function copyFallbackText() {
      var text = state.appendCopyText;
      if (!text) return Promise.resolve(false);
      var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (view && view.navigator && view.navigator.clipboard && typeof view.navigator.clipboard.writeText === 'function') {
        return view.navigator.clipboard.writeText(text).then(function () {
          state.status = '已复制全文。';
          renderStatus();
          return true;
        }, function () { return false; });
      }
      var textarea = container.querySelector('[data-role="transit-copy-text"]');
      if (textarea && textarea.select) {
        textarea.select();
        try {
          var copied = doc.execCommand && doc.execCommand('copy');
          if (copied) { state.status = '已复制全文。'; renderStatus(); }
          return Promise.resolve(Boolean(copied));
        } catch (error) { return Promise.resolve(false); }
      }
      return Promise.resolve(false);
    }

    function nearbyStationIds(stationId) {
      var recordSet = visibleStationRecords();
      var source = recordSet.rows.find(function (row) { return row.station.id === stationId; });
      if (!source) return [stationId];
      return recordSet.rows.filter(function (row) {
        var dx = row.screen.x - source.screen.x;
        var dy = row.screen.y - source.screen.y;
        return Math.sqrt(dx * dx + dy * dy) <= 28;
      }).sort(function (left, right) {
        if (left.station.id === stationId) return -1;
        if (right.station.id === stationId) return 1;
        return String(left.station.id).localeCompare(String(right.station.id));
      }).map(function (row) { return row.station.id; });
    }

    function focusStationFromUI(stationId, event) {
      var candidates = nearbyStationIds(stationId);
      if (candidates.length > 1) {
        state.candidateIds = candidates;
        var metrics = viewportMetrics();
        var x = event && finite(event.clientX) ? Number(event.clientX) - metrics.rect.left : metrics.width / 2;
        var y = event && finite(event.clientY) ? Number(event.clientY) - metrics.rect.top : metrics.height / 2;
        state.candidatePoint = { x: clamp(x, 8, Math.max(8, metrics.width - 190)), y: clamp(y, 60, Math.max(60, metrics.height - 190)) };
        state.status = '这里有多个可选车站，请确认具体名称。';
        renderCandidates();
        renderStatus();
        return true;
      }
      return setFocus(endpointFromStation(stationId), false, 'map_click');
    }

    function actionElement(start) {
      var current = start;
      while (current && current !== container) {
        if (current.getAttribute && current.getAttribute('data-action')) return current;
        current = current.parentNode;
      }
      return null;
    }

    function isPlaceClickAction(action) {
      return action === 'transit-focus-station' || action === 'transit-focus-object' || action === 'transit-focus-place' || action === 'transit-choose-candidate';
    }

    function appendNameOnQuickRepeat(endpoint, event) {
      if (!endpoint || event.keyboardActivation || event.detail === 0) { pendingPlaceClick = null; return; }
      var now = Date.now();
      var key = endpointKey(endpoint);
      if (!pendingPlaceClick || pendingPlaceClick.key !== key || now - pendingPlaceClick.time > 400) {
        pendingPlaceClick = { key: key, time: now };
        return;
      }
      pendingPlaceClick = null;
      var name = presentationForUI(endpoint).displayLabel;
      var result;
      try {
        result = typeof options.onAppendPlaceName === 'function' ? options.onAppendPlaceName(exportEndpoint(endpoint), name) : { ok: false, error: '当前环境不能自动追加地点名', copyText: name };
      } catch (error) { result = { ok: false, error: '地点名追加失败，请手动复制', copyText: name }; }
      if (result && result.ok === false) {
        state.appendCopyText = result.copyText || name;
        state.status = result.error || '地点名追加失败，请手动复制。';
      } else {
        state.appendCopyText = '';
        state.status = result && result.warning ? result.warning : '已将地点名「' + name + '」追加到输入框。';
      }
      renderStatus();
    }

    function onClick(event) {
      if (previewView) commitInteractionPreview();
      var actionNode = actionElement(event.target);
      var releasedTarget = releasedPlaceTarget;
      releasedPlaceTarget = null;
      if (!actionNode && releasedTarget && !event.keyboardActivation && Date.now() - releasedTarget.time <= 400 && (event.target === viewport || insideRole(event.target, 'map-viewport'))) actionNode = releasedTarget.node;
      if (!actionNode) { pendingPlaceClick = null; return; }
      var action = actionNode.getAttribute('data-action');
      var fromSearchResults = insideRole(actionNode, 'transit-search-results');
      if (!isPlaceClickAction(action) || fromSearchResults || event.keyboardActivation || event.detail === 0) pendingPlaceClick = null;
      if (Date.now() < suppressClickUntil && isPlaceClickAction(action)) {
        pendingPlaceClick = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action === 'transit-drawer-toggle') {
        setDrawerState(state.drawerState === 'collapsed' ? 'half' : 'collapsed');
        return;
      }
      if (action === 'transit-drawer-state') {
        setDrawerState(actionNode.getAttribute('data-drawer-state'));
        return;
      }
      if (action === 'transit-select-travel-mode') {
        var mode = actionNode.getAttribute('data-travel-mode');
        if (!validTravelMode(mode)) { state.status = '无法识别这个出行方式。'; renderStatus(); return; }
        state.selectedTravelMode = mode;
        state.appendStatus = '';
        state.status = '已选择' + travelModeLabel(mode) + '。';
        renderAllDynamic();
        renderMapLayers();
        if (typeof options.onRouteChange === 'function') options.onRouteChange(getRouteState());
        return;
      }
      if (action === 'transit-use-favorite') {
        useFavorite(actionNode.getAttribute('data-favorite-slot'));
        return;
      }
      if (action === 'transit-favorite-origin' || action === 'transit-favorite-destination') {
        var favorite = resolvedFavorite(actionNode.getAttribute('data-favorite-slot'));
        if (favorite && favorite.endpoint) {
          setFocus(favorite.endpoint, Boolean(favorite.endpoint.coordinates), 'favorite_focus');
          setRouteEndpoint(favorite.endpoint, action === 'transit-favorite-origin' ? 'origin' : 'destination');
        }
        return;
      }
      if (action === 'transit-assign-focus') {
        toggleFocusedEndpoint(actionNode.getAttribute('data-endpoint-slot'));
        return;
      }
      if (action === 'transit-clear-route') { clearRoute(); return; }
      if (action === 'transit-depart') { appendTraffic(state.selectedTravelMode).catch(function () {}); return; }
      if (action === 'transit-append-route') {
        var legacyMode = actionNode.getAttribute('data-travel-mode');
        if (validTravelMode(legacyMode)) state.selectedTravelMode = legacyMode;
        appendTraffic(state.selectedTravelMode).catch(function () {});
        return;
      }
      if (action === 'transit-zoom-in') { zoomAt(state.view.zoom * 1.35, null, 'button_zoom'); return; }
      if (action === 'transit-zoom-out') { zoomAt(state.view.zoom / 1.35, null, 'button_zoom'); return; }
      if (action === 'transit-reset-view') { resetMap(); return; }
      if (action === 'transit-use-search-history') {
        useSearchHistory(actionNode.getAttribute('data-history-type'), actionNode.getAttribute('data-history-id'));
        return;
      }
      if (action === 'transit-focus-station' || action === 'transit-select-station') {
        if (fromSearchResults) {
          var searchedStation = endpointFromStation(actionNode.getAttribute('data-station-id'));
          if (setFocus(searchedStation, Boolean(searchedStation && searchedStation.coordinates), 'search_choice')) rememberSearchChoice(searchedStation);
          closeSearchResults();
        } else {
          focusStationFromUI(actionNode.getAttribute('data-station-id'), event);
          if (!state.candidateIds.length) appendNameOnQuickRepeat(state.focus, event);
          else pendingPlaceClick = null;
        }
        return;
      }
      if (action === 'transit-choose-candidate') {
        var candidateStation = endpointFromStation(actionNode.getAttribute('data-station-id'));
        if (setFocus(candidateStation, false, 'candidate_choice')) appendNameOnQuickRepeat(candidateStation, event);
        return;
      }
      if (action === 'transit-focus-object' || action === 'transit-select-object') {
        var searchedObject = endpointFromObject(actionNode.getAttribute('data-object-id'));
        var objectFocused = setFocus(searchedObject, action === 'transit-select-object' || Boolean(fromSearchResults && searchedObject && searchedObject.coordinates), fromSearchResults ? 'search_choice' : 'object_focus');
        if (fromSearchResults && objectFocused) rememberSearchChoice(searchedObject);
        if (fromSearchResults) closeSearchResults();
        else if (objectFocused && action === 'transit-focus-object') appendNameOnQuickRepeat(searchedObject, event);
        return;
      }
      if (action === 'transit-focus-place') {
        var searchedPlace = endpointFromPlace(actionNode.getAttribute('data-place-id'));
        var placeFocused = setFocus(searchedPlace, true, fromSearchResults ? 'search_choice' : 'place_focus');
        if (fromSearchResults && placeFocused) rememberSearchChoice(searchedPlace);
        if (fromSearchResults) closeSearchResults();
        else if (placeFocused) appendNameOnQuickRepeat(searchedPlace, event);
        return;
      }
      if (action === 'transit-select-area') {
        setFocus(endpointFromArea(actionNode.getAttribute('data-area-id')), false, 'area_focus');
        return;
      }
      if (action === 'transit-route-station') { setRouteEndpoint(endpointFromStation(actionNode.getAttribute('data-station-id')), state.routeOrigin ? 'destination' : 'origin'); return; }
      if (action === 'transit-route-object') { setRouteEndpoint(endpointFromObject(actionNode.getAttribute('data-object-id')), state.routeOrigin ? 'destination' : 'origin'); return; }
      // LJ001-V3-STATION-DETAIL：地图短别名只作内部显示，资料回跳携带显式官方站号。
      if (action === 'transit-open-station') {
        var selectedStation = indexes.stationById.get(canonicalStationId(actionNode.getAttribute('data-station-id')));
        var selectedPlace = selectedStation && indexes.placeByMapStationId.get(selectedStation.id);
        if (selectedStation && typeof options.onOpenStation === 'function') options.onOpenStation({
          railStationId: (selectedPlace && selectedPlace.railStationId) || selectedStation.railStationId || selectedStation.id,
          stationId: selectedStation.id,
          placeId: (selectedPlace && selectedPlace.placeId) || selectedStation.placeId || null
        });
        return;
      }
      if (action === 'transit-open-object') {
        var objectId = actionNode.getAttribute('data-object-id');
        var object = indexes.objectById.get(objectId);
        if (typeof options.onOpenObject === 'function') options.onOpenObject({ objectId: objectId, areaId: object ? object.areaId : null, browseLabel: object ? object.browseLabel || object.displayName || objectId : objectId, packageIds: object ? array(object.packageIds).slice() : [] });
        return;
      }
      if (action === 'transit-copy-fallback') { copyFallbackText().catch(function () {}); return; }
    }

    function onInput(event) {
      if (!event.target || event.target.getAttribute('data-role') !== 'transit-search') return;
      pendingPlaceClick = null;
      state.query = event.target.value || '';
      state.searchOpen = Boolean(normalizeText(state.query));
      renderSearchResults();
    }

    function onFocusIn(event) {
      if (!event.target || event.target.getAttribute('data-role') !== 'transit-search' || !normalizeText(state.query)) return;
      state.searchOpen = true;
      renderSearchResults();
    }

    function onKeydown(event) {
      pendingPlaceClick = null;
      releasedPlaceTarget = null;
      if (event.key === 'Escape' && state.searchOpen && insideRole(event.target, 'map-search-shell')) {
        event.preventDefault();
        event.stopPropagation();
        if (searchInput && typeof searchInput.focus === 'function') searchInput.focus();
        closeSearchResults();
        return;
      }
      var actionNode = actionElement(event.target);
      if (actionNode && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onClick(Object.assign({}, event, { target: actionNode, keyboardActivation: true, preventDefault: function () {}, stopPropagation: function () {} }));
        return;
      }
      if (event.target !== viewport) return;
      var handled = true;
      if (event.key === '+' || event.key === '=') zoomAt(state.view.zoom * 1.2, null, 'keyboard_zoom');
      else if (event.key === '-' || event.key === '_') zoomAt(state.view.zoom / 1.2, null, 'keyboard_zoom');
      else if (event.key === '0') resetMap();
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        var center = worldCenter();
        var distance = 42 / state.view.zoom;
        if (event.key === 'ArrowLeft') center.x -= distance;
        if (event.key === 'ArrowRight') center.x += distance;
        if (event.key === 'ArrowUp') center.y -= distance;
        if (event.key === 'ArrowDown') center.y += distance;
        state.view.center = projector.inverse(center.x, center.y);
        applyViewTransform();
        renderMapLayers();
        emitViewChange('keyboard_pan');
      } else handled = false;
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    }

    function startGesture() {
      var values = Array.from(pointerState.values());
      if (!values.length) { gesture = null; return; }
      var center = worldCenter();
      if (values.length === 1) {
        gesture = { mode: 'pan', start: values[0], center: center, zoom: state.view.zoom, moved: false };
        return;
      }
      var first = values[0];
      var second = values[1];
      var midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      var canvas = clientToCanvas(midpoint.x, midpoint.y);
      gesture = {
        mode: 'pinch',
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        zoom: state.view.zoom,
        anchorWorld: canvasToWorld(canvas),
        moved: false
      };
    }

    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      releasedPlaceTarget = null;
      if (!pointerState.size) {
        var pressedActionNode = actionElement(event.target);
        pressedPlaceTarget = event.pointerType && event.pointerType !== 'mouse' && pressedActionNode && isPlaceClickAction(pressedActionNode.getAttribute('data-action')) ? { pointerId: event.pointerId, node: pressedActionNode } : null;
      } else {
        pendingPlaceClick = null;
        pressedPlaceTarget = null;
      }
      flushInteractionPreview();
      if (!pointerState.size && previewView) commitInteractionPreview();
      if (!interactionMetrics) interactionMetrics = viewportMetrics();
      pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
      startGesture();
      // LJ001-V3-MAP-MOUSE: keep a stationary mouse click on its station; capture only after a real drag begins.
      if (event.pointerType && event.pointerType !== 'mouse' && viewport.setPointerCapture) {
        try { viewport.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function updatePointerGesture() {
      if (!gesture) return;
      var values = Array.from(pointerState.values());
      var metrics = viewportMetrics();
      if (gesture.mode === 'pan' && values.length === 1) {
        var dx = (values[0].x - gesture.start.x) / metrics.fit;
        var dy = (values[0].y - gesture.start.y) / metrics.fit;
        state.view.center = projector.inverse(gesture.center.x - dx / gesture.zoom, gesture.center.y - dy / gesture.zoom);
      } else if (gesture.mode === 'pinch' && values.length >= 2) {
        var first = values[0];
        var second = values[1];
        var distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        var nextZoom = clamp(gesture.zoom * distance / gesture.distance, MIN_ZOOM, MAX_ZOOM);
        var midpoint = clientToCanvas((first.x + second.x) / 2, (first.y + second.y) / 2);
        var nextCenter = {
          x: gesture.anchorWorld.x - (midpoint.x - SVG_WIDTH / 2) / nextZoom,
          y: gesture.anchorWorld.y - (midpoint.y - SVG_HEIGHT / 2) / nextZoom
        };
        state.view.zoom = nextZoom;
        state.view.center = projector.inverse(nextCenter.x, nextCenter.y);
      }
      clampView();
    }

    function onPointerMove(event) {
      if (!pointerState.has(event.pointerId) || !gesture) return;
      pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
      var mousePointer = !event.pointerType || event.pointerType === 'mouse';
      var metrics = viewportMetrics();
      var dx = gesture.start ? event.clientX - gesture.start.x : 0;
      var dy = gesture.start ? event.clientY - gesture.start.y : 0;
      if (gesture.mode === 'pinch' || Math.abs(dx) + Math.abs(dy) > (mousePointer ? 4 : 3 * metrics.fit)) gesture.moved = true;
      if (gesture.moved) {
        pendingPlaceClick = null;
        pressedPlaceTarget = null;
        releasedPlaceTarget = null;
        if (mousePointer && viewport.setPointerCapture) {
          try { viewport.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
        }
        suppressClickUntil = Date.now() + 220;
        beginInteractionPreview();
        pointerUpdatePending = true;
        scheduleInteractionPreview();
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function onPointerEnd(event) {
      if (!pointerState.has(event.pointerId)) return;
      var moved = Boolean(gesture && gesture.moved);
      var cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
      if (cancelled || moved) {
        pendingPlaceClick = null;
        releasedPlaceTarget = null;
      } else if (pointerState.size === 1 && pressedPlaceTarget && pressedPlaceTarget.pointerId === event.pointerId) {
        releasedPlaceTarget = { node: pressedPlaceTarget.node, time: Date.now() };
      }
      pressedPlaceTarget = null;
      if (moved && event.type !== 'pointercancel' && event.type !== 'lostpointercapture' && finite(event.clientX) && finite(event.clientY)) {
        pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
        pointerUpdatePending = true;
      }
      flushInteractionPreview();
      pointerState.delete(event.pointerId);
      if (viewport.releasePointerCapture) {
        try { viewport.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
      }
      startGesture();
      if (moved) {
        suppressClickUntil = Date.now() + 220;
        if (gesture) gesture.moved = true;
      }
      if (!pointerState.size) {
        if (previewView) commitInteractionPreview('gesture');
        else interactionMetrics = null;
      }
      event.stopPropagation();
    }

    function onWheel(event) {
      pendingPlaceClick = null;
      pressedPlaceTarget = null;
      releasedPlaceTarget = null;
      event.preventDefault();
      event.stopPropagation();
      var factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
      if (pointerUpdatePending) flushInteractionPreview();
      zoomAt(state.view.zoom * factor, { x: event.clientX, y: event.clientY }, 'wheel', true);
    }

    function onDoubleClick(event) {
      var target = actionElement(event.target);
      if (target && isPlaceClickAction(target.getAttribute('data-action')) && !insideRole(target, 'transit-search-results')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function packageIdsFromEvidence(input) {
      var ids = new Set();
      if (!input) return ids;
      if (Array.isArray(input)) { input.forEach(function (item) { if (typeof item === 'string') ids.add(item); }); return ids; }
      array(input.packageIds).forEach(function (id) { if (typeof id === 'string') ids.add(id); });
      var diagnostics = input.diagnostics && typeof input.diagnostics === 'object' ? input.diagnostics : input;
      var channels = diagnostics.channels && typeof diagnostics.channels === 'object' ? diagnostics.channels : null;
      if (channels) {
        Object.keys(channels).forEach(function (channelId) {
          array(channels[channelId] && channels[channelId].detected).forEach(function (record) {
            if (record && record.id && record.source && record.source.source === 'current_user') ids.add(record.id);
          });
        });
      }
      return ids;
    }

    function setEvidence(input) {
      var packageIds = packageIdsFromEvidence(input);
      var areaIds = new Set();
      var objectIds = new Set();
      packageIds.forEach(function (packageId) {
        var areaId = indexes.packageToArea.get(packageId);
        if (areaId) areaIds.add(areaId);
        var objectId = indexes.packageToObject.get(packageId);
        if (objectId) {
          objectIds.add(objectId);
          var object = indexes.objectById.get(objectId);
          if (object && object.areaId) areaIds.add(object.areaId);
        }
      });
      state.evidencePackageIds = packageIds;
      state.evidenceAreaIds = areaIds;
      state.evidenceObjectIds = objectIds;
      state.status = areaIds.size ? '已读取本轮明确地点证据；地图不会把它当作自动当前位置。' : '本轮没有明确地点证据。';
      renderStatus();
      return getState();
    }

    function refreshEvidence() {
      if (typeof options.onGetChatEvidence !== 'function') return Promise.resolve(setEvidence(null));
      var result;
      try { result = options.onGetChatEvidence(); }
      catch (error) { return Promise.reject(error); }
      return asPromise(result).then(setEvidence);
    }

    function getRouteState() {
      return {
        origin: exportEndpoint(state.routeOrigin),
        destination: exportEndpoint(state.routeDestination),
        mode: state.selectedTravelMode,
        estimateStatus: state.estimatePending ? 'pending' : state.travelEstimates[state.selectedTravelMode] ? 'ready' : 'missing'
      };
    }

    function notifyRouteChange() {
      if (typeof options.onRouteChange === 'function') options.onRouteChange(getRouteState());
    }

    function setRoute(value) {
      var route = value && typeof value === 'object' ? value : {};
      var origin = endpointFromDescriptor(route.origin);
      var destination = endpointFromDescriptor(route.destination);
      if (origin && destination && endpointKey(origin) === endpointKey(destination)) {
        destination = null;
        state.status = '起点和终点不能相同；已保留起点，请重新选择目的地。';
      }
      state.routeOrigin = origin;
      state.routeDestination = destination;
      if (validTravelMode(route.mode)) state.selectedTravelMode = route.mode;
      requestTravelEstimates();
      renderAllDynamic();
      notifyRouteChange();
      return getRouteState();
    }

    function setTravelMode(mode) {
      if (!validTravelMode(mode)) return false;
      state.selectedTravelMode = mode;
      state.appendStatus = '';
      renderAllDynamic();
      renderMapLayers();
      notifyRouteChange();
      return true;
    }

    function assignFocusedEndpoint(slot) {
      return setRouteEndpoint(state.focus, slot);
    }

    function focusStation(stationId) {
      return setFocus(endpointFromStation(stationId), true, 'api_focus_station');
    }

    function focusArea(areaId) {
      return setFocus(endpointFromArea(areaId), false, 'api_focus_area');
    }

    function focusObject(objectId) {
      var endpoint = endpointFromObject(objectId);
      return setFocus(endpoint, Boolean(endpoint && endpoint.coordinates), 'api_focus_object');
    }

    function setFavoritePlaces(value) {
      favoritePlaces = normalizeFavoritePlaces(value);
      renderFavorites();
      return getFavoritePlaces();
    }

    function getFavoritePlaces() {
      return clone(favoritePlaces);
    }

    function getState() {
      return {
        mode: state.mode,
        regionId: state.regionId,
        activeLineIds: Array.from(state.activeLineIds),
        query: state.query,
        searchHistory: resolvedSearchHistory().map(function (endpoint) { return exportEndpoint(endpoint); }),
        selectedStationId: state.selectedStationId,
        selectedAreaId: state.selectedAreaId,
        selectedObjectId: state.selectedObjectId,
        focusedPlace: exportEndpoint(state.focus),
        routeOrigin: exportEndpoint(state.routeOrigin),
        routeDestination: exportEndpoint(state.routeDestination),
        selectedTravelMode: state.selectedTravelMode,
        railPath: effectiveRailPath() ? clone(effectiveRailPath()) : null,
        legacyRailPath: state.railPath ? clone(state.railPath) : null,
        travelEstimates: clone(state.travelEstimates),
        estimatePending: state.estimatePending,
        favoritePlaces: getFavoritePlaces(),
        appendPending: state.appendPending,
        expanded: state.expanded,
        drawerState: state.drawerState,
        evidencePackageIds: Array.from(state.evidencePackageIds),
        evidenceAreaIds: Array.from(state.evidenceAreaIds),
        evidenceObjectIds: Array.from(state.evidenceObjectIds),
        view: clone(state.view),
        homeView: clone(state.homeView),
        lod: state.lod,
        transform: legacyTransform()
      };
    }

    function refresh(nextOptions) {
      if (destroyed) return Promise.resolve(null);
      if (previewView) commitInteractionPreview();
      presentationCache.clear();
      var next = nextOptions && typeof nextOptions === 'object' ? nextOptions : {};
      options = Object.assign({}, options, next);
      if (Object.prototype.hasOwnProperty.call(next, 'browse') || Object.prototype.hasOwnProperty.call(next, 'locationBrowse')) browse = normalizeBrowse(next.browse || next.locationBrowse);
      if (Object.prototype.hasOwnProperty.call(next, 'transitData')) transit = normalizeTransitData(next.transitData);
      if (Object.prototype.hasOwnProperty.call(next, 'geoData')) {
        geo = normalizeGeoData(next.geoData);
        projector = makeProjector(geo.bounds);
        homeCenter = projector.inverse(SVG_WIDTH / 2, SVG_HEIGHT / 2);
        state.homeView = { center: homeCenter, zoom: MIN_ZOOM };
      }
      if (Object.prototype.hasOwnProperty.call(next, 'registry') || Object.prototype.hasOwnProperty.call(next, 'places') || Object.prototype.hasOwnProperty.call(next, 'walkingInterests') || Object.prototype.hasOwnProperty.call(next, 'adminNodes') || Object.prototype.hasOwnProperty.call(next, 'interestLinks')) registry = normalizeRegistry(options);
      if (Object.prototype.hasOwnProperty.call(next, 'favoritePlaces')) favoritePlaces = normalizeFavoritePlaces(next.favoritePlaces);
      rebuildIndexes();
      renderStaticBase();
      renderAllDynamic();
      renderMapLayers();
      if (Object.prototype.hasOwnProperty.call(next, 'evidence')) setEvidence(next.evidence);
      if (Object.prototype.hasOwnProperty.call(next, 'initialView')) setView(next.initialView, 'refresh_view');
      if (state.routeOrigin && state.routeDestination && (Object.prototype.hasOwnProperty.call(next, 'timeEstimator') || Object.prototype.hasOwnProperty.call(next, 'transitTime') || Object.prototype.hasOwnProperty.call(next, 'onEstimateTravel'))) {
        return requestTravelEstimates().then(function () { return getState(); });
      }
      return Promise.resolve(getState());
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInteractionPreview();
      listeners.splice(0).forEach(function (remove) { remove(); });
      pointerState.clear();
      gesture = null;
      if (resizeObserver && typeof resizeObserver.disconnect === 'function') resizeObserver.disconnect();
      var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (renderFrame && view && typeof view.cancelAnimationFrame === 'function') view.cancelAnimationFrame(renderFrame);
      if (container.parentNode) container.parentNode.removeChild(container);
    }

    rebuildIndexes();
    var initialRoute = initialState.route && typeof initialState.route === 'object' ? initialState.route : initialState;
    if (initialRoute.routeOrigin || initialRoute.origin) state.routeOrigin = endpointFromDescriptor(initialRoute.routeOrigin || initialRoute.origin);
    if (initialRoute.routeDestination || initialRoute.destination) state.routeDestination = endpointFromDescriptor(initialRoute.routeDestination || initialRoute.destination);
    if (state.routeOrigin && state.routeDestination && endpointKey(state.routeOrigin) === endpointKey(state.routeDestination)) {
      state.routeDestination = null;
      state.status = '起点和终点不能相同；已保留起点，请重新选择目的地。';
    }
    var restoredFocus = endpointFromDescriptor(initialState.focusedPlace || initialState.focus);
    if (restoredFocus) {
      state.focus = restoredFocus;
      state.selectedStationId = restoredFocus.type === 'station' ? restoredFocus.id : null;
      state.selectedAreaId = restoredFocus.areaId || null;
      state.selectedObjectId = restoredFocus.objectId || null;
    }
    resolvedSearchHistory();
    if (searchInput) searchInput.value = state.query;
    renderStaticBase();
    applyViewTransform();
    renderAllDynamic();
    renderMapLayers();
    on(container, 'click', onClick);
    on(container, 'dblclick', onDoubleClick);
    on(container, 'input', onInput);
    on(container, 'focusin', onFocusIn);
    on(container, 'keydown', onKeydown);
    on(viewport, 'pointerdown', onPointerDown);
    on(viewport, 'pointermove', onPointerMove);
    on(viewport, 'pointerup', onPointerEnd);
    on(viewport, 'pointercancel', onPointerEnd);
    on(viewport, 'lostpointercapture', onPointerEnd);
    on(viewport, 'wheel', onWheel, { passive: false });
    var viewObject = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    on(viewObject, 'resize', onViewportGeometryChange);
    on(viewObject, 'scroll', onViewportGeometryChange, true);
    if (viewObject && viewObject.visualViewport) {
      on(viewObject.visualViewport, 'resize', onViewportGeometryChange);
      on(viewObject.visualViewport, 'scroll', onViewportGeometryChange);
    }
    var ResizeObserverClass = viewObject && viewObject.ResizeObserver ? viewObject.ResizeObserver : typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;
    if (ResizeObserverClass && viewport) {
      resizeObserver = new ResizeObserverClass(onViewportGeometryChange);
      [viewport, container, container.querySelector('[data-role="travel-mode-picker"]'), container.querySelector('[data-role="favorite-rail"]'), container.querySelector('[data-role="map-side-panel"]'), container.querySelector('[data-role="endpoint-shortcuts"]'), container.querySelector('[data-role="map-search-shell"]'), container.querySelector('[data-role="map-search-input-anchor"]')].filter(Boolean).forEach(function (node) { resizeObserver.observe(node); });
    }
    if (options.evidence) setEvidence(options.evidence);
    if (state.routeOrigin && state.routeDestination) requestTravelEstimates();

    return {
      destroy: destroy,
      refresh: refresh,
      refreshEvidence: refreshEvidence,
      setEvidence: setEvidence,
      focusStation: focusStation,
      focusArea: focusArea,
      focusObject: focusObject,
      assignFocusedEndpoint: assignFocusedEndpoint,
      setRoute: setRoute,
      clearRoute: clearRoute,
      setTravelMode: setTravelMode,
      setDrawerState: setDrawerState,
      appendSelectedRoute: function () { return appendTraffic(state.selectedTravelMode); },
      setView: setView,
      getView: function () { return clone(state.view); },
      resetView: resetView,
      resetMap: resetMap,
      setFavoritePlaces: setFavoritePlaces,
      getFavoritePlaces: getFavoritePlaces,
      getState: getState
    };
  }

  return {
    version: VERSION,
    createTransitMap: createTransitMap,
    _test: {
      normalizeGeoData: normalizeGeoData,
      makeProjector: makeProjector,
      lodForZoom: lodForZoom,
      stationVisibleAtLod: stationVisibleAtLod,
      validTravelMode: validTravelMode,
      travelModeLabel: travelModeLabel,
      buildTrafficComment: buildTrafficCommentPure,
      normalizeView: normalizeView,
      rectsIntersect: rectsIntersect
    }
  };
}));

})(isolatedModule, isolatedModule.exports, isolatedRoot, isolatedRoot, isolatedRoot);
export default isolatedModule.exports;
