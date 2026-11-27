/*
 * Messenger Wrapped — silnik analizy.
 * Działa jako Web Worker (w przeglądarce) albo jako moduł Node (testy).
 * Wszystko liczy się lokalnie: ZIP czytamy kawałkami przez Blob.slice
 * i rozpakowujemy natywnym DecompressionStream, więc multimedia z archiwum
 * nigdy nie trafiają do pamięci. Nic nie jest wysyłane ani zapisywane.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Błędy z kodami, które UI tłumaczy na ludzkie komunikaty
 * ------------------------------------------------------------------ */
class EngineError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail || '';
  }
}

/* ------------------------------------------------------------------ *
 * ZIP (z obsługą ZIP64), bez bibliotek
 * ------------------------------------------------------------------ */
const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOC = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const UTF8 = new TextDecoder('utf-8');

async function readView(blob, start, end) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}
function u64(dv, off) {
  return dv.getUint32(off + 4, true) * 4294967296 + dv.getUint32(off, true);
}

async function listZip(file) {
  const size = file.size;
  if (size < 22) throw new EngineError('ZIP_CORRUPT');
  const tailLen = Math.min(size, 0xffff + 22 + 20);
  const tail = await readView(file, size - tailLen, size);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new EngineError('ZIP_CORRUPT');

  let total = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === SIG_Z64_LOC) {
      const z64 = u64(tail, loc + 8);
      const z = await readView(file, z64, z64 + 56);
      if (z.getUint32(0, true) === SIG_Z64_EOCD) {
        total = u64(z, 32);
        cdSize = u64(z, 40);
        cdOffset = u64(z, 48);
      }
    }
  }
  if (cdOffset + cdSize > size) throw new EngineError('ZIP_PARTIAL');

  const cd = await readView(file, cdOffset, cdOffset + cdSize);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === SIG_CEN) {
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let rawSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = UTF8.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    if (rawSize === 0xffffffff || compSize === 0xffffffff || offset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.getUint16(e, true);
        const len = cd.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (rawSize === 0xffffffff) { rawSize = u64(cd, q); q += 8; }
          if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
          if (offset === 0xffffffff) { offset = u64(cd, q); }
          break;
        }
        e += 4 + len;
      }
    }
    entries.push({ name, method, compSize, size: rawSize, offset, encrypted: (flags & 1) === 1, dir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length && total > 0) throw new EngineError('ZIP_CORRUPT');
  return entries;
}

async function readZipText(file, entry) {
  if (entry.encrypted) throw new EngineError('ZIP_ENCRYPTED');
  const lh = await readView(file, entry.offset, entry.offset + 30);
  if (lh.getUint32(0, true) !== SIG_LOC) throw new EngineError('ZIP_CORRUPT');
  const start = entry.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const raw = file.slice(start, start + entry.compSize);
  if (entry.method === 0) return raw.text();
  if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new EngineError('NO_DECOMPRESS');
    let ds;
    try { ds = new DecompressionStream('deflate-raw'); } catch (err) { throw new EngineError('NO_DECOMPRESS'); }
    return new Response(raw.stream().pipeThrough(ds)).text();
  }
  throw new EngineError('ZIP_METHOD', String(entry.method));
}

/* ------------------------------------------------------------------ *
 * Tekst: mojibake z eksportu Facebooka, normalizacja, emoji
 * ------------------------------------------------------------------ */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const RE_HIGH = /[\u0080-ÿ]/;
const RE_WIDE = /[^\u0000-ÿ]/;

/* Facebook zapisuje bajty UTF-8 jako znaki Latin-1 ("Å‚" zamiast "ł").
 * Naprawiamy tylko napisy, które w całości dają się zdekodować jako UTF-8. */
function fixText(s) {
  if (typeof s !== 'string' || !s) return s;
  if (!RE_HIGH.test(s) || RE_WIDE.test(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  try { return STRICT_UTF8.decode(bytes); } catch (err) { return s; }
}

const DIACRITICS = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
function fold(s) {
  return s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => DIACRITICS[c])
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

const RE_URL = /\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+/gi;
const RE_PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const RE_PICTO_G = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const RE_EMOTICON = /(?:^|\s)(x+d+|:-?d+|:-?\)+|;-?\)+|:-?\(+|:-?p+|<3+|:\*+|:\/+|\^\^|:o)(?=\s|$|[!?.,])/gi;
const SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('pl', { granularity: 'grapheme' }) : null;
const EMOTICON_CANON = (raw) => {
  const l = raw.toLowerCase();
  if (/^x+d+$/.test(l)) return 'xD';
  if (/^:-?d+$/.test(l)) return ':D';
  if (/^:-?\)+$/.test(l)) return ':)';
  if (/^;-?\)+$/.test(l)) return ';)';
  if (/^:-?\(+$/.test(l)) return ':(';
  if (/^:-?p+$/.test(l)) return ':P';
  if (/^<3+$/.test(l)) return '<3';
  if (/^:\*+$/.test(l)) return ':*';
  if (/^:\/+$/.test(l)) return ':/';
  return raw;
};

function extractEmojis(text, out) {
  if (RE_PICTO.test(text)) {
    if (SEGMENTER) {
      for (const { segment } of SEGMENTER.segment(text)) {
        if (RE_PICTO_G.test(segment)) out.push(segment.replace(/️/g, ''));
      }
    } else {
      const m = text.match(/\p{Extended_Pictographic}/gu);
      if (m) for (const e of m) out.push(e);
    }
  }
  RE_EMOTICON.lastIndex = 0;
  let m;
  while ((m = RE_EMOTICON.exec(text))) out.push(EMOTICON_CANON(m[1]));
  return out;
}
const isEmoticon = (e) => /^[\x00-\x7f]+$/.test(e);
/* Pojedyncze znaki z bloku symboli potrzebują VS16, żeby wyglądały jak emoji */
function displayEmoji(e) {
  if (isEmoticon(e)) return e;
  if (e.length === 1 && e.charCodeAt(0) < 0x3000) return e + '️';
  return e;
}

const RE_TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
const RE_LAUGH = /(?:\b|^)(?:(?:ha){2,}h?|(?:he){2,}|(?:hi){2,}|(?:xd+)|lol|lmao|haha\w*)(?:\b|$)|😂|🤣|😆|😹|💀/i;
const RE_LAUGH_TOKEN = /^(?:(?:ha|he|hi|ah|eh)+h?|x+d+|lo+l|lmao|hah\w*|heh\w*|ahah\w*|xd\w*)$/;

