/*
 * Messenger Wrapped — eksport kart.
 * Karta jest rysowana do PNG 1080×1920 (format relacji Instagrama) przez SVG <foreignObject>:
 * przeglądarka sama renderuje dokładnie ten sam HTML i CSS co na ekranie, z osadzonymi fontami.
 * Wszystko lokalnie, bez bibliotek i bez wysyłania czegokolwiek.
 */
(function () {
  'use strict';

  const VERSION = 4;
  const FRAME_W = 405;
  const FRAME_H = 720;
  const OUT_W = 1080;
  const OUT_H = 1920;
  const FONT_FILES = ['anybody-latin', 'anybody-latin-ext', 'figtree-latin', 'figtree-latin-ext'];

  let assetsPromise = null;

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  /* CSS kart + fonty jako data: URL (wczytywane raz, działa też offline) */
  function loadAssets() {
    if (!assetsPromise) {
      assetsPromise = (async () => {
        const [css, fontCss] = await Promise.all([
          fetch(`assets/css/stories.css?v=${VERSION}`).then((r) => r.text()),
          fetch(`assets/css/fonts.css?v=${VERSION}`).then((r) => r.text()),
        ]);
        const urls = {};
        await Promise.all(FONT_FILES.map(async (name) => {
          const blob = await fetch(`assets/fonts/${name}.woff2`).then((r) => r.blob());
          urls[name] = await blobToDataUrl(blob);
        }));
        const inlineFonts = fontCss.replace(/url\(\.\.\/fonts\/([a-z-]+)\.woff2\)/g, (m, name) => (urls[name] ? `url(${urls[name]})` : m));
        return { css, inlineFonts, stories: null };
      })().catch((err) => { assetsPromise = null; throw err; });
    }
    return assetsPromise;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/ł/g, 'l').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rozmowa';
  }
  function baseName(S) {
    const who = S.group ? S.title : S.people.slice(0, 2).map((p) => p.short).join('-');
    return `messenger-wrapped-${S.year === 'all' ? 'caly-czas' : S.year}-${slug(who)}`;
  }
  function hostLabel() {
    return location.hostname && !/^(localhost|127\.|\[::1\])/.test(location.hostname) ? location.hostname : 'wrapped.situus.pl';
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function renderCard(cardMarkup, pal, S) {
    const a = await loadAssets();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    // Budujemy węzeł w zwykłym DOM, żeby XMLSerializer dał poprawny XHTML (&nbsp;, <br/> itd.)
    const holder = document.createElement('div');
    holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    holder.style.cssText = `width:${FRAME_W}px;height:${FRAME_H}px;margin:0;padding:0;`;
    const style = document.createElement('style');
    style.textContent = `${a.inlineFonts}\n${a.css}\n.st__frame{width:${FRAME_W}px!important;height:${FRAME_H}px!important;border-radius:0!important;box-shadow:none!important;aspect-ratio:auto!important}`;
    holder.appendChild(style);
    const year = S.year === 'all' ? 'od początku' : S.year;
    const frame = document.createElement('div');
    frame.className = 'st__frame is-static is-snap';
    frame.dataset.pal = pal;
    frame.innerHTML = `${cardMarkup}<div class="snap-brand"><span><b>Messenger Wrapped</b> ${esc(year)}</span><span>${esc(hostLabel())}</span></div>`;
    holder.appendChild(frame);

    const xhtml = new XMLSerializer().serializeToString(holder);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${FRAME_W} ${FRAME_H}"><foreignObject x="0" y="0" width="${FRAME_W}" height="${FRAME_H}">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.decoding = 'sync';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    // Safari czasem rysuje fonty dopiero za drugim razem
    for (let i = 0; i < 2; i++) {
      ctx.clearRect(0, 0, OUT_W, OUT_H);
      ctx.drawImage(img, 0, 0, OUT_W, OUT_H);
      if (i === 0) await new Promise((r) => setTimeout(r, 60));
    }
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  }

  /* ---------- ZIP bez kompresji (PNG i tak są skompresowane) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function zip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  /* ---------- Udostępnianie / pobieranie ---------- */
  function canShareFiles() {
    try {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
      return coarse && !!navigator.canShare && navigator.canShare({ files: [probe] });
    } catch (err) {
      return false;
    }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function deliver(blob, name, mode) {
    if (mode === 'share') {
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      try {
        await navigator.share({ files: [file] });
        return null;
      } catch (err) {
        if (err && err.name === 'AbortError') return null;
        download(blob, name);
        return 'Udostępnianie niedostępne, obrazek zapisany';
      }
    }
    download(blob, name);
    if (/\.zip$/.test(name)) return 'Paczka kart zapisana';
    if (/\.html$/.test(name)) return 'Plik HTML zapisany';
    return 'Obrazek zapisany';
  }

  /* ---------- Samodzielny plik HTML z animowanymi kartami ---------- */
  async function html(S) {
    const a = await loadAssets();
    const js = await fetch(`assets/js/stories.js?v=${VERSION}`).then((r) => r.text());
    const data = JSON.stringify(S).replace(/</g, '\\u003c');
    const who = S.group ? S.title : S.people.slice(0, 2).map((p) => p.short).join(' & ');
    const doc = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Messenger Wrapped ${S.year === 'all' ? '' : S.year} — ${esc(who)}</title>
<style>${a.inlineFonts}\n${a.css}\nbody{margin:0;background:#07060c}</style></head>
<body><div id="stage"></div>
<script>${js.replace(/<\/script/gi, '<\\/script')}<\/script>
<script>WrappedStories.mount(document.getElementById('stage'), ${data}, { standalone: true, domain: ${JSON.stringify(hostLabel())} });<\/script>
</body></html>`;
    return new Blob([doc], { type: 'text/html;charset=utf-8' });
  }

  window.WrappedExport = { loadAssets, renderCard, zip, deliver, html, canShareFiles, baseName };
})();
