/* Вкладка «Интеграции» (Лиды → Интеграции): блогерские интеграции месяца по курсам и школам и их эффект на SEO-лиды.
 * Данные — integrations.json (seo_gv_work/extract_integrations.py). Эффект считается по цепочкам интеграций одного курса:
 * ролики с разрывом до двух недель влияют на одни и те же недели, поэтому их приросты не складываются.
 */
(function () {
  'use strict';
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const SCHOOLS = { skillbox: 'Skillbox', sf: 'Skillfactory', cd: 'Contented' };
  const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const dm = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '—');
  const dmy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—');
  const signed = (v, digits = 0) => {
    if (v == null) return '—';
    const r = digits ? Math.round(v * 10) / 10 : Math.round(v);
    return `${r > 0 ? '+' : r < 0 ? '−' : ''}${(digits ? nf1 : nf).format(Math.abs(r))}`;
  };
  const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const blogger = (slug) => String(slug || '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  let data = null, pending = null, refs = null, selectedChain = null;
  // Параметры ссылки на момент загрузки: оболочка может переписать URL раньше, чем придут данные раздела.
  const initialParams = new URLSearchParams(location.search);

  function scaffold(section) {
    section.innerHTML = `
      <div class="section-heading"><div><p class="eyebrow">Блогерские интеграции</p><h2 id="integrations-heading">Интеграции</h2>
        <p class="in-intro" id="in-intro"></p></div></div>
      <div class="chart-filter-bar in-filters" aria-label="Фильтры интеграций">
        <div class="controls-row">
          <label class="select-control"><span>Месяц выхода</span><select id="in-month"></select></label>
          <label class="select-control"><span>Школа</span><select id="in-school"><option value="all">Все школы</option><option value="skillbox">Skillbox</option><option value="sf">Skillfactory</option><option value="cd">Contented</option></select></label>
        </div>
      </div>
      <div id="in-kpis" class="mini-kpis in-kpis" aria-live="polite"></div>
      <article class="chart-card">
        <div class="card-heading"><div><h3 id="in-list-title">Интеграции месяца</h3><p id="in-list-note"></p></div></div>
        <div class="table-wrap"><table class="in-table"><thead><tr><th scope="col">Выход</th><th scope="col">Курс и школа</th><th scope="col">Направление</th><th scope="col">Блогер</th><th scope="col">Визиты по UTM, 7 дней</th><th scope="col">SEO-лиды курса в неделю выхода</th></tr></thead><tbody id="in-list"></tbody></table></div>
      </article>
      <article class="chart-card">
        <div class="card-heading"><div><h3>Влияние на SEO по курсам</h3><p id="in-chains-note"></p></div></div>
        <div class="table-wrap"><table class="in-table in-chains"><thead><tr><th scope="col">Курс</th><th scope="col">Ролики</th><th scope="col">Неделя первого выхода</th><th scope="col">Всё окно цепочки</th><th scope="col">Лиды из рекламы</th><th scope="col">Органика на 100 рекламных</th><th scope="col">В прогнозе</th></tr></thead><tbody id="in-chains"></tbody></table></div>
      </article>
      <article class="chart-card" id="in-chart-card" hidden>
        <div class="card-heading"><div><h3 id="in-chart-title">SEO-лиды курса по неделям</h3><p id="in-chart-note"></p></div>
          <div class="legend"><span><i class="in-legend-bar"></i>SEO-лиды курса</span><span><i class="legend-line plan"></i>Обычный уровень</span><span><i class="in-legend-release"></i>Выход ролика</span></div></div>
        <div id="in-chart" class="in-chart" role="img"></div>
      </article>
      <article class="chart-card in-method"><div class="card-heading"><div><h3>Как считаем</h3><p id="in-sources"></p></div></div><ol id="in-method"></ol></article>`;
    refs = Object.fromEntries(['intro', 'month', 'school', 'kpis', 'list-title', 'list-note', 'list', 'chains-note', 'chains', 'chart-card', 'chart-title', 'chart-note', 'chart', 'sources', 'method']
      .map((id) => [id, document.getElementById(`in-${id}`)]));
  }

  const inMonth = (iso, ym) => iso && iso.slice(0, 7) === ym;
  const ev = () => Object.fromEntries(data.integrations.map((e) => [e.id, e]));

  function effectCell(effect, compact = false) {
    if (!effect) return '<span class="in-muted">ещё рано</span>';
    const cls = effect.significant ? 'in-up' : 'in-flat';
    const head = `<b class="${cls}">${signed(effect.uplift)}</b>`;
    const pct = effect.pct != null && Math.abs(effect.pct) < 1000 ? ` <span class="in-pct">${signed(effect.pct)} %</span>` : '';
    const detail = `${nf.format(effect.fact)} при обычных ${nf1.format(effect.base)}${compact ? '' : ` · шум ±${nf1.format(effect.noise)}`}`;
    return `${head}${pct}<span class="in-sub">${detail}</span>`;
  }

  function render() {
    const ym = refs.month.value, school = refs.school.value;
    const byId = ev();
    const items = data.integrations.filter((e) => inMonth(e.release, ym) && (school === 'all' || e.school === school));
    const chains = data.chains.filter((c) => (school === 'all' || c.school === school) && c.events.some((id) => inMonth(byId[id]?.release, ym)));
    const m = Number(ym.slice(5, 7)) - 1;
    const partial = data.meta.asOf.slice(0, 7) === ym;
    refs.intro.textContent = `Какие ролики блогеров вышли в ${MONTHS_PREP[m]} ${ym.slice(0, 4)}, для каких курсов и школ и как после них изменились SEO-лиды курса. Данные по ${dmy(data.meta.asOf)}${partial ? ', месяц ещё идёт' : ''}.`;
    const courses = new Set(items.map((e) => `${e.school}-${e.courseId}`));
    const noticeable = chains.filter((c) => c.seoWeek?.significant || c.seoWindow?.significant);
    // Прирост в недели выхода роликов месяца: каждая неделя курса учитывается один раз (ролики одной недели не складываем).
    const weeks = new Map();
    items.forEach((e) => { if (e.seoWeek) weeks.set(`${e.school}-${e.courseId}-${e.seoWeek.from}`, e.seoWeek.uplift); });
    const weekUp = [...weeks.values()].reduce((s, v) => s + v, 0);
    refs.kpis.innerHTML = [
      `<span class="mini-kpi">Интеграций <b>${nf.format(items.length)}</b></span>`,
      `<span class="mini-kpi">Курсов <b>${nf.format(courses.size)}</b></span>`,
      `<span class="mini-kpi">Заметный эффект на SEO <b>${nf.format(noticeable.length)} из ${nf.format(chains.length)}</b></span>`,
      `<span class="mini-kpi" title="Сумма приростов SEO-лидов курсов в недели выхода роликов месяца; неделя курса считается один раз">Прирост SEO-лидов курсов в недели выхода <b>${signed(weekUp)}</b></span>`,
    ].join('');
    refs['list-title'].textContent = `Интеграции: ${monthLabel(ym).toLowerCase()}`;
    refs['list-note'].textContent = 'Дата выхода — первый день с заметным трафиком по UTM-меткам ролика. Прирост недели выхода — к обычному уровню курса до начала цепочки роликов; зелёный — больше двух шумов. У второго и следующих роликов цепочки в прирост входит и хвост предыдущих.';
    refs.list.innerHTML = items.length ? items.map((e) => {
      const chain = e.chainId ? `<button type="button" class="in-link" data-chain="${esc(e.chainId)}">${effectCell(e.seoWeek, true)}</button>`
        : `<span class="in-muted">${esc(e.statusNote || 'без курса — эффект не считаем')}</span>`;
      const planned = e.plannedRelease && e.plannedRelease !== e.release ? `<span class="in-sub">в метке ${dm(e.plannedRelease)}</span>` : '';
      return `<tr><td>${dm(e.release)}${planned}</td><td>${esc(e.courseName)}<span class="in-sub">${esc(e.schoolName)} · ID ${esc(e.courseId)}</span></td><td>${esc(e.direction || '—')}</td>`
        + `<td>${esc(blogger(e.blogger))}<span class="in-sub">${esc(e.platforms.join(', '))}</span></td><td>${nf.format(e.utmVisits7d)}</td><td>${e.status === 'ok' || e.status === 'early' ? chain : `<span class="in-muted">${esc(e.statusNote || 'общая кампания без курса')}</span>`}</td></tr>`;
    }).join('') : `<tr><td colspan="6">В ${MONTHS_PREP[m]} интеграций с UTM-разметкой не найдено.</td></tr>`;
    refs['chains-note'].textContent = 'Цепочка — ролики одного курса с разрывом выходов до двух недель: их эффекты приходятся на одни и те же недели и не складываются. Обычный уровень — до недели первого выхода. Клик по строке покажет динамику курса.';
    refs.chains.innerHTML = chains.length ? chains.map((c) => {
      const list = c.events.map((id) => byId[id]).filter(Boolean);
      const name = list[0]?.courseName || c.courseId;
      const rolls = list.map((e) => `${esc(blogger(e.blogger))} · ${dm(e.release)}`).join('<br>');
      const win = c.seoWindow ? `${effectCell(c.seoWindow)}<span class="in-sub">${dm(c.seoWindow.from)}–${dm(c.seoWindow.to)}, ${c.seoWindow.weeks} нед.</span>` : '<span class="in-muted">ещё рано</span>';
      const ads = c.adsWeek ? `<b>${signed(c.adsWeek.uplift)}</b><span class="in-sub">неделя выхода${c.adsWindow ? ` · окно ${signed(c.adsWindow.uplift)}` : ''}</span>` : '—';
      const ratio = c.seoPer100Ads != null ? `<b>${nf.format(c.seoPer100Ads)}</b><span class="in-sub">неделя выхода${c.seoPer100AdsWindow != null ? ` · окно ${nf.format(c.seoPer100AdsWindow)}` : ''}</span>` : '<span class="in-muted">—</span>';
      const fc = c.applied ? `<b>−${nf.format(c.excessTotal)}</b><span class="in-sub">вычтено ${dm(c.window[0])}–${dm(c.window[1])}</span>` : `<span class="in-muted">${esc(c.reason || 'не трогаем')}</span>`;
      const active = selectedChain === c.id ? ' class="in-active"' : '';
      return `<tr${active} data-chain="${esc(c.id)}" tabindex="0"><td>${esc(name)}<span class="in-sub">${esc(SCHOOLS[c.school])}${c.direction ? ` · ${esc(c.direction)}` : ''}</span></td><td>${rolls}</td>`
        + `<td>${effectCell(c.seoWeek)}</td><td>${win}</td><td>${ads}</td><td>${ratio}</td><td>${fc}</td></tr>`;
    }).join('') : '<tr><td colspan="7">Нет курсов с интеграциями за выбранный месяц.</td></tr>';
    for (const body of [refs.list, refs.chains]) {
      const heads = [...body.closest('table').querySelectorAll('thead th')].map((th) => th.textContent);
      body.querySelectorAll('tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i] && td.colSpan === 1) td.dataset.label = heads[i]; }));
    }
    if (selectedChain && !chains.some((c) => c.id === selectedChain)) selectedChain = null;
    renderChart(chains.find((c) => c.id === selectedChain) || null, byId);
    updateUrl();
  }

  function renderChart(chain, byId) {
    refs['chart-card'].hidden = !chain;
    if (!chain || !chain.seoWeekly?.length) return;
    const list = chain.events.map((id) => byId[id]).filter(Boolean);
    refs['chart-title'].textContent = `SEO-лиды курса по неделям: ${list[0]?.courseName || chain.courseId}`;
    refs['chart-note'].textContent = `${SCHOOLS[chain.school]}. Обычный уровень — ${chain.baseWeek != null ? nf1.format(chain.baseWeek) : '—'} лидов в неделю до первого выхода (${dm(chain.window[0])}). Последняя неделя — полная по ${dmy(data.meta.asOf)}.`;
    const pts = chain.seoWeekly, w = Math.max(refs.chart.clientWidth || 800, 320), h = 280, pad = { l: 44, r: 12, t: 16, b: 34 };
    const max = Math.max(1, ...pts.map((p) => p.seo), chain.baseWeek || 0) * 1.12;
    const bw = (w - pad.l - pad.r) / pts.length;
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
    const ticks = [0, max / 2, max].map((v) => Math.round(v));
    let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" aria-label="${esc(refs['chart-title'].textContent)}">`;
    ticks.forEach((t) => { svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" class="in-grid"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end" class="in-axis">${nf.format(t)}</text>`; });
    const releases = new Set(list.map((e) => { const d = new Date(`${e.release}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }));
    pts.forEach((p, i) => {
      const x = pad.l + i * bw;
      if (releases.has(p.week)) svg += `<rect x="${x}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}" class="in-release"/>`;
      svg += `<rect x="${x + bw * 0.18}" y="${y(p.seo)}" width="${bw * 0.64}" height="${Math.max(0, y(0) - y(p.seo))}" rx="4" class="in-bar"><title>${dm(p.week)}: ${nf.format(p.seo)} лидов</title></rect>`;
      if (i % Math.ceil(pts.length / 8) === 0 || releases.has(p.week)) svg += `<text x="${x + bw / 2}" y="${h - 12}" text-anchor="middle" class="in-axis${releases.has(p.week) ? ' in-axis-strong' : ''}">${dm(p.week)}</text>`;
    });
    if (chain.baseWeek != null) svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(chain.baseWeek)}" y2="${y(chain.baseWeek)}" class="in-base"/>`;
    refs.chart.innerHTML = `${svg}</svg>`;
  }

  function updateUrl() {
    window.updateIntegrationsUrl();
  }
  window.updateIntegrationsUrl = function () {
    if (typeof state !== 'undefined' && state.view !== 'integrations') return;
    if (!refs) return; // до загрузки данных URL не трогаем: иначе потеряем выбор из ссылки
    const params = new URLSearchParams(location.search); params.set('view', 'integrations');
    if (refs) { params.set('in_month', refs.month.value); params.set('in_school', refs.school.value); }
    if (selectedChain) params.set('in_chain', selectedChain); else params.delete('in_chain');
    (window.DashboardUrl?.replace || history.replaceState.bind(history))(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  };

  function select(id) {
    selectedChain = selectedChain === id ? null : id;
    render();
    if (selectedChain) refs['chart-card'].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.ensureIntegrations = function () {
    if (data) { render(); return Promise.resolve(); }
    if (pending) return pending;
    const section = document.getElementById('integrations');
    if (!section || typeof window.loadJSON !== 'function') return Promise.resolve();
    section.setAttribute('aria-busy', 'true');
    pending = window.loadJSON('integrations.json', { softFail: true }).then((raw) => {
      if (!raw || raw.meta?.contractVersion !== 'integrations-v1' || !Array.isArray(raw.integrations)) throw new Error('BAD_DATA');
      data = raw; scaffold(section);
      const current = new URLSearchParams(location.search);
      const params = new URLSearchParams(initialParams);
      for (const key of ['in_month', 'in_school', 'in_chain']) if (current.has(key)) params.set(key, current.get(key));
      const months = [...data.meta.months].sort().reverse();
      refs.month.innerHTML = months.map((ym) => `<option value="${ym}">${monthLabel(ym)}</option>`).join('');
      refs.month.value = months.includes(params.get('in_month')) ? params.get('in_month') : (months.includes(data.meta.currentMonth) ? data.meta.currentMonth : months[0]);
      if (['all', 'skillbox', 'sf', 'cd'].includes(params.get('in_school'))) refs.school.value = params.get('in_school');
      selectedChain = data.chains.some((c) => c.id === params.get('in_chain')) ? params.get('in_chain') : null;
      refs.sources.textContent = Object.values(data.meta.sources).join(' · ');
      refs.method.innerHTML = data.meta.method.map((t) => `<li>${esc(t)}</li>`).join('')
        + '<li>Заметные цепочки вычитаются из рядов направления и проекта при расчёте ставки и тренда на вкладке прогноза; факт месяцев не меняется.</li>';
      refs.month.addEventListener('change', () => { selectedChain = null; render(); });
      refs.school.addEventListener('change', render);
      section.addEventListener('click', (event) => {
        const target = event.target.closest('[data-chain]');
        if (target && section.contains(target)) select(target.dataset.chain);
      });
      section.addEventListener('keydown', (event) => {
        const row = event.target.closest('tr[data-chain]');
        if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(row.dataset.chain); }
      });
      let frame; window.addEventListener('resize', () => { if (!refs.chart.isConnected || refs['chart-card'].hidden) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(render); });
      render();
    }).catch((error) => {
      const access = ['NO_KEY', 'BAD_KEY'].includes(error?.message);
      section.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Блогерские интеграции</p><h2 id="integrations-heading">Интеграции</h2></div></div>
        <div class="empty" role="status"><h3>${access ? 'Доступ к разделу не открыт' : 'Не удалось загрузить интеграции'}</h3><p>${access ? 'Проверьте полноту полученной ссылки.' : 'Файл раздела недоступен или не прошёл проверку. Другие разделы работают независимо.'}</p></div>`;
    }).finally(() => { pending = null; section.setAttribute('aria-busy', 'false'); });
    return pending;
  };
})();
