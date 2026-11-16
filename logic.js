// Výpočty: všechny částky jsou celá čísla v haléřích (centech), aby se nic neztrácelo zaokrouhlováním.

export const CATS = [
  { id: 'food', e: '🍽️', n: 'Jídlo' },
  { id: 'groceries', e: '🛒', n: 'Nákup' },
  { id: 'coffee', e: '☕', n: 'Káva' },
  { id: 'drinks', e: '🍺', n: 'Pití' },
  { id: 'household', e: '🧽', n: 'Domácnost' },
  { id: 'gear', e: '🛠️', n: 'Vybavení' },
  { id: 'internet', e: '🌐', n: 'Internet' },
  { id: 'bills', e: '💡', n: 'Energie a služby' },
  { id: 'home', e: '🏠', n: 'Ubytování' },
  { id: 'transport', e: '🚗', n: 'Doprava' },
  { id: 'sport', e: '🎾', n: 'Sport' },
  { id: 'fun', e: '🎉', n: 'Zábava' },
  { id: 'gifts', e: '🎁', n: 'Dárky' },
  { id: 'health', e: '💊', n: 'Zdraví' },
  { id: 'deposit', e: '💰', n: 'Zálohy' },
  { id: 'wedding', e: '💍', n: 'Svatba cash' },
  { id: 'other', e: '📦', n: 'Ostatní' },
];

// Rozpoznání kategorie z názvu výdaje. Běží přímo v zařízení, nic se nikam neposílá.
// Pravidla jsou začátky slov bez diakritiky; platí první kategorie, která se trefí.
const RULES = [
  // Záloha má přednost před vším. „Svatba cash“ se pozná jen podle začátku názvu („Svatba – Novákovi“, „Cash – …“),
  // aby třeba „Benzin svatba“ zůstal v dopravě.
  ['deposit', 'zaloh|deposit|kauc'],
  ['wedding', '^svatb|^cash\\b|^wedding'],
  ['coffee', 'kav|kafe|kafi|kafc|coffee|espress|latte|cappuc|costa|tchibo|starbucks|nespresso|mot mot|kyselac'],
  ['health', 'lekarn|leky|lek\\b|vitamin|elektrolyt|electrolyt|doktor|zubar|vilgain|protein'],
  ['gifts', 'dar\\b|darek|dark[yu]|darec|narozenin|kytk|kvetin|vanoc'],
  ['internet', 'internet'],
  ['bills', 'energi|elektrin|elektrik|plyn\\b|vodne|najem|najm|doplatek|poplat|pojist|netflix|spotify|predplat|tarif'],
  ['sport', 'padel|tenis|fotbal|squash|badminton|bowling|posilovn|fitko|fitness|lyz|skipas|plavan|bazen|golf'],
  ['fun', 'kino|vstupen|listk|koncert|ples\\b|festival|divadl|wellness|sauna|hry\\b|hra\\b|unikov|party|zabav|entertain'],
  ['transport', 'benzin|nafta|phm|tankov|uber|bolt\\b|taxi|vlak|jizden|letenk|parkov|dalnic|mhd|autobus|cesta|pokut|transport|doprav|fuel'],
  ['drinks', 'pivo|piva\\b|pivk|vino|vina\\b|vinec|drink|bar\\b|hospod|alkohol|rum\\b|gin\\b|prosecc|koktejl|panak|shot|ginger|piti'],
  ['groceries', 'nakup|lidl|billa|tesco|kaufland|penny|globus|potravin|rohlik|kosik|makro|supermarket|grocer'],
  ['food', 'restaur|obed|vecer|snidan|pizz|burger|sushi|poke|wolt|foodora|jidl|bistro|kebab|vietnam|pho\\b|asie|mexik|mechik|salsa|saigon|palacink|wafl|chalk|mcdonald|kfc|ramen|japchae|svacin|zmrzlin|dort|food|baget|polevk|gril'],
  ['home', 'ubytov|accommod|airbnb|booking|hotel|chat[auye]\\b|chalup|apartm|hostel|kemp'],
  ['household', 'uterk|pytl|mydl|houbic|sanytol|cistic|praci|toalet|airwick|vune|osvezov|uklid|uklizec|tepovan|kuchyn|prkynk|nuz\\b|pribor|talir|misk|sklenic|vidlic|filtr|odpad|drogeri|ubrousk|zarovk|led\\b'],
  ['gear', 'regal|router|kamer|microsd|sd kart|zebrik|pohovk|gauc|vysavac|stativ|slider|box|hub\\b|usb|kabel|platn|sten[ay]\\b|bauhaus|hornbach|obi\\b|penetrac|vymalb|barv|kotv|narad|nabyt|stul\\b|zidl|monitor|ps5|konzol|desk[ay]\\b|ikea'],
].map(([id, words]) => [id, new RegExp('\\b(?:' + words + ')')]);

