/* Pure product-report calculations. No DOM, network or publication side effects. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductsSfCdModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const KNOWN = new Set(['observed', 'final', 'provisional']);
  const UNAVAILABLE = new Set(['outside_history', 'not_ready', 'not_fetched', 'no_data', 'unavailable', 'error']);
  const SEARCH_METRICS = new Set(['clicks', 'impressions', 'position']);
  const number = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const shift = (s, days) => new Date(Date.parse(s + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  function bucket(s, grain) {
    if (!validDate(s)) throw new Error('Invalid ISO date');
    if (grain === 'day') return s;
    if (grain === 'month') return s.slice(0, 7) + '-01';
    if (grain === 'week') return shift(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));
    throw new Error('Unsupported date grain');
  }
  function endOfBucket(period, grain) {
    if (grain === 'day') return period;
    if (grain === 'week') return shift(period, 6);
    if (grain === 'month') {
      const [year, month] = period.split('-').map(Number);
      return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    throw new Error('Invalid native period grain');
  }
  function validateNativePeriods(native, data, allowed) {
    if (!native || typeof native !== 'object' || Array.isArray(native)) throw new Error('Invalid BI periods');
    for (const [key, byGrain] of Object.entries(native)) {
      const spec = data.meta.biMetrics?.[key];
      if (!spec || !byGrain || typeof byGrain !== 'object' || Array.isArray(byGrain)) throw new Error('Invalid BI periods');
      for (const [grain, records] of Object.entries(byGrain)) {
        if (!allowed.includes(grain) || !Array.isArray(records)) throw new Error('Invalid BI periods');
        let previous = '';
        for (const r of records) {
          if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'from,period,to,value' || !validDate(r.period) || bucket(r.period, grain) !== r.period || r.period <= previous ||
              !validDate(r.from) || !validDate(r.to) || r.from !== (r.period < data.dates[0] ? data.dates[0] : r.period) ||
              r.to !== (endOfBucket(r.period, grain) > data.dates[data.dates.length - 1] ? data.dates[data.dates.length - 1] : endOfBucket(r.period, grain)) || r.from > r.to ||
              (r.value !== null && (typeof r.value !== 'number' || !Number.isFinite(r.value))) || (spec.available === false && r.value !== null)) throw new Error('Invalid BI period record');
          previous = r.period;
        }
      }
    }
  }
  function validateNativeInterval(interval, data) {
    if (!interval || typeof interval !== 'object' || Array.isArray(interval) || Object.keys(interval).sort().join(',') !== 'from,to,values' ||
        interval.from !== data.dates[0] || interval.to !== data.dates[data.dates.length - 1] ||
        !interval.values || typeof interval.values !== 'object' || Array.isArray(interval.values)) throw new Error('Invalid BI interval');
    for (const [key, value] of Object.entries(interval.values)) {
      const spec = data.meta.biMetrics?.[key];
      if (!spec || (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) || (spec.available === false && value !== null)) throw new Error('Invalid BI interval value');
    }
  }
  function validate(data) {
    if (!data || typeof data !== 'object' || !data.meta || !Array.isArray(data.dates) || !data.dates.length || !Array.isArray(data.pages) || !data.pages.length) throw new Error('Invalid report');
    for (let i = 0; i < data.dates.length; i++) {
      const date = data.dates[i];
      if (!validDate(date) || (i > 0 && date !== shift(data.dates[i - 1], 1))) throw new Error('Invalid date axis');
    }
    const ids = new Set(), urls = new Set();
    for (const [name, spec] of Object.entries(data.meta.biMetrics || {})) {
      if (!name || !spec || !['additive', 'non_additive', 'ratio'].includes(spec.aggregation) ||
          ['label', 'measure', 'dateBasis'].some((field) => typeof spec[field] !== 'string' || !spec[field].trim()) ||
          (spec.format !== undefined && !['number', 'rubles', 'percent_ratio'].includes(spec.format)) ||
          (spec.format === 'percent_ratio' && spec.aggregation !== 'ratio') ||
          (spec.available !== undefined && typeof spec.available !== 'boolean') ||
          (spec.available === false && (typeof spec.reason !== 'string' || !spec.reason.trim()))) throw new Error('Invalid BI definition');
    }
    for (const page of data.pages) {
      if (!page || typeof page.id !== 'string' || !page.id || ids.has(page.id) || !['sf', 'cd'].includes(page.school) || typeof page.name !== 'string' || !page.name.trim() || !['standard', 'hybrid'].includes(page.pageType || 'standard')) throw new Error('Invalid page');
      ids.add(page.id);
      let url;
      try { url = new URL(page.url); } catch (_) { throw new Error('Invalid page URL'); }
      const host = page.school === 'sf' ? 'skillfactory.ru' : 'contented.ru';
      if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash) throw new Error('Invalid page URL');
      const identity = url.hostname + (url.pathname.replace(/\/$/, '') || '/');
      if (urls.has(identity)) throw new Error('Duplicate page URL');
      urls.add(identity);
      for (const engine of ['gsc', 'webmaster']) {
        const series = page[engine];
        if (!series || ['clicks', 'impressions', 'position', 'status'].some((field) => !Array.isArray(series[field]) || series[field].length !== data.dates.length)) throw new Error('Invalid search series');
        for (let i = 0; i < data.dates.length; i++) {
          const status = series.status[i], clicks = series.clicks[i], impressions = series.impressions[i], position = series.position[i];
          if (engine === 'gsc' && status === 'provisional' && data.meta.sources?.gsc?.dataState === 'final') throw new Error('Preliminary GSC observation conflicts with final metadata');
          if ((!KNOWN.has(status) && !UNAVAILABLE.has(status)) || [clicks, impressions, position].some((v) => v !== null && !number(v)) ||
              [clicks, impressions].some((v) => v !== null && !Number.isSafeInteger(v)) ||
              (position !== null && position <= 0) || (impressions === 0 && position !== null)) throw new Error('Invalid search observation');
          if ((position !== null && impressions === null) || (clicks !== null && impressions !== null && clicks > impressions)) throw new Error('Search observation requires source review');
          if (UNAVAILABLE.has(status) && [clicks, impressions, position].some((v) => v !== null)) throw new Error('Unavailable observation has values');
        }
      }
      if (!page.bi || typeof page.bi !== 'object' || Array.isArray(page.bi)) throw new Error('Invalid BI series');
      for (const [key, series] of Object.entries(page.bi)) {
        const spec = data.meta.biMetrics?.[key];
        if (!spec || !['additive', 'non_additive', 'ratio'].includes(spec.aggregation) || !Array.isArray(series) || series.length !== data.dates.length || series.some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v))) || (spec.available === false && series.some((v) => v !== null))) throw new Error('Invalid BI metric');
      }
      if (page.biPeriods !== undefined) validateNativePeriods(page.biPeriods, data, ['week', 'month']);
      if (page.biInterval !== undefined) validateNativeInterval(page.biInterval, data);
    }
    if (data.biGroups !== undefined) {
      if (!data.biGroups || typeof data.biGroups !== 'object' || Array.isArray(data.biGroups)) throw new Error('Invalid BI groups');
      for (const [school, group] of Object.entries(data.biGroups)) {
        if (!['all', 'sf', 'cd'].includes(school) || !group || typeof group !== 'object' || Array.isArray(group) ||
            Object.keys(group).sort().join(',') !== 'interval,pageIds,periods' || !Array.isArray(group.pageIds)) throw new Error('Invalid BI group');
        const expected = data.pages.filter((p) => school === 'all' || p.school === school).map((p) => p.id).sort();
        if (!expected.length || group.pageIds.some((id) => typeof id !== 'string') || group.pageIds.length !== expected.length ||
            [...group.pageIds].sort().some((id, i) => id !== expected[i])) throw new Error('BI group page set differs from selection');
        validateNativeInterval(group.interval, data);
        validateNativePeriods(group.periods, data, ['day', 'week', 'month']);
      }
    }
    return data;
  }
  function selection(data, options) {
    const school = options.school || 'all', pageId = options.pageId || 'all';
    if (!['all', 'sf', 'cd'].includes(school)) throw new Error('Invalid school');
    const from = options.from || data.dates[0], to = options.to || data.dates[data.dates.length - 1];
    if (!validDate(from) || !validDate(to) || from > to) throw new Error('Invalid selection dates');
    const pages = data.pages.filter((page) => (school === 'all' || page.school === school) && (pageId === 'all' || page.id === pageId));
    const indices = [];
    for (let i = 0; i < data.dates.length; i++) if (from <= data.dates[i] && data.dates[i] <= to) indices.push(i);
    return { pages, indices, from, to, clipped: from < data.dates[0] || to > data.dates[data.dates.length - 1] };
  }
  function search(data, options = {}) {
    const metric = options.metric || 'clicks', grain = options.grain || 'day', engine = options.engine || 'all';
    if (!SEARCH_METRICS.has(metric) || !['all', 'gsc', 'webmaster'].includes(engine)) throw new Error('Invalid search selection');
    const selected = selection(data, options), engines = engine === 'all' ? ['gsc', 'webmaster'] : [engine];
    const groups = new Map();
    for (const index of selected.indices) {
      const day = data.dates[index], period = bucket(day, grain);
      if (!groups.has(period)) groups.set(period, []);
      groups.get(period).push(index);
    }
    const points = [];
    for (const [period, indices] of groups) for (const source of engines) {
      let sum = 0, observed = 0, numerator = 0, weightedImpressions = 0, knownImpressions = 0, zeroImpressionDays = 0, provisional = 0;
      for (const page of selected.pages) for (const i of indices) {
        const s = page[source];
        if (!KNOWN.has(s.status[i])) continue;
        if (metric === 'position') {
          if (s.impressions[i] !== null) knownImpressions += s.impressions[i];
          if (s.impressions[i] === 0) { zeroImpressionDays++; continue; }
          if (s.impressions[i] === null || s.position[i] === null) continue;
          observed++;
          if (s.status[i] === 'provisional') provisional++;
          numerator += s.position[i] * s.impressions[i]; weightedImpressions += s.impressions[i];
        } else if (s[metric][i] !== null) {
          observed++;
          if (s.status[i] === 'provisional') provisional++;
          sum += s[metric][i];
        }
      }
      const expected = selected.pages.length * indices.length;
      const value = metric === 'position' ? (weightedImpressions ? numerator / weightedImpressions : null) : (observed ? sum : null);
      points.push({ period, from: data.dates[indices[0]], to: data.dates[indices[indices.length - 1]], engine: source,
                    metric, value, coverage: { observed, expected, weightedImpressions, knownImpressions, zeroImpressionDays, provisional,
                      complete: expected > 0 && observed + (metric === 'position' ? zeroImpressionDays : 0) === expected } });
    }
    return { points, pages: selected.pages.length, clipped: selected.clipped, metric, grain, engine };
  }
  function bi(data, options = {}) {
    const metric = options.metric, grain = options.grain || 'day';
    const spec = data.meta.biMetrics?.[metric];
    if (!spec || !['additive', 'non_additive', 'ratio'].includes(spec.aggregation) || spec.available === false) return { points: [], available: false, reason: 'metric_not_available', attribution: 'organic_all_engines' };
    const selected = selection(data, options), groups = new Map();
    for (const index of selected.indices) {
      const period = bucket(data.dates[index], grain);
      if (!groups.has(period)) groups.set(period, []);
      groups.get(period).push(index);
    }
    const points = [];
    for (const [period, indices] of groups) {
      let sum = 0, observed = 0;
      for (const page of selected.pages) for (const i of indices) {
        const value = page.bi[metric]?.[i];
        if (typeof value === 'number' && Number.isFinite(value)) { sum += value; observed++; }
      }
      const expected = selected.pages.length * indices.length;
      const from = data.dates[indices[0]], to = data.dates[indices[indices.length - 1]];
      const mayAggregate = spec.aggregation === 'additive' || expected === 1;
      const nativeOwner = (options.pageId || 'all') === 'all' ? data.biGroups?.[options.school || 'all'] : selected.pages.length === 1 ? selected.pages[0] : null;
      const nativePeriods = (options.pageId || 'all') === 'all' ? nativeOwner?.periods : nativeOwner?.biPeriods;
      const native = !mayAggregate ? nativePeriods?.[metric]?.[grain]?.find((r) => r.period === period && r.from === from && r.to === to) : null;
      const result = native ? native.value : (observed && mayAggregate ? sum : null);
      points.push({ period, from, to, value: result, aggregation: spec.aggregation,
                    coverage: { observed, expected, complete: expected > 0 && observed === expected, nativePeriod: !!native },
                    reason: native ? (result === null ? 'source_unavailable' : null) : (mayAggregate ? null : 'non_additive_requires_interval_measure') });
    }
    return { points, available: true, attribution: 'organic_all_engines', clipped: selected.clipped };
  }
  function biInterval(data, options = {}) {
    const metric = options.metric, spec = data.meta.biMetrics?.[metric];
    if (!spec || spec.available === false) return null;
    const selected = selection(data, options);
    const owner = (options.pageId || 'all') === 'all' ? data.biGroups?.[options.school || 'all'] : selected.pages.length === 1 ? selected.pages[0] : null;
    const interval = owner?.interval || owner?.biInterval;
    if (!interval || interval.from !== selected.from || interval.to !== selected.to || !Object.hasOwn(interval.values, metric)) return null;
    let observed = 0;
    for (const page of selected.pages) for (const i of selected.indices) if (typeof page.bi[metric]?.[i] === 'number') observed++;
    const expected = selected.pages.length * selected.indices.length;
    return {value: interval.values[metric], observed, expected, nativePeriod: true};
  }
  return { validate, bucket, selection, search, bi, biInterval };
});