/* Słowa pomijane w "słowach roku" (porównywane bez polskich znaków) */
const STOPWORDS = new Set(`
a aby ach acz aczkolwiek aj albo ale alez ani az bardziej bardzo bez bo bowiem by byc byl byla bylam bylas bylem byles byli bylo byly bym bys bede bedzie beda bedziesz bedziemy bedziecie ci cie ciebie co cos czy czyli czego czegos czemu czym dla do dlaczego dobra dobrze dzis dzisiaj gdy gdyz gdzie gdzies go i ich ile im inne inny ja jak jaka jakas jaki jakie jakies jakis jakos jakby jako je jeden jedna jedno jego jej jemu jest jestem jestes jestesmy jeszcze jesli jezeli juz kiedy kiedys kto ktos ktora ktore ktory ktorzy ku lub ma mam mamy masz maja mi mna mnie moj moja moje moim mojego moze mozesz moge mozna mu my na nad nam nami nas nasz nasza nasze natomiast nawet nia nic nie niech niego niej niemu nigdy nim nimi niz no noo nom o obok od oraz on ona one oni ono owszem pan pani po pod poniewaz potem pozniej przed przez przy sa sam sama sie skad swoj swoja swoje sobie soba ta tak taka taki takie takze tam te tego tej temu ten teraz tez to toba tobie totez trzeba tu tutaj ty tych tylko tym u w wam was wasz we wiec wszystko wszyscy wszystkie wy z za ze zeby zas zaden wtedy dlatego tez czyms kogos komus czegos czymś jutro wczoraj zaraz wczesniej zawsze troche duzo malo naprawde serio raczej chyba wiem wiesz mysle chce chcesz chcialam chcialem musze musisz mial miala mialam mialem mowie mowisz mowi ide idziesz robisz robie robi bylo daj dam dalej wlasnie kurde kurcze ok okej okey oki okk okay spoko aha aa aaa mhm hmm hm hmmm yhm yyy eee ej oj ojej no nooo tak takk jj jjj jest sa to ty
the a an and or but is are was were be been to of in on at for with it its this that i you he she we they me my your our so just like yes not do dont im its what how oh yeah ya yea u ur can will would there here have has had get got one all if then than about from
`.trim().split(/\s+/));

/* Słowa funkcyjne — zwrot nie może składać się wyłącznie z nich */
const FUNCTION_WORDS = new Set(`
a i w we z ze na do o od po pod przez przy za dla u bez nad przed oraz lub albo ale bo zeby czy to sie jest sa ten ta te tym tego tej ja ty on ona my wy oni mi ci mu go jej nam was ich mnie cie tez juz no tak jak co by
the a an and or but is are to of in on at for with it this that i you me my
`.trim().split(/\s+/));
const DANGLING = new Set('w we z ze na do o od po pod przez przy za dla u bez nad przed i a ale bo czy oraz lub albo zeby jak the a an and or to of in on at for with'.split(' '));
const BAD_START = new Set('i a ale bo ze zeby oraz lub albo and or but'.split(' '));

/* Komunikaty systemowe (polski i angielski eksport) */
const SYS_PATTERNS = [
  /(zmienil\w*|zmieniono|changed) (motyw|emoji|szybka reakcje|nazwe grupy|zdjecie grupy|kolor|the theme|the chat theme|the emoji|the group name|the group photo|the quick reaction)/,
  /(ustawil\w*|ustawiono|nadal\w*|set|cleared|usunal\w*) (sobie |ci |dla siebie )?(pseudonim|nick|the nickname|your nickname|his nickname|her nickname|their nickname|nickname)/,
  /pseudonim/,
  /(dodal\w*|added) .{1,80} (do grupy|do rozmowy|to the group|to the chat)/,
  /(usunal\w*|removed) .{1,80} (z grupy|z rozmowy|from the group|from the chat)/,
  /(opuscil\w*|left) (grupe|rozmowe|the group|the conversation)/,
  /(dolaczyl\w*|joined) (do grupy|do rozmowy|the group|the conversation)/,
  /(utworzyl\w*|created) (grupe|the group|ankiete|a poll)/,
  /(zaglosowal\w*|voted for|zmienil\w* glos)/,
  /(przypial\w*|odpial\w*|pinned|unpinned) (wiadomosc|a message)/,
  /(jest teraz administratorem|is now an admin|nie jest juz administratorem|named the group|nazwal\w* grupe)/,
  /(udostepnil\w*|shared) (swoja |a |their |his |her )?(biezaca )?(lokalizacje|location|live location)/,
  /^(.{0,80} )?(zareagowal\w*|reacted|zareagowano) .{0,20}(na|to) (twoja |twoja wiadomosc|wiadomosc|your message|a message)/,
  /(ta wiadomosc jest niedostepna|this message is unavailable|wiadomosc niedostepna)/,
  /(wlaczyl\w*|wylaczyl\w*|turned on|turned off) (znikajace wiadomosci|disappearing messages|vanish mode|tryb znikania)/,
  /(oczekuje na zaakceptowanie|waiting for .{0,40} to accept|zaakceptowal\w* (prosbe|twoja prosbe))/,
];
const CALL_PATTERNS = /(rozpoczal\w*|rozpoczela\w*|started) .{0,12}(rozmowe|czat wideo|polaczenie|a call|a video call|a video chat|an audio call)|(rozmowa|polaczenie) (wideo |glosowa |glosowe )?(zakonczyla sie|zakonczone|trwala|nieodebrane|nieodebrana)|(the )?(video )?call ended|missed (a |your )?(video |audio )?(call|chat)|nieodebran\w* (polaczenie|rozmowa)|(dolaczyl\w*|joined) (do )?(rozmowy|polaczenia|the call|the video call)/;
const UNSENT_PATTERN = /^(ta wiadomosc zostala cofnieta|wiadomosc zostala cofnieta|cofnieto wyslanie wiadomosci|.{0,80} cofnal\w*( \(a\))? wyslanie wiadomosci|.{0,80} cofnela wyslanie wiadomosci|this message was unsent|.{0,80} unsent a message)\.?$/;
const PLACEHOLDER = /^(.{0,80} )?(wyslal\w*|wyslano|sent|udostepnil\w*|shared) (\(a\) )?(zalacznik|an attachment|zdjecie|zdjecia|a photo|photos|\d+ zdjec\w*|\d+ photos|gif\w*|a gif|naklejk\w*|a sticker|film\w*|a video|wiadomosc glosowa|a voice message|nagranie glosowe|link|a link|plik|a file)\.?$/;

