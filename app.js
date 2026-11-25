const state = {
  data: null, view: 'leads',
  leadId: 'core', leadGranularity: 'day', leadFrom: null, leadTo: null, leadPage: 'all',
  direction: null, directionGranularity: 'day', directionFrom: null, directionTo: null,
  mediaId: 'skillbox-media', mediaSection: 'Все /media/', mediaGranularity: 'day', mediaFrom: null, mediaTo: null,
  planPeriod: null, planView: 'cum',
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
  const wrong = /неверен/.test(message);
  document.querySelector('main').innerHTML = `<div class="empty lock-screen" role="region" aria-labelledby="lock-title" tabindex="-1"><h2 id="lock-title">${wrong ? 'Ключ не подошёл' : 'Нужен ключ доступа'}</h2><p>${message}</p><p>${wrong
    ? 'Проверьте, что ссылка скопирована целиком, вместе с частью после «#». Если не помогло, запросите новую ссылку у владельца отчёта.'
    : 'Откройте полную ссылку, которую вам присылали. Если её нет, запросите ссылку у владельца отчёта.'}</p></div>`;
  document.querySelector('.ux-fresh-text')?.replaceChildren(document.createTextNode('Данные недоступны'));
  document.title = wrong ? 'Отчёт: ключ не подошёл' : 'Отчёт: требуется ключ доступа';
  document.querySelector('main').setAttribute('aria-busy', 'false');
  document.querySelector('.lock-screen').focus({ preventScroll: true });
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
// План за период имеет смысл только при наличии плана на каждый выбранный день.
function sumComplete(values) {
  return values.length && values.every(Number.isFinite) ? sum(values) : null;
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
    values: groupedDates.map((key) => (item.requireComplete ? sumComplete : sumNullable)(groups.get(key)[seriesIndex])),
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
function sectionStatus(sectionId, phase, retry) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  let status = section.querySelector('.section-availability');
  if (!status) {
    status = document.createElement('div'); status.className = 'empty section-availability';
    status.setAttribute('role', 'status'); section.querySelector('.section-heading').after(status);
  }
  section.setAttribute('aria-busy', String(phase === 'loading'));
  for (const child of section.children) {
    if (child !== status && !child.classList.contains('section-heading')) child.hidden = phase !== 'ready';
  }
  status.hidden = phase === 'ready';
  if (phase === 'loading') status.textContent = 'Загружаем раздел. Дождитесь данных перед сравнением.';
  if (phase === 'error') {
    status.innerHTML = '<p>Не удалось загрузить данные раздела. Другие разделы работают независимо.</p><button type="button" class="rec-csv-button">Повторить загрузку</button>';
    status.querySelector('button').addEventListener('click', retry, { once: true });
  }
}

function notifyPeriod(sectionId, requested, actual) {
  const section = document.getElementById(sectionId);
  if (!section || !actual.every(Boolean) || requested.every(v => v === null || v === undefined)) return;
  let notice = section.querySelector('.normalized-period');
  if (requested.some((v, i) => v !== actual[i])) {
    if (!notice) {
      notice = document.createElement('p'); notice.className = 'period-status normalized-period';
      notice.setAttribute('role', 'status'); section.querySelector('.section-heading')?.after(notice);
    }
    notice.dataset.period = actual.join('/');
    notice.textContent = `Даты приведены к доступному периоду: ${formatPeriod(...actual)}. Запрошено: ${requested.map(v => v ? formatDate(v) : 'пустая дата').join('–')}.`;
  }
  if (notice) notice.hidden = notice.dataset.period !== actual.join('/');
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
  if (!container) return;
  const hadFocus = container.contains(document.activeElement);
  $('#tooltip')?.classList.remove('visible');
  if (!dates.length) {
    container.innerHTML = '<div class="empty" role="status">Нет дат для выбранного среза. Выберите другой период.</div>';
    return;
  }
  const width = Math.max(280, Math.round(container.getBoundingClientRect().width) || options.width || 1200);
  const height = width < 600 ? 310 : 340;
  const margin = { top: options.events?.length ? 70 : 52, right: 24, bottom: 42, left: 58 };
  const valueFormat = options.valueFormat || formatNumber;
  const axisFormat = options.axisFormat || (options.valueFormat ? valueFormat : formatCompact);
  const seriesFormat = (item, value) => (item.format || valueFormat)(value);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const allValues = series.flatMap((item) => item.values.filter((value) => value !== null && value !== undefined));
  if (!allValues.length) {
    container.innerHTML = '<div class="empty" role="status">Нет данных для выбранного среза. Выберите другой период или объект; пропуски не означают ноль.</div>';
    return;
  }
  const scale = niceScale(options.maximum ?? Math.max(...allValues));
  const x = (index) => margin.left + (dates.length === 1 ? innerW / 2 : index * innerW / (dates.length - 1));
  const y = (value) => margin.top + innerH - (value / scale.max) * innerH;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

  let svg = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
  if (options.axisUnit) svg += `<text class="axis-label chart-unit" x="${margin.left}" y="15">${esc(options.axisUnit)}</text>`;
  (options.windows || []).forEach((window) => {
    const first = dates.findIndex((d) => d >= window.from);
    let last = dates.length - 1;
    while (last >= 0 && dates[last] > window.to) last--;
    if (first < 0 || last < first) return;
    const half = dates.length > 1 ? innerW / (dates.length - 1) / 2 : innerW / 2;
    const left = Math.max(margin.left, x(first) - half), right = Math.min(width - margin.right, x(last) + half);
    svg += `<rect class="chart-window ${window.className || ''}" x="${left}" y="${margin.top}" width="${right-left}" height="${innerH}"></rect>`;
    if (right - left > 75) svg += `<text class="axis-label window-label" x="${left + 6}" y="32">${esc(window.label)}</text>`;
  });
  const gradId = `${container.id}-area-grad`;
  svg += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="area-stop-top"></stop><stop offset="1" class="area-stop-bottom"></stop></linearGradient></defs>`;
  for (let tick = 0; tick <= Math.round(scale.max / scale.step); tick++) {
    const value = scale.step * tick;
    const yy = y(value);
    svg += `<line class="grid-line" x1="${margin.left}" y1="${yy}" x2="${width-margin.right}" y2="${yy}"></line>`;
    svg += `<text class="axis-label" x="${margin.left-12}" y="${yy+4}" text-anchor="end">${esc(axisFormat(value))}</text>`;
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
  } else if (options.band) {
    // Коридор плана (база … благоприятный): заливка между двумя рядами там, где известны оба значения.
    const { lower, upper } = options.band;
    let area = '', top = [], bottom = [];
    const flush = () => {
      if (top.length > 1) area += `M${top.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' L')} L${bottom.reverse().map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' L')} Z `;
      top = []; bottom = [];
    };
    dates.forEach((_, i) => {
      const lo = lower[i], hi = upper[i];
      if (lo === null || lo === undefined || hi === null || hi === undefined) { flush(); return; }
      top.push([x(i), y(hi)]); bottom.push([x(i), y(lo)]);
    });
    flush();
    if (area) svg += `<path class="plan-band" d="${area.trim()}"></path>`;
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
    item.values.forEach((value, index) => {
      const has = (v) => v !== null && v !== undefined;
      if (has(value) && !has(item.values[index - 1]) && !has(item.values[index + 1])) {
        const pointClass = item.className.includes('primary') ? 'point-primary' : 'point-black';
        svg += `<circle class="${pointClass}" r="5" cx="${x(index)}" cy="${y(value)}"></circle>`;
      }
    });
  });

  (options.events || []).forEach((event) => {
    const eventIndex = dates.indexOf(event.key);
    if (eventIndex < 0) return;
    const cx = x(eventIndex), ex = event.last ? x(Math.max(eventIndex, dates.indexOf(event.last))) : cx, by = margin.top - 6;
    svg += event.last
      ? `<path class="exp-event-range" d="M${cx},${by - 4}V${by + 4}M${cx},${by}H${ex}M${ex},${by - 4}V${by + 4}"></path>`
      : `<line class="exp-event-line ${event.className || ''}" x1="${cx}" y1="${margin.top}" x2="${cx}" y2="${margin.top + innerH}"></line>`;
    const lx = Math.max(margin.left + 44, Math.min((cx + ex) / 2, width - margin.right - 44));
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
      const label = esc(valueFormat(lastPrimary.values[li]));
      const lw = label.length * 7.5 + 16;
      const bx = Math.min(lx - lw / 2, width - margin.right - lw + 20), by = Math.max(2, ly - 36);
      svg += `<g class="last-value"><rect x="${bx}" y="${by}" width="${lw}" height="24" rx="12"></rect><text x="${bx + lw / 2}" y="${by + 16}" text-anchor="middle">${label}</text></g>`;
    }
  }

  svg += `<line class="hover-line" id="${container.id}-hover" x1="0" y1="${margin.top}" x2="0" y2="${margin.top+innerH}" visibility="hidden"></line>`;
  series.forEach((item, seriesIndex) => {
    svg += `<circle id="${container.id}-point-${seriesIndex}" class="${item.pointClass || (item.className.includes('primary') ? 'point-primary' : 'point-black')}" r="5" cx="0" cy="0" visibility="hidden"></circle>`;
  });
  svg += `<rect class="hit-area" x="${margin.left}" y="${margin.top}" width="${innerW}" height="${innerH}"></rect></svg>`;
  container.innerHTML = svg + `<p class="chart-readout" aria-live="polite" aria-atomic="true"></p><p class="chart-instruction" id="${container.id}-instruction">Точки: ← → · Home / End · Esc. На телефоне коснитесь графика.</p><details class="chart-data"><summary>Показать значения графика · ${dates.length} периодов</summary><div class="table-wrap" tabindex="0" aria-label="Таблица значений графика"><table><caption>${esc(container.getAttribute('aria-label') || 'Значения графика')}</caption><thead><tr><th scope="col">Период</th>${series.map((s) => `<th scope="col">${esc(s.name)}</th>`).join('')}</tr></thead><tbody></tbody></table></div></details>`;
  const dataDetails = container.querySelector('.chart-data');
  dataDetails.addEventListener('toggle', () => {
    const body = dataDetails.querySelector('tbody');
    if (dataDetails.open && !body.children.length) body.innerHTML = dates.map((date, i) => `<tr><th scope="row">${esc(formatDate(date))}</th>${series.map((s) => `<td>${s.values[i] === null || s.values[i] === undefined ? '—' : esc(seriesFormat(s, s.values[i]))}</td>`).join('')}</tr>`).join('');
  });
  container.setAttribute('role', 'group');
  const chartSvg = container.querySelector('svg');
  chartSvg.setAttribute('tabindex', '0');
  chartSvg.setAttribute('aria-hidden', 'false');
  chartSvg.setAttribute('role', 'img');
  chartSvg.setAttribute('aria-label', `${container.getAttribute('aria-label') || 'График'}. Стрелки влево и вправо выбирают период.`);
  const readout = container.querySelector('.chart-readout');
  const hit = container.querySelector('.hit-area');
  const hover = container.querySelector(`#${container.id}-hover`);
  const tooltip = $('#tooltip');
  chartSvg.setAttribute('aria-describedby', `${container.id}-instruction`);
  let selected = dates.indexOf(container.dataset.selectedDate);
  if (selected < 0) selected = dates.length - 1;
  const showPoint = (index, event) => {
    selected = index;
    container.dataset.selectedDate = dates[index];
    if (!event || event.pointerType === 'touch') tooltip.classList.remove('visible');
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
      if (item.hideNull && (value === null || value === undefined)) return;
      const swatchClass = item.swatch ? `tt-dot ${item.swatch}` : swatch;
      content += `<br><i class="${swatchClass}"></i>${esc(item.name)}: <b>${value === null || value === undefined ? '—' : seriesFormat(item, value)}</b>`;
    });
    if (options.tooltipExtra) content += options.tooltipExtra(index) || '';
    if (planSeries && factSeries) {
      const pv = planSeries.values[index], fv = factSeries.values[index];
      if (pv !== null && pv !== undefined && fv !== null && fv !== undefined) {
        const dv = fv - pv;
        content += `<br><span class="tt-delta ${dv >= 0 ? 'up' : 'down'}">Отклонение: ${dv >= 0 ? '+' : ''}${formatNumber(dv)}</span>`;
      }
    }
    const plain = document.createElement('div');
    plain.innerHTML = content.replace(/<br\s*\/?\s*>/g, ' · ');
    readout.textContent = plain.textContent;
    if (event && event.pointerType !== 'touch') {
      tooltip.innerHTML = content;
      tooltip.classList.add('visible');
      tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - 280, event.clientX + 16))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(event.clientY - 24, window.innerHeight - tooltip.offsetHeight - 8))}px`;
    }
  };
  const pointer = (event) => {
    const rect = chartSvg.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) * width / rect.width;
    showPoint(Math.max(0, Math.min(dates.length - 1, Math.round((svgX - margin.left) * (dates.length - 1) / innerW))), event);
  };
  hit.addEventListener('pointermove', pointer);
  hit.addEventListener('pointerdown', pointer);
  chartSvg.addEventListener('focus', () => showPoint(selected));
  chartSvg.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      tooltip.classList.remove('visible'); hover.setAttribute('visibility', 'hidden');
      series.forEach((_, i) => container.querySelector(`#${container.id}-point-${i}`).setAttribute('visibility', 'hidden'));
      return;
    }
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? dates.length - 1 : Math.max(0, Math.min(dates.length - 1, selected + (event.key === 'ArrowLeft' ? -1 : 1)));
    showPoint(index);
  });
  readout.textContent = `${formatDate(dates[selected])} · ${series.map((s) => `${s.name}: ${s.values[selected] === null || s.values[selected] === undefined ? '—' : seriesFormat(s, s.values[selected])}`).join(' · ')}`;
  if (hadFocus) chartSvg.focus({ preventScroll: true });
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
  $('#lead-summary-note').textContent = 'Только SEO-канал. План — за указанные дни. Если есть дни без плана, план за период, отклонение и выполнение не рассчитываются. Прогноз — оценка по среднему последних 7 полных дней, не обязательство.' + (spoMonth ? ` СПО: только ГВ; план на полный месяц — ${formatNumber(spoMonth.total)} лидов.` : '');
  body.innerHTML = '';
  const attention = [];
  state.data.leads.entities.forEach((entity) => {
    const idx = rangeIndexes(entity.dates, summaryStart, summaryEnd);
    const plan = sumComplete(idx.map((i) => entity.plan[i]));
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
function attentionHref(id) {
  const url = new URL(location.href);
  for (const [key, value] of [['view', 'leads'], ['lead', id], ['from', `${state.data.meta.asOf.slice(0, 7)}-01`], ['to', state.data.meta.asOf]]) url.searchParams.set(key, value);
  url.searchParams.delete('page');
  return url.href;
}
function renderLeadAttention(items, period) {
  const box = $('#lead-attention');
  if (!box) return;
  const planned = items.filter((item) => item.execution !== null && item.execution !== undefined);
  const lagging = planned.filter((item) => item.execution < 1).sort((a, b) => a.execution - b.execution);
  const onTrack = planned.length - lagging.length;
  const noPlan = items.length - planned.length;
  box.hidden = !items.length;
  box.innerHTML = `<div class="attention-head"><p class="attention-title">${!planned.length ? 'План на период не задан' : lagging.length ? 'Требует внимания' : 'Все проекты с планом в плане'}</p>`
    + `<p class="attention-note">Сводка за ${period}: ${planned.length ? `план выполняют ${onTrack} из ${planned.length}${noPlan ? ` · без полного плана: ${noPlan}` : ''}. Нажмите на проект, чтобы открыть его график.` : `нет плановых данных по ${items.length} ${items.length === 1 ? 'проекту' : 'проектам'}.`}</p></div>`
    + (lagging.length ? `<div class="attention-list">${lagging.map((item) => `<a class="attention-chip exec-${executionTier(item.execution)}" data-lead="${item.id}" href="${attentionHref(item.id)}"><span>${item.name}</span><b>${pctf.format(item.execution)}</b></a>`).join('')}</div>` : '');
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
  const requestedPeriod = [state.leadFrom, state.leadTo];
  [state.leadFrom, state.leadTo] = normalizedPeriod(entity.dates, state.leadFrom, state.leadTo);
  const normalized = requestedPeriod.some((value, i) => value && value !== [state.leadFrom, state.leadTo][i]);
  const periodNotice = $('#lead-period-status');
  if (normalized) {
    periodNotice.dataset.period = [state.leadFrom, state.leadTo].join('/');
    periodNotice.textContent = `Запрошенные даты вне доступного ряда или в обратном порядке. Показан доступный период: ${formatPeriod(state.leadFrom, state.leadTo)}.`;
  }
  periodNotice.hidden = periodNotice.dataset.period !== [state.leadFrom, state.leadTo].join('/');
  setDateInputs('lead', entity.dates, state.leadFrom, state.leadTo);
  $('#lead-granularity').value = state.leadGranularity;
  const idx = rangeIndexes(entity.dates, state.leadFrom, state.leadTo);
  const plan = sumComplete(idx.map((i) => entity.plan[i]));
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
    { name: 'План', values: entity.plan, className: 'line-black', requireComplete: true },
    { name: 'Факт', values: entity.fact, className: 'line-primary' },
  ], state.leadFrom, state.leadTo, state.leadGranularity);
  const factSpark = sparkline(chart.series[chart.series.length - 1].values);
  const period = formatPeriod(state.leadFrom, state.leadTo);
  const tier = executionTier(execution);
  $('#lead-kpis').innerHTML = group ? [
    kpi(`Факт за период: ${group.name}`, formatInt(groupFact), period, true, factSpark),
    kpi('Доля от проекта', share === null ? '—' : pctf.format(share), 'Факт группы к факту всего проекта', false, shareMeter(share)),
    kpi('План проекта за период', formatNumber(plan), plan === null ? 'План за период недоступен: есть дни без плана' : `${period} · страница плана не разделяет`),
    kpi('Выполнение к плану проекта', execution === null ? '—' : pctf.format(execution), plan === null ? 'Недоступно без плана на все дни периода' : 'Факт группы к плану всего проекта', false, executionMeter(execution, undefined, true)),
  ].join('') : [
    kpi('Факт за период', formatInt(fact), period, true, factSpark),
    kpi('План за период', formatNumber(plan), plan === null ? 'План за период недоступен: есть дни без плана' : period),
    kpi('Отклонение', formatNumber(deviation), plan === null ? 'Недоступно без плана' : 'Факт минус план', false, '', deviation === null ? '' : deviation >= 0 ? 'kpi-delta-up' : 'kpi-delta-down'),
    kpi('Выполнение', execution === null ? '—' : pctf.format(execution), plan === null ? 'Недоступно без плана' : 'Факт к плану', false, executionMeter(execution, tier), tier ? `kpi-tier-${tier}` : ''),
  ].join('');
  $('#lead-chart-title').textContent = `${entity.name}: ${group ? 'факт по страницам' : 'план и факт лидов'}`;
  $('#lead-chart-note').textContent = `${entity.scope} · ${period} · ${granularityLabel(state.leadGranularity)}${group ? ` · страницы: ${group.name} · план по страницам не детализирован и не показывается` : plan === null ? ' · есть дни без плана; сравнение за весь период недоступно' : ''}`;
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
  renderLineChart($('#lead-chart'), chart.dates, chart.series, { gap: !group, axisUnit: `Лиды · ${granularityLabel(state.leadGranularity)}` });
  renderLeadPages(entity, idx);
  if (blogGroupOf(entity) && state.blog === undefined) {
    ensureBlogData().then(() => { if (state.leadId === entity.id && state.view === 'leads') renderLeadBlog(entity); });
  }
  renderLeadBlog(entity);
}

