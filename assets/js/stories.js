/*
 * Messenger Wrapped — karty podsumowania i odtwarzacz w stylu stories.
 * Samodzielny plik: używa go aplikacja i wyeksportowany plik HTML.
 * WrappedStories.mount(element, stats, { onClose, onAnother, onShare, onExport, standalone })
 */
(function () {
  'use strict';

  /* ---------------- Formatowanie po polsku ---------------- */
  const NF = new Map();
  function fmt(n, d = 0) {
    const key = d;
    if (!NF.has(key)) NF.set(key, new Intl.NumberFormat('pl-PL', { maximumFractionDigits: d, minimumFractionDigits: d }));
    return NF.get(key).format(n);
  }
  function plural(n, one, few, many) {
    const v = Math.abs(Math.round(n));
    if (v === 1) return one;
    const t = v % 10;
    const h = v % 100;
    if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return few;
    return many;
  }
  const pct = (x) => Math.round(x * 100);
  const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const MONTH_INI = ['S', 'L', 'M', 'K', 'M', 'C', 'L', 'S', 'W', 'P', 'L', 'G'];
  const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const WD_IN = ['w poniedziałki', 'we wtorki', 'w środy', 'w czwartki', 'w piątki', 'w soboty', 'w niedziele'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    const [y, m, d] = String(v).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function dayLabel(v, withYear) {
    const d = toDate(v);
    return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  }
  function rangeLabel(a, b, withYear) {
    const da = toDate(a);
    const db = toDate(b);
    const y = withYear ? ` ${db.getFullYear()}` : '';
    if (da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()) return `${da.getDate()}–${db.getDate()} ${MONTHS_GEN[db.getMonth()]}${y}`;
    if (da.getFullYear() !== db.getFullYear()) return `${dayLabel(da, true)} – ${dayLabel(db, true)}`;
    return `${dayLabel(da)} – ${dayLabel(db)}${y}`;
  }
  function timeLabel(ts) {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function durShort(sec) {
    if (sec == null) return '—';
    if (sec < 60) return `${Math.round(sec)} s`;
    if (sec < 3600) {
      const m = Math.floor(sec / 60);
      const s = Math.round(sec % 60);
      return m < 10 && s ? `${m} min ${s} s` : `${Math.round(sec / 60)} min`;
    }
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h} godz. ${m} min` : `${h} godz.`;
  }
  function durLong(ms) {
    const sec = ms / 1000;
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    if (days >= 1) return `${days} ${plural(days, 'dzień', 'dni', 'dni')}${hours && days < 7 ? ` ${hours} godz.` : ''}`;
    return durShort(sec);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function words(text, baseDelay) {
    return esc(text).split(/(\s+)/).map((w, i) => (w.trim() ? `<span class="w" style="--i:${i >> 1}">${w}</span>` : w)).join('');
  }
  function counter(n, opts = {}) {
    const d = opts.dec || 0;
    const final = (opts.prefix || '') + fmt(n, d) + (opts.suffix || '');
    return `<div class="hero ${opts.cls || ''}" data-a="${opts.a || 'stretch'}" style="--d:${opts.d || 0}ms;--chars:${final.length}" data-count="${n}" data-dec="${d}" data-suffix="${esc(opts.suffix || '')}" data-prefix="${esc(opts.prefix || '')}">${esc(final)}</div>`;
  }

  /* ---------------- Dekoracje: dymki czatu w tle ---------------- */
  const BLOBS = [
    [{ w: 92, h: 70, t: -14, r: -38, f: 'r' }, { w: 40, h: 30, b: 8, l: -12 }],
    [{ w: 70, h: 54, b: -10, r: -22 }, { w: 30, h: 24, t: 10, l: -8, f: 'ring' }],
    [{ w: 110, h: 84, b: -40, l: -40 }, { w: 34, h: 26, t: 12, r: 6, f: 'r' }],
    [{ w: 76, h: 58, t: -8, l: -34, f: 'r' }, { w: 50, h: 38, b: -6, r: -16, f: 'ring' }],
    [{ w: 64, h: 50, t: 22, r: -30 }, { w: 82, h: 62, b: -28, l: -30, f: 'r' }],
    [{ w: 96, h: 72, t: -30, r: -20 }],
  ];
  function deco(i) {
    const set = BLOBS[i % BLOBS.length];
    return set.map((b, k) => {
      const pos = ['t', 'b', 'l', 'r'].filter((x) => b[x] != null).map((x) => `${{ t: 'top', b: 'bottom', l: 'left', r: 'right' }[x]}:${b[x]}cqh`).join(';')
        .replace(/(left|right):(-?\d+)cqh/g, '$1:$2cqw');
      const cls = b.f === 'r' ? 'blob blob--r' : b.f === 'ring' ? 'blob blob--ring' : 'blob';
      return `<i class="${cls}" style="width:${b.w}cqw;height:${b.h}cqw;${pos};--bd:${k * 160}ms;--by:${k % 2 ? -50 : 60}px;--bx:${k % 2 ? 30 : -20}px;--fx:${k % 2 ? -12 : 10}px;--fy:${k % 2 ? 14 : -12}px"></i>`;
    }).join('');
  }

  /* ---------------- Teksty zależne od rodzaju rozmowy ---------------- */
  function ctx(S) {
    const all = S.year === 'all';
    const firstYear = new Date(S.range.firstEver).getFullYear();
    const P = S.people;
    return {
      all,
      Y: all ? 'cały czas' : String(S.year),
      inY: all ? `Od ${firstYear}` : `W ${S.year}`,
      group: S.group,
      where: S.group ? 'w tej grupie' : 'w waszej rozmowie',
      P,
      A: P[0],
      B: P[1],
      duo: P.length === 2,
      names: S.group ? S.title : P.length >= 2 ? `${P[0].short} & ${P[1].short}` : P[0].short,
    };
  }

  /* ---------------- Karty ---------------- */
  const CARDS = [];
  const card = (id, pal, fn, dur) => CARDS.push({ id, pal, fn, dur: dur || 7500 });

  card('intro', 'night', (S, c) => {
    const yr = c.all ? 'Od początku' : String(S.year);
    return `
    <div class="thread">
      <div class="bubble" data-a="rise" style="--d:150ms">${c.group ? 'Ile było tych wiadomości w grupie?' : 'Ej, ile było tych wiadomości w tym roku?'}</div>
      <div class="tb tb--soft" data-a="rise" data-tb data-wait="1100" style="--d:800ms;align-self:flex-end"><span class="tb__dots"><i></i><i></i><i></i></span><span class="tb__text">Zaraz zobaczysz</span></div>
    </div>
    <div class="intro-year" data-a="stretch-wide" style="--d:2200ms;--chars:${yr.length}">${esc(yr)}</div>
    <div class="big-name" style="--d:2700ms">${words(c.names)}</div>
    <p class="txt" data-a="rise" style="--d:3300ms">Messenger Wrapped${c.group ? ` · ${S.people.length} ${plural(S.people.length, 'osoba', 'osoby', 'osób')} w grupie` : ''}</p>
  `;
  }, 6500);

  card('first', 'lilac', (S, c) => {
    const f = S.first;
    const mediaLabel = { photo: 'wysłane zdjęcie', video: 'wysłany film', audio: 'wiadomość głosowa', gif: 'wysłany GIF', sticker: 'naklejka', link: 'link' }[f.media] || 'załącznik';
    const short = (S.people.find((p) => p.name === f.s) || { short: f.s }).short;
    const emojiOnly = !!f.t && f.t.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u.test(f.t);
    return `
      <div class="lead">${words(c.all ? 'Tak to się zaczęło' : `Tak zaczął się ${c.group ? 'ten' : 'wasz'} ${S.year}`)}</div>
      <div class="thread" style="margin-top:10px">
        <div class="who" data-a="fade" style="--d:600ms">${esc(short)}</div>
        <div class="tb tb--soft" data-a="rise" data-tb data-wait="1400" data-grow="bubble" style="--d:700ms"><span class="tb__dots"><i></i><i></i><i></i></span><span class="tb__text"></span></div>
        <div class="bubble ${emojiOnly ? 'bubble--emoji' : 'bubble--grad'}" data-a="${emojiOnly ? 'pop' : 'rise'}" data-after-tb style="--d:0ms;display:none">${f.t ? esc(f.t) : `<i>${mediaLabel}</i>`}</div>
      </div>
      <p class="txt" data-a="rise" style="--d:2400ms">${cap(dayLabel(f.ts, c.all))}, godz. ${timeLabel(f.ts)}.</p>
    `;
  });

  card('total', 'blue', (S, c) => {
    const per = S.perDay >= 1 ? `Średnio <b>${fmt(S.perDay, S.perDay < 10 ? 1 : 0)}</b> dziennie.` : `Średnio <b>${fmt(S.perDay * 7, 1)}</b> w tygodniu.`;
    let chip = '';
    if (S.yoy) {
      const ch = Math.round(Math.abs(S.yoy.change) * 100);
      if (ch >= 1) chip = `<span class="chip" data-a="pop" style="--d:2600ms">o ${ch}% ${S.yoy.change > 0 ? 'więcej' : 'mniej'} niż w ${S.yoy.prevYear}</span>`;
      else chip = `<span class="chip" data-a="pop" style="--d:2600ms">tyle samo co w ${S.yoy.prevYear}</span>`;
    }
    return `
      <div class="lead">${words(`${c.inY} ${c.where} padło`)}</div>
      ${counter(S.total, { d: 500 })}
      <div class="unit" data-a="rise" style="--d:900ms">${plural(S.total, 'wiadomość', 'wiadomości', 'wiadomości')}</div>
      <p class="txt" data-a="rise" style="--d:1900ms">${per}</p>
      ${chip}
    `;
  });

  card('words', 'violet', (S, c) => {
    if (S.words < 120) return null;
    const pages = Math.round(S.words / 300);
    const longer = c.duo && Math.abs(c.A.avgWords - c.B.avgWords) >= 0.3 ? (c.A.avgWords > c.B.avgWords ? c.A : c.B) : null;
    return `
      <div class="lead">${words('To razem')}</div>
      ${counter(S.words, { d: 400 })}
      <div class="unit" data-a="rise" style="--d:800ms">${plural(S.words, 'słowo', 'słowa', 'słów')}</div>
      ${pages >= 2 ? `<p class="txt" data-a="rise" style="--d:1800ms">Po wydrukowaniu: książka na <b>${fmt(pages)} ${plural(pages, 'stronę', 'strony', 'stron')}</b>.</p>` : ''}
      ${longer ? `<p class="txt" data-a="rise" style="--d:2600ms">Dłuższe wiadomości pisze <b>${esc(longer.short)}</b>: średnio ${fmt(longer.avgWords, 1)} ${plural(longer.avgWords, 'słowo', 'słowa', 'słowa')} na wiadomość.</p>` : ''}
    `;
  });

  card('who', 'pink', (S, c) => {
    if (S.people.length < 2) return null;
    const list = S.people.slice(0, 5);
    const max = list[0].count;
    const tie = c.duo && Math.abs(c.A.share - c.B.share) < 0.02;
    const rows = list.map((p, i) => `
      <div class="duel__row ${i === 0 && !c.duo ? 'is-lead' : ''}" data-a="rise" style="--d:${2200 + i * 120}ms">
        <div class="duel__head"><span class="duel__name">${esc(p.short)}</span><span class="duel__val">${fmt(p.count)}</span></div>
        <div class="duel__track"><div class="duel__fill" style="--v:${(p.count / max).toFixed(4)};--d:${2300 + i * 120}ms"></div></div>
      </div>`).join('');
    return `
      <div class="lead">${words(c.group ? 'Kto pisze najwięcej?' : 'Kto pisze więcej?')}</div>
      <div><div class="tb" data-a="rise" data-tb data-wait="1100" style="--d:500ms"><span class="tb__dots"><i></i><i></i><i></i></span><span class="tb__text">${tie ? 'Remis!' : esc(list[0].short)}</span></div></div>
      <div class="duel">${rows}</div>
      <p class="txt" data-a="rise" style="--d:3100ms">${tie
        ? `Piszecie praktycznie po równo: <b>${pct(c.A.share)}%</b> do <b>${pct(c.B.share)}%</b>.`
        : `<b>${esc(list[0].short)}</b> to ${fmt(list[0].share * 100, 1)}% wszystkich wiadomości${c.group ? ' w grupie' : ''}.`}</p>
    `;
  });

  card('months', 'coral', (S, c) => {
    const series = S.months;
    const nonzero = series.filter((x) => x.n > 0).length;
    if (S.bestMonth == null || nonzero < 2) return null;
    const max = Math.max(...series.map((x) => x.n));
    const best = series[S.bestMonth];
    const isYears = S.monthsMode === 'years';
    const bars = series.map((x, i) => `<div class="${i === S.bestMonth ? 'is-best' : ''}" style="--i:${i}"><b style="--v:${(x.n / max).toFixed(4)}"></b><span>${isYears ? esc(String(x.label).slice(2)) : MONTH_INI[i]}</span></div>`).join('');
    return `
      <div class="lead">${words(isYears ? 'Najlepszy rok' : 'Najgorętszy miesiąc')}</div>
      <div class="big-name" data-a="stretch" style="--d:500ms">${isYears ? esc(best.label) : cap(MONTHS[S.bestMonth])}</div>
      <p class="txt" data-a="rise" style="--d:900ms"><b>${fmt(best.n)}</b> ${plural(best.n, 'wiadomość', 'wiadomości', 'wiadomości')}.</p>
      <div class="bars" style="--n:${series.length};--d:1200ms;margin-top:8px">${bars}</div>
      <p class="txt" data-a="rise" style="--d:2400ms">Rekordowy dzień: <b>${dayLabel(S.busiestDay.date, isYears)}</b>, ${fmt(S.busiestDay.n)} ${plural(S.busiestDay.n, 'wiadomość', 'wiadomości', 'wiadomości')}.</p>
    `;
  }, 8000);

  card('days', 'lilac', (S, c) => {
    const H = S.heat;
    const start = toDate(H.start);
    const max = Math.max(1, ...H.days);
    let rows = '';
    let idx = 0;
    for (let mo = 0; mo < 12; mo++) {
      const dim = new Date(start.getFullYear(), mo + 1, 0).getDate();
      let cells = '';
      for (let d = 0; d < dim; d++, idx++) {
        const n = H.days[idx] || 0;
        const future = idx >= H.cutoff;
        let attr;
        if (future) attr = 'data-l="f" style="--i:' + idx + ';--o:1;--s:0.55"';
        else if (!n) attr = 'data-l="0" style="--i:' + idx + ';--o:1;--s:0.5"';
        else {
          const lv = Math.min(1, Math.sqrt(n / max));
          attr = `style="--i:${idx};--o:${(0.35 + lv * 0.65).toFixed(2)};--s:${(0.62 + lv * 0.38).toFixed(2)}"`;
        }
        cells += `<i ${attr}></i>`;
      }
      rows += `<div class="year__row"><span>${MONTH_SHORT[mo]}</span>${cells}</div>`;
    }
    const of = c.all
      ? `w ${H.year}. Od początku: ${fmt(S.activeDays)} ${plural(S.activeDays, 'dzień', 'dni', 'dni')} z wiadomościami.`
      : `na ${fmt(S.periodDays)} ${plural(S.periodDays, 'dzień', 'dni', 'dni')} ${S.periodDays < 365 ? 'tego roku do dziś' : 'w roku'}`;
    const activeInHeat = c.all ? H.days.filter((n) => n > 0).length : S.activeDays;
    return `
      <div class="lead">${words('Rozmowa żyła przez')}</div>
      ${counter(activeInHeat, { d: 400, cls: 'hero--sm', suffix: ` ${plural(activeInHeat, 'dzień', 'dni', 'dni')}` })}
      <p class="txt" data-a="rise" style="--d:800ms">${of}</p>
      <div class="year" style="--d:1100ms">${rows}</div>
      ${S.streak.len >= 3 ? `<p class="txt" data-a="rise" style="--d:2900ms">Najdłuższa seria: <b>${fmt(S.streak.len)} ${plural(S.streak.len, 'dzień', 'dni', 'dni')} z rzędu</b> (${rangeLabel(S.streak.from, S.streak.to, c.all)}).</p>` : ''}
    `;
  }, 8500);

  card('clock', 'night', (S, c) => {
    const max = Math.max(1, ...S.byHour);
    const R0 = 34;
    const R1 = 49;
    let lines = '';
    S.byHour.forEach((n, h) => {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      const len = Math.max(1.5, (n / max) * (R1 - R0));
      const x1 = 50 + Math.cos(a) * R0;
      const y1 = 50 + Math.sin(a) * R0;
      const x2 = 50 + Math.cos(a) * (R0 + len);
      const y2 = 50 + Math.sin(a) * (R0 + len);
      const cls = h === S.peakHour ? 'is-peak' : h < 5 ? 'is-night' : '';
      lines += `<line class="${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" pathLength="1" stroke-dasharray="1" style="--i:${h};--len:1;stroke-width:3.4"/>`;
    });
    const labels = [[0, '0'], [6, '6'], [12, '12'], [18, '18']].map(([h, t]) => {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      return `<text x="${(50 + Math.cos(a) * 55).toFixed(1)}" y="${(50 + Math.sin(a) * 55 + 1.6).toFixed(1)}" text-anchor="middle" style="font-size:4.6px">${t}</text>`;
    }).join('');
    const nightTotal = S.people.reduce((a, p) => a + p.night, 0);
    const nightShare = nightTotal / S.total;
    const owl = [...S.people].sort((a, b) => b.nightShare - a.nightShare)[0];
    return `
      <div class="lead">${words(c.group ? 'Godzina tej grupy' : 'Wasza godzina')}</div>
      <div class="clock" style="--d:500ms">
        <svg viewBox="0 0 100 100" aria-hidden="true">${lines}${labels}</svg>
        <div class="clock__mid"><div class="hero" data-a="stretch" style="--d:1300ms;--chars:5">${S.peakHour}:00</div></div>
      </div>
      <p class="txt" data-a="rise" style="--d:1900ms">Wtedy pada najwięcej wiadomości. Najczęściej piszecie <b>${WD_IN[S.favWeekday]}</b>.</p>
      ${nightShare >= 0.02 ? `<p class="txt" data-a="rise" style="--d:2600ms">Po północy: <b>${pct(nightShare)}%</b> wiadomości${S.people.length > 1 ? ` — najczęściej nie śpi <b>${esc(owl.short)}</b>` : ''}.</p>` : ''}
    `;
  }, 8000);

  card('speed', 'blue', (S, c) => {
    const ppl = S.people.filter((p) => p.respMedian != null).sort((a, b) => a.respMedian - b.respMedian).slice(0, 4);
    if (ppl.length < 2) return null;
    const rows = ppl.map((p, i) => `
      <div class="duel__row" data-a="rise" style="--d:${500 + i * 200}ms">
        <div class="duel__head"><span class="duel__name">${esc(p.short)}</span></div>
        <div><div class="tb ${i ? 'tb--soft' : ''}" data-tb data-wait="${1300 + i * 500}" style="--d:${500 + i * 200}ms"><span class="tb__dots"><i></i><i></i><i></i></span><span class="tb__text">${durShort(p.respMedian)}</span></div></div>
      </div>`).join('');
    const f = ppl[0];
    const fastPart = f.respFast != null && f.respFast >= 0.1 ? ` W ${pct(f.respFast)}% przypadków w mniej niż minutę.` : '';
    return `
      <div class="lead">${words(c.group ? 'Kto odpisuje najszybciej?' : 'Kto odpisuje szybciej?')}</div>
      <div class="duel">${rows}</div>
      <p class="txt" data-a="rise" style="--d:${2400 + ppl.length * 300}ms"><b>${esc(f.short)}</b> zwykle odpisuje w ${durShort(f.respMedian)}.${fastPart}</p>
      <p class="note" data-a="rise" style="--d:${2700 + ppl.length * 300}ms">Mediana czasu odpowiedzi. Przerwy dłuższe niż 6 godzin nie są liczone.</p>
    `;
  }, 8500);

  card('starters', 'pink', (S, c) => {
    if (S.sessions < 8 || S.people.length < 2) return null;
    if (c.duo) {
      const a = c.A.starters / S.sessions;
      const lead = c.A.starters >= c.B.starters ? c.A : c.B;
      const ender = c.A.enders >= c.B.enders ? c.A : c.B;
      const enderShare = ender.enders / Math.max(1, c.A.enders + c.B.enders);
      return `
        <div class="lead">${words('Kto zaczyna rozmowę?')}</div>
        <div class="big-name" data-a="stretch" style="--d:500ms">${esc(lead.short)}</div>
        <div class="split" data-a="fade" style="--d:1000ms;margin-top:10px">
          <div style="--v:${a.toFixed(3)};--d:1100ms">${pct(a)}%</div><div style="--v:${(1 - a).toFixed(3)};--d:1100ms">${pct(1 - a)}%</div>
        </div>
        <div class="split-legend" data-a="fade" style="--d:1300ms"><span>${esc(c.A.short)}</span><span>${esc(c.B.short)}</span></div>
        <p class="txt" data-a="rise" style="--d:2200ms"><b>${fmt(S.sessions)}</b> ${plural(S.sessions, 'rozmowa', 'rozmowy', 'rozmów')} w tym okresie. Ostatnie słowo najczęściej ma <b>${esc(ender.short)}</b> (${pct(enderShare)}%).</p>
        <p class="note" data-a="rise" style="--d:2600ms">Nowa rozmowa to pierwsza wiadomość po co najmniej 6 godzinach ciszy.</p>
      `;
    }
    const list = [...S.people].sort((a, b) => b.starters - a.starters).slice(0, 5);
    const max = list[0].starters || 1;
    return `
      <div class="lead">${words('Kto rozkręca grupę?')}</div>
      <div class="big-name" data-a="stretch" style="--d:500ms">${esc(list[0].short)}</div>
      <div class="duel">${list.map((p, i) => `
        <div class="duel__row ${i === 0 ? 'is-lead' : ''}" data-a="rise" style="--d:${1100 + i * 120}ms">
          <div class="duel__head"><span class="duel__name">${esc(p.short)}</span><span class="duel__val">${pct(p.starters / S.sessions)}%</span></div>
          <div class="duel__track"><div class="duel__fill" style="--v:${(p.starters / max).toFixed(4)};--d:${1200 + i * 120}ms"></div></div>
        </div>`).join('')}</div>
      <p class="note" data-a="rise" style="--d:2400ms">Odsetek rozmów zaczętych po co najmniej 6 godzinach ciszy.</p>
    `;
  }, 8000);

  card('emoji', 'violet', (S, c) => {
    if (S.emoji.length < 3) return null;
    const [e1, e2, e3, ...rest] = S.emoji;
    const col = (e, k, d) => `<div><span class="e" data-a="pop" style="--d:${d + 500}ms">${esc(e.e)}</span><span class="col" style="--d:${d}ms">${fmt(e.n)}</span></div>`;
    const per = c.duo && c.A.topEmoji[0] && c.B.topEmoji[0]
      ? `<p class="txt" data-a="rise" style="--d:2800ms">${esc(c.A.short)}: <b>${esc(c.A.topEmoji[0].e)}</b> &nbsp;·&nbsp; ${esc(c.B.short)}: <b>${esc(c.B.topEmoji[0].e)}</b></p>` : '';
    return `
      <div class="lead">${words(c.all ? 'Wasze emoji' : `Emoji roku ${S.year}`)}</div>
      <div class="podium">${col(e2, 2, 900)}${col(e1, 1, 1300)}${col(e3, 3, 600)}</div>
      ${rest.length ? `<div class="rest" data-a="rise" style="--d:2200ms">${rest.map((e) => `<span><span class="e2">${esc(e.e)}</span>${fmt(e.n)}</span>`).join('')}</div>` : ''}
      <p class="txt" data-a="rise" style="--d:2500ms">Łącznie <b>${fmt(S.emojiTotal)}</b> emoji i emotek.</p>
      ${per}
    `;
  });

  card('vocab', 'coral', (S, c) => {
    if (c.duo) {
      const pick = (p) => (p.signature.length >= 2 ? p.signature : p.topWords).slice(0, 3);
      const a = pick(c.A);
      const b = pick(c.B);
      if (a.length < 2 || b.length < 2) return null;
      const sig = c.A.signature.length >= 2 && c.B.signature.length >= 2;
      const list = (p, arr, d) => `<div class="wlist"><h3 data-a="fade" style="--d:${d}ms">${esc(p.short)}</h3>${arr.map((x, i) => `<div class="wd" data-a="rise" style="--d:${d + 200 + i * 250}ms">${esc(x.w)}<small>${fmt(x.n)}×</small></div>`).join('')}</div>`;
      return `
        <div class="lead">${words(sig ? 'Słowa, po których was poznać' : 'Wasze słowa roku')}</div>
        <div class="cols" style="margin-top:10px">${list(c.A, a, 700)}${list(c.B, b, 1500)}</div>
        <p class="note" data-a="rise" style="--d:2900ms">${sig ? 'Słowa, których jedna osoba używa wyraźnie częściej niż druga.' : 'Najczęstsze słowa bez spójników i zaimków.'}</p>
      `;
    }
    const w = S.words_top.slice(0, 6);
    if (w.length < 3) return null;
    return `
      <div class="lead">${words(c.group ? 'Słowa tej grupy' : 'Słowa roku')}</div>
      <div class="cols" style="margin-top:10px">
        <div class="wlist">${w.slice(0, 3).map((x, i) => `<div class="wd" data-a="rise" style="--d:${600 + i * 220}ms">${esc(x.w)}<small>${fmt(x.n)}×</small></div>`).join('')}</div>
        <div class="wlist">${w.slice(3).map((x, i) => `<div class="wd" data-a="rise" style="--d:${1300 + i * 220}ms">${esc(x.w)}<small>${fmt(x.n)}×</small></div>`).join('')}</div>
      </div>
      <p class="note" data-a="rise" style="--d:2500ms">Najczęstsze słowa bez spójników i zaimków.</p>
    `;
  });

  card('phrases', 'lilac', (S) => {
    if (S.phrases.length < 3) return null;
    return `
      <div class="lead">${words('Najczęstsze teksty')}</div>
      <div class="phr" style="margin-top:10px">${S.phrases.slice(0, 4).map((p, i) => `
        <div class="row" data-a="rise" style="--d:${600 + i * 420}ms"><span class="bubble">${esc(p.t)}</span><span class="cnt">${fmt(p.n)} ${plural(p.n, 'raz', 'razy', 'razy')}</span></div>`).join('')}
      </div>
    `;
  });

  card('little', 'night', (S, c) => {
    if (S.little.length < 2) return null;
    const rows = S.little.slice(0, 4).map((x, i) => {
      const split = c.duo ? `<div class="lw__bar"><i style="--v:${x.by[0]};--d:${900 + i * 300}ms"></i><i style="--v:${x.by[1]};--d:${900 + i * 300}ms"></i></div>` : '';
      return `<div class="lw__row" data-a="rise" style="--d:${500 + i * 300}ms"><span class="lw__w">„${esc(x.label)}”</span><span class="lw__n">${fmt(x.n)}</span>${split}</div>`;
    }).join('');
    return `
      <div class="lead">${words('Ile razy padło…')}</div>
      <div class="lw" style="margin-top:8px">${rows}</div>
      ${c.duo ? `<div class="legend" data-a="fade" style="--d:2000ms"><span>${esc(c.A.short)}</span><span>${esc(c.B.short)}</span></div>` : ''}
      ${S.laughs >= 20 ? `<p class="txt" data-a="rise" style="--d:2400ms">A śmiechu (haha, xD, 😂) było w <b>${fmt(S.laughs)}</b> ${plural(S.laughs, 'wiadomości', 'wiadomościach', 'wiadomościach')}.</p>` : ''}
    `;
  }, 8000);

  card('media', 'blue', (S) => {
    const m = S.media;
    const items = [
      [m.photos, 'zdjęcie', 'zdjęcia', 'zdjęć'],
      [m.videos, 'film', 'filmy', 'filmów'],
      [m.audio, 'głosówka', 'głosówki', 'głosówek'],
      [m.gifs, 'GIF', 'GIF-y', 'GIF-ów'],
      [m.stickers, 'naklejka', 'naklejki', 'naklejek'],
      [m.links, 'link', 'linki', 'linków'],
    ].filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 6);
    const sum = items.reduce((a, x) => a + x[0], 0);
    if (sum < 10 && S.calls.n === 0) return null;
    const tiles = items.map((x, i) => `<div class="tile" data-a="rise" style="--d:${500 + i * 160}ms">${counter(x[0], { d: 500 + i * 160, a: 'fade' })}<p>${plural(x[0], x[1], x[2], x[3])}</p></div>`).join('');
    const calls = S.calls.n
      ? `<p class="txt" data-a="rise" style="--d:2200ms"><b>${fmt(S.calls.n)}</b> ${plural(S.calls.n, 'połączenie', 'połączenia', 'połączeń')}, razem <b>${durShort(S.calls.sec)}</b>.${S.calls.longest >= 300 ? ` Najdłuższe: ${durShort(S.calls.longest)}.` : ''}</p>` : '';
    return `
      <div class="lead">${words('Nie tylko tekst')}</div>
      <div class="tiles" style="margin-top:8px">${tiles}</div>
      ${calls}
    `;
  });

  card('reactions', 'pink', (S, c) => {
    const R = S.reactions;
    if (R.total < 10) return null;
    const giver = [...S.people].sort((a, b) => b.reactGiven - a.reactGiven)[0];
    return `
      <div class="lead">${words('Reakcje')}</div>
      ${counter(R.total, { d: 400, suffix: '' })}
      <div class="unit" data-a="rise" style="--d:800ms">${plural(R.total, 'reakcja', 'reakcje', 'reakcji')} na wiadomości</div>
      <div class="rest" data-a="rise" style="--d:1500ms;justify-content:flex-start;gap:22px;margin-top:6px">${R.top.map((e) => `<span><span class="e2" style="font-size:38px">${esc(e.e)}</span>${fmt(e.n)}</span>`).join('')}</div>
      ${S.people.length > 1 ? `<p class="txt" data-a="rise" style="--d:2200ms">Najczęściej reaguje <b>${esc(giver.short)}</b> (${fmt(giver.reactGiven)}).</p>` : ''}
      ${R.most && c.group ? `<div class="thread" data-a="rise" style="--d:2800ms"><div class="who">${esc((S.people.find((p) => p.name === R.most.s) || { short: R.most.s }).short)} · ${fmt(R.most.n)} ${plural(R.most.n, 'reakcja', 'reakcje', 'reakcji')}</div><div class="bubble">${esc(R.most.t)}</div></div>` : ''}
    `;
  });

  card('facts', 'coral', (S) => {
    const facts = [];
    const shortOf = (name) => (S.people.find((p) => p.name === name) || { short: name }).short;
    const box = (d, num, text) => `<div class="fact" data-a="rise" style="--d:${d}ms">${num}<p>${text}</p></div>`;
    if (S.monologue) facts.push((d) => box(d, counter(S.monologue.len, { a: 'fade', d }),
      `${plural(S.monologue.len, 'wiadomość', 'wiadomości', 'wiadomości')} z rzędu bez odpowiedzi. Monolog roku: <b>${esc(shortOf(S.monologue.who))}</b>, ${dayLabel(S.monologue.ts)}.`));
    if (S.longestGap && S.longestGap.ms >= 36 * 3600e3) {
      const g = durLong(S.longestGap.ms);
      facts.push((d) => box(d, `<div class="hero" data-a="fade" style="--d:${d}ms;--chars:${g.length}">${g}</div>`, `tyle trwała najdłuższa cisza (${rangeLabel(S.longestGap.from, S.longestGap.to, S.year === 'all')}).`));
    }
    const unsent = S.people.filter((p) => p.unsent > 0).sort((a, b) => b.unsent - a.unsent);
    const unsentTotal = unsent.reduce((a, p) => a + p.unsent, 0);
    if (unsentTotal >= 3) facts.push((d) => box(d, counter(unsentTotal, { a: 'fade', d }),
      `${plural(unsentTotal, 'cofnięta wiadomość', 'cofnięte wiadomości', 'cofniętych wiadomości')}. Najwięcej cofa <b>${esc(unsent[0].short)}</b>.`));
    const qs = [...S.people].sort((a, b) => b.questions - a.questions)[0];
    if (facts.length < 3 && qs && qs.questions >= 20) facts.push((d) => box(d, counter(qs.questions, { a: 'fade', d }),
      `${plural(qs.questions, 'pytanie zadaje', 'pytania zadaje', 'pytań zadaje')} <b>${esc(qs.short)}</b>.`));
    if (facts.length < 2) return null;
    return `
      <div class="lead">${words('Drobiazgi, które nie umknęły')}</div>
      <div class="facts" style="margin-top:6px">${facts.slice(0, 3).map((f, i) => f(600 + i * 650)).join('')}</div>
    `;
  }, 8500);

  const PERSONA_COPY = {
    night: ['Najlepsze rozmowy zaczynają się po północy.', (v) => `<b>${pct(v)}%</b> wiadomości między północą a 5:00`],
    morning: ['Kawa jeszcze się parzy, a wiadomości już lecą.', (v) => `<b>${pct(v)}%</b> wiadomości przed 9:00`],
    fast: ['Odpisuje, zanim ekran zdąży zgasnąć.', (v) => `zwykle odpisuje w <b>${durShort(v)}</b>`],
    essay: ['Jedna wiadomość, trzy akapity.', (v) => `średnio <b>${fmt(v, 1)}</b> słowa na wiadomość`],
    burst: ['Pięć krótkich wiadomości zamiast jednej długiej.', (v) => `średnio <b>${fmt(v, 1)}</b> wiadomości z rzędu`],
    emoji: ['Słowa są przereklamowane.', (v) => `<b>${fmt(v.n)}</b> emoji${v.top ? `, najczęściej ${esc(v.top)}` : ''}`],
    starter: ['Zwykle od tej osoby wszystko się zaczyna.', (v) => `zaczyna <b>${pct(v)}%</b> rozmów`],
    laugh: ['Zawsze ma w zanadrzu jakieś „hahaha”.', (v) => `śmiech w <b>${pct(v)}%</b> wiadomości`],
    photo: ['Woli pokazać, niż opisać.', (v) => `<b>${fmt(v)}</b> ${plural(v, 'zdjęcie lub film', 'zdjęcia i filmy', 'zdjęć i filmów')}`],
    voice: ['Po co pisać, skoro można nagrać.', (v) => `<b>${fmt(v)}</b> ${plural(v, 'wiadomość głosowa', 'wiadomości głosowe', 'wiadomości głosowych')}`],
    react: ['Na każdą wiadomość ma reakcję.', (v) => `<b>${fmt(v)}</b> ${plural(v, 'reakcja', 'reakcje', 'reakcji')}`],
    curious: ['Zawsze ma jeszcze jedno pytanie.', (v) => `<b>${pct(v)}%</b> wiadomości to pytania`],
    regular: ['Zawsze jest, zawsze odpisze.', (v) => `<b>${fmt(v)}</b> ${plural(v, 'wiadomość', 'wiadomości', 'wiadomości')}`],
  };

  card('personas', 'violet', (S, c) => {
    const list = S.personas.slice(0, c.group ? 4 : 2);
    const shortOf = (name) => (S.people.find((p) => p.name === name) || { short: name }).short;
    return `
      <div class="lead">${words(list.length > 1 ? 'Wasze typy rozmówców' : 'Typ rozmówcy')}</div>
      <div style="margin-top:8px">${list.map((p, i) => {
        const copy = PERSONA_COPY[p.id] || PERSONA_COPY.regular;
        return `<div class="persona" data-a="rise" style="--d:${700 + i * 900}ms">
          <span class="persona__who">${esc(shortOf(p.who))}</span>
          <span class="persona__name">${esc(p.name)}</span>
          <span class="persona__why">${copy[0]} <b>${cap(copy[1](p.value).replace(/<\/?b>/g, ''))}</b>.</span>
        </div>`;
      }).join('')}</div>
    `;
  }, 8500);

  card('summary', 'night', (S, c, opts) => {
    const best = S.bestMonth != null ? (S.monthsMode === 'years' ? S.months[S.bestMonth].label : cap(MONTHS[S.bestMonth])) : '—';
    const domain = (opts && opts.domain) || 'wrapped.situus.pl';
    const actions = opts && opts.standalone
      ? `<div class="actions"><button class="act act--main" data-act="replay">Obejrzyj jeszcze raz</button></div>`
      : `<div class="actions" data-a="rise" style="--d:900ms">
          <button class="act act--main" data-act="share">Udostępnij na relację</button>
          <div class="actions__row"><button class="act" data-act="another">Inna rozmowa</button><button class="act" data-act="replay">Od początku</button></div>
        </div>`;
    return `
      <div class="sum">
        <div class="sum__title" data-a="rise" style="--d:100ms">${esc(c.names)}</div>
        <div class="lead" data-a="rise" style="--d:200ms;font-size:clamp(20px,6cqw,28px)">Messenger Wrapped <em>${c.all ? 'od początku' : esc(S.year)}</em></div>
        <dl class="sum__grid" data-a="rise" style="--d:350ms">
          <div><dt>Wiadomości</dt><dd>${fmt(S.total)}</dd></div>
          <div><dt>Słowa</dt><dd>${fmt(S.words)}</dd></div>
          <div><dt>Dni z wiadomościami</dt><dd>${fmt(S.activeDays)}</dd></div>
          <div><dt>Najlepszy ${S.monthsMode === 'years' ? 'rok' : 'miesiąc'}</dt><dd>${esc(best)}</dd></div>
          <div><dt>${c.group ? 'Godzina grupy' : 'Wasza godzina'}</dt><dd>${S.peakHour}:00</dd></div>
          <div><dt>Najdłuższa seria</dt><dd>${fmt(S.streak.len)} ${plural(S.streak.len, 'dzień', 'dni', 'dni')}</dd></div>
          ${S.emoji.length ? `<div class="wide"><dt>Emoji</dt><dd>${S.emoji.slice(0, 5).map((e) => esc(e.e)).join(' ')}</dd></div>` : ''}
          ${S.personas.length ? `<div class="wide"><dt>Typy rozmówców</dt><dd style="font-size:clamp(18px,5.4cqw,24px)">${S.personas.slice(0, c.group ? 3 : 2).map((p) => `${esc((S.people.find((x) => x.name === p.who) || { short: p.who }).short)}: ${esc(p.name)}`).join('<br>')}</dd></div>` : ''}
        </dl>
        <div class="sum__foot" data-a="fade" style="--d:500ms"><span>${esc(domain)}</span><span>${S.offline ? 'Policzone bez internetu' : 'Policzone na tym urządzeniu'}</span></div>
        ${actions}
      </div>
    `;
  }, 0);

  const PALS = ['night', 'blue', 'pink', 'violet', 'coral', 'lilac'];
  const PAL_NAMES = { night: 'Noc', blue: 'Niebieski', pink: 'Róż', violet: 'Fiolet', coral: 'Koral', lilac: 'Lila' };

  /* Zbudowane karty dla danych (pomija te, na które brakuje danych) */
  function build(S, opts) {
    const c = ctx(S);
    const out = [];
    CARDS.forEach((def) => {
      let html = null;
      try { html = def.fn(S, c, opts || {}); } catch (err) { console.warn('card', def.id, err); html = null; }
      if (html) out.push({ id: def.id, pal: def.pal, dur: def.dur, html });
    });
    out.forEach((b, i) => { b.deco = deco(i); });
    return { c, cards: out };
  }
  function cardMarkup(b, pal, live) {
    return `<section class="card${live ? ' is-live' : ''}" data-id="${b.id}" data-pal="${pal || b.pal}"><div class="card__deco">${b.deco}</div><div class="card__body">${b.html}</div></section>`;
  }
  /* Karty w stanie końcowym, bez animacji (miniatury, obrazki) */
  function staticCards(S, ids, opts) {
    const { cards } = build(S, Object.assign({ standalone: true }, opts));
    return (ids ? ids.map((id) => cards.find((x) => x.id === id)).filter(Boolean) : cards)
      .map((b) => ({ id: b.id, pal: b.pal, markup: cardMarkup(b, b.pal, true) }));
  }

  /* ---------------- Odtwarzacz ---------------- */
  function mount(root, S, opts) {
    opts = opts || {};
    const { c, cards: built } = build(S, opts);
    const ex = opts.exporter || null;
    const mark = c.all ? 'Wrapped <b>od początku</b>' : `Wrapped <b>${esc(S.year)}</b>`;
    const pals = built.map((b) => b.pal);
    let showHint = !opts.standalone;
    try { showHint = showHint && !localStorage.getItem('mw-hint'); } catch (err) { /* brak dostępu */ }

    root.innerHTML = `
      <div class="st" role="dialog" aria-label="Messenger Wrapped">
        <button class="st__arrow st__arrow--prev" data-nav="prev" aria-label="Poprzednia karta"></button>
        <div class="st__frame" data-pal="${pals[0]}">
          <div class="st__bars">${built.map(() => '<span><i></i></span>').join('')}</div>
          <div class="st__top">
            <span class="st__mark">${mark}</span>
            ${ex ? '<button class="st__pill" data-ui="share">Udostępnij</button>' : ''}
            <button class="st__btn" data-ui="pause" aria-label="Pauza"><span class="pp"><i></i><i></i></span></button>
            ${opts.standalone ? '' : '<button class="st__btn" data-ui="close" aria-label="Zamknij"><span class="x"></span></button>'}
          </div>
          ${built.map((b, i) => cardMarkup(b, pals[i], false).replace('<section ', '<section aria-hidden="true" ')).join('')}
          ${showHint ? '<div class="st__hint" aria-hidden="true"><span>Dotknij z prawej, aby przejść dalej</span><span>Przytrzymaj, aby zatrzymać</span></div>' : ''}
          <div class="st__toast" role="status"></div>
        </div>
        <button class="st__arrow st__arrow--next" data-nav="next" aria-label="Następna karta"></button>
        ${ex ? `<div class="ss" hidden>
          <div class="ss__panel" role="dialog" aria-modal="true" aria-labelledby="ssTitle">
            <div class="ss__head"><h2 id="ssTitle">Udostępnij kartę</h2><button class="st__btn" data-ss="close" aria-label="Zamknij"><span class="x"></span></button></div>
            <div class="ss__body">
              <div class="ss__preview"><img alt="Podgląd obrazka 1080 na 1920"><span class="ss__wait">Rysuję obrazek…</span></div>
              <div class="ss__side">
                <p class="ss__label">Kolor karty</p>
                <div class="ss__pals">${PALS.map((p) => `<button class="ss__pal" data-pick="${p}" data-pal="${p}" aria-label="${PAL_NAMES[p]}"></button>`).join('')}</div>
                ${ex.canShareFiles() ? '<button class="act act--main" data-ss="share" disabled>Udostępnij na relację</button><button class="act" data-ss="download" disabled>Zapisz obrazek</button>'
                  : '<button class="act act--main" data-ss="download" disabled>Pobierz obrazek</button>'}
                <p class="ss__note">${ex.canShareFiles() ? 'Wybierz Instagram, a potem Relacja. ' : window.matchMedia('(pointer: coarse)').matches ? 'Zapisz obrazek i dodaj go do relacji z galerii. ' : 'Wyślij plik na telefon i dodaj go do relacji. '}Format 1080 × 1920.</p>
              </div>
            </div>
            <div class="ss__more">
              <button class="act" data-ss="zip">Wszystkie karty (ZIP)</button>
              <button class="act" data-ss="html">Plik HTML z animacjami</button>
            </div>
          </div>
        </div>` : ''}
      </div>`;

    const st = root.querySelector('.st');
    const frame = st.querySelector('.st__frame');
    const cards = [...st.querySelectorAll('.card')];
    const bars = [...st.querySelectorAll('.st__bars span')];
    const toastEl = st.querySelector('.st__toast');
    const hintEl = st.querySelector('.st__hint');
    const sheet = st.querySelector('.ss');
    let cur = -1;
    let userPaused = false;
    let holdPaused = false;
    let sheetOpen = false;
    let timers = [];
    let rafs = [];

    function clearRun() {
      timers.forEach(clearTimeout);
      rafs.forEach(cancelAnimationFrame);
      timers = [];
      rafs = [];
    }
    function readDelay(el) {
      const v = parseFloat(el.style.getPropertyValue('--d'));
      return Number.isFinite(v) ? v : 0;
    }
    function runCounters(el) {
      el.querySelectorAll('[data-count]').forEach((n) => {
        const to = parseFloat(n.dataset.count);
        const dec = parseInt(n.dataset.dec || '0', 10);
        const pre = n.dataset.prefix || '';
        const suf = n.dataset.suffix || '';
        const delay = readDelay(n);
        const dur = to > 50 ? 1500 : 900;
        n.textContent = pre + fmt(0, dec) + suf;
        const t0 = performance.now() + delay;
        const step = (now) => {
          const p = Math.min(1, Math.max(0, (now - t0) / dur));
          const e = 1 - Math.pow(1 - p, 4);
          n.textContent = pre + fmt(dec ? to * e : Math.round(to * e), dec) + suf;
          if (p < 1) rafs.push(requestAnimationFrame(step));
        };
        rafs.push(requestAnimationFrame(step));
      });
    }
    function runTyping(el) {
      el.querySelectorAll('[data-tb]').forEach((tb) => {
        tb.classList.remove('is-done');
        tb.style.width = '';
        const after = tb.parentElement.querySelector('[data-after-tb]');
        if (after) after.style.display = 'none';
        tb.style.display = '';
        const wait = readDelay(tb) + parseInt(tb.dataset.wait || '1100', 10);
        timers.push(setTimeout(() => {
          if (after) {
            tb.style.display = 'none';
            after.style.display = '';
            return;
          }
          const text = tb.querySelector('.tb__text');
          tb.style.width = Math.ceil(text.getBoundingClientRect().width + 40) + 'px';
          tb.classList.add('is-done');
        }, wait));
      });
    }
    function show(i) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      if (i === cur) return;
      clearRun();
      if (cur >= 0) { cards[cur].classList.remove('is-live'); cards[cur].setAttribute('aria-hidden', 'true'); }
      cur = i;
      const el = cards[i];
      frame.dataset.pal = pals[i];
      void el.offsetWidth;
      el.classList.add('is-live');
      el.setAttribute('aria-hidden', 'false');
      runCounters(el);
      runTyping(el);
      bars.forEach((b, k) => {
        b.classList.toggle('is-done', k < i);
        b.classList.remove('is-run');
      });
      const dur = built[i].dur;
      const bar = bars[i];
      void bar.offsetWidth;
      if (dur > 0) {
        bar.style.setProperty('--dur', dur + 'ms');
        bar.classList.add('is-run');
      } else {
        bar.classList.add('is-done');
      }
      setPaused();
    }
    function hideHint() {
      if (!hintEl || hintEl.classList.contains('is-gone')) return;
      hintEl.classList.add('is-gone');
      try { localStorage.setItem('mw-hint', '1'); } catch (err) { /* brak dostępu */ }
    }
    function next() { hideHint(); if (cur < cards.length - 1) { userPaused = false; show(cur + 1); } }
    function prev() { hideHint(); userPaused = false; if (cur > 0) show(cur - 1); else { const k = cur; cur = -1; show(k); } }
    function setPaused() {
      const p = userPaused || holdPaused || sheetOpen;
      st.classList.toggle('is-paused', p);
      const btn = st.querySelector('[data-ui="pause"]');
      if (btn) btn.setAttribute('aria-label', userPaused ? 'Wznów' : 'Pauza');
    }
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('is-on');
      setTimeout(() => toastEl.classList.remove('is-on'), 2600);
    }
    if (hintEl) setTimeout(hideHint, 6500);

    bars.forEach((b, k) => b.querySelector('i').addEventListener('animationend', () => { if (k === cur) next(); }));

    // Dotyk: krótko = nawigacja, przytrzymanie = pauza
    let downAt = 0;
    let downX = 0;
    let holdTimer = null;
    const interactive = (t) => t.closest('button, a, input, .actions, .st__top, .ss');
    frame.addEventListener('pointerdown', (e) => {
      if (interactive(e.target) || e.button > 0) return;
      downAt = performance.now();
      downX = e.clientX;
      holdTimer = setTimeout(() => { holdPaused = true; setPaused(); }, 200);
    });
    const release = (e, cancel) => {
      if (!downAt) return;
      clearTimeout(holdTimer);
      const wasHold = holdPaused;
      holdPaused = false;
      downAt = 0;
      setPaused();
      if (cancel || wasHold) return;
      const r = frame.getBoundingClientRect();
      if (downX - r.left < r.width * 0.3) prev(); else next();
    };
    frame.addEventListener('pointerup', (e) => release(e, false));
    frame.addEventListener('pointercancel', (e) => release(e, true));
    frame.addEventListener('pointerleave', (e) => { if (holdPaused) release(e, true); });
    frame.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---------- Arkusz udostępniania ---------- */
    let shotUrl = null;
    let shotBlob = null;
    let shotToken = 0;
    const fileName = (i) => `${ex ? ex.baseName(S) : 'messenger-wrapped'}-${String(i + 1).padStart(2, '0')}-${built[i].id}.png`;
    function sheetButtons(on) {
      sheet.querySelectorAll('[data-ss="share"], [data-ss="download"]').forEach((b) => { b.disabled = !on; });
    }
    async function renderPreview() {
      const token = ++shotToken;
      const img = sheet.querySelector('.ss__preview img');
      sheet.classList.add('is-busy');
      sheetButtons(false);
      sheet.querySelectorAll('.ss__pal').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === pals[cur])));
      try {
        const blob = await ex.renderCard(cardMarkup(built[cur], pals[cur], true), pals[cur], S);
        if (token !== shotToken) return;
        if (shotUrl) URL.revokeObjectURL(shotUrl);
        shotBlob = blob;
        shotUrl = URL.createObjectURL(blob);
        img.src = shotUrl;
        sheetButtons(true);
      } catch (err) {
        console.error(err);
        if (token === shotToken) toast('Ta przeglądarka nie potrafi narysować karty. Zrób zrzut ekranu.');
      } finally {
        if (token === shotToken) sheet.classList.remove('is-busy');
      }
    }
    function openSheet() {
      if (!sheet) return;
      sheetOpen = true;
      setPaused();
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('is-open'));
      renderPreview();
      const first = sheet.querySelector('.ss__pal[aria-pressed="true"]') || sheet.querySelector('.ss__pal');
      if (first) first.focus({ preventScroll: true });
    }
    function closeSheet() {
      if (!sheet || !sheetOpen) return;
      sheetOpen = false;
      sheet.classList.remove('is-open');
      setTimeout(() => { if (!sheetOpen) sheet.hidden = true; }, 220);
      setPaused();
    }
    async function busy(btn, label, fn) {
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
      try {
        const msg = await fn((t) => { btn.textContent = t; });
        if (msg) toast(msg);
      } catch (err) {
        console.error(err);
        toast('Nie udało się. Spróbuj jeszcze raz.');
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    }
    if (sheet) {
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) { closeSheet(); return; }
        const pick = e.target.closest('[data-pick]');
        if (pick) {
          pals[cur] = pick.dataset.pick;
          cards[cur].dataset.pal = pals[cur];
          frame.dataset.pal = pals[cur];
          renderPreview();
          return;
        }
        const b = e.target.closest('[data-ss]');
        if (!b) return;
        const a = b.dataset.ss;
        if (a === 'close') closeSheet();
        if (a === 'share' && shotBlob) ex.deliver(shotBlob, fileName(cur), 'share').then((m) => m && toast(m)).catch(() => toast('Nie udało się udostępnić.'));
        if (a === 'download' && shotBlob) ex.deliver(shotBlob, fileName(cur), 'download').then((m) => m && toast(m));
        if (a === 'zip') {
          busy(b, 'Rysuję karty…', async (label) => {
            const files = [];
            for (let i = 0; i < built.length; i++) {
              label(`Rysuję ${i + 1} z ${built.length}…`);
              files.push({ name: fileName(i), blob: await ex.renderCard(cardMarkup(built[i], pals[i], true), pals[i], S) });
            }
            return ex.deliver(await ex.zip(files), `${ex.baseName(S)}.zip`, 'download');
          });
        }
        if (a === 'html') busy(b, 'Przygotowuję…', async () => ex.deliver(await ex.html(S), `${ex.baseName(S)}.html`, 'download'));
      });
    }

    st.addEventListener('click', (e) => {
      if (e.target.closest('.ss')) return;
      const nav = e.target.closest('[data-nav]');
      if (nav) { if (nav.dataset.nav === 'next') next(); else prev(); return; }
      const ui = e.target.closest('[data-ui]');
      if (ui) {
        if (ui.dataset.ui === 'pause') { userPaused = !userPaused; setPaused(); }
        if (ui.dataset.ui === 'share') openSheet();
        if (ui.dataset.ui === 'close' && opts.onClose) { destroy(); opts.onClose(); }
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'replay') { cur = -1; show(0); return; }
      if (a === 'another' && opts.onAnother) { destroy(); opts.onAnother(); return; }
      if (a === 'share') openSheet();
    });

    const onKey = (e) => {
      if (sheetOpen) { if (e.key === 'Escape') closeSheet(); return; }
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); userPaused = !userPaused; setPaused(); }
      else if (e.key === 'Escape' && opts.onClose && !opts.standalone) { destroy(); opts.onClose(); }
    };
    const onVis = () => { holdPaused = document.hidden; setPaused(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);

    function destroy() {
      clearRun();
      if (shotUrl) URL.revokeObjectURL(shotUrl);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
      root.innerHTML = '';
    }

    show(0);
    return { destroy, show, next, prev, openSheet, closeSheet, get index() { return cur; } };
  }

  window.WrappedStories = { mount, staticCards, fmt, plural, MONTHS, dayLabel, durShort, PALS };
})();