/* Ile razy... (liczone jako wiadomości zawierające frazę, po zdjęciu polskich znaków) */
const LITTLE_WORDS = [
  { id: 'love', label: 'kocham', re: /\b(kocham|kocham cie|kc|kochaam\w*|love (you|u|ya)|ily)\b/ },
  { id: 'night', label: 'dobranoc', re: /\b(dobranoc\w*|dobrej nocy|branoc|kolorowych snow|slodkich snow|spij dobrze|good ?night|gn)\b/ },
  { id: 'thanks', label: 'dzięki', re: /\b(dzieki|dziekuje|dziekuj\w*|dzienki|dzk|dzieks|dziex|thx|thanks|thank you|ty)\b/ },
  { id: 'sorry', label: 'przepraszam', re: /\b(przepraszam|przeprosz\w*|sorki|sorka|sorry|sory|soryy|wybacz)\b/ },
  { id: 'miss', label: 'tęsknię', re: /\b(tesknie|teskni\w*|tesknilam|tesknilem|miss (you|u|ya))\b/ },
  { id: 'morning', label: 'dzień dobry', re: /\b(dzien dobry|dzindobry|dzien dobr\w*|good morning|milego dnia)\b/ },
];

/* ------------------------------------------------------------------ *
 * Czytanie wątków
 * ------------------------------------------------------------------ */
const GENERIC_NAMES = /^(uzytkownik facebooka|facebook user|uzytkownik messengera|messenger user|instagram user|uzytkownik instagrama|unknown)$/;
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav|flac|amr)$/i;
const GIF_EXT = /\.gif$/i;

function len(v) { return Array.isArray(v) ? v.length : 0; }

function threadMeta(data, path) {
  const list = Array.isArray(data && data.messages) ? data.messages
    : Array.isArray(data && data.Messages) ? data.Messages : null;
  if (!list) return null;
  const participants = [];
  if (Array.isArray(data.participants)) {
    for (const p of data.participants) {
      const n = typeof p === 'string' ? p : p && typeof p.name === 'string' ? p.name : null;
      if (n && n.trim()) participants.push(fixText(n.trim()));
    }
  }
  let title = '';
  for (const k of ['title', 'threadName', 'thread_name', 'name']) {
    if (typeof data[k] === 'string' && data[k].trim()) { title = fixText(data[k].trim()); break; }
  }
  const base = path.split('/').pop() || path;
  const folder = /^message_\d+\.json$/i.test(base) ? path.slice(0, path.length - base.length - 1) : path.replace(/\.json$/i, '');
  return { list, participants, title, folder };
}

function normalizeMessage(m) {
  if (!m || typeof m !== 'object') return null;
  let ts = m.timestamp_ms != null ? m.timestamp_ms : m.timestamp != null ? m.timestamp : m.timestampMs;
  ts = typeof ts === 'number' ? ts : parseInt(ts, 10);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (ts < 1e11) ts *= 1000; // sekundy -> ms
  let sender = m.sender_name != null ? m.sender_name : m.senderName != null ? m.senderName : m.sender && m.sender.name;
  sender = typeof sender === 'string' && sender.trim() ? fixText(sender.trim()) : null;
  if (!sender) return null;
  let text = typeof m.content === 'string' ? m.content : typeof m.text === 'string' ? m.text : null;
  if (text) text = fixText(text);
  if (text != null && !text.trim()) text = null;

  const msg = { ts, s: sender, t: text, k: 'msg', ph: 0, vi: 0, au: 0, gi: 0, st: 0, fi: 0, ln: 0, rx: null, cd: 0 };
  msg.ph = len(m.photos);
  msg.vi = len(m.videos);
  msg.au = len(m.audio_files) + len(m.audioFiles);
  msg.gi = len(m.gifs);
  msg.fi = len(m.files);
  msg.st = m.sticker ? 1 : len(m.stickers);
  if (Array.isArray(m.media)) {
    for (const it of m.media) {
      const uri = typeof it === 'string' ? it : it && (it.uri || it.URI || it.url);
      if (typeof uri !== 'string') { msg.fi++; continue; }
      if (GIF_EXT.test(uri)) msg.gi++;
      else if (PHOTO_EXT.test(uri)) msg.ph++;
      else if (VIDEO_EXT.test(uri)) msg.vi++;
      else if (AUDIO_EXT.test(uri)) msg.au++;
      else msg.fi++;
    }
  }
  const shareLink = m.share && typeof m.share.link === 'string';
  if (Array.isArray(m.reactions) && m.reactions.length) {
    msg.rx = [];
    for (const r of m.reactions) {
      if (!r) continue;
      const e = fixText(r.reaction || r.emoji || '');
      const a = fixText(typeof r.actor === 'string' ? r.actor : r.actor && r.actor.name ? r.actor.name : '');
      if (e) msg.rx.push([a || '', e.replace(/️/g, '')]);
    }
    if (!msg.rx.length) msg.rx = null;
  }

  const type = typeof m.type === 'string' ? m.type.toLowerCase() : '';
  if (m.is_unsent || m.isUnsent) { msg.k = 'unsent'; msg.t = null; return msg; }
  if (type === 'subscribe' || type === 'unsubscribe') { msg.k = 'sys'; return msg; }
  if (typeof m.call_duration === 'number' || type === 'call') {
    msg.k = 'call';
    msg.cd = typeof m.call_duration === 'number' ? m.call_duration : 0;
    msg.t = null;
    return msg;
  }
  if (msg.t) {
    // "zmienił(a)", "rozpoczął(-ęła)" -> forma bez dopisku rodzaju
    const f = fold(msg.t).replace(/\(-?[a-z]{1,4}\)/g, '').replace(/ {2,}/g, ' ');
    if (f.length < 260) {
      if (UNSENT_PATTERN.test(f)) { msg.k = 'unsent'; msg.t = null; return msg; }
      if (CALL_PATTERNS.test(f) && f.length < 140) { msg.k = 'call'; msg.t = null; return msg; }
      for (const re of SYS_PATTERNS) if (re.test(f)) { msg.k = 'sys'; return msg; }
      if (PLACEHOLDER.test(f)) {
        msg.t = null;
        if (msg.ph + msg.vi + msg.au + msg.gi + msg.st + msg.fi === 0) {
          if (/zdjec|photo/.test(f)) msg.ph = 1;
          else if (/gif/.test(f)) msg.gi = 1;
          else if (/naklejk|sticker/.test(f)) msg.st = 1;
          else if (/film|video/.test(f)) msg.vi = 1;
          else if (/glosow|voice/.test(f)) msg.au = 1;
          else if (/link/.test(f)) msg.ln = 1;
          else msg.fi = 1;
        }
      }
    }
  }
  if (msg.t) {
    RE_URL.lastIndex = 0;
    const urls = msg.t.match(RE_URL);
    msg.ln = urls ? urls.length : 0;
  }
  if (shareLink && !msg.ln) msg.ln = 1;
  const hasMedia = msg.ph + msg.vi + msg.au + msg.gi + msg.st + msg.fi + msg.ln > 0;
  if (!msg.t && !hasMedia) { msg.k = m.sticker ? 'msg' : 'sys'; }
  return msg;
}

