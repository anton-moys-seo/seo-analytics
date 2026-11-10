/* Эксперимент: вайбкодинг (Skillfactory, Contented, Skillbox Kids). Данные — experiment.json.
   Фильтр бренда → страница → динамика воронки до и после релиза.
   Работает поверх глобальных хелперов app.js, не меняя другие разделы. */
(function () {
  'use strict';
  const exp = {
    data: null, failed: false,
    brand: 'sf', metric: 'visits', grain: 'day', from: null, to: null, product: null, win: 'auto',
  };
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const FAIL_MSG = 'Данные эксперимента пока не опубликованы: файл experiment.json не найден. Остальные разделы работают в обычном режиме.';
  const BRANDS = [
    { id: 'sf', name: 'Skillfactory' },
    { id: 'cd', name: 'Contented' },
    { id: 'kids', name: 'Skillbox Kids' },
    { id: 'all', name: 'Все бренды' },
  ];
  const WINDOWS = { auto: 'Равные окна: все дни после релиза', 7: '7 дней', 14: '14 дней', 28: '28 дней', full: 'Весь период до и после' };
  const ratioFmt = (v) => (v === null || v === undefined ? '—' : pctf2.format(v));
  const smallf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  // Средние за день: у малых значений (продажи, лиды) показываем сотые, чтобы 0,05 не превращалось в 0.
  const dailyFmt = (v) => (Math.abs(v) < 10 ? smallf.format(v) : formatNumber(v));
  const METRICS = {
    visits: { name: 'Визиты', format: (v) => formatInt(v), daily: dailyFmt },
    leads: { name: 'Лиды', format: (v) => formatInt(v), daily: dailyFmt },
    cr1: { name: 'CR1', format: ratioFmt, ratio: true },
    sales: { name: 'Продажи', format: (v) => formatInt(v), daily: dailyFmt },
    cr2: { name: 'CR2', format: ratioFmt, ratio: true },
    revenue: { name: 'Выручка', format: (v) => formatInt(Math.round(v)), daily: (v) => formatInt(Math.round(v)) },
  };

  function snapDate(iso) {
    const dates = exp.data.dates;
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    if (dates.includes(iso)) return iso;
    if (iso <= dates[0]) return dates[0];
    if (iso >= dates[dates.length - 1]) return dates[dates.length - 1];
    const before = dates.filter((d) => d <= iso);
    return before.length ? before[before.length - 1] : dates[0];
  }

  function brandProducts() {
    return exp.data.products.filter((p) => exp.brand === 'all' || p.group === exp.brand);
  }
  function product() {
    const list = brandProducts();
    return list.find((p) => p.id === exp.product) || list[0];
  }
  function brandName(id) { return (BRANDS.find((b) => b.id === id) || {}).name || id; }

  // CR пересчитывается по суммам периода, а не как среднее дневных долей.
  function periodValues(item, idx) {
    const g = (m) => sum(idx.map((i) => item[m][i]));
    const visits = g('visits'), leads = g('leads'), sales = g('sales');
    return {
      visits, leads, sales, revenue: g('revenue'),
      cr1: visits ? leads / visits : null,
      cr2: leads ? sales / leads : null,
    };
  }

  // Окна «до» и «после»: день релиза входит в «после»; «до» — столько же дней непосредственно перед релизом.
  function windows(p) {
    const dates = exp.data.dates;
    const r = dates.indexOf(p.release);
    if (r < 0) return null;
    const availableAfter = dates.length - r, availableBefore = r;
    let afterLen = availableAfter, beforeLen = availableBefore;
    if (exp.win !== 'full') {
      const wanted = exp.win === 'auto' ? availableAfter : Number(exp.win);
      afterLen = beforeLen = Math.min(wanted, availableAfter, availableBefore);
    }
    const range = (a, n) => Array.from({ length: n }, (_, k) => a + k);
    return { before: range(r - beforeLen, beforeLen), after: range(r, afterLen), releaseIndex: r };
  }
  function windowStats(p, w) {
    const daily = (idx) => {
      const v = periodValues(p, idx), n = idx.length || null;
      return { visits: n && v.visits / n, leads: n && v.leads / n, sales: n && v.sales / n, revenue: n && v.revenue / n, cr1: v.cr1, cr2: v.cr2 };
    };
    return { before: daily(w.before), after: daily(w.after) };
  }
  function spanText(idx) {
    if (!idx.length) return 'нет дней';
    const d = exp.data.dates;
    return `${formatDate(d[idx[0]]).slice(0, 5)}–${formatDate(d[idx[idx.length - 1]]).slice(0, 5)} (${idx.length} дн.)`;
  }

  function deltaBadge(before, after) {
    if (after === null || after === undefined || before === null || before === undefined) return '<span class="exp-delta exp-delta-na">—</span>';
    if (!before) return after ? '<span class="exp-delta exp-delta-new" title="До релиза значение было нулевым">с нуля</span>' : '<span class="exp-delta exp-delta-na">0 → 0</span>';
    const ratio = after / before;
    const tier = ratio >= 1 ? 'good' : ratio >= 0.9 ? 'mid' : 'low';
    const d = ratio - 1;
    return `<span class="exec-badge exec-${tier} exp-delta">${d > 0 ? '+' : d < 0 ? '−' : ''}${pctf.format(Math.abs(d))}</span>`;
  }

  function bucketSeries(item, metric = exp.metric, grain = exp.grain) {
    const agg = (values) => aggregateRange(exp.data.dates, [{ values }], exp.from, exp.to, grain);
    if (metric === 'cr1' || metric === 'cr2') {
      const denom = metric === 'cr1' ? agg(item.visits) : agg(item.leads);
      const numer = metric === 'cr1' ? agg(item.leads) : agg(item.sales);
      return { dates: denom.dates, values: denom.series[0].values.map((v, i) => {
        const n = numer.series[0].values[i];
        return v ? n / v : null;
      }) };
    }
    const aggregated = agg(item[metric]);
    return { dates: aggregated.dates, values: aggregated.series[0].values };
  }

  function renderBrandTabs() {
    const box = $('#exp-brand-tabs');
    box.innerHTML = BRANDS.map((b) => {
      const count = b.id === 'all' ? exp.data.products.length : exp.data.products.filter((p) => p.group === b.id).length;
      const active = b.id === exp.brand;
      return `<button type="button" class="exp-brand-tab${active ? ' active' : ''}" data-brand="${b.id}" aria-pressed="${active}">${esc(b.name)}<span>${count}</span></button>`;
    }).join('');
  }

  function populateProductSelect() {
    const select = $('#exp-product');
    select.innerHTML = '';
    brandProducts().forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = `${p.name} · релиз ${formatDate(p.release)}`;
      option.selected = p.id === product().id;
      select.appendChild(option);
    });
  }

  function renderFunnel() {
    const box = $('#exp-funnel'), note = $('#exp-funnel-note');
    const p = product();
    const w = windows(p);
    $('#exp-funnel-title').textContent = `${p.name}: воронка до и после релиза ${formatDate(p.release)}`;
    if (!w || !w.after.length) { box.innerHTML = '<div class="empty">Нет дней после релиза в данных.</div>'; note.textContent = ''; return; }
    const st = windowStats(p, w);
    const weekly = (m) => sparkline(bucketSeries(p, m, 'week').values);
    const stage = (m, label) => {
      const fmt = METRICS[m].daily;
      const b = st.before[m], a = st.after[m];
      return `<div class="exp-stage"><span class="exp-stage-label">${label}</span>`
        + `<div class="exp-stage-values"><span><small>до</small>${b === null ? '—' : fmt(b)}</span><span class="exp-arrow">→</span><span><small>после</small><b>${a === null ? '—' : fmt(a)}</b></span></div>`
        + `${deltaBadge(b, a)}${weekly(m)}</div>`;
    };
    const conn = (m, label) => `<div class="exp-conn"><span class="exp-conn-label">${label}</span><span>${ratioFmt(st.before[m])}</span><span class="exp-arrow">↓</span><b>${ratioFmt(st.after[m])}</b>${deltaBadge(st.before[m], st.after[m])}</div>`;
    box.innerHTML = stage('visits', 'Визиты в день') + conn('cr1', 'CR1 · лиды / визиты') + stage('leads', 'Лиды в день')
      + conn('cr2', 'CR2 · продажи / лиды') + stage('sales', 'Продажи в день') + stage('revenue', 'Выручка в день, ₽');
    const warn = [];
    if (w.after.length < 7) warn.push(`после релиза всего ${w.after.length} дн. — выводы преждевременны`);
    if (w.before.length < w.after.length) warn.push('до релиза в данных меньше дней, чем после');
    if (p.note) warn.push(p.note);
    note.innerHTML = `<b>До:</b> ${esc(spanText(w.before))} · <b>после:</b> ${esc(spanText(w.after))} · ${esc(WINDOWS[exp.win])}. Средние за день; CR — по суммам окна. Мини-графики — по неделям за выбранный период.`
      + (warn.length ? `<span class="exp-warn">${esc(warn.join('; ').replace(/\.$/, ''))}.</span>` : '');
  }

  function renderChart() {
    const container = $('#exp-chart'), legend = $('#exp-legend');
    if (exp.failed) { container.innerHTML = ''; legend.innerHTML = ''; $('#exp-chart-note').textContent = FAIL_MSG; return; }
    const shown = product();
    const main = bucketSeries(shown);
    const series = [{ name: shown.name, className: 'line-primary', values: main.values }];
    const dates = main.dates;
    const w = windows(shown);
    // Средние «до» и «после» по окнам сравнения — только в дневной детализации.
    let withAverages = false;
    if (exp.grain === 'day' && w && w.after.length) {
      const st = windowStats(shown, w);
      const pos = new Map(dates.map((d, i) => [d, i]));
      const line = (idx, value) => {
        const arr = dates.map(() => null);
        idx.forEach((i) => { const k = pos.get(exp.data.dates[i]); if (k !== undefined) arr[k] = value; });
        return arr;
      };
      const before = line(w.before, st.before[exp.metric]), after = line(w.after, st.after[exp.metric]);
      if (before.some((v) => v !== null) || after.some((v) => v !== null)) {
        withAverages = true;
        series.push({ name: 'Среднее до релиза', className: 'line-black exp-avg-before', values: before, hideNull: true });
        series.push({ name: 'Среднее после релиза', className: 'exp-avg-after', values: after, hideNull: true, swatch: 'fav', pointClass: 'point-fav' });
      }
    }
    const events = [];
    const key = groupDate(shown.release, exp.grain);
    if (dates.includes(key)) events.push({ key, label: `Релиз · ${formatDate(shown.release).slice(0, 5)}` });
    renderLineChart(container, dates, series, { width: window.innerWidth < 640 ? 360 : 1200, events });
    $('#exp-chart-title').textContent = `${METRICS[exp.metric].name}: ${shown.name}`;
    $('#exp-chart-note').textContent = `Только SEO · счётчик ${exp.data.meta.counters[shown.group]} · ${shown.url}${shown.urlScope === 'prefix' ? '*' : ' · только эта страница и параметры'} · ${formatPeriod(exp.from, exp.to)} · ${granularityLabel(exp.grain)}${METRICS[exp.metric].ratio ? ' · доли по суммам периода' : ''}${events.length ? ` · пунктир — релиз${exp.grain === 'day' ? '' : ' (период, включающий дату)'}` : ' · дата релиза вне выбранного периода'}`;
    legend.innerHTML = `<span><i class="legend-line fact"></i>${esc(shown.name)}</span>`
      + (withAverages ? '<span><i class="legend-line plan"></i>Среднее до</span><span><i class="legend-line exp-after"></i>Среднее после</span>' : '');
  }

  function renderResults() {
    const body = $('#exp-results-body'), note = $('#exp-results-note');
    if (exp.failed) { body.innerHTML = ''; note.textContent = ''; return; }
    const current = product();
    const metrics = [
      ['visits', METRICS.visits.daily], ['leads', METRICS.leads.daily], ['cr1', ratioFmt],
      ['sales', METRICS.sales.daily], ['cr2', ratioFmt], ['revenue', METRICS.revenue.daily],
    ];
    body.innerHTML = brandProducts().map((p) => {
      const w = windows(p);
      const st = w && w.after.length ? windowStats(p, w) : null;
      const cells = metrics.map(([m, fmt]) => (st
        ? `<td><span class="exp-res-values">${st.before[m] === null ? '—' : fmt(st.before[m])} → ${st.after[m] === null ? '—' : fmt(st.after[m])}</span>${deltaBadge(st.before[m], st.after[m])}</td>`
        : '<td>—</td>')).join('');
      return `<tr class="exp-page-row${p.id === current.id ? ' plan-row-active' : ''}" data-product="${p.id}" tabindex="0">`
        + `<td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>${p.note ? `<span class="plan-sub">${esc(p.note)}</span>` : ''}</td>`
        + `<td>${formatDate(p.release)}</td><td>${w ? `${w.before.length} / ${w.after.length}` : '—'}</td>${cells}</tr>`;
    }).join('');
    note.textContent = `${brandName(exp.brand)} · ${WINDOWS[exp.win]}. День релиза входит в «после». Значения — в среднем за день, CR — по суммам окна; цвет — «после» к «до». Клик по строке — показать страницу на графике и в воронке. Окна не учитывают сезонность и состав дней недели; рост не доказывает эффект доработки.`;
  }

  function renderTable() {
    const body = $('#exp-table-body');
    if (exp.failed) { body.innerHTML = ''; $('#exp-table-note').textContent = ''; return; }
    const idx = rangeIndexes(exp.data.dates, exp.from, exp.to);
    const row = (name, values, url, total) => `<tr${total ? ' class="direction-total"' : ''}>`
      + `<td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)}</td>`
      + `<td>${formatInt(values.visits)}</td><td>${formatInt(values.leads)}</td>`
      + `<td>${ratioFmt(values.cr1)}</td>`
      + `<td>${formatInt(values.sales)}</td>`
      + `<td>${ratioFmt(values.cr2)}</td>`
      + `<td>${formatInt(Math.round(values.revenue))}</td></tr>`;
    const perProduct = brandProducts().map((p) => ({ p, values: periodValues(p, idx) }));
    const totals = perProduct.reduce((acc, { values }) => ({
      visits: acc.visits + values.visits, leads: acc.leads + values.leads, sales: acc.sales + values.sales,
      revenue: acc.revenue + values.revenue,
    }), { visits: 0, leads: 0, sales: 0, revenue: 0 });
    totals.cr1 = totals.visits ? totals.leads / totals.visits : null;
    totals.cr2 = totals.leads ? totals.sales / totals.leads : null;
    body.innerHTML = perProduct.map(({ p, values }) => row(p.name, values, p.url, false)).join('') + row(`Итого: ${brandName(exp.brand)}`, totals, null, true);
    $('#exp-table-note').textContent = `Только SEO · суммы за ${formatPeriod(exp.from, exp.to)}; CR1 и CR2 — отношения сумм периода, не когортная конверсия. Канал CRM и атрибуция Метрики могут различаться.`;
  }

  function renderMethod() {
    const ul = $('#exp-method-list');
    if (exp.failed) { ul.innerHTML = `<li>${FAIL_MSG}</li>`; return; }
    const d = exp.data.meta.definitions;
    const releases = exp.data.products.map((p) => `«${esc(p.name)}» — ${formatDate(p.release)}`).join(', ');
    ul.innerHTML = [
      `Визиты: ${esc(d.visits)}`,
      `Лиды: ${esc(d.leads)}`,
      `Продажи: ${esc(d.sales)}`,
      `Выручка: ${esc(d.revenue)}`,
      `${esc(d.cr1)} ${esc(d.cr2)}`,
      `Период: ${formatPeriod(exp.data.meta.dateFrom, exp.data.meta.asOf)}. Лиды — дата создания; продажи и выручка — дата оплаты. Данные по состоянию на ${formatDate(exp.data.meta.asOf)}.`,
      `Окна сравнения: «равные окна» — все дни с даты релиза по ${formatDate(exp.data.meta.asOf)} против такого же числа дней непосредственно перед релизом; 7/14/28 дней — первые N дней после релиза против N дней до него (если после релиза прошло меньше, оба окна сокращаются); «весь период» — все дни с 01.06 до релиза против всех дней после (окна разной длины).`,
      `Релизы (файл «Вайбкодинг (холдинг)»): ${releases}.`,
      esc(exp.data.meta.note),
    ].map((t) => `<li>${t}</li>`).join('');
  }

  function renderAll() {
    // Данные ещё грузятся — тишина; app.js вызывает рендер до завершения fetch.
    if (!exp.data && !exp.failed) return;
    if (!exp.failed) {
      [exp.from, exp.to] = normalizedPeriod(exp.data.dates, exp.from, exp.to);
      exp.product = product().id;
      setDateInputs('exp', exp.data.dates, exp.from, exp.to);
      renderBrandTabs();
      populateProductSelect();
      $('#exp-metric').value = exp.metric;
      $('#exp-granularity').value = exp.grain;
      $('#exp-window').value = exp.win;
      renderFunnel();
    }
    renderChart(); renderResults(); renderTable(); renderMethod();
  }

  function updateUrl() {
    const params = new URLSearchParams();
    params.set('view', 'experiment');
    params.set('brand', exp.brand);
    if (exp.product) params.set('product', exp.product);
    params.set('metric', exp.metric);
    params.set('grain', exp.grain);
    params.set('win', exp.win);
    params.set('from', exp.from);
    params.set('to', exp.to);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  }

  function setupControls() {
    $('#exp-brand-tabs').addEventListener('click', (e) => {
      const button = e.target.closest('[data-brand]');
      if (!button) return;
      exp.brand = button.dataset.brand;
      exp.product = brandProducts()[0].id;
      renderAll(); updateUrl();
    });
    $('#exp-product').addEventListener('change', (e) => { exp.product = e.target.value; renderAll(); updateUrl(); });
    $('#exp-metric').addEventListener('change', (e) => { exp.metric = e.target.value; renderAll(); updateUrl(); });
    $('#exp-granularity').addEventListener('change', (e) => { exp.grain = e.target.value; renderAll(); updateUrl(); });
    $('#exp-window').addEventListener('change', (e) => { exp.win = e.target.value; renderAll(); updateUrl(); });
    $('#exp-date-from').addEventListener('change', (e) => {
      exp.from = e.target.value;
      if (exp.to && exp.from > exp.to) exp.to = exp.from;
      renderAll(); updateUrl();
    });
    $('#exp-date-to').addEventListener('change', (e) => {
      exp.to = e.target.value;
      if (exp.from && exp.to < exp.from) exp.from = exp.to;
      renderAll(); updateUrl();
    });
    const pick = (e) => {
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-product]');
      if (!row) return;
      exp.product = row.dataset.product;
      renderAll(); updateUrl();
      $('#exp-funnel-card').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    $('#exp-results-body').addEventListener('click', pick);
    $('#exp-results-body').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
    window.addEventListener('resize', () => {
      if (typeof state !== 'undefined' && state.view === 'experiment' && !exp.failed) renderChart();
    });
  }

  async function init() {
    try {
      exp.data = await window.loadJSON('experiment.json');
      exp.from = exp.data.dates[0];
      exp.to = exp.data.dates[exp.data.dates.length - 1];
      const raw = new URLSearchParams(location.search);
      const params = raw.get('view') === 'experiment' ? raw : new URLSearchParams();
      const productParam = params.get('product');
      const found = exp.data.products.find((p) => p.id === productParam);
      if (BRANDS.some((b) => b.id === params.get('brand'))) exp.brand = params.get('brand');
      else if (found) exp.brand = found.group;
      if (found && (exp.brand === 'all' || found.group === exp.brand)) exp.product = found.id;
      if (METRICS[params.get('metric')]) exp.metric = params.get('metric');
      if (['day', 'week', 'month'].includes(params.get('grain'))) exp.grain = params.get('grain');
      if (WINDOWS[params.get('win')]) exp.win = params.get('win');
      exp.from = snapDate(params.get('from')) || exp.from;
      exp.to = snapDate(params.get('to')) || exp.to;
      setupControls();
      if (typeof state !== 'undefined' && state.view === 'experiment') { renderAll(); updateUrl(); }
    } catch (error) {
      exp.failed = true;
      renderAll();
    }
  }

  window.renderExperiment = renderAll;
  window.updateExperimentUrl = updateUrl;
  window.initExperiment = init;
})();
