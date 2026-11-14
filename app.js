import { html, render, useState, useEffect, useLayoutEffect, useMemo, useRef } from './vendor/preact-htm.js';
import {
  CATS, cat, catOf, guessCategory, CURRENCIES, uid, today, fmt, parseAmount, allocate, baseAmount, shares,
  balances, settle, stats, debtMove, vocative, toIban, spayd, dateLabel, seed,
} from './logic.js';
import {
  syncEnabled, shared, canon, merge, sanitize, sig, listRemote, joinRemote, leaveRemote,
  resetInvite, kickRemote, deleteAccount, groupUserIds, syncGroup, listBackups, getBackup, isAdmin, savePushSub, deletePushSub, getNotifyPrefs, setNotifyPrefs,
} from './sync.js';
import {
  getSession, onAuthChange, signUp, signIn, signInWithGoogle, sendPasswordReset,
  updatePassword, signOut, consumeUrl, MIN_PASSWORD, refreshMfa, mfaStart, mfaVerify, mfaDisable,
} from './auth.js';
import { GOOGLE_LOGIN } from './config.js';
import { parseSettleUp, decodeText } from './import.js';
import { EMOJI, COLORS } from './emoji.js';
import { pushSupported, isStandalone, isIos, pushState, enablePush, disablePush, notifyGroup, testPush } from './push.js';

const KEY = 'vyrovnano.v1';
const JKEY = 'vyrovnano.join';
function load(key, demo) {
  try {
    const d = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(d)) return d;
  } catch {}
  return demo ? [seed()] : [];
}

const PKEY = 'vyrovnano.profile';
function loadProfile(key) {
  try {
    const p = JSON.parse(localStorage.getItem(key));
    if (p && typeof p === 'object') {
      return {
        name: String(p.name || ''), avatar: p.avatar, iban: String(p.iban || ''),
        currency: CURRENCIES.includes(p.currency) ? p.currency : 'CZK',
        theme: ['light', 'dark'].includes(p.theme) ? p.theme : 'auto',
      };
    }
  } catch {}
  return { name: '', iban: '', currency: 'CZK', theme: 'auto' };
}

// První emoji z napsaného textu (i složené, např. vlajky nebo rodina).
function firstEmoji(text) {
  const parts = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('cs', { granularity: 'grapheme' }).segment(text)].map((x) => x.segment)
    : [...text];
  return parts.find((p) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(p)) || '';
}
const nameOf = (g, id) => g.members.find((m) => m.id === id)?.name || '?';

// Logo aplikace; varianta se volí podle světlého/tmavého režimu.
function Logo() {
  return html`
    <span class="logo">
      <img class="logo-d" src="brand/logo-dark.svg" alt="Vyrovnáno" width="590" height="116" />
      <img class="logo-l" src="brand/logo-light.svg" alt="Vyrovnáno" width="590" height="116" />
    </span>`;
}

// Linkové ikony pro spodní lištu a vyhledávání.
const ICONS = {
  home: 'M4 11l8-7 8 7M6 10v9h12v-9',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  swap: 'M6 8h12l-3-3M18 16H6l3 3',
  back: 'M15 5l-7 7 7 7',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  share: 'M12 15V4M8 8l4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
};
function Icon({ name, size = 22 }) {
  return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}

/* ---------- Drobné animace ---------- */

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Místo posledního klepnutí – odtud vyletí konfety.
let lastTap = { x: innerWidth / 2, y: innerHeight / 2 };
document.addEventListener('pointerdown', (e) => { lastTap = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });

