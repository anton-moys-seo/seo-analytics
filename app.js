const state = {
  data: null, view: 'leads',
  leadId: 'core', leadGranularity: 'day', leadFrom: null, leadTo: null, leadPage: 'all',
  direction: null, directionGranularity: 'day', directionFrom: null, directionTo: null,
  mediaId: 'skillbox-media', mediaSection: 'Все /media/', mediaGranularity: 'day', mediaFrom: null, mediaTo: null,
  blog: undefined, // undefined — ещё не запрашивался; null — недоступен; object — blog.json
  yoy: undefined, // undefined — ещё не запрашивался; null — недоступен; object — yoy.json
};
const $ = (selector) => document.querySelector(selector);
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const intf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const pctf = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 });
const pctf2 = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 });
const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

// --- Защищённая загрузка данных: AES-256-GCM, ключ живёт только в #фрагменте ссылки. ---
const SITE_KEY_TEXT = location.hash.replace(/^#/, '').trim() || null;

function showLockScreen(message) {
  document.querySelector('main').innerHTML = `<div class="empty">${message}</div>`;
  document.title = 'Отчёт: требуется ключ доступа';
}

function b64urlBytes(text) {
  const pad = '='.repeat((4 - text.length % 4) % 4);
  const binary = atob((text + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

window.loadJSON = async function loadJSON(name) {
  if (!SITE_KEY_TEXT) {
    showLockScreen('Отчёт зашифрован. Откройте ссылку с ключом доступа (часть после символа «#»).');
    throw new Error('NO_KEY');
  }
  const response = await fetch(name + '.enc', { cache: 'no-store' });
  if (response.status === 404) {
    // Локальная разработка без шифрования.
    const plain = await fetch(name, { cache: 'no-store' });
    if (!plain.ok) throw new Error(String(plain.status));
    return plain.json();
  }
  if (!response.ok) throw new Error(String(response.status));
  const payload = await response.text();
  try {
    const raw = b64urlBytes(payload);
    const key = await crypto.subtle.importKey('raw', b64urlBytes(SITE_KEY_TEXT), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (error) {
    showLockScreen('Не удалось расшифровать отчёт: ключ неверен или данные повреждены.');
    throw new Error('BAD_KEY');
  }
};

function formatNumber(value, fallback = '—') {
  return value === null || value === undefined || Number.isNaN(value) ? fallback : nf.format(value);
}
function formatInt(value) { return intf.format(Math.round(value || 0)); }
function formatCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${nf.format(value / 1_000_000)} млн`;
  if (abs >= 1_000) return `${nf.format(value / 1_000)} тыс.`;
  return formatInt(value);
}
function formatDate(iso) {
  const [y,m,d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function sum(values) { return values.reduce((acc, value) => acc + (Number(value) || 0), 0); }
function sumNullable(values) {
  const valid = values.filter((value) => value !== null && value !== undefined);
  return valid.length ? sum(valid) : null;
}
function rangeIndexes(dates, start, end) {
  return dates.map((day, index) => ({ day, index })).filter((item) => item.day >= start && item.day <= end).map((item) => item.index);
}
function formatPeriod(start, end) { return `${formatDate(start)}–${formatDate(end)}`; }
function granularityLabel(value) { return ({ day: 'по дням', week: 'по неделям', month: 'по месяцам' })[value]; }
function groupDate(iso, granularity) {
  if (granularity === 'day') return iso;
  if (granularity === 'month') return `${iso.slice(0, 7)}-01`;
  const dt = new Date(`${iso}T00:00:00Z`);
  const shift = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - shift);
  return dt.toISOString().slice(0, 10);
}
function aggregateRange(dates, series, start, end, granularity) {
  const groups = new Map();
  rangeIndexes(dates, start, end).forEach((index) => {
    const key = groupDate(dates[index], granularity);
    if (!groups.has(key)) groups.set(key, series.map(() => []));
    series.forEach((item, seriesIndex) => groups.get(key)[seriesIndex].push(item.values[index]));
  });
  const groupedDates = [...groups.keys()];
  const groupedSeries = series.map((item, seriesIndex) => ({
    ...item,
    values: groupedDates.map((key) => sumNullable(groups.get(key)[seriesIndex])),
  }));
  return { dates: groupedDates, series: groupedSeries };
}
function setDateInputs(prefix, dates, from, to) {
  const fromInput = $(`#${prefix}-date-from`), toInput = $(`#${prefix}-date-to`);
  [fromInput, toInput].forEach((input) => { input.min = dates[0]; input.max = dates[dates.length - 1]; });
  fromInput.value = from; toInput.value = to;
}
function normalizedPeriod(dates, from, to) {
  const min = dates[0], max = dates[dates.length - 1];
  const safeFrom = from && dates.includes(from) ? from : min;
  const safeTo = to && dates.includes(to) ? to : max;
  return safeFrom <= safeTo ? [safeFrom, safeTo] : [safeTo, safeFrom];
}
function kpi(label, value, caption = '', primary = false) {
  return `<div class="kpi-card${primary ? ' primary' : ''}"><span class="kpi-label">${label}</span><div><div class="kpi-value">${value}</div>${caption ? `<div class="kpi-caption">${caption}</div>` : ''}</div></div>`;
}

function niceScale(maxValue) {
  if (!maxValue || maxValue <= 0) return { max: 1, step: 0.2 };
  const rough = maxValue / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = nice * magnitude;
  return { max: Math.ceil(maxValue / step) * step, step };
}

function renderLineChart(container, dates, series, options = {}) {
  if (!container || !dates.length) return;
  const width = options.width || 1200, height = 430;
  const margin = { top: 24, right: 28, bottom: 54, left: 76 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const allValues = series.flatMap((item) => item.values.filter((value) => value !== null && value !== undefined));
  if (!allValues.length) {
    container.innerHTML = '<div class="empty">Нет данных для выбранного среза.</div>';
    return;
  }
  const scale = niceScale(Math.max(...allValues));
  const x = (index) => margin.left + (dates.length === 1 ? innerW / 2 : index * innerW / (dates.length - 1));
  const y = (value) => margin.top + innerH - (value / scale.max) * innerH;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

  let svg = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
  for (let tick = 0; tick <= Math.round(scale.max / scale.step); tick++) {
    const value = scale.step * tick;
    const yy = y(value);
    svg += `<line class="grid-line" x1="${margin.left}" y1="${yy}" x2="${width-margin.right}" y2="${yy}"></line>`;
    svg += `<text class="axis-label" x="${margin.left-12}" y="${yy+4}" text-anchor="end">${esc(formatCompact(value))}</text>`;
  }
  svg += `<line class="axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top+innerH}"></line>`;
  svg += `<line class="axis-line" x1="${margin.left}" y1="${margin.top+innerH}" x2="${width-margin.right}" y2="${margin.top+innerH}"></line>`;

  const desiredTicks = window.innerWidth < 700 ? 5 : 9;
  const tickStep = Math.max(1, Math.ceil((dates.length - 1) / (desiredTicks - 1)));
  const tickIndexes = [];
  for (let i = 0; i < dates.length; i += tickStep) tickIndexes.push(i);
  if (tickIndexes[tickIndexes.length - 1] !== dates.length - 1) {
    if (tickIndexes.length > 1 && dates.length - 1 - tickIndexes[tickIndexes.length - 1] < tickStep * 0.65) tickIndexes.pop();
    tickIndexes.push(dates.length - 1);
  }
  tickIndexes.forEach((index) => {
    const xx = x(index);
    svg += `<line class="axis-line" x1="${xx}" y1="${margin.top+innerH}" x2="${xx}" y2="${margin.top+innerH+6}"></line>`;
    svg += `<text class="axis-label" x="${xx}" y="${height-20}" text-anchor="middle">${esc(formatDate(dates[index]).slice(0,5))}</text>`;
  });

  series.forEach((item) => {
    let path = '', drawing = false;
    item.values.forEach((value, index) => {
      if (value === null || value === undefined) { drawing = false; return; }
      const command = drawing ? 'L' : 'M';
      path += `${command}${x(index).toFixed(2)},${y(value).toFixed(2)} `;
      drawing = true;
    });
    svg += `<path class="${item.className}" d="${path.trim()}"></path>`;
    if (dates.length === 1 && item.values[0] !== null && item.values[0] !== undefined) {
      const pointClass = item.className.includes('primary') ? 'point-primary' : 'point-black';
      svg += `<circle class="${pointClass}" r="5" cx="${x(0)}" cy="${y(item.values[0])}"></circle>`;
    }
  });

  (options.events || []).forEach((event) => {
    const eventIndex = dates.indexOf(event.key);
    if (eventIndex < 0) return;
    const cx = x(eventIndex);
    svg += `<line class="exp-event-line ${event.className || ''}" x1="${cx}" y1="${margin.top}" x2="${cx}" y2="${margin.top + innerH}"></line>`;
    const lx = Math.max(margin.left + 44, Math.min(cx, width - margin.right - 44));
    svg += `<text class="exp-event-label ${event.className || ''}" x="${lx}" y="${margin.top - 10}" text-anchor="middle">${esc(event.label)}</text>`;
  });

  svg += `<line class="hover-line" id="${container.id}-hover" x1="0" y1="${margin.top}" x2="0" y2="${margin.top+innerH}" visibility="hidden"></line>`;
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

function populateSelect(select, options, selected, valueKey = 'id', labelKey = 'name') {
  select.innerHTML = '';
  options.forEach((item) => {
    const option = document.createElement('option');
    option.value = typeof item === 'string' ? item : item[valueKey];
    option.textContent = typeof item === 'string' ? item : item[labelKey];
    option.selected = option.value === selected;
    select.appendChild(option);
  });
}

function executionCell(execution) {
  if (execution === null || execution === undefined) return '—';
  const tier = execution >= 1 ? 'good' : execution >= 0.9 ? 'mid' : 'low';
  return `<span class="exec-badge exec-${tier}">${pctf.format(execution)}</span>`;
}

// Прогноз лидов на конец месяца: факт полных дней месяца + среднее за последние
// 7 полных дней × остаток месяца (включая сегодняшний день как прогнозный).
function forecastMonth(series, dates) {
  const asOf = state.data.meta.asOf;
  const month = asOf.slice(0, 7);
  const monthEnd = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const complete = dates.filter((d) => d.startsWith(month) && d < asOf);
  if (complete.length < 3) return null;
  const window = complete.slice(-7);
  const values = window.map((d) => series[dates.indexOf(d)]);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values), max = Math.max(...values);
  const factComplete = complete.reduce((s, d) => s + series[dates.indexOf(d)], 0);
  const remaining = monthEnd - (+asOf.slice(8, 10)) + 1;
  return {
    forecast: factComplete + avg * remaining,
    low: factComplete + min * remaining,
    high: factComplete + max * remaining,
    avg, remaining, windowDays: window.length,
  };
}

function forecastCell(series, dates, monthPlan) {
  const forecast = forecastMonth(series, dates);
  if (!forecast) return '<td>—</td>';
  const planPart = monthPlan ? ` · к плану ${formatInt(monthPlan)}: ${pctf.format(forecast.forecast / monthPlan)}` : '';
  return `<td title="Диапазон по мин/макс последних ${forecast.windowDays} полных дней: ${formatInt(forecast.low)}–${formatInt(forecast.high)}\nМетод: факт полных дней месяца + среднее ${formatNumber(forecast.avg)}/день × ${forecast.remaining} дн. остатка">≈ ${formatInt(Math.round(forecast.forecast))}${planPart ? `<span class="forecast-plan">${planPart}</span>` : ''}</td>`;
}

// YoY: факт периода к тем же календарным датам прошлого года.
// Индексы yoy.json выровнены с датами текущего периода (тот же месяц/день минус год).
function yoyCell(currentFact, prevSeries, periodFrom, periodTo) {
  if (!state.yoy || !prevSeries) return '<td title="Данные прошлого года недоступны">—</td>';
  const dates = state.data.leads.entities[0].dates;
  const idx = rangeIndexes(dates, periodFrom, periodTo);
  const prev = sum(idx.map((i) => (prevSeries[i] !== undefined ? prevSeries[i] : 0)));
  const prevPeriod = `${shiftYear(periodFrom)}–${shiftYear(periodTo)}`;
  if (prev < 10) return `<td title="${prevPeriod}: ${formatInt(prev)} лидов — база прошлого года мала, сравнение не показываем">—</td>`;
  const delta = currentFact - prev;
  const arrow = delta >= 0 ? '+' : '−';
  return `<td title="${prevPeriod}: ${formatInt(prev)} лидов · ${arrow}${formatInt(Math.abs(delta))} к прошлому году">${pctf.format(currentFact / prev)}</td>`;
}

function shiftYear(iso) {
  return `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;
}

function renderLeadSummary() {
  const body = $('#lead-summary');
  const summaryEnd = state.data.meta.asOf;
  const summaryStart = `${summaryEnd.slice(0, 7)}-01`;
  $('#lead-summary-title').textContent = `Сводка за ${formatPeriod(summaryStart, summaryEnd)}`;
  const spoMonth = state.data.leads.entities.find(e => e.id === 'spo')?.monthlyPlans?.[summaryEnd.slice(0, 7)];
  $('#lead-summary-note').textContent = 'Только SEO-канал. План — за указанные дни. Прогноз — оценка по среднему последних 7 полных дней, не обязательство.' + (spoMonth ? ` СПО: только ГВ; план на полный месяц — ${formatNumber(spoMonth.total)} лидов.` : '');
  body.innerHTML = '';
  state.data.leads.entities.forEach((entity) => {
    const idx = rangeIndexes(entity.dates, summaryStart, summaryEnd);
    const plan = sumNullable(idx.map((i) => entity.plan[i]));
    const fact = sum(idx.map((i) => entity.fact[i]));
    const deviation = plan === null ? null : fact - plan;
    const execution = plan ? fact / plan : null;
    const row = document.createElement('tr');
    [entity.name, formatNumber(plan), formatInt(fact), formatNumber(deviation)].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    });
    const execCell = document.createElement('td'); execCell.innerHTML = executionCell(execution); row.appendChild(execCell);
    const fcCell = document.createElement('td');
    fcCell.innerHTML = forecastCell(entity.fact, entity.dates, entity.id === 'spo' && spoMonth ? spoMonth.total : null);
    row.appendChild(fcCell);
    const yoyCellNode = document.createElement('td');
    yoyCellNode.innerHTML = yoyCell(fact, state.yoy && state.yoy.entities ? state.yoy.entities[entity.id] : null, summaryStart, summaryEnd);
    row.appendChild(yoyCellNode);
    body.appendChild(row);
  });
}

function leadPageGroup(entity) {
  return entity.pageGroups ? entity.pageGroups.find((g) => g.id === state.leadPage) || null : null;
}

function populateLeadPageSelect(entity) {
  const control = $('#lead-page-control'), select = $('#lead-page');
  control.hidden = !entity.pageGroups;
  if (!entity.pageGroups) return;
  if (!entity.pageGroups.some((g) => g.id === state.leadPage)) state.leadPage = 'all';
  select.innerHTML = '';
  [{ id: 'all', name: 'Все страницы' }, ...entity.pageGroups].forEach((group) => {
    const option = document.createElement('option');
    option.value = group.id; option.textContent = group.name;
    option.selected = group.id === state.leadPage;
    select.appendChild(option);
  });
}

function renderLead() {
  const entity = state.data.leads.entities.find((item) => item.id === state.leadId);
  const group = leadPageGroup(entity);
  populateLeadPageSelect(entity);
  [state.leadFrom, state.leadTo] = normalizedPeriod(entity.dates, state.leadFrom, state.leadTo);
  setDateInputs('lead', entity.dates, state.leadFrom, state.leadTo);
  $('#lead-granularity').value = state.leadGranularity;
  const idx = rangeIndexes(entity.dates, state.leadFrom, state.leadTo);
  const plan = sumNullable(idx.map((i) => entity.plan[i]));
  const fact = sum(idx.map((i) => entity.fact[i]));
  const groupFact = group ? sum(idx.map((i) => group.fact[i])) : null;
  const shownFact = group ? groupFact : fact;
  const deviation = plan === null ? null : shownFact - plan;
  const execution = plan ? shownFact / plan : null;
  const share = group && fact ? groupFact / fact : null;
  const period = formatPeriod(state.leadFrom, state.leadTo);
  $('#lead-kpis').innerHTML = group ? [
    kpi(`Факт за период: ${group.name}`, formatInt(groupFact), period, true),
    kpi('Доля от проекта', share === null ? '—' : pctf.format(share), 'Факт группы к факту всего проекта'),
    kpi('План проекта за период', formatNumber(plan), plan === null ? 'План в модели не заполнен' : `${period} · страница плана не разделяет`),
    kpi('Выполнение к плану проекта', execution === null ? '—' : pctf.format(execution), 'Факт группы к плану всего проекта'),
  ].join('') : [
    kpi('Факт за период', formatInt(fact), period, true),
    kpi('План за период', formatNumber(plan), plan === null ? 'План в модели не заполнен' : period),
    kpi('Отклонение', formatNumber(deviation), plan === null ? 'Недоступно без плана' : 'Факт минус план'),
    kpi('Выполнение', execution === null ? '—' : pctf.format(execution), plan === null ? 'Недоступно без плана' : 'Факт к плану'),
  ].join('');
  $('#lead-chart-title').textContent = `${entity.name}: ${group ? 'факт по страницам' : 'план и факт лидов'}`;
  $('#lead-chart-note').textContent = `${entity.scope} · ${period} · ${granularityLabel(state.leadGranularity)}${group ? ` · страницы: ${group.name} · план по страницам не детализирован и не показывается` : ''}`;
  const auditBox = $('#lead-audit');
  auditBox.hidden = !entity.audit;
  auditBox.closest('.chart-card').classList.toggle('audited-leads', Boolean(entity.audit));
  $('#lead-month-kpis').innerHTML = '';
  $('#lead-audit-note').textContent = '';
  if (entity.audit) {
    const month = state.leadTo.slice(0, 7), monthPlan = entity.monthlyPlans?.[month];
    const monthIndexes = entity.dates.map((day, i) => day.startsWith(month) ? i : -1).filter(i => i >= 0);
    const monthFact = sum(monthIndexes.map(i => entity.fact[i]));
    const monthEnd = monthIndexes.length ? entity.dates[monthIndexes[monthIndexes.length - 1]] : state.leadTo;
    if (monthPlan) {
      $('#lead-month-kpis').innerHTML = [
        `<span class="mini-kpi">План на полный месяц ${month.slice(5)}.${month.slice(0,4)} <b>${formatNumber(monthPlan.total)}</b></span>`,
        `<span class="mini-kpi">ГВ ${formatPeriod(`${month}-01`, monthEnd)} <b>${formatInt(monthFact)}</b></span>`,
        `<span class="mini-kpi">Выполнение месячного плана <b>${monthPlan.total ? pctf.format(monthFact / monthPlan.total) : '—'}</b></span>`,
      ].join('');
    }
    $('#lead-audit-note').textContent = entity.audit.factDefinition + (monthPlan?.overridden
      ? ` План на полный месяц ${month.slice(5)}.${month.slice(0,4)}: ${formatNumber(monthPlan.total)} по указанию пользователя; в исходной мере Power BI — ${formatNumber(monthPlan.sourceTotal)}. Дневные веса источника сохранены; основной график и верхние KPI показывают план только за выбранные дни.`
      : ' Дневной план — из Power BI; план за период и полный месячный план показаны отдельно.');
  }
  // План не детализирован по страницам: при выборе группы страниц показываем только факт,
  // и вертикальная шкала масштабируется под значения группы, а не под план проекта.
  const chart = aggregateRange(entity.dates, group ? [
    { name: `Факт: ${group.name}`, values: group.fact, className: 'line-primary' },
  ] : [
    { name: 'План', values: entity.plan, className: 'line-black' },
    { name: 'Факт', values: entity.fact, className: 'line-primary' },
  ], state.leadFrom, state.leadTo, state.leadGranularity);
  const legendPlan = $('#lead-legend-plan');
  if (legendPlan) legendPlan.hidden = Boolean(group);
  renderLineChart($('#lead-chart'), chart.dates, chart.series, { width: entity.audit && window.innerWidth < 640 ? 360 : 1200 });
  if (blogGroupOf(entity) && state.blog === undefined) {
    ensureBlogData().then(() => { if (state.leadId === entity.id && state.view === 'leads') renderLeadBlog(entity); });
  }
  renderLeadBlog(entity);
}

function blogGroupOf(entity) {
  return entity.pageGroups ? entity.pageGroups.find((g) => g.id === 'blog') || null : null;
}

async function ensureBlogData() {
  if (state.blog !== undefined) return state.blog;
  try {
    state.blog = await loadJSON('blog.json');
  } catch (error) {
    state.blog = null;
  }
  return state.blog;
}

function renderLeadBlog(entity) {
  const card = $('#lead-blog-card');
  const site = state.blog && state.blog.sites ? state.blog.sites[entity.id] : null;
  const blogGroup = blogGroupOf(entity);
  if (!blogGroup || !site || !state.blog) { card.hidden = true; return; }
  if (state.blog.dates.length !== entity.dates.length) { card.hidden = true; return; }
  card.hidden = false;
  const idx = rangeIndexes(entity.dates, state.leadFrom, state.leadTo);
  const visits = sum(idx.map((i) => site.visits[i]));
  const blogLeads = sum(idx.map((i) => blogGroup.fact[i]));
  const projectLeads = sum(idx.map((i) => entity.fact[i]));
  $('#lead-blog-title').textContent = `Блог ${site.name}: трафик и лиды`;
  $('#lead-blog-kpis').innerHTML = [
    `<span class="mini-kpi">Визиты блога <b>${formatInt(visits)}</b></span>`,
    `<span class="mini-kpi">Лиды блога <b>${formatInt(blogLeads)}</b></span>`,
    `<span class="mini-kpi">Доля лидов проекта <b>${projectLeads ? pctf.format(blogLeads / projectLeads) : '—'}</b></span>`,
    `<span class="mini-kpi">CR1 блога (лиды к визитам) <b>${visits ? pctf2.format(blogLeads / visits) : '—'}</b></span>`,
  ].join('');
  $('#lead-blog-note').textContent = `${site.domain}${site.path} · все источники · Метрика ${site.counterId} · ${formatPeriod(state.leadFrom, state.leadTo)} · ${granularityLabel(state.leadGranularity)} · лиды блога — фильтр «Страницы: ${blogGroup.name}»`;
  const chart = aggregateRange(entity.dates, [
    { name: 'Визиты блога', values: site.visits, className: 'line-primary' },
  ], state.leadFrom, state.leadTo, state.leadGranularity);
  renderLineChart($('#lead-blog-chart'), chart.dates, chart.series, { width: window.innerWidth < 640 ? 360 : 1200 });
}

function renderDirection() {
  const direction = state.data.leads.coreDirections.find((item) => item.name === state.direction);
  const dates = state.data.leads.entities[0].dates;
  [state.directionFrom, state.directionTo] = normalizedPeriod(dates, state.directionFrom, state.directionTo);
  setDateInputs('direction', dates, state.directionFrom, state.directionTo);
  $('#direction-granularity').value = state.directionGranularity;
  const idx = rangeIndexes(dates, state.directionFrom, state.directionTo);
  const plan = sumNullable(idx.map((i) => direction.plan[i]));
  const fact = sum(idx.map((i) => direction.fact[i]));
  const deviation = plan === null ? null : fact - plan;
  const execution = plan ? fact / plan : null;
  const period = formatPeriod(state.directionFrom, state.directionTo);
  $('#direction-kpis').innerHTML = [
    `<span class="mini-kpi">Факт <b>${formatInt(fact)}</b></span>`,
    `<span class="mini-kpi">План <b>${formatNumber(plan)}</b></span>`,
    `<span class="mini-kpi">Отклонение <b>${formatNumber(deviation)}</b></span>`,
    `<span class="mini-kpi">Выполнение <b>${execution === null ? '—' : pctf.format(execution)}</b></span>`,
  ].join('');
  $('#direction-chart-note').textContent = `${direction.name} · ${period} · ${granularityLabel(state.directionGranularity)}`;
  const chart = aggregateRange(dates, [
    { name: 'План', values: direction.plan, className: 'line-black' },
    { name: 'Факт', values: direction.fact, className: 'line-primary' },
  ], state.directionFrom, state.directionTo, state.directionGranularity);
  renderLineChart($('#direction-chart'), chart.dates, chart.series, { width: window.innerWidth < 640 ? 360 : 1200 });
  renderDirectionSummary();
}

function renderDirectionSummary() {
  const body = $('#direction-summary');
  const dates = state.data.leads.entities[0].dates;
  const idx = rangeIndexes(dates, state.directionFrom, state.directionTo);
  const period = formatPeriod(state.directionFrom, state.directionTo);
  const rows = state.data.leads.coreDirections.map((direction) => {
    const plan = sumNullable(idx.map((i) => direction.plan[i]));
    const fact = sum(idx.map((i) => direction.fact[i]));
    return { name: direction.name, plan, fact, series: direction.fact };
  });
  const core = state.data.leads.entities.find((item) => item.id === 'core');
  const totalPlan = sumNullable(rows.map((r) => r.plan));
  const totalFact = sum(rows.map((r) => r.fact));
  const row = (name, plan, fact, series, total) => {
    const deviation = plan === null ? null : fact - plan;
    const execution = plan ? fact / plan : null;
    const prevSeries = state.yoy && state.yoy.directions ? state.yoy.directions[name] : null;
    return `<tr${total ? ' class="direction-total"' : ''}><td>${name}</td><td>${plan === null ? '—' : formatNumber(plan)}</td><td>${formatInt(fact)}</td><td>${deviation === null ? '—' : formatNumber(deviation)}</td><td>${executionCell(execution)}</td>${forecastCell(series, state.data.leads.entities[0].dates)}${total ? yoyCell(fact, state.yoy && state.yoy.entities ? state.yoy.entities.core : null, state.directionFrom, state.directionTo) : yoyCell(fact, prevSeries, state.directionFrom, state.directionTo)}</tr>`;
  };
  // Сначала направления с планом (в исходном порядке), затем без плана, итог — последней строкой.
  const withPlan = rows.filter((r) => r.plan !== null);
  const noPlan = rows.filter((r) => r.plan === null);
  body.innerHTML = withPlan.map((r) => row(r.name, r.plan, r.fact, r.series, false)).join('')
    + noPlan.map((r) => row(r.name, r.plan, r.fact, r.series, false)).join('')
    + row('Итого core', totalPlan, totalFact, core.fact, true);
  $('#direction-summary-note').textContent = `Все направления Skillbox core · SEO · ${period} · период берётся из фильтров графика направлений. Направления без плана — в конце таблицы. Прогноз — оценка на конец месяца по последним 7 полным дням.`;
}

function currentMediaSeries() {
  const project = state.data.media.projects.find((item) => item.id === state.mediaId);
  if (project.id === 'skillbox-media' && state.mediaSection !== 'Все /media/') {
    const section = project.sections.find((item) => item.name === state.mediaSection);
    return { project, label: section.name, seo: section.seo, direct: section.direct };
  }
  return { project, label: project.id === 'skillbox-media' ? 'Все /media/' : project.name, seo: project.seo, direct: project.direct };
}

function renderMediaMonthly(dates, seoValues, directValues, start, end) {
  const body = $('#media-monthly'); body.innerHTML = '';
  const groups = new Map();
  rangeIndexes(dates, start, end).forEach((index) => {
    const key = dates[index].slice(0, 7);
    if (!groups.has(key)) groups.set(key, { seo: 0, direct: 0 });
    groups.get(key).seo += seoValues[index] || 0;
    groups.get(key).direct += directValues[index] || 0;
  });
  groups.forEach((values, key) => {
    const month = Number(key.slice(5, 7));
    const total = values.seo + values.direct;
    const row = document.createElement('tr');
    [monthNames[month - 1], formatInt(values.seo), formatInt(values.direct), total ? pctf.format(values.seo / total) : '—'].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    });
    body.appendChild(row);
  });
  $('#media-monthly-note').textContent = `Период ${formatPeriod(start, end)}.`;
}

function renderEditorialSummary(project, start, end) {
  const card = $('#editorial-card');
  if (project.id !== 'skillbox-media') { card.hidden = true; return; }
  card.hidden = false;
  const idx = rangeIndexes(project.dates, start, end);
  const ranked = project.sections.map((section) => ({
    name: section.name,
    seo: sum(idx.map((i) => section.seo[i])),
    direct: sum(idx.map((i) => section.direct[i])),
  })).sort((a, b) => (b.seo + b.direct) - (a.seo + a.direct));
  const body = $('#editorial-summary'); body.innerHTML = '';
  ranked.forEach((section) => {
    const row = document.createElement('tr');
    [section.name, formatInt(section.seo), formatInt(section.direct)].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    });
    body.appendChild(row);
  });
  $('#editorial-summary-note').textContent = `Итоги за ${formatPeriod(start, end)}, сортировка по SEO + Direct.`;
}

function renderMedia() {
  const current = currentMediaSeries();
  const { project, label, seo, direct } = current;
  [state.mediaFrom, state.mediaTo] = normalizedPeriod(project.dates, state.mediaFrom, state.mediaTo);
  setDateInputs('media', project.dates, state.mediaFrom, state.mediaTo);
  $('#media-granularity').value = state.mediaGranularity;
  const idx = rangeIndexes(project.dates, state.mediaFrom, state.mediaTo);
  const seoTotal = sum(idx.map((i) => seo[i]));
  const directTotal = sum(idx.map((i) => direct[i]));
  const total = seoTotal + directTotal;
  const period = formatPeriod(state.mediaFrom, state.mediaTo);
  $('#media-kpis').innerHTML = [
    kpi('SEO-визиты', formatInt(seoTotal), period, true),
    kpi('Прямые визиты', formatInt(directTotal), period),
    kpi('SEO + Direct', formatInt(total), 'Всего в двух каналах'),
    kpi('Доля SEO', total ? pctf.format(seoTotal / total) : '—', 'В сумме SEO и Direct'),
  ].join('');
  const selectionLabel = project.id === 'skillbox-media' ? `${project.name} · ${label}` : project.name;
  $('#media-chart-note').textContent = `${selectionLabel} · ${project.url} · ${period} · ${granularityLabel(state.mediaGranularity)}`;
  const chart = aggregateRange(project.dates, [
    { name: 'SEO', values: seo, className: 'line-primary' },
    { name: 'Прямой', values: direct, className: 'line-black' },
  ], state.mediaFrom, state.mediaTo, state.mediaGranularity);
  renderLineChart($('#media-chart'), chart.dates, chart.series);
  renderMediaMonthly(project.dates, seo, direct, state.mediaFrom, state.mediaTo);
  renderEditorialSummary(project, state.mediaFrom, state.mediaTo);
}

function setupMediaControls() {
  const projects = state.data.media.projects;
  populateSelect($('#media-project'), projects, state.mediaId);
  const project = projects.find((item) => item.id === state.mediaId);
  const sectionControl = $('#media-section-control');
  if (project.id === 'skillbox-media') {
    sectionControl.hidden = false;
    const options = ['Все /media/', ...project.sections.map((item) => item.name)];
    if (!options.includes(state.mediaSection)) state.mediaSection = 'Все /media/';
    populateSelect($('#media-section'), options, state.mediaSection);
  } else {
    sectionControl.hidden = true;
    state.mediaSection = 'Все /media/';
  }
}

function loadUrlState() {
  const params = new URLSearchParams(location.search);
  const grains = ['day', 'week', 'month'];
  const dateParam = (name) => /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) || '') ? params.get(name) : null;
  if (['leads', 'media', 'recovery', 'experiment'].includes(params.get('view'))) state.view = params.get('view');
  if (state.data.leads.entities.some((item) => item.id === params.get('lead'))) state.leadId = params.get('lead');
  if (params.get('page')) {
    const entity = state.data.leads.entities.find((item) => item.id === state.leadId);
    if (entity && entity.pageGroups && entity.pageGroups.some((g) => g.id === params.get('page'))) state.leadPage = params.get('page');
  }
  if (state.data.leads.coreDirections.some((item) => item.name === params.get('direction'))) state.direction = params.get('direction');
  if (state.data.media.projects.some((item) => item.id === params.get('project'))) state.mediaId = params.get('project');
  if (params.get('section')) state.mediaSection = params.get('section');
  if (grains.includes(params.get('grain'))) {
    if (state.view === 'media') state.mediaGranularity = params.get('grain');
    else if (state.view === 'leads') state.leadGranularity = params.get('grain');
  }
  if (state.view === 'media') {
    state.mediaFrom = dateParam('from') || state.mediaFrom;
    state.mediaTo = dateParam('to') || state.mediaTo;
  } else if (state.view === 'leads') {
    state.leadFrom = dateParam('from') || state.leadFrom;
    state.leadTo = dateParam('to') || state.leadTo;
  }
  if (grains.includes(params.get('directionGrain'))) state.directionGranularity = params.get('directionGrain');
  state.directionFrom = dateParam('directionFrom') || state.directionFrom;
  state.directionTo = dateParam('directionTo') || state.directionTo;
}

function updateUrl() {
  if (state.view === 'recovery') { if (window.updateRecoveryUrl) window.updateRecoveryUrl(); return; }
  if (state.view === 'experiment') { if (window.updateExperimentUrl) window.updateExperimentUrl(); return; }
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.view === 'media') {
    params.set('project', state.mediaId);
    if (state.mediaId === 'skillbox-media') params.set('section', state.mediaSection);
    params.set('grain', state.mediaGranularity);
    params.set('from', state.mediaFrom);
    params.set('to', state.mediaTo);
  } else {
    params.set('lead', state.leadId);
    if (state.leadPage !== 'all') params.set('page', state.leadPage);
    params.set('grain', state.leadGranularity);
    params.set('from', state.leadFrom);
    params.set('to', state.leadTo);
    params.set('direction', state.direction);
    params.set('directionGrain', state.directionGranularity);
    params.set('directionFrom', state.directionFrom);
    params.set('directionTo', state.directionTo);
  }
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
}

function activateView(target, syncUrl = true) {
  state.view = target;
  document.querySelectorAll('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
  document.querySelectorAll('.dashboard-section').forEach((section) => section.classList.toggle('active', section.id === target));
  if (target === 'recovery') { if (window.renderRecovery) window.renderRecovery(); }
  else if (target === 'experiment') { if (window.renderExperiment) window.renderExperiment(); }
  else if (target === 'media') renderMedia();
  else { renderLead(); renderDirection(); }
  if (syncUrl) updateUrl();
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => activateView(button.dataset.target));
  });
}

function bindChartControls(prefix, granularityKey, fromKey, toKey, render) {
  $(`#${prefix}-granularity`).addEventListener('change', (event) => {
    state[granularityKey] = event.target.value; render(); updateUrl();
  });
  $(`#${prefix}-date-from`).addEventListener('change', (event) => {
    state[fromKey] = event.target.value;
    if (state[toKey] && state[fromKey] > state[toKey]) state[toKey] = state[fromKey];
    render(); updateUrl();
  });
  $(`#${prefix}-date-to`).addEventListener('change', (event) => {
    state[toKey] = event.target.value;
    if (state[fromKey] && state[toKey] < state[fromKey]) state[fromKey] = state[toKey];
    render(); updateUrl();
  });
}

async function init() {
  try {
    state.data = await loadJSON('data.json');
    $('#as-of').textContent = `Данные по ${formatDate(state.data.meta.asOf)}`;
    const leadDates = state.data.leads.entities[0].dates;
    const mediaDates = state.data.media.projects[0].dates;
    state.direction = state.data.leads.coreDirections[0].name;
    state.leadFrom = state.directionFrom = leadDates[0];
    state.leadTo = state.directionTo = leadDates[leadDates.length - 1];
    state.mediaFrom = mediaDates[0]; state.mediaTo = mediaDates[mediaDates.length - 1];
    loadUrlState();
    populateSelect($('#lead-entity'), state.data.leads.entities, state.leadId);
    populateSelect($('#direction-select'), state.data.leads.coreDirections, state.direction, 'name', 'name');
    setupMediaControls(); setupTabs(); renderLeadSummary(); renderLead(); renderDirection(); renderMedia();
    activateView(state.view, false);
    if (window.initRecovery) window.initRecovery();
    if (window.initExperiment) window.initExperiment();
    if (state.yoy === undefined) {
      loadJSON('yoy.json')
        .then((data) => { state.yoy = data; })
        .catch(() => { state.yoy = null; })
        .finally(() => { if (state.view === 'leads') { renderLeadSummary(); renderDirectionSummary(); } });
    }
    window.addEventListener('resize', () => {
      if (state.view === 'leads' && ['spo', 'kids'].includes(state.leadId)) renderLead();
    });

    $('#lead-entity').addEventListener('change', (event) => {
      state.leadId = event.target.value;
      const entity = state.data.leads.entities.find((item) => item.id === state.leadId);
      if (!entity.pageGroups || !entity.pageGroups.some((g) => g.id === state.leadPage)) state.leadPage = 'all';
      renderLead(); updateUrl();
    });
    $('#lead-page').addEventListener('change', (event) => { state.leadPage = event.target.value; renderLead(); updateUrl(); });
    $('#direction-select').addEventListener('change', (event) => { state.direction = event.target.value; renderDirection(); updateUrl(); });
    $('#media-project').addEventListener('change', (event) => { state.mediaId = event.target.value; setupMediaControls(); renderMedia(); updateUrl(); });
    $('#media-section').addEventListener('change', (event) => { state.mediaSection = event.target.value; renderMedia(); updateUrl(); });
    bindChartControls('lead', 'leadGranularity', 'leadFrom', 'leadTo', renderLead);
    bindChartControls('direction', 'directionGranularity', 'directionFrom', 'directionTo', renderDirection);
    bindChartControls('media', 'mediaGranularity', 'mediaFrom', 'mediaTo', renderMedia);
  } catch (error) {
    document.querySelector('main').innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
// Ключ дописали в адрес той же вкладки — единственный способ увидеть данные: перезагрузиться.
window.addEventListener('hashchange', () => { if (!state.data && location.hash.replace(/^#/, '').trim()) location.reload(); });