/* ------------------------------------------------------------------ *
 * Stan workera
 * ------------------------------------------------------------------ */
const state = {
  files: [],     // File[]
  threads: [],   // [{id, key, title, participants:Set, sources:[{fi, entry|null}], count, years:{}, first, last}]
  selfName: null,
  sourceKinds: new Set(),
};

function threadKey(meta) {
  const title = fold(meta.title || '');
  const people = meta.participants.map(fold).filter((p) => !GENERIC_NAMES.test(p)).sort();
  if (!people.length || GENERIC_NAMES.test(title)) return 'path:' + meta.folder;
  return title + '|' + people.join('|');
}

/* Pierwsze przejście: indeks rozmów (bez trzymania treści w pamięci) */
async function indexFiles(files, progress) {
  state.files = files;
  state.threads = [];
  state.selfName = null;
  const byKey = new Map();
  const jobs = [];
  let sawHtml = false;
  let sawZip = false;

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const name = (f.name || '').toLowerCase();
    const looksZip = name.endsWith('.zip') || (await isZipBlob(f));
    if (looksZip) {
      sawZip = true;
      progress({ phase: 'list', file: f.name });
      const entries = await listZip(f);
      const jsons = entries.filter((e) => !e.dir && /\.json$/i.test(e.name) && !/(^|\/)__macosx\//i.test(e.name) && !/(^|\/)\._/.test(e.name));
      if (!jsons.length && entries.some((e) => /\.html?$/i.test(e.name) && /message/i.test(e.name))) sawHtml = true;
      const msgLike = jsons.filter((e) => /message/i.test(e.name));
      const pick = msgLike.length ? msgLike : jsons;
      for (const e of pick) jobs.push({ fi, entry: e });
      progress({ phase: 'listed', file: f.name, entries: entries.length, jsons: pick.length });
    } else if (name.endsWith('.json') || name === '') {
      jobs.push({ fi, entry: null });
    } else if (name.endsWith('.html') || name.endsWith('.htm')) {
      sawHtml = true;
    } else {
      throw new EngineError('BAD_TYPE', f.name);
    }
  }

  if (!jobs.length) throw new EngineError(sawHtml ? 'HTML_EXPORT' : sawZip ? 'NO_MESSAGES' : 'BAD_TYPE');

  let done = 0;
  let lastPing = 0;
  for (const job of jobs) {
    done++;
    let text;
    try {
      text = job.entry ? await readZipText(files[job.fi], job.entry) : await files[job.fi].text();
    } catch (err) {
      if (err instanceof EngineError && (err.code === 'NO_DECOMPRESS' || err.code === 'ZIP_ENCRYPTED')) throw err;
      continue;
    }
    if (text.indexOf('"messages"') === -1 && text.indexOf('"Messages"') === -1) continue;
    let data;
    try { data = JSON.parse(text); } catch (err) {
      if (!job.entry) throw new EngineError('BAD_JSON', files[job.fi].name);
      continue;
    }
    text = null;
    const path = job.entry ? job.entry.name : files[job.fi].name;
    const meta = threadMeta(data, path);
    if (!meta) continue;
    const key = threadKey(meta);
    let th = byKey.get(key);
    if (!th) {
      th = { id: 't' + byKey.size, key, title: meta.title, participants: new Set(), sources: [], count: 0, years: {}, ym: {}, first: Infinity, last: 0, senders: new Map(), seen: new Set() };
      byKey.set(key, th);
    }
    th.sources.push({ fi: job.fi, entry: job.entry, folder: meta.folder });
    for (const p of meta.participants) th.participants.add(p);
    if (!th.title && meta.title) th.title = meta.title;

    for (const raw of meta.list) {
      const m = normalizeMessage(raw);
      if (!m || m.k !== 'msg') continue;
      const k = m.ts + '|' + m.s;
      if (th.seen.has(k)) continue;
      th.seen.add(k);
      th.count++;
      const d = new Date(m.ts);
      const y = d.getFullYear();
      th.years[y] = (th.years[y] || 0) + 1;
      const ym = y * 100 + d.getMonth();
      th.ym[ym] = (th.ym[ym] || 0) + 1;
      if (m.ts < th.first) th.first = m.ts;
      if (m.ts > th.last) th.last = m.ts;
      th.senders.set(m.s, (th.senders.get(m.s) || 0) + 1);
      th.participants.add(m.s);
    }
    const now = Date.now();
    if (now - lastPing > 120 || done === jobs.length) {
      lastPing = now;
      progress({ phase: 'parse', done, total: jobs.length, threads: byKey.size });
    }
  }

  const threads = [...byKey.values()].filter((t) => t.count > 0);
  if (!threads.length) throw new EngineError('NO_MESSAGES');
  for (const t of threads) t.seen = null;

  // Kim jest właściciel eksportu? Osoba obecna w większości rozmów.
  const presence = new Map();
  for (const t of threads) for (const p of t.participants) presence.set(p, (presence.get(p) || 0) + 1);
  let best = null;
  let bestN = 0;
  for (const [p, n] of presence) if (n > bestN) { best = p; bestN = n; }
  if (threads.length >= 2 && bestN >= Math.max(2, threads.length * 0.6)) state.selfName = best;

  threads.sort((a, b) => b.count - a.count);
  threads.forEach((t, i) => { t.id = 't' + i; });
  state.threads = threads;
  return chatList();
}

async function isZipBlob(f) {
  if (f.size < 4) return false;
  const dv = await readView(f, 0, 4);
  return dv.getUint32(0, true) === SIG_LOC;
}

function displayTitle(t) {
  const others = [...t.participants].filter((p) => p !== state.selfName);
  if (t.title && !GENERIC_NAMES.test(fold(t.title))) return t.title;
  if (others.length) return others.slice(0, 3).join(', ') + (others.length > 3 ? ` i ${others.length - 3} innych` : '');
  return t.title || 'Rozmowa bez nazwy';
}