// Krátký výbuch konfet v barvách aplikace (asi vteřina, bez zvuku). Použije se při úhradě dluhu.
function celebrate() {
  if (calm()) return;
  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue('--accent').trim(), css.getPropertyValue('--pos').trim(), '#fbbf24', '#60a5fa', '#f472b6'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  document.body.appendChild(layer);
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 150;
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist - 70;
    const size = 5 + Math.random() * 6;
    p.style.cssText = `left:${lastTap.x}px;top:${lastTap.y}px;width:${size}px;height:${size * (Math.random() < 0.5 ? 1 : 0.45)}px;` +
      `background:${colors[i % colors.length]};border-radius:${Math.random() < 0.4 ? '50%' : '2px'}`;
    layer.appendChild(p);
    p.animate([
      { transform: 'translate3d(0,0,0) rotate(0deg) scale(0.4)', opacity: 1 },
      { transform: `translate3d(${dx}px,${dy}px,0) rotate(${Math.random() * 540 - 270}deg) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate3d(${dx * 1.15}px,${dy + 100}px,0) rotate(${Math.random() * 720 - 360}deg) scale(0.9)`, opacity: 0 },
    ], { duration: 850 + Math.random() * 400, easing: 'cubic-bezier(0.16, 0.8, 0.3, 1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 1500);
}

// Částka, která při změně plynule „doběhne“ na novou hodnotu.
function CountUp({ value, format }) {
  const el = useRef();
  const prev = useRef(0);
  useLayoutEffect(() => {
    const from = prev.current, to = value;
    prev.current = value;
    if (from === to || calm() || document.hidden) { el.current.textContent = format(to); return; }
    const t0 = performance.now();
    let raf;
    el.current.textContent = format(Math.round(from / 100) * 100);
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 650);
      const eased = 1 - Math.pow(1 - p, 3);
      el.current.textContent = p < 1 ? format(Math.round((from + (to - from) * eased) / 100) * 100) : format(to);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Pojistka: kdyby prohlížeč animaci pozastavil, částka stejně skončí správně.
    const safety = setTimeout(() => { if (el.current) el.current.textContent = format(to); }, 900);
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [value]);
  return html`<span ref=${el}></span>`;
}

/* ---------- Drobné stavební prvky ---------- */

// Plynulost gest: při tažení se nemění stav aplikace (to by překreslovalo celé obrazovky),
// hýbe se jen s jedním prvkem přes transform. Stav se změní až po puštění prstu.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // průběh podobný animacím v iOS

function Sheet({ title, onClose, children }) {
  // Dotyk: okno jde zavřít stažením záhlaví dolů.
  const el = useRef();
  const g = useRef(null);
  const down = (e) => {
    if (e.pointerType === 'mouse' || e.clientX <= 26 || e.target.closest('button')) return;
    g.current = { y: e.clientY, dy: 0 };
    el.current.style.transition = 'none';
  };
  const move = (e) => {
    const p = g.current;
    if (!p) return;
    p.dy = Math.max(0, e.clientY - p.y);
    el.current.style.transform = `translate3d(0,${p.dy}px,0)`;
    el.current.classList.toggle('pulling', p.dy > 0);
  };
  const up = () => {
    const p = g.current;
    if (!p) return;
    g.current = null;
    const node = el.current;
    const go = p.dy > 110;
    node.style.transition = `transform 0.3s ${EASE}`;
    node.style.transform = go ? 'translate3d(0,100%,0)' : 'translate3d(0,0,0)';
    setTimeout(() => {
      if (go) return onClose();
      node.style.transition = ''; node.style.transform = ''; node.classList.remove('pulling');
    }, 300);
  };
  return html`
    <div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label=${title} ref=${el}>
        <div class="sheet-head" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
          <span class="grabber" aria-hidden="true"></span>
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="close" size=${18} /></button>
        </div>
        <div class="sheet-body">${children}</div>
      </div>
    </div>
  `;
}

// Dotyk: řádek jde odsunout. Doleva = smazat (vždy s potvrzením), doprava = upravit.
function SwipeRow({ onDelete, onEdit, children }) {
  const wrap = useRef();
  const fg = useRef();
  const st = useRef(null);
  const swiped = useRef(false);
  const LIMIT = 132, TRIGGER = 84;
  const down = (e) => { if (e.pointerType !== 'mouse' && e.clientX > 26) st.current = { x: e.clientX, y: e.clientY, on: false, dx: 0 }; };
  const move = (e) => {
    const p = st.current;
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st.current = null; return; } // svislé rolování
      if (Math.abs(dx) < 10) return;
      p.on = true;
      swiped.current = true;
      fg.current.style.transition = 'none';
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
    // Za hranicí klade řádek odpor, jako v iOS.
    const over = Math.abs(dx) - LIMIT;
    p.dx = over > 0 ? Math.sign(dx) * (LIMIT + over * 0.25) : dx;
    fg.current.style.transform = `translate3d(${p.dx}px,0,0)`;
    const c = wrap.current.classList;
    c.toggle('to-delete', p.dx < 0);
    c.toggle('to-edit', p.dx > 0);
    c.toggle('armed', Math.abs(p.dx) > TRIGGER);
  };
  const up = () => {
    const p = st.current;
    st.current = null;
    if (!p || !p.on) return;
    fg.current.style.transition = `transform 0.32s ${EASE}`;
    fg.current.style.transform = 'translate3d(0,0,0)';
    setTimeout(() => {
      if (fg.current) { fg.current.style.transition = ''; fg.current.style.transform = ''; }
      if (wrap.current) wrap.current.classList.remove('to-delete', 'to-edit', 'armed');
      swiped.current = false;
    }, 320);
    if (p.dx < -TRIGGER) onDelete();
    else if (p.dx > TRIGGER) onEdit();
  };
  return html`
    <div class="swipe" ref=${wrap}>
      <span class="swipe-bg edit" aria-hidden="true">Upravit</span>
      <span class="swipe-bg del" aria-hidden="true">Smazat</span>
      <div class="swipe-fg" ref=${fg}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
        onClickCapture=${(e) => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); } }}>
        ${children}
      </div>
    </div>
  `;
}

function Seg({ options, value, onChange }) {
  return html`
    <div class="seg">
      ${options.map(([v, label]) => html`
        <button type="button" class=${v === value ? 'on' : ''} onClick=${() => onChange(v)}>${label}</button>
      `)}
    </div>
  `;
}

/* ---------- Vlastní okna a nabídky (žádné systémové dialogy ani rozbalovací seznamy) ---------- */

let openDialog = null;
// Potvrzovací okno ve vzhledu aplikace; vrací true/false.
const ask = (message, opts = {}) =>
  new Promise((resolve) => (openDialog ? openDialog({ message, resolve, ...opts }) : resolve(false)));
// Informační okno s jedním tlačítkem.
const notify = (message) =>
  new Promise((resolve) => (openDialog ? openDialog({ message, resolve, info: true }) : resolve(true)));

function DialogHost() {
  const [d, setD] = useState(null);
  const done = (v) => { setD(null); d.resolve(v); };
  useEffect(() => { openDialog = setD; return () => { openDialog = null; }; }, []);
  useEffect(() => {
    if (!d) return;
    const key = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [d]);
  if (!d) return null;
  return html`
    <div class="overlay dialog-overlay" onClick=${(e) => e.target === e.currentTarget && done(false)}>
      <div class="dialog" role="alertdialog" aria-modal="true">
        <p>${d.message}</p>
        <div class="dialog-actions">
          ${!d.info && html`<button class="btn" onClick=${() => done(false)}>Zrušit</button>`}
          <button class="btn primary" onClick=${() => done(true)}>${d.info ? 'Rozumím' : d.ok || 'Potvrdit'}</button>
        </div>
      </div>
    </div>
  `;
}

// Zavře otevřenou nabídku při kliknutí mimo ni nebo klávesou Esc.
function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    // Při posunu stránky nebo okna by nabídka zůstala viset jinde než tlačítko, proto ji zavřeme.
    const scroll = (e) => { if (!ref.current || !ref.current.contains(e.target)) close(); };
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', out);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
}

// Umístění nabídky pod tlačítko (nebo nad něj, když dole není místo), vždy uvnitř obrazovky.
function popupStyle(anchor, width, height) {
  const r = anchor.getBoundingClientRect();
  const w = Math.max(width || 0, r.width);
  const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
  const below = innerHeight - r.bottom >= height + 12 || r.top < height + 12;
  return `left:${Math.round(left)}px;width:${Math.round(w)}px;` +
    (below ? `top:${Math.round(r.bottom + 6)}px` : `bottom:${Math.round(innerHeight - r.top + 6)}px`);
}

// Rozbalovací nabídka. options = [[hodnota, popisek], …]; popisek může být i obsah s fotkou.
function Select({ value, options, onChange, label, disabled }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState('');
  const ref = useRef();
  useDismiss(ref, open, () => setOpen(false));
  const cur = options.find((o) => o[0] === value);
  const toggle = () => {
    if (!open) setPos(popupStyle(ref.current, 0, Math.min(260, options.length * 42 + 14)));
    setOpen(!open);
  };
  return html`
    <div class="select" ref=${ref} onClick=${(e) => e.preventDefault()}>
      <button type="button" class="select-btn" aria-haspopup="listbox" aria-expanded=${open} aria-label=${label}
        disabled=${disabled} onClick=${toggle}>
        <span class="select-val">${cur ? cur[1] : ''}</span><${Icon} name="down" size=${16} />
      </button>
      ${open && html`
        <div class="select-menu" role="listbox" style=${pos}>
          ${options.map(([v, l]) => html`
            <button type="button" role="option" aria-selected=${v === value} class=${'menu-item' + (v === value ? ' on' : '')}
              onClick=${() => { onChange(v); setOpen(false); }}>${l}</button>
          `)}
        </div>`}
    </div>
  `;
}

// Výběr data s vlastním kalendářem.
function DateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(value.slice(0, 7));
  const [pos, setPos] = useState('');
  const ref = useRef();
  useDismiss(ref, open, () => setOpen(false));
  const [y, m] = view.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const shift = (d) => {
    const n = new Date(y, m - 1 + d, 1);
    setView(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`);
  };
  const iso = (d) => `${view}-${String(d).padStart(2, '0')}`;
  const label = new Date(value + 'T12:00:00').toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
  return html`
    <div class="select" ref=${ref} onClick=${(e) => e.preventDefault()}>
      <button type="button" class="select-btn" aria-label="Datum" aria-expanded=${open}
        onClick=${() => { setView(value.slice(0, 7)); if (!open) setPos(popupStyle(ref.current, 308, 348)); setOpen(!open); }}>
        <span class="select-val">${label}</span><${Icon} name="down" size=${16} />
      </button>
      ${open && html`
        <div class="select-menu cal" style=${pos}>
          <div class="cal-head">
            <button type="button" class="cal-nav" onClick=${() => shift(-1)} aria-label="Předchozí měsíc"><${Icon} name="left" size=${18} /></button>
            <strong>${first.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}</strong>
            <button type="button" class="cal-nav" onClick=${() => shift(1)} aria-label="Další měsíc"><${Icon} name="right" size=${18} /></button>
          </div>
          <div class="cal-grid">
            ${['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((d) => html`<span class="dow">${d}</span>`)}
            ${Array.from({ length: offset }, () => html`<span></span>`)}
            ${Array.from({ length: days }, (_, i) => html`
              <button type="button" class=${'cal-day' + (iso(i + 1) === value ? ' on' : iso(i + 1) === today() ? ' today' : '') + ((offset + i) % 7 > 4 ? ' weekend' : '')}
                onClick=${() => { onChange(iso(i + 1)); setOpen(false); }}>${i + 1}</button>
            `)}
          </div>
        </div>`}
    </div>
  `;
}

function Balance({ cents, currency, zero = 'vyrovnáno' }) {
  if (!cents) return html`<span class="muted">${zero}</span>`;
  return html`<span class=${cents > 0 ? 'pos' : 'neg'}>${cents > 0 ? '+' : '−'}${fmt(Math.abs(cents), currency)}</span>`;
}

function Avatar({ m, size = 32 }) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  if (m?.avatar) return html`<img class="ava" style=${style} src=${m.avatar} alt="" />`;
  const hue = ([...(m?.id || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360;
  const letter = [...(m?.name || '?').trim()][0] || '?';
  return html`<span class="ava" style=${`${style};background:hsl(${hue} 50% 42%)`}>${letter.toUpperCase()}</span>`;
}

// Vybere fotku, ořízne ji na čtverec a zmenší na 128 px. Překreslením se zároveň
// zahodí metadata fotky (poloha, čas, typ telefonu), takže se s nikým nesdílí.
function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      try {
        const bmp = await createImageBitmap(input.files[0], { imageOrientation: 'from-image' });
        const side = Math.min(bmp.width, bmp.height);
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 128, 128);
        resolve(c.toDataURL('image/jpeg', 0.8));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

// Výběr ikony skupiny: malé okno s nabídkou emoji a hledáním podle českých slov.
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('');
  const ref = useRef();
  useDismiss(ref, open, () => setOpen(false));
  const query = fold(q).trim();
  const typed = firstEmoji(q); // emoji vložené do hledání z klávesnice
  const cats = EMOJI
    .map(([name, items]) => [name, items.filter(([, k]) => !query || k.includes(query) || fold(name).includes(query))])
    .filter(([, items]) => items.length);
  const pick = (e) => { onChange(e); setOpen(false); };
  return html`
    <div class="select" ref=${ref} onClick=${(e) => e.preventDefault()}>
      <button type="button" class="select-btn emoji-btn" aria-label="Vybrat ikonu skupiny" aria-expanded=${open}
        onClick=${() => { if (!open) { setQ(''); setPos(popupStyle(ref.current, 340, 396)); } setOpen(!open); }}>
        <span class="select-val"><span class="emoji-now">${value}</span>Změnit ikonu</span><${Icon} name="down" size=${16} />
      </button>
      ${open && html`
        <div class="select-menu emoji-menu" style=${pos}>
          <input class="emoji-search" placeholder="Hledat: pivo, hory, auto…" aria-label="Hledat emoji" value=${q}
            onInput=${(e) => setQ(e.target.value)} />
          <div class="emoji-scroll">
            ${typed && html`
              <div class="emoji-cat">Vložené z klávesnice</div>
              <div class="emoji-grid"><button type="button" class="emoji-cell" onClick=${() => pick(typed)}>${typed}</button></div>`}
            ${cats.map(([name, items]) => html`
              <div class="emoji-cat">${name}</div>
              <div class="emoji-grid">
                ${items.map(([e, k]) => html`
                  <button type="button" class=${'emoji-cell' + (e === value ? ' on' : '')} title=${k} onClick=${() => pick(e)}>${e}</button>`)}
              </div>`)}
            ${!cats.length && !typed && html`<p class="muted emoji-none">Nic jsem nenašel. Emoji sem můžeš i vložit z klávesnice.</p>`}
          </div>
        </div>`}
    </div>
  `;
}

/* ---------- Domovská obrazovka ---------- */

function Home({ groups, profile, account, activeId, onOpen, onNew, onProfile, onReorder, onSortByName, onSearch }) {
  // Změna pořadí tažením celé karty. Na dotykovém displeji se karta „chytí“ krátkým podržením
  // (aby šlo seznamem normálně rolovat), myší stačí kartu stisknout a táhnout.
  // Během tažení se hýbe jen s kartami přes transform; pořadí se uloží až po puštění.
  const listRef = useRef();
  const press = useRef(null);
  const drag = useRef(null); // { from, to, startY, h, rows }
  const justDragged = useRef(false);
  useEffect(() => {
    // Při tažení nesmí stránka rolovat.
    const el = listRef.current;
    const stop = (e) => { if (drag.current) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);
  const begin = (p) => {
    const rows = [...listRef.current.querySelectorAll('.group-row')];
    const h = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : rows[0].offsetHeight + 12;
    try { p.el.setPointerCapture(p.pointerId); } catch {}
    justDragged.current = true;
    drag.current = { from: p.index, to: p.index, startY: p.y, h, rows };
    listRef.current.classList.add('is-dragging');
    rows[p.index].classList.add('dragging');
  };
  const down = (e, index) => {
    if (groups.length < 2 || e.button > 0 || e.clientX <= 26) return;
    const p = { index, x: e.clientX, y: e.clientY, pointerId: e.pointerId, el: e.currentTarget, touch: e.pointerType !== 'mouse' };
    press.current = p;
    if (p.touch) p.timer = setTimeout(() => { if (press.current === p) begin(p); }, 240);
  };
  const move = (e) => {
    const p = press.current;
    if (!p) return;
    const d = drag.current;
    if (!d) {
      const far = Math.abs(e.clientY - p.y) > 7 || Math.abs(e.clientX - p.x) > 7;
      if (!far) return;
      if (p.touch) { clearTimeout(p.timer); press.current = null; } // pohyb před podržením = rolování
      else begin(p);
      return;
    }
    const dy = e.clientY - d.startY;
    d.rows[d.from].style.transform = `translate3d(0,${dy}px,0) scale(1.03)`;
    const to = Math.max(0, Math.min(d.rows.length - 1, Math.round(d.from + dy / d.h)));
    if (to === d.to) return;
    d.to = to;
    d.rows.forEach((row, i) => {
      if (i === d.from) return;
      const shift = to > d.from ? (i > d.from && i <= to ? -d.h : 0) : (i < d.from && i >= to ? d.h : 0);
      row.style.transform = shift ? `translate3d(0,${shift}px,0)` : '';
    });
  };
  const finish = (commit) => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const done = () => {
      listRef.current.classList.remove('is-dragging');
      d.rows.forEach((row) => { row.style.transform = ''; row.style.transition = ''; row.classList.remove('dragging'); });
      if (commit && d.to !== d.from) onReorder(d.from, d.to);
      setTimeout(() => { justDragged.current = false; }, 80);
    };
    // Karta nejdřív dojede na své nové místo, teprve pak se pořadí uloží.
    const row = d.rows[d.from];
    row.style.transition = `transform 0.2s ${EASE}`;
    row.style.transform = `translate3d(0,${(commit ? d.to - d.from : 0) * d.h}px,0)`;
    setTimeout(done, 200);
  };
  // Součty na kartách se počítají jen při změně dat, ne při každém překreslení.
  const cards = useMemo(() => groups.map((g) => ({ my: balances(g)[g.me] || 0, total: stats(g).total })), [groups]);
  return html`
    <header class="top row">
      <div class="grow">
        <h1 class="brand"><${Logo} /></h1>
      </div>
      <button class="ava-btn" onClick=${onProfile} aria-label="Můj profil">
        <${Avatar} m=${{ id: 'me', name: profile.name || '🙂', avatar: profile.avatar }} size=${44} />
      </button>
    </header>
    <main>
      <${WelcomeCard} groups=${groups} name=${profile.name} />
      ${groups.length === 0 && html`
        <div class="empty">
          <div class="big">🧾</div>
          <p>Zatím tu není žádná skupina.</p>
        </div>
      `}
      ${groups.length > 1 && html`
        <div class="list-tools">
          <button class="search-btn only-wide" onClick=${onSearch}><${Icon} name="search" size=${16} /> Hledat <kbd>/</kbd></button>
          <button class="link-btn only-wide" onClick=${onSortByName}>Seřadit podle názvu</button>
        </div>`}
      <div class="group-list" ref=${listRef}>
      ${groups.map((g, i) => {
        const { my, total } = cards[i] || { my: 0, total: 0 };
        return html`
          <div class=${'group-row gc-' + (g.color || 'teal')} key=${g.id}
            onPointerDown=${(e) => down(e, i)} onPointerMove=${move} onPointerUp=${() => finish(true)}
            onPointerCancel=${() => finish(false)} onContextMenu=${(e) => e.preventDefault()}>
          <button class=${'card group-card' + (g.id === activeId ? ' active' : '')}
            title=${groups.length > 1 ? 'Podržením a tažením změníš pořadí' : ''}
            onClick=${() => { if (justDragged.current) return; onOpen(g.id); }}>
            <span class="avatar">${g.emoji}</span>
            <span class="grow">
              <strong>${g.name}</strong>
              <small class="muted">${g.members.filter((m) => !m.inactive).length} lidí${g.members.filter((m) => m.uid).length > 1 ? ' · sdílená' : ''}${account && !g.remote ? ' · čeká na odeslání' : ''}</small>
              <small class="muted">${total < 0 ? 'příjem ' : 'utraceno '}${fmt(Math.round(Math.abs(total) / 100) * 100, g.currency)}</small>
            </span>
            <span class="right">
              <small class="muted">${my > 0 ? 'dostaneš' : my < 0 ? 'dlužíš' : ''}</small>
              <${Balance} cents=${my} currency=${g.currency} />
            </span>
          </button>
          </div>
        `;
      })}
      </div>
      <button class="btn primary wide" onClick=${onNew}>+ Nová skupina</button>
    </main>
  `;
}

/* ---------- Úvodní plocha (když není vybraná skupina) ---------- */

const QUIPS = [
  ['🤝', 'Dobré účty dělají dobré přátele. Špatné účty dělají dlouhé skupinové chaty.'],
  ['💸', '„Pošlu ti to večer.“ Nejčastější lež hned po „už jsem na cestě“.'],
  ['🧾', '„Účet dohromady, rozpočítáme si to potom.“ Slavná poslední slova.'],
  ['🧠', 'Kdo platí, ten si pamatuje. Kdo dluží, zapomíná. Proto jsme tady.'],
  ['🍻', 'Přátelství se pozná podle toho, kdo zaplatí první kolo. A kdo ho sem zapíše.'],
  ['📮', 'Nikdo nerad posílá upomínky. Červené číslo to řekne za tebe.'],
  ['☕', 'Peníze nejsou všechno. Ale je příjemné vědět, kdo ti dluží za kafe.'],
  ['🎯', 'Dnes je krásný den někomu připomenout pětikilo.'],
  ['🧮', 'Počítat umí každý. Dopočítat se nikdo. Od toho je tu tahle stránka.'],
  ['🐢', 'Dluh není želva, sám neuteče. Ale taky sám nepřijde.'],
];

// Pozdrav, celkový stav přes všechny skupiny a náhodná hláška (vybraná jednou při zobrazení).
function useWelcome(groups, name) {
  const quip = useMemo(() => QUIPS[Math.floor(Math.random() * QUIPS.length)], []);
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Dobrou noc' : hour < 10 ? 'Dobré ráno' : hour < 18 ? 'Ahoj' : 'Dobrý večer';
  const totals = {};
  for (const g of groups) {
    const my = balances(g)[g.me] || 0;
    if (my) totals[g.currency] = (totals[g.currency] || 0) + my;
  }
  const lines = Object.entries(totals).filter(([, v]) => v);
  const sum = groups.length === 0
    ? html`Zatím tu nemáš žádnou skupinu. Vytvoř první.`
    : lines.length === 0
      ? html`<span class="pos">Se všemi jsi vyrovnaný.</span> Užij si ten vzácný pocit.`
      : html`${lines.map(([cur, v], i) => html`${i ? ' a ' : ''}${v > 0 ? 'Celkem ti lidi dluží ' : 'Celkem dlužíš '}<strong class=${v > 0 ? 'pos' : 'neg'}>${fmt(Math.abs(v), cur)}</strong>`)}.`;
  return { quip, greeting: `${hello}${name ? `, ${vocative(name)}` : ''}`, sum };
}

// Počítač: velká plocha vpravo, když není vybraná skupina.
function Welcome({ groups, name }) {
  const { quip, greeting, sum } = useWelcome(groups, name);
  return html`
    <div class="placeholder welcome">
      <div class="big">${quip[0]}</div>
      <h2>${greeting}</h2>
      <p class="welcome-sum">${sum}</p>
      <p class="welcome-quip">${quip[1]}</p>
      ${groups.length > 0 && html`<p class="muted welcome-hint">Vyber skupinu ze seznamu vlevo.</p>`}
    </div>
  `;
}

// Telefon: totéž jako karta pod seznamem skupin.
function WelcomeCard({ groups, name }) {
  const { quip, greeting, sum } = useWelcome(groups, name);
  return html`
    <section class="welcome-card only-narrow">
      <div class="row">
        <span class="welcome-emoji">${quip[0]}</span>
        <div class="grow"><h2>${greeting}</h2><p class="welcome-sum">${sum}</p></div>
      </div>
      <p class="welcome-quip">${quip[1]}</p>
    </section>
  `;
}

/* ---------- Detail skupiny ---------- */

function GroupView({ group, onBack, onEdit, onShare, onEntry, onAdd, onPay, onQr, onMove, onSearch, onDelete }) {
  const [tab, setTab] = useState('entries');
  const bal = useMemo(() => balances(group), [group]);
  const st = useMemo(() => stats(group), [group]);
  const my = bal[group.me] || 0;
  const cur = group.currency;

  // Počítač: pravý sloupec jede se stránkou, a když dojede na svůj konec, zůstane stát,
  // zatímco výdaje vlevo pokračují. Je-li nižší než okno, drží se hned pod záhlavím.
  const colRef = useRef();
  useEffect(() => {
    const place = () => {
      const col = colRef.current;
      if (!col) return;
      const headH = document.querySelector('.group-top')?.offsetHeight || 0;
      const fits = col.offsetHeight <= innerHeight - headH - 16;
      col.style.top = (fits ? headH : innerHeight - col.offsetHeight - 16) + 'px';
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(colRef.current);
    addEventListener('resize', place);
    return () => { ro.disconnect(); removeEventListener('resize', place); };
  }, []);

  // Dlouhé seznamy se vykreslí znovu jen při změně dat skupiny. Otevření okna nebo jiná drobná
  // změna stavu je tak nepřepočítává a animace zůstávají plynulé.
  const cb = useRef({});
  cb.current = { onEntry, onDelete, onPay, onQr, onMove };
  const canMove = !!onMove;
  const entriesView = useMemo(() => html`<${Entries} group=${group}
    onEntry=${(e) => cb.current.onEntry(e)} onDelete=${(e) => cb.current.onDelete(e)} />`, [group]);
  const debtsView = useMemo(() => html`<${Debts} group=${group} bal=${bal}
    onPay=${(p) => cb.current.onPay(p)} onQr=${(p) => cb.current.onQr(p)}
    onMove=${canMove ? (p) => cb.current.onMove(p) : null} />`, [group, bal, canMove]);
  const statsView = useMemo(() => html`<${Stats} group=${group} st=${st} />`, [group, st]);

  return html`
    <header class="top group-top">
      <div class="row">
        <button class="icon-btn back" onClick=${onBack} aria-label="Zpět"><${Icon} name="back" size=${20} /></button>
        <h1 class="grow">${group.emoji} ${group.name}</h1>
        <button class="btn primary small only-wide add-btn" onClick=${onAdd}>+ Přidat záznam</button>
        <button class="icon-btn only-wide" onClick=${onSearch} aria-label="Hledat ve skupině" title="Hledat (klávesa /)"><${Icon} name="search" size=${18} /></button>
        <button class="icon-btn" onClick=${onShare} aria-label="Sdílet skupinu"><${Icon} name="share" size=${18} /></button>
        <button class="icon-btn" onClick=${onEdit} aria-label="Upravit skupinu"><${Icon} name="settings" size=${18} /></button>
      </div>
      <div class="hero">
        <div>
          <small>${st.total < 0 ? 'Čistý příjem skupiny' : 'Celkem utraceno'}</small>
          <strong><${CountUp} value=${Math.abs(st.total)} format=${(v) => fmt(v, cur)} /></strong>
        </div>
        <div class="right">
          <small>${my > 0 ? 'Dostaneš zpět' : my < 0 ? 'Dlužíš' : 'Tvůj stav'}</small>
          <strong class=${my > 0 ? 'pos' : my < 0 ? 'neg' : ''}>${my
            ? html`<${CountUp} value=${Math.abs(my)} format=${(v) => fmt(v, cur)} />` : 'Vyrovnáno ✓'}</strong>
        </div>
      </div>
      <div class="tabs"><${Seg} value=${tab} onChange=${setTab} options=${[['entries', 'Výdaje'], ['debts', 'Dluhy'], ['stats', 'Přehled']]} /></div>
    </header>
    <main class="with-fab panels">
      <section class=${'panel p-entries' + (tab === 'entries' ? ' on' : '')}>
        <h2 class="panel-title">Výdaje</h2>
        ${entriesView}
      </section>
      <div class="col-right" ref=${colRef}>
      <section class=${'panel p-debts' + (tab === 'debts' ? ' on' : '')}>
        ${debtsView}
      </section>
      <section class=${'panel p-stats' + (tab === 'stats' ? ' on' : '')}>
        ${statsView}
      </section>
      </div>
    </main>
    <button class="fab" onClick=${onAdd} aria-label="Přidat výdaj">+</button>
  `;
}

function Entries({ group, onEntry, onDelete }) {
  const cur = group.currency;
  if (!group.entries.length) {
    return html`<div class="empty"><div class="big">💸</div><p>Zatím žádné výdaje.<br />Přidej první tlačítkem +.</p></div>`;
  }
  const sorted = [...group.entries].reverse().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const days = [];
  for (const e of sorted) {
    if (!days.length || days[days.length - 1].date !== e.date) days.push({ date: e.date, items: [] });
    days[days.length - 1].items.push(e);
  }
  return days.map((d) => html`
    <h3 class="day">${dateLabel(d.date)}</h3>
    <div class="card list">
      ${d.items.map((e) => {
        const base = baseAmount(e);
        if (e.kind === 'transfer') {
          const to = Object.keys(e.parts)[0];
          // Dopad na můj zůstatek: kdo platí, tomu zůstatek roste; příjemci klesá.
          const mineT = e.paidBy === group.me ? base : to === group.me ? -base : 0;
          // Převedený dluh z jiné skupiny čteme jako „dlužník dluží věřiteli“, ne jako platbu.
          const moved = e.mvd === 'in';
          const paid = !e.mv && (!e.title || e.title === 'Převod' || /vyrovn|uhra[zd]/i.test(e.title));
          return html`
            <${SwipeRow} onDelete=${() => onDelete(e)} onEdit=${() => onEntry(e)}>
            <button class="item" onClick=${() => onEntry(e)}>
              <span class="avatar sm">${e.mv ? '🔀' : '💱'}</span>
              <span class="grow">
                <strong>${moved ? `${nameOf(group, to)} dluží ${nameOf(group, e.paidBy)}` : `${nameOf(group, e.paidBy)} → ${nameOf(group, to)}`}</strong>
                <small>${paid ? html`<span class="paid-tag">uhrazeno</span>` : html`<span class="muted">${e.title}</span>`}</small>
              </span>
              <span class="right">
                <strong>${fmt(e.amount, e.currency)}</strong>
                <small><${Balance} cents=${mineT} currency=${cur} zero="netýká se tě" /></small>
              </span>
            </button>
            <//>
          `;
        }
        const inc = e.kind === 'income';
        const mine = (inc ? -1 : 1) * ((e.paidBy === group.me ? base : 0) - (shares(e)[group.me] || 0));
        return html`
          <${SwipeRow} onDelete=${() => onDelete(e)} onEdit=${() => onEntry(e)}>
          <button class="item" onClick=${() => onEntry(e)}>
            <span class="avatar sm">${inc ? '💰' : cat(catOf(e)).e}</span>
            <span class="grow">
              <strong>${e.title}</strong>
              <small class="muted">${inc ? 'příjem · přijal(a)' : 'platil(a)'} ${nameOf(group, e.paidBy)}${e.currency !== cur ? ` · ${fmt(e.amount, e.currency)}` : ''}</small>
            </span>
            <span class="right">
              <strong>${inc ? '+' : ''}${fmt(base, cur)}</strong>
              <small><${Balance} cents=${mine} currency=${cur} zero="netýká se tě" /></small>
            </span>
          </button>
          <//>
        `;
      })}
    </div>
  `);
}

function Debts({ group, bal, onPay, onQr, onMove }) {
  const cur = group.currency;
  const plan = settle(bal);
  const max = Math.max(1, ...Object.values(bal).map(Math.abs));
  return html`
    <h2 class="panel-title">Dluhy</h2>
    <h3 class="day">Jak se vyrovnat</h3>
    ${plan.length === 0
      ? html`<div class="card pad center settled">✓ Všichni jsou vyrovnaní, nikdo nikomu nic nedluží.</div>`
      : html`
        <div class="card list">
          ${plan.map((p) => {
            const iban = toIban(group.members.find((m) => m.id === p.to)?.iban);
            return html`
              <div class="pay">
                <div class="pay-row">
                  <span class="pay-who"><${Avatar} m=${group.members.find((m) => m.id === p.from)} size=${40} /><span>${nameOf(group, p.from)}</span></span>
                  <span class="pay-mid"><strong class=${'pay-amount' + (fmt(p.amount, cur).length > 11 ? ' long' : '')}>${fmt(p.amount, cur)}</strong><span class="pay-line" role="img" aria-label="platí"></span></span>
                  <span class="pay-who end"><span>${nameOf(group, p.to)}</span><${Avatar} m=${group.members.find((m) => m.id === p.to)} size=${40} /></span>
                </div>
                <div class="pay-actions">
                  <button class="btn small" onClick=${() => onQr({ ...p, iban })}>QR platba</button>
                  <button class="btn small due" onClick=${() => onPay(p)}>Uhradit</button>
                </div>
                ${onMove && html`<button class="link-btn pay-move" onClick=${() => onMove(p)}>Převést dluh do jiné skupiny</button>`}
              </div>
            `;
          })}
        </div>
        <p class="hint">Dluhy jsou přepočítané tak, aby se celá skupina vyrovnala co nejmenším počtem plateb (teď ${plan.length}).
          Až peníze pošleš, klepni na „Uhradit“: platba se zapíše do historie a dluh ze seznamu zmizí.</p>
      `}
    <h3 class="day">Zůstatky</h3>
    <div class="card pad">
      ${group.members.filter((m) => !m.inactive || bal[m.id]).map((m) => {
        const v = bal[m.id] || 0;
        return html`
          <div class="bal-row">
            <${Avatar} m=${m} size=${26} />
            <span class="bal-name">${m.name}${m.id === group.me ? html` <em class="tag">ty</em>` : ''}${m.inactive ? html` <em class="tag off">neaktivní</em>` : ''}</span>
            <span class="bal-bar">
              ${v !== 0 && html`<i class=${v > 0 ? 'p' : 'n'} style=${`width:${(Math.abs(v) / max) * 50}%`}></i>`}
            </span>
            <span class="bal-val"><${Balance} cents=${v} currency=${cur} zero="0" /></span>
          </div>
        `;
      })}
    </div>
  `;
}

function Stats({ group, st }) {
  const cur = group.currency;
  if (!st.total) return html`<div class="empty"><div class="big">📊</div><p>Přehled se objeví po prvním výdaji.</p></div>`;
  const cats = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]);
  const maxP = Math.max(1, ...group.members.map((m) => Math.max(st.consumed[m.id] || 0, st.paid[m.id] || 0)));
  return html`
    <h2 class="panel-title">Přehled</h2>
    <h3 class="day">Za co se utrácelo</h3>
    <div class="card pad">
      ${cats.map(([id, v]) => html`
        <div class="stat-row">
          <div class="row"><span class="grow">${cat(id).e} ${cat(id).n}</span><strong>${fmt(v, cur)}</strong><small class="muted pct">${Math.round((v / st.total) * 100)} %</small></div>
          <div class="track"><i style=${`width:${(v / st.total) * 100}%`}></i></div>
        </div>
      `)}
    </div>
    <h3 class="day">Kdo kolik</h3>
    <div class="card pad">
      ${group.members.map((m) => html`
        <div class="stat-row">
          <div class="row"><${Avatar} m=${m} size=${26} /><strong class="grow">${m.name}${m.inactive ? html` <em class="tag off">neaktivní</em>` : ''}</strong></div>
          <div class="row sub"><span class="lbl">zaplatil(a)</span><div class="track grow"><i class="alt" style=${`width:${((st.paid[m.id] || 0) / maxP) * 100}%`}></i></div><span class="num">${fmt(st.paid[m.id] || 0, cur)}</span></div>
          <div class="row sub"><span class="lbl">podíl na útratě</span><div class="track grow"><i style=${`width:${((st.consumed[m.id] || 0) / maxP) * 100}%`}></i></div><span class="num">${fmt(st.consumed[m.id] || 0, cur)}</span></div>
        </div>
      `)}
    </div>
  `;
}

/* ---------- Formulář výdaje / převodu ---------- */

function EntryForm({ group, entry, onSave, onDelete }) {
  // Neaktivní členy nabízíme jen u starých záznamů, ve kterých figurují.
  const members = group.members.filter((m) => !m.inactive || (entry && (entry.paidBy === m.id || m.id in entry.parts)));
  const init = entry || {
    kind: 'expense', title: '', amount: 0, currency: group.currency, rate: 1,
    paidBy: group.me, mode: 'equal', category: 'food', date: today(),
    parts: Object.fromEntries(members.map((m) => [m.id, 1])),
  };
  const [kind, setKind] = useState(init.kind);
  const [title, setTitle] = useState(init.title);
  const [amountStr, setAmountStr] = useState(init.amount ? String(init.amount / 100).replace('.', ',') : '');
  const [currency, setCurrency] = useState(init.currency);
  const [rateStr, setRateStr] = useState(String(init.rate).replace('.', ','));
  const [rateNote, setRateNote] = useState('');
  const [paidBy, setPaidBy] = useState(init.paidBy);
  const [category, setCategory] = useState(entry ? catOf(entry) : init.category);
  const [catTouched, setCatTouched] = useState(!!entry);
  const [date, setDate] = useState(init.date);
  const [mode, setMode] = useState(init.mode);
  const [parts, setParts] = useState(() =>
    Object.fromEntries(members.map((m) => {
      const v = init.kind !== 'transfer' ? init.parts[m.id] || 0 : 1;
      return [m.id, init.mode === 'exact' ? (v ? String(v / 100).replace('.', ',') : '') : v];
    })));
  const [to, setTo] = useState(
    init.kind === 'transfer' ? Object.keys(init.parts)[0] : members.find((m) => m.id !== init.paidBy)?.id);

  const amount = parseAmount(amountStr);
  const rate = currency === group.currency ? 1 : parseFloat(rateStr.replace(',', '.')) || 0;
  const foreign = currency !== group.currency;

  async function pickCurrency(c) {
    setCurrency(c);
    if (c === group.currency) return;
    setRateNote('Načítám aktuální kurz…');
    try {
      const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${c}&symbols=${group.currency}`);
      const j = await r.json();
      const v = j.rates[group.currency];
      setRateStr(String(v).replace('.', ','));
      setRateNote(`Kurz ECB z ${j.date}, můžeš ho přepsat.`);
    } catch {
      setRateNote('Kurz se nepodařilo načíst, zadej ho ručně.');
    }
  }

  function changeMode(m) {
    setMode(m);
    setParts(Object.fromEntries(members.map((x) => [x.id, m === 'exact' ? '' : 1])));
  }
  const setPart = (id, v) => setParts((p) => ({ ...p, [id]: v }));

  const weights = Object.fromEntries(
    members.map((m) => [m.id, mode === 'exact' ? parseAmount(parts[m.id]) : Number(parts[m.id]) || 0]));
  const preview = allocate(amount, weights, paidBy);
  const exactSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const exactLeft = amount - exactSum;

  let error = '';
  if (!amount) error = 'Zadej částku';
  else if (foreign && !rate) error = 'Zadej kurz';
  else if (kind === 'transfer') { if (!to || to === paidBy) error = 'Vyber dva různé lidi'; }
  else if (!exactSum) error = 'Vyber, mezi koho se dělí';
  else if (mode === 'exact' && exactLeft) error = exactLeft > 0 ? `Zbývá rozdělit ${fmt(exactLeft, currency)}` : `Rozděleno o ${fmt(-exactLeft, currency)} víc`;

  function submit(ev) {
    ev.preventDefault();
    if (error) return;
    const common = { id: entry?.id || uid(), amount, currency, rate, paidBy, date };
    if (kind === 'transfer') {
      onSave({ ...common, kind, title: 'Převod', mode: 'equal', category: 'other', parts: { [to]: 1 } });
    } else {
      const clean = Object.fromEntries(Object.entries(weights).filter(([, v]) => v > 0));
      onSave({ ...common, kind, title: title.trim() || cat(category).n, mode, category, parts: clean });
    }
  }

  return html`
    <form onSubmit=${submit} class="form">
      ${!entry && html`<${Seg} value=${kind} onChange=${setKind} options=${[['expense', 'Výdaj'], ['income', 'Příjem'], ['transfer', 'Převod']]} />`}

      <div class="amount-row">
        <input class="amount" inputmode="decimal" placeholder="0" value=${amountStr} onInput=${(e) => setAmountStr(e.target.value)} aria-label="Částka" />
        <div class="cur-pick"><${Select} label="Měna" value=${currency} onChange=${pickCurrency}
          options=${[...new Set([group.currency, ...CURRENCIES])].map((c) => [c, c])} /></div>
      </div>
      ${foreign && html`
        <label class="field">
          <span>Kurz: 1 ${currency} = ? ${group.currency}</span>
          <input inputmode="decimal" value=${rateStr} onInput=${(e) => setRateStr(e.target.value)} />
          <small class="muted">${rateNote}${amount && rate ? ` Celkem ${fmt(Math.round(amount * rate), group.currency)}.` : ''}</small>
        </label>
      `}

      ${kind !== 'transfer' && html`
        <label class="field">
          <span>Za co</span>
          <input placeholder="např. Večeře" maxlength="120" value=${title} onInput=${(e) => {
            setTitle(e.target.value);
            // Kategorie se nastaví sama podle názvu, dokud ji uživatel nevybere ručně.
            const g = guessCategory(e.target.value);
            if (!catTouched && g !== 'other') setCategory(g);
          }} />
        </label>
        <div class="chips">
          ${CATS.map((c) => html`
            <button type="button" class=${'chip' + (c.id === category ? ' on' : '')} onClick=${() => { setCategory(c.id); setCatTouched(true); }}><span>${c.e}</span><span>${c.n}</span></button>
          `)}
        </div>
      `}

      <div class="two">
        <label class="field">
          <span>${kind === 'transfer' ? 'Kdo platí' : kind === 'income' ? 'Kdo peníze přijal' : 'Kdo platil'}</span>
          <${Select} label="Plátce" value=${paidBy} onChange=${setPaidBy}
            options=${members.map((m) => [m.id, html`<span class="opt"><${Avatar} m=${m} size=${22} />${m.name}</span>`])} />
        </label>
        ${kind === 'transfer'
          ? html`
            <label class="field">
              <span>Komu</span>
              <${Select} label="Příjemce" value=${to} onChange=${setTo}
                options=${members.map((m) => [m.id, html`<span class="opt"><${Avatar} m=${m} size=${22} />${m.name}</span>`])} />
            </label>`
          : html`
            <label class="field">
              <span>Kdy</span>
              <${DateField} value=${date} onChange=${setDate} />
            </label>`}
      </div>

      ${kind !== 'transfer' && html`
        <div class="field">
          <span>Jak rozdělit</span>
          <${Seg} value=${mode} onChange=${changeMode} options=${[['equal', 'Rovným dílem'], ['shares', 'Podíly'], ['exact', 'Přesné částky']]} />
        </div>
        <div class="card list split">
          ${members.map((m) => html`
            <div class="item static">
              ${mode === 'equal' && html`
                <label class="check grow">
                  <input type="checkbox" checked=${!!parts[m.id]} onChange=${(e) => setPart(m.id, e.target.checked ? 1 : 0)} />
                  <span>${m.name}</span>
                </label>`}
              ${mode === 'shares' && html`
                <span class="grow">${m.name}</span>
                <span class="stepper">
                  <button type="button" onClick=${() => setPart(m.id, Math.max(0, (Number(parts[m.id]) || 0) - 1))}>−</button>
                  <b>${Number(parts[m.id]) || 0}×</b>
                  <button type="button" onClick=${() => setPart(m.id, (Number(parts[m.id]) || 0) + 1)}>+</button>
                </span>`}
              ${mode === 'exact' && html`
                <span class="grow">${m.name}</span>
                <input class="mini" inputmode="decimal" placeholder="0" value=${parts[m.id]} onInput=${(e) => setPart(m.id, e.target.value)} />`}
              ${mode !== 'exact' && html`<span class="share muted">${preview[m.id] ? fmt(preview[m.id], currency) : '—'}</span>`}
            </div>
          `)}
        </div>
      `}

      <button class="btn primary wide" disabled=${!!error}>${error || (entry ? 'Uložit změny' : 'Přidat')}</button>
      ${entry && html`<button type="button" class="btn danger wide" onClick=${onDelete}>Smazat</button>`}
    </form>
  `;
}