// Доли лидов по типам страниц: только Skillfactory и Contented. Типы — официальный
// справочник модели (dim_urls-all[Тип страницы]); план по страницам не детализирован.
// Месяц считается по дням, попавшим в выбранный период: неполный месяц явно неполный.
function renderLeadPages(entity, periodIndexes) {
  const block = $('#lead-pages-block');
  if (!block) return;
  const supported = ['sf', 'cd'].includes(entity.id) && Array.isArray(entity.pageGroups) && entity.pageGroups.length > 0;
  block.hidden = !supported;
  if (!supported) return;
  const months = [], byMonth = new Map();
  for (const i of periodIndexes) {
    const month = entity.dates[i].slice(0, 7);
    if (!byMonth.has(month)) { byMonth.set(month, []); months.push(month); }
    byMonth.get(month).push(i);
  }
  $('#lead-pages-thead').innerHTML = '<tr><th scope="col">Тип страниц</th>'
    + months.map((month) => `<th scope="col">${monthNames[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}</th>`).join('')
    + '<th scope="col">За период</th></tr>';
  const cell = (part, total) => total > 0
    ? `<b>${pctf.format(part / total)}</b><span class="lead-pages-abs">${formatInt(part)} лид.</span>`
    : '<b>—</b>';
  const totals = months.map((month) => sum(byMonth.get(month).map((i) => entity.fact[i])));
  const periodTotal = sum(periodIndexes.map((i) => entity.fact[i]));
  const rows = entity.pageGroups.map((group) => {
    const parts = months.map((month) => sum(byMonth.get(month).map((i) => group.fact[i])));
    const period = sum(periodIndexes.map((i) => group.fact[i]));
    const cells = months.map((month, j) => `<td>${cell(parts[j], totals[j])}</td>`).join('');
    const active = state.leadPage === group.id ? ' class="lead-pages-active"' : '';
    return `<tr${active}><td>${group.name}</td>${cells}<td>${cell(period, periodTotal)}</td></tr>`;
  });
  rows.push(`<tr class="lead-pages-total"><td>Все страницы</td>`
    + months.map((month, j) => `<td>${cell(totals[j], totals[j])}</td>`).join('')
    + `<td>${cell(periodTotal, periodTotal)}</td></tr>`);
  $('#lead-pages-tbody').innerHTML = rows.join('');
  $('#lead-pages-note').textContent = `Доля типа страниц в лидах проекта за дни месяца, попавшие в выбранный период (${formatPeriod(state.leadFrom, state.leadTo)}); в ячейке — доля и число лидов. Факт — по справочнику типов страниц модели; план по страницам не детализирован.`;
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
  const requestedPeriod = [state.directionFrom, state.directionTo];
  [state.directionFrom, state.directionTo] = normalizedPeriod(dates, state.directionFrom, state.directionTo);
  const card = $('#direction-chart').closest('.direction-card');
  if (!card.id) card.id = 'direction-period-context';
  if (!card.querySelector('.normalized-period')) {
    const notice = document.createElement('p');
    notice.id = 'direction-period-status'; notice.className = 'period-status normalized-period';
    notice.hidden = true; notice.setAttribute('role', 'status');
    card.querySelector('.card-heading').before(notice);
  }
  notifyPeriod(card.id, requestedPeriod, [state.directionFrom, state.directionTo]);
  setDateInputs('direction', dates, state.directionFrom, state.directionTo);
  $('#direction-granularity').value = state.directionGranularity;
  const idx = rangeIndexes(dates, state.directionFrom, state.directionTo);
  const plan = sumComplete(idx.map((i) => direction.plan[i]));
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
  $('#direction-chart-note').textContent = `${direction.name} · ${period} · ${granularityLabel(state.directionGranularity)}${plan === null ? ' · есть дни без плана; сравнение за весь период недоступно' : ''}`;
  const chart = aggregateRange(dates, [
    { name: 'План', values: direction.plan, className: 'line-black', requireComplete: true },
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
    const plan = sumComplete(idx.map((i) => direction.plan[i]));
    const fact = sum(idx.map((i) => direction.fact[i]));
    return { name: direction.name, plan, fact, series: direction.fact };
  });
  const core = state.data.leads.entities.find((item) => item.id === 'core');
  // У части направлений нет плана: итог берём из плана проекта, а не суммы строк.
  const coreIdx = rangeIndexes(core.dates, state.directionFrom, state.directionTo);
  const totalPlan = sumComplete(coreIdx.map((i) => core.plan[i]));
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
  $('#direction-summary-note').textContent = `Все направления Skillbox core · SEO · ${period} · период берётся из фильтров графика направлений. Направления без полного плана — в конце таблицы. Если есть дни без плана, план за период, отклонение и выполнение не рассчитываются. Итоговый план — план проекта core. Прогноз — оценка на конец месяца по последним 7 полным дням.`;
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
    ? `спрос-фактор ×${nf.format(row.demandFactor)} — сезонность спроса ${fcShort(state.forecast.meta.months.next)}/${fcShort(state.forecast.meta.months.cur)} 2025` : '';
  const cover = total && row.demandCover
    ? ` · покрытие спросом: ${row.demandCover} ${row.demandCover === 9 ? 'направлений' : 'проект'} из ${row.name.includes('core') ? state.forecast.directions.length : state.forecast.projects.length}` : '';
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

let forecastRequest = null;
function ensureForecast(retry = false) {
  if (forecastRequest) return forecastRequest;
  if (!retry && state.forecast !== undefined) return Promise.resolve(state.forecast);
  const focusResult = retry && Boolean(document.activeElement?.closest('#forecast .section-availability'));
  state.forecast = undefined;
  if (state.view === 'forecast') renderForecast();
  forecastRequest = loadJSON('forecast.json')
    .then((data) => { state.forecast = data; return data; })
    .catch(() => { state.forecast = null; return null; })
    .finally(() => {
      forecastRequest = null;
      if (state.view === 'forecast' && document.getElementById('forecast')) {
        renderForecast();
        if (focusResult && document.activeElement === document.body) {
          const target = $('#forecast .section-availability:not([hidden]) button') || $('#forecast-heading');
          if (target && target.tagName !== 'BUTTON') target.setAttribute('tabindex', '-1');
          target?.focus({ preventScroll: true });
        }
      }
    });
  return forecastRequest;
}

function renderForecast() {
  const fc = state.forecast;
  if (!document.getElementById('forecast')) return;
  if (!fc) {
    sectionStatus('forecast', fc === undefined ? 'loading' : 'error', () => ensureForecast(true));
    return;
  }
  sectionStatus('forecast', 'ready');
  const meta = fc.meta;
  const months = meta.months || { m3: 'Сентябрь', m2: 'Октябрь', cur: 'Ноябрь', next: 'Декабрь' };
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('forecast-heading', `Прогноз лидов SEO на ${months.next.toLowerCase()}`);
  setText('forecast-eyebrow', `${months.next} ${meta.targetMonth?.slice(0, 4) || '2026'} · три сценария`);
  setText('forecast-projects-title', `Шесть проектов: итог ${fcGen(months.cur)} и прогноз ${fcGen(months.next)}`);
  setText('forecast-method-note', `Досчёт ${fcGen(months.cur)} и три прогноза ${fcGen(months.next)}; каждый сценарий сверяем с фактом отдельно.`);
  const factDays = Number(meta.currentFactDays ?? meta.asOf?.slice(8, 10));
  const veryEarly = meta.status !== 'awaiting-november' && meta.asOf?.slice(0, 7) === (meta.currentMonth || '2026-11') && factDays > 0 && factDays < 7;
  const warning = document.getElementById('forecast-warning');
  if (warning) {
    warning.hidden = !veryEarly;
    if (veryEarly) {
      const factCoverage = factDays === 1 ? 'Доступен только 1 день' : `Доступно только ${factDays} ${factDays < 5 ? 'дня' : 'дней'}`;
      setText('forecast-warning-text', `${factCoverage} факта ${fcGen(months.cur)} из ${meta.curDays || 30} дней. Прогноз ${fcGen(months.next)} предварительный, с высокой неопределённостью. Окно ставки последних 7 дней — ${formatDate(meta.curWindow[0])}–${formatDate(meta.curWindow[1])}.`);
    } else {
      setText('forecast-warning-text', '');
    }
  }
  if (meta.status === 'awaiting-november') {
    $('#forecast-kpis').textContent = meta.message;
    $('#forecast-projects-note').textContent = meta.message;
    $('#forecast-directions-note').textContent = 'Прогноз появится после обновления ноябрьского факта.';
    $('#forecast-projects').innerHTML = '';
    $('#forecast-directions').innerHTML = '';
    $('#forecast-method-list').innerHTML = '';
    return;
  }
  for (const headId of ['forecast-projects-head', 'forecast-directions-head']) {
    const head = document.getElementById(headId);
    if (!head) continue;
    const cells = head.querySelectorAll('th');
    const labels = forecastHeadMonths(months);
    cells.forEach((th, i) => { if (i >= 1 && i <= 9 && labels[i - 1]) th.textContent = labels[i - 1]; });
  }
  $('#forecast-kpis').innerHTML = [
    `<span class="mini-kpi">Итог ${fcGen(months.cur)}, 6 проектов <b>${formatInt(fc.total.curEom)}</b></span>`,
    `<span class="mini-kpi">${meta.curRemainingDays ? `Досчёт ${formatDate(meta.curRemainFrom)}–${formatDate(meta.curRemainTo)}` : `${months.cur}: месяц закрыт`} · ставка недели ${formatDate(meta.curWindow[0])}–${formatDate(meta.curWindow[1])} <b>+${formatInt(fc.total.curRemaining)}</b></span>`,
    `<span class="mini-kpi">${months.next} · сценарий «тренд» <b>${formatInt(fc.total.nextTrend)}</b></span>`,
    `<span class="mini-kpi">${months.next} · сценарий «сезонность» <b>${formatInt(fc.total.nextSeasonal)}</b></span>`,
    ...(fc.projects.find((p) => p.id === 'core')?.nextDemand != null
      ? [`<span class="mini-kpi">${months.next} · сценарий «спрос», только core <b>${formatInt(fc.projects.find((p) => p.id === 'core').nextDemand)}</b></span>`]
      : []),
  ].join('');
  $('#forecast-projects-note').textContent = (meta.partialMonthNote ? `${meta.partialMonthNote} ` : '') + `Факт по ${formatDate(meta.asOf)}; итог ${fcGen(months.cur)} = факт + ставка последних 7 дней × ${meta.curRemainingDays} дн. (${nf.format(meta.curTailFactor)} «средних» дня с учётом дней недели); ${months.next.toLowerCase()} — ${meta.nextDays} ${meta.nextDays === 31 ? 'календарный день' : 'календарных дней'} ≈ ${nf.format(meta.nextFactor)} «средних». Спрос-сценарий — только для core (файл спроса покрывает направления core); в таблице направлений — ${meta.demand.mappedDirections} строк из ${fc.directions.length}.` + (meta.dashboardAsOf && meta.dashboardAsOf !== meta.asOf ? ` Для прогноза отдельно обновили факт Power BI; основной срез остальных вкладок — ${formatDate(meta.dashboardAsOf)}.` : '');
  $('#forecast-directions-note').textContent = `${fc.directions.length} направлений горячей воронки core · факт по ${formatDate(meta.asOf)}. Сумма факта = Skillbox core; суммы прогнозов могут отличаться: каждую строку считаем отдельно.`;
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

// Ячейка «SEO к плану»: факт к базе за пересечение строки с выбранным периодом и плановыми днями.
function mediaPlanCell(sectionName, dates, seoValues, rowFrom, rowTo, start, end, scale = null) {
  if (state.mediaId !== 'skillbox-media' || !window.MediaPlan || !MediaPlan.ready()) return '<span class="plan-sub">—</span>';
  if (!MediaPlan.has(sectionName)) return '<span class="plan-sub">нет плана</span>';
  const from = rowFrom > start ? rowFrom : start, to = rowTo < end ? rowTo : end;
  const cmp = MediaPlan.compare(sectionName, dates, seoValues, from, to);
  if (!cmp) return '<span class="plan-sub">—</span>';
  return `<span class="plan-badge ${cmp.status.cls}" title="${cmp.status.label}: факт ${formatInt(cmp.fact)}, база ${formatInt(cmp.base)}, благоприятный ${formatInt(cmp.fav)} (${formatPeriod(cmp.from, cmp.to)})">${MediaPlan.signedPct(cmp.toBase)}</span>${MediaPlan.meter(cmp.fact, cmp.base, cmp.fav, true, scale)}`;
}

function mediaTableScale(body, comparisons) {
  const scale = window.MediaPlan?.comparisonScale(comparisons) ?? null;
  const id = `${body.id}-scale`;
  let caption = document.getElementById(id);
  if (!caption) {
    caption = document.createElement('p'); caption.id = id; caption.className = 'r3-table-scale';
    body.closest('.table-wrap').before(caption);
  }
  caption.hidden = scale === null;
  caption.textContent = scale === null ? '' : `Все мини-шкалы этой таблицы: 0…${formatInt(scale)} SEO-визитов. Максимум по факту, базе и благоприятному сценарию за плановые дни каждой строки. Чёрная риска — факт; границы коридора — база и благоприятный. Это не шкала SEO + Direct.`;
  return scale;
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
  const comparisons = state.mediaId === 'skillbox-media' && window.MediaPlan?.ready()
    ? [...groups.keys()].map((key) => MediaPlan.compare(state.mediaSection, dates, seoValues, `${key}-01` > start ? `${key}-01` : start, `${key}-31` < end ? `${key}-31` : end)) : [];
  const scale = mediaTableScale(body, comparisons);
  groups.forEach((values, key) => {
    const month = Number(key.slice(5, 7));
    const total = values.seo + values.direct;
    const row = document.createElement('tr');
    [monthNames[month - 1], formatInt(values.seo), formatInt(values.direct), total ? pctf.format(values.seo / total) : '—'].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    });
    const planCell = document.createElement('td');
    planCell.innerHTML = mediaPlanCell(state.mediaSection, dates, seoValues, `${key}-01`, `${key}-31`, start, end, scale);
    row.appendChild(planCell);
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
    name: section.name, seoSeries: section.seo,
    seo: sum(idx.map((i) => section.seo[i])),
    direct: sum(idx.map((i) => section.direct[i])),
  })).sort((a, b) => (b.seo + b.direct) - (a.seo + a.direct));
  const body = $('#editorial-summary'); body.innerHTML = '';
  const comparisons = window.MediaPlan?.ready() ? ranked.map((s) => MediaPlan.compare(s.name, project.dates, s.seoSeries, start, end)) : [];
  const scale = mediaTableScale(body, comparisons);
  ranked.forEach((section) => {
    const row = document.createElement('tr');
    [section.name, formatInt(section.seo), formatInt(section.direct)].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    });
    const planCell = document.createElement('td');
    planCell.innerHTML = mediaPlanCell(section.name, project.dates, section.seoSeries, start, end, start, end, scale);
    row.appendChild(planCell);
    body.appendChild(row);
  });
  $('#editorial-summary-note').textContent = `Итоги за ${formatPeriod(start, end)}, сортировка по SEO + Direct. «SEO к плану» — только дни периода с 01.10.2026, когда действует план.`;
}