function chatList() {
  return {
    selfName: state.selfName,
    chats: state.threads.map((t) => {
      const others = [...t.participants].filter((p) => p !== state.selfName);
      return {
        id: t.id,
        title: displayTitle(t),
        people: t.participants.size,
        group: t.participants.size > 2,
        others: others.slice(0, 6),
        count: t.count,
        years: t.years,
        first: t.first,
        last: t.last,
        ym: t.ym,
      };
    }),
  };
}

/* Drugie przejście: pełne wiadomości jednej rozmowy */
async function loadThreadMessages(thread, progress) {
  const all = [];
  const seen = new Set();
  let i = 0;
  for (const src of thread.sources) {
    i++;
    progress({ phase: 'load', done: i, total: thread.sources.length });
    const f = state.files[src.fi];
    const text = src.entry ? await readZipText(f, src.entry) : await f.text();
    let data;
    try { data = JSON.parse(text); } catch (err) { continue; }
    const meta = threadMeta(data, src.entry ? src.entry.name : f.name);
    if (!meta) continue;
    for (const raw of meta.list) {
      const m = normalizeMessage(raw);
      if (!m) continue;
      const key = m.ts + '|' + m.s + '|' + m.k + '|' + (m.t ? m.t.slice(0, 24) : '');
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(m);
    }
  }
  all.sort((a, b) => a.ts - b.ts);
  return all;
}

/* ------------------------------------------------------------------ *
 * Statystyki
 * ------------------------------------------------------------------ */
const HOUR = 3600e3;
const DAY = 86400e3;
const SESSION_GAP = 6 * HOUR;   // przerwa, po której liczymy "nową rozmowę"
const REPLY_WINDOW = 6 * HOUR;  // dłuższe przerwy nie są "odpowiedzią"

