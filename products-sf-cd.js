/* Local-only draft. The secure publication gate remains closed until source QA. */
(function () {
  'use strict';
  const M = window.ProductsSfCdModel;
  const SOURCES = { gsc: 'Google', webmaster: 'Яндекс', bi: 'SEO-воронка', sf: 'Skillfactory', cd: 'Contented' };
  const COLORS = { gsc: '#3D3BFF', webmaster: '#000000', bi: '#3D3BFF', sf: '#3D3BFF', cd: '#000000' };
  const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const pos = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  let data = null, pending = null, refs = null;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  const precise = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 3 });
  const scientific = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 3, notation: 'scientific' });
  const formatted = (v, position = false) => {
    if (v !== 0 && Math.abs(v) < 0.000001) return scientific.format(v);
    if (v !== 0 && Math.abs(v) < 0.005) return precise.format(v);
    return position || !Number.isInteger(v) ? pos.format(v) : fmt.format(v);
  };
  const value = (v, metric, isBi = false) => {
    if (v === null || v === undefined) return '—';
    const format = isBi ? data?.meta?.biMetrics?.[metric]?.format : null;
    if (format === 'percent_ratio') return `${formatted(v * 100, true)} %`;
    const number = formatted(v, metric === 'position' && !isBi);
    return format === 'rubles' ? `${number} ₽` : number;
  };
  const coverage = (result, position = false) => {
    const known = result.knownImpressions || 0, used = result.weightedImpressions || 0;
    const share = known > 0 ? ` (${formatted(used / known * 100)} %)` : '';
    const base = position ? `${fmt.format(result.observed)} с позицией, ${fmt.format(result.zeroImpressionDays || 0)} без показов из ${fmt.format(result.expected)}; показов в расчёте ${fmt.format(used)} из ${fmt.format(known)}${share}` :
      `${result.nativePeriod ? 'Мера за период; дневных значений: ' : ''}${fmt.format(result.observed)} из ${fmt.format(result.expected)} наблюдений`;
    return base + (result.provisional ? `, предварительных: ${fmt.format(result.provisional)}` : '');
  };
  const dateLabel = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—';
  function fetchedAt(source) {
    const stamp = (value) => {
      const time = Date.parse(value || '');
      return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;
    };
    const first = stamp(source.oldestFetchedAtUtc), last = stamp(source.newestFetchedAtUtc);
    if (!first || !last) return 'время сбора не указано';
    return first === last ? `сбор ${first}` : `сбор ${first}–${last}`;
  }
  function option(select, name, title) { const item = el('option', title); item.value = name; select.append(item); }
  function urlSafe(url) {
    try { const u = new URL(url); return u.protocol === 'https:' && ['skillfactory.ru', 'contented.ru'].includes(u.hostname) && !u.username && !u.password && !u.port && !u.search && !u.hash ? u.href : null; }
    catch (_) { return null; }
  }
  function scaffold(section) {
    section.innerHTML = `<div class="section-heading"><div><p class="eyebrow">SEO-продукты</p><h2 id="products-sf-cd-heading">Продукты SF/CD</h2><p class="ps-intro">Динамика поисковых показателей и SEO-воронки по страницам курсов</p></div></div>
      <div id="ps-notice" class="ps-notice" role="status"></div>
      <article class="chart-card ps-filters"><div class="card-heading"><div><h3>Настройте отчёт</h3><p>Школа, страница, источник и период</p></div></div>
        <div class="ps-filter-grid">
          <label>Школа<select id="ps-school"><option value="all">Все школы</option><option value="sf">Skillfactory</option><option value="cd">Contented</option></select></label>
          <label>Продукт<select id="ps-page"></select></label>
          <label>Поисковая система<select id="ps-engine" aria-describedby="ps-engine-hint"><option value="all">Google и Яндекс</option><option value="gsc" selected>Google</option><option value="webmaster">Яндекс</option></select><span id="ps-engine-hint" class="ps-engine-hint" hidden>Для Power BI фильтр не применяется</span></label>
          <label>Показатель<select id="ps-metric"></select></label>
          <label>Детализация<select id="ps-grain"><option value="day">По дням</option><option value="week">По неделям</option><option value="month">По месяцам</option></select></label>
          <label>Дата с<input id="ps-from" type="date"></label><label>Дата по<input id="ps-to" type="date"></label>
        </div><p id="ps-error" class="ps-error" role="alert" hidden></p><p id="ps-source-note" class="ps-note"></p></article>
      <div id="ps-kpis" class="ps-kpis" aria-live="polite"></div>
      <article id="ps-chart-card" class="chart-card ps-chart-card"><div class="card-heading chart-heading-safe"><div><h3 id="ps-chart-title">Динамика</h3><p id="ps-chart-note"></p></div><div id="ps-legend" class="ps-legend" role="group" aria-label="Источники графика"></div></div>
        <div id="ps-chart" class="chart ps-chart" role="group" aria-label="Динамика выбранного показателя"></div><p id="ps-chart-status" class="ps-sr-only" role="status" aria-live="polite" aria-atomic="true"></p><p id="ps-chart-empty" class="ps-note" hidden></p>
        <details id="ps-series-details" class="ps-series"><summary>Показать данные графика</summary><div class="table-wrap ps-series-wrap"><table><thead><tr><th scope="col">Период</th><th scope="col">Источник</th><th scope="col">Значение</th><th scope="col">Покрытие</th></tr></thead><tbody id="ps-series-body"></tbody></table></div></details></article>
      <article id="ps-table-card" class="table-card ps-table-card"><div class="card-heading ps-table-heading"><div><h3>Страницы</h3><p>Итоги за выбранный период и покрытие данных</p></div><label class="ps-search-label">Поиск по названию или URL<input id="ps-search" type="search" placeholder="Название или адрес"></label></div>
        <p id="ps-trend-note" class="ps-note ps-trend-note"></p><p class="ps-scroll-hint">Прокрутите таблицу вправо, чтобы увидеть все столбцы.</p><div class="table-wrap ps-table-wrap"><table><thead id="ps-thead"></thead><tbody id="ps-tbody"></tbody></table></div><p id="ps-table-empty" class="ps-note" hidden></p></article>`;
    refs = Object.fromEntries(['notice','school','page','engine','engine-hint','metric','grain','from','to','error','source-note','kpis','chart-card','chart-title','chart-note','legend','chart','chart-status','chart-empty','series-details','series-body','table-card','trend-note','search','thead','tbody','table-empty'].map((id) => [id, section.querySelector('#ps-' + id)]));
  }
  function restore() {
    const params = new URLSearchParams(location.search);
    for (const key of ['school', 'engine', 'grain', 'metric']) {
      const candidate = params.get('ps_' + key);
      if (candidate && [...refs[key].options].some((o) => o.value === candidate)) refs[key].value = candidate;
    }
    const first = data.dates[0], last = data.dates[data.dates.length - 1];
    refs.from.min = refs.to.min = first; refs.from.max = refs.to.max = last;
    refs.from.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('ps_from') || '') && params.get('ps_from') >= first && params.get('ps_from') <= last ? params.get('ps_from') : first;
    refs.to.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('ps_to') || '') && params.get('ps_to') >= first && params.get('ps_to') <= last ? params.get('ps_to') : last;
    fillPages(params.get('ps_page') || 'all');
  }
  function fillPages(preferred) {
    const current = preferred || refs.page.value || 'all';
    refs.page.replaceChildren(); option(refs.page, 'all', 'Все страницы');
    data.pages.filter((p) => refs.school.value === 'all' || p.school === refs.school.value).forEach((p) => {
      const path = new URL(p.url).pathname;
      option(refs.page, p.id, `${p.name} · ${path}${p.pageType === 'hybrid' ? ' · гибридная страница' : ''}`);
    });
    refs.page.value = [...refs.page.options].some((o) => o.value === current) ? current : 'all';
  }
  function settings() { return { school: refs.school.value, pageId: refs.page.value, engine: refs.engine.value, grain: refs.grain.value, from: refs.from.value, to: refs.to.value }; }
  function describeSources() {
    const g = data.meta.sources?.gsc || {}, y = data.meta.sources?.webmaster || {};
    const googleState = g.dataState === 'final' ? 'финальные данные' : g.dataState === 'provisional' ? 'предварительные данные' : 'статус данных уточняется';
    const sources = `Google: ${dateLabel(g.from)}–${dateLabel(g.through)}, ${googleState}, America/Los_Angeles; ${fetchedAt(g)}. ` +
      `Яндекс: ${dateLabel(y.from)}–${dateLabel(y.through)}, доступное окно API, часовой пояс даты не указан; ${fetchedAt(y)}.`;
    const biDate = data.meta.biLastRefreshUtc ? fetchedAt({oldestFetchedAtUtc: data.meta.biLastRefreshUtc, newestFetchedAtUtc: data.meta.biLastRefreshUtc}).replace('сбор ', 'обновление ') : '';
    refs['source-note'].textContent = sources + ' Клики из поиска — не визиты. Покрытие — число дней на страницах с доступной метрикой. Пустое значение не означает ноль.' +
      (biDate ? ` Power BI: ${biDate}.` : '') + (data.meta.biMethod ? ' ' + data.meta.biMethod : '') +
      (data.meta.biStatus === 'verified' ? '' : ' ' + (data.meta.biCaveat || 'Данные SEO-воронки Power BI пока недоступны.'));
    refs.notice.textContent = data.meta.cohortStatus === 'VERIFIED_COMPLETE' ? 'Данные по страницам текущего состава курсов.' : (data.meta.cohortCaveat || 'Предварительная выборка: полный список курсов ещё проверяется.');
  }
  function totals(points, metric) {
    let observed = 0, expected = 0, weightedImpressions = 0, knownImpressions = 0, zeroImpressionDays = 0, weighted = 0, sum = 0, provisional = 0;
    for (const p of points) {
      observed += p.coverage.observed; expected += p.coverage.expected;
      provisional += p.coverage.provisional || 0;
      if (metric === 'position') {
        zeroImpressionDays += p.coverage.zeroImpressionDays || 0;
        knownImpressions += p.coverage.knownImpressions || 0;
        if (p.value !== null && p.coverage.weightedImpressions > 0) { weighted += p.value * p.coverage.weightedImpressions; weightedImpressions += p.coverage.weightedImpressions; }
      } else if (p.value !== null) sum += p.value;
    }
    return { value: metric === 'position' ? (weightedImpressions ? weighted / weightedImpressions : null) : (observed ? sum : null), observed, expected, weightedImpressions, knownImpressions, zeroImpressionDays, provisional };
  }
  function biTotal(points, spec, pageCount) {
    const expected = points.reduce((n, p) => n + p.coverage.expected, 0);
    const observed = points.reduce((n, p) => n + p.coverage.observed, 0);
    if (spec.aggregation !== 'additive' && (points.length !== 1 || (pageCount !== 1 && !points[0].coverage.nativePeriod))) return {value: null, observed, expected};
    const known = points.filter((p) => p.value !== null);
    return { value: known.length ? known.reduce((n, p) => n + p.value, 0) : null, observed, expected,
      nativePeriod: points.length === 1 && !!points[0].coverage.nativePeriod };
  }
  function kpi(title, number, note, primary) {
    const box = el('div', null, 'ps-kpi' + (primary ? ' ps-kpi-primary' : ''));
    box.append(el('span', title, 'ps-kpi-label'), el('strong', number, 'ps-kpi-value'), el('span', note, 'ps-kpi-note'));
    return box;
  }
  function paintChart(points, metric, isBi) {
    const body = refs['series-body']; body.replaceChildren(); refs['series-details'].hidden = points.length === 0;
    for (const point of points) {
      const row = el('tr'), interval = dateLabel(point.from) + (point.from === point.to ? '' : '–' + dateLabel(point.to));
      row.append(el('td', interval), el('td', SOURCES[point.engine || (isBi ? 'bi' : '')]),
        el('td', value(point.value, metric, isBi)), el('td', coverage(point.coverage, !isBi && metric === 'position')));
      body.append(row);
    }
    const container = refs.chart, legend = refs.legend; container.replaceChildren(); legend.replaceChildren(); refs['chart-status'].textContent = '';
    const visible = points.filter((p) => p.value !== null && Number.isFinite(p.value));
    refs['chart-empty'].hidden = visible.length > 0;
    refs['chart-empty'].textContent = visible.length ? '' : 'Нет доступных значений для выбранных условий.';
    if (!visible.length) return;
    const NS = 'http://www.w3.org/2000/svg';
    const node = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
    const mobile = window.innerWidth < 700;
    const width = mobile ? Math.max(300, container.clientWidth) : 1200, height = mobile ? 300 : 430;
    const margin = {top: 24, right: mobile ? 20 : 28, bottom: 54, left: mobile ? 68 : 100};
    const innerW = width - margin.left - margin.right, innerH = height - margin.top - margin.bottom;
    const svg = node('svg', {viewBox: `0 0 ${width} ${height}`, tabindex: '0', role: 'img',
      'aria-label': `${refs['chart-title'].textContent}. Стрелки влево и вправо: значения по датам.`, 'aria-describedby': 'ps-chart-status'});
    const periods = [...new Set(points.map((p) => p.period))], values = visible.map((p) => p.value);
    const isPosition = !isBi && metric === 'position';
    let lo = isPosition ? Math.min(...values) : Math.min(0, ...values), hi = Math.max(...values);
    if (lo === hi) { lo = isPosition ? Math.max(0, lo - 1) : Math.min(0, lo - 1); hi += 1; }
    const rough = (hi - lo) / 5, magnitude = 10 ** Math.floor(Math.log10(rough)), normalized = rough / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = (i) => margin.left + (periods.length === 1 ? innerW / 2 : i / (periods.length - 1) * innerW);
    const y = (v) => margin.top + (isPosition ? (v - lo) : (hi - v)) / (hi - lo) * innerH;
    for (let i = 0; i <= Math.round((hi - lo) / step); i++) {
      const tick = lo + i * step, yy = y(tick);
      svg.append(node('line', {class: 'grid-line', x1: margin.left, x2: width - margin.right, y1: yy, y2: yy}),
        node('text', {class: 'axis-label', x: margin.left - 12, y: yy + 4, 'text-anchor': 'end'}, value(tick, metric, isBi)));
    }
    svg.append(node('line', {class: 'axis-line', x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + innerH}),
      node('line', {class: 'axis-line', x1: margin.left, x2: width - margin.right, y1: margin.top + innerH, y2: margin.top + innerH}));
    const tickStep = Math.max(1, Math.ceil((periods.length - 1) / (window.innerWidth < 700 ? 4 : 8)));
    const ticks = []; for (let i = 0; i < periods.length; i += tickStep) ticks.push(i);
    if (ticks.at(-1) !== periods.length - 1) { if (ticks.length > 1 && periods.length - 1 - ticks.at(-1) < tickStep * .65) ticks.pop(); ticks.push(periods.length - 1); }
    for (const i of ticks) {
      const interval = points.find((p) => p.period === periods[i]);
      const label = node('text', {class: 'axis-label ps-x-tick', x: x(i), y: height - 28, 'text-anchor': 'middle',
        'data-from': interval.from, 'data-to': interval.to});
      label.append(node('tspan', {x: x(i)}, dateLabel(interval.from).slice(0, 5)));
      if (interval.from !== interval.to) label.append(node('tspan', {x: x(i), dy: 16}, '–' + dateLabel(interval.to).slice(0, 5)));
      svg.append(label);
    }
    const engines = [...new Set(points.map((p) => p.engine || (isBi ? 'bi' : '')))];
    const series = engines.map((engine) => ({engine, points: new Map(points.filter((p) => (p.engine || (isBi ? 'bi' : '')) === engine).map((p) => [p.period, p]))}));
    const defs = node('defs'), gradient = node('linearGradient', {id: 'ps-area-grad', x1: 0, y1: 0, x2: 0, y2: 1});
    gradient.append(node('stop', {offset: 0, class: 'area-stop-top'}), node('stop', {offset: 1, class: 'area-stop-bottom'})); defs.append(gradient); svg.append(defs);
    for (const s of series) {
      let d = '', run = [], area = '';
      const flush = () => { if (run.length > 1) area += `M${run.join(' L')} L${run.at(-1).split(',')[0]},${margin.top + innerH} L${run[0].split(',')[0]},${margin.top + innerH} Z `; run = []; };
      periods.forEach((period, i) => {
        const p = s.points.get(period);
        if (!p || p.value === null || !Number.isFinite(p.value)) { flush(); return; }
        const point = `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`;
        d += `${run.length ? 'L' : 'M'}${point} `; run.push(point);
      }); flush();
      const primary = COLORS[s.engine] === COLORS.gsc;
      if (primary && area) svg.append(node('path', {class: 'area-primary', fill: 'url(#ps-area-grad)', d: area}));
      svg.append(node('path', {class: primary ? 'line-primary' : 'line-black', d}));
      // Keep isolated observations visible without drawing across missing dates.
      periods.forEach((period, i) => {
        const p = s.points.get(period), prev = s.points.get(periods[i - 1]), next = s.points.get(periods[i + 1]);
        if (p?.value != null && prev?.value == null && next?.value == null) svg.append(node('circle', {class: primary ? 'point-primary' : 'point-black', cx: x(i), cy: y(p.value), r: 5}));
      });
      const label = el('span', null, 'ps-legend-item'), mark = el('i'); mark.style.background = COLORS[s.engine]; if (!primary) mark.className = 'ps-dashed'; label.append(mark, document.createTextNode(SOURCES[s.engine])); legend.append(label);
    }
    const hover = node('line', {class: 'hover-line', y1: margin.top, y2: margin.top + innerH, visibility: 'hidden'});
    svg.append(hover);
    const dots = series.map((s) => { const dot = node('circle', {class: COLORS[s.engine] === COLORS.gsc ? 'point-primary' : 'point-black', r: 5, visibility: 'hidden'}); svg.append(dot); return dot; });
    const hit = node('rect', {class: 'hit-area', x: margin.left, y: margin.top, width: innerW, height: innerH}); svg.append(hit);
    const tooltip = el('div', null, 'tooltip ps-tooltip'); tooltip.id = 'ps-tooltip'; tooltip.setAttribute('role', 'tooltip');
    let active = periods.length - 1;
    const hide = () => { tooltip.classList.remove('visible'); hover.setAttribute('visibility', 'hidden'); dots.forEach((dot) => dot.setAttribute('visibility', 'hidden')); refs['chart-status'].textContent = ''; };
    const show = (index, event) => {
      active = Math.max(0, Math.min(periods.length - 1, index)); const xx = x(active);
      hover.setAttribute('x1', xx); hover.setAttribute('x2', xx); hover.setAttribute('visibility', 'visible');
      tooltip.replaceChildren();
      const sample = series.map((s) => s.points.get(periods[active])).find(Boolean);
      tooltip.append(el('strong', dateLabel(sample.from) + (sample.from === sample.to ? '' : '–' + dateLabel(sample.to))), el('div', refs.metric.selectedOptions[0].textContent));
      series.forEach((s, i) => {
        const p = s.points.get(periods[active]), v = p?.value;
        dots[i].setAttribute('visibility', v == null ? 'hidden' : 'visible');
        if (v != null) { dots[i].setAttribute('cx', xx); dots[i].setAttribute('cy', y(v)); }
        const row = el('div'); row.append(document.createTextNode(`${SOURCES[s.engine]}: `), el('b', value(v, metric, isBi))); tooltip.append(row);
      });
      if (!event) refs['chart-status'].textContent = [...tooltip.children].map((item) => item.textContent).join('. ');
      tooltip.classList.add('visible');
      const rect = svg.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
      const left = event?.clientX ?? rect.left + xx / width * rect.width, top = event?.clientY ?? rect.top + 40;
      tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, left + 16))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, top + 16))}px`;
    };
    hit.addEventListener('pointermove', (event) => { const rect = svg.getBoundingClientRect(); show(Math.round(((event.clientX - rect.left) * width / rect.width - margin.left) / innerW * (periods.length - 1)), event); });
    svg.addEventListener('pointerleave', hide); svg.addEventListener('blur', hide);
    svg.addEventListener('focus', () => show(active));
    svg.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { hide(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); show(event.key === 'Home' ? 0 : event.key === 'End' ? periods.length - 1 : active + (event.key === 'ArrowLeft' ? -1 : 1));
    });
    container.append(svg, tooltip);
    if (isPosition) container.append(el('p', 'Средняя позиция: меньшее значение — выше в поиске', 'ps-value-range'));
  }
  function buildTable(selected, isBi, metric, spec) {
    const heads = ['Страница', 'Школа'];
    const engines = selected.engine === 'all' ? ['gsc', 'webmaster'] : [selected.engine];
    if (isBi) heads.push(spec.label, 'Покрытие');
    else for (const engine of engines) heads.push(SOURCES[engine], 'Покрытие');
    const headRow = el('tr'); heads.forEach((name) => headRow.append(el('th', name))); refs.thead.replaceChildren(headRow); refs.tbody.replaceChildren();
    headRow.append(el('th', 'Динамика поиска'));
    const trendEngine = isBi ? 'all' : selected.engine;
    const windows = M.trend(data, {...selected, engine: trendEngine}).windows;
    const trendSources = trendEngine === 'all' ? 'Google и Яндекс' : SOURCES[trendEngine];
    refs['trend-note'].textContent = windows ? `Динамика поиска: ${dateLabel(windows.before.from)}–${dateLabel(windows.before.to)} → ${dateLabel(windows.after.from)}–${dateLabel(windows.after.to)} (по ${windows.days} дн.). Поисковики: ${trendSources}. Сравниваем равные половины выбранного периода; при нечётном числе дней середина исключена. Зелёный — кликов больше и позиция лучше (число меньше); розовый — кликов меньше и позиция хуже (число больше). Позицию взвешиваем по показам. Окрашиваем только при полном покрытии обоих окон; при двух системах обе должны подтвердить направление. Пропуски, предварительные данные, разнонаправленные и неизменившиеся показатели — без подсветки.${isBi ? ' Здесь сравниваем Google и Яндекс, независимо от выбранной меры Power BI.' : ''}` : `Поисковики: ${trendSources}. Для сравнения динамики поиска выберите не менее двух дней.`;
    const q = refs.search.value.trim().toLocaleLowerCase('ru');
    const pages = data.pages.filter((p) => (selected.school === 'all' || p.school === selected.school) && (selected.pageId === 'all' || p.id === selected.pageId) && (!q || `${p.name} ${p.url}`.toLocaleLowerCase('ru').includes(q)));
    for (const p of pages) {
      const tr = el('tr'), title = el('td'), safe = urlSafe(p.url);
      if (safe) { const link = el('a', p.name); link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link); }
      else title.append(el('span', p.name));
      title.append(el('div', p.url, 'ps-page-url'));
      if (p.pageType === 'hybrid') title.append(el('span', 'Гибридная страница', 'ps-badge'));
      tr.append(title, el('td', p.school === 'sf' ? 'Skillfactory' : 'Contented'));
      if (isBi) {
        const r = M.bi(data, {...selected, pageId: p.id, metric, grain: 'day'});
        const interval = spec.aggregation !== 'additive' ? M.bi(data, {...selected, pageId: p.id, metric}) : null;
        const total = M.biInterval(data, {...selected, pageId: p.id, metric}) || biTotal(interval && interval.points.length === 1 ? interval.points : r.points, spec, 1);
        tr.append(el('td', value(total.value, metric, true), 'ps-num'), el('td', coverage(total), 'ps-coverage'));
      } else {
        const r = M.search(data, {...selected, pageId: p.id, metric, grain: 'day'});
        for (const engine of engines) { const total = totals(r.points.filter((x) => x.engine === engine), metric); tr.append(el('td', value(total.value, metric), 'ps-num'), el('td', coverage(total, metric === 'position'), 'ps-coverage')); }
      }
      const trend = M.trend(data, {...selected, pageId: p.id, engine: trendEngine});
      if (trend.state === 'up' || trend.state === 'down') tr.className = 'ps-trend-' + trend.state;
      const status = el('td', null, 'ps-trend');
      const labels = {up: 'Рост кликов и позиции', down: 'Падение кликов и позиции', neutral: 'Без совместного роста или падения', insufficient: 'Недостаточно полных данных'};
      status.append(el('strong', labels[trend.state]));
      for (const source of trend.engines) {
        status.append(el('div', `${SOURCES[source.engine]}: ${source.state === 'insufficient' ? 'недостаточно полных данных' : `клики ${value(source.before.clicks, 'clicks')} → ${value(source.after.clicks, 'clicks')}; позиция ${value(source.before.position, 'position')} → ${value(source.after.position, 'position')}`}`));
      }
      tr.append(status); refs.tbody.append(tr);
    }
    refs['table-empty'].hidden = pages.length > 0; refs['table-empty'].textContent = pages.length ? '' : 'Страницы не найдены.';
  }
  function render() {
    if (!data || !refs) return;
    if (!refs.from.value || !refs.to.value || !refs.from.validity.valid || !refs.to.validity.valid || refs.from.value > refs.to.value) {
      refs.error.hidden = false; refs.error.textContent = 'Проверьте границы периода.';
      refs.kpis.hidden = refs['chart-card'].hidden = refs['table-card'].hidden = true;
      return;
    }
    refs.error.hidden = true;
    refs.kpis.hidden = refs['chart-card'].hidden = refs['table-card'].hidden = false;
    const selected = settings(), rawMetric = refs.metric.value, isBi = rawMetric.startsWith('bi:'), metric = isBi ? rawMetric.slice(3) : rawMetric;
    const spec = isBi ? data.meta.biMetrics?.[metric] : null;
    refs.engine.disabled = isBi;
    refs['engine-hint'].hidden = false;
    refs['engine-hint'].textContent = isBi ? 'Для Power BI фильтр не применяется' : 'По умолчанию Google: у Яндекса ограничена история. В режиме двух систем нужны полные данные обеих; при неполном покрытии выберите Google.';
    refs.kpis.replaceChildren();
    const selection = M.selection(data, selected), pageCount = selection.pages.length;
    if (selection.clipped) {
      refs.error.hidden = false;
      refs.error.textContent = `Период выходит за доступные даты: ${dateLabel(data.dates[0])}–${dateLabel(data.dates[data.dates.length - 1])}. Показана только доступная часть.`;
    }
    refs.kpis.append(kpi('Страниц', fmt.format(pageCount), 'В выбранной группе', true));
    let points;
    if (isBi && spec) {
      const splitSchools = selected.school === 'all' && selected.pageId === 'all' && data.biGroups?.sf && data.biGroups?.cd &&
        !Object.hasOwn(data.biGroups?.all?.interval?.values || {}, metric);
      points = [];
      for (const school of splitSchools ? ['sf', 'cd'] : [selected.school]) {
        const pick = {...selected, school, metric};
        const chart = M.bi(data, pick);
        points.push(...chart.points.map((p) => splitSchools ? {...p, engine: school} : p));
        const day = M.bi(data, {...pick, grain: 'day'});
        const count = M.selection(data, pick).pages.length;
        const total = M.biInterval(data, pick) || biTotal(spec.aggregation !== 'additive' && chart.points.length === 1 ? chart.points : day.points, spec, count);
        refs.kpis.append(kpi(splitSchools ? `${SOURCES[school]}: ${spec.label}` : spec.label, value(total.value, metric, true), coverage(total), false));
      }
      refs['chart-note'].textContent = (splitSchools ? 'Показатели школ приведены раздельно. ' : '') + 'SEO-воронка по всем поисковым системам. Разбивка по движкам в Power BI не подтверждена.' +
        (spec.available === false ? ' ' + spec.reason : '') +
        (spec.aggregation === 'additive' ? '' : ' Показатель нельзя складывать по дням или страницам. Меры модели показаны для точных периодов страницы или школы; неполные периоды могут быть недоступны.');
    } else {
      const chart = M.search(data, {...selected, metric}); points = chart.points;
      const day = M.search(data, {...selected, metric, grain: 'day'});
      const engines = selected.engine === 'all' ? ['gsc', 'webmaster'] : [selected.engine];
      for (const engine of engines) { const total = totals(day.points.filter((p) => p.engine === engine), metric); refs.kpis.append(kpi(SOURCES[engine], value(total.value, metric), coverage(total, metric === 'position'), false)); }
      refs['chart-note'].textContent = metric === 'position' ? 'Позиция взвешена по показам; меньшее значение означает более высокое место.' : 'Показатели источников не объединяются; пропуски остаются пропусками.';
    }
    refs['chart-title'].textContent = `Динамика: ${refs.metric.selectedOptions[0].textContent}`;
    refs.chart.setAttribute('aria-label', refs['chart-title'].textContent);
    paintChart(points, metric, isBi); buildTable(selected, isBi, metric, spec);
    window.updateProductsSfCdUrl();
  }
  window.updateProductsSfCdUrl = function () {
    const params = new URLSearchParams(location.search); params.set('view', 'products-sf-cd');
    if (refs) for (const key of ['school', 'page', 'engine', 'metric', 'grain', 'from', 'to']) params.set('ps_' + key, refs[key].value);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  };
  window.ensureProductsSfCd = function () {
    if (data) { render(); return Promise.resolve(); }
    if (pending) return pending;
    const section = document.getElementById('products-sf-cd');
    if (!section) return Promise.resolve();
    if (!M || typeof window.loadJSON !== 'function') {
      section.replaceChildren(el('div', 'Не удалось подготовить раздел. Попробуйте обновить страницу.', 'empty'));
      return Promise.resolve();
    }
    pending = window.loadJSON('products-sf-cd.json', {softFail: true}).then((raw) => {
      data = M.validate(raw); scaffold(section);
      option(refs.metric, 'clicks', 'Клики из поиска'); option(refs.metric, 'impressions', 'Показы'); option(refs.metric, 'position', 'Средняя позиция');
      Object.entries(data.meta.biMetrics || {}).forEach(([key, spec]) => option(refs.metric, 'bi:' + key, spec.label + (spec.available === false ? ' · нет данных' : '')));
      restore(); describeSources();
      ['school', 'page', 'engine', 'metric', 'grain', 'from', 'to'].forEach((key) => refs[key].addEventListener('change', () => { if (key === 'school') fillPages(); render(); }));
      refs.search.addEventListener('input', render);
      let resizeFrame;
      window.addEventListener('resize', () => {
        if (!refs.chart.isConnected) return;
        cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render);
      });
      render();
    }).catch(() => { data = null; section.replaceChildren(el('div', 'Не удалось загрузить данные раздела. Проверьте ссылку и попробуйте ещё раз.', 'empty')); }).finally(() => { pending = null; });
    return pending;
  };
})();
