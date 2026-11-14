// Výpočty: všechny částky jsou celá čísla v haléřích (centech), aby se nic neztrácelo zaokrouhlováním.

export const CATS = [
  { id: 'food', e: '🍽️', n: 'Jídlo' },
  { id: 'groceries', e: '🛒', n: 'Nákup' },
  { id: 'home', e: '🏠', n: 'Ubytování' },
  { id: 'transport', e: '🚗', n: 'Doprava' },
  { id: 'drinks', e: '🍺', n: 'Pití' },
  { id: 'fun', e: '🎉', n: 'Zábava' },
  { id: 'other', e: '📦', n: 'Ostatní' },
];
export const cat = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];

export const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN', 'HUF', 'CHF'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function fmt(cents, currency) {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

export function parseAmount(str) {
  const n = parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

// Rozdělí `total` podle vah tak, aby součet seděl přesně na haléř (metoda největších zbytků).
export function allocate(total, weights) {
  const ids = Object.keys(weights).filter((k) => weights[k] > 0);
  const sum = ids.reduce((s, k) => s + weights[k], 0);
  const out = {};
  if (!sum || !total) return out;
  let used = 0;
  const rem = ids.map((id) => {
    const exact = (total * weights[id]) / sum;
    const fl = Math.floor(exact);
    out[id] = fl;
    used += fl;
    return { id, r: exact - fl };
  });
  rem.sort((a, b) => b.r - a.r);
  for (let i = 0; i < total - used; i++) out[rem[i % rem.length].id]++;
  return out;
}

// Částka záznamu přepočtená do měny skupiny.
export const baseAmount = (e) => Math.round(e.amount * (e.rate || 1));
// Kolik z daného záznamu připadá na koho (v měně skupiny).
export const shares = (e) => allocate(baseAmount(e), e.parts);

// Kladný zůstatek = má dostat, záporný = dluží.
export function balances(group) {
  const b = Object.fromEntries(group.members.map((m) => [m.id, 0]));
  for (const e of group.entries) {
    const s = shares(e);
    b[e.paidBy] = (b[e.paidBy] || 0) + baseAmount(e);
    for (const id in s) b[id] = (b[id] || 0) - s[id];
  }
  return b;
}

// Navrhne co nejméně plateb: největší dlužník platí největšímu věřiteli.
export function settle(bal) {
  const debt = [], cred = [];
  for (const id in bal) {
    if (bal[id] < 0) debt.push({ id, v: -bal[id] });
    else if (bal[id] > 0) cred.push({ id, v: bal[id] });
  }
  const out = [];
  while (debt.length && cred.length) {
    debt.sort((a, b) => b.v - a.v);
    cred.sort((a, b) => b.v - a.v);
    const d = debt[0], c = cred[0];
    const amount = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount });
    d.v -= amount;
    c.v -= amount;
    if (!d.v) debt.shift();
    if (!c.v) cred.shift();
  }
  return out;
}

export function stats(group) {
  const byCat = {}, consumed = {}, paid = {};
  let total = 0;
  for (const e of group.entries) {
    if (e.kind !== 'expense') continue;
    const base = baseAmount(e);
    total += base;
    byCat[e.category] = (byCat[e.category] || 0) + base;
    paid[e.paidBy] = (paid[e.paidBy] || 0) + base;
    const s = shares(e);
    for (const id in s) consumed[id] = (consumed[id] || 0) + s[id];
  }
  return { total, byCat, consumed, paid };
}

// České číslo účtu (např. 19-123456789/0800) nebo IBAN -> IBAN. Vrací '' když to nejde.
export function toIban(input) {
  const s = String(input || '').replace(/\s/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return s;
  const m = s.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return '';
  const bban = m[3] + (m[1] || '').padStart(6, '0') + m[2].padStart(10, '0');
  const check = 98n - (BigInt(bban + '123500') % 97n); // "CZ00" -> 12 35 00
  return 'CZ' + String(check).padStart(2, '0') + bban;
}

// Řetězec pro český standard QR Platba.
export function spayd(iban, cents, currency, msg) {
  const clean = msg.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, ' ').slice(0, 60);
  return `SPD*1.0*ACC:${iban}*AM:${(cents / 100).toFixed(2)}*CC:${currency}*MSG:${clean}`;
}

export function dateLabel(iso) {
  const t = today();
  if (iso === t) return 'Dnes';
  const y = new Date(Date.now() - 864e5);
  const yIso = new Date(y.getTime() - y.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (iso === yIso) return 'Včera';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function seed() {
  const [a, b, c, d] = [uid(), uid(), uid(), uid()];
  const all = { [a]: 1, [b]: 1, [c]: 1, [d]: 1 };
  const t = today();
  const E = (o) => ({ id: uid(), kind: 'expense', currency: 'CZK', rate: 1, mode: 'equal', parts: all, date: t, ...o });
  return {
    id: uid(),
    name: 'Chata Krkonoše (ukázka)',
    emoji: '🏔️',
    currency: 'CZK',
    me: a,
    members: [
      { id: a, name: 'Já', iban: '123456789/0800' },
      { id: b, name: 'Petra' },
      { id: c, name: 'Tomáš' },
      { id: d, name: 'Klára' },
    ],
    entries: [
      E({ title: 'Ubytování', amount: 720000, paidBy: a, category: 'home' }),
      E({ title: 'Nákup na víkend', amount: 184500, paidBy: b, category: 'groceries' }),
      E({ title: 'Benzín', amount: 120000, paidBy: c, category: 'transport', mode: 'shares', parts: { [a]: 1, [c]: 1, [d]: 2 } }),
      E({ title: 'Večeře v Polsku', amount: 32000, currency: 'PLN', rate: 5.7, paidBy: d, category: 'food' }),
    ],
  };
}
