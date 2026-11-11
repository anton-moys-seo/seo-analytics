/* План лидов SEO и DIRECT SF/CD на декабрь 2026 — декабрь 2027.
 * Данные: plan-2027.json(.enc), шифрование и ключ — как у основного дашборда (AES-256-GCM, ключ в #фрагменте). */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const KEY = location.hash.replace(/^#/, '').trim() || null;
  const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const MSHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const pf = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const df = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const mLabel = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
  const mShort = (m) => `${MSHORT[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
  const addMonths = (m, k) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + k, 1)); return d.toISOString().slice(0, 7); };
  const fmtDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const BRANDS = ['sf', 'cd'];
  const CH = ['seo', 'direct'];
  const CH_LABEL = { seo: 'SEO', direct: 'DIRECT', both: 'SEO + DIRECT' };
  let D = null;

  // ---------- навигация: ключ из # переносим в ссылки на дашборд ----------
  ['#p27-home', '#p27-back', '#p27-forecast'].forEach((sel) => { const a = $(sel); if (a && location.hash) a.href = a.getAttribute('href') + location.hash; });

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
  const brandsOf = (b) => (b === 'all' ? BRANDS : [b]);
  const chansOf = (c) => (c === 'both' ? CH : [c]);
  function fc(b, c, m, kind) { // kind: base | opt
    let s = 0;
    brandsOf(b).forEach((br) => chansOf(c).forEach((ch) => { const r = D.brands[br].channels[ch].forecast.find((x) => x.month === m); s += r ? r[kind] : 0; }));
    return s;
  }
  function hist(b, c, m, field) {
    let s = 0, any = false;
    brandsOf(b).forEach((br) => chansOf(c).forEach((ch) => { const r = D.brands[br].channels[ch].history.find((x) => x.month === m); if (r && r[field] !== null && r[field] !== undefined) { s += r[field]; any = true; } }));
    return any ? s : null;
  }
  function novEst(b, c) { let s = 0; brandsOf(b).forEach((br) => chansOf(c).forEach((ch) => { s += D.brands[br].channels[ch].novEst; })); return s; }
  const FC_MONTHS = () => D.brands.sf.channels.seo.forecast.map((r) => r.month);
  function yearAgo(b, c, m) { // факт того же месяца годом раньше; ноябрь 2026 — оценка, декабрь 2026 — база
    const p = addMonths(m, -12);
    if (p === '2026-11') return { v: novEst(b, c), mark: '*' };
    if (p === '2026-12') return { v: fc(b, c, p, 'base'), mark: '**' };
    if (p === '2026-04' && c !== 'both') return { v: hist(b, c, p, 'corrected'), mark: '***' };
    return { v: hist(b, c, p, 'fact'), mark: '' };
  }
  function total2026(b, c) { // факт янв–окт + оценка ноября + база декабря
    let s = 0; for (let k = 1; k <= 10; k++) s += hist(b, c, `2026-${String(k).padStart(2, '0')}`, 'corrected') || 0;
    return s + novEst(b, c) + fc(b, c, '2026-12', 'base');
  }
  function sumYear(b, c, y, field) { let s = 0; for (let k = 1; k <= 12; k++) s += hist(b, c, `${y}-${String(k).padStart(2, '0')}`, field) || 0; return s; }
  const sum27 = (b, c, kind) => FC_MONTHS().filter((m) => m.startsWith('2027')).reduce((a, m) => a + fc(b, c, m, kind), 0);
  const sum13 = (b, c, kind) => FC_MONTHS().reduce((a, m) => a + fc(b, c, m, kind), 0);
  const feed2026 = (b) => { let s = 0; for (let k = 1; k <= 11; k++) s += hist(b, 'seo', `2026-${String(k).padStart(2, '0')}`, 'feed') || 0; return s; };

  // ---------- вывод и KPI ----------
  function renderSummary() {
    const asOf = fmtDate(D.meta.asOf);
    const s27b = sum27('all', 'seo', 'base'), s27o = sum27('all', 'seo', 'opt'), d27b = sum27('all', 'direct', 'base'), d27o = sum27('all', 'direct', 'opt');
    const s26 = total2026('all', 'seo'), d26 = total2026('all', 'direct');
    const sfS = sum27('sf', 'seo', 'base'), cdS = sum27('cd', 'seo', 'base'), sfS26 = total2026('sf', 'seo'), cdS26 = total2026('cd', 'seo');
    const sfD = sum27('sf', 'direct', 'base'), sfD26 = total2026('sf', 'direct'), cdD = sum27('cd', 'direct', 'base'), cdD26 = total2026('cd', 'direct');
    const f26 = feed2026('all');
    $('#p27-summary').innerHTML = `
      <p><b>База на 2027 год: ${nf.format(s27b)} SEO-лидов и ${nf.format(d27b)} лидов DIRECT</b> (SF + CD). Это ${pf.format(s27b / s26 - 1)} и ${pf.format(d27b / d26 - 1)} к 2026 году (факт января — октября, оценка ноября по 1–10.11 и база декабря). <b>Оптимистичный сценарий: ${nf.format(s27o)} SEO и ${nf.format(d27o)} DIRECT</b>, то есть +${nf.format(s27o - s27b)} и +${nf.format(d27o - d27b)} лида к базе за год. Почти весь прирост приходится на SEO и набирается ко второму полугодию.</p>
      <p>По проектам картина разная. <b>Skillfactory SEO</b> в 2026 году держится на ровной полке: без сезонности и без yandex-feed ряд стоит на 218–256 лидах в месяц с ноября 2025. База 2027 года (${nf.format(sfS)}) на ${pf.format(sfS / sfS26 - 1)} ниже 2026 (${nf.format(sfS26)}), а без feed, который в 2026 году дал SF ${nf.format(feed2026('sf'))} лидов, разница ${pf.format(sfS / (sfS26 - feed2026('sf')) - 1)}. <b>Contented SEO</b> снижается весь 2026 год: без сезонности и feed — от 189–215 лидов в месяц в январе — феврале до 93–126 в августе — октябре. В базе падение затухает, но 2027 год всё равно ниже: ${nf.format(cdS)} против ${nf.format(cdS26)} (${pf.format(cdS / cdS26 - 1)}; без feed ${pf.format(cdS / (cdS26 - feed2026('cd')) - 1)}). DIRECT стабилен у Contented (${nf.format(cdD)} против ${nf.format(cdD26)}) и подрастает у Skillfactory вслед за ростом в августе — октябре 2026 (${nf.format(sfD)} против ${nf.format(sfD26)}).</p>
      <p>В 2026 году ${nf.format(f26)} SEO-лидов дал поток yandex-feed. С 20.10.2026 он практически исчез, поэтому в базу не заложен. Если поток вернётся на уровень июля — сентября 2026, он добавит 55–65 SEO-лидов в месяц (SF + CD) сверх обоих сценариев. Спрос по Wordstat и SEO-лиды упали в 2025 году: за январь — сентябрь 2026 фразы тематик SF дали на 45% меньше показов, чем годом раньше, фразы CD — на 46% меньше. Внутри 2026 года спрос без сезонности почти не меняется (фразы SF: 83–92 тыс. показов в январе — феврале, 99 тыс. в сентябре), так же ведут себя лиды SF. Поэтому повторного падения в базу не закладываем, а Wordstat используем для сезонности.</p>
      <p>Для сравнения: исходный план Power BI на ноябрь 2026 — ${nf.format(hist('all', 'seo', '2026-11', 'plan'))} SEO и ${nf.format(hist('all', 'direct', '2026-11', 'plan'))} DIRECT, оценка ноября по текущему темпу — ${nf.format(novEst('all', 'seo'))} и ${nf.format(novEst('all', 'direct'))}. Планы на декабрь 2026 и 2027 год в модели Power BI пока не заведены (проверено 11.11.2026, факт по ${asOf}).</p>`;
    const k = [
      { cls: 'primary', label: 'SEO 2027 · база', value: s27b, cap: `оптимистичный: ${nf.format(s27o)} (+${nf.format(s27o - s27b)})` },
      { label: 'DIRECT 2027 · база', value: d27b, cap: `оптимистичный: ${nf.format(d27o)} (+${nf.format(d27o - d27b)})` },
      { label: 'Декабрь 2026 · SEO + DIRECT', value: fc('all', 'both', '2026-12', 'base'), cap: `оптимистичный: ${nf.format(fc('all', 'both', '2026-12', 'opt'))}; декабрь 2025: ${nf.format(hist('all', 'both', '2025-12', 'fact'))}` },
      { label: '13 месяцев · SEO + DIRECT', value: sum13('all', 'both', 'base'), cap: `оптимистичный: ${nf.format(sum13('all', 'both', 'opt'))}` },
    ];
    $('#p27-kpis').innerHTML = k.map((x) => `<div class="kpi-card ${x.cls || ''}"><span class="kpi-label">${esc(x.label)}</span><div><div class="kpi-value">${nf.format(x.value)}</div><div class="kpi-caption">${esc(x.cap)}</div></div></div>`).join('');
  }

  // ---------- таблицы прогноза ----------
  const tableData = {};
  function renderForecastTable(ch) {
    const months = FC_MONTHS();
    const rows = [];
    const cols = (label, getter, cls) => ({ label, getter, cls });
    const mk = (label, list, kind) => {
      const v = (b, s) => list.reduce((a, m) => a + fc(b, ch, m, s), 0);
      const ya = list.reduce((a, m) => { const y = yearAgo('all', ch, m); return { v: a.v + (y.v || 0), mark: a.mark || y.mark }; }, { v: 0, mark: '' });
      return { label, kind, sfB: v('sf', 'base'), sfO: v('sf', 'opt'), cdB: v('cd', 'base'), cdO: v('cd', 'opt'), allB: v('all', 'base'), allO: v('all', 'opt'), ya: ya.v, yaMark: ya.mark };
    };
    rows.push(mk(mLabel(months[0]), [months[0]], 'm'));
    const m27 = months.filter((m) => m.startsWith('2027'));
    [[0, 3, 'I квартал 2027'], [3, 6, 'II квартал 2027'], [6, 9, 'III квартал 2027'], [9, 12, 'IV квартал 2027']].forEach(([a, z, q]) => {
      m27.slice(a, z).forEach((m) => rows.push(mk(mLabel(m), [m], 'm')));
      rows.push(mk(q, m27.slice(a, z), 'q'));
    });
    rows.push(mk('2027 год', m27, 'y'));
    rows.push(mk('13 месяцев (дек 2026 — дек 2027)', months, 't'));
    tableData[ch] = rows;
    const dlt = (a, b) => (b ? `<span class="${a >= b ? 'p27-up' : 'p27-down'}">${pf.format(a / b - 1)}</span>` : '—');
    const cls = { m: '', q: 'p27-q', y: 'p27-y', t: 'p27-t' };
    $(`#p27-table-${ch}`).innerHTML = `<thead><tr><th>Месяц</th><th class="num">SF · база</th><th class="num">SF · оптим.</th><th class="num">CD · база</th><th class="num">CD · оптим.</th><th class="num">Итого · база</th><th class="num">Итого · оптим.</th><th class="num">Год назад</th><th class="num">База к году назад</th><th class="num">Оптим. к базе</th></tr></thead><tbody>${rows.map((r) => `
      <tr class="${cls[r.kind]}"><td>${esc(r.label)}</td><td class="num">${nf.format(r.sfB)}</td><td class="num p27-opt">${nf.format(r.sfO)}</td><td class="num">${nf.format(r.cdB)}</td><td class="num p27-opt">${nf.format(r.cdO)}</td><td class="num"><b>${nf.format(r.allB)}</b></td><td class="num p27-opt"><b>${nf.format(r.allO)}</b></td><td class="num">${nf.format(r.ya)}${r.yaMark ? `<span class="p27-sub">${{ '*': 'вкл. оценку ноя 26', '**': 'вкл. базу дек 26', '***': 'апр 26 с поправкой' }[r.yaMark]}</span>` : ''}</td><td class="num">${dlt(r.allB, r.ya)}</td><td class="num">${pf.format(r.allO / r.allB - 1)}</td></tr>`).join('')}</tbody>`;
  }

  function renderHistoryTable() {
    const months = []; for (let m = '2025-01'; m <= '2026-11'; m = addMonths(m, 1)) months.push(m);
    const g = (b, c, m, f) => { const v = hist(b, c, m, f); return v === null ? '—' : nf.format(v); };
    tableData.history = months.map((m) => ({ m, sfS: hist('sf', 'seo', m, 'fact'), sfF: hist('sf', 'seo', m, 'feed'), sfSP: hist('sf', 'seo', m, 'plan'), sfD: hist('sf', 'direct', m, 'fact'), sfDP: hist('sf', 'direct', m, 'plan'), cdS: hist('cd', 'seo', m, 'fact'), cdF: hist('cd', 'seo', m, 'feed'), cdSP: hist('cd', 'seo', m, 'plan'), cdD: hist('cd', 'direct', m, 'fact'), cdDP: hist('cd', 'direct', m, 'plan') }));
    $('#p27-table-history').innerHTML = `<thead><tr><th>Месяц</th><th class="num">SF SEO факт</th><th class="num">в т. ч. feed</th><th class="num">SF SEO план</th><th class="num">SF DIRECT факт</th><th class="num">SF DIRECT план</th><th class="num">CD SEO факт</th><th class="num">в т. ч. feed</th><th class="num">CD SEO план</th><th class="num">CD DIRECT факт</th><th class="num">CD DIRECT план</th></tr></thead><tbody>${months.map((m) => `
      <tr><td>${esc(mLabel(m))}${m === '2026-11' ? '<span class="p27-sub">факт 1–10.11, план на месяц</span>' : ''}${m === '2026-04' ? '<span class="p27-sub">1–20.04 SEO учтён как Direct</span>' : ''}</td><td class="num">${g('sf', 'seo', m, 'fact')}</td><td class="num">${g('sf', 'seo', m, 'feed')}</td><td class="num">${g('sf', 'seo', m, 'plan')}</td><td class="num">${g('sf', 'direct', m, 'fact')}</td><td class="num">${g('sf', 'direct', m, 'plan')}</td><td class="num">${g('cd', 'seo', m, 'fact')}</td><td class="num">${g('cd', 'seo', m, 'feed')}</td><td class="num">${g('cd', 'seo', m, 'plan')}</td><td class="num">${g('cd', 'direct', m, 'fact')}</td><td class="num">${g('cd', 'direct', m, 'plan')}</td></tr>`).join('')}</tbody>`;
  }

  function renderWordstat() {
    const gl = { sf: 'Skillfactory', cd: 'Contented', brand: 'Бренд', market: 'Рынок' };
    const rows = D.wordstat.filter((r) => r.query !== 'contented');
    $('#p27-table-ws').innerHTML = `<thead><tr><th>Группа</th><th>Фраза</th><th class="num">янв–сен 2024</th><th class="num">янв–сен 2025</th><th class="num">янв–сен 2026</th><th class="num">2026 к 2025</th></tr></thead><tbody>${rows.map((r) => `
      <tr><td>${esc(gl[r.group] || r.group)}</td><td>${esc(r.query)}</td><td class="num">${nf.format(r.jan_sep_2024)}</td><td class="num">${nf.format(r.jan_sep_2025)}</td><td class="num">${nf.format(r.jan_sep_2026)}</td><td class="num">${r.jan_sep_2025 ? `<span class="${r.yoy >= 0 ? 'p27-up' : 'p27-down'}">${pf.format(r.yoy)}</span>` : 'новая фраза'}</td></tr>`).join('')}</tbody>`;
  }

  // ---------- графики ----------
  const tip = $('#p27-tooltip');
  function showTip(e, html) { tip.innerHTML = html; tip.classList.add('visible'); const x = Math.min(e.clientX + 16, innerWidth - 280); tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`; }
  function hideTip() { tip.classList.remove('visible'); }
  function niceMax(v) { const raw = (v || 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw); return step * 4; }
  const path = (pts) => pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

  function renderMainChart() {
    const b = $('#p27-brand').value, c = $('#p27-channel').value, from = $('#p27-from').value;
    const fcm = FC_MONTHS();
    const months = []; for (let m = from; m <= fcm[fcm.length - 1]; m = addMonths(m, 1)) months.push(m);
    const fact = months.map((m) => (m <= '2026-10' ? hist(b, c, m, 'fact') : null));
    const plan = months.map((m) => (m <= '2026-11' ? hist(b, c, m, 'plan') : null));
    const base = months.map((m) => (m === '2026-11' ? novEst(b, c) : m >= '2026-12' ? fc(b, c, m, 'base') : null));
    const opt = months.map((m) => (m === '2026-11' ? novEst(b, c) : m >= '2026-12' ? fc(b, c, m, 'opt') : null));
    const est = months.map((m) => (m === '2026-10' ? hist(b, c, m, 'fact') : m === '2026-11' ? novEst(b, c) : null));
    const maxV = niceMax(Math.max(...[...fact, ...plan, ...opt].filter((v) => v !== null)) * 1.08);
    const W = 1200, H = 420, L = 56, R = 18, T = 18, B = 44;
    const x = (i) => L + (W - L - R) * (months.length === 1 ? 0.5 : i / (months.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / maxV);
    const pt = (arr) => arr.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
    const seg = (arr) => { const out = []; let cur = []; arr.forEach((v, i) => { if (v === null || v === undefined) { if (cur.length) out.push(cur); cur = []; } else cur.push([x(i), y(v)]); }); if (cur.length) out.push(cur); return out.map(path).join(''); };
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = maxV * k / 4; g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:#E2E2E2"/><text class="axis-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`; }
    months.forEach((m, i) => { const step = months.length > 30 ? 3 : months.length > 18 ? 2 : 1; const near = Math.abs(i - months.indexOf('2026-12')) < step && m !== '2026-12'; if ((i % step === 0 && !near) || m === '2026-12') g += `<text class="axis-label" x="${x(i)}" y="${H - 18}" text-anchor="middle">${mShort(m)}</text>`; });
    const iDiv = months.indexOf('2026-12');
    if (iDiv > 0) g += `<line class="p27-divider" x1="${(x(iDiv) + x(iDiv - 1)) / 2}" x2="${(x(iDiv) + x(iDiv - 1)) / 2}" y1="${T}" y2="${H - B}"/><text class="p27-divider-label" x="${(x(iDiv) + x(iDiv - 1)) / 2 + 6}" y="${T + 12}">план</text>`;
    const bandTop = pt(opt).filter(Boolean), bandBot = pt(base).filter(Boolean).reverse();
    if (bandTop.length) g += `<path class="p27-band" d="${path([...bandTop, ...bandBot])}Z"/>`;
    g += `<path class="p27-line-plan" d="${seg(plan)}"/><path class="p27-line-fact" d="${seg(fact)}"/><path class="p27-line-est" d="${seg(est)}"/><path class="p27-line-base" d="${seg(base)}"/><path class="p27-line-opt" d="${seg(opt)}"/>`;
    fact.forEach((v, i) => { if (v !== null) g += `<circle class="p27-dot" cx="${x(i)}" cy="${y(v)}" r="2.6"/>`; });
    opt.forEach((v, i) => { if (v !== null && months[i] >= '2026-12') g += `<circle class="p27-dot-opt" cx="${x(i)}" cy="${y(v)}" r="2.6"/>`; });
    const colW = (W - L - R) / Math.max(1, months.length - 1);
    months.forEach((m, i) => { g += `<rect class="hit-area" data-i="${i}" x="${x(i) - colW / 2}" y="${T}" width="${colW}" height="${H - T - B}"/>`; });
    $('#p27-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
    $('#p27-chart').querySelectorAll('.hit-area').forEach((r) => {
      r.addEventListener('mousemove', (e) => {
        const i = +r.dataset.i, m = months[i];
        const lines = [`<b>${esc(mLabel(m))}</b>`];
        if (fact[i] !== null) lines.push(`Факт: ${nf.format(fact[i])}`);
        if (m === '2026-04' && c !== 'both') lines.push(`С поправкой атрибуции: ${nf.format(hist(b, c, m, 'corrected'))}`);
        if (m === '2026-11') lines.push(`Факт 1–10.11: ${nf.format(hist(b, c, m, 'fact'))}`, `Оценка месяца: ${nf.format(novEst(b, c))}`);
        if (plan[i] !== null) lines.push(`План Power BI: ${nf.format(plan[i])}`);
        if (m >= '2026-12') { lines.push(`База: ${nf.format(base[i])}`, `Оптимистичный: ${nf.format(opt[i])}`); const ya = yearAgo(b, c, m); if (ya.v) lines.push(`Год назад: ${nf.format(ya.v)}${ya.mark ? ' (оценка)' : ''}`); }
        showTip(e, lines.join('<br>'));
      });
      r.addEventListener('mouseleave', hideTip);
    });
    const bn = { all: 'Skillfactory + Contented', sf: 'Skillfactory', cd: 'Contented' }[b];
    $('#p27-chart-title').textContent = `${bn} · ${CH_LABEL[c]}: факт, план Power BI и прогноз`;
    $('#p27-chart-note').textContent = `2027 год: база ${nf.format(sum27(b, c, 'base'))}, оптимистичный ${nf.format(sum27(b, c, 'opt'))}; 2026 год (факт + оценка ноября + база декабря): ${nf.format(total2026(b, c))}; 2025 год: ${nf.format(sumYear(b, c, 2025, 'fact'))}. Пунктир после октября 2026 — оценка ноября по факту 1–10.11.`;
  }

  function renderUplift() {
    const b = $('#p27-brand').value, c = $('#p27-channel').value; const months = FC_MONTHS();
    const parts = ['pages', 'dups', 'sem'], colors = { pages: '#3D3BFF', dups: '#968BAB', sem: '#D8FF28' };
    const val = (m, p) => { let s = 0; brandsOf(b).forEach((br) => chansOf(c).forEach((ch) => { const r = D.brands[br].channels[ch].forecast.find((x) => x.month === m); s += r.levers[p]; })); return s; };
    const data = months.map((m) => parts.map((p) => val(m, p)));
    const maxV = niceMax(Math.max(1, ...data.map((d) => d.reduce((a, v) => a + v, 0))) * 1.1);
    const W = 600, H = 300, L = 44, R = 10, T = 12, B = 36; const bw = (W - L - R) / months.length;
    const y = (v) => T + (H - T - B) * (1 - v / maxV);
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = maxV * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:#E2E2E2"/><text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`; }
    data.forEach((d, i) => {
      let acc = 0; const x0 = L + i * bw + bw * 0.18, w = bw * 0.64;
      parts.forEach((p, j) => { const h = (H - T - B) * d[j] / maxV; if (h > 0) g += `<rect x="${x0}" y="${y(acc + d[j])}" width="${w}" height="${h}" fill="${colors[p]}"/>`; acc += d[j]; });
      g += `<text class="axis-label" x="${x0 + w / 2}" y="${H - 14}" text-anchor="middle">${MSHORT[+months[i].slice(5) - 1]}</text>`;
      g += `<rect class="hit-area" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}"/>`;
    });
    $('#p27-uplift').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    $('#p27-uplift').querySelectorAll('.hit-area').forEach((r) => {
      r.addEventListener('mousemove', (e) => { const i = +r.dataset.i, d = data[i]; showTip(e, `<b>${esc(mLabel(months[i]))}</b><br>Курсы и каталоги: +${df.format(d[0])}<br>Дубли курсов: +${df.format(d[1])}<br>Семантика: +${df.format(d[2])}<br>Итого: +${nf.format(fc(b, c, months[i], 'opt') - fc(b, c, months[i], 'base'))}`); });
      r.addEventListener('mouseleave', hideTip);
    });
    $('#p27-uplift-note').textContent = `Прирост к базе, лидов в месяц: ${{ all: 'SF + CD', sf: 'Skillfactory', cd: 'Contented' }[b]}, ${CH_LABEL[c]}. За 2027 год: +${nf.format(sum27(b, c, 'opt') - sum27(b, c, 'base'))}.`;
  }

  function renderSeason() {
    const b = $('#p27-brand').value === 'cd' ? 'cd' : 'sf'; const br = D.brands[b];
    const series = [['seasonLeads', 'p27-line-fact'], ['seasonWordstat', 'p27-line-ws'], ['season', 'p27-line-opt']];
    const vals = series.flatMap(([k]) => Object.values(br[k]));
    const lo = Math.floor(Math.min(...vals) * 10) / 10, hi = Math.ceil(Math.max(...vals) * 10) / 10;
    const W = 600, H = 300, L = 44, R = 10, T = 12, B = 36;
    const x = (i) => L + (W - L - R) * i / 11, y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += 0.1) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:${Math.abs(v - 1) < 1e-6 ? '#000' : '#E2E2E2'}"/><text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${df.format(v)}</text>`;
    MSHORT.forEach((m, i) => { g += `<text class="axis-label" x="${x(i)}" y="${H - 14}" text-anchor="middle">${m}</text>`; });
    series.forEach(([k, cls]) => { g += `<path class="${cls}" d="${path(MSHORT.map((_, i) => [x(i), y(br[k][String(i + 1)])]))}"/>`; });
    MSHORT.forEach((_, i) => { g += `<rect class="hit-area" data-i="${i}" x="${x(i) - (W - L - R) / 22}" y="${T}" width="${(W - L - R) / 11}" height="${H - T - B}"/>`; });
    $('#p27-season').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    $('#p27-season').querySelectorAll('.hit-area').forEach((r) => {
      r.addEventListener('mousemove', (e) => { const k = String(+r.dataset.i + 1); showTip(e, `<b>${MONTHS[+k - 1]}</b><br>Лиды: ${df.format(br.seasonLeads[k])}<br>Wordstat: ${df.format(br.seasonWordstat[k])}<br>Итоговый: ${df.format(br.season[k])}`); });
      r.addEventListener('mouseleave', hideTip);
    });
    $('#p27-season-note').textContent = `${br.name}: индекс месяца, среднее за год = 1,00. Итоговый индекс — среднее индекса лидов и индекса Wordstat; один индекс для SEO и DIRECT проекта.`;
  }

  // ---------- методика и источники ----------
  function renderMethod() {
    const sf = D.brands.sf, cd = D.brands.cd;
    const ch = (b, c) => D.brands[b].channels[c];
    const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
    const items = [
      `<b>Факт.</b> Power BI, модель ${esc(D.meta.pbi.model)}. Мера ${esc(D.meta.pbi.measure)}. Фильтры: ${esc(D.meta.pbi.filters)}. Это те же определения, по которым строится вкладка «План и факт» (скрипт <code>extract_leads_through.sh</code>). Период: ${esc(D.meta.pbi.period)}.`,
      `<b>Очистка ряда.</b> Из SEO вычтен поток yandex-feed (utm_source yandex-feed / ya-feed): с 20.10.2026 его нет, и база строится на органике без него. В апреле 2026 SEO-лиды 1–20.04 попадали в Direct (SF: 73 SEO и 229 Direct за месяц при обычном соотношении обратном), поэтому для модели сумма апреля разделена по долям марта и мая. В таблице факта значения оставлены как в Power BI.`,
      `<b>Сезонность.</b> Метод отношения к скользящей 12-месячной средней: по лидам SEO + DIRECT проекта (апрель 2024 — октябрь 2026) и по сумме частот Wordstat тематик проекта (январь 2024 — сентябрь 2026). Итоговый индекс — среднее двух. Декабрь: SF ${df.format(sf.season['12'])}, CD ${df.format(cd.season['12'])}; август: SF ${df.format(sf.season['8'])}, CD ${df.format(cd.season['8'])}.`,
      `<b>Стартовый уровень</b> (лидов в месяц без сезонности) = половина среднего за август — октябрь 2026 + половина оценки ноября. Оценка ноября = факт 1–10.11 × ${df.format(D.meta.novFullFactor)} / ${df.format(D.meta.novObservedFactor)} (профиль дней недели дашборда). Уровни: SF SEO ${nf.format(ch('sf', 'seo').level)}, SF DIRECT ${nf.format(ch('sf', 'direct').level)}, CD SEO ${nf.format(ch('cd', 'seo').level)}, CD DIRECT ${nf.format(ch('cd', 'direct').level)}.`,
      `<b>Тренд 2026 года.</b> Наклон логарифма ряда без сезонности за ноябрь 2025 — октябрь 2026: SF SEO ${pct(ch('sf', 'seo').slope)} в месяц, SF DIRECT ${pct(ch('sf', 'direct').slope)}, CD SEO ${pct(ch('cd', 'seo').slope)} (ограничен −4,0%), CD DIRECT ${pct(ch('cd', 'direct').slope)}. Тренд затухает с коэффициентом 0,8 в месяц: за горизонт плана накапливается не больше 3,8 месячного наклона. Так база не экстраполирует падение Contented или рост DIRECT Skillfactory без конца.`,
      `<b>База</b> = уровень × затухающий тренд × индекс сезонности месяца. Доработки, которые уже выкачены (17 страниц эксперимента «вайбкодинг» с августа по ноябрь 2026), входят в уровень и отдельно не прибавляются.`,
      `<b>Оптимистичный сценарий</b> = база × рычаги, которые включаются постепенно. (1) Доработка страниц курсов и каталогов: SEO +${pct(sf.levers.pages)} у обоих проектов, DIRECT +${pct(sf.levers.direct_pages)} (рост конверсии страницы касается и прямых заходов); выход на полный эффект к июню 2027. Основание: у шести уже доработанных страниц эксперимента «вайбкодинг» с окном после релиза от 20 дней SEO-визиты изменились от −10% до +41% к равному окну до релиза (медиана +10%). Рост лидов на этих страницах пока не подтверждён (например, CD «Дизайн интерьеров»: 85 → 70 лидов), поэтому +10% — верхняя граница того, что уже видно в визитах. (2) Дубли курсов: SF +${pct(sf.levers.dups)}, CD +${pct(cd.levers.dups)}, старт в марте 2027, полный эффект к декабрю 2027. Расчёт: доля лидов со страниц курсов (SF 39%, CD 72% за июнь — ноябрь 2026) × 15% дополнительного охвата запросов. (3) Расширение семантики (новые каталоги и подборки): SF +${pct(sf.levers.sem)}, CD +${pct(cd.levers.sem)}, старт в апреле 2027. Расчёт: доля лидов с каталогов (SF 57%, CD 19%) × 10%. Проценты (2) и (3) — оценка, а не измеренный эффект.`,
      `<b>Округление.</b> Месячные значения округлены до целых, итоги — суммы округлённых месяцев.`,
    ];
    $('#p27-method').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
    const risks = [
      'Возврат yandex-feed. В январе — сентябре 2026 он давал SF 7–25 и CD 12–43 SEO-лида в месяц. Если поток вернётся, факт будет выше обоих сценариев; если Яндекс сильнее урежет переходы из поиска, факт будет ниже базы.',
      'Падение Contented SEO может не затухнуть. Если тренд −5,7% в месяц сохранится без затухания, CD SEO в 2027 году будет примерно на 25% ниже базы (около 880 лидов вместо 1 180).',
      'Двойной учёт. Лиды школы Contented, пришедшие в горячую воронку SF, входят и в SF, и в CD (так считает дашборд): в январе — октябре 2026 это 96 SEO-лидов и 44 DIRECT. Сумма SF + CD поэтому немного больше уникального числа лидов.',
      'Wordstat. Коммерческий спрос по тематикам за январь — сентябрь 2026 ниже 2025 года: фразы SF −45%, фразы CD −46%, «онлайн курсы» −28%, брендовый запрос «skillfactory» −69%. Частота Wordstat — это показы, в них есть доля роботов (см. источник). Внутри 2026 года спрос и лиды SF без сезонности примерно стабильны, поэтому уровень плана по Wordstat не корректировался. Если спрос продолжит падать в 2027 году, факт уйдёт ниже базы. Растёт только тема нейросетей: «курсы нейросетей» +1% при общем падении.',
      'Факт за последние дни «дозревает» в CRM: в октябре 2026 лиды SF/CD догружались с задержкой до 10 дней (инцидент модели 09–19.10). Оценку ноября стоит пересчитать в начале декабря.',
      'В плане нет акций, изменения цен, новых продуктов вне SEO и работ над брендом. Если они будут, план DIRECT нужно пересмотреть в первую очередь.',
    ];
    $('#p27-risks').innerHTML = risks.map((t) => `<li>${esc(t)}</li>`).join('');
    const src = [
      ['Power BI, модель marketing_sales_growth_sf: лиды и план по месяцам, каналы SEO и Direct, горячие воронки SF и CD', 'выгрузка 11.11.2026', 'апрель 2024 — 10.11.2026', 'Внутренний источник; запросы DAX — в каталоге seo_plan_2027 на стенде'],
      ['Yandex Cloud Search API, Wordstat: динамика по 30 фразам, помесячно, вся Россия', 'выгрузка 11.11.2026', 'январь 2024 — сентябрь 2026', 'Внутренний доступ API'],
      ['Эксперимент «вайбкодинг», experiment.json дашборда: SEO-визиты и лиды страниц до и после релиза', 'срез 10.11.2026', '01.06.2026 — 10.11.2026', 'Вкладка «Эксперимент: вайбкодинг»'],
      ['Доли лидов по типам страниц SF/CD (pageGroups, data.json)', 'срез 10.11.2026', '01.06.2026 — 10.11.2026', 'Вкладка «План и факт», таблица долей'],
      ['Разбор падения 20.10.2026: SEO и yandex-feed SF/CD', '05.11.2026', 'май — 04.11.2026', 'seo_sfcd_drop_202610/README-отчёт.md на стенде'],
      ['<a href="https://www.seonews.ru/events/vyruchka-top-100-edtech-kompaniy-vyrosla-na-12-do-119-mlrd-rub-za-9-mesyatsev-2026-goda/" target="_blank" rel="noopener">SEOnews: выручка топ-100 EdTech +12% за 9 месяцев 2026 (Smart Ranking)</a>', '05.11.2026', 'январь — сентябрь 2026', 'Рынок растёт в деньгах; у Яндекс Практикума число студентов ИИ-программ +545%'],
      ['<a href="https://www.sostav.ru/blogs/286273/103997" target="_blank" rel="noopener">Sostav: Вордстат в 2026 году и ограничения частотности</a>', '26.08.2026', '—', 'Частота — показы, а не люди; в статистике есть доля роботов'],
    ];
    $('#p27-sources').innerHTML = `<thead><tr><th>Источник</th><th>Дата публикации / выгрузки</th><th>Период данных</th><th>Комментарий</th></tr></thead><tbody>${src.map((r) => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>`;
  }

  // ---------- CSV ----------
  function csv(name) {
    let head, lines;
    if (name === 'history') {
      head = ['Месяц', 'SF SEO факт', 'SF SEO feed', 'SF SEO план', 'SF DIRECT факт', 'SF DIRECT план', 'CD SEO факт', 'CD SEO feed', 'CD SEO план', 'CD DIRECT факт', 'CD DIRECT план'];
      lines = tableData.history.map((r) => [r.m, r.sfS, r.sfF, r.sfSP, r.sfD, r.sfDP, r.cdS, r.cdF, r.cdSP, r.cdD, r.cdDP]);
    } else {
      head = ['Период', 'SF база', 'SF оптимистичный', 'CD база', 'CD оптимистичный', 'Итого база', 'Итого оптимистичный', 'Год назад'];
      lines = tableData[name].map((r) => [r.label, r.sfB, r.sfO, r.cdB, r.cdO, r.allB, r.allO, r.ya]);
    }
    const body = [head, ...lines].map((row) => row.map((v) => (v === null || v === undefined ? '' : `"${String(typeof v === 'number' ? Math.round(v) : v).replace(/"/g, '""')}"`)).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = `plan_2027_${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- URL-состояние ----------
  function readState() {
    const p = new URLSearchParams(location.search);
    if (['all', 'sf', 'cd'].includes(p.get('brand'))) $('#p27-brand').value = p.get('brand');
    if (['both', 'seo', 'direct'].includes(p.get('channel'))) $('#p27-channel').value = p.get('channel');
    if (['2024-04', '2025-01', '2026-01'].includes(p.get('from'))) $('#p27-from').value = p.get('from');
  }
  function writeState() {
    const p = new URLSearchParams({ brand: $('#p27-brand').value, channel: $('#p27-channel').value, from: $('#p27-from').value });
    history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
  }
  function renderCharts() { renderMainChart(); renderUplift(); renderSeason(); }

  load().then((data) => {
    D = data;
    $('#p27-asof').textContent = `Факт по ${fmtDate(D.meta.asOf)}`;
    $('#p27-generated').textContent = `Сборка ${D.meta.generatedAt.slice(0, 10).split('-').reverse().join('.')}`;
    readState();
    renderSummary(); renderForecastTable('seo'); renderForecastTable('direct'); renderHistoryTable(); renderWordstat(); renderMethod(); renderCharts();
    ['#p27-brand', '#p27-channel', '#p27-from'].forEach((s) => $(s).addEventListener('change', () => { renderCharts(); writeState(); }));
    document.querySelectorAll('[data-csv]').forEach((b) => b.addEventListener('click', () => csv(b.dataset.csv)));
    window.addEventListener('resize', hideTip);
  }).catch((e) => { if (!['NO_KEY', 'BAD_KEY'].includes(e.message)) lock(`Не удалось загрузить план: ${e.message}`); });
  window.addEventListener('hashchange', () => location.reload());
})();
