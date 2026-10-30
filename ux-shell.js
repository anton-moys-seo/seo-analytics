/*
 * ux-shell.js — навигационная оболочка SEO Dashboard.
 * Боковое меню, верхняя панель, поиск разделов (Ctrl/⌘+K), свежесть данных по разделу,
 * копирование ссылки, мобильное меню. Данные, формулы, фильтры и загрузчик не меняются:
 * переходы делаются кликом по существующим кнопкам [data-target] (activateView в app.js),
 * а дата среза читается из meta уже загруженных JSON (обёртка только наблюдает результат loadJSON).
 * Если файл не загрузится, остаётся исходная навигация: всё скрытие привязано к html.ux-shell.
 */
(() => {
  'use strict';
  const doc = document;
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const fmt = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);

  const ICONS = {
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    forecast: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
    traffic: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l3-4 3 2 5-6"/>',
    tags: '<path d="M4 12l8-8h7v7l-8 8z"/><circle cx="15.5" cy="8.5" r="1.3"/>',
    refresh: '<path d="M19 8a7.5 7.5 0 0 0-13.6 1.5M5 16a7.5 7.5 0 0 0 13.6-1.5"/><path d="M19 3.5V8h-4.5M5 20.5V16h4.5"/>',
    stack: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
    flask: '<path d="M9.5 4h5M10.5 4v6l-5.5 9h14l-5.5-9V4"/><path d="M7.5 15h9"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  };
  const icon = (name, cls = 'ux-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const tabText = (view) => ($(`.section-tabs [data-target="${view}"]`)?.textContent || '').trim();
  const afterColon = (text, fallback) => {
    const part = text.includes(':') ? text.split(':').slice(1).join(':').trim() : '';
    return part ? part[0].toUpperCase() + part.slice(1) : fallback;
  };

  // Структура навигации. Подписи прогноза и эксперимента берутся из исходных кнопок, чтобы месяц и название не расходились.
  const GROUPS = [
    { id: 'leads', title: 'Лиды', tone: 'lime', items: [
      { view: 'leads', label: 'План и факт', hint: 'Выполнение плана по проектам и направлениям', icon: 'target' },
      { view: 'products-sf-cd', label: 'Продукты SF/CD', hint: 'Страницы курсов: поиск и BI-метрики', icon: 'box' },
    ] },
    { id: 'forecast', title: 'Прогноз', tone: 'peach', items: [
      { view: 'forecast', label: `${afterColon(tabText('forecast'), 'Следующий месяц')}: сценарии`, hint: 'Тренд, сезонность и спрос', icon: 'forecast' },
    ] },
    { id: 'media', title: 'Медиатрафик', tone: 'mint', items: [
      { view: 'media', label: 'Трафик', hint: 'SEO и прямой трафик, редакции', icon: 'traffic' },
      { view: 'recovery', label: 'Мониторинг метатегов', hint: 'Когорта страниц до и после', icon: 'tags' },
      { view: 'updates', label: 'Апдейты статей', hint: 'Окна до/после по когортам', icon: 'refresh' },
      { view: 'updates-all', label: 'Апдейты ALL', hint: 'Все апдейты: трафик, позиции, сигналы', icon: 'stack' },
    ] },
    { id: 'experiment', title: 'Эксперименты', tone: 'pink', items: [
      { view: 'experiment', label: afterColon(tabText('experiment'), 'Эксперимент'), hint: 'Лендинги: визиты, лиды, продажи', icon: 'flask' },
    ] },
  ];
  const ITEMS = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g })));
  const byView = Object.fromEntries(ITEMS.map((it) => [it.view, it]));

  // --- Свежесть: дата среза из meta каждого JSON, как только раздел его загрузил. ---
  const FILE_VIEWS = {
    'data.json': ['leads', 'media'], 'forecast.json': ['forecast'], 'recovery.json': ['recovery'],
    'updates.json': ['updates'], 'updates-all.json': ['updates-all'], 'experiment.json': ['experiment'],
    'products-sf-cd.json': ['products-sf-cd'],
  };
  const fresh = {};
  function recordMeta(name, data) {
    const views = FILE_VIEWS[name];
    const meta = data && typeof data === 'object' ? data.meta : null;
    if (!views || !meta) return;
    let text = null, note = '';
    if (fmt(meta.asOf)) { text = `по ${fmt(meta.asOf)}`; note = 'Последний полный день в данных раздела'; }
    else if (fmt(meta.biLastRefreshUtc)) { text = `BI от ${fmt(meta.biLastRefreshUtc)}`; note = 'Обновление BI-модели; у поисковых источников свои окна, см. раздел'; }
    if (!text) return;
    views.forEach((v) => { fresh[v] = { text, note }; });
    paintFreshness();
  }
  function hookLoader() {
    const original = window.loadJSON;
    if (typeof original !== 'function' || original.__uxObserved) return;
    const observed = async function loadJSON(name, options) {
      const result = await original.call(this, name, options);
      try { recordMeta(name, result); } catch (_) { /* наблюдение не должно ломать загрузку */ }
      return result;
    };
    observed.__uxObserved = true;
    window.loadJSON = observed;
  }
  // Обработчик регистрируется раньше init() из app.js, поэтому обёртка ставится до первой загрузки.
  doc.addEventListener('DOMContentLoaded', hookLoader);

  // --- Разметка оболочки ---
  const main = $('main.page-shell');
  if (!main) return;
  doc.documentElement.classList.add('ux-shell');
  main.id = main.id || 'main-content';
  const baseTitle = doc.title;
  const logoSrc = $('.site-header .brand img')?.getAttribute('src') || 'assets/skillbox-logo.svg';
  const reportTitle = ($('.hero h1')?.textContent || 'SEO-аналитика').trim();

  const skip = doc.createElement('button');
  skip.type = 'button'; skip.className = 'ux-skip'; skip.textContent = 'Перейти к содержимому';
  skip.style.border = '0'; skip.style.font = 'inherit'; skip.style.fontWeight = '500';

  const navHtml = GROUPS.map((g) => `
    <div class="ux-group" data-group="${g.id}">
      <p class="ux-group-title"><span class="ux-tone ux-tone-${g.tone}" aria-hidden="true"></span>${esc(g.title)}</p>
      <ul>${g.items.map((it) => `
        <li><a class="ux-link" href="?view=${it.view}" data-view="${it.view}">
          <span class="ux-link-ico ux-tone-${g.tone}">${icon(it.icon)}</span>
          <span class="ux-link-text"><span class="ux-link-label">${esc(it.label)}</span><span class="ux-link-meta" data-fresh-for="${it.view}">${esc(it.hint)}</span></span>
        </a></li>`).join('')}
      </ul>
    </div>`).join('');

  const sidebar = doc.createElement('aside');
  sidebar.className = 'ux-sidebar'; sidebar.id = 'ux-sidebar'; sidebar.setAttribute('aria-label', 'Разделы отчёта');
  sidebar.innerHTML = `
    <div class="ux-brand">
      <img src="${esc(logoSrc)}" alt="Skillbox" width="112" height="26">
      <button class="ux-icon-btn ux-close" type="button" aria-label="Закрыть меню">${icon('close')}</button>
    </div>
    <p class="ux-report">${esc(reportTitle)}</p>
    <button class="ux-search-trigger" type="button" data-open-palette>${icon('search')}<span>Найти раздел</span><kbd>Ctrl K</kbd></button>
    <nav class="ux-nav" aria-label="Разделы отчёта">${navHtml}</nav>
    <p class="ux-sources">Источники: Power BI, Яндекс Метрика, GSC, Вебмастер. У разделов разные даты среза.</p>`;

  const topbar = doc.createElement('div');
  topbar.className = 'ux-topbar';
  topbar.innerHTML = `
    <button class="ux-icon-btn ux-burger" type="button" aria-label="Открыть меню разделов" aria-controls="ux-sidebar" aria-expanded="false">${icon('menu')}</button>
    <img class="ux-top-logo" src="${esc(logoSrc)}" alt="Skillbox" width="96" height="22">
    <ol class="ux-crumbs" aria-label="Где вы находитесь"></ol>
    <div class="ux-top-tools">
      <span class="ux-fresh" role="status" aria-live="polite">${icon('clock')}<span class="ux-fresh-text">Загрузка данных</span></span>
      <button class="ux-tool" type="button" data-open-palette aria-label="Найти раздел">${icon('search')}<span>Разделы</span></button>
      <button class="ux-tool ux-tool-primary" type="button" id="ux-copy">${icon('link')}<span>Ссылка</span></button>
    </div>
    <span class="ux-toast" role="status" aria-live="polite"></span>`;

  const backdrop = doc.createElement('div');
  backdrop.className = 'ux-backdrop'; backdrop.hidden = true;

  const palette = doc.createElement('dialog');
  palette.className = 'ux-palette'; palette.setAttribute('aria-label', 'Поиск раздела');
  palette.innerHTML = `
    <form method="dialog" class="ux-palette-box">
      <label class="ux-palette-field">${icon('search')}<span class="ux-visually-hidden">Название раздела</span>
        <input type="search" autocomplete="off" placeholder="Раздел, например «апдейты» или «прогноз»" aria-controls="ux-palette-list"></label>
      <ul id="ux-palette-list" class="ux-palette-list" role="listbox" aria-label="Разделы"></ul>
      <p class="ux-palette-hint"><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Enter</kbd> открыть · <kbd>Esc</kbd> закрыть</p>
    </form>`;

  doc.body.insertBefore(skip, doc.body.firstChild);
  doc.body.insertBefore(sidebar, skip.nextSibling);
  doc.body.insertBefore(backdrop, sidebar.nextSibling);
  doc.body.insertBefore(topbar, backdrop.nextSibling);
  doc.body.appendChild(palette);

  // --- Переход: клик по существующей кнопке, чтобы URL, фильтры и ленивые загрузки работали как раньше. ---
  function go(view) {
    const btn = $(`.nested-tab[data-target="${view}"]:not([data-media-results])`) || $(`[data-target="${view}"]`);
    if (!btn) return;
    btn.click();
    closeDrawer();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  sidebar.addEventListener('click', (e) => {
    const link = e.target.closest('.ux-link');
    if (!link) return;
    syncHrefs();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // новая вкладка — обычная ссылка
    e.preventDefault();
    go(link.dataset.view);
  });
  // Сохраняем сериализованные фильтры и #fragment; меняем только целевой view.
  const syncHrefs = () => $$('.ux-link', sidebar).forEach((a) => {
    const url = new URL(location.href);
    url.searchParams.set('view', a.dataset.view);
    a.href = url.href;
  });
  // Ждём штатных обработчиков фильтров/updateUrl, не подменяя history или состояние приложения.
  const deferHrefs = () => queueMicrotask(syncHrefs);
  ['input', 'change', 'click'].forEach((type) => doc.addEventListener(type, deferHrefs));
  ['pointerdown', 'contextmenu', 'focusin'].forEach((type) => sidebar.addEventListener(type, syncHrefs, true));
  window.addEventListener('popstate', deferHrefs);
  window.addEventListener('hashchange', deferHrefs);

  function currentView() {
    return $('.dashboard-section.active')?.id || 'leads';
  }
  function paintFreshness() {
    const view = currentView();
    const f = fresh[view];
    const chip = $('.ux-fresh', topbar);
    $('.ux-fresh-text', topbar).innerHTML = f ? `<span class="ux-fresh-label">Данные </span>${esc(f.text)}` : 'Дата среза появится после загрузки';
    chip.title = f ? f.note : '';
    $$('[data-fresh-for]', sidebar).forEach((el) => {
      const ff = fresh[el.dataset.freshFor];
      if (ff) { el.textContent = `Данные ${ff.text}`; el.classList.add('is-date'); }
    });
  }
  function paint() {
    const view = currentView();
    const item = byView[view];
    $$('.ux-link', sidebar).forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $$('.ux-group', sidebar).forEach((g) => g.classList.toggle('is-active', item && g.dataset.group === item.group.id));
    if (item) {
      $('.ux-crumbs', topbar).innerHTML = `<li><span class="ux-tone ux-tone-${item.group.tone}" aria-hidden="true"></span>${esc(item.group.title)}</li><li aria-current="page">${esc(item.label)}</li>`;
      doc.title = `${item.label} · ${baseTitle}`;
      doc.documentElement.dataset.uxTone = item.group.tone;
    }
    paintFreshness();
    syncHrefs();
  }
  const observer = new MutationObserver(paint);
  $$('.dashboard-section').forEach((s) => observer.observe(s, { attributes: true, attributeFilter: ['class'] }));
  paint();

  // --- Мобильное меню ---
  const burger = $('.ux-burger', topbar);
  const mobileMenu = matchMedia('(max-width: 1100px)');
  const drawerBackground = new Map();
  const drawerAttrs = ['role', 'aria-modal', 'tabindex'].map((name) => [name, sidebar.getAttribute(name)]);
  let drawerReturnFocus = null;
  const drawerIsOpen = () => doc.documentElement.classList.contains('ux-drawer-open');
  const drawerStops = () => $$('a[href],button,input,select,textarea,[tabindex]', sidebar).filter((el) =>
    !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  function focusDrawer() {
    const active = $('.ux-link.is-active', sidebar);
    (drawerStops().includes(active) ? active : drawerStops()[0] || sidebar).focus({ preventScroll: true });
  }
  function openDrawer() {
    if (!mobileMenu.matches || drawerIsOpen()) return;
    if (palette.open) closePalette();
    drawerReturnFocus = doc.activeElement;
    doc.documentElement.classList.add('ux-drawer-open');
    backdrop.hidden = false; burger.setAttribute('aria-expanded', 'true');
    sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true'); sidebar.setAttribute('tabindex', '-1');
    [...doc.body.children].forEach((el) => {
      if (el === sidebar || el === backdrop || el === palette || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) return;
      drawerBackground.set(el, el.hasAttribute('inert'));
      el.inert = true;
    });
    focusDrawer();
  }
  function closeDrawer(restoreFocus = true) {
    if (!drawerIsOpen()) return;
    doc.documentElement.classList.remove('ux-drawer-open');
    backdrop.hidden = true; burger.setAttribute('aria-expanded', 'false');
    drawerBackground.forEach((wasInert, el) => { if (wasInert) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    drawerBackground.clear();
    drawerAttrs.forEach(([name, value]) => { if (value === null) sidebar.removeAttribute(name); else sidebar.setAttribute(name, value); });
    if (restoreFocus) {
      const previous = drawerReturnFocus;
      const target = previous?.isConnected && !previous.closest('[inert]') && previous.getClientRects().length ? previous : burger;
      target.focus({ preventScroll: true });
    }
    drawerReturnFocus = null;
  }
  doc.addEventListener('keydown', (e) => {
    if (!drawerIsOpen() || palette.open || e.key !== 'Tab') return;
    const stops = drawerStops(), first = stops[0], last = stops[stops.length - 1];
    if (!first) { e.preventDefault(); sidebar.focus(); return; }
    const active = doc.activeElement;
    if (!sidebar.contains(active) || active === sidebar || (e.shiftKey ? active === first : active === last)) {
      e.preventDefault(); (e.shiftKey ? last : first).focus();
    }
  }, true);
  doc.addEventListener('focusin', (e) => {
    if (drawerIsOpen() && !palette.open && !sidebar.contains(e.target)) focusDrawer();
  });
  mobileMenu.addEventListener('change', () => { if (!mobileMenu.matches) closeDrawer(false); });
  burger.addEventListener('click', openDrawer);
  backdrop.addEventListener('click', () => closeDrawer());
  $('.ux-close', sidebar).addEventListener('click', () => closeDrawer());

  // --- Поиск разделов ---
  const input = $('input', palette), list = $('.ux-palette-list', palette);
  let matches = [], cursor = 0;
  const norm = (t) => t.toLowerCase().replace(/ё/g, 'е');
  function renderPalette() {
    const q = norm(input.value.trim());
    matches = ITEMS.filter((it) => !q || norm(`${it.group.title} ${it.label} ${it.hint}`).includes(q));
    cursor = Math.min(cursor, Math.max(0, matches.length - 1));
    list.innerHTML = matches.length ? matches.map((it, i) => `
      <li role="option" id="ux-opt-${i}" aria-selected="${i === cursor}" data-view="${it.view}" class="${i === cursor ? 'is-cursor' : ''}">
        <span class="ux-link-ico ux-tone-${it.group.tone}">${icon(it.icon)}</span>
        <span class="ux-link-text"><span class="ux-link-label">${esc(it.label)}</span><span class="ux-link-meta">${esc(it.group.title)} · ${esc(fresh[it.view] ? `данные ${fresh[it.view].text}` : it.hint)}</span></span>
      </li>`).join('') : '<li class="ux-palette-empty">Ничего не нашлось</li>';
    input.setAttribute('aria-activedescendant', matches.length ? `ux-opt-${cursor}` : '');
  }
  function openPalette() {
    if (palette.open) return;
    // Один модальный контекст: сначала восстановим фон и фокус drawer, затем откроем dialog.
    closeDrawer();
    input.value = ''; cursor = Math.max(0, ITEMS.findIndex((it) => it.view === currentView()));
    renderPalette();
    if (typeof palette.showModal === 'function') palette.showModal(); else palette.setAttribute('open', '');
    input.focus();
  }
  function closePalette() { if (palette.open) palette.close(); }
  input.addEventListener('input', () => { cursor = 0; renderPalette(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      renderPalette();
      $('.is-cursor', list)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[cursor]) { closePalette(); go(matches[cursor].view); }
    }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-view]');
    if (li) { closePalette(); go(li.dataset.view); }
  });
  palette.addEventListener('click', (e) => { if (e.target === palette) closePalette(); });
  $$('[data-open-palette]').forEach((b) => b.addEventListener('click', openPalette));
  doc.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
      e.preventDefault(); openPalette();
    } else if (e.key === 'Escape' && !palette.open) closeDrawer();
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform || '')) $$('kbd', sidebar).forEach((k) => { if (k.textContent === 'Ctrl K') k.textContent = '⌘K'; });

  // --- Копирование ссылки с фильтрами (адрес как есть, вместе с #fragment). ---
  const toast = $('.ux-toast', topbar);
  let toastTimer = 0;
  $('#ux-copy').addEventListener('click', async () => {
    const url = location.href;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (_) {
      const t = doc.createElement('textarea');
      t.value = url; t.setAttribute('readonly', ''); t.className = 'ux-visually-hidden';
      doc.body.appendChild(t); t.select();
      try { ok = doc.execCommand('copy'); } catch (__) { ok = false; }
      t.remove();
    }
    toast.textContent = ok ? 'Ссылка с фильтрами скопирована' : 'Не удалось скопировать: возьмите адрес из строки браузера';
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  });

  skip.addEventListener('click', (e) => { e.preventDefault(); main.setAttribute('tabindex', '-1'); main.focus(); });
})();