/* ---------- Formulář skupiny ---------- */

function GroupForm({ group, profile, userId, admin, deleteLabel, onSave, onDelete, onBackups }) {
  const [name, setName] = useState(group?.name || '');
  const [emoji, setEmoji] = useState(group?.emoji || '👥');
  const [color, setColor] = useState(group?.color || 'teal');
  const [currency, setCurrency] = useState(group?.currency || profile.currency || 'CZK');
  const [members, setMembers] = useState(group?.members || [{ id: uid(), name: profile.name || 'Já', avatar: profile.avatar, iban: profile.iban || undefined }, { id: uid(), name: '' }]);
  const [me, setMe] = useState(group?.me || members[0].id);
  const used = new Set((group?.entries || []).flatMap((e) => [e.paidBy, ...Object.keys(e.parts)]));
  // Číslo účtu smí měnit jen ten, komu člen patří, nebo správce aplikace (totéž hlídá server).
  const mayIban = (m) => !userId || admin || m.id === me || m.uid === userId;
  const upd = (id, patch) => setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const valid = members.filter((m) => m.name.trim());
  const error = !name.trim() ? 'Zadej název skupiny' : valid.length < 2 ? 'Přidej aspoň dva lidi' : '';

  function submit(ev) {
    ev.preventDefault();
    if (error) return;
    const ms = members.filter((m) => m.name.trim() || used.has(m.id)).map((m) => ({ ...m, name: m.name.trim() || '?', iban: (m.iban || '').trim() }));
    onSave({
      ...(group || {}), id: group?.id || uid(), entries: group?.entries || [],
      name: name.trim(), emoji, color, currency, members: ms, me: ms.some((m) => m.id === me) ? me : ms[0].id,
    });
  }

  return html`
    <form onSubmit=${submit} class="form">
      <label class="field">
        <span>Název</span>
        <input placeholder="např. Dovolená Chorvatsko" value=${name} onInput=${(e) => setName(e.target.value)} />
      </label>
      <div class="field">
        <span>Ikona</span>
        <${EmojiPicker} value=${emoji} onChange=${setEmoji} />
      </div>
      <div class="field">
        <span>Barva skupiny</span>
        <div class="swatches">
          ${COLORS.map(([id, label]) => html`
            <button type="button" class=${'swatch gc-' + id + (id === color ? ' on' : '')} title=${label} aria-label=${label}
              aria-pressed=${id === color} onClick=${() => setColor(id)}></button>`)}
        </div>
      </div>
      <label class="field">
        <span>Měna skupiny</span>
        <${Select} label="Měna skupiny" value=${currency} disabled=${!!group?.entries.length} onChange=${setCurrency}
          options=${CURRENCIES.map((c) => [c, c])} />
        ${group?.entries.length ? html`<small class="muted">Měnu nejde změnit, skupina už má výdaje.</small>` : ''}
      </label>

      <div class="field"><span>Členové</span></div>
      <div class="card list">
        ${members.map((m) => html`
          <div class="member">
            <div class="row">
              <button type="button" class="ava-btn" aria-label="Změnit fotku"
                onClick=${async () => { const a = await pickImage(); if (a) upd(m.id, { avatar: a }); }}>
                <${Avatar} m=${m} size=${36} />
              </button>
              <input class="grow" placeholder="Jméno" maxlength="60" value=${m.name} onInput=${(e) => upd(m.id, { name: e.target.value })} />
              ${m.uid && m.uid !== userId
                ? html`<em class="tag" title="Tento člen je propojený s jiným účtem">má účet</em>`
                : html`<label class="me-pick"><input type="radio" name="me" checked=${me === m.id} onChange=${() => setMe(m.id)} /> já</label>`}
              <button type="button" class="icon-btn" disabled=${used.has(m.id) || members.length <= 2}
                title=${used.has(m.id) ? 'Má výdaje, nejde odebrat' : 'Odebrat'}
                onClick=${() => setMembers((ms) => ms.filter((x) => x.id !== m.id))}><${Icon} name="close" size=${16} /></button>
            </div>
            <input class="iban" maxlength="50" value=${m.iban || ''} onInput=${(e) => upd(m.id, { iban: e.target.value })}
              disabled=${!mayIban(m)}
              placeholder=${mayIban(m) ? 'Číslo účtu pro QR platbu (nepovinné)' : 'Číslo účtu si vyplní člen sám'} />
            ${m.iban && !toIban(m.iban) ? html`<small class="neg">Zadej ve tvaru 123456789/0800 nebo IBAN.</small>` : ''}
            ${group && html`
              <label class="check small">
                <input type="checkbox" checked=${!!m.inactive} onChange=${(e) => upd(m.id, { inactive: e.target.checked || undefined })} />
                <span>Neaktivní (historie zůstane, v nových výdajích a seznamech se nenabízí)</span>
              </label>`}
          </div>
        `)}
      </div>
      <button type="button" class="btn wide" onClick=${() => setMembers((ms) => [...ms, { id: uid(), name: '' }])}>+ Přidat člena</button>

      <button class="btn primary wide" disabled=${!!error}>${error || (group ? 'Uložit' : 'Vytvořit skupinu')}</button>
      ${group && html`<button type="button" class="btn wide" onClick=${onBackups}>Zálohy a export</button>`}
      ${group && html`<button type="button" class="btn danger wide" onClick=${onDelete}>${deleteLabel}</button>`}
    </form>
  `;
}

