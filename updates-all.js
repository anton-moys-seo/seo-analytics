/* Апдейты ALL. Изолированный контракт media-updates-all-v1, защищённый loadJSON. */
(function () {
  'use strict';
  const DAY = 86400000, DATE_FROM = '2025-06-01';
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const shift = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
  const integer = (v) => Number.isSafeInteger(v) && v >= 0;
  const position = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  function safeUrl(value) {
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch (_) { return null; }
  }
  function canonical(value) {
    const safe = safeUrl(value); if (!safe) return null;
    const u = new URL(safe);
    // The backend merges protocol/www/tracking variants into one exact article.
    return 'https://' + u.host.toLowerCase().replace(/^www\./, '') + (u.pathname.replace(/\/+$/, '') || '/');
  }
  function bucket(date, grain) {
    if (grain === 'month') return date.slice(0, 7) + '-01';
    if (grain === 'week') return shift(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7));
    return date;
  }
  const fail = (code) => { throw new Error('UPA_' + code); };
  function sourceRows(rows) {
    if (!Array.isArray(rows) || rows.some((n) => !integer(n))) fail('SOURCE_ROWS');
    return [...new Set(rows)].sort((a, b) => a - b);
  }
  const mergedRows = (a, b) => sourceRows([...a, ...b]);
  function engine(raw, name, length) {
    const allowed = name === 'gsc' ? ['final', 'provisional', 'outside_history', 'not_ready', 'not_fetched'] : ['observed', 'outside_history', 'not_ready', 'not_fetched'];
    if (!raw || !raw.meta || typeof raw.meta !== 'object' || Array.isArray(raw.meta)) fail('ENGINE_META');
    for (const key of ['position', 'impressions', 'clicks', 'status']) if (!Array.isArray(raw[key]) || raw[key].length !== length) fail('ENGINE_LENGTH');
    for (let i = 0; i < length; i++) {
      if (!allowed.includes(raw.status[i]) || (raw.position[i] !== null && !position(raw.position[i])) || (raw.impressions[i] !== null && !integer(raw.impressions[i])) || (raw.clicks[i] !== null && !integer(raw.clicks[i]))) fail('ENGINE_VALUE');
      const measured = ['final', 'observed', 'provisional'].includes(raw.status[i]);
      if (measured && (raw.impressions[i] === null || (raw.impressions[i] > 0 && raw.position[i] === null) || (raw.impressions[i] === 0 && raw.position[i] !== null))) fail('MEASURED_VALUE');
      if (!measured && [raw.position[i], raw.impressions[i], raw.clicks[i]].some((v) => v !== null)) fail('UNMEASURED_VALUE');
    }
    return { ...raw, position: raw.position.slice(), impressions: raw.impressions.slice(), clicks: raw.clicks.slice(), status: raw.status.slice(), meta: { ...raw.meta } };
  }
  function normalize(raw) {
    const m = raw?.meta;
    if (!m || m.contractVersion !== 'media-updates-all-v1' || m.dateFrom !== DATE_FROM || !isDate(m.asOf) || m.asOf < DATE_FROM || !safeUrl(m.sourceUrl) || !m.sourceStats || typeof m.sourceStats !== 'object' || Array.isArray(m.sourceStats) || !/^[a-f\d]{64}$/i.test(m.sourceSha256 || '') || !Number.isFinite(Date.parse(m.sourceFetchedAt)) || !['string', 'number'].includes(typeof m.counterId) || typeof m.attribution !== 'string' || typeof m.metric !== 'string' || ![true, false, null].includes(m.sampled) || !Object.prototype.hasOwnProperty.call(m, 'reconciled')) fail('META');
    if (m.sourceAvailable === false && m.sourceCacheUsed !== true) fail('SOURCE_UNAVAILABLE');
    if (!Array.isArray(raw.dates) || !raw.dates.length || raw.dates[0] !== DATE_FROM || raw.dates[raw.dates.length - 1] !== m.asOf || raw.dates.some((d, i) => !isDate(d) || (i > 0 && d !== shift(raw.dates[i - 1], 1)))) fail('DATES');
    if (!Array.isArray(raw.pages)) fail('PAGES');
    const unique = new Map(), ids = new Map();
    for (const input of raw.pages) {
      if (!input || typeof input.id !== 'string' || !input.id || input.id === 'all' || !canonical(input.url) || typeof input.path !== 'string' || typeof input.title !== 'string' || typeof input.section !== 'string' || !Array.isArray(input.updates) || !Array.isArray(input.seo) || input.seo.length !== raw.dates.length || input.seo.some((v) => v !== null && !integer(v))) fail('PAGE');
      const key = canonical(input.url);
      if (ids.has(input.id) && ids.get(input.id) !== key) fail('PAGE_ID');
      ids.set(input.id, key);
      const events = new Map();
      for (const e of input.updates) {
        if (!e || !isDate(e.date)) fail('EVENT');
        const rows = sourceRows(e.sourceRows);
        events.set(e.date, { date: e.date, sourceRows: mergedRows(events.get(e.date)?.sourceRows || [], rows) });
      }
      const page = { ...input, canonical: key, ids: [input.id], sourceRows: sourceRows(input.sourceRows), undatedRows: sourceRows(input.undatedRows), seo: input.seo.slice(), gsc: engine(input.gsc, 'gsc', raw.dates.length), webmaster: engine(input.webmaster, 'webmaster', raw.dates.length), allUpdates: [...events.values()].sort((a, b) => a.date.localeCompare(b.date)) };
      if (unique.has(key)) {
        const old = unique.get(key);
        old.ids = [...new Set([...old.ids, input.id])]; old.sourceRows = mergedRows(old.sourceRows, page.sourceRows); old.undatedRows = mergedRows(old.undatedRows, page.undatedRows);
        for (let i = 0; i < raw.dates.length; i++) {
          if (old.seo[i] !== null && page.seo[i] !== null && old.seo[i] !== page.seo[i]) fail('DUPLICATE_CONFLICT');
          if (old.seo[i] === null) old.seo[i] = page.seo[i];
          for (const name of ['gsc', 'webmaster']) {
            const a = old[name], b = page[name];
            for (const field of ['position', 'impressions', 'clicks']) if (a[field][i] !== null && b[field][i] !== null && a[field][i] !== b[field][i]) fail('DUPLICATE_CONFLICT');
            const rank = (s) => ['final', 'observed'].includes(s) ? 3 : s === 'provisional' ? 2 : 0;
            if (rank(b.status[i]) > rank(a.status[i])) for (const field of ['position', 'impressions', 'clicks', 'status']) a[field][i] = b[field][i];
          }
        }
        const combined = new Map(old.allUpdates.map((e) => [e.date, e]));
        for (const e of page.allUpdates) combined.set(e.date, { date: e.date, sourceRows: mergedRows(combined.get(e.date)?.sourceRows || [], e.sourceRows) });
        old.allUpdates = [...combined.values()].sort((a, b) => a.date.localeCompare(b.date));
      } else unique.set(key, page);
    }
    const pages = [...unique.values()].map((p) => ({ ...p, title: p.title || p.path || p.url, updates: p.allUpdates.filter((e) => e.date <= m.asOf), futureUpdates: p.allUpdates.filter((e) => e.date > m.asOf), hasUndated: p.allUpdates.length === 0 }));
    return { meta: { ...m }, dates: raw.dates.slice(), pages, dateIndex: new Map(raw.dates.map((d, i) => [d, i])) };
  }
  function cohort(data, filters = {}) {
    const { month = 'all', q = '', section = 'all', article = 'all' } = filters;
    const query = q.trim().toLocaleLowerCase('ru');
    return data.pages.filter((p) => (month === 'all' || (month === 'undated' ? p.hasUndated : p.allUpdates.some((e) => e.date.startsWith(month)))) && (section === 'all' || p.section === section) && (article === 'all' || p.ids.includes(article)) && (!query || `${p.title} ${p.path} ${p.url}`.toLocaleLowerCase('ru').includes(query)));
  }
  function weighted(data, page, name, dates, signal = true) {
    const e = page[name], allowed = signal ? (name === 'gsc' ? ['final'] : ['observed']) : (name === 'gsc' ? ['final', 'provisional'] : ['observed']);
    let sum = 0, impressions = 0, measured = 0, provisional = 0;
    for (const date of dates) {
      const i = data.dateIndex.get(date);
      if (i === undefined || !allowed.includes(e.status[i]) || e.impressions[i] === null) continue;
      measured++; if (e.status[i] === 'provisional') provisional++;
      if (e.impressions[i] > 0 && position(e.position[i])) { sum += e.position[i] * e.impressions[i]; impressions += e.impressions[i]; }
    }
    const complete = dates.length > 0 && measured === dates.length;
    return { position: impressions > 0 && (!signal || complete) ? sum / impressions : null, impressions: measured > 0 ? impressions : null, measured, expected: dates.length, complete, provisional };
  }
  function classify(row) {
    if (!(row.n > 0) || !Number.isFinite(row.pre) || !Number.isFinite(row.post) || row.pre < 0 || row.post < 0) return { traffic: 'no-data', signal: 'no-data', engines: [] };
    let traffic = row.post > row.pre ? 'growth' : row.post === row.pre ? 'stable' : 'warning';
    if (row.pre > row.post) {
      const severe = Number.isSafeInteger(row.pre) && Number.isSafeInteger(row.post)
        ? 5n * (BigInt(row.pre) - BigInt(row.post)) > BigInt(row.pre)
        : (row.pre - row.post) * 5 - row.pre > Math.max(1, row.pre) * 1e-12;
      traffic = severe ? 'severe' : 'warning';
    }
    const available = ['gsc', 'webmaster'].filter((name) => row[name]?.complete && row[name].pre !== null && row[name].post !== null);
    const engines = available.filter((name) => row[name].post > row[name].pre + 1e-9);
    const eligible = row.n >= 7 && available.length > 0;
    return { traffic, signal: !eligible ? 'no-data' : ['severe', 'warning'].includes(traffic) && engines.length ? traffic : 'no-signal', engines, available };
  }
  function compare(data, page, event, days = 28) {
    days = [7, 14, 28].includes(days) ? days : 28;
    const date = event?.date || null, index = page.updates.findIndex((e) => e.date === date);
    const previous = index > 0 ? page.updates[index - 1].date : null, next = page.updates[index + 1]?.date || null;
    const available = (direction) => {
      if (!date || date > data.meta.asOf) return 0;
      let n = 0;
      for (let j = 1; j <= days; j++) {
        const d = shift(date, j * direction), i = data.dateIndex.get(d);
        if (d > data.meta.asOf || (previous && d <= previous) || (next && d >= next) || i === undefined || !integer(page.seo[i])) break;
        n++;
      }
      return n;
    };
    const before = available(-1), after = available(1), n = Math.min(before, after, days);
    const preDates = Array.from({ length: n }, (_, i) => shift(date, -n + i)), postDates = Array.from({ length: n }, (_, i) => shift(date, i + 1));
    const total = (dates) => dates.reduce((sum, d) => sum + page.seo[data.dateIndex.get(d)], 0);
    const row = { page, date, sourceRows: event?.sourceRows || page.undatedRows, n, days, before, after, previous, next, preDates, postDates, pre: n ? total(preDates) : null, post: n ? total(postDates) : null };
    row.delta = row.pre > 0 ? (row.post - row.pre) / row.pre : null;
    for (const name of ['gsc', 'webmaster']) {
      const a = weighted(data, page, name, preDates), b = weighted(data, page, name, postDates);
      row[name] = { pre: a.position, post: b.position, delta: a.position !== null && b.position !== null ? b.position - a.position : null, complete: a.complete && b.complete && a.position !== null && b.position !== null, before: a, after: b };
    }
    Object.assign(row, classify(row)); return row;
  }
  function eventRows(data, pages, filters = {}, days = 28) {
    const month = filters.month || 'all';
    let rows = pages.flatMap((p) => {
      const events = month === 'undated' ? [] : p.updates.filter((e) => month === 'all' || e.date.startsWith(month));
      const result = events.map((e) => compare(data, p, e, days));
      if ((month === 'all' || month === 'undated') && p.hasUndated) result.push(compare(data, p, null, days));
      if (!result.length && month !== 'undated' && p.futureUpdates.some((e) => month === 'all' || e.date.startsWith(month))) result.push({ ...compare(data, p, null, days), futureOnly: true });
      return result;
    });
    const status = filters.status || 'all';
    if (status === 'needs-revision') rows = rows.filter((r) => ['warning', 'severe'].includes(r.signal));
    else if (status !== 'all') rows = rows.filter((r) => r.signal === status);
    return rows;
  }
  function markers(pages, from, to) {
    const dates = new Map();
    for (const p of pages) for (const e of p.updates) {
      if (e.date < from || e.date > to) continue;
      if (!dates.has(e.date)) dates.set(e.date, new Map());
      dates.get(e.date).set(p.canonical, { id: p.id, title: p.title, url: p.url, sourceRows: e.sourceRows });
    }
    return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, pagesByUrl]) => ({ date, count: pagesByUrl.size, articles: [...pagesByUrl.values()] }));
  }
  function aggregate(data, pages, from = DATE_FROM, to = data.meta.asOf, grain = 'day') {
    const groups = new Map();
    // iterate actual days, not event months; every requested date remains on both axes.
    for (const date of data.dates) {
      if (date < from || date > to) continue;
      const key = bucket(date, grain);
      if (!groups.has(key)) groups.set(key, { key, start: date, end: date, dates: [] });
      const g = groups.get(key); g.end = date; g.dates.push(date);
    }
    return [...groups.values()].map((g) => {
      let traffic = pages.length ? 0 : null, trafficMeasured = 0;
      for (const date of g.dates) for (const p of pages) {
        const v = p.seo[data.dateIndex.get(date)];
        if (v === null) traffic = null; else { trafficMeasured++; if (traffic !== null) traffic += v; }
      }
      const result = { ...g, traffic, trafficMeasured, trafficExpected: g.dates.length * pages.length };
      for (const name of ['gsc', 'webmaster']) {
        let numerator = 0, impressions = 0, measured = 0, provisional = 0;
        const expected = pages.length * g.dates.length;
        for (const p of pages) {
          const w = weighted(data, p, name, g.dates, false);
          measured += w.measured; provisional += w.provisional; impressions += w.impressions || 0;
          if (w.position !== null) numerator += w.position * w.impressions;
        }
        result[name] = { position: expected > 0 && impressions > 0 ? numerator / impressions : null, impressions: measured > 0 ? impressions : null, measured, expected, provisional, complete: expected > 0 && measured === expected };
      }
      return result;
    });
  }
  const analysis = Object.freeze({ normalize, canonical, safeUrl, cohort, compare, comparison: compare, classify, classification: classify, weighted, aggregate, markers, eventRows, bucket, isDate, shift, dateFrom: DATE_FROM });
  if (typeof module !== 'undefined' && module.exports) module.exports = analysis;
  if (typeof window === 'undefined') return;
  window.UpdatesAllAnalysis = analysis;

  const $ = (id) => document.getElementById(id);
  const active = () => typeof state !== 'undefined' && state.view === 'updates-all';
  const ui = { data: null, phase: 'idle', pending: null, bound: false, month: 'all', section: 'all', q: '', article: 'all', status: 'all', days: 28, grain: 'day', from: null, to: null, sort: 'date', direction: -1, page: 0, focusEvent: null };
  const PAGE_SIZE = 20;
  const fmt = (n, digits = 0) => n === null || n === undefined || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n).replace(/[\u00a0\u202f]/g, ' ');
  const capitalize = (text) => text ? text[0].toLocaleUpperCase('ru') + text.slice(1) : text;
  const sectionNames = { code: 'Код', design: 'Дизайн', marketing: 'Маркетинг', business: 'Бизнес', growth: 'Развитие', education: 'Образование', gamedev: 'Геймдев', management: 'Управление', money: 'Деньги' };
  const dateLabel = (d) => isDate(d) ? d.split('-').reverse().join('.') : 'Без даты';
  const names = { gsc: 'Google Search Console', webmaster: 'Яндекс Вебмастер' };
  const statusLabels = { severe: 'Нужна доработка · падение > 20%', warning: 'Нужна доработка · падение до 20%', 'no-data': 'Недостаточно данных для сигнала', 'no-signal': 'Сигнал не выявлен' };
  const trafficLabels = { severe: 'Падение > 20%', warning: 'Падение до 20%', growth: 'Рост', stable: 'Без изменений', 'no-data': 'Нет сравнения' };
  const schemaLabels = { UPA_META: 'Некорректные метаданные', UPA_DATES: 'Неполный календарь данных', UPA_DUPLICATE_CONFLICT: 'Противоречивые данные повторного URL' };
  function readState() {
    const p = new URLSearchParams(location.search);
    if (p.get('view') !== 'updates-all') return;
    ui.month = ['all', 'undated'].includes(p.get('month')) || /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get('month') || '') ? p.get('month') : 'all';
    ui.section = p.get('section') || 'all'; ui.article = p.get('article') || 'all'; ui.q = p.get('q') || '';
    ui.status = ['all', 'needs-revision', 'severe', 'warning', 'no-data'].includes(p.get('status')) ? p.get('status') : 'all';
    ui.days = [7, 14, 28].includes(Number(p.get('window'))) ? Number(p.get('window')) : 28;
    ui.grain = ['day', 'week', 'month'].includes(p.get('grain')) ? p.get('grain') : 'day';
    ui.from = isDate(p.get('from')) ? p.get('from') : null; ui.to = isDate(p.get('to')) ? p.get('to') : null;
    ui.sort = ['date', 'title', 'delta', 'gsc', 'webmaster', 'status'].includes(p.get('sort')) ? p.get('sort') : 'date';
    ui.direction = p.get('dir') === 'asc' ? 1 : -1;
    ui.page = /^\d+$/.test(p.get('page') || '') ? Math.max(0, Math.min(100000, Number(p.get('page')) - 1)) : 0;
    ui.focusEvent = isDate(p.get('event')) ? p.get('event') : null;
  }
  function updateUrl() {
    if (!active()) return;
    const p = new URLSearchParams(location.search);
    // Preserve access hash and unrelated parameters, remove only this tab's owned keys.
    for (const key of ['month', 'section', 'article', 'q', 'status', 'window', 'grain', 'from', 'to', 'sort', 'dir', 'page', 'event', 'tail']) p.delete(key);
    p.set('view', 'updates-all');
    for (const key of ['month', 'section', 'article', 'status']) if (ui[key] !== 'all') p.set(key, ui[key]);
    if (ui.q) p.set('q', ui.q);
    p.set('window', String(ui.days)); p.set('grain', ui.grain);
    if (ui.from) p.set('from', ui.from); if (ui.to) p.set('to', ui.to);
    p.set('sort', ui.sort); p.set('dir', ui.direction === 1 ? 'asc' : 'desc');
    if (ui.page) p.set('page', String(ui.page + 1)); if (ui.focusEvent) p.set('event', ui.focusEvent);
    history.replaceState(null, '', `${location.pathname}?${p.toString()}${location.hash}`);
  }
  function option(select, value, label, selected) {
    const n = document.createElement('option'); n.value = value; n.textContent = label; n.selected = value === selected; select.appendChild(n);
  }
  function selectOptions(id, options, value) {
    const select = $(id); select.replaceChildren();
    for (const [v, label] of options) option(select, v, label, value);
    if (!options.some(([v]) => v === value)) option(select, value, `${value} · нет совпадений`, value);
  }
  function availability() {
    if (!$('upa-status')) return;
    $('upa-status').hidden = ui.phase === 'ready'; $('upa-content').hidden = ui.phase !== 'ready';
    $('upa-status-text').textContent = ui.phase === 'loading' ? 'Загружаем Апдейты ALL.' : ui.phase === 'empty' ? 'В новом источнике пока нет статей. Остальные вкладки работают.' : `Апдейты ALL недоступны. ${ui.errorLabel || 'Не удалось загрузить или проверить данные.'} Остальные вкладки работают.`;
    $('upa-retry').hidden = !['unavailable', 'empty'].includes(ui.phase);
  }
  function scope() {
    const base = cohort(ui.data, { ...ui, article: 'all' });
    // Keep an exact empty selection from a shared URL rather than silently switching articles.
    const selected = ui.article === 'all' ? base : base.filter((p) => p.ids.includes(ui.article));
    const rows = eventRows(ui.data, selected, ui, ui.days);
    const shown = ui.status === 'all' ? selected : selected.filter((p) => rows.some((r) => r.page.canonical === p.canonical));
    return { base, shown, rows };
  }
  function renderControls(s) {
    const months = [...new Set(ui.data.pages.flatMap((p) => p.allUpdates.map((e) => e.date.slice(0, 7))))].sort().reverse();
    selectOptions('upa-month', [['all', 'Все месяцы'], ['undated', 'Без даты'], ...months.map((m) => [m, capitalize(new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-01')))])], ui.month);
    selectOptions('upa-section', [['all', 'Все разделы'], ...[...new Set(ui.data.pages.map((p) => p.section))].sort().map((v) => [v, sectionNames[v] || capitalize(v) || 'Раздел не указан'])], ui.section);
    selectOptions('upa-article', [['all', `Все статьи (${s.base.length})`], ...s.base.map((p) => [p.id, p.title === p.path ? p.path : `${p.title} · ${p.path}`])], ui.article);
    for (const [id, value] of [['upa-search', ui.q], ['upa-window', ui.days], ['upa-grain', ui.grain], ['upa-filter-status', ui.status]]) $(id).value = value;
    const clamp = (d, fallback) => !isDate(d) ? fallback : d < DATE_FROM ? DATE_FROM : d > ui.data.meta.asOf ? ui.data.meta.asOf : d;
    ui.from = clamp(ui.from, DATE_FROM); ui.to = clamp(ui.to, ui.data.meta.asOf);
    if (ui.from > ui.to) [ui.from, ui.to] = [ui.to, ui.from];
    for (const [id, value] of [['upa-from', ui.from], ['upa-to', ui.to]]) { $(id).value = value; $(id).min = DATE_FROM; $(id).max = ui.data.meta.asOf; }
    $('upa-scope-note').textContent = `Статей на графиках: ${s.shown.length}. Событий и строк без даты: ${s.rows.length}. Каждый канонический URL учитываем один раз. Месяц апдейта не сокращает период графика.`;
  }
  function renderSources() {
    const m = ui.data.meta, all = ui.data.pages;
    const histories = (name, statuses) => {
      const dates = ui.data.dates.filter((d, i) => all.some((p) => statuses.includes(p[name].status[i])));
      return dates.length ? `${dateLabel(dates[0])}–${dateLabel(dates[dates.length - 1])}` : 'измерений нет';
    };
    const gscRange = histories('gsc', ['final', 'provisional']), wmRange = histories('webmaster', ['observed']);
    const incomplete = all.some((p) => p.webmaster.status.some((s) => s !== 'observed'));
    const provisionalDates = ui.data.dates.filter((d, i) => all.some((p) => p.gsc.status[i] === 'provisional'));
    $('upa-history-warning').hidden = !incomplete && !provisionalDates.length;
    $('upa-history-warning').textContent = [
      incomplete ? `История Яндекс Вебмастера ограничена: доступные измерения ${wmRange}. Используем доступную историю; расширенный экспорт не выполнен, лимит — 100 URL-дней в сутки. Пропуски не заменяем нулями; для многих апдейтов сигнал по Яндексу рассчитать нельзя.` : '',
      provisionalDates.length ? `Предварительные дни GSC: ${provisionalDates.map(dateLabel).join(', ')}. Показываем их на графике, но не используем для сигнала доработки.` : '',
    ].filter(Boolean).join(' ');
    const dated = all.filter((p) => p.allUpdates.length).length, undated = all.length - dated;
    const mixedRows = all.filter((p) => p.allUpdates.length && p.undatedRows.length).reduce((sum, p) => sum + p.undatedRows.length, 0);
    const fetched = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(m.sourceFetchedAt)).replace(/[\u00a0\u202f]/g, ' ');
    const sourceLink = new URL(m.sourceUrl);
    if (sourceLink.hostname === 'docs.google.com' && sourceLink.pathname.endsWith('/export')) { sourceLink.pathname = sourceLink.pathname.replace(/\/export$/, '/edit'); sourceLink.searchParams.delete('format'); }
    const attribution = m.attribution === 'cross_device_last_significant' ? 'Последний значимый переход, кросс-девайс' : m.attribution;
    const finalDates = [...new Set(all.map((p) => p.gsc.meta.finalThrough).filter(Boolean))].map(dateLabel).join(', ');
    $('upa-source').innerHTML = `<p>Список: <a href="${esc(sourceLink.href)}" target="_blank" rel="noopener noreferrer">лист «апдейт» в Google Sheets</a>. Уникальных статей: ${fmt(all.length)}, с датой обновления: ${fmt(dated)}, без даты: ${fmt(undated)}. Исходных строк с URL: ${fmt(m.sourceStats.urlRows)}, из них с датой: ${fmt(m.sourceStats.datedRows)}, без даты: ${fmt(m.sourceStats.undatedRows)}.</p><p>Срез трафика: ${dateLabel(m.asOf)}. Список загружен: ${esc(fetched)} МСК. Метрика: ${esc(m.metric)}; счётчик ${esc(m.counterId)}; атрибуция: ${esc(attribution)}. Все регионы и устройства. Часовой пояс Метрики: ${esc(m.timezone || 'Europe/Moscow')}. Семплирование: ${m.sampled === false ? 'нет' : m.sampled === true ? 'есть' : 'не указано'}. Сверка: ${m.reconciled === true ? 'пройдена' : 'не подтверждена'}.</p><p>GSC: ${gscRange}. Завершённые данные по ${esc(finalDates || 'статусу каждого дня')}. Предварительные дни: ${provisionalDates.length ? provisionalDates.map(dateLabel).join(', ') : 'нет'}. Вебмастер: ${wmRange}. Часовой пояс GSC: ${esc([...new Set(all.map((p) => p.gsc.meta.timezone).filter(Boolean))].join(', ') || 'America/Los_Angeles')}; границы суток могут отличаться от Метрики.</p><details><summary>Проверка списка статей</summary><p>Повторных строк с URL: ${fmt(m.sourceStats.duplicateUrlRows)}. Строк с датой: ${fmt(m.sourceStats.datedRows)}, без даты: ${fmt(m.sourceStats.undatedRows)}. Из строк без даты ${fmt(mixedRows)} относятся к статьям с датой в другой строке. Такие URL учитываем по дате, без дополнительной строки или включения в фильтр «Без даты».</p><p>SHA-256: <code>${esc(m.sourceSha256)}</code></p></details>`;
    const futures = all.flatMap((p) => p.futureUpdates.map((e) => ({ p, e }))).filter(({ p, e }) => (ui.month === 'all' || e.date.startsWith(ui.month)) && (ui.section === 'all' || p.section === ui.section) && (ui.article === 'all' || p.ids.includes(ui.article)) && (!ui.q || `${p.title} ${p.url}`.toLocaleLowerCase('ru').includes(ui.q.toLocaleLowerCase('ru'))));
    $('upa-future').hidden = !futures.length;
    $('upa-future').innerHTML = `<span class="upa-badge">Будущие даты: ${futures.length}</span><p>Даты позже среза ${dateLabel(m.asOf)} сохранены отдельно и не участвуют в сравнениях.</p><details><summary>Показать будущие обновления</summary><ul>${futures.map(({ p, e }) => `<li>${dateLabel(e.date)} · ${esc(p.title)} · ${esc(p.url)}</li>`).join('')}</ul></details>`;
  }
  function renderKpis(s, groups) {
    const needs = s.rows.filter((r) => ['severe', 'warning'].includes(r.signal));
    const complete = groups.length && groups.every((g) => g.traffic !== null);
    const visits = complete ? groups.reduce((sum, g) => sum + g.traffic, 0) : null;
    const cards = [['Статьи', fmt(s.shown.length), 'Уникальные канонические URL'], ['SEO-трафик', fmt(visits), visits === null ? 'Есть пропуски измерений' : `${dateLabel(ui.from)}–${dateLabel(ui.to)}`], ['Нужна доработка', fmt(needs.length), `Сильное падение: ${needs.filter((r) => r.signal === 'severe').length}`], ['Нет данных для сигнала', fmt(s.rows.filter((r) => r.signal === 'no-data').length), 'Не считаем положительным результатом']];
    $('upa-kpis').innerHTML = cards.map(([label, value, caption]) => `<div class="kpi-card"><span class="kpi-label">${label}</span><div><div class="kpi-value">${value}</div><div class="kpi-caption">${caption}</div></div></div>`).join('');
  }
  function coverageLabel(v) {
    const label = !v.measured ? 'Нет измерений' : v.complete ? 'Полное' : 'Частичное';
    return `${label}: ${v.measured}/${v.expected} URL-дней${v.provisional ? `; предварительных: ${v.provisional}` : ''}`;
  }
  const GRAPH_METHOD = 'Позиции по дням, неделям и месяцам взвешиваем по показам известных измерений, не усредняем дневные средние. На графиках учитываем доступные URL-дни даже при неполной истории; показываем фактическое и ожидаемое покрытие. Состав измеренных URL может меняться. Разрыв означает, что нет известных позиций с положительными показами. Для сравнения до и после и сигнала по-прежнему нужно полное парное окно. Срез источника указан над графиком. Для анализа одной статьи выберите её в списке или таблице.';
  function drawChart(id, groups, eventMarkers, positions = false) {
    const node = $(id); if (!groups.length) { node.innerHTML = '<p>Нет дат для графика.</p>'; return; }
    if (positions) {
      const summary = (name) => {
        const total = groups.reduce((a, g) => ({ measured: a.measured + g[name].measured, expected: a.expected + g[name].expected, provisional: a.provisional + g[name].provisional }), { measured: 0, expected: 0, provisional: 0 });
        return coverageLabel({ ...total, complete: total.expected > 0 && total.measured === total.expected });
      };
      const caption = node.closest('.chart-card')?.querySelector('.card-heading p');
      if (caption) caption.textContent = `Меньше — лучше. Взвешиваем по показам доступных измерений; состав URL может меняться. GSC: ${summary('gsc')}. Яндекс: ${summary('webmaster')}. Разрыв — нет известных позиций с положительными показами. Срез источника: ${dateLabel(ui.data.meta.asOf)}. Предварительные GSC-дни — полые точки, без сигнала доработки.`;
      const method = [...document.querySelectorAll('#updates-all .upa-method li')].find((li) => li.textContent.startsWith('Позиции по дням, неделям и месяцам'));
      if (method) method.textContent = GRAPH_METHOD;
    }
    // Keep SVG text legible on a 380px screen instead of shrinking a 1200px canvas.
    const width = Math.max(420, Math.min(1200, node.clientWidth || window.innerWidth || 1200));
    const height = width < 640 ? 340 : 390, left = width < 640 ? 60 : 72, right = width < 640 ? 12 : 28, top = 42, bottom = 54, iw = width - left - right, ih = height - top - bottom;
    const fromTime = Date.parse(ui.from), toTime = Date.parse(ui.to), span = Math.max(DAY, toTime - fromTime);
    const xDate = (d) => left + (toTime === fromTime ? iw / 2 : (Date.parse(d) - fromTime) / span * iw);
    const x = (g) => xDate(new Date((Date.parse(g.start) + Date.parse(g.end)) / 2).toISOString().slice(0, 10));
    const series = positions ? [{ key: 'gsc', label: names.gsc, cls: 'upa-line-gsc' }, { key: 'webmaster', label: names.webmaster, cls: 'upa-line-wm' }] : [{ key: 'traffic', label: 'SEO-трафик', cls: 'upa-line-traffic' }];
    const value = (g, s) => positions ? g[s.key].position : g.traffic;
    const values = groups.flatMap((g) => series.map((s) => value(g, s)).filter((v) => v !== null));
    const min = positions ? Math.max(1, Math.floor(Math.min(...(values.length ? values : [1])))) : 0;
    const max = positions ? Math.max(min + 1, Math.ceil(Math.max(...(values.length ? values : [2])))) : Math.max(1, Math.ceil(Math.max(...(values.length ? values : [1])) * 1.08));
    const y = (v) => top + (positions ? (v - min) / (max - min) : 1 - v / max) * ih;
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${positions ? 'Средняя позиция: меньше — выше на графике' : 'SEO-трафик'} с ${dateLabel(ui.from)} по ${dateLabel(ui.to)}"><text x="${left}" y="18" class="upa-axis-label">${positions ? 'Средняя позиция · меньше лучше' : 'SEO-трафик · визиты'}</text>`;
    for (let i = 0; i <= 5; i++) {
      const v = positions ? min + (max - min) * i / 5 : max * i / 5;
      svg += `<line class="upa-grid" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/><text class="upa-axis-label" x="${left - 12}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v, positions ? 1 : 0))}</text>`;
    }
    const ticks = window.innerWidth < 640 ? 3 : 6;
    for (let i = 0; i < ticks; i++) {
      const d = new Date(fromTime + (toTime - fromTime) * i / (ticks - 1)).toISOString().slice(0, 10);
      const tickLabel = width < 640 ? dateLabel(d).slice(0, 6) + d.slice(2, 4) : dateLabel(d);
      svg += `<text class="upa-axis-label" x="${xDate(d)}" y="${height - 18}" text-anchor="${i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle'}">${tickLabel}</text>`;
    }
    svg += `<line class="upa-axis" x1="${left}" x2="${left}" y1="${top}" y2="${top + ih}"/><line class="upa-axis" x1="${left}" x2="${width - right}" y1="${top + ih}" y2="${top + ih}"/>`;
    for (const s of series) {
      let path = '', connected = false;
      for (const g of groups) { const v = value(g, s); if (v === null) { connected = false; continue; } path += `${connected ? 'L' : 'M'}${x(g).toFixed(2)},${y(v).toFixed(2)} `; connected = true; }
      svg += `<path class="${s.cls}" d="${path.trim()}"/>`;
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i], v = value(g, s); if (v === null) continue;
        const provisional = positions && g[s.key].provisional;
        svg += `<circle class="${s.cls} upa-point${provisional ? ' upa-provisional' : ''}" cx="${x(g)}" cy="${y(v)}" r="${provisional ? 4 : 2}"/>`;
      }
    }
    eventMarkers.forEach((m, i) => {
      const xx = xDate(m.date), label = `${dateLabel(m.date)} · ${m.count} ${m.count === 1 ? 'статья' : 'статей'}`;
      svg += `<g><title>${esc(label + ': ' + m.articles.map((p) => p.title).join('; '))}</title><line class="upa-event" x1="${xx}" x2="${xx}" y1="${top}" y2="${top + ih}"/>${eventMarkers.length <= 8 ? `<text class="upa-axis-label" x="${Math.max(left + 40, Math.min(width - right - 40, xx))}" y="${28 + (i % 2) * 12}" text-anchor="middle">${esc(dateLabel(m.date).slice(0, 5))}</text>` : ''}</g>`;
    });
    if (!values.length) svg += `<text class="upa-axis-label" x="${left + iw / 2}" y="${top + ih / 2}" text-anchor="middle">Нет измерений для выбранной выборки</text>`;
    svg += `<line class="upa-cursor" x1="0" x2="0" y1="${top}" y2="${top + ih}" visibility="hidden"/><rect class="upa-hit" x="${left}" y="${top}" width="${iw}" height="${ih}"/></svg><div class="upa-chart-readout" aria-live="polite"></div>`;
    node.innerHTML = svg; node.tabIndex = 0; node.setAttribute('role', 'group');
    node.setAttribute('aria-label', `${positions ? 'График средних позиций' : 'График SEO-трафика'}. Стрелки влево и вправо показывают значения. Home и End — начало и конец.`);
    let hoverIndex = 0;
    const show = (i) => {
      hoverIndex = Math.max(0, Math.min(groups.length - 1, i)); const g = groups[hoverIndex];
      const events = eventMarkers.filter((m) => m.date >= g.start && m.date <= g.end);
      let text = `${dateLabel(g.start)}${g.end !== g.start ? '–' + dateLabel(g.end) : ''}. `;
      if (positions) text += series.map((s) => `${s.label}: ${fmt(g[s.key].position, 1)}; показы ${fmt(g[s.key].impressions)}; покрытие ${coverageLabel(g[s.key])}`).join('. ');
      else text += `SEO-трафик: ${fmt(g.traffic)}; покрытие ${g.trafficMeasured}/${g.trafficExpected} URL-дней`;
      if (events.length) text += '. Апдейты: ' + events.map((m) => `${dateLabel(m.date)} (${m.count})`).join(', ');
      node.querySelector('.upa-chart-readout').textContent = text;
      const cursor = node.querySelector('.upa-cursor'); cursor.setAttribute('x1', x(g)); cursor.setAttribute('x2', x(g)); cursor.setAttribute('visibility', 'visible');
    };
    const svgNode = node.querySelector('svg');
    node.querySelector('.upa-hit').addEventListener('pointermove', (e) => {
      const rect = svgNode.getBoundingClientRect(), xx = (e.clientX - rect.left) * width / rect.width;
      let nearest = 0; for (let i = 1; i < groups.length; i++) if (Math.abs(x(groups[i]) - xx) < Math.abs(x(groups[nearest]) - xx)) nearest = i;
      show(nearest);
    });
    node.onfocus = () => show(hoverIndex);
    node.onkeydown = (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); show(e.key === 'Home' ? 0 : e.key === 'End' ? groups.length - 1 : hoverIndex + (e.key === 'ArrowRight' ? 1 : -1)); } };
    const tableId = positions ? 'upa-position-data' : 'upa-traffic-data';
    $(tableId).innerHTML = `<table><caption>${positions ? 'Средние позиции и полнота измерений' : 'SEO-трафик и полнота измерений'}</caption><thead><tr><th>Период</th>${positions ? '<th>GSC</th><th>Показы GSC / покрытие</th><th>Яндекс</th><th>Показы Яндекс / покрытие</th>' : '<th>SEO-трафик</th><th>Покрытие URL-дней</th>'}</tr></thead><tbody>${groups.map((g) => `<tr><td>${dateLabel(g.start)}${g.end !== g.start ? '–' + dateLabel(g.end) : ''}</td>${positions ? `<td>${fmt(g.gsc.position, 1)}</td><td>${fmt(g.gsc.impressions)} / ${coverageLabel(g.gsc)}</td><td>${fmt(g.webmaster.position, 1)}</td><td>${fmt(g.webmaster.impressions)} / ${coverageLabel(g.webmaster)}</td>` : `<td>${fmt(g.traffic)}</td><td>${g.trafficMeasured}/${g.trafficExpected}</td>`}</tr>`).join('')}</tbody></table>`;
  }
  function deltaLabel(row) {
    if (row.pre === null) return '—';
    if (row.pre === 0) return row.post > 0 ? 'Рост с нуля' : '— (база 0)';
    return `${row.delta > 0 ? '+' : ''}${fmt(row.delta * 100, 1)}%`;
  }
  function engineCell(row, name) {
    const e = row[name];
    return `${fmt(e.pre, 1)} → ${fmt(e.post, 1)}<span class="upa-cell-note">${e.delta === null ? 'Нет парного измерения' : `Изменение: ${e.delta > 0 ? '+' : ''}${fmt(e.delta, 1)}`}. Покрытие до/после: ${e.before.measured}/${row.n}, ${e.after.measured}/${row.n} дней. Показы: ${fmt(e.before.impressions)} / ${fmt(e.after.impressions)}.</span>`;
  }
  function rowStatus(row) {
    let text = statusLabels[row.signal];
    if (row.signal === 'no-data') {
      if (!row.date) text = row.futureOnly ? 'Будущее обновление · пока без сравнения' : 'Дата не указана · сравнение не рассчитано';
      else if (row.n < 7) text += ` · нужно ≥ 7 дней, доступно ${row.n}`;
      else text += ' · нет полного парного окна позиций';
    }
    if (row.engines.length && ['warning', 'severe'].includes(row.signal)) text += ` · ухудшение: ${row.engines.map((n) => n === 'gsc' ? 'GSC' : 'Яндекс').join(', ')}`;
    return text;
  }
  function sorted(rows) {
    const rank = { severe: 4, warning: 3, 'no-data': 2, 'no-signal': 1 };
    const value = (r) => ui.sort === 'date' ? r.date : ui.sort === 'title' ? r.page.title : ui.sort === 'delta' ? r.delta : ui.sort === 'status' ? rank[r.signal] : r[ui.sort].delta;
    return rows.slice().sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null && y !== null) return 1; if (y === null && x !== null) return -1;
      const c = x === y ? 0 : typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y;
      return ui.direction * c || a.page.url.localeCompare(b.page.url) || (a.date || '').localeCompare(b.date || '');
    });
  }
  function renderTable(rows) {
    const list = sorted(rows), pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); ui.page = Math.max(0, Math.min(pageCount - 1, ui.page));
    const shown = list.slice(ui.page * PAGE_SIZE, (ui.page + 1) * PAGE_SIZE);
    $('upa-table-body').innerHTML = shown.length ? shown.map((r) => {
      const url = safeUrl(r.page.url), signalClass = ['severe', 'warning'].includes(r.signal) ? ' upa-signal-' + r.signal : '';
      const windowLabel = r.n ? `${r.n === ui.days ? 'Полное' : 'Частичное'} окно: ${r.n}/${ui.days} дней с каждой стороны` : 'Нет парного окна';
      const periods = r.n ? `${dateLabel(r.preDates[0])}–${dateLabel(r.preDates[r.n - 1])} / ${dateLabel(r.postDates[0])}–${dateLabel(r.postDates[r.n - 1])}` : '';
      const neighbors = [r.previous ? 'Предыдущий: ' + dateLabel(r.previous) : '', r.next ? 'Следующий: ' + dateLabel(r.next) : ''].filter(Boolean).join('; ');
      return `<tr class="upa-row${signalClass}" data-article="${esc(r.page.id)}" data-event="${esc(r.date || '')}"><td><button type="button" class="link-button" data-focus-article="${esc(r.page.id)}">${esc(r.page.title)}</button><span class="upa-cell-note">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.page.path || url)}</a>` : esc(r.page.path)}${r.page.futureUpdates.length ? `<br><span class="upa-badge">Будущие даты: ${r.page.futureUpdates.length}</span>` : ''}</span></td><td>${r.futureOnly ? 'Будущая дата' : dateLabel(r.date)}<span class="upa-cell-note">Строки: ${esc((r.sourceRows || []).join(', ') || '—')}</span></td><td class="upa-traffic-${r.traffic}">${fmt(r.pre)} → ${fmt(r.post)}<span class="upa-cell-note">${deltaLabel(r)} · ${trafficLabels[r.traffic]}</span></td><td>${engineCell(r, 'gsc')}</td><td>${engineCell(r, 'webmaster')}</td><td><span class="upa-badge">${esc(rowStatus(r))}</span><span class="upa-cell-note">${esc(windowLabel)}${periods ? '<br>' + periods : ''}${neighbors ? '<br>' + neighbors : ''}</span></td></tr>`;
    }).join('') : '<tr><td colspan="6">Нет строк по выбранным фильтрам. Измените фильтр месяца, статьи или статуса.</td></tr>';
    $('upa-page-label').textContent = `Страница ${ui.page + 1} из ${pageCount} · строк ${list.length}`;
    $('upa-prev').disabled = ui.page === 0; $('upa-next').disabled = ui.page >= pageCount - 1;
    document.querySelectorAll('#upa-table-head [data-sort]').forEach((button) => {
      const isSorted = button.dataset.sort === ui.sort;
      button.closest('th').setAttribute('aria-sort', isSorted ? ui.direction === 1 ? 'ascending' : 'descending' : 'none');
      button.classList.toggle('sorted-asc', isSorted && ui.direction === 1); button.classList.toggle('sorted-desc', isSorted && ui.direction === -1);
    });
  }
  function render() {
    if (!$('updates-all')) return;
    availability(); if (ui.phase !== 'ready') return;
    if (active() && $('as-of')) $('as-of').textContent = `Апдейты ALL по ${dateLabel(ui.data.meta.asOf)}`;
    const s = scope(); renderControls(s); renderSources();
    const groups = aggregate(ui.data, s.shown, ui.from, ui.to, ui.grain), marks = markers(s.shown, ui.from, ui.to);
    renderKpis(s, groups); drawChart('upa-traffic-chart', groups, marks); drawChart('upa-position-chart', groups, marks, true); renderTable(s.rows);
    $('upa-period-note').textContent = `Период графиков: ${dateLabel(ui.from)}–${dateLabel(ui.to)}. Окно сравнения: ${ui.days} дней; оно не зависит от периода графика.${ui.focusEvent ? ' Выбран апдейт ' + dateLabel(ui.focusEvent) + '.' : ''}`;
    $('upa-markers').innerHTML = marks.length ? `<summary>Даты апдейтов на графиках (${marks.length})</summary><ul>${marks.map((m) => `<li><strong>${dateLabel(m.date)}</strong> · ${m.count} ${m.count === 1 ? 'статья' : 'статей'}<ul>${m.articles.map((p) => `<li>${esc(p.title)} · строки ${esc(p.sourceRows.join(', '))}</li>`).join('')}</ul></li>`).join('')}</ul>` : '<summary>В выбранном периоде нет дат апдейтов</summary>';
  }
  function changed() { ui.page = 0; render(); updateUrl(); }
  function bind() {
    if (ui.bound) return;
    const controls = [['upa-month', 'month'], ['upa-section', 'section'], ['upa-article', 'article'], ['upa-filter-status', 'status'], ['upa-window', 'days'], ['upa-grain', 'grain'], ['upa-from', 'from'], ['upa-to', 'to']];
    for (const [id, key] of controls) $(id).addEventListener('change', (e) => { ui[key] = key === 'days' ? Number(e.target.value) : e.target.value; if (['month', 'section', 'article'].includes(key)) ui.focusEvent = null; if (key === 'from' && ui.from > ui.to) ui.to = ui.from; if (key === 'to' && ui.to < ui.from) ui.from = ui.to; changed(); });
    $('upa-search').addEventListener('input', (e) => { ui.q = e.target.value; changed(); });
    $('upa-full-range').addEventListener('click', () => { if (!ui.data) return; ui.from = DATE_FROM; ui.to = ui.data.meta.asOf; changed(); });
    $('upa-retry').addEventListener('click', () => ensure(true));
    $('upa-prev').addEventListener('click', () => { ui.page--; renderTable(scope().rows); updateUrl(); });
    $('upa-next').addEventListener('click', () => { ui.page++; renderTable(scope().rows); updateUrl(); });
    document.querySelectorAll('#upa-table-head [data-sort]').forEach((button) => button.addEventListener('click', () => { ui.direction = ui.sort === button.dataset.sort ? -ui.direction : -1; ui.sort = button.dataset.sort; changed(); }));
    $('upa-table-body').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-article]'); if (!row) return;
      ui.article = row.dataset.article; ui.focusEvent = row.dataset.event || null; changed();
      $('upa-traffic-card').scrollIntoView({ block: 'start', behavior: 'auto' }); $('upa-traffic-chart').focus({ preventScroll: true });
    });
    window.addEventListener('resize', () => { if (active() && ui.phase === 'ready') render(); });
    window.addEventListener('popstate', () => { if (active()) { readState(); render(); } });
    ui.bound = true;
  }
  async function ensure(force = false) {
    if (!$('updates-all')) return;
    if (!ui.bound) { readState(); bind(); }
    if (ui.pending) return ui.pending;
    if (ui.data && !force) { if (active()) { render(); updateUrl(); } return ui.data; }
    ui.phase = 'loading'; ui.errorLabel = ''; if (active()) availability();
    ui.pending = Promise.resolve().then(async () => {
      try {
        if (typeof window.loadJSON !== 'function') fail('LOADER');
        ui.data = normalize(await window.loadJSON('updates-all.json', { softFail: true }));
        ui.phase = ui.data.pages.length ? 'ready' : 'empty';
      } catch (error) {
        ui.data = null; ui.phase = 'unavailable';
        ui.errorLabel = schemaLabels[error?.message] || (String(error?.message || '').startsWith('UPA_') ? 'Данные не соответствуют контракту media-updates-all-v1.' : 'Не удалось загрузить данные нового источника.');
      } finally { ui.pending = null; if (active()) { render(); updateUrl(); } }
      return ui.data;
    });
    return ui.pending;
  }
  window.ensureUpdatesAll = ensure;
  window.renderUpdatesAll = render;
  window.updateUpdatesAllUrl = updateUrl;
})();