function bump(map, key, n = 1) { map.set(key, (map.get(key) || 0) + n); }
function top(map, n) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
function median(arr) {
  if (!arr.length) return null;
  const s = Float64Array.from(arr).sort();
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function dayIndex(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); }
function dateFromIndex(i) { const d = new Date(i * DAY); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function isoDay(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function shortNames(names) {
  const firsts = names.map((n) => n.split(/\s+/)[0]);
  return names.map((n, i) => {
    const f = firsts[i];
    if (firsts.filter((x) => x === f).length > 1) {
      const parts = n.split(/\s+/);
      return parts.length > 1 ? `${f} ${parts[parts.length - 1][0]}.` : n;
    }
    return f || n;
  });
}

function computeStats(all, opts) {
  const year = opts.year;
  const now = opts.now || Date.now();
  const inPeriod = year === 'all' ? () => true : (m) => m._y === year;

  for (const m of all) {
    const d = new Date(m.ts);
    m._y = d.getFullYear();
    m._mo = d.getMonth();
    m._h = d.getHours();
    m._wd = (d.getDay() + 6) % 7; // pn = 0
    m._di = dayIndex(d);
  }

  const period = all.filter((m) => m.k !== 'sys' && inPeriod(m));
  const msgs = period.filter((m) => m.k === 'msg');
  if (!msgs.length) throw new EngineError('EMPTY_PERIOD');

  // Osoby
  const counts = new Map();
  for (const m of msgs) bump(counts, m.s);
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const shorts = shortNames(order);
  const idx = new Map(order.map((n, i) => [n, i]));
  const P = order.map((name, i) => ({
    name, short: shorts[i], self: name === opts.selfName,
    count: counts.get(name), share: 0, words: 0, chars: 0, textMsgs: 0,
    emojis: 0, emojiMap: new Map(), photos: 0, videos: 0, audio: 0, gifs: 0, stickers: 0, files: 0, links: 0,
    night: 0, morning: 0, starters: 0, enders: 0, resp: [], laughs: 0, questions: 0, unsent: 0,
    reactGiven: 0, reactRecv: 0, bursts: [], wordMap: new Map(), little: {}, callsStarted: 0,
  }));
  const total = msgs.length;
  for (const p of P) p.share = p.count / total;

  // Globalne liczniki
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  const byMonth = new Array(12).fill(0);
  const byYear = new Map();
  const byDay = new Map();
  const emojiAll = new Map();
  const wordForms = new Map();
  const phraseMap = new Map();
  const littleAll = {};
  for (const lw of LITTLE_WORDS) littleAll[lw.id] = 0;
  let words = 0;
  let laughMsgs = 0;

  let prev = null;
  let burstLen = 0;
  let longestBurst = { len: 0, who: null, ts: 0 };
  let longestGap = { ms: 0, from: 0, to: 0 };
  const firstTs = msgs[0].ts;

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const p = P[idx.get(m.s)];
    byHour[m._h]++;
    byWeekday[m._wd]++;
    byMonth[m._mo]++;
    bump(byYear, m._y);
    bump(byDay, m._di);
    if (m._h < 5) p.night++;
    if (m._h >= 5 && m._h < 9) p.morning++;
    p.photos += m.ph; p.videos += m.vi; p.audio += m.au; p.gifs += m.gi; p.stickers += m.st; p.files += m.fi; p.links += m.ln;

    // sesje, odpowiedzi, serie
    if (!prev || m.ts - prev.ts > SESSION_GAP) {
      p.starters++;
      if (prev) P[idx.get(prev.s)].enders++;
    }
    if (prev) {
      const gap = m.ts - prev.ts;
      if (gap > longestGap.ms) longestGap = { ms: gap, from: prev.ts, to: m.ts };
      if (m.s !== prev.s) {
        if (gap <= REPLY_WINDOW) p.resp.push(gap / 1000);
        P[idx.get(prev.s)].bursts.push(burstLen);
        burstLen = 1;
      } else {
        burstLen++;
      }
    } else {
      burstLen = 1;
    }
    if (burstLen > longestBurst.len) longestBurst = { len: burstLen, who: m.s, ts: m.ts };
    prev = m;

    // tekst
    if (m.t) {
      const text = m.t;
      p.textMsgs++;
      const em = extractEmojis(text, []);
      if (em.length) {
        p.emojis += em.length;
        for (const e of em) { bump(emojiAll, e); bump(p.emojiMap, e); }
      }
      if (RE_LAUGH.test(text)) { p.laughs++; laughMsgs++; }
      if (text.indexOf('?') !== -1) p.questions++;
      const clean = text.replace(RE_URL, ' ');
      const folded = fold(clean);
      for (const lw of LITTLE_WORDS) {
        if (lw.re.test(folded)) { littleAll[lw.id]++; p.little[lw.id] = (p.little[lw.id] || 0) + 1; }
      }
      const toks = clean.toLowerCase().match(RE_TOKEN) || [];
      p.words += toks.length;
      p.chars += clean.length;
      words += toks.length;
      const keys = [];
      for (const tok of toks) {
        const key = fold(tok);
        keys.push(key);
        if (key.length < 3 || STOPWORDS.has(key) || RE_LAUGH_TOKEN.test(key) || /^\d+$/.test(key)) continue;
        bump(p.wordMap, key);
        if (tok !== key) bump(wordForms, key + '\u0000' + tok);
      }
      if (keys.length >= 2 && keys.length <= 30) addPhrases(keys, toks, phraseMap);
    }
  }
  if (prev) P[idx.get(prev.s)].bursts.push(burstLen);

  // Nieodebrane / cofnięte / połączenia / reakcje (z całego okresu)
  let calls = 0; let callSec = 0; let longestCall = 0; let missedCalls = 0;
  const reactAll = new Map();
  let reactTotal = 0;
  let mostReacted = null;
  for (const m of period) {
    if (m.k === 'unsent' && idx.has(m.s)) P[idx.get(m.s)].unsent++;
    if (m.k === 'call') {
      if (m.cd > 0) {
        calls++; callSec += m.cd; if (m.cd > longestCall) longestCall = m.cd;
        if (idx.has(m.s)) P[idx.get(m.s)].callsStarted++;
      } else missedCalls++;
    }
    if (m.rx) {
      for (const [actor, e] of m.rx) {
        reactTotal++;
        bump(reactAll, e);
        if (idx.has(actor)) P[idx.get(actor)].reactGiven++;
      }
      if (idx.has(m.s)) P[idx.get(m.s)].reactRecv += m.rx.length;
      if (m.t && (!mostReacted || m.rx.length > mostReacted.n)) mostReacted = { n: m.rx.length, ts: m.ts, s: m.s, t: m.t };
    }
  }

  // Dni i serie
  const dayKeys = [...byDay.keys()].sort((a, b) => a - b);
  let streak = { len: 0, from: 0, to: 0 };
  let run = 1;
  for (let i = 0; i < dayKeys.length; i++) {
    if (i > 0 && dayKeys[i] === dayKeys[i - 1] + 1) run++; else run = 1;
    if (run > streak.len) streak = { len: run, from: dayKeys[i - run + 1], to: dayKeys[i] };
  }
  let busiest = { di: dayKeys[0], n: 0 };
  for (const [di, n] of byDay) if (n > busiest.n || (n === busiest.n && di < busiest.di)) busiest = { di, n };

  let periodStart; let periodEnd;
  if (year === 'all') {
    periodStart = msgs[0]._di;
    periodEnd = msgs[msgs.length - 1]._di;
  } else {
    periodStart = dayIndex(new Date(year, 0, 1));
    const yearEnd = dayIndex(new Date(year, 11, 31));
    const today = dayIndex(new Date(now));
    periodEnd = Math.min(yearEnd, Math.max(today, msgs[msgs.length - 1]._di));
  }
  const periodDays = Math.max(1, periodEnd - periodStart + 1);

  // Mapa cieplna roku (dla trybu "cały czas" — ostatni rok z danymi)
  const heatYear = year === 'all' ? msgs[msgs.length - 1]._y : year;
  const heatStart = dayIndex(new Date(heatYear, 0, 1));
  const heatLen = dayIndex(new Date(heatYear, 11, 31)) - heatStart + 1;
  const heat = new Array(heatLen).fill(0);
  for (const [di, n] of byDay) { const k = di - heatStart; if (k >= 0 && k < heatLen) heat[k] = n; }
  const heatCutoff = year === 'all' ? heatLen : Math.min(heatLen, periodEnd - heatStart + 1);

  // Rok do roku
  let yoy = null;
  if (year !== 'all') {
    const prevCount = all.reduce((n, m) => n + (m.k === 'msg' && m._y === year - 1 ? 1 : 0), 0);
    if (prevCount >= 50) yoy = { prevYear: year - 1, prev: prevCount, change: (total - prevCount) / prevCount };
  }

  // Słowa roku
  const formFor = (key) => {
    let best = key; let bestN = 0;
    for (const [k, n] of wordForms) {
      if (k.startsWith(key + '\u0000') && n > bestN) { best = k.slice(key.length + 1); bestN = n; }
    }
    return best;
  };
  const wordTotal = new Map();
  for (const p of P) for (const [k, n] of p.wordMap) bump(wordTotal, k, n);
  const topWords = top(wordTotal, 8).map(([k, n]) => ({ w: k, n }));
  for (const p of P) {
    p.topWords = top(p.wordMap, 5).map(([k, n]) => ({ w: k, n }));
    p.signature = signatureWords(p, P);
  }
  const needForms = new Set();
  topWords.forEach((x) => needForms.add(x.w));
  P.forEach((p) => { p.topWords.forEach((x) => needForms.add(x.w)); p.signature.forEach((x) => needForms.add(x.w)); });
  const forms = new Map([...needForms].map((k) => [k, formFor(k)]));
  const showWord = (x) => ({ w: forms.get(x.w) || x.w, n: x.n });

  // Odpowiedzi
  for (const p of P) {
    p.respN = p.resp.length;
    p.respMedian = p.resp.length >= 8 ? median(p.resp) : null;
    p.respFast = p.resp.length >= 8 ? p.resp.filter((s) => s < 60).length / p.resp.length : null;
    const real = p.bursts.filter((b) => b > 0);
    p.avgBurst = real.length ? real.reduce((a, b) => a + b, 0) / real.length : 1;
    p.avgWords = p.textMsgs ? p.words / p.textMsgs : 0;
    p.media = p.photos + p.videos + p.audio + p.gifs + p.stickers + p.files;
    p.topEmoji = top(p.emojiMap, 3).map(([e, n]) => ({ e: displayEmoji(e), n }));
    p.nightShare = p.count ? p.night / p.count : 0;
    p.morningShare = p.count ? p.morning / p.count : 0;
    p.laughShare = p.textMsgs ? p.laughs / p.textMsgs : 0;
    p.questionShare = p.textMsgs ? p.questions / p.textMsgs : 0;
    p.emojiRate = p.count ? p.emojis / p.count : 0;
  }
  const sessions = P.reduce((a, p) => a + p.starters, 0);

  const phrases = pickPhrases(phraseMap);
  const personas = assignPersonas(P, { sessions, total });
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const favWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const monthsSeries = year === 'all'
    ? [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, n]) => ({ label: String(y), n }))
    : byMonth.map((n, i) => ({ label: i, n }));
  const bestBucket = monthsSeries.reduce((b, x, i) => (x.n > b.n ? { i, n: x.n } : b), { i: 0, n: -1 });

  const first = msgs[0];
  const media = P.reduce((acc, p) => {
    acc.photos += p.photos; acc.videos += p.videos; acc.audio += p.audio; acc.gifs += p.gifs;
    acc.stickers += p.stickers; acc.files += p.files; acc.links += p.links; return acc;
  }, { photos: 0, videos: 0, audio: 0, gifs: 0, stickers: 0, files: 0, links: 0 });

  const little = LITTLE_WORDS.map((lw) => ({
    id: lw.id, label: lw.label, n: littleAll[lw.id],
    by: P.map((p) => p.little[lw.id] || 0),
  })).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n);

  const people = P.map((p) => ({
    name: p.name, short: p.short, self: p.self, count: p.count, share: p.share,
    words: p.words, avgWords: round(p.avgWords, 1), emojis: p.emojis, topEmoji: p.topEmoji,
    photos: p.photos, videos: p.videos, audio: p.audio, gifs: p.gifs, stickers: p.stickers, links: p.links, media: p.media,
    nightShare: p.nightShare, night: p.night, morningShare: p.morningShare,
    starters: p.starters, enders: p.enders,
    respMedian: p.respMedian, respFast: p.respFast, respN: p.respN,
    laughs: p.laughs, laughShare: p.laughShare, questions: p.questions,
    unsent: p.unsent, reactGiven: p.reactGiven, reactRecv: p.reactRecv,
    avgBurst: round(p.avgBurst, 2), topWords: p.topWords.map(showWord), signature: p.signature.map(showWord),
    callsStarted: p.callsStarted,
  }));

  return {
    v: 2,
    year,
    title: opts.title,
    group: order.length > 2 || opts.group,
    selfName: opts.selfName || null,
    generatedAt: now,
    offline: !!opts.offline,
    range: { from: msgs[0].ts, to: msgs[msgs.length - 1].ts, firstEver: all.length ? all[0].ts : msgs[0].ts },
    total,
    words,
    perDay: total / periodDays,
    periodDays,
    activeDays: byDay.size,
    streak: { len: streak.len, from: isoDay(dateFromIndex(streak.from)), to: isoDay(dateFromIndex(streak.to)) },
    busiestDay: { date: isoDay(dateFromIndex(busiest.di)), n: busiest.n },
    longestGap: longestGap.ms ? { ms: longestGap.ms, from: longestGap.from, to: longestGap.to } : null,
    heat: { year: heatYear, start: isoDay(new Date(heatYear, 0, 1)), days: heat, cutoff: heatCutoff },
    byHour, byWeekday, peakHour, favWeekday,
    months: monthsSeries, bestMonth: bestBucket.n > 0 ? bestBucket.i : null, monthsMode: year === 'all' ? 'years' : 'months',
    yoy,
    first: { ts: first.ts, s: first.s, t: first.t ? first.t.slice(0, 220) : null, media: first.ph ? 'photo' : first.vi ? 'video' : first.au ? 'audio' : first.gi ? 'gif' : first.st ? 'sticker' : first.ln ? 'link' : null },
    people,
    emoji: top(emojiAll, 6).map(([e, n]) => ({ e: displayEmoji(e), n })),
    emojiTotal: [...emojiAll.values()].reduce((a, b) => a + b, 0),
    words_top: topWords.map(showWord),
    phrases,
    little,
    laughs: laughMsgs,
    media,
    calls: { n: calls, sec: callSec, longest: longestCall, missed: missedCalls },
    reactions: {
      total: reactTotal,
      top: top(reactAll, 4).map(([e, n]) => ({ e: displayEmoji(e), n })),
      most: mostReacted && mostReacted.n >= 2 ? { n: mostReacted.n, ts: mostReacted.ts, s: mostReacted.s, t: mostReacted.t.slice(0, 160) } : null,
    },
    monologue: longestBurst.len >= 5 ? { len: longestBurst.len, who: longestBurst.who, ts: longestBurst.ts } : null,
    sessions,
    personas,
  };
}