function renderMedia() {
  const current = currentMediaSeries();
  const { project, label, seo, direct } = current;
  const requestedPeriod = [state.mediaFrom, state.mediaTo];
  [state.mediaFrom, state.mediaTo] = normalizedPeriod(project.dates, state.mediaFrom, state.mediaTo);
  notifyPeriod('media', requestedPeriod, [state.mediaFrom, state.mediaTo]);
  setDateInputs('media', project.dates, state.mediaFrom, state.mediaTo);
  $('#media-granularity').value = state.mediaGranularity;
  const idx = rangeIndexes(project.dates, state.mediaFrom, state.mediaTo);
  const seoTotal = sum(idx.map((i) => seo[i]));
  const directTotal = sum(idx.map((i) => direct[i]));
  const total = seoTotal + directTotal;
  const period = formatPeriod(state.mediaFrom, state.mediaTo);
  const planSeries = project.id === 'skillbox-media' && window.MediaPlan && MediaPlan.ready() ? MediaPlan.alignTo(project.dates, state.mediaSection) : null;
  const inPeriod = planSeries && idx.some((i) => planSeries.base[i] !== null);
  const chart = aggregateRange(project.dates, [
    { name: 'SEO', values: seo, className: 'line-primary' },
    { name: 'Прямой', values: direct, className: 'line-black' },
    ...(inPeriod ? [
      { name: 'План SEO: благоприятный', values: planSeries.favorable, className: 'line-plan-fav', swatch: 'fav', pointClass: 'point-fav', requireComplete: true, hideNull: true },
      { name: 'План SEO: база', values: planSeries.base, className: 'line-plan-base', swatch: 'base', requireComplete: true, hideNull: true },
    ] : []),
  ], state.mediaFrom, state.mediaTo, state.mediaGranularity);
  $('#media-kpis').innerHTML = [
    kpi('SEO-визиты', formatInt(seoTotal), period, true, sparkline(chart.series[0].values)),
    kpi('Прямые визиты', formatInt(directTotal), period, false, sparkline(chart.series[1].values)),
    kpi('SEO + Direct', formatInt(total), 'Всего в двух каналах'),
    kpi('Доля SEO', total ? pctf.format(seoTotal / total) : '—', 'В сумме SEO и Direct', false, total ? shareMeter(seoTotal / total) : ''),
  ].join('');
  const selectionLabel = project.id === 'skillbox-media' ? `${project.name} · ${label}` : project.name;
  $('#media-observation').innerHTML = `<span class="observation-label">Общая динамика · ${period}</span><h3>${selectionLabel}</h3><p>SEO и Direct показаны раздельно; сравнение с нормой доступно только за дни с планом. ${state.mediaGranularity === 'day' ? 'Пропуски не заменяются нулём.' : 'Крайние недели и месяцы могут быть неполными; план показываем только для полных корзин.'}</p>`;
  $('#media-chart-note').textContent = `${selectionLabel} · ${project.url} · ${period} · ${granularityLabel(state.mediaGranularity)}`;
  const chartOptions = { width: window.innerWidth < 640 ? 360 : 1200, axisUnit: 'Визиты' };
  if (inPeriod) {
    const [fav, base] = [chart.series[2].values, chart.series[3].values];
    chartOptions.band = { lower: base, upper: fav };
    chartOptions.tooltipExtra = (i) => {
      const st = MediaPlan.status(chart.series[0].values[i], base[i], fav[i]);
      return st ? `<br><span class="tt-plan ${st.cls}">${st.label} · ${MediaPlan.signedPct(chart.series[0].values[i] / base[i] - 1)} к базе</span>` : '';
    };
    $('#media-chart-note').textContent += ' · зелёная полоса — план SEO (база — благоприятный), неполные недели/месяцы без плана';
  }
  $('#media-plan-legend').hidden = !inPeriod;
  renderLineChart($('#media-chart'), chart.dates, chart.series, chartOptions);
  renderMediaMonthly(project.dates, seo, direct, state.mediaFrom, state.mediaTo);
  renderEditorialSummary(project, state.mediaFrom, state.mediaTo);
  if (window.MediaPlan) MediaPlan.render();
  const planJump = document.querySelector('[data-media-jump="media-plan-card"]');
  if (planJump) planJump.disabled = $('#media-plan-card').hidden;
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
    if (!$('#media-section').options.length) {
      const editors = projects.find((item) => item.id === 'skillbox-media')?.sections || [];
      populateSelect($('#media-section'), ['Все /media/', ...editors.map((item) => item.name)], state.mediaSection);
    }
  }
}

