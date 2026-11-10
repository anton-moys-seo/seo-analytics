/* План SEO-трафика Skillbox Media (октябрь–декабрь 2026): коридор «база — благоприятный сценарий».
   Данные — media-plan.json. Работает поверх глобальных хелперов и state из app.js.
   Норма — факт в коридоре между базой и благоприятным сценарием; цель — факт выше благоприятного. */
(function () {
  'use strict';
  const TOTAL = 'Все /media/';
  const plan = { data: null, failed: false };
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const STATUS = {
    top: { label: 'Выше благоприятного', short: 'Выше плана', cls: 'plan-top' },
    norm: { label: 'В коридоре нормы', short: 'Норма', cls: 'plan-norm' },
    low: { label: 'Ниже базы', short: 'Ниже базы', cls: 'plan-low' },
  };

  function status(fact, base, fav) {
    if (![fact, base, fav].every(Number.isFinite) || base <= 0) return null;
    const key = fact > fav ? 'top' : fact >= base ? 'norm' : 'low';
    return { key, ...STATUS[key] };
  }
  function signedPct(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${pctf.format(Math.abs(value))}`;
  }
  function signedInt(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatInt(Math.abs(value))}`;
  }
  function badge(fact, base, fav, short = true) {
    const st = status(fact, base, fav);
    if (!st) return '—';
    return `<span class="plan-badge ${st.cls}" title="${esc(st.label)}">${esc(short ? st.short : st.label)}</span>`;
  }
  // Положение факта: 0 % — база, 100 % — благоприятный сценарий.
  function corridorPosition(fact, base, fav) {
    return fav > base ? (fact - base) / (fav - base) : null;
  }
  function meter(fact, base, fav, compact = false) {
    if (![fact, base, fav].every(Number.isFinite) || base <= 0) return '';
    const lo = Math.min(base * 0.8, fact), hi = Math.max(fav * 1.15, fact);
    const pos = (v) => ((v - lo) / (hi - lo) * 100).toFixed(2);
    const st = status(fact, base, fav);
    return `<span class="plan-meter${compact ? ' compact' : ''}" aria-hidden="true">`
      + `<i class="pm-low" style="width:${pos(base)}%"></i>`
      + `<i class="pm-norm" style="left:${pos(base)}%;width:${(pos(fav) - pos(base)).toFixed(2)}%"></i>`
      + `<i class="pm-top" style="left:${pos(fav)}%;right:0"></i>`
      + `<b class="pm-mark ${st.cls}" style="left:${pos(fact)}%"></b></span>`;
  }

  function series(name) {
    return plan.data && plan.data.series[name] ? plan.data.series[name] : null;
  }
  // План, выровненный по датам факта (null вне плановых дней).
  function alignTo(dates, name) {
    const s = series(name);
    if (!s) return null;
    const pos = new Map(plan.data.dates.map((d, i) => [d, i]));
    const pick = (key) => dates.map((d) => (pos.has(d) ? s[key][pos.get(d)] : null));
    return { base: pick('base'), favorable: pick('favorable') };
  }
  function sumPlan(name, from, to, key) {
    const s = series(name);
    if (!s) return null;
    let total = 0;
    plan.data.dates.forEach((d, i) => { if (d >= from && d <= to) total += s[key][i]; });
    return total;
  }
  // Пересечение периода с плановыми днями, ограниченное последним днём факта.
  function planWindow(from, to, asOf) {
    const dates = plan.data.dates;
    const start = from > dates[0] ? from : dates[0];
    const end = [to, asOf, dates[dates.length - 1]].sort()[0];
    return start <= end ? { from: start, to: end } : null;
  }
  // Сравнение факта с планом за пересечение периода с плановыми днями (для таблиц вкладки).
  function compare(name, factDates, factValues, from, to) {
    if (!series(name)) return null;
    const win = planWindow(from, to, factDates[factDates.length - 1]);
    if (!win) return null;
    const fact = sum(factDates.map((d, i) => (d >= win.from && d <= win.to ? factValues[i] : 0)));
    const base = sumPlan(name, win.from, win.to, 'base');
    const fav = sumPlan(name, win.from, win.to, 'favorable');
    return { ...win, fact, base, fav, toBase: fact / base - 1, status: status(fact, base, fav) };
  }

  function periodBounds(key) {
    const dates = plan.data.dates;
    if (key === 'q4') return { from: dates[0], to: dates[dates.length - 1], label: 'IV квартал 2026' };
    const monthDates = dates.filter((d) => d.startsWith(key));
    return { from: monthDates[0], to: monthDates[monthDates.length - 1], label: `${monthNames[Number(key.slice(5)) - 1]} 2026` };
  }
  function defaultPeriod(asOf) {
    const month = asOf.slice(0, 7);
    return plan.data.meta.months.includes(month) ? month : asOf < plan.data.dates[0] ? plan.data.meta.months[0] : 'q4';
  }
  function factSeries(name) {
    const project = state.data.media.projects.find((p) => p.id === 'skillbox-media');
    if (name === TOTAL) return { dates: project.dates, values: project.seo };
    const section = project.sections.find((s) => s.name === name);
    return section ? { dates: project.dates, values: section.seo } : null;
  }

  // Итоги периода: факт по asOf, план на ту же дату и на весь период, прогноз по текущему темпу.
  function periodSummary(name, from, to) {
    const fs = factSeries(name);
    const asOf = state.data.meta.asOf;
    const fullBase = sumPlan(name, from, to, 'base'), fullFav = sumPlan(name, from, to, 'favorable');
    if (asOf < from) return { started: false, fullBase, fullFav };
    const end = asOf < to ? asOf : to;
    const fact = sum(fs.dates.map((d, i) => (d >= from && d <= end ? fs.values[i] : 0)));
    const base = sumPlan(name, from, end, 'base'), fav = sumPlan(name, from, end, 'favorable');
    const complete = end === to;
    // Темп относительно плана сохраняется до конца периода: факт × (план периода / план на дату).
    const projection = complete ? fact : fact * fullBase / base;
    const days = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 864e5) + 1;
    const totalDays = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 864e5) + 1;
    return { started: true, complete, end, fact, base, fav, fullBase, fullFav, projection, days, totalDays,
      status: status(fact, base, fav), projectionStatus: status(projection, fullBase, fullFav) };
  }

  function sectionOptions() {
    const project = state.data.media.projects.find((p) => p.id === 'skillbox-media');
    return [TOTAL, ...project.sections.map((s) => s.name)].filter((n) => series(n));
  }

  function renderStatus(name, period, summary) {
    const box = $('#plan-status');
    if (!summary.started) {
      box.className = 'plan-status plan-future';
      box.innerHTML = `<div><span class="plan-status-label">Период ещё не начался</span><p>План на ${esc(period.label.toLowerCase())}: база ${formatInt(summary.fullBase)}, благоприятный сценарий ${formatInt(summary.fullFav)} SEO-визитов.</p></div>`;
      return;
    }
    const st = summary.status;
    const toBase = summary.fact / summary.base - 1, toFav = summary.fact / summary.fav - 1;
    const span = `${formatDate(period.from).slice(0, 5)}–${formatDate(summary.end).slice(0, 5)}`;
    const gapText = st.key === 'low'
      ? `До базы не хватает ${formatInt(summary.base - summary.fact)} визитов.`
      : st.key === 'norm'
        ? `До благоприятного сценария осталось ${formatInt(summary.fav - summary.fact)} визитов.`
        : `Благоприятный сценарий превышен на ${formatInt(summary.fact - summary.fav)} визитов.`;
    box.className = `plan-status ${st.cls}`;
    box.innerHTML = `<div class="plan-status-main"><span class="plan-status-label">${esc(st.label)}</span>`
      + `<p><b>${esc(name)}</b> · ${span} · ${summary.days} из ${summary.totalDays} дн. Факт ${formatInt(summary.fact)}: ${signedPct(toBase)} к базе, ${signedPct(toFav)} к благоприятному. ${gapText}</p></div>`
      + `<div class="plan-status-meter">${meter(summary.fact, summary.base, summary.fav)}<div class="pm-legend"><span>База ${formatCompact(summary.base)}</span><span>Благоприятный ${formatCompact(summary.fav)}</span></div></div>`;
  }

  function renderKpis(period, summary) {
    const box = $('#plan-kpis');
    if (!summary.started) { box.innerHTML = ''; return; }
    const span = summary.complete ? 'за период' : `на ${formatDate(summary.end)}`;
    const pos = corridorPosition(summary.fact, summary.base, summary.fav);
    const ps = summary.projectionStatus;
    box.innerHTML = [
      kpi('Факт SEO-визитов', formatInt(summary.fact), `${formatPeriod(period.from, summary.end)}`, true),
      kpi('К базе', signedPct(summary.fact / summary.base - 1), `${signedInt(summary.fact - summary.base)} · база ${span}: ${formatInt(summary.base)}`, false, '', summary.fact >= summary.base ? 'plan-kpi-good' : 'plan-kpi-low'),
      kpi('К благоприятному', signedPct(summary.fact / summary.fav - 1), `${signedInt(summary.fact - summary.fav)} · благоприятный ${span}: ${formatInt(summary.fav)}`, false, '', summary.fact > summary.fav ? 'plan-kpi-top' : ''),
      summary.complete
        ? kpi('Позиция в коридоре', pos === null ? '—' : (pos < 0 ? '−' : '') + pctf.format(Math.abs(pos)), '0 % — база, 100 % — благоприятный')
        : kpi('Прогноз по текущему темпу', formatInt(summary.projection), `${ps ? ps.label.toLowerCase() : ''} · план периода ${formatInt(summary.fullBase)}–${formatInt(summary.fullFav)}`, false, '', ps ? `plan-kpi-${ps.key === 'top' ? 'top' : ps.key === 'norm' ? 'good' : 'low'}` : ''),
    ].join('');
  }

  function renderChart(name, period) {
    const fs = factSeries(name), s = series(name);
    const view = state.planView;
    const pdates = plan.data.dates.filter((d) => d >= period.from && d <= period.to);
    const idx = pdates.map((d) => plan.data.dates.indexOf(d));
    const factPos = new Map(fs.dates.map((d, i) => [d, i]));
    const factDaily = pdates.map((d) => (factPos.has(d) ? fs.values[factPos.get(d)] : null));
    let dates = pdates, base = idx.map((i) => s.base[i]), fav = idx.map((i) => s.favorable[i]), fact = factDaily;
    if (view === 'cum') {
      const cum = (arr) => { let acc = 0; return arr.map((v) => (v === null ? null : (acc += v))); };
      base = cum(base); fav = cum(fav); fact = cum(fact);
    } else if (view === 'week') {
      const agg = aggregateRange(pdates, [
        { values: base }, { values: fav }, { values: factDaily, requireComplete: true },
      ], period.from, period.to, 'week');
      dates = agg.dates; [base, fav, fact] = agg.series.map((x) => x.values);
    }
    const chartSeries = [
      { name: 'Благоприятный', values: fav, className: 'line-plan-fav', swatch: 'fav', pointClass: 'point-fav' },
      { name: 'База', values: base, className: 'line-plan-base', swatch: 'base' },
      { name: 'Факт', values: fact, className: 'line-primary', hideNull: true },
    ];
    renderLineChart($('#plan-chart'), dates, chartSeries, {
      width: window.innerWidth < 640 ? 360 : 1200,
      band: { lower: base, upper: fav },
      tooltipExtra: (i) => {
        const st = status(fact[i], base[i], fav[i]);
        return st ? `<br><span class="tt-plan ${st.cls}">${esc(st.label)} · ${signedPct(fact[i] / base[i] - 1)} к базе</span>` : '';
      },
    });
    const viewLabel = view === 'cum' ? 'накопленным итогом с начала периода' : view === 'week' ? 'по неделям (неполная неделя факта не показывается)' : 'по дням';
    $('#plan-chart-note').textContent = `${name} · ${period.label} · ${viewLabel}. Зелёная полоса — коридор нормы между базой и благоприятным сценарием.`;
  }

  function monthRows(name) {
    const rows = plan.data.meta.months.map((m) => ({ key: m, period: periodBounds(m) }));
    rows.push({ key: 'q4', period: periodBounds('q4'), total: true });
    return rows.map(({ key, period, total }) => {
      const sm = periodSummary(name, period.from, period.to);
      const active = key === state.planPeriod ? ' plan-row-active' : '';
      const cls = `${total ? 'direction-total' : ''}${active}`;
      if (!sm.started) {
        return `<tr class="${cls}" data-plan-period="${key}"><td>${esc(period.label)}</td><td>—</td><td>${formatInt(sm.fullBase)}</td><td>${formatInt(sm.fullFav)}</td><td>—</td><td>—</td><td><span class="plan-badge plan-future">Впереди</span></td><td>—</td></tr>`;
      }
      const partial = sm.complete ? '' : `<span class="plan-sub">из ${formatInt(sm.fullBase)}</span>`;
      const partialFav = sm.complete ? '' : `<span class="plan-sub">из ${formatInt(sm.fullFav)}</span>`;
      const label = sm.complete ? period.label : `${period.label}<span class="plan-sub">по ${formatDate(sm.end)}</span>`;
      const proj = sm.complete ? '<span class="plan-sub">период завершён</span>'
        : `${formatInt(sm.projection)} ${badge(sm.projection, sm.fullBase, sm.fullFav)}`;
      return `<tr class="${cls}" data-plan-period="${key}"><td>${label}</td><td>${formatInt(sm.fact)}</td>`
        + `<td>${formatInt(sm.base)}${partial}</td><td>${formatInt(sm.fav)}${partialFav}</td>`
        + `<td>${signedPct(sm.fact / sm.base - 1)}</td><td>${signedPct(sm.fact / sm.fav - 1)}</td>`
        + `<td>${badge(sm.fact, sm.base, sm.fav)}${meter(sm.fact, sm.base, sm.fav, true)}</td><td>${proj}</td></tr>`;
    }).join('');
  }

  function sectionRows(period) {
    const rows = sectionOptions().filter((n) => n !== TOTAL).map((name) => ({ name, sm: periodSummary(name, period.from, period.to) }))
      .filter((r) => r.sm.started);
    rows.sort((a, b) => (a.sm.fact / a.sm.base) - (b.sm.fact / b.sm.base));
    return rows.map(({ name, sm }) => `<tr class="plan-section-row${name === state.mediaSection ? ' plan-row-active' : ''}" data-plan-section="${esc(name)}" tabindex="0">`
      + `<td>${esc(name)}</td><td>${formatInt(sm.fact)}</td><td>${formatInt(sm.base)}</td><td>${formatInt(sm.fav)}</td>`
      + `<td>${signedPct(sm.fact / sm.base - 1)}</td><td>${badge(sm.fact, sm.base, sm.fav)}${meter(sm.fact, sm.base, sm.fav, true)}</td>`
      + `<td>${sm.complete ? '—' : `${formatInt(sm.projection)} ${badge(sm.projection, sm.fullBase, sm.fullFav)}`}</td></tr>`).join('');
  }

  function render() {
    const card = $('#media-plan-card');
    if (!card || !state.data) return;
    if (state.mediaId !== 'skillbox-media' || (!plan.data && !plan.failed)) { card.hidden = true; return; }
    card.hidden = false;
    if (!plan.data) {
      $('#plan-body').hidden = true;
      $('#plan-no-section').hidden = false;
      $('#plan-no-section').textContent = 'План SEO-трафика недоступен: файл media-plan.json не опубликован.';
      return;
    }
    if (!state.planPeriod || !(state.planPeriod === 'q4' || plan.data.meta.months.includes(state.planPeriod))) state.planPeriod = defaultPeriod(state.data.meta.asOf);
    if (!['cum', 'day', 'week'].includes(state.planView)) state.planView = 'cum';
    const options = sectionOptions();
    const select = $('#plan-section');
    populateSelect(select, options, options.includes(state.mediaSection) ? state.mediaSection : '');
    $('#plan-period').value = state.planPeriod;
    $('#plan-view').value = state.planView;
    const period = periodBounds(state.planPeriod);
    const noPlan = !series(state.mediaSection);
    $('#plan-no-section').hidden = !noPlan;
    $('#plan-body').hidden = noPlan;
    if (noPlan) {
      $('#plan-no-section').textContent = `Для редакции «${state.mediaSection}» в прогнозе нет отдельного плана (она входит в служебные вложенности). Выберите «${TOTAL}» или другую редакцию.`;
      select.value = '';
      return;
    }
    const name = state.mediaSection;
    const summary = periodSummary(name, period.from, period.to);
    renderStatus(name, period, summary);
    renderKpis(period, summary);
    renderChart(name, period);
    $('#plan-months').innerHTML = monthRows(name);
    $('#plan-months-note').textContent = `${name}. Для текущего месяца база и благоприятный сценарий — на дату последнего факта (${formatDate(state.data.meta.asOf)}), ниже — план всего месяца. Прогноз по текущему темпу = факт × план периода / план на дату.`;
    $('#plan-sections').innerHTML = sectionRows(period);
    $('#plan-sections-note').textContent = `${period.label}${summary.started && !summary.complete ? ` по ${formatDate(summary.end)}` : ''}. Сначала отстающие: сортировка по отношению факта к базе. Клик по строке — показать редакцию.`;
    $('#plan-method').textContent = `Прогноз от ${formatDate(plan.data.meta.forecastSlice)} (${plan.data.meta.source}). ${plan.data.meta.scenarios.base} ${plan.data.meta.scenarios.favorable} ${plan.data.meta.dailyAllocation} ${plan.data.meta.definition}`;
  }

  function setup() {
    $('#plan-section').addEventListener('change', (e) => {
      state.mediaSection = e.target.value;
      setupMediaControls(); renderMedia(); updateUrl();
    });
    $('#plan-period').addEventListener('change', (e) => { state.planPeriod = e.target.value; render(); updateUrl(); });
    $('#plan-view').addEventListener('change', (e) => { state.planView = e.target.value; render(); updateUrl(); });
    $('#plan-months').addEventListener('click', (e) => {
      const row = e.target.closest('[data-plan-period]');
      if (row) { state.planPeriod = row.dataset.planPeriod; render(); updateUrl(); }
    });
    const pickSection = (e) => {
      const row = e.target.closest('[data-plan-section]');
      if (!row) return;
      state.mediaSection = row.dataset.planSection;
      setupMediaControls(); renderMedia(); updateUrl();
    };
    $('#plan-sections').addEventListener('click', pickSection);
    $('#plan-sections').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSection(e); } });
  }

  async function load() {
    try {
      plan.data = await window.loadJSON('media-plan.json', { softFail: true });
    } catch (error) {
      plan.failed = true;
    }
    return plan.data;
  }

  window.MediaPlan = {
    load, setup, render, alignTo, compare, status, badge, meter, signedPct,
    has: (name) => Boolean(series(name)),
    ready: () => Boolean(plan.data),
  };
})();