/* ---------- QR kódy ---------- */

async function makeQr(text) {
  const mod = await import('./vendor/qrcode.js');
  const q = mod.default(0, 'M');
  q.addData(text);
  q.make();
  return q.createDataURL(8, 16);
}

function Qr({ text, alt }) {
  const [src, setSrc] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    makeQr(text).then(setSrc).catch(() => setErr(true));
  }, [text]);
  return src
    ? html`<img src=${src} alt=${alt} />`
    : html`<p class="muted">${err ? 'QR kód se nepodařilo vytvořit (jsi offline?).' : 'Vytvářím QR kód…'}</p>`;
}

function QrSheet({ group, pay, onPaid }) {
  return html`
    <div class="qr">
      <p><strong>${nameOf(group, pay.from)}</strong> platí <strong>${nameOf(group, pay.to)}</strong></p>
      <div class="qr-amount">${fmt(pay.amount, group.currency)}</div>
      <${Qr} alt="QR platba" text=${spayd(pay.iban, pay.amount, group.currency, `${group.name} - ${nameOf(group, pay.from)}`)} />
      <p class="hint">Naskenuj v bankovní aplikaci; částka i účet se vyplní samy. Účet: ${pay.iban}</p>
      <button class="btn done wide" onClick=${onPaid}>Uhrazeno, zapsat platbu</button>
    </div>
  `;
}

/* ---------- Sdílení ---------- */

function ShareSheet({ group, user, syncState, onReset, onKick }) {
  const [copied, setCopied] = useState(false);
  const [ids, setIds] = useState(null);
  useEffect(() => {
    if (user && group.remote) groupUserIds(group.id).then(setIds).catch(() => setIds([]));
  }, [group.invite, group.remote]);

  if (!user) {
    return html`<div class="form"><p>Sdílení zatím není zapnuté: aplikace ještě není propojená s databází.</p>
      <p class="hint">Do té doby zůstávají všechna data jen v tomto zařízení.</p></div>`;
  }
  if (!group.invite) {
    return html`<div class="form"><p>Skupina se ještě neuložila na server. ${
      syncState === 'err' ? 'Teď se nedaří připojit, zkus to za chvíli.' : 'Chvilku strpení…'}</p></div>`;
  }
  const link = `${location.origin}${location.pathname}#join=${group.invite}`;
  return html`
    <div class="form">
      <p>Skupinu vidí jen lidé, které pozveš. Pošli jim odkaz nebo ukaž QR kód. Po otevření se přihlásí svým účtem a skupina se jim přidá.</p>
      <div class="qr"><${Qr} text=${link} alt="QR kód pozvánky" /></div>
      <input readonly value=${link} onFocus=${(e) => e.target.select()} aria-label="Odkaz pozvánky" />
      <button class="btn primary wide" onClick=${async () => {
        try { await navigator.clipboard.writeText(link); setCopied(true); } catch {}
      }}>${copied ? 'Zkopírováno ✓' : 'Zkopírovat odkaz'}</button>
      ${navigator.share && html`<button class="btn wide" onClick=${() => navigator.share({ title: group.name, url: link }).catch(() => {})}>Sdílet…</button>`}

      <div class="field"><span>Kdo má přístup</span></div>
      <div class="card list">
        ${ids === null
          ? html`<div class="item static muted">Načítám…</div>`
          : ids.map((id) => {
              const m = group.members.find((x) => x.uid === id);
              return html`
                <div class="item static">
                  <${Avatar} m=${m || { id, name: '?' }} size=${32} />
                  <span class="grow">${m ? m.name : 'Nový člen (ještě si nevybral, kdo je)'}${id === user.id ? html` <em class="tag">ty</em>` : ''}</span>
                  ${group.owner && id !== user.id && html`<button class="btn small danger" onClick=${() => onKick(id, m?.name)}>Odebrat</button>`}
                </div>
              `;
            })}
      </div>
      ${group.owner && html`
        <button class="btn wide" onClick=${onReset}>Zrušit odkaz a vytvořit nový</button>
        <p class="hint">Starý odkaz přestane fungovat. Lidem, kteří už ve skupině jsou, přístup zůstane.</p>
      `}
    </div>
  `;
}

// Jména se porovnávají bez ohledu na velikost písmen; stačí shoda jména nebo příjmení.
const normName = (s) => String(s || '').trim().toLowerCase();
const sameName = (a, b) => {
  const x = normName(a), y = normName(b);
  return !!x && !!y && (x === y || x.split(/\s+/).some((w) => w.length > 2 && y.split(/\s+/).includes(w)));
};

function WhoSheet({ group, profile, known, onPick }) {
  const [name, setName] = useState(profile.name);
  const likely = (m) => known.some((k) => sameName(k, m.name));
  // Nabízíme jen členy, které si ještě nikdo nepřivlastnil; pravděpodobná shoda je nahoře.
  const free = group.members.filter((m) => !m.uid && !m.inactive).sort((a, b) => likely(b) - likely(a));
  return html`
    <div class="form">
      <p>Vyber, kdo ze skupiny jsi. Tvůj účet se propojí s tímto členem a s jeho dosavadními výdaji.</p>
      ${free.length > 0 && html`
        <div class="card list">
          ${free.map((m) => html`
            <button class="item" onClick=${() => onPick(m.id)}>
              <${Avatar} m=${m} size=${34} /><strong class="grow">${m.name}</strong>
              ${likely(m) && html`<em class="tag">nejspíš ty</em>`}
            </button>
          `)}
        </div>`}
      <label class="field">
        <span>Nejsem v seznamu</span>
        <input value=${name} maxlength="60" placeholder="Tvoje jméno" onInput=${(e) => setName(e.target.value)} />
      </label>
      <button class="btn wide" disabled=${!name.trim()} onClick=${() => onPick(null, name.trim())}>Přidat mě do skupiny</button>
    </div>
  `;
}

/* ---------- Vyhledávání ---------- */

const MONTHS = ['leden', 'unor', 'brezen', 'duben', 'kveten', 'cerven', 'cervenec', 'srpen', 'zari', 'rijen', 'listopad', 'prosinec'];
const KIND_WORDS = { expense: 'vydaj utrata', income: 'prijem', transfer: 'prevod platba uhrazeno vyrovnani' };

