/* C R3 · S2-A1 (A/R2), W02 (Wildcard/R3). Presentation and a separate additive derivative.
 * No loader, KPI model, storage, network or fragment ownership here. */
(() => {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const integer = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const value = (v) => num(v) ? integer.format(v) : '—';
  const signed = (v) => num(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${value(Math.abs(v))}` : '—';
  const iso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const date = (d) => iso(d) ? `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—';
  const period = (a, b) => a === b ? date(a) : `${date(a)}–${date(b)}`;
  const current = () => typeof state === 'undefined' ? null : state;

  function compareWindows(dates, values, asOf, kind = 'day') {
    const n = kind === 'week' ? 7 : 1;
    const eligible = Array.isArray(dates) && iso(asOf) ? dates.filter((d) => iso(d) && d <= asOf).sort() : [];
    const T = eligible.at(-1);
    if (!T) return { ok: false, reason: 'Нет данных', n, T: null, A: null, B: null, delta: null, percent: null };
    const aFrom = shift(T, 1 - n), bTo = shift(T, -n), bFrom = shift(T, 1 - 2 * n);
    const byDate = new Map(), duplicates = new Set();
    dates.forEach((d, i) => { if (byDate.has(d)) duplicates.add(d); byDate.set(d, values?.[i]); });
    const collect = (from) => {
      const days = Array.from({ length: n }, (_, i) => shift(from, i));
      const measured = days.filter((d) => byDate.has(d) && !duplicates.has(d) && num(byDate.get(d)));
      return { measured: measured.length, total: measured.length === n ? days.reduce((s, d) => s + byDate.get(d), 0) : null };
    };
    const a = collect(aFrom), b = collect(bFrom), ok = a.measured === n && b.measured === n;
    const delta = ok ? a.total - b.total : null;
    return { ok, reason: ok ? '' : eligible[0] > bFrom ? 'Недостаточно истории' : 'Недостаточно данных: пропуск, null или повтор даты',
      n, T, aFrom, aTo: T, bFrom, bTo, from: bFrom, to: T,
      A: a.total, B: b.total, aCount: a.measured, bCount: b.measured, delta,
      percent: ok && b.total > 0 ? delta / b.total * 100 : null };
  }

  function forecast(fc = current()?.forecast) {
    const box = document.getElementById('r3-forecast') || document.getElementById('forecast-scenarios');
    if (!box) return;
    box.classList.add('r3-forecast');
    const rows = fc?.meta?.status === 'awaiting-november' ? [] : fc?.projects || [];
    if (!rows.length) { box.replaceChildren(); box.hidden = true; return; }
    box.hidden = false;
    const m = fc.meta.months || {}, unit = 'лидов';
    box.innerHTML = `<h3>Сравнение факта, оценки и сценариев</h3><p>У каждого проекта своя шкала от нуля. Сравнивайте сценарии внутри проекта, не длины полос разных проектов. Значения округлены до целого только при показе.</p><div class="r3-fc-grid">${rows.map((p) => {
      const entries = [
        [m.m3 || 'История −2', p.m3, 'fact'], [m.m2 || 'История −1', p.m2, 'fact'],
        [`${m.cur || 'Текущий месяц'} · факт по ${date(fc.meta.asOf)}`, p.curFact, 'fact'],
        [`${m.cur || 'Текущий месяц'} · оценка итога`, p.curEom, 'estimate'],
        [`${m.next || 'Следующий месяц'} · тренд`, p.nextTrend, 'trend'],
        [`${m.next || 'Следующий месяц'} · сезонность`, p.nextSeasonal, 'season'],
        [`${m.next || 'Следующий месяц'} · спрос`, p.nextDemand, 'demand'],
      ];
      const hi = Math.max(1, Math.ceil(Math.max(0, ...entries.map((e) => e[1]).filter(num)) * 1.04));
      return `<article class="r3-fc-project"><h4>${esc(p.name)}</h4><p class="r3-fc-scale">Шкала проекта: 0…${value(hi)} ${unit}</p><dl>${entries.map(([label, v, style]) => `<div class="r3-fc-entry"><dt>${esc(label)}</dt><dd><span class="r3-fc-track" aria-hidden="true"><i class="r3-fc-bar r3-fc-${style}${v === 0 ? ' is-zero' : !num(v) ? ' is-missing' : ''}" style="width:${num(v) ? Math.max(0, v) / hi * 100 : 0}%"></i></span><span class="r3-fc-value">${num(v) ? value(v) : 'Нет данных'} <span>${num(v) ? unit : ''}</span></span></dd></div>`).join('')}</dl></article>`;
    }).join('')}</div>`;
  }

  const readOptions = () => {
    const p = new URLSearchParams(location.search);
    return { open: p.get('wc_panel') === 'delta', kind: p.get('wc_delta') === 'week' ? 'week' : 'day', metric: p.get('wc_metric') === 'media-seo' ? 'media-seo' : 'leads' };
  };
  function writeOptions(patch) {
    const old = readOptions(), next = { ...old, ...patch }, url = new URL(location.href);
    for (const key of ['wc_panel', 'wc_delta', 'wc_metric']) url.searchParams.delete(key);
    if (next.open) { url.searchParams.set('wc_panel', 'delta'); url.searchParams.set('wc_delta', next.kind); url.searchParams.set('wc_metric', next.metric); }
    (window.DashboardUrl?.replace || history.replaceState.bind(history))({ round3Global: true }, '', url.href);
    delta();
  }
  function rowHref(id, metric, result) {
    const view = metric === 'leads' ? 'leads' : 'media';
    const url = window.DashboardUrl?.viewUrl(view) || new URL(location.href);
    url.searchParams.set('view', view);
    url.searchParams.set('grain', 'day'); url.searchParams.set('from', result.from); url.searchParams.set('to', result.to);
    if (metric === 'leads') { url.searchParams.set('lead', id); url.searchParams.set('page', 'all'); }
    else { url.searchParams.set('project', id); url.searchParams.set('section', 'Все /media/'); }
    const o = readOptions();
    url.searchParams.set('wc_panel', 'delta'); url.searchParams.set('wc_delta', o.kind); url.searchParams.set('wc_metric', metric);
    url.hash = location.hash;
    return url.href;
  }
  function delta(data = current()?.data) {
    const root = document.getElementById('r3-delta');
    if (!root) return;
    const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset.r3Action : null;
    const methodOpen = root.querySelector('details')?.open || false;
    if (!data) { root.replaceChildren(); root.hidden = true; return; }
    root.hidden = false; root.classList.add('r3-delta');
    const { open, kind, metric } = readOptions();
    root.classList.toggle('is-open', open);
    const view = typeof state !== 'undefined' ? state.view : 'leads';
    const section = document.querySelector('.dashboard-section.active');
    const anchor = view === 'leads' ? section?.querySelector('.chart-card') : view === 'media' ? document.querySelector('#media .media-chart-card') : section?.querySelector('.section-heading')?.nextElementSibling;
    if (view !== 'media') { root.replaceChildren(); root.hidden = true; return; }
    if (anchor && anchor !== root && anchor.previousElementSibling !== root) anchor.before(root);
    root.innerHTML = `<button type="button" data-r3-action="toggle" aria-expanded="${open}" aria-controls="r3-delta-body">${open ? 'Закрыть последние изменения' : 'Последние изменения · день / 7 дней'}</button><section id="r3-delta-body" ${open ? '' : 'hidden'} aria-labelledby="r3-delta-title"></section>`;
    if (open) {
      const unit = metric === 'leads' ? 'лидов' : 'визитов';
      const rows = metric === 'leads' ? data.leads?.entities || [] : data.media?.projects || [];
      const body = root.querySelector('#r3-delta-body');
      body.innerHTML = `<h3 id="r3-delta-title">Производная · разница факта</h3><p>Только ${metric === 'leads' ? 'лиды всех страниц проекта' : 'проектные SEO-визиты'}. Последний день ряда не позже среза ${date(data.meta?.asOf)}; это не история обновлений файла.</p><div class="r3-switches"><div role="group" aria-label="Метрика">${[['leads', 'Лиды'], ['media-seo', 'SEO-визиты']].map(([key, label]) => `<button type="button" data-r3-action="metric-${key}" aria-pressed="${metric === key}">${label}</button>`).join('')}</div><div role="group" aria-label="Окно сравнения">${[['day', 'День'], ['week', '7 дней']].map(([key, label]) => `<button type="button" data-r3-action="kind-${key}" aria-pressed="${kind === key}">${label}</button>`).join('')}</div></div><p>А — последнее окно; Б — предыдущее равное окно. Единица: ${unit}. Разница не объясняет причину изменения.</p><div class="r3-delta-rows">${rows.length ? rows.map((row) => {
        const r = compareWindows(row.dates, metric === 'leads' ? row.fact : row.seo, data.meta?.asOf, kind);
        return `<article class="r3-delta-row" data-r3-id="${esc(row.id)}"><h4>${esc(row.name)}</h4><p class="r3-window-dates">${r.T ? `А: ${period(r.aFrom, r.aTo)}<br>Б: ${period(r.bFrom, r.bTo)}` : 'Периоды недоступны: нет дат ряда'}</p><dl><div><dt>А · ${unit}</dt><dd data-r3-value="A">${value(r.A)}</dd></div><div><dt>Б · ${unit}</dt><dd data-r3-value="B">${value(r.B)}</dd></div><div><dt>А − Б · ${unit}</dt><dd data-r3-value="delta">${signed(r.delta)}</dd></div><div><dt>К базе Б</dt><dd data-r3-value="percent">${r.ok && r.B > 0 ? `${r.percent > 0 ? '+' : r.percent < 0 ? '−' : ''}${decimal.format(Math.abs(r.percent))}%` : r.ok ? 'Процент не определён: Б = 0' : '—'}</dd></div></dl>${!r.ok ? `<p class="r3-incomplete">${esc(r.reason)}${r.T ? ` · А: ${r.aCount}/${r.n} дн., Б: ${r.bCount}/${r.n} дн.` : ''}. Неполное окно не суммируется.</p>` : ''}${r.T ? `<a data-r3-action="row-${esc(row.id)}" href="${esc(rowHref(row.id, metric, r))}">Проверить ряд · оба окна</a>` : ''}</article>`;
      }).join('') : '<p>Нет рядов для сравнения.</p>'}</div><details ${methodOpen ? 'open' : ''}><summary>Формула и полнота окон</summary><p>${kind === 'week' ? 'А = Σ X(T−6…T); Б = Σ X(T−13…T−7).' : 'А = X(T); Б = X(T−1).'} Разница = А − Б; процент = (А − Б) / Б × 100%, только при Б &gt; 0. T — последняя календарная дата ряда ≤ meta.asOf. Ноль — измерение, null, отсутствующая или повторная дата — недостаток данных, не ноль. Нет плана — сравниваем только факт. Источник: data.json; leads.entities[].fact или media.projects[].seo. Продуктовые BI-меры, Direct и редакции не суммируются.</p></details>`;
    }
    root.querySelectorAll('button[data-r3-action]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.r3Action;
      if (action === 'toggle') writeOptions({ open: !open });
      else if (action.startsWith('metric-')) writeOptions({ metric: action.slice(7) });
      else if (action.startsWith('kind-')) writeOptions({ kind: action.slice(5) });
    }));
    root.onkeydown = (e) => { if (e.key === 'Escape' && readOptions().open) { e.preventDefault(); writeOptions({ open: false }); root.querySelector('[data-r3-action="toggle"]')?.focus(); } };
    if (focusKey) root.querySelector(`[data-r3-action="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
  function clear() {
    for (const id of ['r3-delta', 'r3-forecast', 'forecast-scenarios']) {
      const box = document.getElementById(id); if (box) { box.replaceChildren(); box.hidden = true; }
    }
  }
  window.Round3 = { forecast, delta, clear, compareWindows };
  window.addEventListener('dashboardurlchange', () => delta());
  window.addEventListener('popstate', () => delta());
  window.addEventListener('hashchange', clear);
  document.addEventListener('DOMContentLoaded', () => { forecast(); delta(); });
})();
