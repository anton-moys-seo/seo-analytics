/* Апдейты статей: только updates.json через защищённый loadJSON. */
(function () {
  'use strict';
  const DAY = 86400000;
  const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
  const distance = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
  const validValue = (value) => Number.isInteger(value) && value >= 0;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  function safeUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch (_) { return null; }
  }
  function bucket(date, grain) {
    if (grain === 'month') return date.slice(0, 7) + '-01';
    if (grain === 'week') return shift(date, -(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7);
    return date;
  }
  function normalize(raw, today) {
    if (!raw || !isDate(raw.meta?.asOf) || !Array.isArray(raw.dates) || !Array.isArray(raw.pages)) throw new Error('UPDATES_SCHEMA');
    if (raw.dates.some((date, i) => !isDate(date) || (i && date <= raw.dates[i - 1]))) throw new Error('UPDATES_DATES');
    const ids = new Set();
    const pages = raw.pages.map((page) => {
      if (!page || typeof page.id !== 'string' || !page.id || page.id === 'all' || ids.has(page.id) || !Array.isArray(page.updates) || !Array.isArray(page.seo) || page.seo.length !== raw.dates.length) throw new Error('UPDATES_PAGES');
      if (page.seo.some((value) => value !== null && !validValue(value))) throw new Error('UPDATES_VALUES');
      ids.add(page.id);
      const events = new Map();
      for (const event of page.updates) {
        if (!isDate(event.date)) throw new Error('UPDATES_EVENTS');
        if (event.date > raw.meta.asOf) continue;
        if (!events.has(event.date)) events.set(event.date, { date: event.date, sourceRows: [] });
        const current = events.get(event.date);
        current.sourceRows = [...new Set([...current.sourceRows, ...(event.sourceRows || []).filter(Number.isInteger)])].sort((a, b) => a - b);
      }
      return { ...page, title: String(page.title || page.path || page.url || page.id), path: String(page.path || page.url || page.id), url: String(page.url || ''), updates: [...events.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    });
    // asOf — последний полный день источника; текущий московский день исключаем.
    const sourceCutoff = shift(raw.meta.asOf, 1);
    const cutoff = isDate(today) && today < sourceCutoff ? today : sourceCutoff;
    return { meta: raw.meta, dates: raw.dates, pages, cutoff, completeDates: raw.dates.filter((d) => d < cutoff), dateIndex: new Map(raw.dates.map((d, i) => [d, i])) };
  }
  function comparison(data, page, event, windowDays) {
    const position = page.updates.findIndex((e) => e.date === event.date);
    const previous = page.updates[position - 1]?.date || null;
    const next = page.updates[position + 1]?.date || null;
    const available = (direction) => {
      let count = 0;
      for (let i = 1; i <= windowDays; i++) {
        const date = shift(event.date, direction * i);
        if (date >= data.cutoff || (previous && date <= previous) || (next && date >= next)) break;
        const index = data.dateIndex.get(date);
        if (index === undefined || !validValue(page.seo[index])) break;
        count++;
      }
      return count;
    };
    const before = available(-1), after = available(1), n = Math.min(windowDays, before, after);
    const restrictedPrevious = Boolean(previous && distance(previous, event.date) - 1 < windowDays);
    const restrictedNext = Boolean(next && distance(event.date, next) - 1 < windowDays);
    const sumSide = (direction) => {
      let total = 0;
      for (let i = 1; i <= n; i++) total += page.seo[data.dateIndex.get(shift(event.date, direction * i))];
      return total;
    };
    const pre = n ? sumSide(-1) : null, post = n ? sumSide(1) : null;
    return { page, date: event.date, sourceRows: event.sourceRows, n, before, after, pre, post, avgPre: n ? pre / n : null, avgPost: n ? post / n : null, delta: pre > 0 ? post / pre - 1 : null, previous, next, restrictedPrevious, restrictedNext,
      preFrom: n ? shift(event.date, -n) : null, preTo: n ? shift(event.date, -1) : null, postFrom: n ? shift(event.date, 1) : null, postTo: n ? shift(event.date, n) : null };
  }
  function cohort(data, month, query) {
    const q = query.trim().toLocaleLowerCase('ru');
    return data.pages.filter((p) => p.updates.some((e) => month === 'all' || e.date.startsWith(month)) && (!q || `${p.title} ${p.url} ${p.path}`.toLocaleLowerCase('ru').includes(q)));
  }
  function traffic(data, pages, from, to, grain) {
    const groups = new Map();
    for (const date of data.completeDates) {
      if (date < from || date > to) continue;
      const key = bucket(date, grain), index = data.dateIndex.get(date);
      if (!groups.has(key)) groups.set(key, { key, start: date, end: date, value: pages.length ? 0 : null });
      const g = groups.get(key); g.end = date;
      let daily = pages.length ? 0 : null;
      for (const page of pages) { if (!validValue(page.seo[index])) { daily = null; break; } daily += page.seo[index]; }
      g.value = g.value === null || daily === null ? null : g.value + daily;
    }
    return [...groups.values()];
  }
  function markers(pages, from, to, grain) {
    const groups = new Map();
    for (const page of pages) for (const event of page.updates) {
      if (event.date < from || event.date > to) continue;
      const key = bucket(event.date, grain);
      if (!groups.has(key)) groups.set(key, new Map());
      const dates = groups.get(key);
      dates.set(event.date, (dates.get(event.date) || 0) + 1);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, dates]) => ({ key, dates: [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })), count: [...dates.values()].reduce((a, b) => a + b, 0) }));
  }
  function focusRange(data, month = 'all', windowDays = 28, eventDate = null) {
    const min = data.completeDates[0], max = data.completeDates[data.completeDates.length - 1];
    if (!min || !max) return [null, null];
    let from, to;
    if (isDate(eventDate)) {
      from = shift(eventDate, -windowDays); to = shift(eventDate, windowDays);
    } else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      const start = month + '-01';
      const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
      from = shift(start, -windowDays); to = shift(end, windowDays);
    } else {
      to = data.meta.asOf; from = shift(to, -89);
    }
    const clamp = (date) => date < min ? min : date > max ? max : date;
    return [clamp(from), clamp(to)];
  }
  function unavailableHistoryRanges(meta) {
    const ranges = meta.historyAvailability?.unavailableRanges;
    return Array.isArray(ranges) ? ranges.filter((range) => range && isDate(range.from) && isDate(range.through) && range.from <= range.through) : [];
  }
  function missingHistory(meta, from, through = from) {
    return unavailableHistoryRanges(meta).some((range) => range.from <= through && range.through >= from);
  }
  const analysis = Object.freeze({ normalize, comparison, cohort, traffic, markers, bucket, safeUrl, focusRange, missingHistory });
  if (typeof module !== 'undefined' && module.exports) module.exports = analysis;
  if (typeof window === 'undefined') return;
  window.UpdatesAnalysis = analysis;

  const $ = (selector) => document.querySelector(selector);
  const ui = { data: null, phase: 'loading', initialized: false, pending: null, month: 'all', article: 'all', q: '', window: 28, grain: 'day', from: null, to: null, focusEvent: null, sort: 'date', direction: -1, page: 0 };
  const PAGE_SIZE = 20;
  const active = () => typeof state !== 'undefined' && state.view === 'updates';
  const number = (value) => value === null ? '—' : formatNumber(value);
  const delta = (pre, post) => pre === null || post === null ? '—' : pre === 0 ? (post > 0 ? 'Рост с нуля' : '— (база 0)') : `${post > pre ? '+' : ''}${pctf.format(post / pre - 1)}`;
  function option(select, value, label, selected) {
    const node = document.createElement('option'); node.value = value; node.textContent = label; node.selected = value === selected; select.appendChild(node);
  }
  function loadState() {
    const raw = new URLSearchParams(location.search), p = raw.get('view') === 'updates' ? raw : new URLSearchParams();
    ui.month = /^\d{4}-\d{2}$/.test(p.get('month') || '') ? p.get('month') : 'all';
    ui.article = p.get('article') || 'all'; ui.q = p.get('q') || '';
    ui.window = [7, 14, 28].includes(Number(p.get('window'))) ? Number(p.get('window')) : 28;
    ui.grain = ['day', 'week', 'month'].includes(p.get('grain')) ? p.get('grain') : 'day';
    ui.from = isDate(p.get('from')) ? p.get('from') : null; ui.to = isDate(p.get('to')) ? p.get('to') : null;
  }
  function updateUrl() {
    const params = new URLSearchParams({ view: 'updates' });
    if (ui.month !== 'all') params.set('month', ui.month);
    if (ui.article !== 'all') params.set('article', ui.article);
    if (ui.q) params.set('q', ui.q);
    params.set('window', ui.window); params.set('grain', ui.grain);
    if (ui.from) params.set('from', ui.from);
    if (ui.to) params.set('to', ui.to);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  }
  function availability() {
    $('#upd-status').hidden = ui.phase === 'ready'; $('#upd-content').hidden = ui.phase !== 'ready';
    $('#upd-status').textContent = ({ loading: 'Загружаем данные апдейтов.', unavailable: 'Данные апдейтов пока недоступны: не удалось загрузить статьи и SEO-визиты. Анализ появится после загрузки данных источника; остальные разделы работают.', empty: 'Данные апдейтов пока недоступны: в источнике нет статей с датами обновлений и полными днями трафика. Сравнение не рассчитано.' })[ui.phase] || '';
  }
  function status(row) {
    if (!row.n && missingHistory(ui.data.meta, row.date)) return `Нет истории Метрики вокруг даты апдейта · 0/${ui.window} дней с каждой стороны · даты из таблицы сохранены`;
    const parts = [row.n ? (row.n === ui.window ? 'Полное окно' : 'Частичное окно') : 'Недостаточно дней для сравнения', `${row.n}/${ui.window} дней с каждой стороны`];
    if (!row.n) parts.push(!row.after ? 'Нет полного дня после апдейта' : 'Нет доступного дня до апдейта');
    if (row.restrictedPrevious) parts.push(`Граница: предыдущий апдейт ${formatDate(row.previous)}`);
    if (row.restrictedNext) parts.push(`Граница: следующий апдейт ${formatDate(row.next)}`);
    if (row.before < ui.window && !row.restrictedPrevious) parts.push('До: граница данных или пропуск');
    if (row.after < ui.window && !row.restrictedNext) parts.push('После: граница полных данных или пропуск');
    return parts.join(' · ');
  }
  function getScope() {
    const pages = cohort(ui.data, ui.month, ui.q);
    if (!pages.some((p) => p.id === ui.article)) { ui.article = 'all'; ui.focusEvent = null; }
    const shown = ui.article === 'all' ? pages : pages.filter((p) => p.id === ui.article);
    const rows = shown.flatMap((p) => p.updates.filter((e) => ui.month === 'all' || e.date.startsWith(ui.month)).map((e) => comparison(ui.data, p, e, ui.window)));
    return { pages, shown, rows };
  }
  function renderControls(pages) {
    const months = [...new Set(ui.data.pages.flatMap((p) => p.updates.map((e) => e.date.slice(0, 7))))].sort().reverse();
    const select = $('#upd-month'); select.innerHTML = ''; option(select, 'all', 'Все месяцы', ui.month);
    for (const month of months) option(select, month, `${monthNames[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`, ui.month);
    // Сохраняем пустую когорту из прямой ссылки вместо незаметной смены месяца.
    if (ui.month !== 'all' && !months.includes(ui.month)) option(select, ui.month, `${ui.month} · нет апдейтов`, ui.month);
    const articles = $('#upd-article'); articles.innerHTML = ''; option(articles, 'all', `Все статьи когорты (${pages.length})`, ui.article);
    for (const page of pages) option(articles, page.id, page.title === page.path ? page.path : `${page.title} · ${page.path}`, ui.article);
    $('#upd-search').value = ui.q; $('#upd-window').value = ui.window; $('#upd-granularity').value = ui.grain;
    $('#upd-search-info').textContent = `Статей в когорте: ${pages.length}. Поиск фильтрует график, список и таблицу.`;
    const dates = ui.data.completeDates, min = dates[0], max = dates[dates.length - 1];
    const defaults = focusRange(ui.data, ui.month, ui.window);
    const clamp = (value, fallback) => !value ? fallback : value < min ? min : value > max ? max : value;
    // Явные URL-даты и последующие ручные изменения сохраняем; фокус — только fallback.
    ui.from = clamp(ui.from, defaults[0]); ui.to = clamp(ui.to, defaults[1]);
    if (ui.from > ui.to) [ui.from, ui.to] = [ui.to, ui.from];
    for (const [id, value] of [['upd-date-from', ui.from], ['upd-date-to', ui.to]]) { const input = $('#' + id); input.min = min; input.max = max; input.value = value; }
  }
  function focusDate(scope) {
    if (ui.article === 'all') return null;
    const events = scope.rows.map((row) => row.date).sort();
    return events.includes(ui.focusEvent) ? ui.focusEvent : events[events.length - 1] || null;
  }
  function renderFocus(scope) {
    const event = focusDate(scope), button = $('#upd-focus-range');
    button.textContent = event ? 'До/после апдейта' : ui.month === 'all' ? 'Последние 90 дней' : 'Показать месяц апдейта';
    button.title = event ? `Показать ${formatDate(event)} и до ${ui.window} дней с каждой стороны` : ui.month === 'all' ? 'Вернуть последние 90 дней по дате среза' : `Показать ${ui.month} и до ${ui.window} дней с каждой стороны`;
    $('#upd-focus-note').textContent = event
      ? `Кнопка покажет апдейт ${formatDate(event)} и до ${ui.window} дней с каждой стороны. При нескольких апдейтах выберите строку таблицы; без выбора используем последний апдейт в текущей когорте.`
      : ui.month === 'all' ? 'По умолчанию — последние 90 дней. Когорта включает все исторические апдейты; даты трафика можно менять вручную.'
      : `При выборе месяца показываем его и до ${ui.window} дней с каждой стороны. Даты трафика можно менять вручную.`;
  }
  function renderKpis(scope, buckets) {
    const mature = scope.rows.filter((r) => r.n > 0), pre = mature.reduce((s, r) => s + r.pre, 0), post = mature.reduce((s, r) => s + r.post, 0);
    const trafficComplete = buckets.length && buckets.every((b) => b.value !== null), visits = trafficComplete ? buckets.reduce((s, b) => s + b.value, 0) : null;
    $('#upd-kpis').innerHTML = [
      kpi('Статьи в выбранной выборке', formatInt(scope.shown.length), `Когорта по апдейтам: ${ui.month === 'all' ? 'все месяцы' : escape(ui.month)}`),
      kpi('События апдейта', formatInt(scope.rows.length), `Сравнимы: ${mature.length}; полные окна: ${mature.filter((r) => r.n === ui.window).length}`),
      kpi('SEO за период графика', visits === null ? '—' : formatInt(visits), `${formatPeriod(ui.from, ui.to)} · каждая статья один раз`, true),
      kpi('Изменение в парных окнах', mature.length ? escape(delta(pre, post)) : '—', mature.length ? `Σ после к Σ до · ${mature.length} событий, включая частичные окна` : 'Нет событий с днями с обеих сторон'),
    ].join('');
  }
  function bucketLabel(b) {
    if (ui.grain === 'day') return formatDate(b.key);
    return `${ui.grain === 'week' ? 'Неделя с' : 'Месяц с'} ${formatDate(b.key)} · учтено ${formatPeriod(b.start, b.end)}`;
  }
  function renderChart(scope, buckets) {
    const container = $('#upd-chart'), events = markers(scope.shown, ui.from, ui.to, ui.grain);
    const eventText = (marker) => marker.dates.map((d) => `${formatDate(d.date)}${ui.article === 'all' ? ` — ${d.count} событий` : ''}`).join('; ');
    $('#upd-chart-title').textContent = ui.article === 'all' ? 'SEO-визиты когорты' : scope.shown[0]?.title || 'SEO-визиты статьи';
    $('#upd-chart-note').textContent = `${formatPeriod(ui.from, ui.to)} · ${granularityLabel(ui.grain)}. ${ui.article === 'all' ? 'Сумма уникальных статей; пунктир отмечает события этих статей.' : 'Пунктир: все даты апдейтов статьи из таблицы в периоде, независимо от выбранного месяца.'}${ui.grain === 'day' ? '' : ' Линия апдейта стоит на неделе или месяце, содержащем дату; сумма может включать дни до и после. Точные даты — под графиком.'}`;
    $('#upd-events-list').innerHTML = events.length ? events.map((m) => { const b = buckets.find((x) => x.key === m.key); return `<li>${escape(b ? bucketLabel(b) : formatDate(m.key))}: ${escape(eventText(m))}</li>`; }).join('') : '<li>В периоде графика нет апдейтов.</li>';
    if (!scope.shown.length || !buckets.length || buckets.every((b) => b.value === null)) {
      const noHistory = scope.shown.length && missingHistory(ui.data.meta, ui.from, ui.to);
      const first = ui.data.meta.historyAvailability?.firstAvailableDate;
      container.innerHTML = noHistory
        ? `<div class="empty">Нет истории Метрики за выбранный период.${isDate(first) ? ` История доступна с ${formatDate(first)}.` : ''} Отсутствие измерений не означает нулевой трафик статьи. Даты апдейтов из таблицы сохраняем.</div>`
        : '<div class="empty">Нет данных для выбранной когорты и периода.</div>';
      container.setAttribute('aria-label', noHistory ? 'Нет истории Метрики за выбранный период' : 'Нет данных для выбранной когорты и периода');
      return;
    }
    renderLineChart(container, buckets.map((b) => b.key), [{ name: 'SEO-визиты', className: 'line-primary', values: buckets.map((b) => b.value) }], { width: window.innerWidth < 640 ? 420 : 1200, events: events.map((m) => ({ key: m.key, label: events.length === 1 ? (m.dates.length === 1 ? formatDate(m.dates[0].date) : `${m.count} апдейтов`) : '' })) });
    // Общий renderer даёт интерактивность, здесь подписи раскрывают границы бакета и даты.
    const svg = container.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.axis-label[text-anchor="middle"]').forEach((label) => { const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = ui.grain === 'day' ? 'Дата' : ui.grain === 'week' ? 'Начало недели (понедельник)' : 'Начало календарного месяца'; label.appendChild(title); });
    const hit = svg.querySelector('.hit-area');
    hit.addEventListener('mousemove', (event) => {
      const width = window.innerWidth < 640 ? 420 : 1200, rect = svg.getBoundingClientRect();
      const x = (event.clientX - rect.left) * width / rect.width;
      const index = Math.max(0, Math.min(buckets.length - 1, Math.round((x - 76) * (buckets.length - 1) / (width - 104))));
      const b = buckets[index], marker = events.find((m) => m.key === b.key);
      $('#tooltip').innerHTML = `<strong>${escape(bucketLabel(b))}</strong><br>SEO-визиты: ${number(b.value)}${marker ? `<br>Апдейты: ${escape(eventText(marker))}` : ''}`;
    });
    container.setAttribute('aria-label', `SEO-визиты ${ui.article === 'all' ? 'когорты' : 'статьи'} за ${formatPeriod(ui.from, ui.to)}, ${granularityLabel(ui.grain)}. Даты апдейтов приведены в списке под графиком.`);
  }
  function renderTable(rows) {
    const value = (r) => ({ title: r.page.title, date: r.date, pre: r.pre, post: r.post, n: r.n, avg: r.avgPost, delta: r.delta, status: status(r) })[ui.sort];
    rows.sort((a, b) => { const va = value(a), vb = value(b); if (va === null) return vb === null ? 0 : 1; if (vb === null) return -1; return (typeof va === 'string' ? va.localeCompare(vb, 'ru') : va - vb) * ui.direction || a.page.id.localeCompare(b.page.id); });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); ui.page = Math.max(0, Math.min(ui.page, pages - 1));
    const slice = rows.slice(ui.page * PAGE_SIZE, (ui.page + 1) * PAGE_SIZE);
    $('#upd-table-body').innerHTML = slice.length ? slice.map((r) => {
      const url = safeUrl(r.page.url), ranges = r.n ? `${formatPeriod(r.preFrom, r.preTo)} / ${formatPeriod(r.postFrom, r.postTo)}` : 'Нет парного окна';
      return `<tr data-article="${escape(r.page.id)}" data-update-date="${r.date}"><td><button class="link-button upd-show-article" data-article="${escape(r.page.id)}" type="button">${escape(r.page.title)}</button><span class="updates-cell-note">${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(r.page.title === r.page.path ? 'Открыть статью' : r.page.path)}</a>` : escape(r.page.path)}</span></td><td>${formatDate(r.date)}${r.sourceRows?.length ? `<span class="updates-cell-note">Строки источника: ${escape(r.sourceRows.join(', '))}</span>` : ''}</td><td>${number(r.pre)}</td><td>${number(r.post)}</td><td>${r.n} / ${ui.window}<span class="updates-cell-note">${escape(ranges)}</span></td><td>${number(r.avgPre)} → ${number(r.avgPost)}</td><td>${escape(delta(r.pre, r.post))}</td><td>${escape(status(r))}</td></tr>`;
    }).join('') : '<tr><td colspan="8">В выбранной когорте нет событий апдейта.</td></tr>';
    $('#upd-page-info').textContent = `Стр. ${ui.page + 1} из ${pages} · событий: ${rows.length}`;
    $('#upd-page-prev').disabled = ui.page === 0; $('#upd-page-next').disabled = ui.page === pages - 1;
    $('#upd-table-note').textContent = `События: ${ui.month === 'all' ? 'все месяцы' : ui.month}${ui.article === 'all' ? ' · все статьи когорты' : ' · выбранная статья'}. SEO до и после — суммы за равные n дней; среднее — сумма / n. Окно до ${ui.window} дней с каждой стороны не зависит от периода трафика. Клик по строке открывает график статьи.`;
    document.querySelectorAll('#upd-table-head .th-sort').forEach((button) => {
      button.classList.toggle('sorted-asc', button.dataset.sort === ui.sort && ui.direction === 1); button.classList.toggle('sorted-desc', button.dataset.sort === ui.sort && ui.direction === -1);
      button.closest('th').setAttribute('aria-sort', button.dataset.sort === ui.sort ? (ui.direction === 1 ? 'ascending' : 'descending') : 'none');
    });
  }
  function sourceFetchedLabel(value) {
    const date = typeof value === 'string' ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')} (Москва)`;
  }
  function sourceSummary(meta) {
    const stats = meta.sourceStats || {};
    const count = (value) => Number.isInteger(value) && value >= 0 ? formatInt(value) : 'не указано';
    const pieces = [`Статей с датой: ${count(stats.pageCount)}. Исходных строк: ${count(stats.inputRows)}; из них с датой: ${count(stats.datedRows)}. Событий в списке: ${count(stats.eventCount)}.`];
    if (Number.isInteger(stats.inputRows) && Number.isInteger(stats.datedRows) && stats.inputRows >= stats.datedRows) pieces.push(`Строк без даты, не вошедших в анализ: ${formatInt(stats.inputRows - stats.datedRows)}.`);
    if (isDate(stats.datesMin) && isDate(stats.datesMax)) pieces.push(`Даты апдейтов из таблицы: ${formatPeriod(stats.datesMin, stats.datesMax)}.`);
    if (Number.isInteger(stats.futureEvents) && stats.futureEvents > 0) pieces.push(`Событий позже среза трафика: ${formatInt(stats.futureEvents)}; в анализ их не включаем.`);
    return pieces.join(' ');
  }
  function sourceTiming(meta) {
    const fetched = sourceFetchedLabel(meta.sourceFetchedAt);
    const list = meta.sourceCacheUsed === true
      ? `Источник временно недоступен, список статей из сохранённой копии${fetched ? ` от ${fetched}` : '; дата копии не указана'}.`
      : `Список статей получен из источника${fetched ? ` ${fetched}` : '; дата получения не указана'}.`;
    return `${list} Срез SEO-трафика (последний полный день): ${formatDate(meta.asOf)}. Дата получения списка и срез трафика — разные даты.`;
  }
  function dateDefinition(meta) {
    return meta.dateDefinition || 'Дата апдейта из таблицы пользователя. Дату публикации или фактическое время обновления страницы по другим источникам не проверяем.';
  }
  function historyWarning(meta) {
    const history = meta.historyAvailability;
    if (!history) return '';
    const pieces = [];
    if (isDate(history.firstAvailableDate)) pieces.push(`История Метрики доступна с ${formatDate(history.firstAvailableDate)}${isDate(history.lastAvailableDate) ? ` по ${formatDate(history.lastAvailableDate)}` : ''}.`);
    const ranges = unavailableHistoryRanges(meta);
    if (ranges.length) pieces.push(`Без измерений: ${ranges.map((range) => `${formatPeriod(range.from, range.through)}${range.reason ? ` (${range.reason})` : ''}`).join('; ')}.`);
    if (history.definition) pieces.push(String(history.definition));
    pieces.push('Отсутствие истории счётчика не означает нулевой трафик статьи. Даты апдейтов из таблицы сохраняем, в том числе даты до начала доступной истории. При отсутствии измерений сравнение не рассчитываем и показываем прочерк.');
    return pieces.join(' ');
  }
  function renderSource() {
    const meta = ui.data.meta, url = safeUrl(meta.sourceUrl);
    $('#upd-source-summary').innerHTML = `${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Google Sheets</a>` : 'Google Sheets'}. ${escape(sourceSummary(meta))}`;
    $('#upd-source-time').textContent = sourceTiming(meta);
    $('#upd-date-definition').textContent = dateDefinition(meta);
    const warning = historyWarning(meta);
    $('#upd-history-warning').hidden = !warning;
    $('#upd-history-warning').textContent = warning;
    const excluded = Array.isArray(meta.sourceStats?.excludedRows) ? meta.sourceStats.excludedRows : [];
    $('#upd-excluded').hidden = excluded.length === 0;
    $('#upd-excluded-summary').textContent = `Строки, не вошедшие в анализ: ${excluded.length}`;
    $('#upd-excluded-list').innerHTML = excluded.map((row) => {
      const href = safeUrl(row.url);
      return `<li>Строка ${escape(row.row ?? 'не указана')}: ${href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(row.url)}</a>` : escape(row.url || 'URL не указан')} — ${escape(row.reason || 'Причина не указана')}</li>`;
    }).join('');
  }
  function renderMethod() {
    const m = ui.data.meta, url = safeUrl(m.sourceUrl);
    $('#upd-method').innerHTML = [
      escape(dateDefinition(m)),
      escape(sourceSummary(m)),
      escape(sourceTiming(m)),
      ...(historyWarning(m) ? [escape(historyWarning(m))] : []),
      `Источник дат апдейтов — ${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Google Sheets</a>` : 'Google Sheets'}. Трафик — Яндекс Метрика, счётчик ${escape(m.counterId ?? '—')}; ${escape(m.metric || 'SEO-визиты')}; атрибуция ${escape(m.attribution || 'не указана')}; часовой пояс ${escape(m.timezone || 'Europe/Moscow')}. Семплирование: ${m.sampled === true ? 'есть' : m.sampled === false ? 'нет' : 'не указано'}. Срез: ${formatDate(m.asOf)}. Последний учтённый полный день трафика: ${formatDate(ui.data.completeDates[ui.data.completeDates.length - 1])}.`,
      'Когорта включает статьи с апдейтом в выбранном месяце. Повторные строки одной статьи за одну дату объединены. На графике трафик каждой статьи учитываем один раз, даже если у неё несколько апдейтов. Учитываем точный канонический URL, вариант с завершающим слешем и параметрами; дочерние статьи не включаем.',
      `Сравниваем до ${ui.window} дней до события с тем же числом дней после него. День апдейта исключаем. n — минимум выбранного окна, непрерывных доступных дней до и после, расстояния до соседних апдейтов без их дат. Дни соседних апдейтов и дни за ними не включаем. Показываем n/${ui.window}; пропуски не заменяем нулями. Дата среза — последний полный день источника, её включаем в трафик. События и трафик позже среза исключаем; текущий московский день и будущие дни не включаем.`,
      'При n = 0 показываем прочерк. Если до было 0 визитов, процент не рассчитываем; положительный трафик после отмечаем как «Рост с нуля». Частичные окна могут иметь разный состав дней недели.',
      'KPI изменения — (сумма после / сумма до − 1) по событиям с n > 0, в том числе частичным. Это взвешенное по исходным визитам сравнение парных сумм, а не среднее процентов. События одной статьи могут повторно учитывать дни в этом KPI; он описывает события и не равен изменению трафика уникальной когорты.',
      'Изменение трафика не доказывает эффект обновления статьи. Учитывайте сезонность, состав дней недели, изменения поисковых алгоритмов и другие работы на сайте. Последние полные дни Метрика может уточнять.',
    ].map((text) => `<li>${text}</li>`).join('');
  }
  function renderAll() {
    availability(); if (ui.phase !== 'ready') return;
    const scope = getScope(); renderControls(scope.pages);
    const buckets = traffic(ui.data, scope.shown, ui.from, ui.to, ui.grain);
    renderSource(); renderFocus(scope); renderKpis(scope, buckets); renderChart(scope, buckets); renderTable(scope.rows); renderMethod();
  }
  function bind() {
    const change = (id, key, convert = (v) => v) => $(id).addEventListener('change', (event) => {
      ui[key] = convert(event.target.value); ui.page = 0;
      if (key === 'article' || key === 'month') ui.focusEvent = null;
      if (key === 'month' && ui.data) [ui.from, ui.to] = focusRange(ui.data, ui.month, ui.window);
      if (key === 'from' && ui.from > ui.to) ui.to = ui.from;
      if (key === 'to' && ui.to < ui.from) ui.from = ui.to;
      renderAll(); updateUrl();
    });
    change('#upd-month', 'month'); change('#upd-article', 'article'); change('#upd-window', 'window', Number); change('#upd-granularity', 'grain'); change('#upd-date-from', 'from'); change('#upd-date-to', 'to');
    $('#upd-focus-range').addEventListener('click', () => {
      if (ui.phase !== 'ready') return;
      const scope = getScope();
      [ui.from, ui.to] = focusRange(ui.data, ui.month, ui.window, focusDate(scope));
      renderAll(); updateUrl();
    });
    $('#upd-search').addEventListener('input', (event) => { ui.q = event.target.value; ui.page = 0; renderAll(); updateUrl(); });
    $('#upd-table-body').addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const row = event.target.closest('[data-article]'); if (!row) return;
      ui.article = row.dataset.article; ui.focusEvent = row.closest('tr').dataset.updateDate; ui.page = 0;
      [ui.from, ui.to] = focusRange(ui.data, ui.month, ui.window, ui.focusEvent);
      renderAll(); updateUrl(); $('#upd-chart-card').scrollIntoView({ block: 'start' });
    });
    document.querySelectorAll('#upd-table-head .th-sort').forEach((button) => button.addEventListener('click', () => { ui.direction = ui.sort === button.dataset.sort ? -ui.direction : ['title', 'date', 'status'].includes(button.dataset.sort) ? 1 : -1; ui.sort = button.dataset.sort; ui.page = 0; renderTable(getScope().rows); }));
    $('#upd-page-prev').addEventListener('click', () => { ui.page--; renderTable(getScope().rows); }); $('#upd-page-next').addEventListener('click', () => { ui.page++; renderTable(getScope().rows); });
    window.addEventListener('resize', () => { if (active()) renderAll(); });
  }
  async function init() {
    if (!ui.initialized) { loadState(); bind(); ui.initialized = true; }
    if (ui.pending) return ui.pending;
    ui.phase = 'loading'; if (active()) availability();
    ui.pending = (async () => {
      try {
        const raw = await window.loadJSON('updates.json');
        if (raw?.meta?.sourceAvailable === false && raw?.meta?.sourceCacheUsed !== true) throw new Error('SOURCE_UNAVAILABLE');
        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        ui.data = normalize(raw, today);
        ui.phase = ui.data.completeDates.length && ui.data.pages.some((p) => p.updates.length) ? 'ready' : 'empty';
      } catch (_) { ui.data = null; ui.phase = 'unavailable'; }
      finally { ui.pending = null; if (active()) { renderAll(); updateUrl(); } }
    })();
    return ui.pending;
  }
  window.initUpdates = init; window.ensureUpdates = () => ui.data ? renderAll() : init();
  window.renderUpdates = renderAll; window.updateUpdatesUrl = updateUrl;
})();
