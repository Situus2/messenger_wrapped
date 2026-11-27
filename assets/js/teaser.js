/*
 * Messenger Wrapped — strona zapowiedzi (przed startem w grudniu).
 * Pełna aplikacja jest w app.html; na start wystarczy podmienić ją z index.html.
 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const YEAR = new Date().getFullYear();
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = YEAR; });

  // Poprzednia wersja strony trzymała plik i wyniki w przeglądarce — sprzątamy
  try { indexedDB.deleteDatabase('messenger_wrapped'); } catch (err) { /* brak IndexedDB */ }
  try { localStorage.removeItem('wrappedStats'); sessionStorage.removeItem('wrappedStats'); } catch (err) { /* tryb prywatny */ }

  /* Pas przykładowych kart */
  const demo = window.WRAPPED_DEMO && JSON.parse(JSON.stringify(window.WRAPPED_DEMO));
  if (demo) {
    demo.year = YEAR;
    demo.heat.year = YEAR;
    demo.heat.start = `${YEAR}-01-01`;
    if (new Date(YEAR, 1, 29).getDate() === 29 && demo.heat.days.length === 365) demo.heat.days.push(0);
    if (demo.yoy) demo.yoy.prevYear = YEAR - 1;
    const ids = ['total', 'who', 'emoji', 'days', 'clock', 'personas', 'phrases', 'little', 'months', 'summary'];
    const one = window.WrappedStories.staticCards(demo, ids, { domain: 'wrapped.situus.pl' })
      .map((c) => `<div class="thumb" aria-hidden="true"><div class="st__frame is-static" data-pal="${c.pal}">${c.markup}</div></div>`).join('');
    $('#strip').innerHTML = one + one;
  }

  /* Zakładki instrukcji */
  const tabs = $('.tabs');
  function sync(isOn) {
    const line = tabs.querySelector('.tabs__line');
    tabs.querySelectorAll('.tab').forEach((t) => {
      const on = isOn(t);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) {
        line.style.setProperty('--x', `${t.offsetLeft}px`);
        line.style.setProperty('--w', `${t.offsetWidth}px`);
      }
    });
  }
  function select(tab) {
    tabs.querySelectorAll('.tab').forEach((t) => {
      const pane = document.getElementById(t.getAttribute('aria-controls'));
      pane.hidden = t !== tab;
      if (t === tab) { pane.classList.remove('is-in'); void pane.offsetWidth; pane.classList.add('is-in'); }
    });
    sync((t) => t === tab);
  }
  const current = () => (t) => t.getAttribute('aria-selected') === 'true';
  tabs.addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) select(t); });
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const all = [...tabs.querySelectorAll('.tab')];
    const i = all.indexOf(document.activeElement);
    const t = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    t.focus();
    select(t);
  });
  requestAnimationFrame(() => sync(current()));
  window.addEventListener('resize', () => sync(current()));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sync(current()));

  /* Statystyki odwiedzin (bez danych z czatów). Aby wyłączyć: VISIT_ENDPOINT = ''. */
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
})();
