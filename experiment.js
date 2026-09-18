/* Эксперимент: доработка лендингов Contented (вайбкодинг). Данные — experiment.json.
   Работает поверх глобальных хелперов app.js, не меняя другие разделы. */
(function () {
  'use strict';
  const exp = {
    data: null, failed: false,
    metric: 'visits', grain: 'day', from: null, to: null, product: null,
  };
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const FAIL_MSG = 'Данные эксперимента пока не опубликованы: файл experiment.json не найден. Остальные разделы работают в обычном режиме.';
  const METRICS = {
    visits: { name: 'Визиты', format: (v) => formatInt(v) },
    leads: { name: 'Лиды', format: (v) => formatInt(v) },
    cr1: { name: 'CR1', format: (v) => v === null ? '—' : pctf.format(v) },
    sales: { name: 'Продажи', format: (v) => formatInt(v) },
    cr2: { name: 'CR2', format: (v) => v === null ? '—' : pctf.format(v) },
    revenue: { name: 'Выручка', format: (v) => formatInt(Math.round(v)) },
  };
  const LINE_CLASSES = ['line-primary', 'line-black', 'exp-line-third'];
  // Даты выкатки новых версий лендингов — по информации пользователя.
  const RELEASES = { interior: '2026-08-28', photo: '2026-09-09', gamedesign: '2026-08-18' };

  function snapDate(iso) {
    const dates = exp.data.dates;
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    if (dates.includes(iso)) return iso;
    if (iso <= dates[0]) return dates[0];
    if (iso >= dates[dates.length - 1]) return dates[dates.length - 1];
    const before = dates.filter((d) => d <= iso);
    return before.length ? before[before.length - 1] : dates[0];
  }

  // CR пересчитывается по суммам периода, а не как среднее дневных долей.
  function periodValues(product, idx) {
    const g = (m) => sum(idx.map((i) => product[m][i]));
    const visits = g('visits'), leads = g('leads'), sales = g('sales');
    return {
      visits, leads, sales, revenue: g('revenue'),
      cr1: visits ? leads / visits : null,
      cr2: leads ? sales / leads : null,
    };
  }

  function bucketSeries(product) {
    // Возвращает ряд значений выбранной метрики по бакетам детализации.
    // aggregateRange принимает только массив серий — объект вызывает ошибку рендера.
    const agg = (values) => aggregateRange(exp.data.dates, [{ values }], exp.from, exp.to, exp.grain);
    if (exp.metric === 'cr1' || exp.metric === 'cr2') {
      const denom = exp.metric === 'cr1' ? agg(product.visits) : agg(product.leads);
      const numer = exp.metric === 'cr1' ? agg(product.leads) : agg(product.sales);
      return { dates: denom.dates, values: denom.series[0].values.map((v, i) => {
        const n = numer.series[0].values[i];
        return v ? n / v : null;
      }) };
    }
    const aggregated = agg(product[exp.metric]);
    return { dates: aggregated.dates, values: aggregated.series[0].values };
  }

  function selectedProducts() {
    if (exp.product === 'all') return exp.data.products;
    return exp.data.products.filter((p) => p.id === exp.product);
  }

  function renderChart() {
    const container = $('#exp-chart'), legend = $('#exp-legend');
    if (exp.failed) { container.innerHTML = ''; legend.innerHTML = ''; $('#exp-chart-note').textContent = FAIL_MSG; return; }
    const shown = selectedProducts();
    const series = shown.map((p, i) => ({
      name: p.name, className: LINE_CLASSES[exp.data.products.indexOf(p)], values: bucketSeries(p).values,
    }));
    const dates = bucketSeries(shown[0]).dates;
    const events = shown
      .filter((p) => RELEASES[p.id])
      .map((p) => {
        const key = groupDate(RELEASES[p.id], exp.grain);
        if (!dates.includes(key)) return null;
        const short = formatDate(RELEASES[p.id]).slice(0, 5);
        return { key, className: `event-${p.id}`,
                 label: exp.product === 'all' ? `${p.name} · ${short}` : `Новая версия · ${short}` };
      })
      .filter(Boolean);
    renderLineChart(container, dates, series, { width: window.innerWidth < 640 ? 360 : 1200, events });
    $('#exp-chart-title').textContent = `${METRICS[exp.metric].name}: ${exp.product === 'all' ? 'динамика по продуктам' : shown[0].name}`;
    $('#exp-chart-note').textContent = `${exp.product === 'all' ? 'Все каналы' : shown[0].url} · ${formatPeriod(exp.from, exp.to)} · ${granularityLabel(exp.grain)}${exp.metric === 'cr1' || exp.metric === 'cr2' ? ' · доли пересчитаны по суммам периода' : ''}${events.length ? ` · пунктир — выкатка новой версии${exp.grain === 'day' ? '' : ' (период, включающий дату)'}` : ' · дата выкатки вне выбранного периода'}`;
    legend.innerHTML = shown.map((p) => {
      const index = exp.data.products.indexOf(p);
      const swatch = index === 0 ? 'fact' : index === 1 ? 'plan' : 'exp-legend-third';
      return `<span><i class="legend-line ${swatch}"></i>${esc(p.name)}</span>`;
    }).join('');
  }

  function renderTable() {
    const body = $('#exp-table-body');
    if (exp.failed) { body.innerHTML = ''; $('#exp-table-note').textContent = ''; return; }
    const idx = rangeIndexes(exp.data.dates, exp.from, exp.to);
    const row = (name, values, url, total) => `<tr${total ? ' class="direction-total"' : ''}>` +
      `<td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)}</td>` +
      `<td>${formatInt(values.visits)}</td><td>${formatInt(values.leads)}</td>` +
      `<td>${values.cr1 === null ? '—' : pctf.format(values.cr1)}</td>` +
      `<td>${formatInt(values.sales)}</td>` +
      `<td>${values.cr2 === null ? '—' : pctf.format(values.cr2)}</td>` +
      `<td>${formatInt(Math.round(values.revenue))}</td></tr>`;
    const perProduct = exp.data.products.map((p) => ({ p, values: periodValues(p, idx) }));
    const totals = perProduct.reduce((acc, { values }) => ({
      visits: acc.visits + values.visits, leads: acc.leads + values.leads, sales: acc.sales + values.sales,
      revenue: acc.revenue + values.revenue,
    }), { visits: 0, leads: 0, sales: 0, revenue: 0 });
    totals.cr1 = totals.visits ? totals.leads / totals.visits : null;
    totals.cr2 = totals.leads ? totals.sales / totals.leads : null;
    body.innerHTML = perProduct.map(({ p, values }) => row(p.name, values, p.url, false)).join('') + row('Все продукты', totals, null, true);
    $('#exp-table-note').textContent = `Суммы за ${formatPeriod(exp.from, exp.to)}; CR1 и CR2 пересчитаны по суммам периода.`;
  }

  function renderMethod() {
    const ul = $('#exp-method-list');
    if (exp.failed) { ul.innerHTML = `<li>${FAIL_MSG}</li>`; return; }
    const d = exp.data.meta.definitions;
    ul.innerHTML = [
      `Визиты: ${esc(d.visits)}`,
      `Лиды: ${esc(d.leads)}`,
      `Продажи: ${esc(d.sales)}`,
      `Выручка: ${esc(d.revenue)}`,
      `${esc(d.cr1)} ${esc(d.cr2)}`,
      `Период: ${formatPeriod(exp.data.meta.dateFrom, exp.data.meta.asOf)}. Лиды — дата создания; продажи и выручка — дата оплаты. Данные по состоянию на ${formatDate(exp.data.meta.asOf)}.`,
      'Выкатка новых версий страниц (по информации пользователя): «Дизайн интерьеров» — 28.08.2026, «Фотография» — 09.09.2026, «Геймдизайн» — 18.08.2026. Пунктирная линия на графике отмечает эти даты; смена версии — лишь один из факторов динамики.',
      esc(exp.data.meta.note),
    ].map((t) => `<li>${t}</li>`).join('');
  }

  // Итоги эксперимента: «до выката» (01.06 — день до запуска) против «после» (дата запуска — текущая дата).
  // Абсолютные метрики сравниваются средним за день, CR — по суммам окна; пороги цвета как у направлений core.
  function renderResults() {
    const body = $('#exp-results-body'), head = $('#exp-results-head'), note = $('#exp-results-note');
    if (exp.failed) { body.innerHTML = ''; head.innerHTML = ''; note.textContent = ''; return; }
    const dates = exp.data.dates;
    const released = exp.data.products.filter((p) => RELEASES[p.id]);
    const windows = released.map((p) => {
      const start = dates.indexOf(RELEASES[p.id]);
      return { product: p, before: dates.map((_, i) => i).slice(0, start), after: dates.map((_, i) => i).slice(start) };
    });
    head.innerHTML = '<tr><th>Метрика</th>' + windows.map(({ product }) =>
      `<th>${esc(product.name)}<br><span class="exp-results-from">после ${formatDate(RELEASES[product.id])}</span></th>`).join('') + '</tr>';
    const badge = (ratio) => {
      if (ratio === null || ratio === undefined || !isFinite(ratio)) return '—';
      const tier = ratio >= 1 ? 'good' : ratio >= 0.9 ? 'mid' : 'low';
      return `<span class="exec-badge exec-${tier}">${pctf.format(ratio)}</span>`;
    };
    const cell = (beforeValue, afterValue, ratio, formatter) =>
      `<td><span class="exp-res-values">${formatter(beforeValue)} → ${formatter(afterValue)}</span>${badge(ratio)}</td>`;
    const average = (p, idx, m) => idx.length ? idx.reduce((s, i) => s + p[m][i], 0) / idx.length : null;
    const metricRows = [
      { name: 'Визиты, в день', m: 'visits', fmt: (v) => v === null ? '—' : formatNumber(v) },
      { name: 'Лиды, в день', m: 'leads', fmt: (v) => v === null ? '—' : formatNumber(v) },
      { name: 'Продажи, в день', m: 'sales', fmt: (v) => v === null ? '—' : formatNumber(v) },
      { name: 'Выручка, в день', m: 'revenue', fmt: (v) => v === null ? '—' : formatInt(Math.round(v)) },
    ];
    body.innerHTML = metricRows.map((metric) =>
      `<tr><td>${metric.name}</td>${windows.map(({ product, before, after }) => {
        const b = average(product, before, metric.m), a = average(product, after, metric.m);
        return cell(b, a, b ? a / b : null, metric.fmt);
      }).join('')}</tr>`).join('')
      + ['cr1', 'cr2'].map((metric) => {
        const label = metric === 'cr1' ? 'CR1 (лиды к визитам)' : 'CR2 (продажи к лидам)';
        return `<tr><td>${label}</td>${windows.map(({ product, before, after }) => {
          const cr = (idx) => {
            const visits = idx.reduce((s, i) => s + product.visits[i], 0);
            const leads = idx.reduce((s, i) => s + product.leads[i], 0);
            const sales = idx.reduce((s, i) => s + product.sales[i], 0);
            return metric === 'cr1' ? (visits ? leads / visits : null) : (leads ? sales / leads : null);
          };
          const b = cr(before), a = cr(after);
          return cell(b, a, b ? a / b : null, (v) => v === null ? '—' : pctf.format(v));
        }).join('')}</tr>`;
      }).join('');
    const spans = windows.map(({ product, before, after }) => `${product.name}: до ${before.length} дн. / после ${after.length} дн.`);
    note.textContent = `«До» — с ${formatDate(dates[0])} по день перед выкаткой; «после» — с даты выкатки по ${formatDate(dates[dates.length - 1])}. Абсолютные метрики — средние за день (${spans.join(' · ')}); CR — по суммам окна. Цвет — «после» к «до». Окна разной длины и разного состава дней недели; рост не доказывает эффект доработки.`;
  }

  function renderAll() {
    // Данные ещё грузятся — тишина; app.js вызывает рендер до завершения fetch.
    if (!exp.data && !exp.failed) return;
    if (!exp.failed) {
      [exp.from, exp.to] = normalizedPeriod(exp.data.dates, exp.from, exp.to);
      setDateInputs('exp', exp.data.dates, exp.from, exp.to);
      populateProductSelect();
      $('#exp-metric').value = exp.metric;
      $('#exp-granularity').value = exp.grain;
    }
    renderChart(); renderTable(); renderResults(); renderMethod();
  }

  function populateProductSelect() {
    const select = $('#exp-product');
    select.innerHTML = '';
    [{ id: 'all', name: 'Все продукты вместе' }, ...exp.data.products].forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      option.selected = p.id === exp.product;
      select.appendChild(option);
    });
  }

  function updateUrl() {
    const params = new URLSearchParams();
    params.set('view', 'experiment');
    if (exp.product && exp.product !== 'all') params.set('product', exp.product);
    params.set('metric', exp.metric);
    params.set('grain', exp.grain);
    params.set('from', exp.from);
    params.set('to', exp.to);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }

  function setupControls() {
    $('#exp-product').addEventListener('change', (e) => { exp.product = e.target.value; renderAll(); updateUrl(); });
    $('#exp-metric').addEventListener('change', (e) => { exp.metric = e.target.value; renderAll(); updateUrl(); });
    $('#exp-granularity').addEventListener('change', (e) => { exp.grain = e.target.value; renderAll(); updateUrl(); });
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
    window.addEventListener('resize', () => {
      if (typeof state !== 'undefined' && state.view === 'experiment' && !exp.failed) renderChart();
    });
  }

  async function init() {
    try {
      exp.data = await window.loadJSON('experiment.json');
      exp.from = exp.data.dates[0];
      exp.to = exp.data.dates[exp.data.dates.length - 1];
      exp.product = exp.data.products[0].id;
      const raw = new URLSearchParams(location.search);
      const params = raw.get('view') === 'experiment' ? raw : new URLSearchParams();
      const productParam = params.get('product');
      if (productParam === 'all' || exp.data.products.some((p) => p.id === productParam)) exp.product = productParam;
      if (METRICS[params.get('metric')]) exp.metric = params.get('metric');
      if (['day', 'week', 'month'].includes(params.get('grain'))) exp.grain = params.get('grain');
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