function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }

function addPhrases(keys, toks, map) {
  const seen = new Set();
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= keys.length; i++) {
      const slice = keys.slice(i, i + n);
      if (BAD_START.has(slice[0]) || DANGLING.has(slice[n - 1])) continue;
      if (slice.every((k) => FUNCTION_WORDS.has(k))) continue;
      if (slice.some((k) => RE_LAUGH_TOKEN.test(k) || /^\d+$/.test(k))) continue;
      if (!slice.some((k) => k.length >= 3)) continue;
      const key = slice.join(' ');
      if (key.length < 5 || seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key);
      if (e) e.n++;
      else map.set(key, { n: 1, form: toks.slice(i, i + n).join(' ') });
    }
  }
  if (map.size > 300000) {
    for (const [k, v] of map) if (v.n < 2) map.delete(k);
  }
}

function pickPhrases(map) {
  const cands = [...map.entries()].filter(([, v]) => v.n >= 3)
    .map(([k, v]) => ({ k, n: v.n, form: v.form, words: k.split(' ').length }))
    .sort((a, b) => b.n * (1 + 0.25 * (b.words - 1)) - a.n * (1 + 0.25 * (a.words - 1)))
    .slice(0, 400);
  const chosen = [];
  for (const c of cands) {
    const pad = ` ${c.k} `;
    const cw = c.k.split(' ');
    const clash = chosen.some((x) => {
      if (` ${x.k} `.includes(pad) || pad.includes(` ${x.k} `)) return true;
      // fragmenty tego samego zdania ("wiesz co to był" / "co to był świetny")
      const xw = x.k.split(' ');
      const shared = cw.filter((w) => xw.includes(w)).length;
      if (shared >= 2 && shared >= Math.min(cw.length, xw.length) - 1) return true;
      const close = Math.abs(x.n - c.n) <= 0.15 * Math.max(x.n, c.n);
      return close && (edgeOverlap(xw, cw) || edgeOverlap(cw, xw));
    });
    if (clash) continue;
    chosen.push(c);
    if (chosen.length >= 5) break;
  }
  return chosen.map((c) => ({ t: c.form, n: c.n }));
}

function edgeOverlap(a, b) {
  // koniec a == początek b (co najmniej jedno słowo)
  for (let k = Math.min(a.length, b.length) - 1; k >= 1; k--) {
    if (a.slice(a.length - k).join(' ') === b.slice(0, k).join(' ')) return true;
  }
  return false;
}

