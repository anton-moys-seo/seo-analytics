const state = {
  data: null, view: 'leads',
  leadId: 'core', leadGranularity: 'day', leadFrom: null, leadTo: null, leadPage: 'all',
  direction: null, directionGranularity: 'day', directionFrom: null, directionTo: null,
  mediaId: 'skillbox-media', mediaSection: 'Все /media/', mediaGranularity: 'day', mediaFrom: null, mediaTo: null,
  blog: undefined, // undefined — ещё не запрашивался; null — недоступен; object — blog.json
  yoy: undefined, // undefined — ещё не запрашивался; null — недоступен; object — yoy.json
  forecast: undefined, // undefined — ещё не запрашивался; null — недоступен; object — forecast.json
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

window.loadJSON = async function loadJSON(name, options = {}) {
  if (!SITE_KEY_TEXT) {
    if (!options.softFail) showLockScreen('Отчёт зашифрован. Откройте ссылку с ключом доступа (часть после символа «#»).');
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
    if (!options.softFail) showLockScreen('Не удалось расшифровать отчёт: ключ неверен или данные повреждены.');
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
function kpi(label, value, caption = '', primary = false, visual = '', modifier = '') {
  return `<div class="kpi-card${primary ? ' primary' : ''}${modifier ? ` ${modifier}` : ''}"><span class="kpi-label">${label}</span><div><div class="kpi-value">${value}</div>${caption ? `<div class="kpi-caption">${caption}</div>` : ''}</div>${visual}</div>`;
}

// --- UI-визуализации без новых метрик: рисуют уже посчитанные значения. ---
function executionTier(execution) {
  if (execution === null || execution === undefined) return null;
  return execution >= 1 ? 'good' : execution >= 0.9 ? 'mid' : 'low';
}
// Шкала полосы выполнения 0–150 %; отметка — 100 % плана. Значение выше 150 % упирается в край.
function executionMeter(execution, tier = executionTier(execution)) {
  if (!tier) return '';
  const width = Math.max(0, Math.min(execution, 1.5)) / 1.5 * 100;
  return `<span class="exec-meter exec-${tier}" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i><b></b></span>`;
}
function shareMeter(share) {
  if (share === null || share === undefined || Number.isNaN(share)) return '';
  return `<span class="share-meter" aria-hidden="true"><i style="width:${(Math.max(0, Math.min(share, 1)) * 100).toFixed(1)}%"></i></span>`;
}
function sparkline(values) {
  const points = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  if (points.length < 2) return '';
  const w = 240, h = 44, max = Math.max(...points.map(([, v]) => v)), min = Math.min(0, ...points.map(([, v]) => v));
  const span = max - min || 1, last = values.length - 1 || 1;
  const xy = ([i, v]) => `${(i / last * w).toFixed(1)},${(h - 2 - (v - min) / span * (h - 4)).toFixed(1)}`;
  const line = points.map((pt, k) => `${k ? 'L' : 'M'}${xy(pt)}`).join(' ');
  const area = `${line} L${(points[points.length - 1][0] / last * w).toFixed(1)},${h} L${(points[0][0] / last * w).toFixed(1)},${h} Z`;
  return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="kpi-spark-area" d="${area}"></path><path class="kpi-spark-line" d="${line}"></path></svg>`;
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
  const gradId = `${container.id}-area-grad`;
  svg += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="area-stop-top"></stop><stop offset="1" class="area-stop-bottom"></stop></linearGradient></defs>`;
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

  // Зона отклонения план/факт: та же разница «факт минус план», что и в KPI, только нарисованная.
  const planSeries = options.gap ? series.find((item) => item.className.includes('line-black')) : null;
  const factSeries = options.gap ? series.find((item) => item.className.includes('line-primary')) : null;
  if (planSeries && factSeries) {
    let above = '', below = '';
    const has = (v) => v !== null && v !== undefined;
    for (let i = 0; i < dates.length - 1; i++) {
      const p0 = planSeries.values[i], p1 = planSeries.values[i + 1], f0 = factSeries.values[i], f1 = factSeries.values[i + 1];
      if (![p0, p1, f0, f1].every(has)) continue;
      const d0 = f0 - p0, d1 = f1 - p1, x0 = x(i), x1 = x(i + 1);
      const poly = (pts) => `M${pts.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' L')} Z `;
      if (d0 * d1 >= 0) {
        const piece = poly([[x0, y(f0)], [x1, y(f1)], [x1, y(p1)], [x0, y(p0)]]);
        if (d0 + d1 >= 0) above += piece; else below += piece;
      } else {
        const t = d0 / (d0 - d1), xm = x0 + t * (x1 - x0), ym = y(p0 + t * (p1 - p0));
        const first = poly([[x0, y(f0)], [xm, ym], [x0, y(p0)]]), second = poly([[xm, ym], [x1, y(f1)], [x1, y(p1)]]);
        if (d0 > 0) { above += first; below += second; } else { below += first; above += second; }
      }
    }
    if (above) svg += `<path class="gap-above" d="${above.trim()}"></path>`;
    if (below) svg += `<path class="gap-below" d="${below.trim()}"></path>`;
  } else {
    // Мягкая заливка под основным рядом.
    const primary = series.find((item) => item.className.includes('line-primary'));
    if (primary) {
      let area = '', run = [];
      const flush = () => {
        if (run.length > 1) area += `M${run.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' L')} L${run[run.length - 1][0].toFixed(2)},${(margin.top + innerH).toFixed(2)} L${run[0][0].toFixed(2)},${(margin.top + innerH).toFixed(2)} Z `;
        run = [];
      };
      primary.values.forEach((value, index) => { if (value === null || value === undefined) flush(); else run.push([x(index), y(value)]); });
      flush();
      if (area) svg += `<path class="area-primary" fill="url(#${gradId})" d="${area.trim()}"></path>`;
    }
  }

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

  // Последнее значение основного ряда — точка и подпись.
  const lastPrimary = series.find((item) => item.className.includes('line-primary'));
  if (lastPrimary && dates.length > 1) {
    let li = lastPrimary.values.length - 1;
    while (li >= 0 && (lastPrimary.values[li] === null || lastPrimary.values[li] === undefined)) li--;
    if (li >= 0) {
      const lx = x(li), ly = y(lastPrimary.values[li]);
      svg += `<circle class="last-dot" r="6" cx="${lx}" cy="${ly}"></circle>`;
      const label = esc(formatNumber(lastPrimary.values[li]));
      const lw = label.length * 7.5 + 16;
      const bx = Math.min(lx - lw / 2, width - margin.right - lw + 20), by = Math.max(2, ly - 36);
      svg += `<g class="last-value"><rect x="${bx}" y="${by}" width="${lw}" height="24" rx="12"></rect><text x="${bx + lw / 2}" y="${by + 16}" text-anchor="middle">${label}</text></g>`;
    }
  }

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
      const swatch = item.className.includes('primary') ? 'tt-dot primary' : 'tt-dot';
      const value = item.values[index];
      const point = container.querySelector(`#${container.id}-point-${seriesIndex}`);
      if (value === null || value === undefined) {
        point.setAttribute('visibility', 'hidden');
      } else {
        point.setAttribute('cx', xx); point.setAttribute('cy', y(value)); point.setAttribute('visibility', 'visible');
      }
      content += `<br><i class="${swatch}"></i>${esc(item.name)}: <b>${value === null || value === undefined ? '—' : formatNumber(value)}</b>`;
    });
    if (planSeries && factSeries) {
      const pv = planSeries.values[index], fv = factSeries.values[index];
      if (pv !== null && pv !== undefined && fv !== null && fv !== undefined) {
        const dv = fv - pv;
        content += `<br><span class="tt-delta ${dv >= 0 ? 'up' : 'down'}">Отклонение: ${dv >= 0 ? '+' : ''}${formatNumber(dv)}</span>`;
      }
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
  const tier = executionTier(execution);
  return `<span class="exec-cell"><span class="exec-badge exec-${tier}">${pctf.format(execution)}</span>${executionMeter(execution, tier)}</span>`;
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
  const attention = [];
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
    attention.push({ id: entity.id, name: entity.name, execution });
    const fcCell = document.createElement('td');
    fcCell.innerHTML = forecastCell(entity.fact, entity.dates, entity.id === 'spo' && spoMonth ? spoMonth.total : null);
    row.appendChild(fcCell);
    const yoyCellNode = document.createElement('td');
    yoyCellNode.innerHTML = yoyCell(fact, state.yoy && state.yoy.entities ? state.yoy.entities[entity.id] : null, summaryStart, summaryEnd);
    row.appendChild(yoyCellNode);
    body.appendChild(row);
  });
  renderLeadAttention(attention, formatPeriod(summaryStart, summaryEnd));
}

