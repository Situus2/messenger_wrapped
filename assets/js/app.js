/*
 * Messenger Wrapped — strona główna, tryb samolotowy, wgrywanie, wybór rozmowy, karty.
 * Plik użytkownika nie opuszcza przeglądarki i nie jest nigdzie zapisywany.
 */
(function () {
  'use strict';

  const VERSION = 5;
  const $ = (s, r = document) => r.querySelector(s);
  const { fmt, plural } = window.WrappedStories;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const home = $('#home');
  const pick = $('#pick');
  const stage = $('#stage');
  const fileInput = $('#file');
  const drop = $('#drop');
  const planeStep = $('#plane');
  const planeMsg = $('#planeMsg');
  const listEl = $('#list');
  const yearsEl = $('#years');
  const qEl = $('#q');

  const now = new Date();
  // W styczniu i lutym domyślnie pokazujemy rok, który właśnie minął.
  const DEFAULT_YEAR = now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = DEFAULT_YEAR; });

  const S = { list: null, year: DEFAULT_YEAR, busy: false, stories: null, fileLabel: '' };

  /* ---------------- Sprzątanie po starej wersji ---------------- */
  try { indexedDB.deleteDatabase('messenger_wrapped'); } catch (err) { /* brak IndexedDB */ }
  try { localStorage.removeItem('wrappedStats'); sessionStorage.removeItem('wrappedStats'); } catch (err) { /* tryb prywatny */ }

  /* ---------------- Offline: wszystko ładujemy od razu ---------------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 800));
  idle(() => window.WrappedExport.loadAssets().catch(() => {}));

  /* ---------------- Silnik w Web Workerze ---------------- */
  let worker = null;
  let seq = 0;
  const pending = new Map();
  function startWorker() {
    try { worker = new Worker(`assets/js/engine.js?v=${VERSION}`); } catch (err) { worker = null; return; }
    worker.onmessage = (e) => {
      const { id, type } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') { if (p.onProgress) p.onProgress(e.data.info); return; }
      pending.delete(id);
      if (type === 'done') p.resolve(e.data.result); else p.reject(e.data.error);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      for (const p of pending.values()) p.reject({ code: 'WORKER', detail: e.message || '' });
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  function call(cmd, payload, onProgress) {
    if (!worker) startWorker();
    if (!worker) return Promise.reject({ code: 'NO_WORKER' });
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, cmd, payload });
    });
  }
  startWorker();
  call('ping').catch(() => {});

  /* ---------------- Pas przykładowych kart ---------------- */
  function buildStrip() {
    const demo = JSON.parse(JSON.stringify(window.WRAPPED_DEMO || null));
    if (!demo) return;
    demo.year = DEFAULT_YEAR;
    demo.heat.year = DEFAULT_YEAR;
    demo.heat.start = `${DEFAULT_YEAR}-01-01`;
    const leap = new Date(DEFAULT_YEAR, 1, 29).getDate() === 29;
    if (leap && demo.heat.days.length === 365) demo.heat.days.push(0);
    if (demo.yoy) demo.yoy.prevYear = DEFAULT_YEAR - 1;
    const ids = ['total', 'who', 'emoji', 'days', 'clock', 'personas', 'phrases', 'little', 'months', 'summary'];
    const cards = window.WrappedStories.staticCards(demo, ids, { domain: 'wrapped.situus.pl' });
    const one = cards.map((c) => `<div class="thumb" aria-hidden="true"><div class="st__frame is-static" data-pal="${c.pal}">${c.markup}</div></div>`).join('');
    $('#strip').innerHTML = one + one;
  }
  buildStrip();

  /* ---------------- Tryb samolotowy ---------------- */
  function paintNet(online) {
    const state = online ? 'online' : 'offline';
    if (planeStep.dataset.net === state) return;
    planeStep.classList.add('is-switching');
    setTimeout(() => planeStep.classList.remove('is-switching'), 180);
    planeStep.dataset.net = state;
    planeMsg.textContent = online
      ? 'Masz internet. Strona zadziała też bez niego.'
      : 'Jesteś offline. Od teraz nic nie może opuścić tego urządzenia.';
    drop.classList.toggle('is-ready', !online && !S.list);
    const btnTitle = $('#pickBtn strong');
    if (!S.busy) btnTitle.textContent = online ? 'Wybierz plik ZIP lub JSON' : 'Teraz wybierz plik';
  }
  async function checkOffline() {
    if (!navigator.onLine) return true;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      await fetch(`__ping?${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      return false;
    } catch (err) {
      return true;
    }
  }
  $('#planeBtn').addEventListener('click', async () => {
    planeStep.classList.add('is-checking');
    planeMsg.textContent = 'Sprawdzam połączenie…';
    const off = await checkOffline();
    planeStep.classList.remove('is-checking');
    if (off) { planeStep.dataset.net = 'online'; paintNet(false); return; }
    planeMsg.textContent = 'Nadal widzę internet. Włącz tryb samolotowy w telefonie albo wyłącz Wi-Fi i spróbuj jeszcze raz.';
  });
  window.addEventListener('offline', () => paintNet(false));
  window.addEventListener('online', () => paintNet(true));
  if (!navigator.onLine) paintNet(false);

  /* ---------------- Wgrywanie ---------------- */
  function dropState(which) {
    ['.drop__btn', '.drop__prog', '.drop__err', '.drop__done'].forEach((sel) => { $(sel, drop).hidden = sel !== which; });
  }
  $('#pickBtn').addEventListener('click', () => fileInput.click());
  drop.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { call('reset').catch(() => {}); S.list = null; dropState('.drop__btn'); fileInput.click(); }
    if (e.target.closest('[data-show]')) showPicker(true);
  });
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) handleFiles(files);
  });

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || stage.firstChild) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragover', (e) => { if (document.body.classList.contains('is-dragging')) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('is-dragging'); });
  window.addEventListener('drop', (e) => {
    if (!document.body.classList.contains('is-dragging')) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (files.length) {
      if (!pick.hidden) history.back();
      handleFiles(files);
    }
  });

  function sizeLabel(n) {
    if (n >= 1e9) return `${fmt(n / 1e9, 1)} GB`;
    if (n >= 1e6) return `${fmt(n / 1e6, 1)} MB`;
    return `${fmt(Math.max(1, Math.round(n / 1e3)))} kB`;
  }
  const ERRORS = {
    ZIP_CORRUPT: 'Ten ZIP jest uszkodzony albo niepełny. Pobierz go jeszcze raz.',
    ZIP_PARTIAL: 'To wygląda na fragment archiwum podzielonego na części. Wgraj cały plik ZIP.',
    ZIP_ENCRYPTED: 'Archiwum jest zabezpieczone hasłem. Rozpakuj je i wgraj pliki JSON z folderu z wiadomościami.',
    ZIP_METHOD: 'Ten ZIP używa nietypowej kompresji. Rozpakuj go i wgraj pliki JSON z folderu z wiadomościami.',
    NO_DECOMPRESS: 'Ta przeglądarka nie potrafi rozpakować ZIP-a. Zaktualizuj ją (Chrome, Edge, Safari 16.4+, Firefox 113+) albo wgraj rozpakowane pliki JSON.',
    HTML_EXPORT: 'To eksport w formacie HTML. Pobierz dane jeszcze raz i wybierz format JSON.',
    NO_MESSAGES: 'Nie ma tu wiadomości z Messengera. Sprawdź, czy przy pobieraniu zaznaczone były „Wiadomości”.',
    BAD_TYPE: 'Obsługiwane są pliki ZIP i JSON z eksportu Messengera.',
    BAD_JSON: 'Ten plik JSON jest uszkodzony albo nie pochodzi z eksportu Messengera.',
    NO_WORKER: 'Nie da się uruchomić analizy. Otwórz stronę przez https:// (nie bezpośrednio z dysku).',
    WORKER: 'Zabrakło pamięci albo przeglądarka przerwała liczenie. Spróbuj na komputerze.',
  };
  const errorText = (err) => (err && err.code === 'EMPTY_PERIOD' ? 'W tym okresie nie ma wiadomości w tej rozmowie.' : ERRORS[err && err.code] || 'Coś poszło nie tak podczas liczenia. Spróbuj jeszcze raz.');

  async function handleFiles(files) {
    if (S.busy) return;
    S.busy = true;
    S.list = null;
    drop.classList.remove('is-ready');
    dropState('.drop__prog');
    const title = $('.drop__title', drop);
    const sub = $('.drop__sub', drop);
    const bar = $('.bar', drop);
    bar.classList.add('is-indet');
    bar.style.setProperty('--p', 0);
    const total = files.reduce((a, f) => a + f.size, 0);
    S.fileLabel = files.length === 1 ? files[0].name : `${files.length} ${plural(files.length, 'plik', 'pliki', 'plików')}`;
    title.textContent = 'Otwieram archiwum…';
    sub.textContent = `${S.fileLabel} · ${sizeLabel(total)}`;
    if (window.matchMedia('(max-width: 899px)').matches) drop.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const t0 = performance.now();
    try {
      const res = await call('index', { files }, (info) => {
        if (info.phase === 'list') title.textContent = 'Czytam spis archiwum…';
        if (info.phase === 'listed') sub.textContent = `${fmt(info.entries)} ${plural(info.entries, 'plik', 'pliki', 'plików')} w archiwum, zdjęcia i filmy pomijam`;
        if (info.phase === 'parse') {
          bar.classList.remove('is-indet');
          bar.style.setProperty('--p', (info.done / info.total).toFixed(3));
          title.textContent = `${fmt(info.threads)} ${plural(info.threads, 'rozmowa', 'rozmowy', 'rozmów')}`;
          sub.textContent = `Czytam pliki: ${fmt(info.done)} z ${fmt(info.total)}`;
        }
      });
      S.list = res;
      const secs = (performance.now() - t0) / 1000;
      const n = res.chats.length;
      $('.drop__donetitle', drop).textContent = `${fmt(n)} ${plural(n, 'rozmowa', 'rozmowy', 'rozmów')} gotowe`;
      $('.drop__donesub', drop).textContent = `${S.fileLabel} · ${fmt(secs, secs < 10 ? 1 : 0)} s${navigator.onLine ? '' : ' · bez internetu'}`;
      dropState('.drop__done');
      showPicker(true);
    } catch (err) {
      console.error('index error', err);
      $('.drop__errmsg', drop).textContent = errorText(err);
      dropState('.drop__err');
    } finally {
      S.busy = false;
    }
  }

  /* ---------------- Widoki i przycisk "wstecz" ---------------- */
  function showView(v) {
    const toPick = v === 'pick' && S.list;
    home.hidden = !!toPick;
    pick.hidden = !toPick;
    const el = toPick ? pick : home;
    el.classList.remove('is-entering');
    void el.offsetWidth;
    el.classList.add('is-entering');
  }
  function showPicker(push) {
    if (!S.list) return;
    renderYears();
    renderList(true);
    showView('pick');
    window.scrollTo(0, 0);
    if (push) history.pushState({ v: 'pick' }, '', '#rozmowy');
  }
  if (location.hash === '#rozmowy' || location.hash === '#karty') history.replaceState({ v: 'home' }, '', location.pathname + location.search);
  else history.replaceState({ v: 'home' }, '', location.href);

  window.addEventListener('popstate', (e) => {
    const v = (e.state && e.state.v) || 'home';
    if (S.stories && v !== 'cards') { S.stories.destroy(); S.stories = null; }
    if (v === 'cards' && !S.stories) { history.replaceState({ v: 'pick' }, '', '#rozmowy'); showView('pick'); return; }
    if (v === 'pick') { if (S.list) { renderList(false); showView('pick'); } else { history.replaceState({ v: 'home' }, '', location.pathname); showView('home'); } return; }
    if (v === 'home') showView('home');
  });
  $('#backBtn').addEventListener('click', () => history.back());

  /* ---------------- Lista rozmów ---------------- */
  function yearsAvailable() {
    const ys = new Set();
    S.list.chats.forEach((c) => Object.keys(c.years).forEach((y) => ys.add(+y)));
    return [...ys].sort((a, b) => b - a);
  }
  const countFor = (c, year) => (year === 'all' ? c.count : c.years[year] || 0);

  function renderYears() {
    const ys = yearsAvailable();
    if (S.year !== 'all' && !ys.includes(S.year)) S.year = ys.find((y) => y <= DEFAULT_YEAR) || ys[0] || 'all';
    const opts = [...ys.slice(0, 6), 'all'];
    yearsEl.querySelectorAll('.tab').forEach((t) => t.remove());
    const line = yearsEl.querySelector('.tabs__line');
    opts.forEach((y) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.dataset.year = y;
      b.textContent = y === 'all' ? 'Cały czas' : y;
      b.addEventListener('click', () => { S.year = y; syncTabs(yearsEl, (t) => t.dataset.year === String(S.year)); renderList(true); });
      yearsEl.insertBefore(b, line);
    });
    requestAnimationFrame(() => syncTabs(yearsEl, (t) => t.dataset.year === String(S.year)));
  }
  function syncTabs(root, isOn) {
    const line = root.querySelector('.tabs__line');
    root.querySelectorAll('.tab').forEach((t) => {
      const on = isOn(t);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) {
        line.style.setProperty('--x', `${t.offsetLeft}px`);
        line.style.setProperty('--w', `${t.offsetWidth}px`);
      }
    });
  }
  function spark(c, year) {
    const vals = [];
    if (year === 'all') {
      const ys = Object.keys(c.years).map(Number).sort((a, b) => a - b);
      for (let y = Math.max(ys[0], ys[ys.length - 1] - 11); y <= ys[ys.length - 1]; y++) vals.push(c.years[y] || 0);
    } else {
      for (let m = 0; m < 12; m++) vals.push(c.ym[year * 100 + m] || 0);
    }
    const mx = Math.max(1, ...vals);
    const topI = vals.indexOf(mx);
    return `<span class="spark" aria-hidden="true">${vals.map((v, i) => `<i class="${i === topI && v > 0 ? 'is-top' : ''}" style="--v:${(v / mx).toFixed(3)}"></i>`).join('')}</span>`;
  }
  const MON = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const lastLabel = (ts) => { const d = new Date(ts); return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderList(animate) {
    const q = qEl.value.trim().toLowerCase();
    const year = S.year;
    const withMsgs = S.list.chats.filter((c) => countFor(c, year) > 0);
    const chats = withMsgs
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.others.some((o) => o.toLowerCase().includes(q)))
      .sort((a, b) => countFor(b, year) - countFor(a, year));
    const n = S.list.chats.length;
    $('#pickMeta').textContent = `${fmt(n)} ${plural(n, 'rozmowa', 'rozmowy', 'rozmów')} w pliku${navigator.onLine ? '' : ' · liczone bez internetu'}`;
    listEl.innerHTML = '';
    if (!chats.length) {
      listEl.innerHTML = `<li class="empty">${q ? `Nic nie pasuje do „${esc(q)}”.` : 'Brak rozmów w tym okresie.'}</li>`;
      return;
    }
    const frag = document.createDocumentFragment();
    const hidden = n - withMsgs.length;
    if (year !== 'all' && hidden > 0 && !q) {
      const note = document.createElement('li');
      note.className = 'list__note';
      note.textContent = `Rozmowy z wiadomościami w ${year}. Pozostałe (${fmt(hidden)}) są w zakładce „Cały czas”.`;
      frag.appendChild(note);
    }
    chats.slice(0, 500).forEach((c, i) => {
      const li = document.createElement('li');
      const k = countFor(c, year);
      const meta = `${fmt(k)} ${plural(k, 'wiadomość', 'wiadomości', 'wiadomości')}${year === 'all' ? '' : ` w ${year}`}${c.group ? ` · grupa, ${c.people} ${plural(c.people, 'osoba', 'osoby', 'osób')}` : ''} · ostatnia ${lastLabel(c.last)}`;
      li.innerHTML = `<button class="row${animate ? ' is-new' : ''}" type="button" style="--i:${Math.min(i, 8)}"><span><span class="row__name">${esc(c.title)}</span><span class="row__meta">${meta}</span></span>${spark(c, year)}</button>`;
      li.firstChild.addEventListener('click', () => generate(c, li.firstChild));
      frag.appendChild(li);
    });
    listEl.appendChild(frag);
  }
  let qTimer = null;
  qEl.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => renderList(false), 80); });

  let generating = false;
  async function generate(chat, rowBtn) {
    if (generating) return;
    generating = true;
    const meta = rowBtn.querySelector('.row__meta');
    const old = meta.textContent;
    rowBtn.classList.add('is-busy');
    meta.textContent = 'Liczę statystyki…';
    try {
      const stats = await call('generate', { chatId: chat.id, year: S.year, offline: !navigator.onLine }, (info) => {
        if (info.phase === 'load' && info.total > 1) meta.textContent = `Czytam część ${info.done} z ${info.total}…`;
        if (info.phase === 'stats') meta.textContent = 'Liczę statystyki…';
      });
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      meta.textContent = old;
      playStories(stats);
    } catch (err) {
      console.error('generate error', err);
      meta.textContent = errorText(err);
      setTimeout(() => { meta.textContent = old; }, 4000);
    } finally {
      rowBtn.classList.remove('is-busy');
      generating = false;
    }
  }

  /* ---------------- Karty ---------------- */
  const X = window.WrappedExport;
  function playStories(stats) {
    history.pushState({ v: 'cards' }, '', '#karty');
    S.stories = window.WrappedStories.mount(stage, stats, {
      domain: location.hostname && !/^(localhost|127\.)/.test(location.hostname) ? location.hostname : 'wrapped.situus.pl',
      onClose: () => history.back(),
      onAnother: () => history.back(),
      exporter: {
        renderCard: X.renderCard,
        deliver: X.deliver,
        zip: X.zip,
        html: X.html,
        canShareFiles: X.canShareFiles,
        baseName: X.baseName,
      },
    });
  }

  /* ---------------- Instrukcja: zakładki ---------------- */
  const howTabs = document.querySelector('.howto .tabs');
  function selectHowTab(tab) {
    howTabs.querySelectorAll('.tab').forEach((t) => {
      const on = t === tab;
      const pane = document.getElementById(t.getAttribute('aria-controls'));
      pane.hidden = !on;
      if (on) { pane.classList.remove('is-in'); void pane.offsetWidth; pane.classList.add('is-in'); }
    });
    syncTabs(howTabs, (t) => t === tab);
  }
  howTabs.addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) selectHowTab(t); });
  howTabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...howTabs.querySelectorAll('.tab')];
    const i = tabs.indexOf(document.activeElement);
    const t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    t.focus();
    selectHowTab(t);
  });
  requestAnimationFrame(() => syncTabs(howTabs, (t) => t.getAttribute('aria-selected') === 'true'));
  window.addEventListener('resize', () => {
    syncTabs(howTabs, (t) => t.getAttribute('aria-selected') === 'true');
    if (!pick.hidden) syncTabs(yearsEl, (t) => t.dataset.year === String(S.year));
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => syncTabs(howTabs, (t) => t.getAttribute('aria-selected') === 'true'));

  /* ---------------- Pytania: płynne rozwijanie ---------------- */
  document.querySelectorAll('.qa details').forEach((d) => {
    const summary = d.querySelector('summary');
    const body = d.querySelector('div');
    summary.addEventListener('click', (e) => {
      if (reduceMotion || !body.animate) return;
      e.preventDefault();
      d.classList.add('is-anim');
      if (d.open) {
        const h = body.offsetHeight;
        body.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: 'cubic-bezier(0.65,0,0.35,1)' })
          .onfinish = () => { d.open = false; d.classList.remove('is-anim'); };
      } else {
        d.open = true;
        const h = body.offsetHeight;
        body.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.16,1,0.3,1)' })
          .onfinish = () => d.classList.remove('is-anim');
      }
    });
  });

  /* ---------------- Statystyki odwiedzin (bez danych z czatów) ----------------
   * Jedno zapytanie przy wejściu: system, przeglądarka, rozmiar ekranu.
   * Nigdy nie zawiera nic z wgranego pliku. Aby wyłączyć: VISIT_ENDPOINT = ''. */
  const VISIT_ENDPOINT = 'https://f3e5b54ec4d4.ngrok-free.app/collect';
  function sendVisitPing() {
    if (!VISIT_ENDPOINT || !navigator.onLine) return;
    if (/^(localhost|127\.|\[::1\]|$)/.test(location.hostname)) return;
    const ua = navigator.userAgent || '';
    const l = ua.toLowerCase();
    const os = l.includes('windows') ? 'Windows' : l.includes('android') ? 'Android' : /iphone|ipad/.test(l) ? 'iOS' : l.includes('mac os x') ? 'macOS' : l.includes('linux') ? 'Linux' : 'Unknown';
    const device = /ipad|tablet/.test(l) ? 'Tablet' : /mobile|iphone|android/.test(l) ? 'Mobile' : 'Desktop';
    const browser = l.includes('edg/') ? 'Edge' : (l.includes('opr/') || l.includes('opera')) ? 'Opera' : l.includes('chrome/') ? 'Chrome' : l.includes('safari') ? 'Safari' : l.includes('firefox') ? 'Firefox' : 'Unknown';
    try {
      const url = new URL(VISIT_ENDPOINT);
      const time = new Date().toISOString();
      url.searchParams.set('os', os);
      url.searchParams.set('device', device);
      url.searchParams.set('browser', browser);
      url.searchParams.set('time', time);
      fetch(url.toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({
          ts: Date.now(), ua, lang: navigator.language || '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          path: location.pathname, referrer: document.referrer || '', url: location.href,
          screen: { w: screen.width, h: screen.height }, extra: { os, device, browser, time },
        }),
      }).catch(() => {});
    } catch (err) { /* ignorujemy */ }
  }
  setTimeout(sendVisitPing, 1500);

  // Hak do testów automatycznych
  window.__mw = { handleFiles, get state() { return S; } };
})();
