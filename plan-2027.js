/* План лидов SEO и DIRECT SF/CD на декабрь 2026 — декабрь 2027.
 * Данные: plan-2027.json(.enc), шифрование и ключ — как у основного дашборда (AES-256-GCM, ключ в #фрагменте). */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const KEY = location.hash.replace(/^#/, '').trim() || null;
  const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const MSHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const pf = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const df = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const mLabel = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
  const mShort = (m) => `${MSHORT[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
  const addMonths = (m, k) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + k, 1)).toISOString().slice(0, 7);
  const fmtDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const BRAND_NAME = { sf: 'Skillfactory', cd: 'Contented' };
  const CH_LABEL = { seo: 'SEO', direct: 'DIRECT', both: 'SEO + DIRECT' };
  const state = { brand: 'sf', feed: 0, channel: 'seo', from: '2025-01' };
  let D = null;

  ['#p27-home', '#p27-back', '#p27-forecast'].forEach((sel) => { const a = $(sel); if (a && location.hash) a.href = a.getAttribute('href') + location.hash; });

  // ---------- загрузка ----------
  function b64(text) {
    const pad = '='.repeat((4 - text.length % 4) % 4);
    const bin = atob((text + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function lock(msg) { $('#p27-main').innerHTML = `<div class="empty">${esc(msg)}</div>`; }
  async function load() {
    if (!KEY) { lock('План зашифрован. Откройте ссылку с ключом доступа (часть после символа «#»), как для основного дашборда.'); throw new Error('NO_KEY'); }
    const r = await fetch('plan-2027.json.enc', { cache: 'no-store' });
    if (r.status === 404) { const p = await fetch('plan-2027.json', { cache: 'no-store' }); if (!p.ok) throw new Error(p.status); return p.json(); }
    if (!r.ok) throw new Error(r.status);
    try {
      const raw = b64(await r.text());
      const key = await crypto.subtle.importKey('raw', b64(KEY), 'AES-GCM', false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) { lock('Не удалось расшифровать план: ключ неверен или данные повреждены.'); throw new Error('BAD_KEY'); }
  }

  // ---------- доступ к данным ----------
  const chansOf = (c) => (c === 'both' ? ['seo', 'direct'] : [c]);
  const FCM = () => D.brands.sf.channels.seo.forecast.map((r) => r.month);
  const M27 = () => FCM().filter((m) => m.startsWith('2027'));
  // kind: base | opt; feed: 0 | 1
  function fc(b, c, m, kind, feed) {
    return chansOf(c).reduce((s, ch) => { const r = D.brands[b].channels[ch].forecast.find((x) => x.month === m); return s + (r ? r[feed ? kind + 'Feed' : kind] : 0); }, 0);
  }
  const fcSum = (b, c, list, kind, feed) => list.reduce((a, m) => a + fc(b, c, m, kind, feed), 0);
  function feedFc(b, m) { const r = D.brands[b].channels.seo.forecast.find((x) => x.month === m); return r ? r.feed : 0; }
  function hist(b, c, m, field) {
    let s = 0, any = false;
    chansOf(c).forEach((ch) => { const r = D.brands[b].channels[ch].history.find((x) => x.month === m); if (r && r[field] !== null && r[field] !== undefined) { s += r[field]; any = true; } });
    return any ? s : null;
  }
  const novEst = (b, c) => chansOf(c).reduce((s, ch) => s + D.brands[b].channels[ch].novEst, 0);
  function yearAgo(b, c, m, feed) {
    const p = addMonths(m, -12);
    if (p === '2026-11') return { v: novEst(b, c), mark: 'nov' };
    if (p === '2026-12') return { v: fc(b, c, p, 'base', feed), mark: 'dec' };
    if (p === '2026-04' && c !== 'both') return { v: hist(b, c, p, 'corrected'), mark: 'apr' };
    return { v: hist(b, c, p, 'fact'), mark: '' };
  }
  const YA_NOTE = { nov: 'вкл. оценку ноя 26', dec: 'вкл. базу дек 26', apr: 'апр 26 с поправкой' };
  function total2026(b, c, feed = 1) {
    let s = 0;
    for (let k = 1; k <= 10; k++) { const m = `2026-${String(k).padStart(2, '0')}`; s += hist(b, c, m, 'corrected') || 0; if (!feed && c !== 'direct') s -= hist(b, 'seo', m, 'feed') || 0; }
    return s + novEst(b, c) + fc(b, c, '2026-12', 'base', feed);
  }
  const feed2026 = (b) => { let s = 0; for (let k = 1; k <= 11; k++) s += hist(b, 'seo', `2026-${String(k).padStart(2, '0')}`, 'feed') || 0; return s; };
  const delta = (a, b) => (b ? `<span class="${a >= b ? 'p27-up' : 'p27-down'}">${pf.format(a / b - 1)}</span>` : '—');

  // ---------- образцы легенды: тот же класс SVG, что у линий ----------
  const sw = {
    line: (cls, dot) => `<svg width="34" height="12" aria-hidden="true"><line x1="1" x2="33" y1="6" y2="6" class="${cls}"/>${dot ? `<circle cx="17" cy="6" r="3" class="${dot}"/>` : ''}</svg>`,
    band: () => '<svg width="34" height="12" aria-hidden="true"><rect x="1" y="1" width="32" height="10" rx="2" class="p27-band"/><line x1="1" x2="33" y1="1" y2="1" class="p27-s-opt" style="stroke-width:1.5"/><line x1="1" x2="33" y1="11" y2="11" class="p27-s-base" style="stroke-width:1.5"/></svg>',
    box: (color) => `<svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="3" fill="${color}"/></svg>`,
    vline: () => '<svg width="12" height="16" aria-hidden="true"><line x1="6" x2="6" y1="1" y2="15" class="p27-divider"/></svg>',
  };
  const legend = (items) => items.map(([svg, label]) => `<span>${svg}${esc(label)}</span>`).join('');

  // ---------- общий вывод и сводка ----------
  function renderSummary() {
    const sum = (b, c, kind, feed) => fcSum(b, c, M27(), kind, feed);
    const allS = (kind, feed) => sum('sf', 'seo', kind, feed) + sum('cd', 'seo', kind, feed);
    const allD = (kind) => sum('sf', 'direct', kind, 0) + sum('cd', 'direct', kind, 0);
    const s26 = total2026('sf', 'seo') + total2026('cd', 'seo'), d26 = total2026('sf', 'direct') + total2026('cd', 'direct');
    const sfS = sum('sf', 'seo', 'base', 0), cdS = sum('cd', 'seo', 'base', 0);
    const sfF = sum('sf', 'seo', 'base', 1), cdF = sum('cd', 'seo', 'base', 1);
    $('#p27-summary').innerHTML = `
      <p><b>База на 2027 год, SF + CD: ${nf.format(allS('base', 0))} SEO-лидов без фида (${nf.format(allS('base', 1))} с фидом) и ${nf.format(allD('base'))} лидов DIRECT.</b> К 2026 году (факт с фидом и оценкой ноября) SEO даёт ${pf.format(allS('base', 0) / s26 - 1)} без фида и ${pf.format(allS('base', 1) / s26 - 1)} с фидом, DIRECT ${pf.format(allD('base') / d26 - 1)}. Оптимистичный сценарий добавляет к базе +${nf.format(allS('opt', 0) - allS('base', 0))} SEO и +${nf.format(allD('opt') - allD('base'))} DIRECT за год, в основном во втором полугодии.</p>
      <p><b>Skillfactory SEO</b> весь 2026 год держится на одном уровне: 218–256 лидов в месяц без сезонности и без фида. База 2027 года — ${nf.format(sfS)} без фида и ${nf.format(sfF)} с фидом против ${nf.format(total2026('sf', 'seo'))} в 2026. <b>Contented SEO</b> падает весь 2026 год (без сезонности и фида — от 189–215 лидов в месяц в январе — феврале до 93–126 в августе — октябре). В базе падение затухает: ${nf.format(cdS)} без фида и ${nf.format(cdF)} с фидом против ${nf.format(total2026('cd', 'seo'))} в 2026. DIRECT ровный у Contented и подрастает у Skillfactory.</p>
      <p><b>yandex-feed</b> в 2026 году дал ${nf.format(feed2026('sf'))} SEO-лидов SF и ${nf.format(feed2026('cd'))} CD, а с 20.10.2026 почти исчез. Вернётся ли он, неизвестно, поэтому у каждого сценария есть две версии. Для Contented разница заметная: фид добавляет к SEO-плану ${pf.format(cdF / cdS - 1)}, для Skillfactory ${pf.format(sfF / sfS - 1)}. Рабочий план — версия без фида; версия с фидом — верхняя граница на случай, если поток восстановится.</p>
      <p>Спрос по Wordstat в тематиках SF и CD за январь — сентябрь 2026 года на 45–46% ниже, чем годом раньше, но внутри 2026 года почти не меняется, как и лиды SF. Поэтому Wordstat использован для сезонности, а уровень плана задаёт фактический ряд лидов. Планов Power BI на декабрь 2026 и 2027 год в модели пока нет (проверено 11.11.2026, факт по ${fmtDate(D.meta.asOf)}).</p>`;

    const row = (b, c, label) => {
      const isS = c !== 'direct';
      const v = (kind, feed) => fcSum(b, c, M27(), kind, feed);
      return `<tr data-brand="${b}" class="p27-click" tabindex="0" title="Открыть ${BRAND_NAME[b]}"><td>${esc(label)}</td><td class="num">${nf.format(total2026(b, c))}</td>
        <td class="num p27-sep"><b>${nf.format(v('base', 0))}</b></td><td class="num p27-opt">${nf.format(v('opt', 0))}</td><td class="num">${delta(v('base', 0), total2026(b, c))}</td>
        <td class="num p27-sep ${isS ? '' : 'p27-dim'}"><b>${nf.format(v('base', 1))}</b></td><td class="num p27-opt ${isS ? '' : 'p27-dim'}">${nf.format(v('opt', 1))}</td><td class="num">${delta(v('base', 1), total2026(b, c))}</td>
        <td class="num p27-sep">${nf.format(fc(b, c, '2026-12', 'base', 0))}</td></tr>`;
    };
    const brandRows = (b) => `<tr class="p27-brand"><td colspan="9">${BRAND_NAME[b]}</td></tr>${row(b, 'seo', 'SEO')}${row(b, 'direct', 'DIRECT')}${row(b, 'both', 'SEO + DIRECT')}`;
    $('#p27-overview').innerHTML = `<thead>
      <tr class="p27-group"><th></th><th></th><th colspan="3" class="p27-sep p27-g-off">2027 · без фида</th><th colspan="3" class="p27-sep p27-g-feed">2027 · с фидом</th><th class="p27-sep"></th></tr>
      <tr><th>Канал</th><th class="num">2026 (с фидом, оценка)</th><th class="num p27-sep">База</th><th class="num">Оптим.</th><th class="num">База к 2026</th><th class="num p27-sep">База</th><th class="num">Оптим.</th><th class="num">База к 2026</th><th class="num p27-sep">Дек 2026 · база без фида</th></tr></thead>
      <tbody>${brandRows('sf')}${brandRows('cd')}</tbody>`;
    $$('#p27-overview tr[data-brand]').forEach((tr) => {
      const go = () => { setBrand(tr.dataset.brand); $('#p27-switchbar').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }

  // ---------- блок проекта ----------
  function renderBrandHead() {
    const b = state.brand, B = D.brands[b];
    $('#p27-brand-title').textContent = BRAND_NAME[b];
    $('#p27-brand-scope').textContent = B.scope;
    const s27 = (kind, feed) => fcSum(b, 'seo', M27(), kind, feed);
    const d27 = (kind) => fcSum(b, 'direct', M27(), kind, 0);
    const card = (on, label, value, cap) => `<div class="kpi-card ${on ? 'primary' : ''}"><span class="kpi-label">${esc(label)}</span><div><div class="kpi-value">${nf.format(value)}</div><div class="kpi-caption">${cap}</div></div></div>`;
    $('#p27-kpis').innerHTML = [
      card(state.feed === 0, 'SEO 2027 · база · без фида', s27('base', 0), `оптимистичный ${nf.format(s27('opt', 0))} · к 2026 с фидом: ${pf.format(s27('base', 0) / total2026(b, 'seo') - 1)}`),
      card(state.feed === 1, 'SEO 2027 · база · с фидом', s27('base', 1), `оптимистичный ${nf.format(s27('opt', 1))} · фид +${nf.format(s27('base', 1) - s27('base', 0))}`),
      card(false, 'DIRECT 2027 · база', d27('base'), `оптимистичный ${nf.format(d27('opt'))} · к 2026: ${pf.format(d27('base') / total2026(b, 'direct') - 1)}`),
      card(false, `Декабрь 2026 · SEO + DIRECT · ${state.feed ? 'с фидом' : 'без фида'}`, fc(b, 'both', '2026-12', 'base', state.feed), `оптимистичный ${nf.format(fc(b, 'both', '2026-12', 'opt', state.feed))} · декабрь 2025: ${nf.format(hist(b, 'both', '2025-12', 'fact'))}`),
    ].join('');
    const lv = D.brands[b].channels.seo;
    $('#p27-switch-hint').textContent = `Без фида — поток yandex-feed не возвращается, как после 20.10.2026. С фидом — возвращается с декабря 2026 на средний уровень октября 2025 — сентября 2026: ${BRAND_NAME[b]} ≈ ${d1.format(lv.feedLevel)} SEO-лида в месяц без сезонности.`;
  }

  // ---------- таблицы ----------
  const tableData = {};
  function periods() {
    const months = FCM(), m27 = M27(), out = [[mLabel(months[0]), [months[0]], 'm']];
    [[0, 3, 'I квартал 2027'], [3, 6, 'II квартал 2027'], [6, 9, 'III квартал 2027'], [9, 12, 'IV квартал 2027']].forEach(([a, z, q]) => {
      m27.slice(a, z).forEach((m) => out.push([mLabel(m), [m], 'm']));
      out.push([q, m27.slice(a, z), 'q']);
    });
    out.push(['2027 год', m27, 'y'], ['13 месяцев', months, 't']);
    return out;
  }
  const ROWCLS = { m: '', q: 'p27-q', y: 'p27-y', t: 'p27-t' };
  function yaFor(b, c, list, feed) { return list.reduce((a, m) => { const y = yearAgo(b, c, m, feed); return { v: a.v + (y.v || 0), mark: a.mark || y.mark }; }, { v: 0, mark: '' }); }

  function renderSeoTable() {
    const b = state.brand, f = state.feed;
    const rows = periods().map(([label, list, kind]) => {
      const ya = yaFor(b, 'seo', list, f);
      return { label, kind, b0: fcSum(b, 'seo', list, 'base', 0), o0: fcSum(b, 'seo', list, 'opt', 0), b1: fcSum(b, 'seo', list, 'base', 1), o1: fcSum(b, 'seo', list, 'opt', 1), feed: list.reduce((a, m) => a + feedFc(b, m), 0), ya: ya.v, yaMark: ya.mark };
    });
    tableData.seo = rows;
    const a0 = f === 0 ? 'p27-active' : '', a1 = f === 1 ? 'p27-active' : '';
    $('#p27-seo-title').textContent = `${BRAND_NAME[b]} · SEO: план по месяцам`;
    $('#p27-seo-note').textContent = `Обе версии в одной таблице. Выбранная на панели («${f ? 'с фидом' : 'без фида'}») подсвечена, по ней считаются сравнения. «Год назад» — факт того же месяца с фидом; ноябрь 2026 — оценка по 1–10.11, декабрь 2026 — база.`;
    $('#p27-table-seo').innerHTML = `<thead>
      <tr class="p27-group"><th></th><th colspan="2" class="p27-sep p27-g-off">Без фида</th><th colspan="3" class="p27-sep p27-g-feed">С фидом</th><th colspan="3" class="p27-sep"></th></tr>
      <tr><th>Месяц</th><th class="num p27-sep ${a0}">База</th><th class="num ${a0}">Оптим.</th><th class="num p27-sep ${a1}">База</th><th class="num ${a1}">Оптим.</th><th class="num ${a1}">в т. ч. фид</th><th class="num p27-sep">Год назад</th><th class="num">База к году назад</th><th class="num">Оптим. к базе</th></tr></thead>
      <tbody>${rows.map((r) => {
        const base = f ? r.b1 : r.b0, opt = f ? r.o1 : r.o0;
        return `<tr class="${ROWCLS[r.kind]}"><td>${esc(r.label)}</td>
        <td class="num p27-sep ${a0}"><b>${nf.format(r.b0)}</b></td><td class="num p27-opt ${a0}">${nf.format(r.o0)}</td>
        <td class="num p27-sep ${a1}"><b>${nf.format(r.b1)}</b></td><td class="num p27-opt ${a1}">${nf.format(r.o1)}</td><td class="num p27-dim ${a1}">+${nf.format(r.feed)}</td>
        <td class="num p27-sep">${nf.format(r.ya)}${r.yaMark ? `<span class="p27-sub">${YA_NOTE[r.yaMark]}</span>` : ''}</td><td class="num">${delta(base, r.ya)}</td><td class="num">${pf.format(opt / base - 1)}</td></tr>`;
      }).join('')}</tbody>`;
  }

  function renderDirectTable() {
    const b = state.brand;
    const rows = periods().map(([label, list, kind]) => { const ya = yaFor(b, 'direct', list, 0); return { label, kind, b0: fcSum(b, 'direct', list, 'base', 0), o0: fcSum(b, 'direct', list, 'opt', 0), ya: ya.v, yaMark: ya.mark }; });
    tableData.direct = rows;
    $('#p27-direct-title').textContent = `${BRAND_NAME[b]} · DIRECT: план по месяцам`;
    $('#p27-table-direct').innerHTML = `<thead><tr><th>Месяц</th><th class="num">База</th><th class="num">Оптим.</th><th class="num p27-sep">Год назад</th><th class="num">База к году назад</th><th class="num">Оптим. к базе</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${ROWCLS[r.kind]}"><td>${esc(r.label)}</td><td class="num"><b>${nf.format(r.b0)}</b></td><td class="num p27-opt">${nf.format(r.o0)}</td><td class="num p27-sep">${nf.format(r.ya)}${r.yaMark ? `<span class="p27-sub">${YA_NOTE[r.yaMark]}</span>` : ''}</td><td class="num">${delta(r.b0, r.ya)}</td><td class="num">${pf.format(r.o0 / r.b0 - 1)}</td></tr>`).join('')}</tbody>`;
  }

  function renderHistoryTable() {
    const b = state.brand;
    const months = []; for (let m = '2025-01'; m <= '2026-11'; m = addMonths(m, 1)) months.push(m);
    const g = (v) => (v === null || v === undefined ? '—' : nf.format(v));
    tableData.history = months.map((m) => { const s = hist(b, 'seo', m, 'fact'), fd = hist(b, 'seo', m, 'feed'); return { m, s, fd, clean: s === null ? null : s - (fd || 0), sp: hist(b, 'seo', m, 'plan'), d: hist(b, 'direct', m, 'fact'), dp: hist(b, 'direct', m, 'plan') }; });
    $('#p27-hist-title').textContent = `${BRAND_NAME[b]}: факт и план Power BI для проверки`;
    $('#p27-table-history').innerHTML = `<thead><tr><th>Месяц</th><th class="num">SEO факт</th><th class="num">в т. ч. фид</th><th class="num">SEO без фида</th><th class="num">SEO план</th><th class="num p27-sep">DIRECT факт</th><th class="num">DIRECT план</th></tr></thead><tbody>${tableData.history.map((r) => `
      <tr><td>${esc(mLabel(r.m))}${r.m === '2026-11' ? '<span class="p27-sub">факт 1–10.11, план на месяц</span>' : ''}${r.m === '2026-04' ? '<span class="p27-sub">1–20.04 SEO учтён как DIRECT</span>' : ''}</td><td class="num"><b>${g(r.s)}</b></td><td class="num p27-dim">${g(r.fd)}</td><td class="num">${g(r.clean)}</td><td class="num">${g(r.sp)}</td><td class="num p27-sep"><b>${g(r.d)}</b></td><td class="num">${g(r.dp)}</td></tr>`).join('')}</tbody>`;
  }

  function renderWordstat() {
    const b = state.brand;
    const brandQ = b === 'sf' ? ['skillfactory', 'скилфактори'] : ['контентед'];
    const rows = D.wordstat.filter((r) => r.group === b || brandQ.includes(r.query) || r.group === 'market');
    const gl = { sf: 'Тематика', cd: 'Тематика', brand: 'Бренд', market: 'Рынок' };
    const total = (key) => rows.filter((r) => r.group === b).reduce((a, r) => a + r[key], 0);
    $('#p27-ws-title').textContent = `Спрос в тематике ${BRAND_NAME[b]}: Wordstat`;
    $('#p27-table-ws').innerHTML = `<thead><tr><th>Группа</th><th>Фраза</th><th class="num">янв–сен 2024</th><th class="num">янв–сен 2025</th><th class="num">янв–сен 2026</th><th class="num">2026 к 2025</th></tr></thead><tbody>
      <tr class="p27-y"><td>Тематика</td><td>сумма фраз тематики</td><td class="num">${nf.format(total('jan_sep_2024'))}</td><td class="num">${nf.format(total('jan_sep_2025'))}</td><td class="num">${nf.format(total('jan_sep_2026'))}</td><td class="num">${pf.format(total('jan_sep_2026') / total('jan_sep_2025') - 1)}</td></tr>
      ${rows.map((r) => `<tr><td>${esc(gl[r.group])}</td><td>${esc(r.query)}</td><td class="num">${nf.format(r.jan_sep_2024)}</td><td class="num">${nf.format(r.jan_sep_2025)}</td><td class="num">${nf.format(r.jan_sep_2026)}</td><td class="num">${r.jan_sep_2025 ? `<span class="${r.yoy >= 0 ? 'p27-up' : 'p27-down'}">${pf.format(r.yoy)}</span>` : 'новая фраза'}</td></tr>`).join('')}</tbody>`;
  }

  // ---------- графики ----------
  const tip = $('#p27-tooltip');
  function showTip(e, html) { tip.innerHTML = html; tip.classList.add('visible'); tip.style.left = `${Math.min(e.clientX + 16, innerWidth - 280)}px`; tip.style.top = `${e.clientY + 16}px`; }
  function hideTip() { tip.classList.remove('visible'); }
  function niceMax(v) { const raw = (v || 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) * 4; }
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

  function renderMainChart() {
    const b = state.brand, c = state.channel, f = state.feed, hasSeo = c !== 'direct';
    const fcm = FCM(), months = [];
    for (let m = state.from; m <= fcm[fcm.length - 1]; m = addMonths(m, 1)) months.push(m);
    const fact = months.map((m) => (m <= '2026-10' ? hist(b, c, m, 'fact') : null));
    const clean = months.map((m) => (hasSeo && !f && m <= '2026-10' && (hist(b, 'seo', m, 'feed') || 0) > 0 ? hist(b, c, m, 'fact') - hist(b, 'seo', m, 'feed') : null));
    const plan = months.map((m) => (m <= '2026-11' ? hist(b, c, m, 'plan') : null));
    const base = months.map((m) => (m === '2026-11' ? novEst(b, c) : m >= '2026-12' ? fc(b, c, m, 'base', f) : null));
    const opt = months.map((m) => (m === '2026-11' ? novEst(b, c) : m >= '2026-12' ? fc(b, c, m, 'opt', f) : null));
    const est = months.map((m) => (m === '2026-10' ? hist(b, c, m, 'fact') : m === '2026-11' ? novEst(b, c) : null));
    const maxV = niceMax(Math.max(...[...fact, ...plan, ...opt].filter((v) => v !== null)) * 1.05);
    const W = 1200, H = 420, L = 56, R = 18, T = 22, B = 44;
    const x = (i) => L + (W - L - R) * (months.length === 1 ? 0.5 : i / (months.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / maxV);
    const seg = (arr) => { const out = []; let cur = []; arr.forEach((v, i) => { if (v === null || v === undefined) { if (cur.length) out.push(cur); cur = []; } else cur.push([x(i), y(v)]); }); if (cur.length) out.push(cur); return out.map(path).join(''); };
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = maxV * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:#E2E2E2"/><text class="axis-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`; }
    const iDiv = months.indexOf('2026-12'), step = months.length > 30 ? 3 : months.length > 18 ? 2 : 1;
    months.forEach((m, i) => { const near = Math.abs(i - iDiv) < step && i !== iDiv; if ((i % step === 0 && !near) || i === iDiv) g += `<text class="axis-label" x="${x(i)}" y="${H - 18}" text-anchor="middle">${mShort(m)}</text>`; });
    if (iDiv > 0) { const xd = (x(iDiv) + x(iDiv - 1)) / 2; g += `<line class="p27-divider" x1="${xd}" x2="${xd}" y1="${T - 10}" y2="${H - B}"/><text class="p27-divider-label" x="${xd + 6}" y="${T}">план →</text><text class="p27-divider-label" x="${xd - 6}" y="${T}" text-anchor="end">← факт</text>`; }
    const top = opt.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean), bot = base.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean).reverse();
    if (top.length) g += `<path class="p27-band" d="${path([...top, ...bot])}Z"/>`;
    g += `<path class="p27-s-plan" d="${seg(plan)}"/>`;
    if (clean.some((v) => v !== null)) g += `<path class="p27-s-factclean" d="${seg(clean)}"/>`;
    g += `<path class="p27-s-fact" d="${seg(fact)}"/><path class="p27-s-est" d="${seg(est)}"/><path class="p27-s-base" d="${seg(base)}"/><path class="p27-s-opt" d="${seg(opt)}"/>`;
    fact.forEach((v, i) => { if (v !== null) g += `<circle class="p27-dot" cx="${x(i)}" cy="${y(v)}" r="2.8"/>`; });
    opt.forEach((v, i) => { if (v !== null && months[i] >= '2026-12') g += `<circle class="p27-dot-opt" cx="${x(i)}" cy="${y(v)}" r="2.8"/>`; });
    const colW = (W - L - R) / Math.max(1, months.length - 1);
    months.forEach((m, i) => { g += `<rect class="hit-area" data-i="${i}" x="${x(i) - colW / 2}" y="${T}" width="${colW}" height="${H - T - B}"/>`; });
    $('#p27-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
    $$('#p27-chart .hit-area').forEach((r) => {
      r.addEventListener('mousemove', (e) => {
        const i = +r.dataset.i, m = months[i], lines = [`<b>${esc(mLabel(m))}</b>`];
        if (fact[i] !== null) lines.push(`Факт: ${nf.format(fact[i])}`);
        if (clean[i] !== null) lines.push(`Факт без фида: ${nf.format(clean[i])}`);
        if (m === '2026-04' && c !== 'both') lines.push(`С поправкой атрибуции: ${nf.format(hist(b, c, m, 'corrected'))}`);
        if (m === '2026-11') lines.push(`Факт 1–10.11: ${nf.format(hist(b, c, m, 'fact'))}`, `Оценка месяца: ${nf.format(novEst(b, c))}`);
        if (plan[i] !== null) lines.push(`План Power BI: ${nf.format(plan[i])}`);
        if (m >= '2026-12') {
          lines.push(`База${hasSeo ? (f ? ' с фидом' : ' без фида') : ''}: ${nf.format(base[i])}`, `Оптимистичный: ${nf.format(opt[i])}`);
          if (hasSeo) lines.push(`${f ? 'Без фида' : 'С фидом'}: база ${nf.format(fc(b, c, m, 'base', 1 - f))}`);
          const ya = yearAgo(b, c, m, f); if (ya.v) lines.push(`Год назад: ${nf.format(ya.v)}${ya.mark ? ` (${YA_NOTE[ya.mark]})` : ''}`);
        }
        showTip(e, lines.join('<br>'));
      });
      r.addEventListener('mouseleave', hideTip);
    });
    const items = [[sw.line('p27-s-fact', 'p27-dot'), 'Факт Power BI']];
    if (clean.some((v) => v !== null)) items.push([sw.line('p27-s-factclean'), 'Факт без фида']);
    items.push([sw.line('p27-s-est'), 'Оценка ноября 2026 (факт 1–10.11 + досчёт)'], [sw.line('p27-s-plan'), 'План Power BI (заведён по ноябрь 2026)'], [sw.line('p27-s-base'), `База${hasSeo ? (f ? ' с фидом' : ' без фида') : ''}`], [sw.line('p27-s-opt', 'p27-dot-opt'), 'Оптимистичный'], [sw.band(), 'Коридор между сценариями'], [sw.vline(), 'Начало плана']);
    $('#p27-chart-legend').innerHTML = legend(items);
    $('#p27-chart-title').textContent = `${BRAND_NAME[b]} · ${CH_LABEL[c]}: факт и прогноз`;
    const s27 = (kind) => fcSum(b, c, M27(), kind, f);
    $('#p27-chart-note').textContent = `2027 год: база ${nf.format(s27('base'))}, оптимистичный ${nf.format(s27('opt'))}${hasSeo ? ` (${f ? 'с фидом' : 'без фида'})` : ''}. 2026 год с фидом и оценкой ноября: ${nf.format(total2026(b, c))}.`;
  }

  function renderUplift() {
    const b = state.brand, c = state.channel, months = FCM();
    const parts = [['pages', '#3D3BFF', 'Доработка страниц курсов и каталогов'], ['dups', '#968BAB', 'Дубли курсов'], ['sem', '#D8FF28', 'Расширение семантики']];
    const val = (m, p) => chansOf(c).reduce((s, ch) => s + D.brands[b].channels[ch].forecast.find((x) => x.month === m).levers[p], 0);
    const data = months.map((m) => parts.map(([p]) => val(m, p)));
    const maxV = niceMax(Math.max(1, ...data.map((d) => d.reduce((a, v) => a + v, 0))) * 1.05);
    const W = 600, H = 300, L = 44, R = 10, T = 12, B = 36, bw = (W - L - R) / months.length;
    const y = (v) => T + (H - T - B) * (1 - v / maxV);
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = maxV * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:#E2E2E2"/><text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`; }
    data.forEach((d, i) => {
      let acc = 0; const x0 = L + i * bw + bw * 0.18, w = bw * 0.64;
      parts.forEach(([, color], j) => { const h = (H - T - B) * d[j] / maxV; if (h > 0) g += `<rect x="${x0}" y="${y(acc + d[j])}" width="${w}" height="${h}" fill="${color}"/>`; acc += d[j]; });
      g += `<text class="axis-label" x="${x0 + w / 2}" y="${H - 14}" text-anchor="middle">${MSHORT[+months[i].slice(5) - 1]}</text>`;
      if (i === 0 || months[i].endsWith('-01')) g += `<text class="axis-label" x="${x0 + w / 2}" y="${H - 1}" text-anchor="middle" style="font-size:10px">${months[i].slice(0, 4)}</text>`;
      g += `<rect class="hit-area" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}"/>`;
    });
    $('#p27-uplift').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    $$('#p27-uplift .hit-area').forEach((r) => {
      r.addEventListener('mousemove', (e) => { const i = +r.dataset.i, d = data[i]; showTip(e, `<b>${esc(mLabel(months[i]))}</b><br>${parts.map(([, , l], j) => `${l}: +${d1.format(d[j])}`).join('<br>')}<br>Итого к базе: +${nf.format(fc(b, c, months[i], 'opt', 0) - fc(b, c, months[i], 'base', 0))}`); });
      r.addEventListener('mouseleave', hideTip);
    });
    $('#p27-uplift-legend').innerHTML = legend(parts.map(([, color, l]) => [sw.box(color), l]));
    $('#p27-uplift-note').textContent = `${BRAND_NAME[b]}, ${CH_LABEL[c]}: прирост к базе, лидов в месяц. За 2027 год +${nf.format(fcSum(b, c, M27(), 'opt', 0) - fcSum(b, c, M27(), 'base', 0))}. Фид от доработок не зависит и сюда не входит.${c === 'direct' ? ' На DIRECT действует только доработка страниц.' : ''}`;
  }

  function renderSeason() {
    const br = D.brands[state.brand];
    const series = [['seasonLeads', 'p27-s-leads', 'Лиды SEO + DIRECT, 04.2024 — 10.2026'], ['seasonWordstat', 'p27-s-ws', 'Wordstat тематики, 01.2024 — 09.2026'], ['season', 'p27-s-opt', 'Итоговый индекс (в плане)']];
    const vals = series.flatMap(([k]) => Object.values(br[k]));
    const lo = Math.floor(Math.min(...vals) * 10) / 10, hi = Math.ceil(Math.max(...vals) * 10) / 10;
    const W = 600, H = 300, L = 44, R = 10, T = 12, B = 36;
    const x = (i) => L + (W - L - R) * i / 11, y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += 0.1) { const one = Math.abs(v - 1) < 1e-6; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" ${one ? 'class="p27-s-one"' : 'style="stroke:#E2E2E2"'}/><text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${df.format(v)}</text>`; }
    MSHORT.forEach((m, i) => { g += `<text class="axis-label" x="${x(i)}" y="${H - 14}" text-anchor="middle">${m}</text>`; });
    series.forEach(([k, cls]) => { g += `<path class="${cls}" d="${path(MSHORT.map((_, i) => [x(i), y(br[k][String(i + 1)])]))}"/>`; });
    MSHORT.forEach((_, i) => { g += `<circle cx="${x(i)}" cy="${y(br.season[String(i + 1)])}" r="2.8" class="p27-dot-opt"/><rect class="hit-area" data-i="${i}" x="${x(i) - (W - L - R) / 22}" y="${T}" width="${(W - L - R) / 11}" height="${H - T - B}"/>`; });
    $('#p27-season').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    $$('#p27-season .hit-area').forEach((r) => {
      r.addEventListener('mousemove', (e) => { const k = String(+r.dataset.i + 1); showTip(e, `<b>${MONTHS[+k - 1]}</b><br>Лиды: ${df.format(br.seasonLeads[k])}<br>Wordstat: ${df.format(br.seasonWordstat[k])}<br>Итоговый: ${df.format(br.season[k])}`); });
      r.addEventListener('mouseleave', hideTip);
    });
    $('#p27-season-legend').innerHTML = legend([...series.map(([, cls, l]) => [sw.line(cls, cls === 'p27-s-opt' ? 'p27-dot-opt' : ''), l]), [sw.line('p27-s-one'), 'Средний месяц = 1,00']]);
    $('#p27-season-note').textContent = `${BRAND_NAME[state.brand]}: индекс месяца относительно среднего за год. Итоговый — среднее двух индексов; один для SEO и DIRECT.`;
  }

  // ---------- методика и источники ----------
  function renderMethod() {
    const sf = D.brands.sf, cd = D.brands.cd, ch = (b, c) => D.brands[b].channels[c];
    const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
    const items = [
      `<b>Факт.</b> Power BI, модель ${esc(D.meta.pbi.model)}. Мера ${esc(D.meta.pbi.measure)}. Фильтры: ${esc(D.meta.pbi.filters)}. Это те же определения, что во вкладке «План и факт» (скрипт <code>extract_leads_through.sh</code>). Период: ${esc(D.meta.pbi.period)}.`,
      `<b>Очистка ряда.</b> Из SEO вычтен поток yandex-feed (utm_source yandex-feed / ya-feed): база строится на органике без него. В апреле 2026 SEO-лиды 1–20.04 попадали в DIRECT, поэтому для модели сумма апреля разделена по долям марта и мая; в таблице факта значения оставлены как в Power BI.`,
      `<b>Сезонность.</b> Отношение к скользящей 12-месячной средней — по лидам SEO + DIRECT проекта и по сумме частот Wordstat тематики проекта; итоговый индекс — среднее двух. Декабрь: SF ${df.format(sf.season['12'])}, CD ${df.format(cd.season['12'])}; август: SF ${df.format(sf.season['8'])}, CD ${df.format(cd.season['8'])}.`,
      `<b>Стартовый уровень</b> (лидов в месяц без сезонности) = половина среднего за август — октябрь 2026 + половина оценки ноября. Оценка ноября = факт 1–10.11 × ${df.format(D.meta.novFullFactor)} / ${df.format(D.meta.novObservedFactor)} (профиль дней недели дашборда). Уровни: SF SEO ${nf.format(ch('sf', 'seo').level)}, SF DIRECT ${nf.format(ch('sf', 'direct').level)}, CD SEO ${nf.format(ch('cd', 'seo').level)}, CD DIRECT ${nf.format(ch('cd', 'direct').level)}.`,
      `<b>Тренд 2026 года.</b> Наклон логарифма ряда без сезонности за ноябрь 2025 — октябрь 2026: SF SEO ${pct(ch('sf', 'seo').slope)} в месяц, SF DIRECT ${pct(ch('sf', 'direct').slope)}, CD SEO ${pct(ch('cd', 'seo').slope)} (ограничен −4,0%), CD DIRECT ${pct(ch('cd', 'direct').slope)}. Тренд затухает с коэффициентом 0,8 в месяц: за горизонт плана накапливается не больше 3,8 месячного наклона.`,
      `<b>База</b> = уровень × затухающий тренд × индекс сезонности. Уже выкаченные доработки (17 страниц эксперимента «вайбкодинг», август — ноябрь 2026) входят в уровень.`,
      `<b>Версия «с фидом»</b> = версия «без фида» + фид-лиды SEO. Уровень фида без сезонности — среднее за октябрь 2025 — сентябрь 2026: SF ${d1.format(ch('sf', 'seo').feedLevel)}, CD ${d1.format(ch('cd', 'seo').feedLevel)} лида в месяц; умножается на индекс сезонности месяца, возврат — с декабря 2026. Если ориентироваться на июль — сентябрь 2026 (SF ${d1.format(ch('sf', 'seo').feedLevel3m)}, CD ${d1.format(ch('cd', 'seo').feedLevel3m)}), фид будет больше на 12–30%. К фиду рычаги оптимистичного сценария не применяются, на DIRECT фид не влияет.`,
      `<b>Оптимистичный сценарий</b> = база × рычаги с постепенным включением. (1) Доработка страниц курсов и каталогов: SEO +${pct(sf.levers.pages)}, DIRECT +${pct(sf.levers.direct_pages)}, полный эффект к июню 2027. Основание: у шести доработанных страниц «вайбкодинга» с окном после релиза от 20 дней SEO-визиты изменились от −10% до +41% (медиана +10%); рост лидов на них пока не подтверждён, поэтому +10% — верхняя граница видимого эффекта. (2) Дубли курсов: SF +${pct(sf.levers.dups)}, CD +${pct(cd.levers.dups)}, старт в марте 2027, полный эффект к декабрю 2027; расчёт — доля лидов со страниц курсов (SF 39%, CD 72%) × 15% дополнительного охвата. (3) Расширение семантики: SF +${pct(sf.levers.sem)}, CD +${pct(cd.levers.sem)}, старт в апреле 2027; расчёт — доля лидов с каталогов (SF 57%, CD 19%) × 10%. Проценты (2) и (3) — оценка.`,
      `<b>Округление.</b> Месяцы округлены до целых, итоги — суммы округлённых месяцев.`,
    ];
    $('#p27-method').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
    const risks = [
      'Фид. Неизвестно, вернётся ли yandex-feed и на каком уровне. Версия «с фидом» — верхняя граница, «без фида» — рабочий план. Если Яндекс урежет и обычные переходы из поиска, факт будет ниже базы без фида.',
      'Падение Contented SEO может не затухнуть. Если тренд −5,7% в месяц сохранится без затухания, CD SEO в 2027 году будет примерно на 25% ниже базы без фида (около 880 лидов вместо 1 180).',
      'Двойной учёт. Лиды школы Contented в горячей воронке SF входят и в SF, и в CD (так считает дашборд): в январе — октябре 2026 это 96 SEO-лидов и 44 DIRECT.',
      'Wordstat. Спрос по тематикам за январь — сентябрь 2026 ниже 2025 года: фразы SF −45%, фразы CD −46%, «онлайн курсы» −28%, брендовый «skillfactory» −69%. Частота Wordstat — это показы, в них есть доля роботов. Внутри 2026 года спрос и лиды SF без сезонности примерно стабильны, поэтому уровень плана по Wordstat не корректировался. Растёт только тема нейросетей.',
      'Факт последних дней «дозревает» в CRM (в октябре 2026 лиды SF/CD догружались с задержкой до 10 дней). Оценку ноября стоит пересчитать в начале декабря.',
      'В плане нет акций, изменения цен, новых продуктов вне SEO и работ над брендом.',
    ];
    $('#p27-risks').innerHTML = risks.map((t) => `<li>${esc(t)}</li>`).join('');
    const src = [
      ['Power BI, модель marketing_sales_growth_sf: лиды и план по месяцам, каналы SEO и Direct, горячие воронки SF и CD, лиды yandex-feed', 'выгрузка 11.11.2026', 'апрель 2024 — 10.11.2026', 'Внутренний источник; запросы DAX — в seo_plan_2027 на стенде'],
      ['Yandex Cloud Search API, Wordstat: динамика по 30 фразам, помесячно, вся Россия', 'выгрузка 11.11.2026', 'январь 2024 — сентябрь 2026', 'Внутренний доступ API'],
      ['Эксперимент «вайбкодинг» (experiment.json дашборда): SEO-визиты и лиды страниц до и после релиза', 'срез 10.11.2026', '01.06.2026 — 10.11.2026', 'Вкладка «Эксперимент: вайбкодинг»'],
      ['Доли лидов по типам страниц SF/CD (data.json)', 'срез 10.11.2026', '01.06.2026 — 10.11.2026', 'Вкладка «План и факт», таблица долей'],
      ['Разбор падения 20.10.2026: SEO и yandex-feed SF/CD', '05.11.2026', 'май — 04.11.2026', 'seo_sfcd_drop_202610/README-отчёт.md на стенде'],
      ['<a href="https://www.seonews.ru/events/vyruchka-top-100-edtech-kompaniy-vyrosla-na-12-do-119-mlrd-rub-za-9-mesyatsev-2026-goda/" target="_blank" rel="noopener">SEOnews: выручка топ-100 EdTech +12% за 9 месяцев 2026 (Smart Ranking)</a>', '05.11.2026', 'январь — сентябрь 2026', 'Рынок растёт в деньгах; у Яндекс Практикума студентов ИИ-программ +545%'],
      ['<a href="https://www.sostav.ru/blogs/286273/103997" target="_blank" rel="noopener">Sostav: Вордстат в 2026 году и ограничения частотности</a>', '26.08.2026', '—', 'Частота — показы, а не люди; есть доля роботов'],
    ];
    $('#p27-sources').innerHTML = `<thead><tr><th>Источник</th><th>Дата публикации / выгрузки</th><th>Период данных</th><th>Комментарий</th></tr></thead><tbody>${src.map((r) => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>`;
  }

  // ---------- CSV ----------
  function csv(name) {
    const b = state.brand; let head, lines;
    if (name === 'history') { head = ['Месяц', 'SEO факт', 'в т.ч. фид', 'SEO без фида', 'SEO план', 'DIRECT факт', 'DIRECT план']; lines = tableData.history.map((r) => [r.m, r.s, r.fd, r.clean, r.sp, r.d, r.dp]); }
    else if (name === 'seo') { head = ['Период', 'База без фида', 'Оптим. без фида', 'База с фидом', 'Оптим. с фидом', 'Фид', 'Год назад']; lines = tableData.seo.map((r) => [r.label, r.b0, r.o0, r.b1, r.o1, r.feed, r.ya]); }
    else { head = ['Период', 'База', 'Оптимистичный', 'Год назад']; lines = tableData.direct.map((r) => [r.label, r.b0, r.o0, r.ya]); }
    const body = [head, ...lines].map((row) => row.map((v) => (v === null || v === undefined ? '' : `"${String(typeof v === 'number' ? Math.round(v) : v).replace(/"/g, '""')}"`)).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = `plan_2027_${b}_${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- состояние ----------
  function readState() {
    const p = new URLSearchParams(location.search);
    if (['sf', 'cd'].includes(p.get('brand'))) state.brand = p.get('brand');
    if (['0', '1'].includes(p.get('feed'))) state.feed = +p.get('feed');
    if (['seo', 'direct', 'both'].includes(p.get('channel'))) state.channel = p.get('channel');
    if (['2024-04', '2025-01', '2026-01'].includes(p.get('from'))) state.from = p.get('from');
  }
  function writeState() { history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ brand: state.brand, feed: state.feed, channel: state.channel, from: state.from })}${location.hash}`); }
  function paintSegs() {
    const set = (sel, attr, val) => $$(`${sel} .p27-seg-btn`).forEach((btn) => { const on = btn.dataset[attr] === String(val); btn.classList.toggle('is-on', on); btn.setAttribute(btn.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-checked', on ? 'true' : 'false'); });
    set('#p27-brand-tabs', 'brand', state.brand); set('#p27-feed-tabs', 'feed', state.feed); set('#p27-channel-tabs', 'channel', state.channel);
    $('#p27-from').value = state.from;
  }
  function renderBrand() { paintSegs(); renderBrandHead(); renderMainChart(); renderSeoTable(); renderDirectTable(); renderUplift(); renderSeason(); renderHistoryTable(); renderWordstat(); writeState(); }
  function setBrand(b) { state.brand = b; renderBrand(); }

  load().then((data) => {
    D = data;
    $('#p27-asof').textContent = `Факт по ${fmtDate(D.meta.asOf)}`;
    $('#p27-generated').textContent = `Сборка ${D.meta.generatedAt.slice(0, 10).split('-').reverse().join('.')}`;
    readState();
    renderSummary(); renderMethod(); renderBrand();
    $$('#p27-brand-tabs .p27-seg-btn').forEach((btn) => btn.addEventListener('click', () => setBrand(btn.dataset.brand)));
    $$('#p27-feed-tabs .p27-seg-btn').forEach((btn) => btn.addEventListener('click', () => { state.feed = +btn.dataset.feed; renderBrand(); }));
    $$('#p27-channel-tabs .p27-seg-btn').forEach((btn) => btn.addEventListener('click', () => { state.channel = btn.dataset.channel; paintSegs(); renderMainChart(); renderUplift(); writeState(); }));
    $('#p27-from').addEventListener('change', (e) => { state.from = e.target.value; renderMainChart(); writeState(); });
    $$('[data-csv]').forEach((btn) => btn.addEventListener('click', () => csv(btn.dataset.csv)));
    window.addEventListener('resize', hideTip);
  }).catch((e) => { if (!['NO_KEY', 'BAD_KEY'].includes(e.message)) lock(`Не удалось загрузить план: ${e.message}`); });
  window.addEventListener('hashchange', () => location.reload());
})();