// Блок «Требует внимания»: те же значения выполнения и пороги, что в сводке месяца, без новых расчётов.
function renderLeadAttention(items, period) {
  const box = $('#lead-attention');
  if (!box) return;
  const planned = items.filter((item) => item.execution !== null && item.execution !== undefined);
  const lagging = planned.filter((item) => item.execution < 1).sort((a, b) => a.execution - b.execution);
  const onTrack = planned.length - lagging.length;
  const noPlan = items.length - planned.length;
  box.hidden = !items.length;
  box.innerHTML = `<div class="attention-head"><p class="attention-title">${lagging.length ? 'Требует внимания' : 'Все проекты с планом в плане'}</p>`
    + `<p class="attention-note">Сводка за ${period}: план выполняют ${onTrack} из ${planned.length}${noPlan ? ` · без плана: ${noPlan}` : ''}. Нажмите на проект, чтобы открыть его график.</p></div>`
    + (lagging.length ? `<div class="attention-list">${lagging.map((item) => `<button type="button" class="attention-chip exec-${executionTier(item.execution)}" data-lead="${item.id}"><span>${item.name}</span><b>${pctf.format(item.execution)}</b></button>`).join('')}</div>` : '');
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
  // План не детализирован по страницам: при выборе группы страниц показываем только факт,
  // и вертикальная шкала масштабируется под значения группы, а не под план проекта.
  const chart = aggregateRange(entity.dates, group ? [
    { name: `Факт: ${group.name}`, values: group.fact, className: 'line-primary' },
  ] : [
    { name: 'План', values: entity.plan, className: 'line-black' },
    { name: 'Факт', values: entity.fact, className: 'line-primary' },
  ], state.leadFrom, state.leadTo, state.leadGranularity);
  const factSpark = sparkline(chart.series[chart.series.length - 1].values);
  const period = formatPeriod(state.leadFrom, state.leadTo);
  const tier = executionTier(execution);
  $('#lead-kpis').innerHTML = group ? [
    kpi(`Факт за период: ${group.name}`, formatInt(groupFact), period, true, factSpark),
    kpi('Доля от проекта', share === null ? '—' : pctf.format(share), 'Факт группы к факту всего проекта', false, shareMeter(share)),
    kpi('План проекта за период', formatNumber(plan), plan === null ? 'План в модели не заполнен' : `${period} · страница плана не разделяет`),
    kpi('Выполнение к плану проекта', execution === null ? '—' : pctf.format(execution), 'Факт группы к плану всего проекта', false, executionMeter(execution)),
  ].join('') : [
    kpi('Факт за период', formatInt(fact), period, true, factSpark),
    kpi('План за период', formatNumber(plan), plan === null ? 'План в модели не заполнен' : period),
    kpi('Отклонение', formatNumber(deviation), plan === null ? 'Недоступно без плана' : 'Факт минус план', false, '', deviation === null ? '' : deviation >= 0 ? 'kpi-delta-up' : 'kpi-delta-down'),
    kpi('Выполнение', execution === null ? '—' : pctf.format(execution), plan === null ? 'Недоступно без плана' : 'Факт к плану', false, executionMeter(execution, tier), tier ? `kpi-tier-${tier}` : ''),
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
  const legendPlan = $('#lead-legend-plan');
  if (legendPlan) legendPlan.hidden = Boolean(group);
  document.querySelectorAll('[data-gap-legend="lead"]').forEach((item) => { item.hidden = Boolean(group); });
  renderLineChart($('#lead-chart'), chart.dates, chart.series, { width: window.innerWidth < 640 ? 360 : 1200, gap: !group });
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
  renderLineChart($('#direction-chart'), chart.dates, chart.series, { width: window.innerWidth < 640 ? 360 : 1200, gap: true });
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

const FC_COEF_SOURCE = { own: 'сезонность этого направления в 2025', core: 'база прошлого года мала — взят коэффициент core', neutral: 'прошлый год — фаза запуска, коэффициент 1,00' };

function fcGen(name) {
  // Родительный падеж: «Октябрь» → «октября», «Ноябрь» → «ноября».
  const w = name.toLowerCase();
  return w.endsWith('ь') ? w.slice(0, -1) + 'я' : w;
}

function fcShort(name) {
  return name.slice(0, 3).toLowerCase();
}

function forecastHeadMonths(months) {
  // Подписи месяцев в шапках таблиц: из meta.months (m3/m2 — история, cur — текущий, next — прогнозный).
  return [
    months.m3, months.m2, `${months.cur}: факт`, 'Досчёт', `Итог ${fcGen(months.cur)}`,
    `Тренд ${fcShort(months.cur)}/${fcShort(months.m2)}`,
    `${months.next}: тренд`, `${months.next}: сезонность`, `${months.next}: спрос`, 'Сезонный коэф.',
  ];
}

function forecastTrendCell(row) {
  if (row.trendPct === null || row.trendPct === undefined) return '<span class="fc-trend side">—</span>';
  const cls = row.trendLabel === 'рост' ? 'up' : row.trendLabel === 'падение' ? 'down' : 'side';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '→';
  const sign = row.trendPct > 0 ? '+' : '';
  return `<span class="fc-trend ${cls}">${arrow} ${sign}${nf.format(row.trendPct)}%</span>`;
}

function forecastCoefCell(row) {
  if (row.seasonalCoef === null || row.seasonalCoef === undefined) return '<span aria-label="нет данных">—</span>';
  const hint = FC_COEF_SOURCE[row.seasonalSource] || '';
  return `<span class="fc-coef" title="${hint}">×${nf.format(row.seasonalCoef)}</span>`;
}

function forecastDemandCell(row, total) {
  if (row.nextDemand === null || row.nextDemand === undefined) {
    return '<td class="fc-d fc-soft" title="нет строки спроса в файле отслеживания">—</td>';
  }
  const factor = row.demandFactor !== null && row.demandFactor !== undefined
    ? `спрос-фактор ×${nf.format(row.demandFactor)} — сезонность спроса ноя/окт 2025` : '';
  const cover = total && row.demandCover
    ? ` · покрытие спросом: ${row.demandCover} ${row.demandCover === 9 ? 'направлений' : 'проект'} из ${row.name.includes('core') ? '13' : '6'}` : '';
  return `<td class="fc-d"${factor || cover ? ` title="${factor}${cover}"` : ''}>${formatInt(row.nextDemand)}${cover ? '<span class="fc-soft">*</span>' : ''}</td>`;
}

function forecastRow(row, total) {
  return `<tr${total ? ' class="direction-total"' : ''}>`
    + `<td>${row.name}</td>`
    + `<td>${formatInt(row.m3)}</td><td>${formatInt(row.m2)}</td>`
    + `<td>${formatInt(row.curFact)}</td>`
    + `<td class="fc-soft">+${formatInt(row.curRemaining)}</td>`
    + `<td><b>${formatInt(row.curEom)}</b></td>`
    + `<td>${forecastTrendCell(row)}</td>`
    + `<td class="fc-a">${formatInt(row.nextTrend)}</td>`
    + `<td class="fc-b">${formatInt(row.nextSeasonal)}</td>`
    + forecastDemandCell(row, total)
    + `<td>${forecastCoefCell(row)}</td></tr>`;
}

function renderForecast() {
  const fc = state.forecast;
  if (!fc) return;
  const meta = fc.meta;
  const months = meta.months || { m3: 'Август', m2: 'Сентябрь', cur: 'Октябрь', next: 'Ноябрь' };
  for (const headId of ['forecast-projects-head', 'forecast-directions-head']) {
    const head = document.getElementById(headId);
    if (!head) continue;
    const cells = head.querySelectorAll('th');
    const labels = forecastHeadMonths(months);
    cells.forEach((th, i) => { if (i >= 1 && i <= 9 && labels[i - 1]) th.textContent = labels[i - 1]; });
  }
  $('#forecast-kpis').innerHTML = [
    `<span class="mini-kpi">Итог ${fcGen(months.cur)}, 6 проектов <b>${formatInt(fc.total.curEom)}</b></span>`,
    `<span class="mini-kpi">Досчёт ${formatDate(meta.curRemainFrom)}–${formatDate(meta.curRemainTo)} · ставка недели ${formatDate(meta.curWindow[0])}–${formatDate(meta.curWindow[1])} <b>+${formatInt(fc.total.curRemaining)}</b></span>`,
    `<span class="mini-kpi">${months.next} · сценарий «тренд» <b>${formatInt(fc.total.nextTrend)}</b></span>`,
    `<span class="mini-kpi">${months.next} · сценарий «сезонность» <b>${formatInt(fc.total.nextSeasonal)}</b></span>`,
    ...(fc.projects.find((p) => p.id === 'core')?.nextDemand != null
      ? [`<span class="mini-kpi">${months.next} · сценарий «спрос», только core <b>${formatInt(fc.projects.find((p) => p.id === 'core').nextDemand)}</b></span>`]
      : []),
  ].join('');
  $('#forecast-projects-note').textContent = `Факт по ${formatDate(meta.asOf)}; итог ${fcGen(months.cur)} = факт + ставка последних 7 дней × ${meta.curRemainingDays} дн. (${nf.format(meta.curTailFactor)} «средних» дня с учётом дней недели); ${months.next.toLowerCase()} — ${meta.nextDays} календарных дней ≈ ${nf.format(meta.nextFactor)} «средних». Спрос-сценарий — только для core (файл спроса покрывает направления core); в таблице направлений — ${meta.demand.mappedDirections} строк из 13.`;
  $('#forecast-directions-note').textContent = `Тринадцать направлений горячей воронки core (сумма = Skillbox core) · факт по ${formatDate(meta.asOf)}.`;
  $('#forecast-projects').innerHTML = fc.projects.map((row) => forecastRow(row, false)).join('') + forecastRow(fc.total, true);
  $('#forecast-directions').innerHTML = fc.directions.map((row) => forecastRow(row, false)).join('') + forecastRow(fc.directionsTotal, true);
  const list = $('#forecast-method-list');
  list.innerHTML = meta.methodology.map((item) => `<li>${item}</li>`).join('');
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
  const chart = aggregateRange(project.dates, [
    { name: 'SEO', values: seo, className: 'line-primary' },
    { name: 'Прямой', values: direct, className: 'line-black' },
  ], state.mediaFrom, state.mediaTo, state.mediaGranularity);
  $('#media-kpis').innerHTML = [
    kpi('SEO-визиты', formatInt(seoTotal), period, true, sparkline(chart.series[0].values)),
    kpi('Прямые визиты', formatInt(directTotal), period, false, sparkline(chart.series[1].values)),
    kpi('SEO + Direct', formatInt(total), 'Всего в двух каналах'),
    kpi('Доля SEO', total ? pctf.format(seoTotal / total) : '—', 'В сумме SEO и Direct', false, total ? shareMeter(seoTotal / total) : ''),
  ].join('');
  const selectionLabel = project.id === 'skillbox-media' ? `${project.name} · ${label}` : project.name;
  $('#media-chart-note').textContent = `${selectionLabel} · ${project.url} · ${period} · ${granularityLabel(state.mediaGranularity)}`;
  renderLineChart($('#media-chart'), chart.dates, chart.series, { width: window.innerWidth < 640 ? 360 : 1200 });
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
  if (['leads', 'products-sf-cd', 'media', 'recovery', 'updates', 'updates-all', 'experiment', 'forecast'].includes(params.get('view'))) state.view = params.get('view');
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
  if (state.view === 'products-sf-cd') {
    if (window.updateProductsSfCdUrl) window.updateProductsSfCdUrl();
    else history.replaceState(null, '', `${location.pathname}?view=products-sf-cd${location.hash}`);
    return;
  }
  if (state.view === 'updates-all') { if (window.updateUpdatesAllUrl) window.updateUpdatesAllUrl(); return; }
  if (state.view === 'updates') { if (window.updateUpdatesUrl) window.updateUpdatesUrl(); return; }
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
  history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
}

function activateView(target, syncUrl = true) {
  state.view = target;
  if (state.data?.meta?.asOf) $('#as-of').textContent = `Данные по ${formatDate(state.data.meta.asOf)}`;
  const isMedia = ['media', 'recovery', 'updates', 'updates-all'].includes(target);
  const isLeads = ['leads', 'products-sf-cd'].includes(target);
  const isResults = ['recovery', 'updates'].includes(target);
  document.querySelectorAll('.section-tabs .tab-button').forEach((button) => {
    const active = button.dataset.target === (isMedia ? 'media' : isLeads ? 'leads' : target);
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('#leads-navigation').hidden = !isLeads;
  $('#media-navigation').hidden = !isMedia;
  $('#media-results-navigation').hidden = !isResults;
  document.querySelectorAll('.nested-tab').forEach((button) => {
    const active = button.hasAttribute('data-media-results') ? isResults : button.dataset.target === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.dashboard-section').forEach((section) => {
    const active = section.id === target;
    section.classList.toggle('active', active);
    section.hidden = !active;
  });
  $('#tooltip').classList.remove('visible');
  if (target === 'products-sf-cd') { if (window.ensureProductsSfCd) window.ensureProductsSfCd(); }
  else if (target === 'updates-all') { if (window.ensureUpdatesAll) window.ensureUpdatesAll(); }
  else if (target === 'updates') { if (window.ensureUpdates) window.ensureUpdates(); else if (window.renderUpdates) window.renderUpdates(); }
  else if (target === 'recovery') { if (window.renderRecovery) window.renderRecovery(); }
  else if (target === 'experiment') { if (window.renderExperiment) window.renderExperiment(); }
  else if (target === 'media') renderMedia();
  else if (target === 'forecast') renderForecast();
  else { renderLead(); renderDirection(); }
  if (syncUrl) updateUrl();
}

function setupTabs() {
  document.querySelectorAll('.tab-button, .nested-tab').forEach((button) => {
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
    if (state.forecast === undefined) {
      loadJSON('forecast.json')
        .then((data) => { state.forecast = data; })
        .catch(() => { state.forecast = null; })
        .finally(() => { if (state.view === 'forecast') renderForecast(); });
    }
    window.addEventListener('resize', () => {
      if (state.view === 'leads') { renderLead(); renderDirection(); }
      else if (state.view === 'media') renderMedia();
    });

    $('#lead-entity').addEventListener('change', (event) => {
      state.leadId = event.target.value;
      const entity = state.data.leads.entities.find((item) => item.id === state.leadId);
      if (!entity.pageGroups || !entity.pageGroups.some((g) => g.id === state.leadPage)) state.leadPage = 'all';
      renderLead(); updateUrl();
    });
    $('#lead-attention').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-lead]');
      if (!chip) return;
      // Drill down into the same monthly all-pages context as the attention summary.
      state.leadPage = 'all';
      state.leadFrom = `${state.data.meta.asOf.slice(0, 7)}-01`;
      state.leadTo = state.data.meta.asOf;
      const select = $('#lead-entity');
      select.value = chip.dataset.lead;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.closest('.chart-card').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    $('#lead-page').addEventListener('change', (event) => { state.leadPage = event.target.value; renderLead(); updateUrl(); });
    $('#direction-select').addEventListener('change', (event) => { state.direction = event.target.value; renderDirection(); updateUrl(); });
    $('#media-project').addEventListener('change', (event) => { state.mediaId = event.target.value; setupMediaControls(); renderMedia(); updateUrl(); });
    $('#media-section').addEventListener('change', (event) => { state.mediaSection = event.target.value; renderMedia(); updateUrl(); });
    bindChartControls('lead', 'leadGranularity', 'leadFrom', 'leadTo', renderLead);
    bindChartControls('direction', 'directionGranularity', 'directionFrom', 'directionTo', renderDirection);
    bindChartControls('media', 'mediaGranularity', 'mediaFrom', 'mediaTo', renderMedia);
  } catch (error) {
    // loadJSON already renders a helpful lock screen for missing/invalid keys.
    // Do not replace it with the raw NO_KEY/BAD_KEY exception text.
    if (!['NO_KEY', 'BAD_KEY'].includes(error.message)) {
      document.querySelector('main').innerHTML = `<div class="empty">${error.message}</div>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
// Ключ дописали в адрес той же вкладки — единственный способ увидеть данные: перезагрузиться.
window.addEventListener('hashchange', () => { if (!state.data && location.hash.replace(/^#/, '').trim()) location.reload(); });
