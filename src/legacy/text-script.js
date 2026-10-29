// LJ-EXT-LEGACY-MODULE
const isolatedModule = { exports: {} };
const isolatedRoot = {};
(function(module, exports, globalThis, self, window) {
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LivingJapanTextScript = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // LJ-V3-TEXT-SCRIPT: one source corpus, longest-match display and output conversion.
  function modeOf(value) { return value === 'traditional' ? 'traditional' : 'simplified'; }

  function makeTrie(mapping, namesOnly) {
    var root = new Map();
    var entries = namesOnly ? (Array.isArray(mapping) ? mapping.map(function (name) { return [name, name]; }) : [])
      : Array.isArray(mapping) ? mapping : Object.entries(mapping || {});
    entries.forEach(function (entry) {
      if (!Array.isArray(entry) || !entry[0]) return;
      var key = String(entry[0]);
      var value = Array.isArray(entry[1]) ? entry[1][0] : entry[1];
      if (value === undefined || value === null) return;
      var node = root;
      Array.from(key).forEach(function (character) {
        if (!node.has(character)) node.set(character, new Map());
        node = node.get(character);
      });
      node.value = String(value);
    });
    return root;
  }

  function longestAt(trie, characters, offset) {
    var node = trie;
    var found = null;
    for (var index = offset; index < characters.length && node.has(characters[index]); index += 1) {
      node = node.get(characters[index]);
      if (node.value !== undefined) found = { text: node.value, length: index - offset + 1 };
    }
    return found;
  }

  function replaceLongest(text, trie, protectedTrie) {
    var characters = Array.from(String(text === null || text === undefined ? '' : text));
    var result = [];
    for (var index = 0; index < characters.length;) {
      var protectedMatch = longestAt(protectedTrie, characters, index);
      if (protectedMatch && protectedMatch.text === '国道' && /^[ \t\u3000]*[0-9０-９一二三四五六七八九十百千]+[ \t\u3000]*[号號]/u.test(characters.slice(index + protectedMatch.length).join(''))) protectedMatch = null;
      var match = protectedMatch || longestAt(trie, characters, index);
      if (match) { result.push(match.text); index += match.length; }
      else { result.push(characters[index]); index += 1; }
    }
    return result.join('');
  }

  function createConverter(data) {
    data = data && typeof data === 'object' ? data : {};
    var protectedTrie = makeTrie(data.protectedNames, true);
    var traditionalStages = (Array.isArray(data.s2tStages) ? data.s2tStages : [data.s2t]).map(function (mapping) { return makeTrie(mapping); });
    var simplifiedStages = (Array.isArray(data.t2sStages) ? data.t2sStages : [data.t2s]).map(function (mapping) { return makeTrie(mapping); });
    var bindings = new Set();
    var rootBindings = new WeakMap();
    var uiMode = 'simplified';

    function convert(text, mode) {
      return (modeOf(mode) === 'traditional' ? traditionalStages : simplifiedStages).reduce(function (value, trie) {
        return replaceLongest(value, trie, protectedTrie);
      }, String(text === null || text === undefined ? '' : text));
    }

    function bindRoot(rootElement, initialMode) {
      if (!rootElement || typeof rootElement !== 'object') return { refresh: function () {}, disconnect: function () {} };
      var existing = rootBindings.get(rootElement);
      if (existing) { existing.setScript(initialMode === undefined ? uiMode : initialMode); return existing; }
      var mode = modeOf(initialMode === undefined ? uiMode : initialMode);
      var originals = new WeakMap();
      var active = true;
      var attributes = ['placeholder', 'title', 'aria-label'];
      var view = rootElement.ownerDocument && rootElement.ownerDocument.defaultView;
      var Observer = view && view.MutationObserver;
      var observer = null;

      function excluded(element) {
        for (var current = element; current; current = current.parentNode) {
          var tag = String(current.tagName || '').toUpperCase();
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return true;
          if (current.getAttribute && (current.getAttribute('contenteditable') === '' || current.getAttribute('contenteditable') === 'true' || current.hasAttribute('data-text-script-skip'))) return true;
          if (current === rootElement) break;
        }
        return false;
      }

      function convertField(node, key, read, write) {
        var current = read();
        if (current === null || current === undefined) return;
        var records = originals.get(node);
        if (!records) { records = {}; originals.set(node, records); }
        var record = records[key];
        if (!record || current !== record.output) record = { original: String(current), output: String(current) };
        var output = mode === 'traditional' ? convert(record.original, mode) : record.original;
        record.output = output;
        records[key] = record;
        if (String(current) !== output) write(output);
      }

      function visit(node) {
        if (!active || !node) return;
        if (node.nodeType === 3) {
          if (!excluded(node.parentNode)) convertField(node, 'text', function () { return node.nodeValue; }, function (value) { node.nodeValue = value; });
          return;
        }
        if (node.nodeType !== 1 && node !== rootElement) return;
        var tag = String(node.tagName || '').toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || node.isContentEditable || (node.hasAttribute && node.hasAttribute('data-text-script-skip'))) return;
        if (node.getAttribute) attributes.forEach(function (name) {
          convertField(node, name, function () { return node.getAttribute(name); }, function (value) { node.setAttribute(name, value); });
        });
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') Array.from(node.childNodes || []).forEach(visit);
      }

      var binding = {
        setScript: function (next) { mode = modeOf(next); visit(rootElement); },
        refresh: function () { visit(rootElement); },
        disconnect: function () {
          active = false;
          if (observer) observer.disconnect();
          bindings.delete(binding);
          rootBindings.delete(rootElement);
        }
      };
      if (Observer) {
        observer = new Observer(function (records) {
          records.forEach(function (record) {
            if (record.type === 'childList') Array.from(record.addedNodes || []).forEach(visit);
            else if (record.type === 'characterData') visit(record.target);
            else if (record.type === 'attributes') visit(record.target);
          });
        });
        observer.observe(rootElement, { childList: true, characterData: true, attributes: true, attributeFilter: attributes, subtree: true });
      }
      bindings.add(binding);
      rootBindings.set(rootElement, binding);
      visit(rootElement);
      return binding;
    }

    return {
      convert: convert,
      toTraditional: function (text) { return convert(text, 'traditional'); },
      toSimplified: function (text) { return convert(text, 'simplified'); },
      bindRoot: bindRoot,
      setUIScriptMode: function (mode) { uiMode = modeOf(mode); bindings.forEach(function (binding) { binding.setScript(uiMode); }); },
      refreshUI: function () { bindings.forEach(function (binding) { binding.refresh(); }); }
    };
  }

  return { createConverter: createConverter };
}));

})(isolatedModule, isolatedModule.exports, isolatedRoot, isolatedRoot, isolatedRoot);
export default isolatedModule.exports;