// Jedna prohledávatelná položka = jeden záznam se vším, podle čeho ho člověk může hledat.
function searchIndex(groups) {
  const out = [];
  for (const g of groups) {
    for (const e of g.entries) {
      const d = new Date(e.date + 'T12:00:00');
      const people = [e.paidBy, ...Object.keys(e.parts)].map((id) => nameOf(g, id)).join(' ');
      const dates = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${MONTHS[d.getMonth()]} ${e.date}`;
      out.push({
        g, e, base: baseAmount(e),
        hay: fold(`${e.title} ${e.kind === 'expense' ? cat(catOf(e)).n : ''} ${people} ${KIND_WORDS[e.kind] || ''} ${e.mv ? 'prevedeny dluh' : ''} ${g.name} ${e.currency}`),
        dates: fold(dates),
      });
    }
  }
  return out.sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : (b.e.u || 0) - (a.e.u || 0)));
}

// Jedno slovo dotazu: text, částka (706 nebo 706,5), porovnání (>500, <100) nebo datum (11.11., 2026, listopad).
function matchToken(it, t) {
  const cmp = t.match(/^([<>])=?(\d+(?:[.,]\d+)?)$/);
  if (cmp) {
    const n = parseFloat(cmp[2].replace(',', '.')) * 100;
    return cmp[1] === '>' ? it.base > n : it.base < n;
  }
  if (/^\d+(?:[.,]\d*)?$/.test(t)) {
    const [whole, dec] = t.split(/[.,]/);
    const hit = (cents) => String(Math.floor(cents / 100)) === whole && (!dec || String(cents % 100).padStart(2, '0').startsWith(dec));
    return hit(it.base) || hit(it.e.amount) || it.dates.includes(t);
  }
  return it.hay.includes(t) || it.dates.includes(t);
}

// Zvýrazní v textu části odpovídající hledaným slovům (bez ohledu na diakritiku a velikost písmen).
function Marked({ text, tokens }) {
  const chars = [...String(text)];
  const folded = chars.map((c) => fold(c) || c);
  const on = new Array(chars.length).fill(false);
  const flat = folded.join('');
  if (flat.length === chars.length) {
    for (const t of tokens) {
      if (t.length < 2 || /^[<>\d]/.test(t)) continue;
      for (let i = flat.indexOf(t); i >= 0; i = flat.indexOf(t, i + 1)) on.fill(true, i, i + t.length);
    }
  }
  const parts = [];
  for (let i = 0; i < chars.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.on === on[i]) last.s += chars[i];
    else parts.push({ on: on[i], s: chars[i] });
  }
  return parts.map((p) => (p.on ? html`<mark>${p.s}</mark>` : p.s));
}

function SearchSheet({ groups, scopeName, onOpen }) {
  const [q, setQ] = useState('');
  const inputRef = useRef();
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  const index = useMemo(() => searchIndex(groups), [groups]);
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  const found = tokens.length ? index.filter((it) => tokens.every((t) => matchToken(it, t))) : [];
  const many = groups.length > 1;

  // Součet nalezených výdajů (bez převodů), zvlášť pro každou měnu.
  const sums = {};
  for (const it of found) if (it.e.kind === 'expense') sums[it.g.currency] = (sums[it.g.currency] || 0) + it.base;

  // Rychlé návrhy: nejčastější kategorie v prohledávaných skupinách + pár užitečných filtrů.
  const tips = useMemo(() => {
    const count = {};
    for (const it of index) if (it.e.kind === 'expense') { const c = catOf(it.e); if (c !== 'other') count[c] = (count[c] || 0) + 1; }
    const cats = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 5).map((id) => [`${cat(id).e} ${cat(id).n}`, cat(id).n]);
    return [...cats, ['💰 Příjmy', 'příjem'], ['💱 Převody', 'převod'], ['Nad 1 000', '>1000'], [String(new Date().getFullYear()), String(new Date().getFullYear())]];
  }, [index]);

  return html`
    <div class="form search">
      <div class="search-box">
        <${Icon} name="search" size=${18} />
        <input ref=${inputRef} value=${q} placeholder="Název, částka, člověk, kategorie, datum…" aria-label="Hledat"
          enterkeyhint="search" autocomplete="off" autocapitalize="off" onInput=${(e) => setQ(e.target.value)} />
        ${q && html`<button type="button" class="search-clear" aria-label="Smazat hledání" onClick=${() => { setQ(''); inputRef.current.focus(); }}><${Icon} name="close" size=${12} /></button>`}
      </div>
      <p class="hint">Hledám ${many ? 've všech skupinách' : `ve skupině ${scopeName}`}. Slova můžeš kombinovat, třeba „internet michal 2026“ nebo „kafe >300“.</p>

      ${!tokens.length && html`
        <div class="chips">
          ${tips.map(([label, value]) => html`<button type="button" class="chip" onClick=${() => setQ(value)}>${label}</button>`)}
        </div>`}

      ${tokens.length > 0 && html`
        <div class="search-sum">
          <strong>${found.length === 0 ? 'Nic nenalezeno' : found.length === 1 ? '1 záznam' : found.length < 5 ? `${found.length} záznamy` : `${found.length} záznamů`}</strong>
          ${Object.entries(sums).map(([c, v]) => html`<span class="muted">výdaje celkem <strong>${fmt(v, c)}</strong></span>`)}
        </div>`}

      ${found.length > 0 && html`
        <div class="card list">
          ${found.slice(0, 80).map((it) => {
            const { e, g } = it;
            const to = Object.keys(e.parts)[0];
            const title = e.kind === 'transfer'
              ? (e.mvd === 'in' ? `${nameOf(g, to)} dluží ${nameOf(g, e.paidBy)}` : `${nameOf(g, e.paidBy)} → ${nameOf(g, to)}`)
              : e.title;
            const sub = e.kind === 'transfer' ? e.title : `${e.kind === 'income' ? 'přijal(a)' : 'platil(a)'} ${nameOf(g, e.paidBy)}`;
            return html`
              <button class="item" onClick=${() => onOpen(g.id, e)}>
                <span class="avatar sm">${e.kind === 'transfer' ? (e.mv ? '🔀' : '💱') : e.kind === 'income' ? '💰' : cat(catOf(e)).e}</span>
                <span class="grow">
                  <strong><${Marked} text=${title} tokens=${tokens} /></strong>
                  <small class="muted"><${Marked} text=${`${dateLabel(e.date)} · ${sub}${many ? ` · ${g.name}` : ''}`} tokens=${tokens} /></small>
                </span>
                <span class="right"><strong>${e.kind === 'income' ? '+' : ''}${fmt(it.base, g.currency)}</strong></span>
              </button>`;
          })}
        </div>
        ${found.length > 80 && html`<p class="hint center">Zobrazuji prvních 80. Upřesni hledání a uvidíš zbytek.</p>`}`}
    </div>
  `;
}

/* ---------- Moje dluhy napříč skupinami ---------- */

function AllDebts({ groups, onOpen }) {
  const rows = [];
  const get = {}, owe = {};
  for (const g of groups) {
    for (const p of settle(balances(g))) {
      if (p.from !== g.me && p.to !== g.me) continue;
      const mine = p.to === g.me; // true = někdo dluží mně
      rows.push({ g, p, mine, other: g.members.find((m) => m.id === (mine ? p.from : p.to)) });
      (mine ? get : owe)[g.currency] = ((mine ? get : owe)[g.currency] || 0) + p.amount;
    }
  }
  rows.sort((a, b) => b.p.amount - a.p.amount);
  const total = (o) => Object.entries(o).map(([c, v]) => fmt(v, c)).join(' + ') || fmt(0, 'CZK');
  return html`
    <div class="form">
      <div class="two">
        <div class="card set-card tile"><small class="muted">Dostaneš</small><strong class="pos">${total(get)}</strong></div>
        <div class="card set-card tile"><small class="muted">Dlužíš</small><strong class="neg">${total(owe)}</strong></div>
      </div>
      ${rows.length === 0
        ? html`<div class="card pad center settled">✓ Se všemi jsi vyrovnaný.</div>`
        : html`
          <div class="card list">
            ${rows.map(({ g, p, mine, other }) => html`
              <button class="item" onClick=${() => onOpen(g.id)}>
                <${Avatar} m=${other} size=${40} />
                <span class="grow">
                  <strong>${other?.name || '?'}</strong>
                  <small class="muted">${mine ? 'dluží ti' : 'dlužíš'} · ${g.emoji} ${g.name}</small>
                </span>
                <span class="right"><strong class=${mine ? 'pos' : 'neg'}>${mine ? '+' : '−'}${fmt(p.amount, g.currency)}</strong></span>
              </button>`)}
          </div>
          <p class="hint">Klepnutím otevřeš skupinu, kde dluh uhradíš, pošleš QR platbu nebo ho převedeš jinam.</p>`}
    </div>
  `;
}

/* ---------- Převod dluhu do jiné skupiny ---------- */

// Najde ve skupině člena odpovídajícího danému členovi jiné skupiny: nejdřív podle
// propojeného účtu, jinak podle jména. Vrací null, když si není jistý (žádná nebo víc shod).
function matchMember(target, src) {
  if (src.uid) {
    const byUid = target.members.find((m) => m.uid === src.uid);
    if (byUid) return byUid;
  }
  const byName = target.members.filter((m) => !m.inactive && sameName(m.name, src.name));
  return byName.length === 1 ? byName[0] : null;
}

function MoveSheet({ group, groups, pay, onMove }) {
  const from = group.members.find((m) => m.id === pay.from);
  const to = group.members.find((m) => m.id === pay.to);
  const options = groups.filter((g) => g.id !== group.id).map((g) => {
    const f = matchMember(g, from), t = matchMember(g, to);
    const why = g.currency !== group.currency ? `jiná měna (${g.currency})`
      : !f ? `chybí ${from.name}` : !t ? `chybí ${to.name}` : f.id === t.id ? 'nejde rozlišit členy' : '';
    return { g, f, t, why };
  });
  return html`
    <div class="form">
      <p><strong>${from.name}</strong> dluží <strong>${to.name}</strong> <strong class="neg">${fmt(pay.amount, group.currency)}</strong>.
        Vyber skupinu, kam se má tento dluh přesunout.</p>
      ${options.length === 0 && html`<p class="muted">Nemáš žádnou další skupinu.</p>`}
      <div class="card list">
        ${options.map(({ g, f, t, why }) => html`
          <button class="item" disabled=${!!why} onClick=${() => onMove(g, f, t)}>
            <span class="avatar sm">${g.emoji}</span>
            <span class="grow">
              <strong>${g.name}</strong>
              <small class="muted">${why ? `Nelze: ${why}` : `${f.name} bude dlužit ${t.name}`}</small>
            </span>
          </button>
        `)}
      </div>
      <p class="hint">Tady se dluh označí jako převedený a zmizí. V cílové skupině se stejná částka připočte k tomu, co si tam ti dva dluží. Obě změny jsou vidět v historii a dají se smazat.</p>
    </div>
  `;
}

// Záznam o převedeném dluhu se neupravuje (musel by se měnit v obou skupinách zároveň),
// dá se jen smazat – a to vždy v obou skupinách najednou.
function MovedInfo({ group, entry, other, onDelete }) {
  const to = Object.keys(entry.parts)[0];
  const debtor = entry.mvd === 'in' ? to : entry.paidBy;
  const creditor = entry.mvd === 'in' ? entry.paidBy : to;
  return html`
    <div class="form">
      <p><strong>${nameOf(group, debtor)}</strong> dluží <strong>${nameOf(group, creditor)}</strong> <strong class="neg">${fmt(entry.amount, entry.currency)}</strong>.</p>
      <p>${entry.mvd === 'in'
        ? `Tento dluh sem byl převeden ze skupiny „${other ? other.name : 'ke které nemáš přístup'}“, kde tím zmizel.`
        : `Tento dluh byl odsud převeden do skupiny „${other ? other.name : 'ke které nemáš přístup'}“, kde se připočetl.`}</p>
      <p class="hint">Převod má dvě části, v každé skupině jednu. Mazat je jde jen společně, aby dluh nikde nezmizel ani nepřibyl navíc.</p>
      <button class="btn danger wide" onClick=${onDelete}>Zrušit převod v obou skupinách</button>
    </div>
  `;
}

/* ---------- Zálohy ---------- */

function downloadFile(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function BackupSheet({ group, user, onRestore }) {
  const [list, setList] = useState(user && group.remote ? null : []);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (user && group.remote) listBackups(group.id).then(setList).catch(() => { setFailed(true); setList([]); });
  }, []);
  const when = (iso) => new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return html`
    <div class="form">
      <button class="btn wide" onClick=${() => downloadFile(
        `${group.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'skupina'}-${today()}.json`,
        JSON.stringify({ app: 'vyrovnano', exported: new Date().toISOString(), group: shared(group) }, null, 1))}>
        Stáhnout kopii skupiny do zařízení
      </button>
      <p class="hint">Soubor obsahuje všechny výdaje, členy a jejich fotky. Uložte si ho tam, kam nemá přístup nikdo cizí.</p>

      <div class="field"><span>Zálohy na serveru</span></div>
      ${list === null && html`<p class="muted">Načítám…</p>`}
      ${list && list.length === 0 && html`<p class="muted">${
        !user ? 'Zálohy na serveru jsou dostupné po přihlášení.'
        : failed ? 'Zálohy se nepodařilo načíst.'
        : 'Zatím žádná záloha. První vznikne do hodiny po změně ve skupině.'}</p>`}
      ${list && list.length > 0 && html`
        <div class="card list">
          ${list.map((b) => html`
            <div class="item static">
              <span class="grow"><strong>${when(b.at)}</strong><small class="muted">${b.entries} záznamů</small></span>
              <button class="btn small" onClick=${() => onRestore(b.at, when(b.at))}>Obnovit</button>
            </div>
          `)}
        </div>`}
      <p class="hint">Záloha vzniká každou hodinu, pokud se skupina změnila. Uchovává se posledních 48 verzí; starší se přepisují.</p>
    </div>
  `;
}

/* ---------- Účet a profil ---------- */

function PasswordForm({ label = 'Změnit heslo', onDone }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await updatePassword(pw);
      setPw('');
      setMsg('Heslo je změněné ✓');
      onDone && onDone();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }
  return html`
    <form class="form" onSubmit=${submit}>
      <input class="vh" type="email" name="email" autocomplete="username" readonly tabindex="-1" aria-hidden="true" value=${getSession()?.user?.email || ''} />
      <label class="field">
        <span>Nové heslo (aspoň ${MIN_PASSWORD} znaků)</span>
        <input type="password" name="new-password" autocomplete="new-password" minlength=${MIN_PASSWORD} maxlength="72" required value=${pw} onInput=${(e) => setPw(e.target.value)} />
      </label>
      <button class="btn wide" disabled=${busy || pw.length < MIN_PASSWORD}>${busy ? 'Ukládám…' : label}</button>
      ${msg && html`<p class="hint" role="status">${msg}</p>`}
    </form>
  `;
}

// Pole na šestimístný kód z ověřovací aplikace; iPhone ho umí nabídnout sám z Hesel.
function CodeInput({ value, onInput }) {
  return html`<input class="code-input" type="text" name="one-time-code" inputmode="numeric" autocomplete="one-time-code"
    pattern="[0-9]{6}" maxlength="6" placeholder="000000" required value=${value}
    onInput=${(e) => onInput(e.target.value.replace(/\D/g, '').slice(0, 6))} />`;
}

// Dvoufázové ověření v nastavení účtu: zapnutí (QR kód + potvrzení kódem) a vypnutí.
function MfaSettings() {
  const [mfa, setMfa] = useState(getSession()?.mfa || null);
  const [setup, setSetup] = useState(null); // { id, uri, secret }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => onAuthChange((s) => setMfa(s?.mfa || null)), []);
  const run = async (fn) => {
    setBusy(true);
    setMsg('');
    try { await fn(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const start = () => run(async () => setSetup(await mfaStart()));
  const confirm = (ev) => {
    ev.preventDefault();
    run(async () => {
      await mfaVerify(setup.id, code);
      setSetup(null);
      setCode('');
      setMsg('Dvoufázové ověření je zapnuté ✓');
    });
  };
  const off = async () => {
    if (!(await ask('Vypnout dvoufázové ověření? Účet pak bude chránit jen heslo.', { ok: 'Vypnout' }))) return;
    run(async () => { await mfaDisable(); setMsg('Dvoufázové ověření je vypnuté.'); });
  };
  if (setup) return html`
    <form class="form mfa-setup" onSubmit=${confirm}>
      <p class="hint"><strong>1.</strong> Otevři ověřovací aplikaci (Hesla na iPhonu, Google Authenticator, 1Password…) a naskenuj tento kód.</p>
      <div class="qr mfa-qr"><${Qr} text=${setup.uri} alt="QR kód pro ověřovací aplikaci" /></div>
      ${isIos() && html`<a class="btn wide" href=${setup.uri}>Přidat do Hesel na tomto iPhonu</a>`}
      <p class="hint">Nejde skenovat? Zadej do aplikace ručně tento klíč: <code class="secret">${setup.secret}</code></p>
      <label class="field">
        <span><strong>2.</strong> Opiš šestimístný kód, který aplikace ukazuje</span>
        <${CodeInput} value=${code} onInput=${setCode} />
      </label>
      ${msg && html`<p class="notice" role="status">${msg}</p>`}
      <div class="row">
        <button type="button" class="btn grow" onClick=${() => { setSetup(null); setCode(''); setMsg(''); }}>Zrušit</button>
        <button class="btn primary grow" disabled=${busy || code.length !== 6}>${busy ? 'Ověřuji…' : 'Zapnout'}</button>
      </div>
    </form>`;
  return html`
    <div class="form">
      <div class="row mfa-state">
        <div class="grow">
          <strong>Dvoufázové ověření</strong>
          <small class=${mfa ? 'pos' : 'muted'}>${mfa ? 'Zapnuté ✓' : 'Vypnuté'}</small>
        </div>
        <button class=${'btn small' + (mfa ? '' : ' primary')} disabled=${busy} onClick=${mfa ? off : start}>${busy ? 'Moment…' : mfa ? 'Vypnout' : 'Zapnout'}</button>
      </div>
      <p class="hint">${mfa
        ? 'Při přihlášení se kromě hesla ptáme i na kód z ověřovací aplikace. Bez něj se do účtu nedostane nikdo, ani kdyby znal heslo.'
        : 'Při přihlášení se kromě hesla zeptáme i na kód z ověřovací aplikace v telefonu. Kdyby ti někdo zjistil heslo, do účtu se bez tvého telefonu nedostane.'}</p>
      ${msg && html`<p class="hint" role="status">${msg}</p>`}
    </div>`;
}

// Obrazovka po přihlášení heslem, když má účet zapnuté dvoufázové ověření.
function MfaScreen({ factorId }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(ev) {
    ev && ev.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setMsg('');
    try { await mfaVerify(factorId, code); } catch (e) { setMsg(e.message); setCode(''); setBusy(false); }
  }
  useEffect(() => { if (code.length === 6) submit(); }, [code]);
  return html`
    <div class="app auth">
      <header class="top"><h1 class="brand"><${Logo} /></h1></header>
      <main>
        <h2>Dvoufázové ověření</h2>
        <p>Zadej šestimístný kód z ověřovací aplikace.</p>
        <form class="form" onSubmit=${submit}>
          <${CodeInput} value=${code} onInput=${setCode} />
          ${msg && html`<p class="notice" role="status">${msg}</p>`}
          <button class="btn primary wide" disabled=${busy || code.length !== 6}>${busy ? 'Ověřuji…' : 'Ověřit'}</button>
        </form>
        <button class="btn link wide" onClick=${() => signOut()}>Přihlásit se jiným účtem</button>
        <p class="hint center">Nemáš přístup k ověřovací aplikaci? Napiš správci aplikace, ověření ti vypne.</p>
      </main>
    </div>
  `;
}

// Zapnutí a vypnutí notifikací na tomto zařízení.
function PushSettings() {
  const [state, setState] = useState('loading'); // loading | unsupported | denied | on | off
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Co má chodit: platí pro účet (všechna jeho zařízení) a filtruje to server.
  const [prefs, setPrefs] = useState({ scope: 'mine', types: {} });
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
  useEffect(() => {
    getNotifyPrefs().then((p) => setPrefs({ scope: p?.scope === 'all' ? 'all' : 'mine', types: p?.types || {} })).catch(() => {});
  }, []);
  const change = (next) => { setPrefs(next); setNotifyPrefs(next).catch(() => setMsg('Volbu se nepodařilo uložit. Zkus to prosím znovu.')); };
  const KINDS = [['entry', 'Nové a upravené výdaje'], ['deleted', 'Smazané záznamy'], ['paid', 'Úhrady a převody dluhů'], ['joined', 'Noví členové skupiny']];
  async function toggle() {
    setBusy(true);
    setMsg('');
    try {
      if (state === 'on') await disablePush(deletePushSub);
      else await enablePush(savePushSub);
      setState(await pushState());
    } catch (e) {
      setMsg(Notification.permission === 'denied'
        ? 'Notifikace jsou pro tuhle aplikaci zakázané v nastavení telefonu.'
        : 'Notifikace se nepodařilo zapnout. Zkus to prosím znovu.');
      setState(await pushState().catch(() => 'off'));
    }
    setBusy(false);
  }
  const needsInstall = state === 'unsupported' && isIos() && !isStandalone();
  return html`
    <section class="card set-card">
      <h3>Notifikace</h3>
      ${state === 'unsupported'
        ? html`<p class="hint">${needsInstall
            ? 'Na iPhonu fungují notifikace jen v aplikaci přidané na plochu. V Safari klepni na Sdílet → Přidat na plochu a otevři Vyrovnáno odtamtud.'
            : 'Tento prohlížeč notifikace nepodporuje.'}</p>`
        : html`
          <div class="row">
            <span class="grow">${state === 'on' ? 'Na tomto zařízení zapnuté' : state === 'denied' ? 'Zakázané v nastavení zařízení' : 'Na tomto zařízení vypnuté'}</span>
            <button class=${'btn small' + (state === 'on' ? '' : ' primary')} disabled=${busy || state === 'loading' || state === 'denied'} onClick=${toggle}>
              ${busy ? 'Moment…' : state === 'on' ? 'Vypnout' : 'Zapnout'}
            </button>
          </div>
          <p class="hint">${msg || 'Dostaneš zprávu, když někdo ve tvé skupině přidá, upraví nebo smaže výdaj, uhradí dluh nebo se připojí. Vlastní změny ti nechodí.'}</p>
          <div class="field">
            <span>Co mi má chodit</span>
            <${Seg} value=${prefs.scope} onChange=${(scope) => change({ ...prefs, scope })}
              options=${[['mine', 'Jen co se mě týká'], ['all', 'Všechno ve skupinách']]} />
          </div>
          <p class="hint">${prefs.scope === 'mine'
            ? 'Přijde ti jen to, kde figuruješ: výdaj, který platíš nebo se na něm podílíš, a úhrady, kde jsi plátce nebo příjemce.'
            : 'Přijde ti každá změna ve tvých skupinách, i mezi ostatními členy.'}</p>
          <div class="checks">
            ${KINDS.map(([id, label]) => html`
              <label class="check">
                <input type="checkbox" checked=${prefs.types[id] !== false}
                  onChange=${(e) => change({ ...prefs, types: { ...prefs.types, [id]: e.target.checked } })} />
                <span>${label}</span>
              </label>`)}
          </div>
          ${state === 'on' && html`<button class="btn wide" disabled=${busy} onClick=${async () => {
            setBusy(true);
            try {
              const r = await testPush();
              setMsg(r.sent > 0 ? 'Zkušební notifikace odeslána. Měla by dorazit během pár vteřin.'
                : `Zkušební notifikaci se nepodařilo doručit${r.failed ? ` (chyba ${r.failed})` : ''}.`);
            } catch { setMsg('Zkušební notifikaci se nepodařilo odeslat.'); }
            setBusy(false);
          }}>Poslat zkušební notifikaci</button>`}`}
    </section>
  `;
}

function ProfileSheet({ profile, user, admin, groupCount, onSave, onLogout, onDeleteAccount, onImport, onExportAll }) {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [iban, setIban] = useState(profile.iban || '');
  const [currency, setCurrency] = useState(profile.currency || 'CZK');
  const [theme, setTheme] = useState(profile.theme || 'auto');
  const ibanBad = !!iban.trim() && !toIban(iban);
  const dirty = name.trim() !== profile.name || avatar !== profile.avatar || iban.trim() !== (profile.iban || '')
    || currency !== (profile.currency || 'CZK') || theme !== (profile.theme || 'auto');
  const pick = async () => { const a = await pickImage(); if (a) setAvatar(a); };
  return html`
    <div class="form settings">
      <div class="profile-head">
        <button class="ava-btn" onClick=${pick} aria-label="Změnit fotku">
          <${Avatar} m=${{ id: 'me', name: name || '🙂', avatar }} size=${84} />
        </button>
        <div class="grow">
          <strong class="profile-name">${name.trim() || 'Bez jména'}</strong>
          ${user && html`<small class="muted">${user.email}</small>`}
          <div class="row profile-photo-actions">
            <button class="btn small" onClick=${pick}>${avatar ? 'Změnit fotku' : 'Přidat fotku'}</button>
            ${avatar && html`<button class="btn small danger" onClick=${() => setAvatar(undefined)}>Odebrat</button>`}
          </div>
        </div>
      </div>

      <section class="card set-card">
        <h3>Osobní údaje</h3>
        <label class="field">
          <span>Jméno</span>
          <input value=${name} maxlength="60" placeholder="Jak ti říkají" onInput=${(e) => setName(e.target.value)} />
        </label>
        <p class="hint">Jméno a fotku uvidí jen lidé ve tvých skupinách. Fotka se zmenší a uloží bez údajů o poloze.</p>
      </section>

      <section class="card set-card">
        <h3>Platební údaje</h3>
        <label class="field">
          <span>Číslo účtu</span>
          <input value=${iban} maxlength="50" inputmode="text" autocomplete="off" placeholder="např. 123456789/0800 nebo IBAN"
            onInput=${(e) => setIban(e.target.value)} />
        </label>
        ${ibanBad
          ? html`<p class="hint neg">Tohle nevypadá jako číslo účtu. Zadej ho ve tvaru 123456789/0800 nebo jako IBAN.</p>`
          : html`<p class="hint">Použije se pro QR platby ve všech tvých skupinách: kdo ti dluží, naskenuje kód a částka i účet se vyplní samy.${
              iban.trim() ? ` IBAN: ${toIban(iban)}` : ''}</p>`}
      </section>

      <section class="card set-card">
        <h3>Předvolby</h3>
        <div class="field">
          <span>Výchozí měna nových skupin</span>
          <${Select} label="Výchozí měna" value=${currency} onChange=${setCurrency} options=${CURRENCIES.map((c) => [c, c])} />
        </div>
        <div class="field">
          <span>Vzhled</span>
          <${Seg} value=${theme} onChange=${setTheme} options=${[['auto', 'Podle systému'], ['light', 'Světlý'], ['dark', 'Tmavý']]} />
        </div>
      </section>

      ${user && html`<${PushSettings} />`}

      <button class="btn primary wide" disabled=${!dirty || ibanBad}
        onClick=${() => onSave({ name: name.trim(), avatar, iban: iban.trim(), currency, theme })}>
        ${dirty ? 'Uložit změny' : 'Vše uloženo'}
      </button>

      ${user && html`
        <section class="card set-card">
          <h3>Účet a zabezpečení</h3>
          <dl class="facts">
            <dt>E-mail</dt><dd>${user.email}</dd>
            <dt>Přihlášení</dt><dd>${user.provider === 'google' ? 'přes Google' : 'e-mailem a heslem'}</dd>
            <dt>Skupiny</dt><dd>${groupCount}</dd>
            ${admin && html`<dt>Role</dt><dd>správce aplikace</dd>`}
          </dl>
          <${MfaSettings} />
          ${user.provider === 'email' && html`<${PasswordForm} />`}
        </section>`}

      <section class="card set-card">
        <h3>Data</h3>
        <button class="btn wide" onClick=${onExportAll}>Stáhnout všechny moje skupiny</button>
        <p class="hint">Soubor se zálohou všech skupin, výdajů a členů. Ulož si ho tam, kam nemá přístup nikdo cizí.</p>
        <button class="btn wide" onClick=${onImport}>Importovat skupinu ze Settle Up</button>
      </section>

      ${user && html`
        <section class="card set-card">
          <h3>Odhlášení</h3>
          <p class="hint">Jsi přihlášen jako ${user.email}. Po odhlášení se můžeš přihlásit k jinému účtu. Tvoje skupiny zůstanou uložené a po dalším přihlášení je tu zase najdeš.</p>
          <button class="btn primary wide" onClick=${onLogout}>Odhlásit se</button>
        </section>
        <section class="card set-card">
          <h3>Smazání účtu</h3>
          <p class="hint">Skupiny, kde jsi jediný, zmizí. Ve sdílených skupinách zůstanou tvoje výdaje ostatním. Nejde to vrátit.</p>
          <button class="btn danger wide" onClick=${onDeleteAccount}>Smazat účet</button>
        </section>`}
    </div>
  `;
}

function AuthScreen({ notice }) {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(notice || '');
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const mail = email.trim().toLowerCase();
      if (mode === 'in') await signIn(mail, pw);
      else if (mode === 'up') {
        if ((await signUp(mail, pw)) === 'confirm') {
          setMsg('Hotovo. Poslali jsme ti e-mail s potvrzovacím odkazem; po kliknutí na něj se přihlásíš.');
          setPw('');
        }
      } else {
        await sendPasswordReset(mail);
        setMsg('Pokud u nás účet s tímto e-mailem existuje, poslali jsme na něj odkaz pro nastavení nového hesla.');
      }
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  return html`
    <div class="app auth">
      <header class="top">
        <h1 class="brand"><${Logo} /></h1>
      </header>
      <main>
        ${mode !== 'forgot' && html`<${Seg} value=${mode} onChange=${(m) => { setMode(m); setMsg(''); }} options=${[['in', 'Přihlášení'], ['up', 'Nový účet']]} />`}
        ${mode === 'forgot' && html`<p>Zadej e-mail svého účtu a pošleme ti odkaz pro nastavení nového hesla.</p>`}
        <form class="form" onSubmit=${submit}>
          <label class="field">
            <span>E-mail</span>
            <input type="email" name="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck=${false}
              autocomplete="username" required maxlength="254" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          </label>
          ${mode !== 'forgot' && html`
            <label class="field">
              <span>Heslo${mode === 'up' ? ` (aspoň ${MIN_PASSWORD} znaků)` : ''}</span>
              <input type="password" name="password" required minlength=${mode === 'up' ? MIN_PASSWORD : 1} maxlength="72"
                autocomplete=${mode === 'up' ? 'new-password' : 'current-password'} value=${pw} onInput=${(e) => setPw(e.target.value)} />
            </label>`}
          ${msg && html`<p class="notice" role="status">${msg}</p>`}
          <button class="btn primary wide" disabled=${busy}>
            ${busy ? 'Moment…' : mode === 'in' ? 'Přihlásit se' : mode === 'up' ? 'Vytvořit účet' : 'Poslat odkaz'}
          </button>
        </form>
        ${mode === 'in' && html`<button class="btn link wide" onClick=${() => { setMode('forgot'); setMsg(''); }}>Zapomenuté heslo</button>`}
        ${mode === 'forgot' && html`<button class="btn wide" onClick=${() => { setMode('in'); setMsg(''); }}>Zpět na přihlášení</button>`}
        ${GOOGLE_LOGIN && mode !== 'forgot' && html`
          <div class="divider">nebo</div>
          <button class="btn wide" onClick=${signInWithGoogle}>Pokračovat přes Google</button>
        `}
        <p class="hint center">Tvoje skupiny vidí jen lidé, které do nich pozveš. <a href="privacy.html">Zásady ochrany soukromí</a></p>
      </main>
    </div>
  `;
}

/* ---------- Aplikace ---------- */

function App({ user, recovery }) {
  const gkey = user ? `${KEY}.${user.id}` : KEY;
  const pkey = user ? `${PKEY}.${user.id}` : PKEY;
  const [groups, setGroups] = useState(() => load(gkey, !user));
  const [profile, setProfile] = useState(() => loadProfile(pkey));
  const [gid, setGid] = useState(null);
  const [sheet, setSheet] = useState(recovery ? { type: 'newpw' } : null);
  const [syncState, setSyncState] = useState('');
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (user) isAdmin().then((v) => setAdmin(v === true)).catch(() => {});
  }, []);
  const ref = useRef(groups);
  ref.current = groups;
  const gidRef = useRef(gid);
  gidRef.current = gid;
  const busy = useRef({});
  const synced = useRef({});
  // Zprávy pro ostatní členy čekají, až se změna uloží na server; pak se odešlou jako notifikace.
  const outbox = useRef({});
  // type: entry | deleted | paid | joined. memberIds = členové, kterých se změna přímo týká;
  // podle toho server pozná, komu ji poslat, když má někdo zapnuté „jen co se mě týká“.
  const announce = (g, text, type = 'entry', memberIds = []) => {
    if (!user || !g) return;
    const who = g.members.find((m) => m.id === g.me)?.name || prof.name || 'Někdo';
    const involved = [...new Set(memberIds.map((id) => g.members.find((m) => m.id === id)?.uid).filter(Boolean))];
    (outbox.current[g.id] = outbox.current[g.id] || { name: g.name, items: [] }).items.push({ text: `${who}: ${text}`, type, involved });
  };
  const leaving = useRef(false);

  useEffect(() => { if (!leaving.current) localStorage.setItem(gkey, JSON.stringify(groups)); }, [groups]);
  useEffect(() => { if (!leaving.current) localStorage.setItem(pkey, JSON.stringify(profile)); }, [profile]);

  const group = groups.find((g) => g.id === gid);
  const close = () => setSheet(null);
  // Dotyk: tažení od levého okraje doprava = zpět. Aktuální obrazovka (okno, nebo skupina) jede
  // s prstem a pod ní je vidět ta, na kterou se vracíš. Po puštění buď dojede pryč, nebo se vrátí.
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  useEffect(() => {
    let st = null;
    const root = document.documentElement;
    const start = (e) => {
      const t = e.touches[0];
      if (t.clientX > 26 || e.touches.length > 1 || document.querySelector('.dialog')) return;
      const el = sheetRef.current
        ? document.querySelector('.overlay:not(.dialog-overlay) .sheet')
        : gidRef.current ? document.querySelector('.main-pane') : null;
      if (el) st = { x: t.clientX, y: t.clientY, el, sheet: !!sheetRef.current, on: false, dx: 0, under: sheetRef.current ? null : document.querySelector('.side') };
    };
    const move = (e) => {
      if (!st) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (!st.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; } // svislý pohyb = rolování
        if (dx < 8) return;
        st.on = true;
        root.classList.add(st.sheet ? 'peek-sheet' : 'peek-back');
        st.el.style.transition = 'none';
        if (st.under) st.under.style.transition = 'none';
      }
      e.preventDefault();
      st.dx = Math.max(0, dx);
      st.el.style.transform = `translateX(${st.dx}px)`;
      if (st.under) {
        // Spodní obrazovka lehce „dojíždí“ zleva a rozjasňuje se.
        const p = Math.min(1, st.dx / innerWidth);
        st.under.style.transform = `translateX(${Math.round(-60 * (1 - p))}px)`;
        st.under.style.opacity = String(0.55 + 0.45 * p);
      }
    };
    const end = () => {
      const s = st;
      st = null;
      if (!s || !s.on) return;
      const go = s.dx > Math.min(130, innerWidth * 0.33);
      s.el.style.transition = 'transform 0.22s ease-out';
      s.el.style.transform = go ? 'translateX(100%)' : 'translateX(0)';
      if (s.under) {
        s.under.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
        s.under.style.transform = go ? 'translateX(0)' : 'translateX(-60px)';
        s.under.style.opacity = go ? '1' : '0.55';
      }
      setTimeout(() => {
        if (go) { if (s.sheet) setSheet(null); else setGid(null); }
        // Úklid až po překreslení, aby obrazovka neproblikla.
        requestAnimationFrame(() => {
          root.classList.remove('peek-sheet', 'peek-back');
          for (const el of [s.el, s.under]) if (el) { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }
        });
      }, 230);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, []);
  // Klávesové zkratky pro hledání: „/“ nebo Ctrl/Cmd + K (když se zrovna nepíše do pole).
  useEffect(() => {
    const key = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setSheet((cur) => (cur ? cur : { type: 'search', all: !ref.current.some((g) => g.id === gidRef.current) }));
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  // S účtem se „kdo jsem já“ neukládá do zařízení, ale pozná se podle účtu propojeného se členem.
  const withMe = (g) => (user ? { ...g, me: g.members.find((m) => m.uid === user.id)?.id ?? null } : g);
  const prof = { ...profile, name: profile.name || (user ? user.name || user.email.split('@')[0] : '') };
  // Jména, pod kterými už tenhle účet vystupuje v jiných skupinách – pro návrh v „Kdo jsi?“.
  const known = [prof.name, ...groups.flatMap((g) => g.members.filter((m) => user && m.uid === user.id).map((m) => m.name))];

  /* --- synchronizace --- */
  async function sync(id) {
    const g = ref.current.find((x) => x.id === id);
    if (!user || !g || busy.current[id]) return;
    busy.current[id] = true;
    try {
      const res = await syncGroup(g);
      if (res.gone) {
        // Přístup mi byl odebrán nebo skupina zanikla: zmizí i z tohoto zařízení.
        delete synced.current[id];
        setGroups((gs) => gs.filter((x) => x.id !== id));
        setGid((cur) => (cur === id ? null : cur));
      } else {
        synced.current[id] = canon(res.data);
        const box = outbox.current[id];
        if (box) {
          delete outbox.current[id];
          for (const it of box.items.slice(0, 6)) notifyGroup(id, box.name, it.text, it.type, it.involved);
        }
        // Sloučíme znovu s aktuálním stavem, kdyby uživatel mezitím něco změnil.
        setGroups((gs) => {
          const x = gs.find((g) => g.id === id);
          if (!x) return gs;
          const local = sanitize(shared(x));
          const m = merge(local, res.data);
          const same = canon(m) === canon(local) && x.invite === res.invite && x.owner === res.owner && x.remote;
          // Beze změny vracíme tentýž seznam, takže se nic nepřekresluje ani znovu neukládá.
          if (same) return gs;
          const next = withMe({ ...x, ...m, invite: res.invite, owner: res.owner, remote: true });
          return gs.map((g) => (g.id === id ? next : g));
        });
      }
      setSyncState('ok');
    } catch {
      setSyncState('err');
    } finally {
      busy.current[id] = false;
    }
  }
  // Seznam mých skupin ze serveru (např. po přihlášení na novém zařízení).
  async function refreshList() {
    if (!user) return;
    try {
      const rows = await listRemote();
      setGroups((gs) => {
        const add = rows.filter((r) => !gs.some((g) => g.id === r.id));
        return add.length
          ? [...gs, ...add.map((r) => withMe({ id: r.id, remote: true, invite: r.invite, owner: r.owner, ...r.data }))]
          : gs;
      });
      setProfile((p) => {
        if (p.name || p.avatar) return p;
        const mine = rows.flatMap((r) => r.data.members).find((m) => m.uid === user.id);
        return mine ? { ...p, name: mine.name, avatar: mine.avatar, iban: mine.iban || '' } : p;
      });
      setSyncState('ok');
    } catch {
      setSyncState('err');
    }
  }
  useEffect(() => {
    if (gid === null) refreshList();
  }, [gid]);
  // Po každé změně odešleme skupiny, které se liší od poslední synchronizace.
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      for (const g of groups) if (sig(g) !== synced.current[g.id]) sync(g.id);
    }, 400);
    return () => clearTimeout(t);
  }, [groups]);
  // Otevřená skupina se pravidelně ptá serveru na změny od ostatních.
  useEffect(() => {
    if (!user) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (gid) sync(gid);
      else refreshList();
    };
    const iv = setInterval(tick, gid ? 6000 : 30000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick); };
  }, [gid]);

  /* --- pozvánky --- */
  async function join(token) {
    if (!user) return notify('Sdílení zatím není zapnuté.');
    try {
      const row = await joinRemote(token);
      if (!row) return notify('Pozvánka je neplatná nebo už byla zrušena.');
      setGroups((gs) => (gs.some((g) => g.id === row.id)
        ? gs
        : [...gs, withMe({ id: row.id, remote: true, invite: row.invite, owner: row.owner, ...row.data })]));
      setSheet(null);
      setGid(row.id);
    } catch {
      notify('Pozvánku se nepodařilo otevřít. Jsi online?');
    }
  }
  useEffect(() => {
    const fromHash = () => {
      const m = location.hash.match(/^#join=([a-f0-9]{32})$/);
      if (!m) return;
      history.replaceState(null, '', location.pathname);
      join(m[1]);
    };
    let stashed = null;
    try { stashed = sessionStorage.getItem(JKEY); sessionStorage.removeItem(JKEY); } catch {}
    if (stashed && /^[a-f0-9]{32}$/.test(stashed)) join(stashed);
    fromHash();
    addEventListener('hashchange', fromHash);
    return () => removeEventListener('hashchange', fromHash);
  }, []);

  /* --- úpravy dat --- */
  const putGroup = (g) => {
    setGroups((gs) => (gs.some((x) => x.id === g.id) ? gs.map((x) => (x.id === g.id ? g : x)) : [...gs, g]));
    close();
  };
  function saveGroupForm(g) {
    let out = { ...g, mu: Date.now() };
    if (user) {
      if (!groups.some((x) => x.id === g.id)) out.id = crypto.randomUUID();
      out.members = out.members.map((m) => ({ ...m, uid: m.id === out.me ? user.id : m.uid === user.id ? undefined : m.uid }));
    }
    putGroup(out);
  }
  const saveEntry = (e, note, type = 'entry') => {
    const entry = { ...e, u: Date.now() };
    const has = group.entries.some((x) => x.id === e.id);
    const what = e.kind === 'transfer' ? 'převod' : e.kind === 'income' ? 'příjem' : 'výdaj';
    announce(group, note || `${has ? 'upraven' : 'nový'} ${what} „${e.title}“ (${fmt(e.amount, e.currency)})`,
      e.kind === 'transfer' ? 'paid' : type, [e.paidBy, ...Object.keys(e.parts)]);
    putGroup({ ...group, entries: has ? group.entries.map((x) => (x.id === e.id ? entry : x)) : [...group.entries, entry] });
  };
  // Mazání a zápis platby jsou špatně vratné, proto se vždy ptáme.
  async function deleteEntry(id) {
    const e = group.entries.find((x) => x.id === id);
    if (!e) return;
    const now = Date.now();
    const drop = (g, eid) => ({ ...g, entries: g.entries.filter((x) => x.id !== eid), dead: { ...(g.dead || {}), [eid]: now } });
    if (e.mv) {
      // Převedený dluh: druhá část leží v jiné skupině a maže se zároveň.
      const other = groups.find((g) => g.id === e.mvg);
      const twin = other?.entries.find((x) => x.mv === e.mv);
      if (!other) {
        return notify('Druhá část tohoto převodu je ve skupině, ke které nemáš přístup. Zrušit ho může jen někdo, kdo je v obou skupinách.');
      }
      const where = e.mvd === 'in' ? `vrátí do skupiny „${other.name}“` : `vrátí sem ze skupiny „${other.name}“`;
      if (!(await ask(`Zrušit převod dluhu ${fmt(e.amount, e.currency)}? Smaže se v obou skupinách a dluh se ${where}.`, { ok: 'Zrušit převod' }))) return;
      announce(group, `zrušen převod dluhu ${fmt(e.amount, e.currency)}`, 'deleted', [e.paidBy, ...Object.keys(e.parts)]);
      if (twin) announce(other, `zrušen převod dluhu ${fmt(e.amount, e.currency)}`, 'deleted', [twin.paidBy, ...Object.keys(twin.parts)]);
      setGroups((gs) => gs.map((g) => (
        g.id === group.id ? drop(g, e.id) : twin && g.id === other.id ? drop(g, twin.id) : g)));
      return close();
    }
    if (!(await ask(`Opravdu smazat záznam „${e.title || 'Převod'}“ (${fmt(e.amount, e.currency)})? Zmizí všem členům skupiny.`, { ok: 'Smazat' }))) return;
    announce(group, `smazán záznam „${e.title || 'Převod'}“ (${fmt(e.amount, e.currency)})`, 'deleted', [e.paidBy, ...Object.keys(e.parts)]);
    putGroup(drop(group, id));
  }
  async function payDebt(p) {
    const msg = `Označit dluh jako uhrazený? ${nameOf(group, p.from)} → ${nameOf(group, p.to)}, ${fmt(p.amount, group.currency)}. Peníze tím nikam neodejdou, jen se platba zapíše do historie a dluh zmizí všem členům.`;
    if (!(await ask(msg, { ok: 'Uhrazeno' }))) return;
    celebrate();
    saveEntry({
      id: uid(), kind: 'transfer', title: 'Převod', amount: p.amount, currency: group.currency, rate: 1,
      paidBy: p.from, mode: 'equal', parts: { [p.to]: 1 }, category: 'other', date: today(),
    }, `uhrazeno ${fmt(p.amount, group.currency)} (${nameOf(group, p.from)} → ${nameOf(group, p.to)})`);
  }
  // Převod dluhu: tady vznikne převod, který dluh vyrovná, a v cílové skupině opačný převod,
  // který tam stejný dluh založí. Do statistik útraty se ani jeden nepočítá.
  async function moveDebt(pay, target, f, t) {
    const amount = fmt(pay.amount, group.currency);
    const msg = `Převést dluh ${amount} do skupiny „${target.name}“? ${nameOf(group, pay.from)} bude dál dlužit ${nameOf(group, pay.to)}, jen v jiné skupině: tady dluh zmizí a tam se připočte.`;
    if (!(await ask(msg, { ok: 'Převést' }))) return;
    const pair = debtMove(group, target, pay, f, t);
    announce(group, `dluh ${amount} (${nameOf(group, pay.from)} → ${nameOf(group, pay.to)}) převeden do skupiny „${target.name}“`, 'paid', [pay.from, pay.to]);
    announce(target, `dluh ${amount} (${f.name} → ${t.name}) převeden ze skupiny „${group.name}“`, 'paid', [f.id, t.id]);
    setGroups((gs) => gs.map((g) => (
      g.id === group.id ? { ...g, entries: [...g.entries, pair.out] }
      : g.id === target.id ? { ...g, entries: [...g.entries, pair.in] } : g)));
    close();
  }
  function openQr(pay) {
    if (!pay.iban) {
      return notify(`${nameOf(group, pay.to)} nemá vyplněné číslo účtu, takže QR platbu nejde vytvořit. Číslo účtu si každý doplní sám v nastavení skupiny (ikona ozubeného kola).`);
    }
    setSheet({ type: 'qr', pay });
  }

  const needsWho = group && !group.members.some((m) => m.id === group.me);
  function pickWho(id, newName) {
    const mine = { uid: user?.id };
    const taken = id && group.members.find((m) => m.id === id)?.uid;
    if (taken && taken !== user?.id) return notify('Tohoto člena si mezitím vybral někdo jiný. Vyber prosím jiného.');
    announce(group, `nový člen ve skupině (${id ? nameOf(group, id) : newName})`, 'joined');
    if (id) {
      putGroup({ ...group, mu: Date.now(), me: id,
        members: group.members.map((m) => (m.id === id ? { ...m, ...mine, avatar: m.avatar || profile.avatar, iban: m.iban || profile.iban || undefined } : m)) });
    } else {
      const m = { id: uid(), name: newName, avatar: profile.avatar, iban: profile.iban || undefined, ...mine };
      putGroup({ ...group, mu: Date.now(), me: m.id, members: [...group.members, m] });
      if (!profile.name) setProfile({ ...profile, name: newName });
    }
  }
  function saveProfile(p) {
    setProfile(p);
    // Jméno, fotka a číslo účtu se propíšou k „mému“ členovi ve všech skupinách.
    setGroups((gs) => gs.map((g) => {
      const me = g.members.find((m) => m.id === g.me);
      if (!me) return g;
      const name = p.name && (me.name === 'Já' || me.name === prof.name) ? p.name : me.name;
      const iban = p.iban !== (profile.iban || '') ? (p.iban || undefined) : me.iban;
      if (name === me.name && me.avatar === p.avatar && (me.iban || '') === (iban || '')) return g;
      return { ...g, mu: Date.now(), members: g.members.map((m) => (m === me ? { ...m, name, avatar: p.avatar, iban } : m)) };
    }));
    close();
  }
  function exportAll() {
    downloadFile(`vyrovnano-vsechny-skupiny-${today()}.json`,
      JSON.stringify({ app: 'vyrovnano', exported: new Date().toISOString(), groups: groups.map(shared) }, null, 1));
  }
  // Ručně zvolený vzhled (světlý/tmavý) přebije nastavení systému.
  useEffect(() => {
    const t = profile.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }, [profile.theme]);
  function importSettleUp() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const { group: g, imported, skipped } = parseSettleUp(decodeText(await file.arrayBuffer()), file.name);
        if (ref.current.some((x) => x.name === g.name) &&
            !(await ask(`Skupinu „${g.name}“ už máš. Importovat ji znovu jako další skupinu?`))) return;
        const id = user ? crypto.randomUUID() : uid();
        setGroups((gs) => [...gs, { ...g, id, mu: Date.now() }]);
        setGid(id);
        if (skipped) notify(`Načteno ${imported} záznamů. ${skipped} řádků se nepodařilo přečíst a bylo přeskočeno.`);
      } catch (e) {
        notify(e.message || 'Soubor se nepodařilo načíst.');
      }
    };
    input.click();
  }
  async function removeGroup(g) {
    if (user) {
      const others = g.members.some((m) => m.uid && m.uid !== user.id);
      const msg = others
        ? `Opustit skupinu „${g.name}“? Ztratíš k ní přístup, ostatním členům zůstane.`
        : `Smazat skupinu „${g.name}“ se všemi výdaji? Nikdo další k ní přístup nemá, takže zmizí úplně.`;
      if (!(await ask(msg))) return;
      if (g.remote) {
        try { await leaveRemote(g.id); } catch { return notify('Nepodařilo se. Zkus to znovu, až budeš online.'); }
      }
    } else if (!(await ask(`Opravdu smazat skupinu „${g.name}“ se všemi výdaji?`))) return;
    delete synced.current[g.id];
    setGroups((gs) => gs.filter((x) => x.id !== g.id));
    setGid(null);
    close();
  }
  // Obnova ze zálohy: záznamy ze zálohy dostanou nové časové razítko, aby při slučování
  // vyhrály nad novějším stavem; záznamy, které v záloze nejsou, se označí jako smazané.
  async function restoreBackup(at, label) {
    if (!(await ask(`Obnovit skupinu do stavu z ${label}? Změny provedené po tomto čase zmizí všem členům.`))) return;
    try {
      const data = await getBackup(group.id, at);
      if (!data) throw new Error('nenalezeno');
      const now = Date.now();
      const keep = new Set(data.entries.map((e) => e.id));
      const dead = { ...(group.dead || {}) };
      for (const e of group.entries) if (!keep.has(e.id)) dead[e.id] = now;
      // Propojení členů s účty bereme ze současného stavu, ať nikdo nepřijde o přístup k „sobě“.
      const members = data.members.map((m) => ({ ...m, uid: group.members.find((x) => x.id === m.id)?.uid }));
      for (const m of group.members) if (m.uid && !members.some((x) => x.id === m.id)) members.push(m);
      putGroup(withMe({
        ...group, name: data.name, emoji: data.emoji, color: data.color, members, dead, mu: now,
        entries: data.entries.map((e) => ({ ...e, u: now })),
      }));
    } catch {
      notify('Zálohu se nepodařilo obnovit. Zkus to prosím znovu.');
    }
  }
  async function doReset() {
    if (!(await ask('Zrušit současný odkaz? Kdo ho má a ještě se nepřipojil, už se s ním nepřipojí.'))) return;
    try {
      const t = await resetInvite(group.id);
      if (/^[0-9a-f]{32}$/.test(t)) setGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, invite: t } : g)));
    } catch {
      notify('Nepodařilo se. Zkus to prosím znovu.');
    }
  }
  async function doKick(userId, name) {
    if (!(await ask(`Odebrat přístup: ${name || 'tento účet'}? Skupinu už neuvidí a starý odkaz přestane platit. Jeho výdaje ve skupině zůstanou.`))) return;
    try {
      const t = await kickRemote(group.id, userId);
      setGroups((gs) => gs.map((g) => (g.id !== group.id ? g : {
        ...g, mu: Date.now(), invite: /^[0-9a-f]{32}$/.test(t) ? t : g.invite,
        members: g.members.map((m) => (m.uid === userId ? { ...m, uid: undefined } : m)),
      })));
    } catch {
      notify('Nepodařilo se. Zkus to prosím znovu.');
    }
  }
  async function logout(skipConfirm) {
    const dirty = groups.some((g) => sig(g) !== synced.current[g.id]);
    if (!skipConfirm && !(await ask(dirty
      ? 'Některé změny se ještě neodeslaly na server a odhlášením se ztratí. Opravdu se odhlásit?'
      : 'Odhlásit se z tohoto zařízení?', { ok: 'Odhlásit se' }))) return;
    // Notifikace patří k účtu: po odhlášení už na tohle zařízení nemají chodit.
    if (!skipConfirm) await disablePush(deletePushSub).catch(() => {});
    // Při odhlášení z tohoto zařízení mažeme i uložená data, ať je neuvidí další člověk u stejného telefonu.
    leaving.current = true;
    localStorage.removeItem(gkey);
    localStorage.removeItem(pkey);
    await signOut();
  }
  async function removeAccount() {
    if (!(await ask('Opravdu smazat účet? Skupiny, kde jsi jediný, zmizí. Tohle nejde vrátit.'))) return;
    try {
      await deleteAccount();
      await logout(true);
    } catch {
      notify('Účet se nepodařilo smazat. Zkus to prosím znovu.');
    }
  }

  return html`
    <div class="app wide">
      <div class="layout">
        <aside class=${'side' + (group ? ' has-group' : '')}>
          <${Home} groups=${groups} profile=${prof} account=${!!user} activeId=${gid} onOpen=${setGid}
            onNew=${() => setSheet({ type: 'group' })} onProfile=${() => setSheet({ type: 'profile' })}
            onSearch=${() => setSheet({ type: 'search', all: true })}
            onReorder=${(from, to) => setGroups((gs) => { const a = [...gs]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; })}
            onSortByName=${() => setGroups((gs) => [...gs].sort((a, b) => a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })))} />
        </aside>
        <section class=${'main-pane gc-' + (group?.color || 'teal')}>
          ${group
            ? html`<${GroupView} key=${group.id} group=${group}
            onBack=${() => setGid(null)}
            onEdit=${() => setSheet({ type: 'group', group })}
            onShare=${() => setSheet({ type: 'share' })}
            onAdd=${() => setSheet({ type: 'entry' })}
            onEntry=${(entry) => setSheet({ type: 'entry', entry })}
            onSearch=${() => setSheet({ type: 'search' })}
            onDelete=${(entry) => deleteEntry(entry.id)}
            onQr=${openQr}
            onMove=${groups.length > 1 ? (pay) => setSheet({ type: 'move', pay }) : null}
            onPay=${payDebt} />`
            : html`<${Welcome} groups=${groups} name=${prof.name} />`}
        </section>
      </div>

<nav class="tabbar" aria-label="Hlavní nabídka">
        <button class=${!group && !sheet ? 'on' : ''} onClick=${() => { close(); setGid(null); }}><${Icon} name="home" /><span>Skupiny</span></button>
        <button class=${sheet?.type === 'search' ? 'on' : ''} onClick=${() => setSheet({ type: 'search', all: !group })}><${Icon} name="search" /><span>Hledat</span></button>
        <button class="add" aria-label=${group ? 'Přidat záznam' : 'Nová skupina'} onClick=${() => setSheet(group ? { type: 'entry' } : { type: 'group' })}>
          <span class="plus"><${Icon} name="plus" size=${26} /></span><span>${group ? 'Záznam' : 'Skupina'}</span>
        </button>
        <button class=${sheet?.type === 'alldebts' ? 'on' : ''} onClick=${() => setSheet({ type: 'alldebts' })}><${Icon} name="swap" /><span>Dluhy</span></button>
        <button class=${sheet?.type === 'profile' ? 'on' : ''} onClick=${() => setSheet({ type: 'profile' })}><${Icon} name="user" /><span>Účet</span></button>
      </nav>

      ${sheet?.type === 'group' && html`
        <${Sheet} title=${sheet.group ? 'Upravit skupinu' : 'Nová skupina'} onClose=${close}>
          <${GroupForm} group=${sheet.group} profile=${prof} userId=${user?.id} admin=${admin} onSave=${saveGroupForm}
            deleteLabel=${!user ? 'Smazat skupinu' : sheet.group?.members.some((m) => m.uid && m.uid !== user.id) ? 'Opustit skupinu' : 'Smazat skupinu'}
            onDelete=${() => removeGroup(sheet.group)} onBackups=${() => setSheet({ type: 'backups' })} />
        <//>`}
      ${sheet?.type === 'entry' && group && html`
        <${Sheet} title=${sheet.entry?.mv ? 'Převedený dluh' : sheet.entry ? 'Upravit záznam' : 'Nový záznam'} onClose=${close}>
          ${sheet.entry?.mv
            ? html`<${MovedInfo} group=${group} entry=${sheet.entry} other=${groups.find((g) => g.id === sheet.entry.mvg)}
                onDelete=${() => deleteEntry(sheet.entry.id)} />`
            : html`<${EntryForm} group=${group} entry=${sheet.entry} onSave=${saveEntry} onDelete=${() => deleteEntry(sheet.entry.id)} />`}
        <//>`}
      ${sheet?.type === 'alldebts' && html`
        <${Sheet} title="Moje dluhy" onClose=${close}>
          <${AllDebts} groups=${groups} onOpen=${(id) => { close(); setGid(id); }} />
        <//>`}
      ${sheet?.type === 'search' && html`
        <${Sheet} title="Hledat" onClose=${close}>
          <${SearchSheet} groups=${sheet.all || !group ? groups : [group]} scopeName=${group?.name}
            onOpen=${(id, entry) => { setGid(id); setSheet({ type: 'entry', entry }); }} />
        <//>`}
      ${sheet?.type === 'move' && group && html`
        <${Sheet} title="Převést dluh" onClose=${close}>
          <${MoveSheet} group=${group} groups=${groups} pay=${sheet.pay} onMove=${(g, f, t) => moveDebt(sheet.pay, g, f, t)} />
        <//>`}
      ${sheet?.type === 'qr' && group && html`
        <${Sheet} title="QR platba" onClose=${close}>
          <${QrSheet} group=${group} pay=${sheet.pay} onPaid=${() => payDebt(sheet.pay)} />
        <//>`}
      ${sheet?.type === 'share' && group && html`
        <${Sheet} title="Sdílení skupiny" onClose=${close}>
          <${ShareSheet} group=${group} user=${user} syncState=${syncState} onReset=${doReset} onKick=${doKick} />
        <//>`}
      ${sheet?.type === 'backups' && group && html`
        <${Sheet} title="Zálohy a export" onClose=${close}>
          <${BackupSheet} group=${group} user=${user} onRestore=${restoreBackup} />
        <//>`}
      ${sheet?.type === 'profile' && html`
        <${Sheet} title="Nastavení účtu" onClose=${close}>
          <${ProfileSheet} profile=${profile} user=${user} admin=${admin} groupCount=${groups.length} onSave=${saveProfile}
            onLogout=${() => logout()} onDeleteAccount=${removeAccount} onExportAll=${exportAll}
            onImport=${() => { close(); importSettleUp(); }} />
        <//>`}
      ${sheet?.type === 'newpw' && html`
        <${Sheet} title="Nastav si nové heslo" onClose=${close}>
          <${PasswordForm} label="Uložit nové heslo" onDone=${() => setTimeout(close, 1200)} />
        <//>`}
      ${needsWho && !sheet && html`
        <${Sheet} title="Kdo jsi?" onClose=${() => setGid(null)}>
          <${WhoSheet} group=${group} profile=${prof} known=${known} onPick=${pickWho} />
        <//>`}
    </div>
  `;
}

function Root() {
  const [sess, setSess] = useState(getSession());
  const [boot, setBoot] = useState(syncEnabled ? null : {});
  useEffect(() => onAuthChange(setSess), []);
  useEffect(() => {
    if (!syncEnabled) return;
    // Pozvánku otevřenou bez přihlášení si odložíme a použijeme hned po přihlášení.
    const m = location.hash.match(/^#join=([a-f0-9]{32})$/);
    if (m && !getSession()) {
      try { sessionStorage.setItem(JKEY, m[1]); } catch {}
      history.replaceState(null, '', location.pathname);
    }
    consumeUrl().then(setBoot).catch(() => setBoot({ error: 'Přihlášení se nepodařilo dokončit. Zkus to prosím znovu.' }));
    // Dvoufázové ověření mohlo být zapnuto nebo vypnuto na jiném zařízení; zjistíme to při startu a při návratu do aplikace.
    const check = () => { if (!document.hidden) refreshMfa().catch(() => {}); };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  if (!boot) return html`<div class="empty">Načítám…</div>`;
  if (syncEnabled && !sess) return html`<${AuthScreen} notice=${boot.error} /><${DialogHost} />`;
  if (syncEnabled && sess.mfa && !sess.mfa.ok) return html`<${MfaScreen} factorId=${sess.mfa.id} /><${DialogHost} />`;
  const user = syncEnabled ? sess.user : null;
  return html`<${App} key=${user?.id || 'local'} user=${user} recovery=${boot.type === 'recovery'} /><${DialogHost} />`;
}

render(html`<${Root} />`, document.getElementById('root'));

// Telefon: aplikace se nemá zvětšovat štípnutím ani dvojím klepnutím, stejně jako nativní.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
