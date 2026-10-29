import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// LJ-EXT-BASELINE-EXTRACT
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.dirname(root.replace(/[\\/]$/, ''));
const releasePath = path.join(sourceRoot, '交付', '酒馆助手脚本-Living Japan重构版_v3.6.json');
const bytes = await fs.readFile(releasePath);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
if (hash !== 'a8692973b882b3f67d1b0a5f4bd67132c62f58a427c8d4996118eb8c41238c7d') throw new Error('正式 v3.6 指纹不符');
const release = JSON.parse(bytes);
const sandbox = { module: { exports: {} } };
vm.runInNewContext(release.content, sandbox);
const data = JSON.parse(JSON.stringify(sandbox.module.exports.data));
const transitKeys = ['transitMap', 'transitTime', 'transitGeoData', 'transitStationAdditions', 'transitTopology'];
const transit = {};
for (const key of transitKeys) { transit[key] = data[key]; delete data[key]; }
const legacyDir = path.join(root, 'src', 'legacy');
await fs.mkdir(legacyDir, { recursive: true });
await fs.mkdir(path.join(root, 'data'), { recursive: true });
await fs.writeFile(path.join(root, 'data', 'base.json'), JSON.stringify(data) + '\n');
await fs.writeFile(path.join(legacyDir, 'transit-data.json'), JSON.stringify(transit) + '\n');
const start = release.content.indexOf('  var TEXT_CONVERTER =');
const end = release.content.indexOf('  function sameJson(');
if (start < 0 || end < start) throw new Error('无法定位正式引擎工厂');
const appendStart = release.content.indexOf('  function appendPlaceNameToChatInput(');
const appendEnd = release.content.indexOf('  function createRuntime(');
const body = release.content.slice(start, end) + release.content.slice(appendStart, appendEnd);
const exportsToKeep = ['normalizeText', 'normalizeTagList', 'extractCurrentUserSelection', 'extractCurrentUserText', 'extractTagBodiesDetailed', 'extractTagBodies', 'stripExcludedTags', 'maskTrafficDurationForTimeChannel', 'parseDateState', 'parseTimeRangeState', 'parseTimeState', 'parseDaylightState', 'parseWeatherState', 'parsePlantState', 'parseHumidityState', 'findTriggerDetailed', 'dateWindowMatches', 'minuteWindowMatches', 'resolveLocationTimeFocusState', 'applyLocationTimeFocus', 'wrapLocationTimeFragments', 'stripLocationTimeFit', 'collectChannelEntries', 'resolveTimeStateDetailed', 'resolveTimeState', 'resolveNonTimeChannel', 'evaluateConditionRule', 'normalizeSettings', 'normalizeUIPreferences', 'normalizeTransitFavoritePlaces', 'emptyTextOverrides', 'normalizeTextOverrides', 'editableVariantsForPackage', 'resolveEffectiveBody', 'createOverrideRecord', 'serializeTextOverrides', 'parseTextOverrideImport', 'applyNamedPlaceInterests', 'getPlaceBodyRecords', 'getPlaceWalkingInterests', 'getStationAdministrativeRecord', 'getPlaceStationAdministrativeRecord', 'createLocationBrowserModel', 'getPlacePresentation', 'transitMapFavoritePlaces', 'assemblePrompt', 'outputTextForScript', 'requestGate', 'appendPlaceNameToChatInput', 'appendTrafficToChatInput', 'runEngine'];
await fs.writeFile(path.join(legacyDir, 'engine.js'), '// LJ-EXT-LEGACY-ENGINE\nexport function createEngine(DATA, TRANSIT_MAP, TRANSIT_TIME, TEXT_SCRIPT) {\n' + body + '\nreturn { data: DATA, ' + exportsToKeep.join(', ') + ' };\n}\n');
for (const [filename, sourceName] of [['text-script.js', 'text-script.js'], ['transit-map.js', 'transit-map.v3.js'], ['transit-time.js', 'transit-time.v3.js']]) {
  const source = (await fs.readFile(path.join(sourceRoot, 'src', sourceName), 'utf8')).replace(/^\uFEFF/u, '');
  const moduleSource = '// LJ-EXT-LEGACY-MODULE\nconst isolatedModule = { exports: {} };\nconst isolatedRoot = {};\n(function(module, exports, globalThis, self, window) {\n' + source + '\n})(isolatedModule, isolatedModule.exports, isolatedRoot, isolatedRoot, isolatedRoot);\nexport default isolatedModule.exports;\n';
  await fs.writeFile(path.join(legacyDir, filename), moduleSource);
}
await fs.copyFile(path.join(sourceRoot, 'src', 'transit-map.v3.css'), path.join(legacyDir, 'transit-map.css'));
await fs.writeFile(path.join(legacyDir, 'baseline-provenance.json'), JSON.stringify({ version: 'v3.6', bytes: bytes.length, sha256: hash, packages: data.packages.length, slots: data.editableTextSlots.slotCount, extraction: 'Official release factory; no DOM and no automatic start; transit payload split only.' }, null, 2) + '\n');
console.log(`Extracted ${data.packages.length} packages and ${data.editableTextSlots.slotCount} editable slots from verified v3.6.`);
