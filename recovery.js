/* Мониторинг метатегов: когорта «Не восстановилась» из recovery.json.
   Независимая схема: работает отдельно от data.json, не ломает «Лиды» и «Медиатрафик». */
(function () {
  'use strict';
  const PAGE_SIZE = 15;
  const weekdayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const rec = {
    data: null, loaded: false, failed: false,
    pageId: 'all', engineId: 'seo', grain: 'day', from: null, to: null,
    compare: false, pageSearch: '', tableSearch: '',
    sortKey: 'period', sortDir: 'desc', tablePage: 0, windows: null,
    tableGroup: 'all', groups: null,
  };
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const FAIL_MSG = 'Данные мониторинга метатегов пока не опубликованы: файл recovery.json не найден. Разделы «Лиды» и «Медиатрафик» работают в обычном режиме.';

  function isoShift(iso, days) {
    const dt = new Date(`${iso}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }
  function dowLabel(iso) { return weekdayNames[new Date(`${iso}T00:00:00Z`).getUTCDay()]; }
  function truncate(text, max) { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
  function pagesPlural(n) {
    const mod10 = n % 10, mod100 = n % 100;
    const word = mod10 === 1 && mod100 !== 11 ? 'страница' : [2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100) ? 'страницы' : 'страниц';
    return `${n} ${word}`;
  }

  function computeWindows() {
    const dates = rec.data.dates;
    const change = rec.data.meta && rec.data.meta.changeDate;
    if (!dates || !dates.length || !change) return { pre: [], post: [], change: null };
    // Grow to a full week, then track the latest seven available post-change days.
    const post = dates.filter((d) => d > change).slice(-7);
    const weekdays = new Set(post.map(dowLabel));
    const pre = dates.filter((d) => d >= isoShift(change, -7) && d < change && weekdays.has(dowLabel(d)));
    return { pre, post, change };
  }
  function snapDate(iso) {
    const dates = rec.data.dates;
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    if (dates.includes(iso)) return iso;
    if (iso <= dates[0]) return dates[0];
    if (iso >= dates[dates.length - 1]) return dates[dates.length - 1];
    const before = dates.filter((d) => d <= iso);
    return before.length ? before[before.length - 1] : dates[0];
  }
  function engineSeries(target, engineId) {
    if (!target) return null;
    if (engineId === 'seo') return target.seo && target.seo.length ? target.seo : null;
    const map = target.byEngine || {};
    return map[engineId] && map[engineId].length ? map[engineId] : null;
  }
  function nullSeries() { return rec.data.dates.map(() => null); }
  function selection() {
    const page = rec.pageId === 'all' ? null : rec.data.pages.find((p) => String(p.id) === String(rec.pageId));
    const target = page || rec.data.total;
    const label = page ? (page.path || page.url) : `Все ${pagesPlural(rec.data.pages.length)}`;
    return { page, target, label };
  }
  function engineLabel() {
    if (rec.engineId === 'seo') return 'SEO — все системы';
    const e = rec.data.engines.find((x) => String(x.id) === String(rec.engineId));
    return e ? e.name : 'SEO — все системы';
  }
  function windowStats(values, dayList) {
    if (!values) return null;
    const dates = rec.data.dates;
    let total = 0, days = 0;
    dayList.forEach((d) => {
      const i = dates.indexOf(d);
      if (i >= 0 && values[i] !== null && values[i] !== undefined) { total += Number(values[i]) || 0; days += 1; }
    });
    return days ? { sum: total, days, mean: total / days } : null;
  }
  function deltaPct(pre, post) {
    if (!pre || !post || pre.mean <= 0) return null;
    return post.mean / pre.mean - 1;
  }
  function formatDelta(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return (value > 0 ? '+' : '') + pctf.format(value);
  }

  function renderKpis() {
    const box = $('#rec-kpis');
    if (rec.failed) { box.innerHTML = `<div class="empty">${FAIL_MSG}</div>`; return; }
    const { target, label } = selection();
    const values = engineSeries(target, rec.engineId);
    const idx = rangeIndexes(rec.data.dates, rec.from, rec.to);
    const periodTotal = values ? sumNullable(idx.map((i) => values[i])) : null;
    const w = rec.windows;
    const pre = values ? windowStats(values, w.pre) : null;
    const post = values ? windowStats(values, w.post) : null;
    const delta = deltaPct(pre, post);
    const uneven = w.pre.length !== w.post.length;
    const cap = (list, extra) => list.length
      ? `${formatPeriod(list[0], list[list.length - 1])} · ${dowLabel(list[0])}–${dowLabel(list[list.length - 1])} · ${list.length} дн.${extra ? ` · ${extra}` : ''}`
      : 'нет дней после изменения в данных';
    box.innerHTML = [
      kpi(`${engineLabel()} за период`, periodTotal === null ? '—' : formatInt(periodTotal), `${formatPeriod(rec.from, rec.to)} · ${label}`, true),
      kpi('До изменения, в день', pre ? formatNumber(pre.mean) : '—', cap(w.pre)),
      kpi('После изменения, в день', post ? formatNumber(post.mean) : '—', cap(w.post, '08.09 исключён')),
      kpi('После к до', formatDelta(delta), uneven
        ? `Окна разной длины: ${w.pre.length} и ${w.post.length} дн.`
        : 'Сопоставимые дни недели, без 08.09'),
    ].join('');
  }

  function chartSeries() {
    const { target } = selection();
    const mk = (name, className, values) => ({ name, className, values: values || nullSeries() });
    if (rec.compare && rec.engineId === 'seo') {
      const g = rec.data.engines.find((e) => /google/i.test(e.name));
      const y = rec.data.engines.find((e) => /яндекс/i.test(e.name));
      const list = [mk('SEO — все системы', 'line-primary', engineSeries(target, 'seo'))];
      if (g) list.push(mk(g.name, 'rec-line-google', engineSeries(target, String(g.id))));
      if (y) list.push(mk(y.name, 'line-black', engineSeries(target, String(y.id))));
      return list;
    }
    return [mk(engineLabel(), 'line-primary', engineSeries(target, rec.engineId))];
  }
  function legendSwatch(className) {
    return { 'line-primary': 'seo', 'rec-line-google': 'rec-google', 'line-black': 'rec-yandex' }[className] || 'seo';
  }

  function renderRecChart(container, dates, series, options = {}) {
    if (!container || !dates.length) return;
    const width = options.width || 1200, height = options.height || 430;
    const margin = { top: 34, right: 28, bottom: 54, left: 76 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const allValues = series.flatMap((item) => item.values.filter((v) => v !== null && v !== undefined));
    if (!allValues.length) {
      container.innerHTML = '<div class="empty">Нет данных для выбранного среза.</div>';
      return;
    }
    const scale = niceScale(options.maximum ?? Math.max(...allValues));
    const x = (i) => margin.left + (dates.length === 1 ? innerW / 2 : i * innerW / (dates.length - 1));
    const y = (v) => margin.top + innerH - (v / scale.max) * innerH;
    const change = rec.windows.change;
    const changeKey = change ? groupDate(change, rec.grain) : null;
    const changeIndex = changeKey && rec.from <= change && change <= rec.to ? dates.indexOf(changeKey) : -1;

    let svg = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
    for (let tick = 0; tick <= Math.round(scale.max / scale.step); tick++) {
      const value = scale.step * tick;
      const yy = y(value);
      svg += `<line class="grid-line" x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}"></line>`;
      svg += `<text class="axis-label" x="${margin.left - 12}" y="${yy + 4}" text-anchor="end">${esc(formatCompact(value))}</text>`;
    }
    svg += `<line class="axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerH}"></line>`;
    svg += `<line class="axis-line" x1="${margin.left}" y1="${margin.top + innerH}" x2="${width - margin.right}" y2="${margin.top + innerH}"></line>`;
    const desiredTicks = options.ticks || (window.innerWidth < 700 ? 5 : 9);
    const tickStep = Math.max(1, Math.ceil((dates.length - 1) / (desiredTicks - 1)));
    const tickIndexes = [];
    for (let i = 0; i < dates.length; i += tickStep) tickIndexes.push(i);
    if (tickIndexes[tickIndexes.length - 1] !== dates.length - 1) {
      if (tickIndexes.length > 1 && dates.length - 1 - tickIndexes[tickIndexes.length - 1] < tickStep * 0.65) tickIndexes.pop();
      tickIndexes.push(dates.length - 1);
    }
    tickIndexes.forEach((index) => {
      const xx = x(index);
      svg += `<line class="axis-line" x1="${xx}" y1="${margin.top + innerH}" x2="${xx}" y2="${margin.top + innerH + 6}"></line>`;
      svg += `<text class="axis-label" x="${xx}" y="${height - 20}" text-anchor="middle">${esc(formatDate(dates[index]).slice(0, 5))}</text>`;
    });
    if (changeIndex >= 0) {
      const cx = x(changeIndex);
      const lx = Math.max(margin.left + 55, Math.min(cx, width - margin.right - 55));
      svg += `<line class="rec-change-line" x1="${cx}" y1="${margin.top - 8}" x2="${cx}" y2="${margin.top + innerH}"></line>`;
      svg += `<text class="rec-change-label" x="${lx}" y="${margin.top - 14}" text-anchor="middle">Метатеги ${esc(formatDate(change).slice(0, 5))}</text>`;
    }
    series.forEach((item) => {
      let path = '', drawing = false;
      item.values.forEach((value, index) => {
        if (value === null || value === undefined) { drawing = false; return; }
        path += `${drawing ? 'L' : 'M'}${x(index).toFixed(2)},${y(value).toFixed(2)} `;
        drawing = true;
      });
      svg += `<path class="${item.className}" d="${path.trim()}"></path>`;
      if (dates.length === 1 && item.values[0] !== null && item.values[0] !== undefined) {
        const pointClass = item.className.includes('primary') ? 'point-primary' : 'point-black';
        svg += `<circle class="rec-single-point ${pointClass}" r="5" cx="${x(0)}" cy="${y(item.values[0])}"></circle>`;
      }
    });
    svg += `<line class="hover-line" id="${container.id}-hover" x1="0" y1="${margin.top}" x2="0" y2="${margin.top + innerH}" visibility="hidden"></line>`;
    series.forEach((item, seriesIndex) => {
      svg += `<circle id="${container.id}-point-${seriesIndex}" class="${item.className.includes('primary') ? 'point-primary' : 'point-black'}" r="5" cx="0" cy="0" visibility="hidden"></circle>`;
    });
    svg += `<rect class="hit-area" x="${margin.left}" y="${margin.top}" width="${innerW}" height="${innerH}"></rect></svg>`;
    container.innerHTML = svg;

    const chartSvg = container.querySelector('svg');
    const hit = container.querySelector('.hit-area');
    const hover = container.querySelector(`#${container.id}-hover`);
    const tooltip = $('#tooltip');
    hit.addEventListener('mousemove', (event) => {
      const rect = chartSvg.getBoundingClientRect();
      const svgX = (event.clientX - rect.left) * width / rect.width;
      const index = Math.max(0, Math.min(dates.length - 1, Math.round((svgX - margin.left) * (dates.length - 1) / innerW)));
      const xx = x(index);
      hover.setAttribute('x1', xx); hover.setAttribute('x2', xx); hover.setAttribute('visibility', 'visible');
      let content = `<strong>${formatDate(dates[index])}</strong>`;
      series.forEach((item, seriesIndex) => {
        const value = item.values[index];
        const point = container.querySelector(`#${container.id}-point-${seriesIndex}`);
        if (value === null || value === undefined) {
          point.setAttribute('visibility', 'hidden');
        } else {
          point.setAttribute('cx', xx); point.setAttribute('cy', y(value)); point.setAttribute('visibility', 'visible');
        }
        content += `<br>${esc(item.name)}: ${value === null || value === undefined ? '—' : formatNumber(value)}`;
      });
      if (index === changeIndex) {
        content += `<br>${formatDate(change)} — метатеги изменены${rec.grain === 'day' ? '' : ' (в этом периоде)'}`;
      }
      tooltip.innerHTML = content;
      tooltip.classList.add('visible');
      tooltip.style.left = `${Math.min(window.innerWidth - 280, event.clientX + 16)}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - 24)}px`;
    });
    hit.addEventListener('mouseleave', () => {
      hover.setAttribute('visibility', 'hidden');
      series.forEach((_, index) => container.querySelector(`#${container.id}-point-${index}`).setAttribute('visibility', 'hidden'));
      tooltip.classList.remove('visible');
    });
  }

  function renderChart() {
    const container = $('#rec-chart');
    const title = $('#rec-chart-title'), note = $('#rec-chart-note'), legend = $('#rec-legend');
    if (rec.failed) {
      container.innerHTML = ''; title.textContent = 'SEO-визиты когорты';
      note.textContent = 'График появится после публикации recovery.json.'; legend.innerHTML = '';
      return;
    }
    const series = chartSeries();
    const chart = aggregateRange(rec.data.dates, series, rec.from, rec.to, rec.grain);
    renderRecChart(container, chart.dates, chart.series);
    const change = rec.windows.change;
    title.textContent = `${engineLabel()}: визиты`;
    const eventVisible = change && rec.from <= change && change <= rec.to;
    note.textContent = `${selection().label} · ${formatPeriod(rec.from, rec.to)} · ${granularityLabel(rec.grain)}` +
      (change ? eventVisible
        ? ` · линия — изменение метатегов ${formatDate(change)}${rec.grain === 'day' ? '' : ' (внутри периода; сумма включает дни до и после)'}`
        : ` · дата смены метатегов ${formatDate(change)} вне выбранного периода`
      : '');
    legend.innerHTML = chart.series.map((s) => `<span><i class="legend-line ${legendSwatch(s.className)}"></i>${esc(s.name)}</span>`).join('');
  }

  function classifyGrowthPages() {
    const groups = { grown: [], notgrown: [], unclassified: [], unchanged: 0 };
    const w = rec.windows;
    rec.data.pages.forEach((page) => {
      const values = engineSeries(page, rec.engineId);
      const pre = windowStats(values, w.pre), post = windowStats(values, w.post);
      // A missing day is not a zero. Only complete, weekday-matched windows qualify.
      if (!pre || !post || pre.days !== w.pre.length || post.days !== w.post.length || pre.days !== post.days) {
        groups.unclassified.push(page); return;
      }
      const difference = post.sum * pre.days - pre.sum * post.days;
      groups[difference > 0 ? 'grown' : 'notgrown'].push(page);
      if (difference === 0) groups.unchanged += 1;
    });
    return groups;
  }

  function renderGrowthGroups() {
    const rule = $('#rec-growth-rule'), note = $('#rec-growth-note');
    if (rec.failed) {
      rule.textContent = 'Группы появятся после загрузки данных мониторинга.';
      note.textContent = '';
      for (const key of ['grown', 'notgrown']) {
        $(`#rec-${key}-count`).textContent = '—';
        $(`#rec-${key}-stats`).textContent = '';
        $(`#rec-${key}-chart`).innerHTML = '';
        $(`[data-growth-group="${key}"]`).disabled = true;
      }
      return;
    }
    const groups = rec.groups, total = rec.data.pages.length, w = rec.windows;
    const period = formatPeriod(rec.from, rec.to);
    const windowLabel = (days) => days.length ? formatPeriod(days[0], days[days.length - 1]) : 'нет данных';
    rule.textContent = `«Выросли»: среднее число визитов в день за ${windowLabel(w.post)} выше, чем за ${windowLabel(w.pre)}. «Не выросли»: ниже или равно. ${engineLabel()}; ${w.change ? formatDate(w.change) : 'день изменения'} исключён.`;
    const charts = {};
    for (const key of ['grown', 'notgrown']) {
      const pages = groups[key];
      const values = rec.data.dates.map((_, i) => pages.reduce((s, p) => {
        const v = engineSeries(p, rec.engineId)?.[i];
        return s === null || v === null || v === undefined ? null : s + v;
      }, 0));
      const title = key === 'grown' ? 'Выросли' : 'Не выросли';
      charts[key] = aggregateRange(rec.data.dates, [{ name: `${title} · ${engineLabel()}`, className: key === 'grown' ? 'line-primary' : 'rec-line-google', values }], rec.from, rec.to, rec.grain);
      const visits = sumNullable(rangeIndexes(rec.data.dates, rec.from, rec.to).map(i => values[i]));
      $(`#rec-${key}-count`).innerHTML = `${formatInt(pages.length)} <span>из ${formatInt(total)} · ${total ? pctf.format(pages.length / total) : '—'}</span>`;
      $(`#rec-${key}-count`).dataset.count = pages.length;
      $(`#rec-${key}-stats`).textContent = `${engineLabel()} · ${period} · ${granularityLabel(rec.grain)}. Суммарные визиты группы: ${visits === null ? '—' : formatInt(visits)}.${key === 'notgrown' ? ` Без изменений: ${pagesPlural(groups.unchanged)}.` : ''}`;
      $(`[data-growth-group="${key}"]`).disabled = !pages.length;
    }
    const maximum = Math.max(0, ...Object.values(charts).flatMap(c => c.series[0].values).filter(v => v !== null));
    for (const key of ['grown', 'notgrown']) {
      const chart = charts[key], container = $(`#rec-${key}-chart`);
      if (!groups[key].length) container.innerHTML = '<div class="empty">В этой группе нет страниц.</div>';
      else renderRecChart(container, chart.dates, chart.series, { width: window.innerWidth < 640 ? 360 : 640, height: 360, ticks: 5, maximum });
    }
    note.textContent = `Обе группы — из всех ${total} страниц, независимо от выбора отдельной страницы выше. На графиках — сумма визитов, не число страниц; шкала общая. Состав групп фиксирован для всей линии по указанному сравнению и меняется при смене системы или обновлении данных, но не при выборе периода графика. Недостаточно данных: ${groups.unclassified.length} из ${total}. ${w.change && rec.from <= w.change && w.change <= rec.to ? 'Линия отмечает смену метатегов; неделя или месяц могут включать дни до и после.' : 'Дата изменения вне периода графиков.'} Рост — наблюдаемая динамика, не доказательство эффекта метатегов или статистической значимости.`;
  }

  function renderEngineTable() {
    const body = $('#rec-engine-body'), note = $('#rec-engine-note');
    if (rec.failed) { body.innerHTML = ''; note.textContent = 'Нет данных.'; return; }
    const { target } = selection();
    const idx = rangeIndexes(rec.data.dates, rec.from, rec.to);
    const seoValues = engineSeries(target, 'seo');
    const seoTotal = seoValues ? sumNullable(idx.map((i) => seoValues[i])) : null;
    const rows = rec.data.engines.map((e) => {
      const v = engineSeries(target, String(e.id));
      return { id: String(e.id), name: e.name, total: v ? sumNullable(idx.map((i) => v[i])) : null };
    }).filter((r) => r.total !== null).sort((a, b) => b.total - a.total);
    const engineSum = sum(rows.map((r) => r.total));
    const denom = seoTotal && seoTotal > 0 ? seoTotal : (engineSum > 0 ? engineSum : 0);
    let html = '';
    if (seoValues) {
      html += `<tr class="rec-engine-total"><td><button class="link-button" data-engine="seo" type="button">SEO — все системы</button></td><td>${formatInt(seoTotal || 0)}</td><td>${seoTotal > 0 ? '100 %' : '—'}</td></tr>`;
    }
    html += rows.map((r) => `<tr><td><button class="link-button" data-engine="${esc(r.id)}" type="button">${esc(r.name)}</button></td><td>${formatInt(r.total)}</td><td>${denom ? pctf.format(r.total / denom) : '—'}</td></tr>`).join('');
    body.innerHTML = html || '<tr><td colspan="3">Нет данных по системам за период.</td></tr>';
    note.textContent = `Визиты и доля от SEO за ${formatPeriod(rec.from, rec.to)}, выборка: ${selection().label}. Кликните систему, чтобы отфильтровать график и таблицы.`;
  }

  function computePageRow(page) {
    const values = engineSeries(page, rec.engineId);
    const idx = rangeIndexes(rec.data.dates, rec.from, rec.to);
    const period = values ? sumNullable(idx.map((i) => values[i])) : null;
    const pre = values ? windowStats(values, rec.windows.pre) : null;
    const post = values ? windowStats(values, rec.windows.post) : null;
    return { id: page.id, url: page.url, path: page.path || page.url, period, pre, post, delta: deltaPct(pre, post) };
  }

  function renderPagesTable() {
    const body = $('#rec-pages-body'), note = $('#rec-pages-note'), info = $('#rec-page-info');
    const prev = $('#rec-page-prev'), next = $('#rec-page-next');
    document.querySelectorAll('#rec-pages-head .th-sort').forEach((btn) => {
      btn.classList.toggle('sorted-asc', btn.dataset.sort === rec.sortKey && rec.sortDir === 'asc');
      btn.classList.toggle('sorted-desc', btn.dataset.sort === rec.sortKey && rec.sortDir === 'desc');
    });
    if (rec.failed) {
      body.innerHTML = ''; info.textContent = ''; prev.disabled = true; next.disabled = true;
      note.textContent = 'Нет данных.'; $('#rec-csv').disabled = true; return;
    }
    $('#rec-csv').disabled = false;
    const q = rec.tableSearch.trim().toLowerCase();
    const groupPages = rec.tableGroup === 'all' ? rec.data.pages : rec.groups[rec.tableGroup];
    $('#rec-table-group').value = rec.tableGroup;
    let rows = groupPages.map(computePageRow);
    if (q) rows = rows.filter((r) => `${r.path} ${r.url}`.toLowerCase().includes(q));
    const dir = rec.sortDir === 'asc' ? 1 : -1;
    const num = (v) => (v === null || v === undefined ? -Infinity : v);
    rows.sort((a, b) => {
      if (rec.sortKey === 'path') return a.path.localeCompare(b.path, 'ru') * dir;
      if (rec.sortKey === 'period') return (num(a.period) - num(b.period)) * dir;
      if (rec.sortKey === 'pre') return (num(a.pre && a.pre.mean) - num(b.pre && b.pre.mean)) * dir;
      if (rec.sortKey === 'post') return (num(a.post && a.post.mean) - num(b.post && b.post.mean)) * dir;
      return (num(a.delta) - num(b.delta)) * dir;
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    rec.tablePage = Math.min(Math.max(rec.tablePage, 0), totalPages - 1);
    const slice = rows.slice(rec.tablePage * PAGE_SIZE, (rec.tablePage + 1) * PAGE_SIZE);
    body.innerHTML = slice.length ? slice.map((r) => `<tr>
      <td><button class="link-button rec-show-page" data-page="${esc(r.id)}" type="button">График</button> · <a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">${esc(truncate(r.path, 80))}</a></td>
      <td>${r.period === null ? '—' : formatInt(r.period)}</td>
      <td>${r.pre ? formatNumber(r.pre.mean) : '—'}</td>
      <td>${r.post ? formatNumber(r.post.mean) : '—'}</td>
      <td>${formatDelta(r.delta)}</td>
    </tr>`).join('') : '<tr><td colspan="5">Ничего не найдено по запросу.</td></tr>';
    info.textContent = `Стр. ${rec.tablePage + 1} из ${totalPages} · страниц: ${rows.length}`;
    prev.disabled = rec.tablePage <= 0;
    next.disabled = rec.tablePage >= totalPages - 1;
    const w = rec.windows;
    const winText = (w.pre.length && w.post.length)
      ? `${formatPeriod(w.pre[0], w.pre[w.pre.length - 1])} против ${formatPeriod(w.post[0], w.post[w.post.length - 1])}`
      : 'окна сравнения неполные';
    const groupTitle = { all: 'Все страницы когорты', grown: 'Выросли', notgrown: 'Не выросли', unclassified: 'Недостаточно данных' }[rec.tableGroup];
    note.textContent = `${groupTitle} · ${engineLabel()} за ${formatPeriod(rec.from, rec.to)}. Кнопка «График» открывает страницу выше. «До/после» — средние дневные визиты: ${winText}, 08.09 исключён; эти окна не зависят от периода графика.`;
  }

  function renderUrlLine() {
    const el = $('#rec-url-line');
    if (rec.failed) { el.innerHTML = ''; return; }
    if (rec.pageId === 'all') {
      const m = rec.data.meta || {};
      el.innerHTML = `<span>Когорта: ${pagesPlural(rec.data.pages.length)} из файла «${esc(m.sourceFile || '')}», статус «${esc(m.status || '')}».</span>`;
    } else {
      const p = rec.data.pages.find((x) => String(x.id) === String(rec.pageId));
      el.innerHTML = p ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : '';
    }
  }

  function renderMethod() {
    const ul = $('#rec-method-list');
    if (rec.failed) { ul.innerHTML = `<li>${FAIL_MSG}</li>`; return; }
    const m = rec.data.meta || {};
    const change = m.changeDate ? formatDate(m.changeDate) : '—';
    const items = [
      `Источник — Яндекс Метрика, счётчик ${esc(String(m.counterId ?? '—'))}: ${esc(m.metric || 'Визиты')} (не просмотры) с атрибуцией «${esc(m.attribution || '—')}», поисковый трафик по выбранным системам.`,
      m.normalization
        ? `Нормализация адресов: ${esc(m.normalization)}.`
        : 'Учитываются визиты, начинающиеся на точном каноническом адресе страницы, включая параметры после нормализации.',
      `Данные ${m.sampled ? 'получены с семплированием' : 'без семплирования'}, по состоянию на ${formatDate(m.asOf || rec.data.dates[rec.data.dates.length - 1])}.`,
      `Когорта зафиксирована выгрузкой «${esc(m.sourceFile || '')}» со статусом «${esc(m.status || '')}» и не меняется; исторические числа из Excel с числами Метрики не смешиваются.`,
      `Статус «Не восстановилась» — атрибут когорты на дату проверки. Отчёт не утверждает восстановление позиций и причинно-следственную связь между изменением метатегов ${change} и динамикой трафика.`,
      `Сравнение «до/после» — средние дневные визиты: до 7 последних доступных дней после изменения против тех же дней недели за неделю до него. ${change} исключён как переходный день. Окна сравнения указаны в карточках и не зависят от периода графика; меняются при обновлении данных.`,
      'Группы «Выросли» / «Не выросли» определяются по точным средним дневным визитам в окнах сравнения: строго больше — рост; меньше или равно, в том числе 0 → 0, — без роста. Рост с нулевой базы учитывается, но процент при нулевой базе не вычисляется. Неполные данные не подменяются нулями и выводятся отдельно. Это не замена исходного статуса из Excel и не проверка статистической значимости.',
      'Последние дни могут уточняться Метрикой. Все регионы и устройства; учитываются только визиты, начавшиеся на выбранных страницах, с последним значимым источником organic.',
    ];
    ul.innerHTML = items.map((t) => `<li>${t}</li>`).join('');
  }

  function rebuildPageOptions() {
    if (!rec.loaded) return;
    const select = $('#rec-page');
    const q = rec.pageSearch.trim().toLowerCase();
    const current = String(rec.pageId);
    const pages = rec.data.pages;
    const opts = [{ id: 'all', label: `Все страницы (${pages.length})` }];
    if (current !== 'all') {
      const cur = pages.find((p) => String(p.id) === current);
      if (cur) opts.push({ id: current, label: truncate(cur.path || cur.url, 78) });
    }
    pages.forEach((p) => {
      if (String(p.id) === current) return;
      const hay = `${p.path || ''} ${p.url || ''}`.toLowerCase();
      if (!q || hay.includes(q)) opts.push({ id: String(p.id), label: truncate(p.path || p.url, 78) });
    });
    select.innerHTML = '';
    opts.forEach((o) => {
      const option = document.createElement('option');
      option.value = o.id;
      option.textContent = o.label;
      option.selected = o.id === current;
      select.appendChild(option);
    });
  }

  function populateEngineSelect() {
    const select = $('#rec-engine');
    const options = [{ id: 'seo', name: 'SEO — все системы' }, ...rec.data.engines.map((e) => ({ id: String(e.id), name: e.name }))];
    populateSelect(select, options, String(rec.engineId));
    populateSelect($('#rec-groups-engine'), options, String(rec.engineId));
  }

  function updateRecoveryUrl() {
    if (!rec.loaded) return;
    const params = new URLSearchParams();
    params.set('view', 'recovery');
    params.set('page', String(rec.pageId));
    params.set('engine', String(rec.engineId));
    params.set('grain', rec.grain);
    params.set('from', rec.from);
    params.set('to', rec.to);
    if (rec.compare) params.set('compare', '1');
    if (rec.tableGroup !== 'all') params.set('group', rec.tableGroup);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }

  function downloadCsv() {
    if (!rec.loaded) return;
    const { target } = selection();
    const values = engineSeries(target, rec.engineId) || nullSeries();
    const idx = rangeIndexes(rec.data.dates, rec.from, rec.to);
    const sliceId = rec.pageId === 'all' ? 'all' : String(rec.pageId);
    const page = selection().page;
    const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = ['\uFEFFdate;visits;page_id;url;search_engine_id;search_engine'];
    idx.forEach((i) => {
      const v = values[i];
      lines.push([rec.data.dates[i], v === null || v === undefined ? '' : v, sliceId, page ? page.url : 'Все страницы когорты', String(rec.engineId), engineLabel()].map(cell).join(';'));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const href = URL.createObjectURL(blob);
    link.href = href;
    link.download = `metatags_${sliceId}_${String(rec.engineId).replace(/[^a-z0-9-]/gi, '_')}_${rec.from}_${rec.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  }

  function renderAll() {
    if (!rec.loaded && !rec.failed) return;
    if (rec.loaded) {
      [rec.from, rec.to] = normalizedPeriod(rec.data.dates, rec.from, rec.to);
      setDateInputs('rec', rec.data.dates, rec.from, rec.to);
      setDateInputs('rec-groups', rec.data.dates, rec.from, rec.to);
      $('#rec-granularity').value = rec.grain;
      $('#rec-groups-granularity').value = rec.grain;
      rec.groups = classifyGrowthPages();
      populateEngineSelect();
      rebuildPageOptions();
      const g = rec.data.engines.find((e) => /google/i.test(e.name));
      const y = rec.data.engines.find((e) => /яндекс/i.test(e.name));
      const compareControl = $('#rec-compare-control');
      compareControl.hidden = !(rec.engineId === 'seo' && g && y);
      if (compareControl.hidden) rec.compare = false;
      $('#rec-compare').checked = rec.compare;
    }
    renderUrlLine(); renderKpis(); renderChart(); renderGrowthGroups(); renderEngineTable(); renderPagesTable(); renderMethod();
  }

  function setupControls() {
    window.addEventListener('resize', () => {
      if (rec.loaded && !rec.failed && state.view === 'recovery') renderGrowthGroups();
    });
    // Mirror the existing shared controls immediately above the two group charts.
    for (const field of ['engine', 'granularity', 'date-from', 'date-to']) {
      $(`#rec-groups-${field}`).addEventListener('change', (e) => {
        const main = $(`#rec-${field}`);
        main.value = e.target.value;
        main.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    $('#rec-table-group').addEventListener('change', (e) => {
      rec.tableGroup = e.target.value; rec.tablePage = 0;
      renderPagesTable(); updateRecoveryUrl();
    });
    document.querySelectorAll('[data-growth-group]').forEach(button => {
      button.addEventListener('click', () => {
        rec.tableGroup = button.dataset.growthGroup; rec.tablePage = 0; rec.tableSearch = '';
        $('#rec-pages-search').value = '';
        renderPagesTable(); updateRecoveryUrl();
        $('#rec-table-group').scrollIntoView({ block: 'center' });
      });
    });
    $('#rec-page').addEventListener('change', (e) => { rec.pageId = e.target.value; rec.tablePage = 0; renderAll(); updateRecoveryUrl(); });
    $('#rec-page-search').addEventListener('input', (e) => { rec.pageSearch = e.target.value; rebuildPageOptions(); });
    $('#rec-engine').addEventListener('change', (e) => { rec.engineId = e.target.value; rec.tablePage = 0; renderAll(); updateRecoveryUrl(); });
    $('#rec-granularity').addEventListener('change', (e) => { rec.grain = e.target.value; renderAll(); updateRecoveryUrl(); });
    $('#rec-date-from').addEventListener('change', (e) => {
      rec.from = e.target.value;
      if (rec.to && rec.from > rec.to) rec.to = rec.from;
      renderAll(); updateRecoveryUrl();
    });
    $('#rec-date-to').addEventListener('change', (e) => {
      rec.to = e.target.value;
      if (rec.from && rec.to < rec.from) rec.from = rec.to;
      renderAll(); updateRecoveryUrl();
    });
    $('#rec-compare').addEventListener('change', (e) => { rec.compare = e.target.checked; renderAll(); updateRecoveryUrl(); });
    $('#rec-engine-body').addEventListener('click', (e) => {
      const button = e.target.closest('button[data-engine]');
      if (!button) return;
      rec.engineId = button.dataset.engine;
      rec.tablePage = 0;
      renderAll(); updateRecoveryUrl();
    });
    $('#rec-pages-body').addEventListener('click', (e) => {
      const button = e.target.closest('button[data-page]');
      if (!button) return;
      rec.pageId = button.dataset.page;
      renderAll(); updateRecoveryUrl();
      $('#recovery .chart-filter-bar').scrollIntoView({ block: 'start' });
    });
    $('#rec-pages-search').addEventListener('input', (e) => { rec.tableSearch = e.target.value; rec.tablePage = 0; renderPagesTable(); });
    $('#rec-csv').addEventListener('click', downloadCsv);
    document.querySelectorAll('#rec-pages-head .th-sort').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        if (rec.sortKey === key) rec.sortDir = rec.sortDir === 'asc' ? 'desc' : 'asc';
        else { rec.sortKey = key; rec.sortDir = key === 'path' ? 'asc' : 'desc'; }
        renderPagesTable();
      });
    });
    $('#rec-page-prev').addEventListener('click', () => { rec.tablePage -= 1; renderPagesTable(); });
    $('#rec-page-next').addEventListener('click', () => { rec.tablePage += 1; renderPagesTable(); });
  }

  async function init() {
    try {
      const data = await window.loadJSON('recovery.json');
      if (!data || !Array.isArray(data.dates) || !data.dates.length || !Array.isArray(data.pages) || !data.total) {
        throw new Error('recovery.json: неожиданная схема данных');
      }
      data.engines = Array.isArray(data.engines) ? data.engines : [];
      data.meta = data.meta || {};
      rec.data = data;
      rec.loaded = true;
      rec.windows = computeWindows();
      const rawParams = new URLSearchParams(location.search);
      const params = rawParams.get('view') === 'recovery' ? rawParams : new URLSearchParams();
      rec.compare = params.get('compare') === '1';
      if (['grown', 'notgrown', 'unclassified'].includes(params.get('group'))) rec.tableGroup = params.get('group');
      const defaultFrom = rec.data.dates[0] > '2026-08-01' ? rec.data.dates[0] : '2026-08-01';
      rec.from = defaultFrom;
      rec.to = rec.data.dates[rec.data.dates.length - 1];
      const pageParam = params.get('page');
      if (pageParam === 'all' || rec.data.pages.some((p) => String(p.id) === pageParam)) rec.pageId = pageParam;
      const engineParam = params.get('engine');
      if (engineParam === 'seo' || rec.data.engines.some((e) => String(e.id) === engineParam)) rec.engineId = engineParam;
      const grainParam = params.get('grain');
      if (['day', 'week', 'month'].includes(grainParam)) rec.grain = grainParam;
      rec.from = snapDate(params.get('from')) || rec.from;
      rec.to = snapDate(params.get('to')) || rec.to;
      setupControls();
      if (typeof state !== 'undefined' && state.view === 'recovery') {
        renderAll();
        updateRecoveryUrl();
      }
    } catch (error) {
      rec.failed = true;
      renderAll();
    }
  }

  window.renderRecovery = renderAll;
  window.updateRecoveryUrl = updateRecoveryUrl;
  window.initRecovery = init;
})();