function loadUrlState() {
  const params = new URLSearchParams(location.search);
  const grains = ['day', 'week', 'month'];
  const context = (view) => {
    if (params.get('view') === view || (view === 'leads' && ['forecast', null].includes(params.get('view')))) return params;
    const saved = window.DashboardUrl?.readContext(params, view);
    return saved ? new URLSearchParams(Object.entries(saved).filter(([key, value]) => key !== '_filters' && value !== null)) : new URLSearchParams();
  };
  const leads = context('leads'), media = context('media');
  const dateParam = (source, name) => /^\d{4}-\d{2}-\d{2}$/.test(source.get(name) || '') ? source.get(name) : null;
  if (['leads', 'products-sf-cd', 'media', 'updates', 'updates-all', 'experiment', 'forecast'].includes(params.get('view'))) state.view = params.get('view');
  if (state.data.leads.entities.some((item) => item.id === leads.get('lead'))) state.leadId = leads.get('lead');
  if (leads.get('page')) {
    const entity = state.data.leads.entities.find((item) => item.id === state.leadId);
    if (entity && entity.pageGroups && entity.pageGroups.some((g) => g.id === leads.get('page'))) state.leadPage = leads.get('page');
  }
  if (state.data.leads.coreDirections.some((item) => item.name === leads.get('direction'))) state.direction = leads.get('direction');
  if (state.data.media.projects.some((item) => item.id === media.get('project'))) state.mediaId = media.get('project');
  if (media.get('section')) state.mediaSection = media.get('section');
  if (/^(2026-1[0-2]|q4)$/.test(media.get('plan') || '')) state.planPeriod = media.get('plan');
  if (['cum', 'day', 'week'].includes(media.get('planView'))) state.planView = media.get('planView');
  if (grains.includes(leads.get('grain'))) state.leadGranularity = leads.get('grain');
  if (grains.includes(media.get('grain'))) state.mediaGranularity = media.get('grain');
  state.leadFrom = dateParam(leads, 'from') || state.leadFrom;
  state.leadTo = dateParam(leads, 'to') || state.leadTo;
  state.mediaFrom = dateParam(media, 'from') || state.mediaFrom;
  state.mediaTo = dateParam(media, 'to') || state.mediaTo;
  if (grains.includes(leads.get('directionGrain'))) state.directionGranularity = leads.get('directionGrain');
  state.directionFrom = dateParam(leads, 'directionFrom') || state.directionFrom;
  state.directionTo = dateParam(leads, 'directionTo') || state.directionTo;
}

