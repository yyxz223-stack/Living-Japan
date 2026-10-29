// LJ-EXT-LEGACY-ENGINE
export function createEngine(DATA, TRANSIT_MAP, TRANSIT_TIME, TEXT_SCRIPT) {
  var TEXT_CONVERTER = TEXT_SCRIPT.createConverter(DATA.textConversion || {});
  var LOCATION_BROWSER_MODEL = createLocationBrowserModel(DATA);
  var OWNER_KEY = '__livingJapanOwner__';
  var PANEL_ID = 'living-japan-panel';
  var STYLE_ID = 'living-japan-style';
  var FAB_CONTROL_ID = 'living-japan-sakura-control';
  var FAB_ID = 'living-japan-sakura-fab';
  var FAB_MENU_ID = 'living-japan-sakura-menu';
  var FAB_CLICK_DELAY_MS = 320;
  var FAB_LONG_PRESS_MS = 580;
  var POINTER_DRAG_THRESHOLD = 8;
  var FAB_EDGE_DISTANCE_PX = 8;
  var FAB_EDGE_IDLE_MS = 1800;
  var PANEL_UI_SCHEMA_VERSION = 4;
  var ALLOWED_TYPES = ['normal', 'continue', 'regenerate', 'swipe'];
  var GROUP_LABELS = {
    TN_LIGHT: '时间与自然／天光',
    TN_FEEL: '时间与自然／体感',
    TN_WEATHER: '时间与自然／天气',
    TN_PLANT: '时间与自然／植物',
    TN_BIO: '时间与自然／季节生物',
    TN_SURFACE: '时间与自然／城市表面',
    TN_APPEARANCE: '时间与自然／季节外观',
    TN_SEASONAL: '时间与自然／季节背景',
    EX_TOKYO: '外部地域／东京都',
    EX_KAWASAKI: '外部地域／川崎',
    EX_KAWASAKI_RIVER: '外部地域／川崎多摩川',
    EX_YOKOHAMA: '外部地域／横滨',
    EX_CHIBA: '外部地域／千叶',
    IN_NAMED: '内部场所／具名场馆',
    IN_GENERIC: '内部场所／通用类型',
    EV_SUMMER: '明确场景／夏季',
    EV_PERFORMANCE: '明确场景／演出'
  };
  var LAYER_LABELS = {
    TN: '时间与自然',
    EX: '外部地域',
    IN: '内部场所',
    EV: '明确场景事件'
  };
  var PROMPT_LAYER_LABELS = {
    TN: '时间自然',
    EX: '外部地域',
    IN: '内部场所',
    EV: '场景事件'
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (typeof text.normalize === 'function') {
      text = text.normalize('NFKC');
    }
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '').toLocaleLowerCase();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  }

  function normalizeTagName(value) {
    var text = value === null || value === undefined ? '' : String(value).trim();
    var match = text.match(/^<\s*\/?\s*([^\s/>]+)/);
    return (match ? match[1] : text).trim();
  }

  function normalizeTagList(value, fallback) {
    var source;
    if (Array.isArray(value)) source = value;
    else if (typeof value === 'string') source = value.split(/[,，\n\r]+/);
    else source = Array.isArray(fallback) ? fallback : [];
    var result = [];
    source.forEach(function (item) {
      var tagName = normalizeTagName(item);
      if (tagName && !result.includes(tagName)) result.push(tagName);
    });
    return result;
  }

  function extractCurrentUserSelection(value, boundary) {
    var text = value === null || value === undefined ? '' : String(value);
    var startTag = boundary && boundary.start !== undefined ? String(boundary.start) : '<本轮用户输入>';
    var endTag = boundary && boundary.end !== undefined ? String(boundary.end) : '</本轮用户输入>';
    if (!startTag || !endTag) {
      return { text: text, path: 'current_user_full', tagNames: [] };
    }
    var start = text.lastIndexOf(startTag);
    if (start < 0) return { text: text, path: 'current_user_full', tagNames: [] };
    var end = text.indexOf(endTag, start + startTag.length);
    if (end < 0) return { text: text, path: 'current_user_full', tagNames: [] };
    return {
      text: text.slice(start + startTag.length, end),
      path: 'current_user_tag',
      tagNames: [startTag + ' … ' + endTag]
    };
  }

  function extractCurrentUserText(value, boundary) {
    return extractCurrentUserSelection(value, boundary).text;
  }

  function extractTagBodiesDetailed(value, tagNames) {
    var text = value === null || value === undefined ? '' : String(value);
    var bodies = [];
    normalizeTagList(tagNames).forEach(function (tagName) {
      var escaped = escapeRegExp(tagName);
      var pattern = new RegExp('<\\s*' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\s*' + escaped + '\\s*>', 'gi');
      var match;
      while ((match = pattern.exec(text)) !== null) {
        bodies.push({
          tagName: tagName,
          text: String(match[1] || '').trim(),
          start: match.index,
          end: pattern.lastIndex
        });
      }
    });
    return bodies.sort(function (left, right) {
      if (left.start !== right.start) return left.start - right.start;
      return left.end - right.end;
    });
  }

  function extractTagBodies(value, tagNames) {
    return extractTagBodiesDetailed(value, tagNames).map(function (item) { return item.text; }).join('\n');
  }

  function stripExcludedTags(value, tagNames) {
    var text = value === null || value === undefined ? '' : String(value);
    normalizeTagList(tagNames).forEach(function (tagName) {
      var escaped = escapeRegExp(tagName);
      var paired = new RegExp('<\\s*' + escaped + '(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\s*' + escaped + '\\s*>', 'gi');
      var previous;
      var passes = 0;
      do {
        previous = text;
        text = text.replace(paired, '');
        passes += 1;
      } while (text !== previous && passes < 8);
      var single = new RegExp('<\\s*\\/?\\s*' + escaped + '(?:\\s[^>]*)?\\/?>', 'gi');
      text = text.replace(single, '');
    });
    return text;
  }

  // LJ001-TN-TRAFFIC-DURATION-MASK：交通备注只在时间通道遮住耗时短语，其他通道与诊断仍保留原文。
  function maskTrafficDurationForTimeChannel(value) {
    var text = value === null || value === undefined ? '' : String(value);
    return text.replace(/<!--\s*traffic\s+info\s*[：:][\s\S]*?-->/giu, function (comment) {
      return comment.replace(/所需\s*(?:时间\s*)?约\s*[0-9０-９]+(?:[.．][0-9０-９]+)?\s*分(?:钟)?/gu, function (duration) {
        return duration.replace(/[^\r\n]/gu, ' ');
      });
    });
  }

  function textPreview(value, maxLength) {
    var compact = String(value || '').replace(/\s+/g, ' ').trim();
    var limit = Number.isFinite(Number(maxLength)) ? Number(maxLength) : 240;
    return compact.length > limit ? compact.slice(0, limit) + '…' : compact;
  }

  function hasAnyTrigger(text, triggers) {
    var normalized = normalizeText(text);
    return triggers.some(function (trigger) {
      return normalized.includes(normalizeText(trigger));
    });
  }

  function findTriggerDetailed(text, triggers) {
    var normalized = normalizeText(text);
    var best = null;
    (triggers || []).forEach(function (trigger) {
      var normalizedTrigger = normalizeText(trigger);
      if (!normalizedTrigger) return;
      var index = normalized.lastIndexOf(normalizedTrigger);
      if (index < 0) return;
      var end = index + normalizedTrigger.length;
      if (!best || end > best.end ||
        (end === best.end && normalizedTrigger.length > best.length) ||
        (end === best.end && normalizedTrigger.length === best.length && index > best.index)) {
        best = { trigger: trigger, index: index, end: end, length: normalizedTrigger.length };
      }
    });
    return best;
  }

  function findDirectTriggerDetailed(text, triggers, exclusions) {
    var normalized = normalizeText(text);
    var excludedSpans = [];
    (exclusions || []).forEach(function (exclusion) {
      var normalizedExclusion = normalizeText(exclusion);
      if (!normalizedExclusion) return;
      var from = 0;
      var index;
      while ((index = normalized.indexOf(normalizedExclusion, from)) >= 0) {
        excludedSpans.push({ start: index, end: index + normalizedExclusion.length });
        from = index + Math.max(1, normalizedExclusion.length);
      }
    });
    var best = null;
    (triggers || []).forEach(function (trigger) {
      var normalizedTrigger = normalizeText(trigger);
      if (!normalizedTrigger) return;
      var from = normalized.length;
      var index;
      while ((index = normalized.lastIndexOf(normalizedTrigger, from)) >= 0) {
        var end = index + normalizedTrigger.length;
        var excluded = excludedSpans.some(function (span) {
          return index >= span.start && end <= span.end;
        });
        if (!excluded) {
          if (!best || end > best.end ||
            (end === best.end && normalizedTrigger.length > best.length) ||
            (end === best.end && normalizedTrigger.length === best.length && index > best.index)) {
            best = { trigger: trigger, index: index, end: end, length: normalizedTrigger.length };
          }
          break;
        }
        if (index === 0) break;
        from = index - 1;
      }
    });
    return best;
  }

  function findTrigger(text, triggers) {
    var match = findTriggerDetailed(text, triggers);
    return match ? match.trigger : null;
  }

  function parseChineseNumber(value) {
    var digits = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    var text = String(value || '');
    if (text === '十') return 10;
    if (text.includes('十')) {
      var parts = text.split('十');
      var tens = parts[0] ? digits[parts[0]] : 1;
      var ones = parts[1] ? digits[parts[1]] : 0;
      return tens * 10 + ones;
    }
    return digits[text] || null;
  }

  function parseDateState(value) {
    var text = normalizeText(value);
    var candidates = [];
    function collect(pattern, mapper) {
      var match;
      while ((match = pattern.exec(text)) !== null) {
        var mapped = mapper(match);
        if (mapped) {
          mapped.index = match.index;
          mapped.end = pattern.lastIndex;
          mapped.raw = match[0];
          candidates.push(mapped);
        }
        if (match[0] === '') pattern.lastIndex += 1;
      }
    }
    collect(/((?:19|20)\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})(?:日|号)?/g, function (match) {
      return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), specificity: 3 };
    });
    collect(/(?:^|[^\d])(\d{1,2})月(\d{1,2})(?:日|号)/g, function (match) {
      return { year: null, month: Number(match[1]), day: Number(match[2]), specificity: 2 };
    });
    collect(/(十一|十二|十|[一二三四五六七八九])月([一二三四五六七八九十]{1,3})(?:日|号)/g, function (match) {
      return { year: null, month: parseChineseNumber(match[1]), day: parseChineseNumber(match[2]), specificity: 2 };
    });
    collect(/(?:^|[^\d])(\d{1,2})月(?!\d)/g, function (match) {
      return { year: null, month: Number(match[1]), day: null, specificity: 1 };
    });
    collect(/(十一|十二|十|[一二三四五六七八九])月/g, function (match) {
      return { year: null, month: parseChineseNumber(match[1]), day: null, specificity: 1 };
    });
    candidates = candidates.filter(function (item) {
      return item.month >= 1 && item.month <= 12 && (item.day === null || (item.day >= 1 && item.day <= 31));
    });
    if (!candidates.length) return null;
    candidates.sort(function (left, right) {
      if (left.end !== right.end) return right.end - left.end;
      if (left.specificity !== right.specificity) return right.specificity - left.specificity;
      return right.index - left.index;
    });
    var selected = candidates[0];
    var month = selected.month;
    var day = selected.day;
    var monthPart = null;
    var suffix = text.slice(selected.index, Math.min(text.length, selected.end + 8));
    if (/月初|上旬/.test(suffix)) monthPart = 0;
    else if (/月中|中旬/.test(suffix)) monthPart = 1;
    else if (/月末|下旬/.test(suffix)) monthPart = 2;
    else if (day !== null) monthPart = day <= 10 ? 0 : (day <= 20 ? 1 : 2);
    else monthPart = 1;
    return {
      year: selected.year,
      month: month,
      day: day,
      monthPart: monthPart,
      raw: selected.raw.trim(),
      index: selected.index,
      end: selected.end
    };
  }

  function parseTimeRangeState(value) {
    var text = normalizeText(value);
    var candidates = [];
    var rangePattern = /([01]?\d|2[0-3])[:：]([0-5]\d)\s*(?:->|→|—>|—|-|至|到|～|~)\s*([01]?\d|2[0-3])[:：]([0-5]\d)/g;
    var match;
    while ((match = rangePattern.exec(text)) !== null) {
      var startHour = Number(match[1]);
      var startMinute = Number(match[2]);
      var endHour = Number(match[3]);
      var endMinute = Number(match[4]);
      candidates.push({
        kind: 'range',
        start: { hour: startHour, minute: startMinute, minutes: startHour * 60 + startMinute },
        endPoint: { hour: endHour, minute: endMinute, minutes: endHour * 60 + endMinute },
        raw: match[0],
        index: match.index,
        end: rangePattern.lastIndex
      });
    }
    var clockPattern = /(?:^|[^\d])([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/g;
    while ((match = clockPattern.exec(text)) !== null) {
      var hour = Number(match[1]);
      var minute = Number(match[2]);
      var prefixLength = match[0].length - (match[1].length + match[2].length + 1);
      candidates.push({
        kind: 'point',
        start: null,
        endPoint: { hour: hour, minute: minute, minutes: hour * 60 + minute },
        raw: match[0].trim(),
        index: match.index + prefixLength,
        end: clockPattern.lastIndex
      });
    }
    var wordPattern = /(?:凌晨|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|夜间)?\s*(\d{1,2})\s*(?:点|時)(半|[0-5]?\d分)?/g;
    while ((match = wordPattern.exec(text)) !== null) {
      var wordHour = Number(match[1]);
      var wordMinute = match[2] === '半' ? 30 : Number((match[2] || '0').replace('分', ''));
      if (/下午|傍晚|晚上|夜里|夜间/.test(match[0]) && wordHour < 12) wordHour += 12;
      if (/中午/.test(match[0]) && wordHour < 11) wordHour += 12;
      if (wordHour >= 0 && wordHour <= 23 && wordMinute >= 0 && wordMinute <= 59) {
        candidates.push({
          kind: 'point',
          start: null,
          endPoint: { hour: wordHour, minute: wordMinute, minutes: wordHour * 60 + wordMinute },
          raw: match[0].trim(),
          index: match.index,
          end: wordPattern.lastIndex
        });
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (left, right) {
      if (left.end !== right.end) return right.end - left.end;
      if (left.kind !== right.kind) return left.kind === 'range' ? -1 : 1;
      return right.index - left.index;
    });
    return candidates[0];
  }

  function parseTimeState(value) {
    var parsed = parseTimeRangeState(value);
    return parsed ? Object.assign({}, parsed.endPoint) : null;
  }

  function parseWeatherState(value) {
    var text = normalizeText(value);
    var groups = [];
    DATA.packages.forEach(function (item) {
      var activation = item.activation || {};
      if (activation.kind !== 'explicit_weather') return;
      (activation.weatherTriggerGroups || []).forEach(function (group) {
        groups.push({ type: group.type, triggers: group.triggers || [] });
      });
    });
    groups = groups.concat([
      { type: 'typhoon', triggers: ['台风正在接近', '台风登陆', '台風が接近', '台風上陸', '台风天'] },
      { type: 'heavy_snow', triggers: ['大雪', '暴雪', '雪が激しく降る'] },
      { type: 'light_snow', triggers: ['小雪', '细雪', '零星飘雪', 'ちらつく雪'] },
      { type: 'snow_cover', triggers: ['积雪', '路面积雪', '雪が積もる', '雪に覆われた'] },
      { type: 'light_rain', triggers: ['小雨が降る', '毛毛雨', '细雨', '雨丝', '霧雨', '淅沥小雨', '小雨'] },
      { type: 'steady_rain', triggers: ['持续降雨', '一直下雨', '连绵的雨'] },
      { type: 'heavy_rain', triggers: ['大雨', '暴雨', '雷雨'] },
      { type: 'strong_wind', triggers: ['强风', '大风', '阵风很强', '风力很强', '強風'] },
      { type: 'clear', triggers: ['天气：晴', '天气:晴', '晴天', '晴朗', '转晴', '放晴'] },
      { type: 'cloudy', triggers: ['天气：阴', '天气:阴', '阴天', '多云'] },
      { type: 'snow', triggers: ['降雪', '正在下雪', '雪が降る'] },
      { type: 'not_raining', triggers: ['雨停了', '已经停雨', '雨已经停了', '不再下雨'] }
    ]);
    var best = null;
    groups.forEach(function (group) {
      var found = findTriggerDetailed(text, group.triggers);
      if (found && (!best || found.end > best.end ||
        (found.end === best.end && found.length > best.length) ||
        (found.end === best.end && found.length === best.length && found.index > best.index))) {
        best = Object.assign({ type: group.type }, found);
      }
    });
    return best ? { type: best.type, trigger: best.trigger, index: best.index, end: best.end } : null;
  }

  function getPackageById(packageId) {
    return DATA.packages.find(function (item) { return item.id === packageId; });
  }

  function parsePlantState(value) {
    var text = normalizeText(value);
    var item = getPackageById('LT_TN_PLANT_SAKURA_FULL_BLOOM');
    if (item && hasAnyTrigger(text, item.directTriggers)) {
      return { type: 'sakura_full_bloom', trigger: findTrigger(text, item.directTriggers) };
    }
    var changed = ['樱花已经谢了', '樱花谢了', '樱花还没开', '樱花尚未开放', '樱花刚开始开', '樱花初开', '樱花花瓣落尽', '樱花落完了', '樱花不再盛开'];
    var trigger = findTrigger(text, changed);
    if (trigger) return { type: 'other', trigger: trigger };
    return null;
  }

  function parseHumidityState(value) {
    var text = normalizeText(value);
    var item = getPackageById('LT_TN_FEEL_HUMIDITY');
    if (item && hasAnyTrigger(text, item.directTriggers)) {
      return { type: 'humidity_explicit', trigger: findTrigger(text, item.directTriggers) };
    }
    var changed = ['湿度恢复正常', '空气不再发潮', '潮气散了', '湿气已经散了'];
    var trigger = findTrigger(text, changed);
    if (trigger) return { type: 'other', trigger: trigger };
    return null;
  }

  function parseDaylightState(value) {
    var text = normalizeText(value);
    var item = getPackageById('LT_TN_LIGHT_DAWN');
    var trigger = item ? findTrigger(text, item.directTriggers) : null;
    if (trigger) return { type: 'dawn_explicit', trigger: trigger };
    var changed = ['日出以后', '日出之后', '已经天亮', '天已经亮了', '太阳已经升起', '晨光已经过去'];
    trigger = findTrigger(text, changed);
    if (trigger) return { type: 'other', trigger: trigger };
    var clock = parseTimeState(text);
    if (clock) return { type: 'clock', trigger: null, minutes: clock.minutes };
    return null;
  }

  function dateWindowMatches(date, window) {
    if (!date || !window) return false;
    var day = date.day === null || date.day === undefined ? 15 : date.day;
    var value = date.month * 100 + day;
    var startMonth = Number(window.startMonth || (window.start && window.start.month));
    var startDay = Number(window.startDay || (window.start && window.start.day) || 1);
    var endMonth = Number(window.endMonth || (window.end && window.end.month));
    var endDay = Number(window.endDay || (window.end && window.end.day) || 31);
    if (!(startMonth >= 1 && startMonth <= 12 && endMonth >= 1 && endMonth <= 12)) return false;
    var start = startMonth * 100 + startDay;
    var end = endMonth * 100 + endDay;
    if (start <= end) return value >= start && value <= end;
    return value >= start || value <= end;
  }

  function anyDateWindowMatches(date, windows) {
    return Array.isArray(windows) && windows.some(function (window) {
      return dateWindowMatches(date, window);
    });
  }

  function minuteWindowMatches(minutes, start, end) {
    if (!Number.isFinite(Number(minutes)) || !Number.isFinite(Number(start)) || !Number.isFinite(Number(end))) return false;
    var value = Number(minutes);
    var first = Number(start);
    var last = Number(end);
    if (first <= last) return value >= first && value < last;
    return value >= first || value < last;
  }

  function clockStringToMinutes(value) {
    var match = String(value || '').match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match) return null;
    var hour = Number(match[1]);
    if (hour < 0 || hour > 23) return null;
    return hour * 60 + Number(match[2]);
  }

  function findCalendarSegment(date) {
    if (!date || !Array.isArray(DATA.calendarSegments)) return null;
    var day = date.day === null || date.day === undefined ? 15 : date.day;
    return DATA.calendarSegments.find(function (segment) {
      var afterStart = segment.dayStart === null || segment.dayStart === undefined || day >= Number(segment.dayStart);
      var beforeEnd = segment.dayEnd === null || segment.dayEnd === undefined || day <= Number(segment.dayEnd);
      return Number(segment.month) === Number(date.month) && afterStart && beforeEnd;
    }) || null;
  }

  function findCalendarSegmentById(segmentId) {
    if (!segmentId || !Array.isArray(DATA.calendarSegments)) return null;
    return DATA.calendarSegments.find(function (segment) { return segment.id === segmentId; }) || null;
  }

  function clockPointLabel(point) {
    if (!point || !Number.isFinite(Number(point.hour)) || !Number.isFinite(Number(point.minute))) return null;
    return String(Number(point.hour)).padStart(2, '0') + ':' + String(Number(point.minute)).padStart(2, '0');
  }

  function resolveLocationTimeFocusState(state) {
    if (!state || !state.date || state.date.day === null || state.date.day === undefined ||
      !Number.isInteger(Number(state.date.day)) || !state.clockEndpoint) return null;
    var segment = findCalendarSegment(state.date);
    if (!segment || !segment.anchors) return null;
    var dawn = clockStringToMinutes(segment.anchors.dawn);
    var sunrise = clockStringToMinutes(segment.anchors.sunrise);
    var sunset = clockStringToMinutes(segment.anchors.sunset);
    var nightfall = clockStringToMinutes(segment.anchors.nightfall);
    var endpointMinutes = Number(state.clockEndpoint.minutes);
    if ([dawn, sunrise, sunset, nightfall, endpointMinutes].some(function (value) { return !Number.isFinite(value); })) return null;
    var dawnEnd = Math.min(11 * 60, sunrise + 60);
    var preSunsetStart = Math.max(14 * 60, sunset - 90);
    var phase;
    var activePhases;
    if (endpointMinutes < dawn) {
      phase = 'predawn';
      activePhases = ['predawn', 'late_night'];
    } else if (endpointMinutes < dawnEnd) {
      phase = 'dawn';
      activePhases = ['dawn'];
    } else if (endpointMinutes < 11 * 60) {
      phase = 'morning';
      activePhases = ['morning'];
    } else if (endpointMinutes < 14 * 60) {
      phase = 'midday';
      activePhases = ['midday'];
    } else if (endpointMinutes < preSunsetStart) {
      phase = 'afternoon';
      activePhases = ['afternoon'];
    } else if (endpointMinutes < sunset) {
      phase = 'pre_sunset';
      activePhases = ['pre_sunset'];
    } else if (endpointMinutes < nightfall) {
      phase = 'twilight';
      activePhases = ['twilight'];
    } else if (endpointMinutes < 22 * 60 + 30) {
      phase = 'early_night';
      activePhases = ['early_night'];
    } else {
      phase = 'late_night';
      activePhases = ['late_night'];
    }
    var year = state.date.year !== null && state.date.year !== undefined && Number.isInteger(Number(state.date.year))
      ? Number(state.date.year) : null;
    var weekday = year === null ? null : new Date(Date.UTC(year, Number(state.date.month) - 1, Number(state.date.day))).getUTCDay();
    return {
      calendarSegmentId: segment.id,
      endpointMinutes: endpointMinutes,
      phase: phase,
      activePhases: activePhases,
      month: Number(state.date.month),
      day: Number(state.date.day),
      year: year,
      weekday: weekday
    };
  }

  function normalizedTriggerSet(values) {
    return new Set((values || []).filter(Boolean).map(function (value) {
      return String(value).trim().toLocaleLowerCase('zh-CN');
    }));
  }

  function locationTimeRecordFits(record, state, matchedTriggers) {
    if (!record.phases.some(function (phase) { return state.activePhases.includes(phase); })) return false;
    if (Array.isArray(record.months) && !record.months.includes(state.month)) return false;
    if (Array.isArray(record.weekdays)) {
      if (state.weekday === null || !record.weekdays.includes(state.weekday)) return false;
    }
    if (Array.isArray(record.scopeTriggers) && record.scopeTriggers.length) {
      var actual = normalizedTriggerSet(matchedTriggers);
      if (!record.scopeTriggers.some(function (trigger) {
        return actual.has(String(trigger).trim().toLocaleLowerCase('zh-CN'));
      })) return false;
    }
    return true;
  }

  function countTextOccurrences(haystack, needle) {
    var count = 0;
    var cursor = 0;
    while (true) {
      var found = haystack.indexOf(needle, cursor);
      if (found === -1) return count;
      count += 1;
      cursor = found + needle.length;
    }
  }

  function wrapLocationTimeFragments(body, records) {
    var openTag = '<location_time_fit>';
    var closeTag = '</location_time_fit>';
    if (body.includes(openTag) || body.includes(closeTag)) throw new Error('body already contains location-time focus tags');
    var positions = records.map(function (record) {
      var occurrences = countTextOccurrences(body, record.exactText);
      if (occurrences !== 1) throw new Error(record.id + ': exactText must occur once in body, found ' + occurrences);
      var start = body.indexOf(record.exactText);
      return { record: record, start: start, end: start + record.exactText.length };
    }).sort(function (left, right) { return left.start - right.start; });
    for (var index = 1; index < positions.length; index += 1) {
      if (positions[index].start < positions[index - 1].end) {
        throw new Error(positions[index - 1].record.id + ' overlaps ' + positions[index].record.id);
      }
    }
    var result = body;
    positions.sort(function (left, right) { return right.start - left.start; }).forEach(function (position) {
      result = result.slice(0, position.start) + openTag + position.record.exactText + closeTag + result.slice(position.end);
    });
    return result;
  }

  function stripLocationTimeFit(body) {
    return String(body || '').split('<location_time_fit>').join('').split('</location_time_fit>').join('');
  }

  function applyLocationTimeFocus(packageItem, matchDetail, restoredTimeState) {
    var empty = { body: packageItem && typeof packageItem.body === 'string' ? packageItem.body : '', focusedFragmentIds: [], internalMatch: null };
    if (!packageItem || packageItem.layer !== 'EX' || !DATA.locationTimeFocus || !Array.isArray(DATA.locationTimeFocus.records)) return empty;
    var state = resolveLocationTimeFocusState(restoredTimeState);
    if (!state) return empty;
    var detail = matchDetail || {};
    var matchedTriggers = [detail.trigger, detail.referenceTrigger, detail.compositeCore, detail.compositeQualifier].filter(Boolean);
    var records = DATA.locationTimeFocus.records.filter(function (record) {
      return record.basePackageId === packageItem.id &&
        record.bodySha256 === packageItem.bodySha256 &&
        locationTimeRecordFits(record, state, matchedTriggers);
    });
    return {
      body: records.length ? wrapLocationTimeFragments(packageItem.body, records) : packageItem.body,
      focusedFragmentIds: records.map(function (record) { return record.id; }),
      internalMatch: {
        calendarSegmentId: state.calendarSegmentId,
        phase: state.phase,
        endpointMinutes: state.endpointMinutes
      }
    };
  }

  function resolveRuntimeBody(packageItem, state) {
    var activation = packageItem.activation || {};
    var segment = findCalendarSegment(state && state.date);
    if (activation.kind === 'calendar_variant') {
      return segment && segment.calendarBodies ? String(segment.calendarBodies[activation.calendarBodyKey] || '') : '';
    }
    if (activation.kind === 'calendar_and_clock_variant') {
      if (!segment || !Array.isArray(segment.daylightRanges)) return '';
      var range = segment.daylightRanges.find(function (item) { return item.packageId === packageItem.id; });
      return range ? String(range.body || '') : '';
    }
    return String(packageItem.body || '');
  }

  // LT-D146-TEXT-OVERRIDES：自定义正文只覆盖最终发送文字，不参与识别、联动或开关判断。
  function emptyTextOverrides() {
    return { schemaVersion: 1, records: {}, orphans: {} };
  }

  function normalizeOverrideRecord(record, slotKey) {
    if (!record || typeof record !== 'object' || typeof record.body !== 'string' || !record.body.trim()) return null;
    return {
      packageId: typeof record.packageId === 'string' ? record.packageId : '',
      calendarSegmentId: typeof record.calendarSegmentId === 'string' ? record.calendarSegmentId : null,
      body: record.body,
      baseBuiltinSha256: typeof record.baseBuiltinSha256 === 'string' ? record.baseBuiltinSha256 : '',
      savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
      sourceRelease: typeof record.sourceRelease === 'string' ? record.sourceRelease : '',
      slotKey: slotKey
    };
  }

  function normalizeTextOverrides(input) {
    var result = emptyTextOverrides();
    var value = input && typeof input === 'object' ? input : {};
    var slotIndex = DATA.editableTextSlots && DATA.editableTextSlots.slots ? DATA.editableTextSlots.slots : {};
    function collect(source) {
      if (!source || typeof source !== 'object') return;
      Object.keys(source).sort().forEach(function (slotKey) {
        var record = normalizeOverrideRecord(source[slotKey], slotKey);
        if (!record) return;
        var slot = slotIndex[slotKey] || null;
        if (slot && (!record.packageId || record.packageId === slot.packageId) &&
          (record.calendarSegmentId || null) === (slot.calendarSegmentId || null)) {
          record.packageId = slot.packageId;
          record.calendarSegmentId = slot.calendarSegmentId || null;
          result.records[slotKey] = record;
          delete result.orphans[slotKey];
        } else if (!result.records[slotKey]) {
          result.orphans[slotKey] = record;
        }
      });
    }
    collect(value.orphans);
    collect(value.records);
    return result;
  }

  function editableVariantsForPackage(packageOrId) {
    var packageItem = typeof packageOrId === 'string' ? getPackageById(packageOrId) : packageOrId;
    if (!packageItem) return [];
    var activation = packageItem.activation || {};
    if (activation.kind !== 'calendar_variant' && activation.kind !== 'calendar_and_clock_variant') {
      var staticKey = 'P/' + packageItem.id;
      var staticMeta = DATA.editableTextSlots.slots[staticKey];
      return staticMeta ? [{
        slotKey: staticKey,
        packageId: packageItem.id,
        calendarSegmentId: null,
        label: '固定正文',
        body: String(packageItem.body || ''),
        bodySha256: staticMeta.bodySha256
      }] : [];
    }
    return DATA.calendarSegments.map(function (segment) {
      var body = '';
      if (activation.kind === 'calendar_variant') {
        body = String((segment.calendarBodies || {})[activation.calendarBodyKey] || '');
      } else {
        var range = (segment.daylightRanges || []).find(function (item) { return item.packageId === packageItem.id; });
        body = range ? String(range.body || '') : '';
      }
      var slotKey = 'V/' + segment.id + '/' + packageItem.id;
      var slotMeta = DATA.editableTextSlots.slots[slotKey];
      return {
        slotKey: slotKey,
        packageId: packageItem.id,
        calendarSegmentId: segment.id,
        label: segment.label,
        body: body,
        bodySha256: slotMeta ? slotMeta.bodySha256 : ''
      };
    }).filter(function (variant) { return variant.body && variant.bodySha256; });
  }

  function resolveEffectiveBody(packageItem, state, overrideStore) {
    var activation = packageItem.activation || {};
    var variant = null;
    if (activation.kind === 'calendar_variant' || activation.kind === 'calendar_and_clock_variant') {
      var segment = findCalendarSegment(state && state.date);
      if (segment) {
        variant = editableVariantsForPackage(packageItem).find(function (item) {
          return item.calendarSegmentId === segment.id;
        }) || null;
      }
    } else {
      variant = editableVariantsForPackage(packageItem)[0] || null;
    }
    var builtinBody = variant ? variant.body : resolveRuntimeBody(packageItem, state);
    var store = overrideStore && overrideStore.records ? overrideStore : emptyTextOverrides();
    var record = variant ? store.records[variant.slotKey] : null;
    if (!record || typeof record.body !== 'string' || !record.body.trim()) {
      return {
        body: builtinBody,
        custom: false,
        slotKey: variant ? variant.slotKey : null,
        calendarSegmentId: variant ? variant.calendarSegmentId : null,
        baseChanged: false
      };
    }
    return {
      body: record.body,
      custom: true,
      slotKey: variant.slotKey,
      calendarSegmentId: variant.calendarSegmentId,
      baseChanged: record.baseBuiltinSha256 !== variant.bodySha256
    };
  }

  function createOverrideRecord(variant, body) {
    if (!variant || typeof body !== 'string' || !body.trim()) throw new Error('正文不能为空；如需停用，请关闭资料包');
    return {
      packageId: variant.packageId,
      calendarSegmentId: variant.calendarSegmentId || null,
      body: body,
      baseBuiltinSha256: variant.bodySha256,
      savedAt: new Date().toISOString(),
      sourceRelease: DATA.releaseId,
      slotKey: variant.slotKey
    };
  }

  function overrideExportRecords(map) {
    return Object.keys(map || {}).sort().map(function (slotKey) {
      var record = map[slotKey];
      return {
        slotKey: slotKey,
        packageId: record.packageId,
        calendarSegmentId: record.calendarSegmentId || null,
        body: record.body,
        baseBuiltinSha256: record.baseBuiltinSha256 || '',
        savedAt: record.savedAt || '',
        sourceRelease: record.sourceRelease || ''
      };
    });
  }

  function serializeTextOverrides(overrideStore) {
    var store = normalizeTextOverrides(overrideStore);
    return JSON.stringify({
      format: DATA.textOverrideFormat,
      formatVersion: 1,
      productId: DATA.productId,
      sourceRelease: DATA.releaseId,
      exportedAt: new Date().toISOString(),
      records: overrideExportRecords(store.records),
      orphans: overrideExportRecords(store.orphans)
    }, null, 2);
  }

  function parseTextOverrideImport(value, currentStore) {
    var parsed = typeof value === 'string' ? JSON.parse(value) : clone(value);
    if (!parsed || parsed.format !== DATA.textOverrideFormat || Number(parsed.formatVersion) !== 1) {
      throw new Error('不是受支持的 Living Japan 自定义正文文件');
    }
    if (parsed.productId !== DATA.productId) throw new Error('自定义正文文件不属于当前 Living Japan 脚本');
    if (!Array.isArray(parsed.records) || (parsed.orphans !== undefined && !Array.isArray(parsed.orphans))) {
      throw new Error('自定义正文文件结构无效');
    }
    var merged = normalizeTextOverrides(currentStore);
    var slotIndex = DATA.editableTextSlots.slots;
    var seen = new Set();
    var summary = { imported: 0, added: 0, overwritten: 0, baseChanged: 0, unresolved: 0, total: 0 };
    function accept(record) {
      summary.total += 1;
      if (!record || typeof record !== 'object' || typeof record.slotKey !== 'string' ||
        typeof record.packageId !== 'string' || typeof record.body !== 'string' || !record.body.trim()) {
        throw new Error('自定义正文文件含无效记录');
      }
      if (seen.has(record.slotKey)) throw new Error('自定义正文文件含重复记录：' + record.slotKey);
      seen.add(record.slotKey);
      var normalized = normalizeOverrideRecord(record, record.slotKey);
      var slot = slotIndex[record.slotKey] || null;
      var sameSlot = slot && slot.packageId === record.packageId &&
        (slot.calendarSegmentId || null) === (record.calendarSegmentId || null);
      if (!sameSlot) {
        if (slot) throw new Error('自定义正文文件的槽位归属冲突：' + record.slotKey);
        merged.orphans[record.slotKey] = normalized;
        summary.unresolved += 1;
        return;
      }
      if (merged.records[record.slotKey]) summary.overwritten += 1;
      else summary.added += 1;
      merged.records[record.slotKey] = normalized;
      delete merged.orphans[record.slotKey];
      summary.imported += 1;
      if (normalized.baseBuiltinSha256 !== slot.bodySha256) summary.baseChanged += 1;
    }
    parsed.records.forEach(accept);
    (parsed.orphans || []).forEach(accept);
    return { store: normalizeTextOverrides(merged), summary: summary };
  }

  function calendarAndTimeMatches(state, activation) {
    if (!state || !state.date || !state.clockEndpoint || !Array.isArray(activation.windows)) return false;
    var segment = findCalendarSegment(state.date);
    return activation.windows.some(function (window) {
      if (!dateWindowMatches(state.date, window.dateWindow || window)) return false;
      var start = Number(window.startMinute);
      var end = Number(window.endMinute);
      if (window.relativeStart === 'sunset' && segment && segment.anchors) {
        var sunset = clockStringToMinutes(segment.anchors.sunset);
        if (sunset !== null) start = sunset;
      }
      return minuteWindowMatches(state.clockEndpoint.minutes, start, end);
    });
  }

  function evaluateConditionRule(packageItem, state, entries) {
    var activation = packageItem.activation || null;
    if (activation && activation.kind === 'date_window') {
      var dateMatched = anyDateWindowMatches(state.date, activation.windows);
      return {
        matched: dateMatched,
        reason: dateMatched ? 'derived_date_window' : null,
        trigger: dateMatched && state.date ? ((state.date.month || '') + '月' + (state.date.day || '')) : null,
        sourceField: 'date',
        derived: true
      };
    }
    if (activation && activation.kind === 'date_time_window') {
      var dateOkay = !Array.isArray(activation.windows) || activation.windows.length === 0 || anyDateWindowMatches(state.date, activation.windows);
      var endpoint = state.clockEndpoint;
      var timeOkay = endpoint && minuteWindowMatches(endpoint.minutes, activation.startMinute, activation.endMinute);
      return {
        matched: Boolean(dateOkay && timeOkay),
        reason: dateOkay && timeOkay ? 'derived_date_time_window' : null,
        trigger: dateOkay && timeOkay ? ((state.date ? state.date.month + '月' : '') + String(endpoint.hour).padStart(2, '0') + ':' + String(endpoint.minute).padStart(2, '0')) : null,
        sourceField: 'clockEndpoint',
        derived: true
      };
    }
    if (activation && activation.kind === 'calendar_and_time') {
      var calendarTimeMatched = calendarAndTimeMatches(state, activation);
      return {
        matched: calendarTimeMatched,
        reason: calendarTimeMatched ? 'derived_calendar_and_time' : null,
        trigger: calendarTimeMatched && state.clockEndpoint ? (state.date.month + '月 ' + String(state.clockEndpoint.hour).padStart(2, '0') + ':' + String(state.clockEndpoint.minute).padStart(2, '0')) : null,
        sourceField: 'clockEndpoint',
        derived: true
      };
    }
    if (activation && activation.kind === 'calendar_variant') {
      var calendarVariantBody = resolveRuntimeBody(packageItem, state);
      return {
        matched: Boolean(state.date && calendarVariantBody),
        reason: state.date && calendarVariantBody ? 'derived_calendar_variant' : null,
        trigger: state.date && calendarVariantBody ? (state.date.month + '月' + (state.date.day || '')) : null,
        sourceField: 'date',
        derived: true
      };
    }
    if (activation && activation.kind === 'calendar_and_clock_variant') {
      var segment = findCalendarSegment(state.date);
      var daylightRange = segment && Array.isArray(segment.daylightRanges) ? segment.daylightRanges.find(function (item) { return item.packageId === packageItem.id; }) : null;
      var rangeStart = daylightRange ? clockStringToMinutes(daylightRange.start) : null;
      var rangeEndRaw = daylightRange ? clockStringToMinutes(daylightRange.end) : null;
      var rangeEnd = rangeEndRaw === null ? null : rangeEndRaw + 1;
      var daylightMatched = Boolean(state.clockEndpoint && rangeStart !== null && rangeEnd !== null && minuteWindowMatches(state.clockEndpoint.minutes, rangeStart, rangeEnd));
      return {
        matched: daylightMatched,
        reason: daylightMatched ? 'derived_daylight_range' : null,
        trigger: daylightMatched ? (state.date.month + '月 ' + String(state.clockEndpoint.hour).padStart(2, '0') + ':' + String(state.clockEndpoint.minute).padStart(2, '0')) : null,
        sourceField: 'clockEndpoint',
        derived: true
      };
    }
    if (activation && activation.kind === 'explicit_weather') {
      var weatherTypes = activation.weatherTypes || [];
      var weatherMatched = Boolean(state.weather && weatherTypes.includes(state.weather.type));
      return {
        matched: weatherMatched,
        reason: weatherMatched ? 'restored_weather_state' : null,
        trigger: weatherMatched ? state.weather.trigger : null,
        sourceField: 'weather',
        derived: false
      };
    }
    var explicitEntry = entries.find(function (entry) {
      return hasAnyTrigger(entry.text, packageItem.directTriggers || []);
    });
    var explicitTrigger = explicitEntry ? findTrigger(entryText(explicitEntry), packageItem.directTriggers || []) : null;
    return { matched: Boolean(explicitEntry), reason: explicitEntry ? 'direct' : null, trigger: explicitTrigger, entry: explicitEntry || null, derived: false };
  }

  function entryText(entry) {
    return entry && entry.text ? entry.text : '';
  }

  function normalizeMessage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var role = raw.role;
    if (!role) {
      if (raw.is_user === true) role = 'user';
      else if (raw.is_user === false) role = 'assistant';
    }
    if (role === 'ai') role = 'assistant';
    if (role !== 'user' && role !== 'assistant') return null;
    var text = raw.mes;
    if (text === undefined) text = raw.message;
    if (text === undefined) text = raw.content;
    if (Array.isArray(text)) {
      text = text.map(function (part) {
        return typeof part === 'string' ? part : (part && part.text ? part.text : '');
      }).join('');
    }
    var hidden = Boolean(raw.is_hidden || raw.hidden || raw.is_system);
    return { role: role, text: text === undefined ? '' : String(text), hidden: hidden };
  }

  function normalizeMessages(rawMessages) {
    if (!Array.isArray(rawMessages)) return [];
    return rawMessages.map(function (raw, index) {
      var item = normalizeMessage(raw);
      if (item) item.messageIndex = index;
      return item;
    }).filter(function (item) {
      return item && !item.hidden;
    });
  }

  function channelPackages(layer) {
    return DATA.packages.filter(function (item) {
      return item.layer === layer && item.matchMode === 'direct';
    });
  }

  function hasChannelSignal(value, layer) {
    var text = value || '';
    if (channelPackages(layer).some(function (item) {
      return hasAnyTrigger(text, item.directTriggers) || hasAnyTrigger(text, item.conditionalTriggers);
    })) return true;
    if (layer === 'TN') {
      return Boolean(parseDateState(text) || parseTimeRangeState(text) || parseWeatherState(text));
    }
    return false;
  }

  function structuredLocationField(value) {
    var text = value === null || value === undefined ? '' : String(value);
    var pattern = /(?:^|\n)\s*(?:[-*]\s*)?地点\s*[:：]\s*([^\n\r]*)/gu;
    var match;
    var latest = null;
    while ((match = pattern.exec(text)) !== null) {
      latest = String(match[1] || '').trim();
    }
    return latest;
  }

  function selectChannelText(rawText, layer, isCurrentUser, settings) {
    var channel = settings.channelTags[layer];
    if (isCurrentUser) {
      var current = extractCurrentUserSelection(rawText, settings.currentUserBoundary);
      return {
        text: stripExcludedTags(current.text, channel.excluded),
        path: current.path,
        tagNames: current.tagNames,
        hasPriorityTags: false,
        locationBoundary: null
      };
    }
    // D145_STRICT_PRIORITY_TAGS：同一AI楼层只要存在本通道的优先标签，就绝不回退到标签外正文。
    var priorityBodies = extractTagBodiesDetailed(rawText, channel.priority);
    if (priorityBodies.length) {
      var priorityText = stripExcludedTags(priorityBodies.map(function (item) { return item.text; }).join('\n'), channel.excluded);
      return {
        text: priorityText,
        path: 'priority',
        tagNames: Array.from(new Set(priorityBodies.map(function (item) { return item.tagName; }))),
        hasPriorityTags: true,
        locationBoundary: structuredLocationField(priorityText)
      };
    }
    return {
      text: stripExcludedTags(String(rawText || ''), channel.excluded),
      path: 'visible',
      tagNames: [],
      hasPriorityTags: false,
      locationBoundary: null
    };
  }

  function collectChannelEntries(rawMessages, layer, depth, requestType, rawSettings) {
    var settings = normalizeSettings(rawSettings || DATA.defaultSettings);
    var messages = normalizeMessages(rawMessages);
    var latestUserIndex = -1;
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        latestUserIndex = index;
        break;
      }
    }
    var entries = [];
    if (latestUserIndex >= 0) {
      var current = selectChannelText(messages[latestUserIndex].text, layer, true, settings);
      entries.push({
        text: current.text,
        path: current.path,
        tagNames: current.tagNames,
        source: 'current_user',
        historyIndex: 0,
        messageIndex: messages[latestUserIndex].messageIndex,
        hasPriorityTags: current.hasPriorityTags,
        locationBoundary: current.locationBoundary
      });
    }
    var assistants = [];
    if (requestType === 'continue' && latestUserIndex >= 0) {
      for (var after = messages.length - 1; after > latestUserIndex; after -= 1) {
        if (messages[after].role === 'assistant') assistants.push({ item: messages[after] });
      }
    }
    var beforeStart = latestUserIndex >= 0 ? latestUserIndex - 1 : messages.length - 1;
    for (var before = beforeStart; before >= 0; before -= 1) {
      if (messages[before].role === 'assistant') assistants.push({ item: messages[before] });
    }
    assistants.slice(0, Math.max(0, depth)).forEach(function (record, historyIndex) {
      var selected = selectChannelText(record.item.text, layer, false, settings);
      entries.push({
        text: selected.text,
        path: selected.path,
        tagNames: selected.tagNames,
        source: 'assistant_history',
        historyIndex: historyIndex + 1,
        messageIndex: record.item.messageIndex,
        hasPriorityTags: selected.hasPriorityTags,
        locationBoundary: selected.locationBoundary
      });
    });
    return entries;
  }

  function resolveTimeStateDetailed(entries) {
    var state = { date: null, timeRange: null, clockEndpoint: null, weather: null };
    var sources = {};
    var inspected = [];
    entries.forEach(function (entry) {
      inspected.push(entry);
      var parsedDate = !state.date ? parseDateState(entry.text) : null;
      var parsedTimeRange = !state.timeRange ? parseTimeRangeState(entry.text) : null;
      var parsedWeather = !state.weather ? parseWeatherState(entry.text) : null;
      if (parsedDate) { state.date = parsedDate; sources.date = entry; }
      if (parsedTimeRange) {
        state.timeRange = parsedTimeRange;
        state.clockEndpoint = Object.assign({}, parsedTimeRange.endPoint);
        sources.timeRange = entry;
        sources.clockEndpoint = entry;
      }
      if (parsedWeather) { state.weather = parsedWeather; sources.weather = entry; }
    });
    return { state: state, sources: sources, inspected: inspected };
  }

  function resolveTimeState(entries) {
    return resolveTimeStateDetailed(entries).state;
  }

  function exactTagSignature(left, right) {
    var leftList = normalizeTagList(left);
    var rightList = normalizeTagList(right);
    return leftList.length === rightList.length && leftList.every(function (value, index) {
      return value === rightList[index];
    });
  }

  function normalizeSettings(input) {
    var defaults = clone(DATA.defaultSettings);
    var value = input && typeof input === 'object' ? input : {};
    var sourceSchemaVersion = Number.isFinite(Number(value.schemaVersion)) ? Number(value.schemaVersion) : 0;
    var migration = DATA.settingsMigration && DATA.settingsMigration.legacyV2 ? DATA.settingsMigration.legacyV2 : null;
    defaults.masterEnabled = typeof value.masterEnabled === 'boolean' ? value.masterEnabled : defaults.masterEnabled;
    defaults.namedPlaceBodiesEnabled = typeof value.namedPlaceBodiesEnabled === 'boolean'
      ? value.namedPlaceBodiesEnabled : defaults.namedPlaceBodiesEnabled;
    defaults.diagnostics = typeof value.diagnostics === 'boolean' ? value.diagnostics : defaults.diagnostics;
    defaults.textScript = value.textScript === 'traditional' ? 'traditional' : 'simplified';
    if (Object.prototype.hasOwnProperty.call(DATA.wrappers, value.wrapperMode)) {
      defaults.wrapperMode = value.wrapperMode;
    }
    var depthValue = value.historyDepth;
    if (!Number.isFinite(Number(depthValue)) && value.channelDepths && typeof value.channelDepths === 'object') {
      var legacyDepths = Object.keys(value.channelDepths).map(function (key) { return Number(value.channelDepths[key]); }).filter(Number.isFinite);
      if (legacyDepths.length) depthValue = Math.max.apply(null, legacyDepths);
    }
    if (Number.isFinite(Number(depthValue))) {
      defaults.historyDepth = Math.max(0, Math.floor(Number(depthValue)));
    }
    if (value.currentUserBoundary && typeof value.currentUserBoundary === 'object') {
      if (typeof value.currentUserBoundary.start === 'string') defaults.currentUserBoundary.start = value.currentUserBoundary.start.trim();
      if (typeof value.currentUserBoundary.end === 'string') defaults.currentUserBoundary.end = value.currentUserBoundary.end.trim();
    }
    ['TN', 'EX', 'IN', 'EV'].forEach(function (layer) {
      if (value.channelTags && value.channelTags[layer] && typeof value.channelTags[layer] === 'object') {
        if (Object.prototype.hasOwnProperty.call(value.channelTags[layer], 'priority')) {
          var sourcePriority = normalizeTagList(value.channelTags[layer].priority);
          var legacyPriority = migration && migration.exactPriorityByLayer ? migration.exactPriorityByLayer[layer] : null;
          defaults.channelTags[layer].priority = legacyPriority && exactTagSignature(sourcePriority, legacyPriority)
            ? clone(DATA.defaultSettings.channelTags[layer].priority)
            : sourcePriority;
        }
        if (Object.prototype.hasOwnProperty.call(value.channelTags[layer], 'excluded')) {
          var sourceExcluded = normalizeTagList(value.channelTags[layer].excluded);
          defaults.channelTags[layer].excluded = migration && exactTagSignature(sourceExcluded, migration.exactExcluded)
            ? clone(DATA.defaultSettings.channelTags[layer].excluded)
            : sourceExcluded;
        }
      }
      if (value.layers && typeof value.layers[layer] === 'boolean') {
        defaults.layers[layer] = value.layers[layer];
      }
    });
    Object.keys(defaults.groups).forEach(function (groupId) {
      if (value.groups && typeof value.groups[groupId] === 'boolean') {
        defaults.groups[groupId] = value.groups[groupId];
      }
    });
    DATA.packages.forEach(function (item) {
      if (value.packages && typeof value.packages[item.id] === 'boolean') {
        defaults.packages[item.id] = value.packages[item.id];
      }
    });
    // LJ001-V3-SETTINGS-MIGRATION：旧单篇 group&&package 只折叠一次，新 schema 中只保留叶开关为有效值。
    (DATA.controlGroups || []).filter(function (group) {
      return group && group.mode === 'singleton' && group.canonicalPackageId;
    }).forEach(function (group) {
      var groupId = group.controlGroupId;
      var packageId = group.canonicalPackageId;
      if (sourceSchemaVersion < Number(DATA.defaultSettings.schemaVersion || 4)) {
        var legacyGroupId = group.legacyGroupId || groupId;
        var legacyGroupEnabled = !(value.groups && value.groups[legacyGroupId] === false);
        var legacyPackageEnabled = !(value.packages && value.packages[packageId] === false);
        defaults.packages[packageId] = legacyGroupEnabled && legacyPackageEnabled;
      }
      defaults.groups[groupId] = true;
    });
    defaults.schemaVersion = DATA.defaultSettings.schemaVersion;
    return defaults;
  }

  function normalizePoint(input) {
    if (!input || typeof input !== 'object') return null;
    var x = Number(input.x);
    var y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function normalizeFabDockEdge(input) {
    return /^(?:left|right|top|bottom)$/u.test(String(input || '')) ? String(input) : null;
  }

  function normalizePanelGeometry(input) {
    var point = normalizePoint(input);
    var width = input && Number(input.width);
    var height = input && Number(input.height);
    if (!point || !Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      x: point.x,
      y: point.y,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    };
  }

  function normalizePanelLayoutMode(input) {
    return input === 'vertical' ? 'vertical' : 'horizontal';
  }

  function normalizeStoredPanelGeometry(input, layout) {
    var geometry = normalizePanelGeometry(input);
    if (!geometry) return null;
    if (normalizePanelLayoutMode(layout) === 'vertical') {
      geometry.height = geometry.width * 2;
    } else {
      geometry.width = Math.max(8, Math.round(geometry.width / 8) * 8);
      geometry.height = geometry.width / 8 * 5;
    }
    return geometry;
  }

  function normalizePanelGeometrySlots(input, legacyLayoutMode) {
    var slots = { horizontal: null, vertical: null };
    var value = input && typeof input === 'object' ? input : null;
    var hasSlots = Boolean(value && (
      Object.prototype.hasOwnProperty.call(value, 'horizontal')
      || Object.prototype.hasOwnProperty.call(value, 'vertical')
    ));
    if (hasSlots) {
      slots.horizontal = normalizeStoredPanelGeometry(value.horizontal, 'horizontal');
      slots.vertical = normalizeStoredPanelGeometry(value.vertical, 'vertical');
      return slots;
    }
    var legacyLayout = normalizePanelLayoutMode(legacyLayoutMode);
    var legacy = normalizeStoredPanelGeometry(value, legacyLayout);
    if (legacy) slots[legacyLayout] = legacy;
    return slots;
  }

  function emptyTransitFavoritePlaces() {
    return {
      schemaVersion: 1,
      slots: ['favorite_1', 'favorite_2', 'favorite_3'].map(function (slotId) {
        return { slotId: slotId, displayName: '', endpoint: null };
      })
    };
  }

  // LJ001-TRANSIT-FAVORITES：旧复合片区只留为 stale 待重选，不静默猜成某一站。
  function normalizeTransitFavoritePlaces(input) {
    var source = input && typeof input === 'object' ? input : {};
    var sourceSlots = Array.isArray(source.slots) ? source.slots : [];
    var normalized = emptyTransitFavoritePlaces();
    normalized.slots = normalized.slots.map(function (fallback) {
      var candidate = sourceSlots.find(function (item) {
        return item && String(item.slotId || '') === fallback.slotId;
      });
      if (!candidate || typeof candidate !== 'object') return fallback;
      var endpoint = candidate.endpoint && typeof candidate.endpoint === 'object' ? candidate.endpoint : null;
      var type = endpoint ? String(endpoint.type || '').trim() : '';
      var id = endpoint ? String(endpoint.id || '').trim() : '';
      if (type === 'object') {
        var contentPlace = (DATA.places || []).find(function (place) {
          return place && place.kind === 'content_object' && (place.sourceObjectId === id || place.placeId === id);
        });
        if (contentPlace) type = 'content_object';
      }
      var normalizedEndpoint = null;
      if (/^(?:station|content_object)$/u.test(type) && id) {
        normalizedEndpoint = { type: type, id: id };
      } else if (type === 'area' && id) {
        normalizedEndpoint = { type: 'area', id: id, stale: true, reason: 'legacy_area_requires_reselection' };
      }
      return {
        slotId: fallback.slotId,
        displayName: String(candidate.displayName || '').trim(),
        endpoint: normalizedEndpoint
      };
    });
    return normalized;
  }

  // LJ001-V35-THEME: one appearance preference drives the complete panel without changing content.
  function resolveUITheme(view, doc, preference) {
    if (preference === 'day' || preference === 'night') return preference;
    var color = '';
    if (view && typeof view.getComputedStyle === 'function' && doc && doc.body) {
      var style = view.getComputedStyle(doc.body);
      color = String(style.getPropertyValue('--SmartThemeBodyColor') || style.color || '').trim();
    }
    var rgb = null;
    var hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/iu);
    if (hex) {
      var digits = hex[1].length === 3 ? hex[1].split('').map(function (part) { return part + part; }).join('') : hex[1];
      rgb = [0, 2, 4].map(function (index) { return parseInt(digits.slice(index, index + 2), 16); });
    } else if (/^rgba?\(/iu.test(color)) rgb = (color.match(/[\d.]+/gu) || []).slice(0, 3).map(Number);
    if (rgb && rgb.length === 3) return (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) / 255 > .55 ? 'night' : 'day';
    return view && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  }

  function normalizeUIPreferences(input) {
    var defaults = clone(DATA.defaultUIPreferences || {
      schemaVersion: PANEL_UI_SCHEMA_VERSION,
      sakuraFabPosition: null,
      sakuraFabDockEdge: null,
      panelGeometry: { horizontal: null, vertical: null },
      panelLayoutMode: 'horizontal',
      onboardingDismissed: false,
      panelPinned: false,
      uiThemePreference: 'auto',
      transitFavoritePlaces: emptyTransitFavoritePlaces()
    });
    var value = input && typeof input === 'object' ? input : {};
    var fallbackMode = normalizePanelLayoutMode(defaults.panelLayoutMode);
    var sourceMode = Object.prototype.hasOwnProperty.call(value, 'panelLayoutMode')
      ? value.panelLayoutMode : fallbackMode;
    defaults.schemaVersion = PANEL_UI_SCHEMA_VERSION;
    defaults.sakuraFabPosition = normalizePoint(value.sakuraFabPosition);
    defaults.sakuraFabDockEdge = normalizeFabDockEdge(value.sakuraFabDockEdge);
    defaults.panelLayoutMode = normalizePanelLayoutMode(sourceMode);
    defaults.panelGeometry = normalizePanelGeometrySlots(
      Object.prototype.hasOwnProperty.call(value, 'panelGeometry') ? value.panelGeometry : defaults.panelGeometry,
      sourceMode
    );
    defaults.onboardingDismissed = typeof value.onboardingDismissed === 'boolean'
      ? value.onboardingDismissed : defaults.onboardingDismissed;
    defaults.panelPinned = typeof value.panelPinned === 'boolean' ? value.panelPinned : defaults.panelPinned;
    defaults.uiThemePreference = ['auto', 'day', 'night'].includes(value.uiThemePreference) ? value.uiThemePreference : 'auto';
    defaults.transitFavoritePlaces = normalizeTransitFavoritePlaces(
      Object.prototype.hasOwnProperty.call(value, 'transitFavoritePlaces')
        ? value.transitFavoritePlaces : defaults.transitFavoritePlaces
    );
    return defaults;
  }

  function resetInterfacePreferences(input) {
    var next = normalizeUIPreferences(input);
    next.sakuraFabPosition = null;
    next.sakuraFabDockEdge = null;
    next.panelGeometry = { horizontal: null, vertical: null };
    next.panelLayoutMode = 'horizontal';
    next.panelPinned = false;
    return next;
  }

  function viewportBox(view, doc) {
    var visual = view && view.visualViewport;
    var width = visual && Number.isFinite(Number(visual.width)) ? Number(visual.width)
      : (view && Number.isFinite(Number(view.innerWidth)) ? Number(view.innerWidth) : Number(doc && doc.documentElement && doc.documentElement.clientWidth) || 1024);
    var height = visual && Number.isFinite(Number(visual.height)) ? Number(visual.height)
      : (view && Number.isFinite(Number(view.innerHeight)) ? Number(view.innerHeight) : Number(doc && doc.documentElement && doc.documentElement.clientHeight) || 768);
    var left = visual && Number.isFinite(Number(visual.offsetLeft)) ? Number(visual.offsetLeft) : 0;
    var top = visual && Number.isFinite(Number(visual.offsetTop)) ? Number(visual.offsetTop) : 0;
    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
  }

  function detectPanelDevice(view, doc) {
    var navigatorValue = view && view.navigator ? view.navigator
      : (typeof navigator !== 'undefined' ? navigator : null);
    var userAgentData = navigatorValue && navigatorValue.userAgentData;
    if (userAgentData && userAgentData.mobile === true) return 'mobile';
    var userAgent = String(navigatorValue && navigatorValue.userAgent || '');
    if (/(?:Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile)/iu.test(userAgent)) return 'mobile';
    var platform = String(navigatorValue && navigatorValue.platform || '');
    var touchPoints = Number(navigatorValue && navigatorValue.maxTouchPoints) || 0;
    if (/MacIntel/iu.test(platform) && touchPoints > 1) return 'mobile';
    return 'desktop';
  }

  function isMobilePanelViewport(view, doc) {
    return detectPanelDevice(view, doc) === 'mobile';
  }

  function clampFloatingPoint(point, box, width, height, margin) {
    var gap = Number.isFinite(Number(margin)) ? Number(margin) : 10;
    var itemWidth = Math.max(1, Number(width) || 58);
    var itemHeight = Math.max(1, Number(height) || 58);
    var minX = box.left + gap;
    var minY = box.top + gap;
    var maxX = Math.max(minX, box.left + box.width - itemWidth - gap);
    var maxY = Math.max(minY, box.top + box.height - itemHeight - gap);
    return {
      x: Math.round(Math.min(maxX, Math.max(minX, Number(point && point.x) || minX))),
      y: Math.round(Math.min(maxY, Math.max(minY, Number(point && point.y) || minY)))
    };
  }

  function panelLayoutSpec(layout) {
    if (normalizePanelLayoutMode(layout) === 'vertical') {
      return {
        layout: 'vertical',
        aspectRatio: 1 / 2,
        minWidth: 320,
        minHeight: 640,
        emergencyMinWidth: 280,
        emergencyMinHeight: 560,
        compactWidth: 340,
        compactHeight: 640
      };
    }
    return {
      layout: 'horizontal',
      aspectRatio: 16 / 10,
      minWidth: 800,
      minHeight: 500,
      emergencyMinWidth: 560,
      emergencyMinHeight: 350,
      compactWidth: 1000,
      compactHeight: 640
    };
  }

  function panelAvailableBox(box, margin) {
    var source = box && typeof box === 'object' ? box : {};
    var gap = Number.isFinite(Number(margin)) ? Math.max(0, Number(margin)) : 12;
    var left = Number.isFinite(Number(source.left)) ? Number(source.left) : 0;
    var top = Number.isFinite(Number(source.top)) ? Number(source.top) : 0;
    var width = Math.max(1, Number(source.width) || 1);
    var height = Math.max(1, Number(source.height) || 1);
    return {
      gap: gap,
      left: left + gap,
      top: top + gap,
      width: Math.max(1, width - gap * 2),
      height: Math.max(1, height - gap * 2)
    };
  }

  function fitPanelDimensions(requestedWidth, requestedHeight, availableWidth, availableHeight, layout) {
    var spec = panelLayoutSpec(layout);
    var maxWidth = Math.max(1, Math.min(Number(availableWidth) || 1, (Number(availableHeight) || 1) * spec.aspectRatio));
    var widthValue = Number(requestedWidth);
    if (!Number.isFinite(widthValue) || widthValue <= 0) {
      var heightValue = Number(requestedHeight);
      widthValue = Number.isFinite(heightValue) && heightValue > 0 ? heightValue * spec.aspectRatio : spec.minWidth;
    }
    var minimumWidth = maxWidth >= spec.minWidth ? spec.minWidth : maxWidth;
    var boundedWidth = Math.min(maxWidth, Math.max(minimumWidth, widthValue));
    var width;
    var height;
    if (spec.layout === 'vertical') {
      width = Math.max(1, Math.floor(boundedWidth));
      height = width * 2;
    } else {
      var maxUnits = Math.max(1, Math.floor(maxWidth / 8));
      var minUnits = maxWidth >= spec.minWidth ? Math.ceil(spec.minWidth / 8) : 1;
      var requestedUnits = Math.max(1, Math.round(boundedWidth / 8));
      var units = Math.min(maxUnits, Math.max(Math.min(minUnits, maxUnits), requestedUnits));
      width = units * 8;
      height = units * 5;
    }
    if (height > availableHeight || width > availableWidth) {
      var fallbackWidth = Math.max(1, Math.min(Number(availableWidth) || 1, (Number(availableHeight) || 1) * spec.aspectRatio));
      if (spec.layout === 'vertical') {
        width = Math.max(1, Math.floor(fallbackWidth));
        height = width * 2;
      } else {
        var fallbackUnits = Math.max(1, Math.floor(fallbackWidth / 8));
        width = fallbackUnits * 8;
        height = fallbackUnits * 5;
      }
    }
    return { width: width, height: height };
  }

  function clampPanelGeometry(geometry, box, margin, layout) {
    if (!geometry) return null;
    var available = panelAvailableBox(box, margin);
    var size = fitPanelDimensions(geometry.width, geometry.height, available.width, available.height, layout);
    var maxX = Math.max(available.left, available.left + available.width - size.width);
    var maxY = Math.max(available.top, available.top + available.height - size.height);
    var sourceX = Number(geometry.x);
    var sourceY = Number(geometry.y);
    var fallbackX = available.left + Math.max(0, (available.width - size.width) / 2);
    var fallbackY = available.top + Math.max(0, (available.height - size.height) / 2);
    return {
      x: Math.round(Math.min(maxX, Math.max(available.left, Number.isFinite(sourceX) ? sourceX : fallbackX))),
      y: Math.round(Math.min(maxY, Math.max(available.top, Number.isFinite(sourceY) ? sourceY : fallbackY))),
      width: size.width,
      height: size.height
    };
  }

  function createDefaultPanelGeometry(layout, box, margin) {
    var normalizedLayout = normalizePanelLayoutMode(layout);
    var available = panelAvailableBox(box, margin);
    var spec = panelLayoutSpec(normalizedLayout);
    var maxWidth = Math.max(1, Math.min(available.width, available.height * spec.aspectRatio));
    var requestedWidth = normalizedLayout === 'vertical' ? Math.min(430, maxWidth) : Math.min(1240, maxWidth);
    var requestedHeight = requestedWidth / spec.aspectRatio;
    return clampPanelGeometry({
      x: normalizedLayout === 'vertical'
        ? available.left + Math.max(0, available.width - requestedWidth)
        : available.left + Math.max(0, (available.width - requestedWidth) / 2),
      y: available.top + Math.max(0, (available.height - requestedHeight) / 2),
      width: requestedWidth,
      height: requestedHeight
    }, box, margin, normalizedLayout);
  }

  function resizePanelGeometry(origin, dx, dy, box, margin, layout) {
    if (!origin) return null;
    var normalizedLayout = normalizePanelLayoutMode(layout);
    var spec = panelLayoutSpec(normalizedLayout);
    var current = clampPanelGeometry(origin, box, margin, normalizedLayout);
    if (!current) return null;
    var available = panelAvailableBox(box, margin);
    var x = Math.min(available.left + available.width - 1, Math.max(available.left, current.x));
    var y = Math.min(available.top + available.height - 1, Math.max(available.top, current.y));
    var maxWidth = Math.max(1, Math.min(
      available.left + available.width - x,
      (available.top + available.height - y) * spec.aspectRatio
    ));
    var moveX = Number.isFinite(Number(dx)) ? Number(dx) : 0;
    var moveY = Number.isFinite(Number(dy)) ? Number(dy) : 0;
    var deltaHeight = (moveX * spec.aspectRatio + moveY) / (spec.aspectRatio * spec.aspectRatio + 1);
    var requestedWidth = current.width + deltaHeight * spec.aspectRatio;
    var size = fitPanelDimensions(
      requestedWidth,
      current.height + deltaHeight,
      maxWidth,
      available.top + available.height - y,
      normalizedLayout
    );
    return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
  }

  function panelGeometryIsCompact(layout, geometry) {
    if (!geometry) return false;
    var spec = panelLayoutSpec(layout);
    return Number(geometry.width) < spec.compactWidth || Number(geometry.height) < spec.compactHeight;
  }

  function packageBlockReason(item, settings) {
    if (!settings.masterEnabled) return 'master_off';
    if (!settings.layers[item.layer]) return 'layer_off';
    if (item.sourceObjectId && settings.namedPlaceBodiesEnabled === false) return 'named_places_off';
    var controlPath = Array.isArray(item.controlGroupIds) && item.controlGroupIds.length
      ? item.controlGroupIds : [item.uiGroupId];
    var blockedGroupId = controlPath.find(function (groupId) { return settings.groups[groupId] === false; });
    if (blockedGroupId) return 'control_group_off:' + blockedGroupId;
    if (!settings.packages[item.id]) return 'package_off';
    return null;
  }

  function packageEnabled(item, settings) {
    return packageBlockReason(item, settings) === null;
  }

  function dateStateKey(date) {
    if (!date || !Number.isFinite(Number(date.year)) || !Number.isFinite(Number(date.month)) || !Number.isFinite(Number(date.day))) return null;
    return Number(date.year) * 10000 + Number(date.month) * 100 + Number(date.day);
  }

  function dateTextKey(value) {
    var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
  }

  function findDateConditionalTriggerDetailed(text, rules, storyState) {
    // D145_DATE_BOUND_ALIAS：有明确故事日期时，才接受处于登记期限内的临时冠名。
    var current = dateStateKey(storyState && storyState.date);
    if (current === null) return null;
    var candidates = [];
    (rules || []).forEach(function (rule) {
      var start = dateTextKey(rule.startDate);
      var end = dateTextKey(rule.endDate);
      if (start === null || end === null || current < start || current > end) return;
      var found = findTriggerDetailed(text, rule.triggers || []);
      if (found) candidates.push(found);
    });
    if (!candidates.length) return null;
    return candidates.sort(function (left, right) {
      if (left.end !== right.end) return right.end - left.end;
      if (left.length !== right.length) return right.length - left.length;
      return right.index - left.index;
    })[0];
  }

  // LJ001-V31-KOKUDO-NUMBER: an explicit numbered road outranks a bare station-name fragment, even in its parent region.
  function stationRoadNameAllows(text, found) {
    if (!/^[国國]道$/u.test(normalizeText(found.trigger))) return true;
    var source = normalizeText(text);
    if (/^\s*(?:第\s*)?[0-9一二三四五六七八九十百千]+\s*[号號]/u.test(source.slice(found.end))) return false;
    var station = ((DATA.stationAdministration || {}).stations || []).find(function (record) { return record.railStationId === 'n02_station_004519'; });
    var aliases = (DATA.placeNameAliases || {}).administrativeNames || {};
    var parents = [];
    ((station && station.officialAdminPathsJa) || []).forEach(function (path) {
      path.forEach(function (name) {
        [name].concat(aliases[name] || []).forEach(function (form) { parents.push(form, form.replace(/[県县市区]$/u, '')); });
      });
    });
    return hasAnyTrigger(source, parents);
  }

  // LJ001-V3-STATION-NAME-GUARD: a station suffix must not borrow the verb in a person's standing action.
  function findNamedDirectTriggerDetailed(text, triggers, exclusions, item) {
    var source = normalizeText(text);
    var searchable = source;
    var found = findDirectTriggerDetailed(searchable, triggers, exclusions);
    if (item.placeKind !== 'station') return found;
    while (found) {
      if (!stationRoadNameAllows(source, found)) {
        searchable = source.slice(0, found.index);
        found = findDirectTriggerDetailed(searchable, triggers, exclusions);
        continue;
      }
      var matched = source.slice(found.index, found.end);
      var after = source.slice(found.end, found.end + 24);
      var standingTail = /站$/u.test(matched) ? after : /^站/u.test(after) ? after.slice(1) : null;
      var standingVerb = standingTail !== null && /^\s*(?:在|着|著|起|立|稳|穩|直|住|了(?:起来|起來))/u.test(standingTail);
      if (!standingVerb) return found;
      var before = source.slice(Math.max(0, found.index - 32), found.index);
      var strongDirection = /(?:前往|来到|來到|到达|到達|抵达|抵達|从|從)\s*[:：]?\s*$/u.test(before) ||
        (/到(?:了)?\s*[:：]?\s*$/u.test(before) && !/(?:看|见|見|想|听|聽|提|注意)到(?:了)?\s*[:：]?\s*$/u.test(before));
      if (strongDirection) return found;
      searchable = source.slice(0, found.index);
      found = findDirectTriggerDetailed(searchable, triggers, exclusions);
    }
    return null;
  }

  function namedAliasContextAllows(text, found, item) {
    if (!found) return false;
    var source = normalizeText(text);
    var start = Math.max(0, Number(found.index) || 0);
    var end = Math.max(start, Number(found.end) || start);
    var pre = source.slice(Math.max(0, start - 32), start);
    var post = source.slice(end, Math.min(source.length, end + 32));
    pre = pre.slice(Math.max(pre.lastIndexOf('，'), pre.lastIndexOf(','), pre.lastIndexOf('。'), pre.lastIndexOf('\n'), pre.lastIndexOf('；'), pre.lastIndexOf(';')) + 1);
    var postStops = ['，', ',', '。', '\n', '；', ';'];
    var stop = postStops.map(function (token) { return post.indexOf(token); }).filter(function (index) { return index >= 0; }).sort(function (left, right) { return left - right; })[0];
    if (Number.isFinite(stop)) post = post.slice(0, stop);
    if (item.placeKind === 'station' && !/[站駅]$/u.test(normalizeText(found.trigger))) {
      var placeContinuation = /^\s*(?:站|駅|车站|車站|附近|周边|周邊|一带|一帶|区|區|市|町|村|街|的(?:车站|車站|站台|月台|站口))/u.test(post);
      var nameContinues = /^\s*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(post);
      var trafficContext = /(?:车站|車站|电车|電車|火车|火車|列车|列車|地铁|地鐵|地下鉄|铁路|鐵路|站台|月台|出站|进站|進站|换乘|換乘|转乘|轉乘|乘车|乘車|上车|上車|下车|下車|站口|駅)/u.test(source.slice(Math.max(0, start - 32), Math.min(source.length, end + 32)));
      if (!placeContinuation && (nameContinues || !trafficContext)) return false;
    }
    if (/(?:去(?:了)?|到(?:了)?|在|从|從|往|向|回到?|返回|前往|来到|來到|抵达|抵達|路过|路過|经过|經過|逛到|住在|搬到|位于|位於|进入|進入|离开|離開|走进|走進|身处|身處|地点(?:是)?|地點(?:是)?|场景(?:在|是)?|場景(?:在|是)?|目的地(?:是)?|约在|約在)\s*[:：]?\s*$/u.test(pre)) return true;
    if(/^\s*(?:附近|周边|周邊|一带|一帶|门口|門口|里面|裡面|内部|內部|外面|站|区|區|市|町|村|街|公园|公園|店|馆|館|楼|樓|城|园|園|看展|看电影|看電影|演出|比赛|比賽|逛|玩|旅行|散步|约会|約會|观光|觀光|吃|喝|的(?:店|馆|館|楼|樓|公园|公園|入口|出口|附近|内部|內部))/u.test(post)) return true;
    var related = [];
    (item.links || []).forEach(function (id) {
      var parent = getPackageById(id);
      if (parent) related = related.concat(parent.directTriggers || []);
    });
    (DATA.regionMarkers || []).forEach(function (region) { related = related.concat(region.triggers || []); });
    return hasAnyTrigger(pre + '◇' + post, related);
  }

  function directMatchesForEntry(entry, layer, storyState) {
    var result = [];
    channelPackages(layer).forEach(function (item) {
      var exclusions = (DATA.directTriggerExclusions || {})[item.id] || [];
      var namedIdentity = Boolean(item.sourceObjectId || item.placeKind === 'station');
      var fullFound = namedIdentity
        ? findNamedDirectTriggerDetailed(entry.text, item.fullTriggers || [], exclusions, item)
        : null;
      var aliasFound = fullFound ? null : findNamedDirectTriggerDetailed(entry.text, item.aliasTriggers && item.aliasTriggers.length
        ? item.aliasTriggers : (item.directTriggers || []), exclusions, item);
      if (namedIdentity && aliasFound && !namedAliasContextAllows(entry.text, aliasFound, item)) aliasFound = null;
      var found = fullFound || aliasFound;
      var reason = 'direct';
      if (!found) {
        found = findDateConditionalTriggerDetailed(entry.text, item.dateConditionalTriggers || [], storyState);
        if (found) reason = 'date_conditional_direct';
      }
      if (found) {
        result.push({
          item: item,
          trigger: found.trigger,
          reason: reason,
          entry: entry,
          position: found.index,
          triggerEnd: found.end,
          triggerLength: found.length,
          triggerTier: fullFound ? 'full' : (namedIdentity ? 'alias' : 'standard')
        });
      }
    });
    var sharedRegionalAliases = {};
    result.forEach(function (match) {
      if (!match.item.regionId) return;
      var key = normalizeText(match.trigger) + '|' + match.position + '|' + match.triggerEnd;
      if (!sharedRegionalAliases[key]) sharedRegionalAliases[key] = [];
      sharedRegionalAliases[key].push(match);
    });
    Object.keys(sharedRegionalAliases).forEach(function (key) {
      var candidates = sharedRegionalAliases[key];
      var regions = Array.from(new Set(candidates.map(function (match) { return match.item.regionId; })));
      if (regions.length < 2) return;
      var qualifierText = entry.text.slice(0, Math.max(0, candidates[0].position));
      var nearestRegion = findNearestRegionDetailed(qualifierText);
      if (!nearestRegion || !nearestRegion.regionId) return;
      result = result.filter(function (match) {
        return !candidates.includes(match) || match.item.regionId === nearestRegion.regionId;
      });
    });
    return result.sort(function (left, right) {
      if (left.triggerEnd !== right.triggerEnd) return right.triggerEnd - left.triggerEnd;
      if (left.triggerLength !== right.triggerLength) return right.triggerLength - left.triggerLength;
      if (left.position !== right.position) return right.position - left.position;
      return left.item.order - right.item.order;
    });
  }

  function findNearestRegionDetailed(text) {
    var candidates = [];
    (DATA.regionMarkers || []).forEach(function (region) {
      var found = findTriggerDetailed(text, region.triggers || []);
      if (found) candidates.push(Object.assign({ regionId: region.regionId, sourceKind: 'region_marker' }, found));
    });
    DATA.packages.filter(function (item) {
      return item.layer === 'EX' && item.regionId && Array.isArray(item.directTriggers) && item.directTriggers.length;
    }).forEach(function (item) {
      var found = findTriggerDetailed(text, item.directTriggers);
      if (found) candidates.push(Object.assign({
        regionId: item.regionId,
        sourceKind: 'external_package',
        packageId: item.id,
        packageName: item.displayName
      }, found));
    });
    if (!candidates.length) return null;
    candidates.sort(function (left, right) {
      if (left.end !== right.end) return right.end - left.end;
      if (left.length !== right.length) return right.length - left.length;
      if (left.index !== right.index) return right.index - left.index;
      return String(left.regionId).localeCompare(String(right.regionId));
    });
    var best = candidates[0];
    var sameSpanRegions = Array.from(new Set(candidates.filter(function (item) {
      return item.index === best.index && item.length === best.length;
    }).map(function (item) { return item.regionId; })));
    return Object.assign({}, best, {
      regionId: sameSpanRegions.length === 1 ? best.regionId : null,
      ambiguousRegionIds: sameSpanRegions.length > 1 ? sameSpanRegions : []
    });
  }

  function conditionalReferencesForEntry(entry, layer) {
    var result = {};
    channelPackages(layer).forEach(function (item) {
      var trigger = findTrigger(entry.text, item.conditionalTriggers);
      if (trigger) result[item.id] = { trigger: trigger, entry: entry };
    });
    return result;
  }

  function resolveNonTimeChannel(entries, layer, storyState) {
    var inspected = [];
    var references = {};
    var pendingComposite = null;
    var pendingFallback = null;
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      inspected.push(entry);
      var entryReferences = conditionalReferencesForEntry(entry, layer);
      Object.keys(entryReferences).forEach(function (id) {
        if (!references[id]) references[id] = entryReferences[id];
      });
      var matches = directMatchesForEntry(entry, layer, storyState);
      var compositeCores = channelPackages(layer).map(function (item) {
        if (!item.locationComposite || !Array.isArray(item.locationComposite.cores)) return null;
        var core = findTriggerDetailed(entry.text, item.locationComposite.cores);
        // LJ001-V31-REVIEWED-BRANCH: complete names own their span; an explicit unavailable branch must not become another local store.
        if (core && item.locationComposite.reviewedBranch) {
          if (matches.some(function (match) { return match.triggerTier === 'full' && match.position <= core.index && match.triggerEnd >= core.end; })) return null;
          var normalizedEntry = normalizeText(entry.text);
          if (/[a-z0-9]/u.test(normalizedEntry.charAt(core.index - 1)) || /[a-z0-9]/u.test(normalizedEntry.charAt(core.end))) return null;
          if (/^\s*(?:\(\s*)?[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-z0-9·・_ -]{1,20}(?:本店|分店|店)/u.test(normalizedEntry.slice(core.end))) return null;
        }
        return core ? { item: item, core: core, entry: entry, entryIndex: index } : null;
      }).filter(Boolean).sort(function (left, right) {
        return right.core.index - left.core.index;
      });
      if (!pendingComposite && compositeCores.length) {
        pendingComposite = compositeCores[0];
        pendingFallback = matches.slice();
      }
      if (pendingComposite) {
        var qualifiers = pendingComposite.item.locationComposite.qualifiers || [];
        var qualifierText = entry === pendingComposite.entry
          ? entry.text.slice(0, Math.max(0, pendingComposite.core.index))
          : entry.text;
        var regionalText = qualifierText;
        if (pendingComposite.item.locationComposite.reviewedBranch) {
          var localText = normalizeText(pendingComposite.entry.text);
          var localBefore = localText.slice(0, pendingComposite.core.index).replace(/^[\s\S]*[。！？!?；;\n“”「」『』"]/u, '');
          regionalText = localBefore;
          var colon = Math.max(localBefore.lastIndexOf(':'), localBefore.lastIndexOf('：'));
          if (colon >= 0 && !qualifiers.some(function (value) { return normalizeText(value) === localBefore.slice(0, colon).trim(); })) localBefore = localBefore.slice(colon + 1);
          var localAfter = localText.slice(pendingComposite.core.end).split(/[。！？!?；;\n“”「」『』"]/u)[0];
          var statedArea = /^\s*(?:\(([^)]{1,40})\)|(?:[,，]\s*)?(?:地点|地點)(?:是|为|為)?\s*[:：]?\s*([^，,]{1,40})|(?:在|位于|位於)\s*([^，,]{1,40}))/u.exec(localAfter);
          qualifierText = statedArea ? (statedArea[1] || statedArea[2] || statedArea[3]) : localBefore;
        }
        var nearestRegion = findNearestRegionDetailed(regionalText) || (pendingComposite.item.locationComposite.reviewedBranch ? findNearestRegionDetailed(qualifierText) : null);
        var qualifier = findTriggerDetailed(qualifierText, qualifiers);
        var expectedRegionId = pendingComposite.item.locationComposite.regionId || null;
        // D145_COMPOSITE_QUALIFIER：明确限定词已经成立时，不再强求它本身还能被地域表单独识别；若前文出现了冲突地域，仍立即阻断。
        var compatibleRegion = !expectedRegionId || !nearestRegion || nearestRegion.regionId === expectedRegionId;
        if (qualifier && compatibleRegion) {
          var compositeMatch = {
            item: pendingComposite.item,
            trigger: qualifier.trigger + ' + ' + pendingComposite.core.trigger,
            reason: 'composite_location',
            entry: pendingComposite.entry,
            position: pendingComposite.core.index,
            triggerEnd: pendingComposite.core.end,
            compositeCore: pendingComposite.core.trigger,
            compositeCorePosition: pendingComposite.core.index,
            compositeCoreEnd: pendingComposite.core.end,
            compositeCoreEntry: pendingComposite.entry,
            compositeQualifier: qualifier.trigger,
            compositeQualifierPosition: qualifier.index,
            compositeQualifierEnd: qualifier.end,
            qualifierEntry: entry
          };
          var merged = [];
          (pendingFallback || []).concat([compositeMatch]).forEach(function (match) {
            if (!merged.some(function (existing) { return existing.item.id === match.item.id; })) merged.push(match);
          });
          merged.sort(function (left, right) {
            if ((left.triggerEnd || 0) !== (right.triggerEnd || 0)) return (right.triggerEnd || 0) - (left.triggerEnd || 0);
            if ((left.triggerLength || 0) !== (right.triggerLength || 0)) return (right.triggerLength || 0) - (left.triggerLength || 0);
            if ((left.position || 0) !== (right.position || 0)) return (right.position || 0) - (left.position || 0);
            return left.item.order - right.item.order;
          });
          return {
            matches: merged,
            inspected: inspected,
            stopReason: entry.source === 'current_user' ? 'current_complete_location_chain' : 'history_complete_location_chain',
            selectedEntry: pendingComposite.entry,
            qualifierEntry: entry
          };
        }
        if (pendingComposite.item.locationComposite.reviewedBranch) {
          return { matches: pendingFallback || [], inspected: inspected, stopReason: 'reviewed_branch_without_local_qualifier', selectedEntry: pendingComposite.entry };
        }
        var hasRegionalBarrier = Boolean(nearestRegion);
        if (hasRegionalBarrier) {
          return {
            matches: pendingFallback || [],
            inspected: inspected,
            stopReason: 'incompatible_region_barrier',
            selectedEntry: pendingComposite.entry,
            regionalBarrierEntry: entry,
            regionalBarrier: nearestRegion
          };
        }
        if ((layer === 'EX' || layer === 'IN') && entry.hasPriorityTags && entry.locationBoundary !== null) {
          return {
            matches: pendingFallback || [],
            inspected: inspected,
            stopReason: 'priority_location_boundary',
            selectedEntry: pendingComposite ? pendingComposite.entry : entry,
            locationBoundaryEntry: entry
          };
        }
        continue;
      }
      if (matches.length) {
        matches.forEach(function (match) {
          if (references[match.item.id] && references[match.item.id].entry !== entry) {
            match.reason = 'conditional_reference';
            match.referenceTrigger = references[match.item.id].trigger;
            match.referenceEntry = references[match.item.id].entry;
          }
        });
        return {
          matches: matches,
          inspected: inspected,
          stopReason: entry.source === 'current_user' ? 'current_match' : 'history_match',
          selectedEntry: entry
        };
      }
      if ((layer === 'EX' || layer === 'IN') && entry.hasPriorityTags && entry.locationBoundary !== null) {
        return {
          matches: [],
          inspected: inspected,
          stopReason: 'priority_location_boundary',
          selectedEntry: entry,
          locationBoundaryEntry: entry
        };
      }
    }
    if (pendingFallback && pendingFallback.length) {
      return {
        matches: pendingFallback,
        inspected: inspected,
        stopReason: 'incomplete_location_chain_generic_only',
        selectedEntry: pendingComposite ? pendingComposite.entry : null
      };
    }
    return { matches: [], inspected: inspected, stopReason: 'no_match', selectedEntry: null };
  }

  function sourceSummary(entry) {
    if (!entry) return null;
    return {
      source: entry.source,
      historyIndex: entry.historyIndex || 0,
      messageIndex: entry.messageIndex,
      path: entry.path,
      tagNames: (entry.tagNames || []).slice(),
      hasPriorityTags: Boolean(entry.hasPriorityTags),
      locationBoundary: entry.locationBoundary === null || entry.locationBoundary === undefined
        ? null
        : String(entry.locationBoundary),
      textPreview: textPreview(entry.diagnosticText === undefined ? entry.text : entry.diagnosticText, 240)
    };
  }

  function matchSummary(match) {
    var result = {
      id: match.item.id,
      displayName: match.item.displayName,
      trigger: match.trigger || null,
      reason: match.reason || null,
      source: sourceSummary(match.entry),
      position: Number.isFinite(Number(match.position)) ? Number(match.position) : null,
      triggerEnd: Number.isFinite(Number(match.triggerEnd)) ? Number(match.triggerEnd) : null,
      triggerTier: match.triggerTier || null,
      derived: Boolean(match.derived),
      sourceField: match.sourceField || null
    };
    if (match.referenceTrigger) {
      result.referenceTrigger = match.referenceTrigger;
      result.referenceSource = sourceSummary(match.referenceEntry);
    }
    if (match.compositeCore) {
      result.compositeCore = match.compositeCore;
      result.compositeCorePosition = Number.isFinite(Number(match.compositeCorePosition)) ? Number(match.compositeCorePosition) : null;
      result.compositeCoreEnd = Number.isFinite(Number(match.compositeCoreEnd)) ? Number(match.compositeCoreEnd) : null;
      result.compositeCoreSource = sourceSummary(match.compositeCoreEntry || match.entry);
      result.compositeQualifier = match.compositeQualifier;
      result.compositeQualifierPosition = Number.isFinite(Number(match.compositeQualifierPosition)) ? Number(match.compositeQualifierPosition) : null;
      result.compositeQualifierEnd = Number.isFinite(Number(match.compositeQualifierEnd)) ? Number(match.compositeQualifierEnd) : null;
      result.qualifierSource = sourceSummary(match.qualifierEntry);
    }
    if (match.linkedFromId) {
      result.linkedFromId = match.linkedFromId;
      result.linkedFromName = match.linkedFromName || match.linkedFromId;
    }
    if (match.linkKind === 'named_parent_station') result.linkKind = match.linkKind;
    if (Array.isArray(match.focusedFragmentIds) && match.focusedFragmentIds.length) {
      result.focusedFragmentIds = match.focusedFragmentIds.slice();
      result.locationTimeSelectedTime = match.locationTimeSelectedTime || null;
    }
    if (match.customText) {
      result.textSource = 'custom';
      result.customText = true;
      result.textSlotKey = match.textSlotKey || null;
      result.calendarSegmentId = match.textCalendarSegmentId || null;
      result.baseChanged = Boolean(match.textBaseChanged);
      result.locationTimeFocusSkipped = Boolean(match.locationTimeFocusSkipped);
    } else {
      result.textSource = 'builtin';
      result.customText = false;
    }
    return result;
  }

  function compareMatchPriority(left, right) {
    var leftEntry = left && left.entry ? left.entry : null;
    var rightEntry = right && right.entry ? right.entry : null;
    var leftHistory = leftEntry ? Number(leftEntry.historyIndex || 0) : Number.MAX_SAFE_INTEGER;
    var rightHistory = rightEntry ? Number(rightEntry.historyIndex || 0) : Number.MAX_SAFE_INTEGER;
    if (leftHistory !== rightHistory) return leftHistory - rightHistory;
    var leftMessage = leftEntry && Number.isFinite(Number(leftEntry.messageIndex)) ? Number(leftEntry.messageIndex) : -1;
    var rightMessage = rightEntry && Number.isFinite(Number(rightEntry.messageIndex)) ? Number(rightEntry.messageIndex) : -1;
    if (leftMessage !== rightMessage) return rightMessage - leftMessage;
    var leftEnd = Number.isFinite(Number(left && left.triggerEnd)) ? Number(left.triggerEnd) : -1;
    var rightEnd = Number.isFinite(Number(right && right.triggerEnd)) ? Number(right.triggerEnd) : -1;
    if (leftEnd !== rightEnd) return rightEnd - leftEnd;
    var leftLength = leftEnd >= 0 && Number.isFinite(Number(left && left.position)) ? leftEnd - Number(left.position) : 0;
    var rightLength = rightEnd >= 0 && Number.isFinite(Number(right && right.position)) ? rightEnd - Number(right.position) : 0;
    if (leftLength !== rightLength) return rightLength - leftLength;
    var leftPosition = Number.isFinite(Number(left && left.position)) ? Number(left.position) : -1;
    var rightPosition = Number.isFinite(Number(right && right.position)) ? Number(right.position) : -1;
    return rightPosition - leftPosition;
  }

  function canShareExactDirectTrigger(left, right) {
    if (!left || !right || !left.detail || !right.detail) return false;
    var leftDetail = left.detail;
    var rightDetail = right.detail;
    if (leftDetail.reason !== 'direct' || rightDetail.reason !== 'direct') return false;
    if (!leftDetail.entry || leftDetail.entry !== rightDetail.entry) return false;
    if (leftDetail.position !== rightDetail.position || leftDetail.triggerEnd !== rightDetail.triggerEnd) return false;
    if (normalizeText(leftDetail.trigger) !== normalizeText(rightDetail.trigger)) return false;
    var exactTrigger = normalizeText(leftDetail.trigger);
    return (left.item.directTriggers || []).some(function (trigger) { return normalizeText(trigger) === exactTrigger; }) &&
      (right.item.directTriggers || []).some(function (trigger) { return normalizeText(trigger) === exactTrigger; });
  }

  function resolveLocationConflicts(recognized, details, diagnostics) {
    var groups = {};
    recognized.forEach(function (item, id) {
      if (!item.conflictGroup) return;
      if (!groups[item.conflictGroup]) groups[item.conflictGroup] = [];
      groups[item.conflictGroup].push({ id: id, item: item, detail: details[id] || { item: item, entry: null } });
    });
    Object.keys(groups).forEach(function (groupId) {
      var candidates = groups[groupId];
      if (candidates.length < 2) return;
      candidates.sort(function (left, right) {
        var rank = compareMatchPriority(left.detail, right.detail);
        if (rank !== 0) return rank;
        // LJ001-V31-DIRECT-LINK-TIE: a linked item cannot displace the direct source of its identical match span.
        if (left.detail.linkedFromId === right.item.id) return 1;
        if (right.detail.linkedFromId === left.item.id) return -1;
        return left.item.order - right.item.order;
      });
      var winner = candidates[0];
      candidates.slice(1).filter(function (candidate) {
        return !canShareExactDirectTrigger(winner, candidate);
      }).forEach(function (loser) {
        recognized.delete(loser.id);
        delete details[loser.id];
        diagnostics.suppressedLocations.push({
          id: loser.id,
          displayName: loser.item.displayName,
          reason: 'later_same_level_location',
          conflictGroup: groupId,
          source: sourceSummary(loser.detail.entry),
          position: Number.isFinite(Number(loser.detail.position)) ? Number(loser.detail.position) : null,
          triggerEnd: Number.isFinite(Number(loser.detail.triggerEnd)) ? Number(loser.detail.triggerEnd) : null,
          keptId: winner.id,
          keptName: winner.item.displayName,
          keptSource: sourceSummary(winner.detail.entry),
          keptPosition: Number.isFinite(Number(winner.detail.position)) ? Number(winner.detail.position) : null,
          keptTriggerEnd: Number.isFinite(Number(winner.detail.triggerEnd)) ? Number(winner.detail.triggerEnd) : null
        });
      });
    });
  }

  function sameRecognitionEntry(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    return left.source === right.source && left.messageIndex === right.messageIndex && left.historyIndex === right.historyIndex;
  }

  function stationMatchCoveredByNamedVenue(detail, directNamedMatches) {
    if (!detail || !detail.item || detail.item.placeKind !== 'station' || !detail.entry) return false;
    var start = Number(detail.position);
    var end = Number(detail.triggerEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return (directNamedMatches || []).some(function (namedDetail) {
      if (!namedDetail || !namedDetail.item || !namedDetail.item.sourceObjectId) return false;
      if (!sameRecognitionEntry(detail.entry, namedDetail.entry)) return false;
      var namedStart = Number(namedDetail.position);
      var namedEnd = Number(namedDetail.triggerEnd);
      return Number.isFinite(namedStart) && Number.isFinite(namedEnd)
        && namedStart <= start && namedEnd >= end && (namedStart < start || namedEnd > end);
    });
  }

  function getPlaceBodyRecords(placeId) {
    return (DATA.bodyRecords || []).filter(function (record) { return record.ownerPlaceId === placeId; });
  }

  function getPlaceWalkingInterests(placeId) {
    return (DATA.walkingInterests || []).filter(function (relation) { return relation.anchorPlaceId === placeId; });
  }

  function getStationAdministrativeRecord(railStationId) {
    return ((DATA.stationAdministration || {}).stations || []).find(function (station) { return station.railStationId === railStationId; }) || null;
  }

  function getPlaceStationAdministrativeRecord(placeId) {
    var link = ((DATA.stationAdministration || {}).contentStationCrosswalk || []).find(function (entry) { return entry.placeId === placeId; });
    return link ? getStationAdministrativeRecord(link.railStationId) : null;
  }

  // LJ001-V3-MAP-PLACE-INTEGRATION：全站仅扩展浏览视图；显式站号对照保留原正文与唯一编辑器。
  function createLocationBrowserModel(data) {
    var source = data || {};
    var administration = source.stationAdministration || {};
    var nameAliases = source.placeNameAliases || {};
    var nodes = (source.adminNodes || []).map(function (node) { return Object.assign({}, node); });
    var nodeById = new Map(nodes.map(function (node) { return [String(node.id || node.adminNodeId), node]; }));
    var nodeByOfficialPath = new Map();
    function nodePath(id) {
      var path = [];
      var current = nodeById.get(String(id || ''));
      while (current) {
        path.unshift(current);
        current = current.parentId ? nodeById.get(String(current.parentId)) : null;
      }
      return path;
    }
    nodes.forEach(function (node) {
      nodeByOfficialPath.set(JSON.stringify(nodePath(node.id || node.adminNodeId).map(function (part) { return part.nameJa || part.label; })), node);
    });
    var unitNodeIds = new Map();
    (administration.adminUnits || []).slice().sort(function (left, right) {
      return (left.officialPathJa || []).length - (right.officialPathJa || []).length;
    }).forEach(function (unit) {
      var officialPathKey = JSON.stringify(unit.officialPathJa || []);
      var node = nodeByOfficialPath.get(officialPathKey);
      if (!node) {
        node = {
          id: 'station-admin:' + unit.adminUnitId,
          kind: unit.kind === 'designated_city_ward' ? 'ward' : unit.kind,
          label: unit.nameJa,
          nameJa: unit.nameJa,
          parentId: unit.parentAdminUnitId ? unitNodeIds.get(unit.parentAdminUnitId) : null,
          regionId: unit.prefectureId,
          sourceAdminUnitId: unit.adminUnitId
        };
        nodes.push(node);
        nodeById.set(node.id, node);
        nodeByOfficialPath.set(officialPathKey, node);
      }
      unitNodeIds.set(unit.adminUnitId, String(node.id || node.adminNodeId));
    });
    function presentation(nodeId) {
      var path = nodePath(nodeId);
      function reference(node) { return node ? { id: node.id || node.adminNodeId, label: node.label, nameJa: node.nameJa } : null; }
      return {
        adminNodeId: nodeId,
        adminPath: path.map(function (node) { return node.id || node.adminNodeId; }),
        prefecture: reference(path.find(function (node) { return node.kind === 'prefecture'; })),
        city: reference(path.find(function (node) { return node.kind === 'city' || node.kind === 'town' || node.kind === 'village'; })),
        ward: reference(path.find(function (node) { return node.kind === 'ward' || node.kind === 'special_ward'; }))
      };
    }
    var originalPlaces = (source.places || []).filter(function (place) { return place && place.kind !== 'editorial_area'; });
    var originalById = new Map(originalPlaces.map(function (place) { return [place.placeId, place]; }));
    var crosswalkByRailId = new Map((administration.contentStationCrosswalk || []).map(function (link) { return [link.railStationId, link]; }));
    var matchedPlaceIds = new Set();
    var stations = (administration.stations || []).map(function (station) {
      var link = crosswalkByRailId.get(station.railStationId);
      var original = link ? originalById.get(link.placeId) : null;
      if (original) matchedPlaceIds.add(original.placeId);
      var memberships = (station.adminUnitIds || []).map(function (unitId) { return unitNodeIds.get(unitId); }).filter(Boolean).map(presentation);
      var primaryId = station.primaryAdminUnitId ? unitNodeIds.get(station.primaryAdminUnitId) : null;
      var base = primaryId ? presentation(primaryId) : { adminNodeId: null, adminPath: [], prefecture: memberships[0] && memberships[0].prefecture, city: null, ward: null };
      return Object.assign({}, original || {}, base, {
        placeId: original ? original.placeId : 'place:rail_station:' + station.railStationId,
        kind: 'station',
        stationId: original ? original.stationId : station.railStationId,
        railStationId: station.railStationId,
        mapStationId: station.railStationId,
        label: station.nameJa,
        nameJa: station.nameJa,
        aliases: Array.from(new Set((original && original.aliases || []).concat([station.nameJa, station.nameJa + '駅', station.nameJa + '站'], (nameAliases.stations || {})[station.railStationId] || []))),
        regionId: memberships[0] && memberships[0].prefecture ? (nodeById.get(memberships[0].prefecture.id) || {}).regionId : '',
        coordinates: station.coordinates,
        adminMemberships: memberships,
        adminNodeIds: memberships.map(function (membership) { return membership.adminNodeId; }),
        bodyRecordIds: original ? original.bodyRecordIds || [] : [],
        controlGroupIds: original ? original.controlGroupIds || [] : [],
        editorialAreaIds: original ? original.editorialAreaIds || [] : [],
        sourceObjectId: null,
        registeredOnly: !original
      });
    });
    var places = originalPlaces.filter(function (place) { return !matchedPlaceIds.has(place.placeId); }).map(function (place) { return Object.assign({}, place); }).concat(stations);
    // LJ001-V31-SEARCH-ALIASES：简繁译名和简称只进搜索，不参与正文激活。
    places.forEach(function (place) {
      if (place.kind === 'content_object') place.aliases = Array.from(new Set((place.aliases || []).concat((nameAliases.objects || {})[place.sourceObjectId] || [])));
      var memberships = place.adminMemberships && place.adminMemberships.length ? place.adminMemberships : [place];
      place.administrativeSearchAliases = Array.from(new Set(memberships.flatMap(function (membership) {
        return (membership.adminPath || []).flatMap(function (id) {
          var node = nodeById.get(id) || {};
          return [node.label, node.nameJa].filter(Boolean).flatMap(function (name) { return [name].concat((nameAliases.administrativeNames || {})[name] || []); });
        });
      })));
    });
    var treeNodes = nodes.map(function (node) {
      return { adminNodeId: String(node.id || node.adminNodeId), label: node.label || node.nameJa, parentAdminNodeId: node.parentId || null, childNodeIds: [], placeIds: [], placeCount: 0 };
    });
    var treeById = new Map(treeNodes.map(function (node) { return [node.adminNodeId, node]; }));
    var descendantPlaces = new Map(treeNodes.map(function (node) { return [node.adminNodeId, new Set()]; }));
    treeNodes.forEach(function (node) {
      var parent = treeById.get(node.parentAdminNodeId);
      if (parent) parent.childNodeIds.push(node.adminNodeId);
    });
    places.forEach(function (place) {
      (place.adminMemberships && place.adminMemberships.length ? place.adminMemberships : [place]).forEach(function (membership) {
        var path = membership.adminPath || [];
        var leaf = treeById.get(membership.adminNodeId || path[path.length - 1]);
        if (leaf && leaf.placeIds.indexOf(place.placeId) < 0) leaf.placeIds.push(place.placeId);
        path.forEach(function (id) { if (descendantPlaces.has(id)) descendantPlaces.get(id).add(place.placeId); });
      });
    });
    treeNodes.forEach(function (node) { node.placeCount = descendantPlaces.get(node.adminNodeId).size; });
    var mapStationIds = new Map(((source.transitStationAdditions || {}).stations || []).map(function (station) { return [station.railStationId, station.stationId]; }));
    var mapPlaces = places.map(function (place) {
      var memberships = place.adminMemberships && place.adminMemberships.length ? place.adminMemberships : [place];
      var paths = memberships.map(function (membership) {
        return (membership.adminPath || []).map(function (id) { var node = nodeById.get(id); return node ? node.label || node.nameJa : String(id); });
      });
      var point = place.coordinates;
      var coordinates = Array.isArray(point) ? point.slice(0, 2) : point && Number.isFinite(Number(point.longitude)) && Number.isFinite(Number(point.latitude)) ? [Number(point.longitude), Number(point.latitude)] : null;
      return Object.assign({}, place, { mapStationId: place.kind === 'station' ? mapStationIds.get(place.railStationId) || place.mapStationId : place.mapStationId, adminPath: paths.length > 1 ? paths.map(function (path) { return path.join(' → '); }) : paths[0] || [], coordinates: coordinates });
    });
    return {
      places: places,
      mapPlaces: mapPlaces,
      adminNodes: nodes,
      administrativeTree: { rootNodeIds: treeNodes.filter(function (node) { return !node.parentAdminNodeId && node.placeCount; }).map(function (node) { return node.adminNodeId; }), nodes: treeNodes },
      placeByRailStationId: Object.fromEntries(stations.map(function (place) { return [place.railStationId, place.placeId]; }))
    };
  }

  // LJ001-V31-PLACE-PRESENTATION：显示补名与类型检索不改写正文、触发词或交通端点原名。
  function getPlacePresentation(value, source) {
    var data = source || DATA;
    var metadata = data.placePresentation || {};
    value = value || {};
    var owner = (data.places || []).find(function (place) {
      return value.placeId && place.placeId === value.placeId || value.sourceObjectId && place.sourceObjectId === value.sourceObjectId;
    }) || value;
    var placeId = value.placeId || owner.placeId;
    var raw = String(value.displayName || value.label || value.nameJa || owner.label || owner.nameJa || placeId || '');
    var label = raw;
    if (!value.displayName && metadata.stationSubjects && metadata.stationSubjects[placeId] === 'station_body' && !/[站駅驛驿]$/u.test(label)) label += '駅';
    var translation = (metadata.translations || {})[placeId];
    if (translation && translation.zh && label.indexOf(translation.zh) < 0 && (!value.displayName || !owner.label || raw.indexOf(owner.label) === 0)) label += '（' + translation.zh + '）';
    var types = ((metadata.objectTypes || {})[value.sourceObjectId || owner.sourceObjectId] || []).slice();
    var aliases = metadata.typeAliases || {};
    if (!types.length && (value.kind === 'station' || owner.kind === 'station' || value.placeKind === 'station')) types = ['站点'];
    if (value.displayName && types.length > 1) types.sort(function (left, right) {
      var contains = function (type) { return [type].concat(aliases[type] || []).some(function (term) { return raw.indexOf(term) >= 0; }); };
      return Number(contains(right)) - Number(contains(left));
    });
    var typeTerms = types.flatMap(function (type) { return [type].concat(aliases[type] || []); });
    var searchTerms = Array.from(new Set([raw, label].concat(value.aliases || [], value.fullTriggers || [], value.aliasTriggers || [], value.directTriggers || [], translation && translation.searchTerms || [], typeTerms)));
    return { displayLabel: label, typeLabels: types, searchTerms: searchTerms };
  }

  function transitMapFavoritePlaces(input) {
    var favorites = clone(input || emptyTransitFavoritePlaces());
    favorites.slots.forEach(function (slot) {
      if (!slot.endpoint) return;
      if (slot.endpoint.type === 'content_object' || slot.endpoint.type === 'object') {
        var contentPlace = (DATA.places || []).find(function (place) { return place.kind === 'content_object' && (place.placeId === slot.endpoint.id || place.sourceObjectId === slot.endpoint.id); });
        slot.endpoint.type = 'object';
        if (contentPlace && contentPlace.sourceObjectId) slot.endpoint.id = contentPlace.sourceObjectId;
      }
      if (slot.endpoint.type === 'station') {
        var legacyId = slot.endpoint.id;
        var original = (DATA.places || []).find(function (place) { return place.kind === 'station' && (place.stationId === legacyId || place.mapStationId === legacyId || place.placeId === legacyId); });
        var link = ((DATA.stationAdministration || {}).contentStationCrosswalk || []).find(function (entry) { return entry.contentStationId === legacyId || (original && entry.placeId === original.placeId); });
        if (link) slot.endpoint.id = link.railStationId;
      }
    });
    return favorites;
  }

  // LJ001-NAMED-INTERESTS：有效站兴趣按身份合并，EX末尾统一列名；不反向激活正文。
  function applyNamedPlaceInterests(packages, directPackageIds, settings, directDetails, directNamedMatches) {
    var directIds = new Set(directPackageIds || []);
    var records = [];
    var mergedById = new Map();
    (packages || []).forEach(function (item) {
      if (item.placeKind !== 'station' || !item.placeId || !directIds.has(item.id) || packageBlockReason(item, settings)) return;
      var relations = (DATA.walkingInterests || []).filter(function (relation) {
        return relation.anchorPlaceId === item.placeId;
      });
      var names = [];
      var stationObjectIds = new Set();
      relations.forEach(function (relation) {
        var id = relation.targetObjectId;
        var clean = String((((DATA.namedStationParents || {}).interestInjectionNames || {})[id]) || relation.fullName || '').trim();
        if (!clean) return;
        if (!stationObjectIds.has(id)) { stationObjectIds.add(id); names.push(clean); }
        if (!mergedById.has(id)) mergedById.set(id, { id: id, name: clean, anchorPlaceIds: [] });
        var merged = mergedById.get(id);
        if (!merged.anchorPlaceIds.includes(item.placeId)) merged.anchorPlaceIds.push(item.placeId);
      });
      if (names.length) records.push({
        anchorPackageId: item.id,
        anchorPlaceId: item.placeId,
        relationIds: relations.map(function (relation) { return relation.relationId; }),
        names: names.slice()
      });
    });
    return { packages: packages || [], records: records, merged: Array.from(mergedById.values()) };
  }

  function runEngine(rawMessages, rawSettings, options) {
    var settings = normalizeSettings(rawSettings);
    var textOverrides = normalizeTextOverrides(options && options.textOverrides);
    var requestType = options && options.requestType ? options.requestType : 'normal';
    var diagnostics = {
      requestType: requestType,
      historyDepth: settings.historyDepth,
      currentUserBoundary: clone(settings.currentUserBoundary),
      channels: {},
      matchedBeforeLinks: [],
      linkedPackages: [],
      blockedPackages: [],
      duplicatesRemoved: [],
      injectedPackages: [],
      restoredStoryState: null,
      derivedBackgrounds: [],
      suppressedLocations: [],
      locationTimeFocus: null,
      namedPlaceInterests: [],
      namedStationParents: [],
      customTextOverrides: [],
      suppressedLegacyParents: [],
      contentFallbacks: [],
      recognizedEmptyBodies: []
    };
    if (!settings.masterEnabled) {
      diagnostics.reason = 'master_off';
      return { prompt: '', packages: [], packageIds: [], diagnostics: diagnostics };
    }
    var recognized = new Map();
    var recognizedDetails = {};
    var recognitionCandidates = {};
    var directNamedMatches = [];
    var directDetailsBeforeLinks = {};
    var parentStationAnchorIds = [];
    var restoredTimeState = null;

    function rememberRecognition(match) {
      var id = match.item.id;
      if (!recognitionCandidates[id]) recognitionCandidates[id] = [];
      var candidateKey = [
        match.reason,
        match.linkedFromId || '',
        match.entry ? match.entry.messageIndex : 'none',
        match.entry ? match.entry.historyIndex : 'none',
        match.position,
        match.triggerEnd,
        match.trigger || '',
        match.triggerTier || ''
      ].join('|');
      if (!recognitionCandidates[id].some(function (candidate) { return candidate._recognitionKey === candidateKey; })) {
        match._recognitionKey = candidateKey;
        recognitionCandidates[id].push(match);
      }
      if (!recognized.has(id) || compareMatchPriority(match, recognizedDetails[id]) < 0) {
        recognized.set(id, match.item);
        recognizedDetails[id] = match;
        return true;
      }
      return false;
    }

    function pruneOrphanedRelations() {
      var changed = true;
      while (changed) {
        changed = false;
        Array.from(recognized.keys()).forEach(function (id) {
          var detail = recognizedDetails[id];
          if (!detail || !detail.linkedFromId || recognized.has(detail.linkedFromId)) return;
          var fallback = (recognitionCandidates[id] || []).filter(function (candidate) {
            return !candidate.linkedFromId || recognized.has(candidate.linkedFromId);
          }).sort(compareMatchPriority)[0] || null;
          if (fallback) {
            recognized.set(id, fallback.item);
            recognizedDetails[id] = fallback;
          } else {
            recognized.delete(id);
            delete recognizedDetails[id];
          }
          changed = true;
        });
      }
    }

    DATA.layerOrder.forEach(function (layer) {
      var entries = collectChannelEntries(rawMessages, layer, settings.historyDepth, requestType, settings);
      var inspected;
      var state = null;
      var stateSources = null;
      var stopReason;
      var detectedMatches = [];
      if (layer === 'TN') {
        var timeEntries = entries.map(function (entry) {
          var maskedText = maskTrafficDurationForTimeChannel(entry.text);
          if (maskedText === entry.text) return entry;
          return Object.assign({}, entry, { text: maskedText, diagnosticText: entry.text });
        });
        var timeResult = resolveTimeStateDetailed(timeEntries);
        state = timeResult.state;
        restoredTimeState = state;
        diagnostics.restoredStoryState = clone(state);
        stateSources = {};
        Object.keys(timeResult.sources).forEach(function (field) {
          stateSources[field] = sourceSummary(timeResult.sources[field]);
        });
        inspected = timeResult.inspected;
        stopReason = inspected.length < entries.length ? 'fields_complete' : 'depth_exhausted';
        DATA.packages.filter(function (item) {
          return item.layer === 'TN' && item.matchMode !== 'link_only' && (!item.activation || item.activation.kind !== 'location_time_overlay');
        }).forEach(function (item) {
          var evaluation = evaluateConditionRule(item, state, inspected);
          if (!evaluation.matched) return;
          var runtimeBody = resolveRuntimeBody(item, state);
          if (!runtimeBody) return;
          var runtimeItem = runtimeBody === item.body ? item : Object.assign({}, item, {
            body: runtimeBody
          });
          var sourceEntry = evaluation.entry || timeResult.sources[evaluation.sourceField] || null;
          var detected = {
            item: runtimeItem,
            trigger: evaluation.trigger,
            reason: evaluation.reason,
            entry: sourceEntry,
            derived: Boolean(evaluation.derived),
            sourceField: evaluation.sourceField || null
          };
          detectedMatches.push(detected);
          if (detected.derived) diagnostics.derivedBackgrounds.push(matchSummary(detected));
        });
      } else {
        var channelResult = resolveNonTimeChannel(entries, layer, restoredTimeState);
        inspected = channelResult.inspected;
        stopReason = channelResult.stopReason;
        detectedMatches = channelResult.matches;
      }
      detectedMatches.forEach(function (match) {
        if (match && match.item && (match.item.sourceObjectId || match.item.placeKind === 'station')) directNamedMatches.push(match);
        rememberRecognition(match);
      });
      diagnostics.channels[layer] = {
        maxHistoryDepth: settings.historyDepth,
        actualHistoryChecked: inspected.filter(function (entry) { return entry.source === 'assistant_history'; }).length,
        stopReason: stopReason,
        entries: inspected.map(sourceSummary),
        state: state,
        stateSources: stateSources,
        detected: detectedMatches.map(matchSummary),
        recognized: [],
        matched: [],
        blocked: []
      };
    });

    // 具名场馆完整名内含的站名不是独立站点证据；后文另一次明确提站仍可命中。
    Array.from(recognized.keys()).forEach(function (id) {
      var detail = recognizedDetails[id];
      if (!stationMatchCoveredByNamedVenue(detail, directNamedMatches)) return;
      recognized.delete(id);
      delete recognizedDetails[id];
      diagnostics.suppressedLocations.push({
        id: id,
        displayName: detail.item.displayName,
        reason: 'station_name_inside_named_venue'
      });
    });

    resolveLocationConflicts(recognized, recognizedDetails, diagnostics);
    pruneOrphanedRelations();
    diagnostics.matchedBeforeLinks = Array.from(recognized.keys());
    diagnostics.matchedBeforeLinks.forEach(function (id) {
      directDetailsBeforeLinks[id] = recognizedDetails[id];
    });

    var expansionQueue = Array.from(recognized.keys());
    var expandedKeys = new Set();
    var expansionCount = 0;
    while (expansionQueue.length && expansionCount < DATA.packages.length * 4) {
      expansionCount += 1;
      var sourceId = expansionQueue.shift();
      if (!recognized.has(sourceId)) continue;
      var source = recognized.get(sourceId);
      var sourceDetail = recognizedDetails[sourceId] || { item: source, entry: null };
      var sourceKey = [
        sourceId,
        sourceDetail.entry ? sourceDetail.entry.messageIndex : 'none',
        sourceDetail.entry ? sourceDetail.entry.historyIndex : 'none',
        sourceDetail.position,
        sourceDetail.triggerEnd,
        sourceDetail.reason
      ].join('|');
      if (expandedKeys.has(sourceKey)) continue;
      expandedKeys.add(sourceKey);
      var linkCandidates = [];
      (source.links || []).forEach(function (targetId) {
        linkCandidates.push({ targetId: targetId, linkTrigger: null, linkKind: 'fixed' });
      });
      if (sourceDetail.entry && sourceDetail.reason && !String(sourceDetail.reason).startsWith('linked_from:')) {
        (source.triggerLinks || []).forEach(function (rule) {
          var found = findTriggerDetailed(sourceDetail.entry.text, rule.triggers || []);
          if (!found) return;
          (rule.targetPackageIds || []).forEach(function (targetId) {
            linkCandidates.push({
              targetId: targetId,
              linkTrigger: found.trigger,
              linkPosition: found.index,
              linkTriggerEnd: found.end,
              linkKind: 'trigger_specific'
            });
          });
        });
      }
      linkCandidates.forEach(function (candidate) {
        var target = getPackageById(candidate.targetId);
        if (!target || target.id === sourceId) return;
        var linkedDetail = {
          item: target,
          trigger: candidate.linkTrigger,
          reason: 'linked_from:' + sourceId,
          entry: sourceDetail.entry || null,
          position: Number.isFinite(Number(candidate.linkPosition)) ? Number(candidate.linkPosition) : sourceDetail.position,
          triggerEnd: Number.isFinite(Number(candidate.linkTriggerEnd)) ? Number(candidate.linkTriggerEnd) : sourceDetail.triggerEnd,
          linkedFromId: sourceId,
          linkedFromName: source.displayName,
          linkKind: candidate.linkKind
        };
        var linkRecord = {
          source: sourceId,
          sourceName: source.displayName,
          target: target.id,
          targetName: target.displayName,
          linkKind: candidate.linkKind,
          trigger: candidate.linkTrigger || null,
          sourceDetail: matchSummary(sourceDetail)
        };
        diagnostics.linkedPackages.push(linkRecord);
        if (rememberRecognition(linkedDetail)) expansionQueue.push(target.id);
      });
    }

    resolveLocationConflicts(recognized, recognizedDetails, diagnostics);
    pruneOrphanedRelations();

    DATA.packages.filter(function (item) {
      return item.activation && item.activation.kind === 'location_time_overlay';
    }).forEach(function (overlay) {
      var baseIds = overlay.activation.basePackageIds || [];
      var baseId = baseIds.find(function (id) { return recognized.has(id); });
      if (!baseId || !restoredTimeState || !restoredTimeState.clockEndpoint) return;
      var dateOkay = !Array.isArray(overlay.activation.windows) || overlay.activation.windows.length === 0 || anyDateWindowMatches(restoredTimeState.date, overlay.activation.windows);
      var timeOkay = minuteWindowMatches(restoredTimeState.clockEndpoint.minutes, overlay.activation.startMinute, overlay.activation.endMinute);
      if (!dateOkay || !timeOkay) return;
      var overlayMatch = {
        item: overlay,
        trigger: String(restoredTimeState.clockEndpoint.hour).padStart(2, '0') + ':' + String(restoredTimeState.clockEndpoint.minute).padStart(2, '0'),
        reason: 'location_time_overlay',
        entry: null,
        derived: true,
        sourceField: 'clockEndpoint',
        linkedFromId: baseId,
        linkedFromName: recognized.get(baseId).displayName
      };
      rememberRecognition(overlayMatch);
      diagnostics.derivedBackgrounds.push(matchSummary(overlayMatch));
    });

    var matched = new Map();
    var matchDetails = {};
    recognized.forEach(function (item, id) {
      var detail = recognizedDetails[id] || { item: item, trigger: null, reason: null, entry: null };
      if (diagnostics.channels[item.layer]) diagnostics.channels[item.layer].recognized.push(id);
      var blockReason = packageBlockReason(item, settings);
      if (blockReason) {
        var blocked = Object.assign(matchSummary(detail), {
          blocker: blockReason,
          kind: detail.derived ? 'derived' : (detail.linkedFromId ? 'linked' : 'direct')
        });
        diagnostics.blockedPackages.push(blocked);
        if (diagnostics.channels[item.layer]) diagnostics.channels[item.layer].blocked.push(blocked);
        return;
      }
      matched.set(id, item);
      matchDetails[id] = detail;
      if (diagnostics.channels[item.layer]) diagnostics.channels[item.layer].matched.push(id);
    });

    // LJ001-V31-NAMED-PARENT-STATIONS: merge approved IN parents after location conflicts; sample at most three once per request.
    if (DATA.namedStationParents) {
      var parentRules = DATA.namedStationParents;
      // LJ001-V33-DIRECT-PARENT-QUOTA: directly matched stations stay outside the automatic three-station draw.
      var directStationPlaceIds = new Set(diagnostics.matchedBeforeLinks.map(function (id) {
        var item = matched.get(id);
        return item && item.placeKind === 'station' ? item.placeId : null;
      }).filter(Boolean));
      var parentSources = new Map();
      matched.forEach(function (item) {
        if (item.layer !== 'IN' || !item.sourceObjectId || !String(resolveEffectiveBody(item, restoredTimeState, textOverrides).body || '').trim()) return;
        if (!parentSources.has(item.sourceObjectId)) parentSources.set(item.sourceObjectId, []);
        parentSources.get(item.sourceObjectId).push(item);
      });
      var stationByPlace = new Map(DATA.packages.filter(function (item) { return item.placeKind === 'station'; }).map(function (item) { return [item.placeId, item]; }));
      var parentCandidates = new Map();
      parentSources.forEach(function (sources, objectId) {
        var relation = (parentRules.objects || {})[objectId] || {};
        var ids = Array.from(new Set(relation.stationPlaceIds || []));
        var record = {
          sourceObjectId: objectId, sourcePackageIds: sources.map(function (item) { return item.id; }),
          candidateStationPlaceIds: ids, eligibleStationPlaceIds: [], selectedStationPlaceIds: [],
          directStationPlaceIds: [], injectedStationPlaceIds: [], emptyStationPlaceIds: [], blockedStationPlaceIds: [], stationStates: [], status: ids.length ? 'candidate' : 'no_relation'
        };
        ids.forEach(function (placeId) {
          var station = stationByPlace.get(placeId);
          var blocker = station ? packageBlockReason(station, settings) : 'missing_station_package';
          var directlyMatched = Boolean(station && directStationPlaceIds.has(placeId));
          record.stationStates.push({ stationPlaceId: placeId, packageId: station ? station.id : null, selected: false, direct: directlyMatched, status: blocker ? 'blocked' : (directlyMatched ? 'direct' : 'not_selected'), blocker: blocker });
          if (blocker) { record.blockedStationPlaceIds.push(placeId); return; }
          if (directlyMatched) { record.directStationPlaceIds.push(placeId); return; }
          record.eligibleStationPlaceIds.push(placeId);
          if (!parentCandidates.has(placeId)) parentCandidates.set(placeId, { station: station, sources: [] });
          parentCandidates.get(placeId).sources.push(sources[0]);
        });
        diagnostics.namedStationParents.push(record);
      });
      var eligibleParents = Array.from(parentCandidates.keys());
      var selectionCache = options && options.parentStationSelectionCache || {};
      var selectionKey = eligibleParents.slice().sort().join('|');
      var selectionCached = Object.prototype.hasOwnProperty.call(selectionCache, selectionKey);
      var selectedParents;
      if (selectionCached) selectedParents = selectionCache[selectionKey].slice();
      else {
        selectedParents = eligibleParents.slice();
        var limit = parentRules.maxLinkedStations || 3;
        if (selectedParents.length > limit) {
          var random = options && typeof options.random === 'function' ? options.random : Math.random;
          for (var pick = 0; pick < limit; pick += 1) {
            var at = pick + Math.floor(random() * (selectedParents.length - pick));
            var swap = selectedParents[pick]; selectedParents[pick] = selectedParents[at]; selectedParents[at] = swap;
          }
          selectedParents = selectedParents.slice(0, limit);
        }
        selectionCache[selectionKey] = selectedParents.slice();
      }
      selectedParents.forEach(function (placeId) {
        var candidate = parentCandidates.get(placeId);
        var station = candidate.station;
        parentStationAnchorIds.push(station.id);
        candidate.sources.forEach(function (source) {
          var sourceDetail = matchDetails[source.id];
          if (!matched.has(station.id)) {
            var detail = Object.assign({}, sourceDetail, { item: station, trigger: null, reason: 'linked_from:' + source.id, linkedFromId: source.id, linkedFromName: source.displayName, linkKind: 'named_parent_station' });
            recognized.set(station.id, station); recognizedDetails[station.id] = detail;
            matched.set(station.id, station); matchDetails[station.id] = detail;
            diagnostics.channels.EX.recognized.push(station.id); diagnostics.channels.EX.matched.push(station.id);
          }
          diagnostics.linkedPackages.push({ source: source.id, sourceName: source.displayName, target: station.id, targetName: station.displayName, linkKind: 'named_parent_station', sourceDetail: matchSummary(sourceDetail) });
        });
      });
      diagnostics.namedStationParents.forEach(function (record) {
        record.selectionCached = selectionCached;
        record.selectedStationPlaceIds = record.eligibleStationPlaceIds.filter(function (placeId) { return selectedParents.includes(placeId); });
        record.stationStates.forEach(function (state) { state.selected = record.selectedStationPlaceIds.includes(state.stationPlaceId); });
      });
    }

    diagnostics.linkedPackages.forEach(function (record) {
      if (!recognized.has(record.target)) {
        record.status = 'suppressed';
      } else if (matched.has(record.target)) {
        record.status = 'injected';
      } else {
        record.status = 'blocked';
        record.blocker = packageBlockReason(recognized.get(record.target), settings);
      }
      record.sourceInjected = matched.has(record.source);
      if (!record.sourceInjected && recognized.has(record.source)) {
        record.sourceBlocker = packageBlockReason(recognized.get(record.source), settings);
      }
    });

    var sorted = Array.from(matched.values()).sort(function (left, right) {
      return left.order - right.order;
    });
    var effectiveSorted = sorted.map(function (item) {
      var effective = resolveEffectiveBody(item, restoredTimeState, textOverrides);
      var runtimeItem = effective.body === item.body ? item : Object.assign({}, item, { body: effective.body });
      if (effective.custom) {
        matchDetails[item.id] = Object.assign({}, matchDetails[item.id], {
          customText: true,
          textSlotKey: effective.slotKey,
          textCalendarSegmentId: effective.calendarSegmentId,
          textBaseChanged: effective.baseChanged
        });
        diagnostics.customTextOverrides.push({
          id: item.id,
          displayName: item.displayName,
          slotKey: effective.slotKey,
          calendarSegmentId: effective.calendarSegmentId,
          baseChanged: effective.baseChanged
        });
        runtimeItem = Object.assign({}, runtimeItem, {
          textOverride: {
            custom: true,
            slotKey: effective.slotKey,
            calendarSegmentId: effective.calendarSegmentId,
            baseChanged: effective.baseChanged
          }
        });
      }
      return runtimeItem;
    });
    var seenBodies = new Set();
    var unique = effectiveSorted.filter(function (item) {
      if (!String(item.body || '').trim()) return true;
      if (seenBodies.has(item.body)) {
        diagnostics.duplicatesRemoved.push({ id: item.id, displayName: item.displayName });
        return false;
      }
      seenBodies.add(item.body);
      return true;
    });
    var locationTimeState = resolveLocationTimeFocusState(restoredTimeState);
    diagnostics.locationTimeFocus = {
      time_start: restoredTimeState && restoredTimeState.timeRange && restoredTimeState.timeRange.start
        ? clockPointLabel(restoredTimeState.timeRange.start) : null,
      time_end: restoredTimeState && restoredTimeState.clockEndpoint
        ? clockPointLabel(restoredTimeState.clockEndpoint) : null,
      selected_time: restoredTimeState && restoredTimeState.clockEndpoint
        ? clockPointLabel(restoredTimeState.clockEndpoint) : null,
      calendar_segment_id: locationTimeState ? locationTimeState.calendarSegmentId : null,
      internal_phase: locationTimeState ? locationTimeState.phase : null,
      focusedPackages: [],
      customFullBodyPackages: []
    };
    var focusedUnique = unique.map(function (item) {
      if (item.layer !== 'EX') return item;
      if (item.textOverride && item.textOverride.custom) {
        matchDetails[item.id] = Object.assign({}, matchDetails[item.id], {
          locationTimeFocusSkipped: true
        });
        diagnostics.locationTimeFocus.customFullBodyPackages.push({
          id: item.id,
          displayName: item.displayName,
          slotKey: item.textOverride.slotKey
        });
        return item;
      }
      var focused = applyLocationTimeFocus(item, matchDetails[item.id], restoredTimeState);
      if (!focused.focusedFragmentIds.length) return item;
      matchDetails[item.id] = Object.assign({}, matchDetails[item.id], {
        focusedFragmentIds: focused.focusedFragmentIds,
        locationTimeSelectedTime: diagnostics.locationTimeFocus.selected_time
      });
      diagnostics.locationTimeFocus.focusedPackages.push({
        id: item.id,
        displayName: item.displayName,
        focusedFragmentIds: focused.focusedFragmentIds.slice()
      });
      return Object.assign({}, item, { body: focused.body });
    });
    var interestResult = applyNamedPlaceInterests(focusedUnique, diagnostics.matchedBeforeLinks.concat(parentStationAnchorIds), settings, directDetailsBeforeLinks, directNamedMatches);
    focusedUnique = interestResult.packages;
    diagnostics.namedPlaceInterests = interestResult.records;
    diagnostics.mergedNamedPlaceInterests = interestResult.merged;
    var interestCache = options && options.interestSelectionCache || {};
    var interestKey = interestResult.merged.map(function (item) { return item.id; }).sort().join('|');
    var selectedInterestIds;
    if (Object.prototype.hasOwnProperty.call(interestCache, interestKey)) selectedInterestIds = interestCache[interestKey];
    else {
      selectedInterestIds = interestResult.merged.map(function (item) { return item.id; });
      if (selectedInterestIds.length > 7) {
        var drawInterest = options && typeof options.random === 'function' ? options.random : Math.random;
        for (var interestPick = 0; interestPick < 7; interestPick += 1) {
          var interestAt = interestPick + Math.floor(drawInterest() * (selectedInterestIds.length - interestPick));
          var interestSwap = selectedInterestIds[interestPick]; selectedInterestIds[interestPick] = selectedInterestIds[interestAt]; selectedInterestIds[interestAt] = interestSwap;
        }
        selectedInterestIds = selectedInterestIds.slice(0, 7);
      }
      interestCache[interestKey] = selectedInterestIds.slice();
    }
    diagnostics.emittedNamedPlaceInterests = interestResult.merged.filter(function (item) { return selectedInterestIds.includes(item.id); });
    var actualPackages = focusedUnique.filter(function (item) { return String(item.body || '').trim(); });
    diagnostics.recognizedEmptyBodies = focusedUnique.filter(function (item) {
      return !String(item.body || '').trim();
    }).map(function (item) {
      return {
        id: item.id,
        displayName: item.displayName,
        placeId: item.placeId || null,
        bodyRecordId: item.bodyRecordId || null
      };
    });
    diagnostics.injectedPackages = actualPackages.map(function (item) {
      return matchSummary(matchDetails[item.id] || { item: item, trigger: null, reason: null, entry: null });
    });
    var actualPackageIds = new Set(actualPackages.map(function (item) { return item.id; }));
    diagnostics.namedStationParents.forEach(function (record) {
      record.stationStates.forEach(function (state) {
        if (!state.selected) return;
        state.status = actualPackageIds.has(state.packageId) ? 'injected' : 'empty';
        (state.status === 'injected' ? record.injectedStationPlaceIds : record.emptyStationPlaceIds).push(state.stationPlaceId);
      });
      if (record.candidateStationPlaceIds.length) record.status = record.injectedStationPlaceIds.length ? 'injected' : record.emptyStationPlaceIds.length ? 'empty' : record.directStationPlaceIds.length && !record.eligibleStationPlaceIds.length ? 'direct' : record.blockedStationPlaceIds.length === record.candidateStationPlaceIds.length ? 'blocked' : 'not_selected';
    });
    diagnostics.linkedPackages.forEach(function (record) {
      if (record.linkKind !== 'named_parent_station') return;
      record.status = actualPackageIds.has(record.target) ? 'injected' : 'empty';
      record.sourceInjected = actualPackageIds.has(record.source);
    });
    var prompt = outputTextForScript(assemblePrompt(actualPackages, settings.wrapperMode, diagnostics.emittedNamedPlaceInterests.map(function (item) { return item.name; })), settings);
    return {
      prompt: prompt,
      packages: actualPackages,
      packageIds: actualPackages.map(function (item) { return item.id; }),
      diagnostics: diagnostics
    };
  }

  function markdownQuote(value) {
    return String(value).split(/\r?\n/).map(function (line) { return '> ' + line; }).join('\n');
  }

  function assemblePrompt(packages, wrapperMode, interestNames) {
    packages = packages || [];
    interestNames = interestNames || [];
    if (!packages.length && !interestNames.length) return '';
    var wrapper = DATA.wrappers[wrapperMode] || DATA.wrappers.background;
    // [D133-WRAPPER-LAYOUT] 外围提示与实际背景资料分层，单包正文保持原样。
    var materialSections = DATA.layerOrder.map(function (layer) {
      var layerBodies = packages.filter(function (item) {
        return item.layer === layer && typeof item.body === 'string' && item.body.length > 0;
      }).map(function (item) { return item.body; });
      if (layer === 'EX' && interestNames.length) layerBodies.push('相关兴趣点：' + interestNames.join('、'));
      if (layerBodies.length === 0) return '';
      return '### ' + (PROMPT_LAYER_LABELS[layer] || layer) + '\n' + layerBodies.join('\n\n');
    }).filter(Boolean);
    if (materialSections.length === 0) return '';
    return '<' + DATA.outputTag + '>\n\n'
      + markdownQuote(wrapper.top) + '\n\n'
      + '<material>\n\n' + materialSections.join('\n\n') + '\n\n</material>\n\n'
      + markdownQuote(wrapper.bottom) + '\n\n'
      + '</' + DATA.outputTag + '>';
  }

  // LJ001-V31-TEXT-SCRIPT：仅在最终输出边界按简繁开关转换，正文库与自定义原文不改写。
  function outputTextForScript(value, settings) {
    var text = String(value === null || value === undefined ? '' : value);
    return TEXT_CONVERTER.convert(text, settings && settings.textScript);
  }

  function requestGate(type, options, dryRun) {
    if (options && options.signal && options.signal.aborted) return { allowed: false, reason: 'aborted' };
    if (options && Number.isFinite(Number(options.depth)) && Number(options.depth) > 0) {
      return { allowed: false, reason: 'recursive_depth' };
    }
    if (!ALLOWED_TYPES.includes(type)) return { allowed: false, reason: 'generation_type:' + String(type) };
    return { allowed: true, reason: 'allowed' };
  }

  function appendPlaceNameToChatInput(doc, rawName) {
    var name = String(rawName === null || rawName === undefined ? '' : rawName).trim();
    if (!name) return { ok: false, error: '没有可追加的地点名', copyText: '' };
    var input = doc && typeof doc.getElementById === 'function' ? doc.getElementById('send_textarea') : null;
    if (!input || String(input.tagName || '').toUpperCase() !== 'TEXTAREA') {
      return { ok: false, error: '没有找到酒馆聊天输入框，请手动复制地点名', copyText: name };
    }
    var current = String(input.value === null || input.value === undefined ? '' : input.value);
    try { input.value = current + name; }
    catch (error) { return { ok: false, error: '地点名未能写入聊天输入框，请手动复制', copyText: name }; }
    try { input.selectionStart = input.selectionEnd = input.value.length; }
    catch (error) { /* The name is already appended; moving the caret is optional. */ }
    try {
      var EventConstructor = doc.defaultView && doc.defaultView.Event;
      if (typeof EventConstructor === 'function') {
        input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
      } else if (typeof doc.createEvent === 'function') {
        var inputEvent = doc.createEvent('Event');
        inputEvent.initEvent('input', true, false);
        input.dispatchEvent(inputEvent);
      }
    } catch (error) {
      return { ok: true, warning: '地点名已写入输入框，但输入事件通知失败：' + String(error && error.message ? error.message : error) };
    }
    return { ok: true };
  }

  function appendTrafficToChatInput(doc, rawComment) {
    var comment = String(rawComment === null || rawComment === undefined ? '' : rawComment).trim();
    if (!comment) return { ok: false, error: '没有可追加的交通备注', copyText: '' };
    var input = doc && typeof doc.getElementById === 'function' ? doc.getElementById('send_textarea') : null;
    if (!input || String(input.tagName || '').toUpperCase() !== 'TEXTAREA') {
      return { ok: false, error: '没有找到酒馆聊天输入框，请手动复制交通备注', copyText: comment };
    }
    var current = String(input.value === null || input.value === undefined ? '' : input.value);
    var separator = current && !/[\r\n]$/u.test(current) ? '\n' : '';
    input.value = current + separator + comment;
    try {
      var EventConstructor = doc.defaultView && doc.defaultView.Event;
      if (typeof EventConstructor === 'function') {
        input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
      } else if (typeof doc.createEvent === 'function') {
        var inputEvent = doc.createEvent('Event');
        inputEvent.initEvent('input', true, false);
        input.dispatchEvent(inputEvent);
      }
    } catch (error) {
      return {
        ok: true,
        warning: '交通备注已写入输入框，但输入事件通知失败：' + String(error && error.message ? error.message : error)
      };
    }
    return { ok: true };
  }


return { data: DATA, normalizeText, normalizeTagList, extractCurrentUserSelection, extractCurrentUserText, extractTagBodiesDetailed, extractTagBodies, stripExcludedTags, maskTrafficDurationForTimeChannel, parseDateState, parseTimeRangeState, parseTimeState, parseDaylightState, parseWeatherState, parsePlantState, parseHumidityState, findTriggerDetailed, dateWindowMatches, minuteWindowMatches, resolveLocationTimeFocusState, applyLocationTimeFocus, wrapLocationTimeFragments, stripLocationTimeFit, collectChannelEntries, resolveTimeStateDetailed, resolveTimeState, resolveNonTimeChannel, evaluateConditionRule, normalizeSettings, normalizeUIPreferences, normalizeTransitFavoritePlaces, emptyTextOverrides, normalizeTextOverrides, editableVariantsForPackage, resolveEffectiveBody, createOverrideRecord, serializeTextOverrides, parseTextOverrideImport, applyNamedPlaceInterests, getPlaceBodyRecords, getPlaceWalkingInterests, getStationAdministrativeRecord, getPlaceStationAdministrativeRecord, createLocationBrowserModel, getPlacePresentation, transitMapFavoritePlaces, assemblePrompt, outputTextForScript, requestGate, appendPlaceNameToChatInput, appendTrafficToChatInput, runEngine };
}