function signatureWords(p, P) {
  const others = P.filter((x) => x !== p);
  if (!others.length) return [];
  const N = [...p.wordMap.values()].reduce((a, b) => a + b, 0);
  const other = new Map();
  let No = 0;
  for (const o of others) for (const [k, n] of o.wordMap) { bump(other, k, n); No += n; }
  const minCount = Math.max(4, Math.round(N / 2500));
  const out = [];
  for (const [k, n] of p.wordMap) {
    if (n < minCount) continue;
    const o = other.get(k) || 0;
    const ra = (n + 0.5) / (N + 1);
    const rb = (o + 0.5) / (No + 1);
    const ratio = ra / rb;
    if (ratio < 2) continue;
    out.push({ w: k, n, score: Math.log(ratio) * Math.log(1 + n) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map(({ w, n }) => ({ w, n }));
}

/* Typy rozmówców — każdy oparty o prawdziwą liczbę */
const PERSONAS = [
  { id: 'night', name: 'Nocny Marek', val: (p) => p.nightShare, thr: 0.1 },
  { id: 'morning', name: 'Ranny Ptaszek', val: (p) => p.morningShare, thr: 0.16 },
  { id: 'fast', name: 'Błyskawica', val: (p) => (p.respMedian != null ? 60 / Math.max(5, p.respMedian) : 0), thr: 1 },
  { id: 'essay', name: 'Eseista', val: (p) => p.avgWords, thr: 9 },
  { id: 'burst', name: 'Karabin Maszynowy', val: (p) => p.avgBurst, thr: 2.6 },
  { id: 'emoji', name: 'Emoji-holik', val: (p) => p.emojiRate, thr: 0.35 },
  { id: 'starter', name: 'Inicjator', val: (p, c) => (c.sessions ? p.starters / c.sessions : 0) * c.peopleCount, thr: 1.25 },
  { id: 'laugh', name: 'Śmieszek', val: (p) => p.laughShare, thr: 0.14 },
  { id: 'photo', name: 'Fotoreporter', val: (p) => (p.count ? (p.photos + p.videos) / p.count : 0), thr: 0.08 },
  { id: 'voice', name: 'Głosówkowicz', val: (p) => (p.audio >= 15 && p.count ? p.audio / p.count : 0), thr: 0.03 },
  { id: 'react', name: 'Reakcjonista', val: (p) => (p.count ? p.reactGiven / p.count : 0), thr: 0.08 },
  { id: 'curious', name: 'Ciekawski', val: (p) => p.questionShare, thr: 0.2 },
];

function assignPersonas(P, ctx) {
  const c = { sessions: ctx.sessions, peopleCount: P.length };
  const cands = [];
  const list = P.slice(0, 6);
  for (const p of list) {
    for (const def of PERSONAS) {
      const v = def.val(p, c);
      if (!v || v < def.thr) continue;
      const othersMax = Math.max(0, ...list.filter((o) => o !== p).map((o) => def.val(o, c) || 0));
      let score = v / def.thr;
      if (othersMax > 0) score *= Math.min(2, Math.max(0.5, Math.sqrt(v / othersMax)));
      cands.push({ p, def, v, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const used = new Set();
  const got = new Map();
  for (const x of cands) {
    if (got.has(x.p) || used.has(x.def.id)) continue;
    got.set(x.p, x);
    used.add(x.def.id);
  }
  // Kto nie przekroczył progu, dostaje cechę, w której najbardziej odstaje od reszty
  for (const p of list) {
    if (got.has(p)) continue;
    let best = null;
    for (const def of PERSONAS) {
      if (used.has(def.id)) continue;
      const v = def.val(p, c);
      if (!v) continue;
      const othersMax = Math.max(0, ...list.filter((o) => o !== p).map((o) => def.val(o, c) || 0));
      const rel = othersMax ? v / othersMax : 1;
      const score = (v / def.thr) * rel;
      if (v / def.thr >= 0.55 && rel >= 1 && (!best || score > best.score)) best = { p, def, v, score };
    }
    if (best) { got.set(p, best); used.add(best.def.id); }
  }
  return list.map((p) => {
    const x = got.get(p);
    if (!x) return { who: p.name, id: 'regular', name: 'Stały Bywalec', value: p.count };
    return { who: p.name, id: x.def.id, name: x.def.name, value: personaValue(x.def.id, p, c) };
  });
}

function personaValue(id, p, c) {
  switch (id) {
    case 'night': return p.nightShare;
    case 'morning': return p.morningShare;
    case 'fast': return p.respMedian;
    case 'essay': return p.avgWords;
    case 'burst': return p.avgBurst;
    case 'emoji': return { n: p.emojis, top: p.topEmoji[0] ? p.topEmoji[0].e : null };
    case 'starter': return c.sessions ? p.starters / c.sessions : 0;
    case 'laugh': return p.laughShare;
    case 'photo': return p.photos + p.videos;
    case 'voice': return p.audio;
    case 'react': return p.reactGiven;
    case 'curious': return p.questionShare;
    default: return p.count;
  }
}

/* ------------------------------------------------------------------ *
 * Komunikacja
 * ------------------------------------------------------------------ */
async function generate(chatId, year, opts, progress) {
  const thread = state.threads.find((t) => t.id === chatId);
  if (!thread) throw new EngineError('NO_CHAT');
  const all = await loadThreadMessages(thread, progress);
  progress({ phase: 'stats' });
  return computeStats(all, {
    year,
    title: displayTitle(thread),
    group: thread.participants.size > 2,
    selfName: state.selfName,
    offline: opts && opts.offline,
    now: opts && opts.now,
  });
}

function serializeError(err) {
  if (err instanceof EngineError) return { code: err.code, detail: err.detail };
  return { code: 'UNKNOWN', detail: String(err && err.message ? err.message : err) };
}

const api = { indexFiles, generate, computeStats, normalizeMessage, fixText, extractEmojis, listZip, readZipText, EngineError, state };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async (ev) => {
    const { id, cmd, payload } = ev.data || {};
    const progress = (info) => self.postMessage({ id, type: 'progress', info });
    try {
      let result;
      if (cmd === 'ping') result = { ok: true, decompress: typeof DecompressionStream !== 'undefined' };
      else if (cmd === 'index') result = await indexFiles(payload.files, progress);
      else if (cmd === 'generate') result = await generate(payload.chatId, payload.year, payload, progress);
      else if (cmd === 'reset') { state.files = []; state.threads = []; state.selfName = null; result = true; }
      else throw new EngineError('BAD_CMD');
      self.postMessage({ id, type: 'done', result });
    } catch (err) {
      self.postMessage({ id, type: 'error', error: serializeError(err) });
    }
  };
}
