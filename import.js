// Import skupiny z exportu aplikace Settle Up (soubor CSV).
import { uid, today, guessCategory } from './logic.js';

// Settle Up exportuje v kódování UTF-16; jiné nástroje v UTF-8. Poznáme to podle prvních bajtů.
export function decodeText(buffer) {
  const b = new Uint8Array(buffer);
  const enc = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(enc).decode(buffer);
}

// CSV s uvozovkami: pole může obsahovat čárky, středníky i nové řádky.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const cents = (v) => Math.round(Math.abs(parseFloat(String(v).replace(',', '.')) || 0) * 100);
const list = (v) => String(v || '').split(';').map((x) => x.trim()).filter(Boolean);

// Kategorie: nejdřív podle štítku ze Settle Up, jinak podle názvu výdaje.
function category(label, purpose) {
  const fromLabel = guessCategory(label);
  return fromLabel !== 'other' ? fromLabel : guessCategory(purpose);
}

// Vrací novou skupinu (bez id) a krátké shrnutí. Při neznámém formátu vyhodí chybu.
export function parseSettleUp(text, fileName) {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const C = {
    payer: col('who paid'), amount: col('amount'), currency: col('currency'), whom: col('for whom'),
    splits: col('split amounts'), purpose: col('purpose'), category: col('category'), date: col('date & time'),
    rate: col('exchange rate'), converted: col('converted amount'), type: col('type'),
  };
  if ([C.payer, C.amount, C.currency, C.whom, C.type].some((i) => i < 0)) {
    throw new Error('Tohle nevypadá jako export ze Settle Up.');
  }

  // Měna skupiny = ta nejčastější.
  const freq = {};
  for (const r of rows) freq[r[C.currency]] = (freq[r[C.currency]] || 0) + 1;
  const currency = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
  if (!/^[A-Z]{3}$/.test(currency || '')) throw new Error('V souboru chybí měna.');

  const ids = new Map();
  const member = (name) => {
    if (!ids.has(name)) ids.set(name, uid());
    return ids.get(name);
  };

  const entries = [];
  let skipped = 0;
  rows.slice(0, 5000).forEach((r, index) => {
    const payers = list(r[C.payer]);
    const whom = list(r[C.whom]);
    const type = String(r[C.type] || 'expense').trim().toLowerCase();
    const cur = r[C.currency];
    if (!payers.length || !whom.length || !/^[A-Z]{3}$/.test(cur)) return void skipped++;

    let paid = list(r[C.amount]).map(cents);
    if (paid.length !== payers.length) paid = [cents(r[C.amount]), ...payers.slice(1).map(() => 0)];
    const total = paid.reduce((a, b) => a + b, 0);
    if (!total) return void skipped++;

    // Kurz do měny skupiny: přednostně z přepočtené částky, jinak z uvedeného kurzu.
    let rate = 1;
    if (cur !== currency) {
      const conv = cents(r[C.converted]);
      const quoted = parseFloat(String(r[C.rate] || '').split(':')[1]);
      rate = conv ? conv / total : quoted > 0 ? 1 / quoted : 0;
      if (!rate) return void skipped++;
    }

    let weights = list(r[C.splits]).map(cents);
    if (weights.length !== whom.length || !weights.some((w) => w > 0)) weights = whom.map(() => 1);
    const equal = weights.every((w) => w === weights[0]);
    const when = String(r[C.date] || '');
    const date = /^\d{4}-\d{2}-\d{2}/.test(when) ? when.slice(0, 10) : today();
    const stamp = (Date.parse(when.replace(' ', 'T')) || 0) + index;
    const base = { currency: cur, rate, date, u: stamp, category: category(r[C.category], r[C.purpose]) };
    const purpose = String(r[C.purpose] || '').trim().slice(0, 120);

    payers.forEach((p, pi) => {
      if (!paid[pi]) return;
      if (type === 'transfer') {
        const sum = weights.reduce((a, b) => a + b, 0);
        whom.forEach((w, wi) => {
          const amount = Math.round((paid[pi] * weights[wi]) / sum);
          if (amount) entries.push({ ...base, id: uid(), kind: 'transfer', title: purpose || 'Převod', amount, paidBy: member(p), mode: 'equal', parts: { [member(w)]: 1 } });
        });
      } else {
        const parts = {};
        whom.forEach((w, wi) => { if (weights[wi] > 0) parts[member(w)] = (parts[member(w)] || 0) + (equal ? 1 : weights[wi]); });
        entries.push({
          ...base, id: uid(), kind: type === 'income' ? 'income' : 'expense',
          title: purpose || (type === 'income' ? 'Příjem' : 'Výdaj'), amount: paid[pi], paidBy: member(p),
          mode: equal ? 'equal' : 'exact', parts,
        });
      }
    });
  });
  if (!entries.length) throw new Error('V souboru nejsou žádné záznamy.');

  const name = String(fileName || 'Import').replace(/\.csv$/i, '').trim().slice(0, 80) || 'Import';
  return {
    group: {
      name, emoji: '👥', currency, me: null, entries,
      members: [...ids].map(([n, id]) => ({ id, name: n.slice(0, 60) })),
    },
    imported: entries.length,
    skipped,
  };
}