function updateUrl() {
  if (state.view === 'products-sf-cd') {
    if (window.updateProductsSfCdUrl) window.updateProductsSfCdUrl();
    else (window.DashboardUrl?.replace || history.replaceState.bind(history))(null, '', `${location.pathname}?view=products-sf-cd${location.hash}`);
    return;
  }
  if (state.view === 'updates-all') { if (window.updateUpdatesAllUrl) window.updateUpdatesAllUrl(); return; }
  if (state.view === 'updates') { if (window.updateUpdatesUrl) window.updateUpdatesUrl(); return; }
  if (state.view === 'experiment') { if (window.updateExperimentUrl) window.updateExperimentUrl(); return; }
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.view === 'media') {
    params.set('project', state.mediaId);
    if (state.mediaId === 'skillbox-media') params.set('section', state.mediaSection);
    params.set('grain', state.mediaGranularity);
    params.set('from', state.mediaFrom);
    params.set('to', state.mediaTo);
    if (state.planPeriod) params.set('plan', state.planPeriod);
    if (state.planView !== 'cum') params.set('planView', state.planView);
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
  (window.DashboardUrl?.replace || history.replaceState.bind(history))(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
}

function activateView(target, syncUrl = true) {
  if (syncUrl && target !== state.view) window.DashboardUrl?.navigate(target);
  state.view = target;
  if (state.data?.meta?.asOf) $('#as-of').textContent = `Данные по ${formatDate(state.data.meta.asOf)}`;
  const isMedia = ['media', 'updates', 'updates-all'].includes(target);
  const isLeads = ['leads', 'products-sf-cd'].includes(target);
  document.querySelectorAll('.section-tabs .tab-button').forEach((button) => {
    const active = button.dataset.target === (isMedia ? 'media' : isLeads ? 'leads' : target);
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('#leads-navigation').hidden = !isLeads;
  $('#media-navigation').hidden = !isMedia;
  document.querySelectorAll('.nested-tab').forEach((button) => {
    const active = button.dataset.target === target;
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
  else if (target === 'experiment') { if (window.renderExperiment) window.renderExperiment(); }
  else if (target === 'media') renderMedia();
  else if (target === 'forecast') renderForecast();
  else { renderLead(); renderDirection(); }
  if (syncUrl) updateUrl();
  window.Round3?.delta();
  window.DashboardUrl?.restore(target);
}

function setupTabs() {
  document.querySelectorAll('[data-media-jump]').forEach((button) => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.mediaJump);
    if (!target || target.hidden) return;
    target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }));
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
    if (window.MediaPlan) MediaPlan.setup();
    setupMediaControls(); setupTabs(); renderLeadSummary(); renderLead(); renderDirection(); renderMedia();
    if (window.MediaPlan) MediaPlan.load().finally(() => { if (state.view === 'media') { renderMedia(); updateUrl(); } });
    activateView(state.view, false);
    if (window.initExperiment) window.initExperiment();
    if (state.yoy === undefined) {
      loadJSON('yoy.json')
        .then((data) => { state.yoy = data; })
        .catch(() => { state.yoy = null; })
        .finally(() => { if (state.view === 'leads') { renderLeadSummary(); renderDirectionSummary(); } });
    }
    if (state.forecast === undefined) ensureForecast();
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
      if (!chip || event.ctrlKey || event.metaKey || event.shiftKey || event.button) return;
      event.preventDefault();
      // Drill down into the same monthly all-pages context as the attention summary.
      state.leadPage = 'all';
      state.leadFrom = `${state.data.meta.asOf.slice(0, 7)}-01`;
      state.leadTo = state.data.meta.asOf;
      const select = $('#lead-entity');
      select.value = chip.dataset.lead;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.closest('.chart-card').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    for (const type of ['pointerdown', 'focusin', 'contextmenu']) $('#lead-attention').addEventListener(type, (event) => { const chip = event.target.closest('a[data-lead]'); if (chip) chip.href = attentionHref(chip.dataset.lead); }, true);
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
      document.querySelector('main').innerHTML = '<div class="empty lock-screen" role="alert" aria-labelledby="lock-title" tabindex="-1"><h2 id="lock-title">Не удалось загрузить данные</h2><p>Обновите страницу. Если ошибка повторяется, сообщите владельцу отчёта. Данные не загружены; это не означает отсутствие ключа.</p><button type="button" class="observation-check">Обновить страницу</button></div>';
      document.querySelector('.lock-screen button').addEventListener('click', () => location.reload());
      document.querySelector('.ux-fresh-text')?.replaceChildren(document.createTextNode('Данные не загружены'));
      document.querySelector('.lock-screen').focus({ preventScroll: true });
    }
  } finally {
    document.querySelector('main')?.setAttribute('aria-busy', 'false');
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  $('#tooltip')?.classList.remove('visible');
  document.querySelectorAll('.chart .hover-line,.chart [id*="-point-"]').forEach((node) => node.setAttribute('visibility', 'hidden'));
});
document.addEventListener('DOMContentLoaded', init);
// Ключ дописали в адрес той же вкладки — единственный способ увидеть данные: перезагрузиться.
window.addEventListener('hashchange', () => { if (!state.data && location.hash.replace(/^#/, '').trim()) location.reload(); });