export function guessCategory(text) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [id, re] of RULES) if (re.test(t)) return id;
  return 'other';
}
// „Učení“ z historie skupiny: když název začíná stejným slovem jako některý dřívější záznam,
// vezme se kategorie, kterou měl ten nejnovější (včetně ručně vybrané). Nic se nikam neposílá.
const firstWord = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/[^a-z0-9]+/)[0] || '';
export function learnedCategory(entries, text) {
  const w = firstWord(text);
  if (w.length < 3) return '';
  let best = null;
  for (const e of entries) {
    if (e.kind === 'transfer' || firstWord(e.title) !== w) continue;
    if (!best || (e.c || e.u || 0) > (best.c || best.u || 0)) best = e;
  }
  const c = best ? catOf(best) : '';
  return c && c !== 'other' ? c : '';
}
// Kategorie záznamu; kde chybí, odhadne se z názvu (platí i pro starší a importované výdaje).
export function catOf(e) {
  if (!e.category || e.category === 'other') return guessCategory(e.title);
  // Starší importy řadily kávu pod „Pití“; kde název jasně mluví o kávě, opravíme to.
  if (e.category === 'drinks' && guessCategory(e.title) === 'coffee') return 'coffee';
  // Než vznikly kategorie Zálohy a Svatba, padaly tyhle záznamy do Dárků; podle názvu je přeřadíme.
  if (e.category === 'gifts' && ['deposit', 'wedding'].includes(guessCategory(e.title))) return guessCategory(e.title);
  return e.category;
}
// Vlastní kategorie skupin: { id, e (ikona), n (název), k (klíčová slova) }. Aby je šlo dohledat odkudkoli jen podle id,
// drží se v jednom seznamu, který aplikace obnoví při každé změně skupin.
const custom = new Map();
export function registerCats(groups) {
  custom.clear();
  for (const g of groups) for (const c of g.cats || []) custom.set(c.id, c);
}
export const cat = (id) => custom.get(id) || CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
const fold = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
// Kategorie podle klíčových slov skupiny: slovo musí v názvu začínat (stačí začátek slova, takže „balíček“ najde i „balíčky“);
// krátká slova do tří písmen (třeba „FA“) musí sedět celá. „^slovo“ = jen na začátku názvu.
export function customCategory(group, text) {
  const t = fold(text);
  if (!t) return '';
  for (const c of group?.cats || []) {
    for (const raw of c.k || []) {
      const k = fold(raw);
      if (!k) continue;
      if (k[0] === '^' ? t.startsWith(k.slice(1)) : new RegExp('(?:^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (k.length <= 3 ? '(?![a-z0-9])' : '')).test(t)) return c.id;
    }
  }
  return '';
}
// Zpětné zařazení: záznamy, jejichž název odpovídá klíčovým slovům vlastní kategorie, do ní přesune.
export function applyCats(group, now = Date.now()) {
  let n = 0;
  const entries = group.entries.map((e) => {
    if (e.kind === 'transfer') return e;
    const c = customCategory(group, e.title);
    if (!c || e.category === c) return e;
    n++;
    return { ...e, category: c, u: now };
  });
  return n ? { ...group, entries, moved: n } : group;
}

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
// Haléře, které po dělení zbudou, jdou nejdřív plátci (`first`), stejně jako v Settle Up.
// Pořadí je pevně dané (podle id), aby na všech zařízeních vyšlo totéž.
export function allocate(total, weights, first) {
  const ids = Object.keys(weights).filter((k) => weights[k] > 0).sort();
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
  rem.sort((a, b) => (b.id === first) - (a.id === first) || b.r - a.r || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < total - used; i++) out[rem[i % rem.length].id]++;
  return out;
}

// Částka záznamu přepočtená do měny skupiny.
export const baseAmount = (e) => Math.round(e.amount * (e.rate || 1));
// Kolik z daného záznamu připadá na koho (v měně skupiny).
export const shares = (e) => allocate(baseAmount(e), e.parts, e.paidBy);

// Kladný zůstatek = má dostat, záporný = dluží.
export function balances(group) {
  const b = Object.fromEntries(group.members.map((m) => [m.id, 0]));
  for (const e of group.entries) {
    const s = shares(e);
    // Příjem (např. prodej společné věci) je opak výdaje: kdo peníze přijal, dluží podíly ostatním.
    const sign = e.kind === 'income' ? -1 : 1;
    b[e.paidBy] = (b[e.paidBy] || 0) + sign * baseAmount(e);
    for (const id in s) b[id] = (b[id] || 0) - sign * s[id];
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

// Převod dluhu mezi skupinami. `pay` = { from: dlužník, to: věřitel, amount } ve zdrojové skupině,
// `debtorIn` a `creditorIn` jsou titíž lidé v cílové skupině. Vrací dva provázané záznamy:
//  out (do zdrojové skupiny)  – dlužník „zaplatil“ věřiteli, takže tam dluh zmizí,
//  in  (do cílové skupiny)    – věřitel „půjčil“ dlužníkovi, takže tam stejný dluh vznikne.
// Směr se nikdy neotáčí: kdo dlužil, dluží dál, jen v jiné skupině.
export function debtMove(source, target, pay, debtorIn, creditorIn, now = Date.now()) {
  const mv = uid();
  const base = { kind: 'transfer', amount: pay.amount, rate: 1, mode: 'equal', category: 'other', date: today(), u: now, c: now, mv };
  return {
    out: { ...base, id: uid(), mvd: 'out', mvg: target.id, currency: source.currency,
      title: `Převedeno do skupiny „${target.name}“`.slice(0, 120), paidBy: pay.from, parts: { [pay.to]: 1 } },
    in: { ...base, id: uid(), mvd: 'in', mvg: source.id, currency: target.currency,
      title: `Převedeno ze skupiny „${source.name}“`.slice(0, 120), paidBy: creditorIn.id, parts: { [debtorIn.id]: 1 } },
  };
}

// Oslovení: křestní jméno v 5. pádu (Filip → Filipe, Patrik → Patriku, Vašek → Vašku, Petr → Petře).
// Pravidla pokrývají běžná česká jména; co nepoznají (přezdívky s číslicemi, cizí tvary), nechají beze změny.
const VOC_KEEP = new Set(['ester', 'dagmar', 'miriam', 'ingrid', 'karin', 'rut', 'ruth', 'judit', 'edit', 'nikol', 'nicol',
  'carmen', 'ellen', 'elen', 'helen', 'karen', 'dolores', 'agnes', 'ines', 'iris', 'doris', 'lilian', 'vivien', 'marlen',
  'sharon', 'kim', 'rachel', 'ráchel', 'abigail', 'mercedes', 'vanes']);
const VOC_DROP_E = new Set(['pavel', 'karel', 'havel']);
const VOWELS = 'aeiouyáéíóúýěů';
export function vocative(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!/^\p{L}{2,}$/u.test(first)) return first;
  const low = first.toLowerCase();
  if (VOC_KEEP.has(low)) return first;
  const cut = (n, add) => first.slice(0, first.length - n) + add;
  const last = low.slice(-1), last2 = low.slice(-2), last3 = low.slice(-3);
  if (last === 'a') return cut(1, 'o'); // Honza → Honzo, Jana → Jano
  if ('eiíyýoóuúůéěá'.includes(last)) return first; // Jiří, Marie, Hugo
  if (last3 === 'něk') return cut(3, 'ňku'); // Zdeněk → Zdeňku
  if (last3 === 'děk') return cut(3, 'ďku'); // Luděk → Luďku
  if (last3 === 'těk') return cut(3, 'ťku');
  if (last2 === 'ek' || last2 === 'ěk') return cut(2, 'ku'); // Vašek → Vašku
  if (last2 === 'ec') return cut(2, 'če'); // Vavřinec → Vavřinče
  if (last2 === 'el') return VOC_DROP_E.has(low) ? cut(2, 'le') : first + 'i'; // Pavel → Pavle, Daniel → Danieli
  if (last2 === 'ch' || 'kgh'.includes(last)) return first + 'u'; // Patrik → Patriku, Oldřich → Oldřichu
  if (last === 'r') return VOWELS.includes(low.slice(-2, -1)) ? first + 'e' : cut(1, 'ře'); // Viktor → Viktore, Petr → Petře
  if ('šžčřjcňťďsxz'.includes(last)) return first + 'i'; // Tomáš → Tomáši, Ondřej → Ondřeji
  return first + 'e'; // Filip → Filipe, Albert → Alberte, Michal → Michale
}

export function stats(group) {
  const byCat = {}, consumed = {}, paid = {};
  let total = 0;
  for (const e of group.entries) {
    // Příjem (např. prodej společné věci) celkovou útratu snižuje.
    if (e.kind === 'income') total -= baseAmount(e);
    if (e.kind !== 'expense') continue;
    const base = baseAmount(e);
    total += base;
    const c = catOf(e);
    byCat[c] = (byCat[c] || 0) + base;
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

/* ---------- Pravidelné výdaje ---------- */
const pad = (n) => String(n).padStart(2, '0');
// Další termín po `date`: o týden později, nebo stejný den v dalším měsíci (31. se v kratším měsíci zkrátí na poslední den).
export function nextDue(date, every, day) {
  const [y, m, d] = date.split('-').map(Number);
  if (every === 'week') {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const len = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(day || d, len))}`;
}
// Zapíše do skupiny všechny pravidelné výdaje, jejichž termín už nastal, a posune jim další termín.
// Vrací tutéž skupinu, když není co dělat. Záznam má pevné id (šablona + datum) a pevný čas úpravy,
// takže když ho ve stejnou chvíli vytvoří dvě zařízení, nezdvojí se, a ručně smazaný se nevrátí.
export function runRecurring(g, now = today()) {
  if (!g.rec?.length || !g.rec.some((r) => r.next <= now)) return g;
  const ids = new Set(g.members.map((m) => m.id));
  const have = new Set(g.entries.map((e) => e.id));
  const added = [], log = [];
  const rec = g.rec.map((r) => {
    if (r.next > now || !ids.has(r.paidBy)) return r;
    const parts = Object.fromEntries(Object.entries(r.parts).filter(([k]) => ids.has(k)));
    let next = r.next;
    for (let i = 0; i < 36 && next <= now; i++) {
      const id = `${r.id}-${next.replace(/-/g, '')}`;
      const t = Date.parse(next + 'T08:00:00Z'); // pevný čas, na všech zařízeních stejný
      if (Object.keys(parts).length && !have.has(id) && !(g.dead?.[id] >= t)) {
        have.add(id);
        added.push({ id, kind: r.kind, title: r.title, amount: r.amount, currency: r.currency, rate: r.rate, paidBy: r.paidBy,
          mode: r.mode, parts, category: r.category, date: next, u: t, c: t, rid: r.id });
        log.push({ id: `r${id}`, t, n: 'Automaticky', a: 'add', text: `pravidelný ${r.kind === 'income' ? 'příjem' : r.kind === 'transfer' ? 'převod' : 'výdaj'} „${r.title}“ (${fmt(r.amount, r.currency)})` });
      }
      next = nextDue(next, r.every, r.day);
    }
    return { ...r, next };
  });
  const seen = new Set((g.log || []).map((x) => x.id));
  if (!rec.some((r, i) => r !== g.rec[i])) return g; // jen šablony s plátcem, který už ve skupině není
  return { ...g, rec, mu: Date.now(), entries: [...g.entries, ...added],
    log: [...(g.log || []), ...log.filter((x) => !seen.has(x.id))].sort((a, b) => a.t - b.t).slice(-300) };
}
