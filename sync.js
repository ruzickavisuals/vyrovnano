// Synchronizace skupin se serverem. Server vydá skupinu jen přihlášenému členovi;
// tady řešíme slučování změn z více zařízení a kontrolu toho, co ze serveru přišlo.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { refreshMfa, accessToken } from './auth.js';
import { today } from './logic.js';

export const syncEnabled = !!(SUPABASE_URL && SUPABASE_KEY);

let lastCheck = 0;
async function rpc(fn, body = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Nepřihlášen');
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Server odmítl: možná relace skončila nebo chybí ověření kódem. Zjistíme stav přihlášení (nejvýš jednou za 20 s).
    if ([400, 401, 403].includes(res.status) && Date.now() - lastCheck > 20000) {
      lastCheck = Date.now();
      refreshMfa().catch(() => {});
    }
    throw new Error(`Server odpověděl ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// Část skupiny, která se sdílí se členy.
export const shared = (g) => ({
  name: g.name, emoji: g.emoji, color: g.color, currency: g.currency, members: g.members,
  entries: g.entries, dead: g.dead || {}, mu: g.mu || 0, log: g.log || [],
  // Pravidelné výdaje a datum konce akce (jen když jsou nastavené, aby se starší skupiny zbytečně neměnily).
  rec: g.rec?.length ? g.rec : undefined, ends: g.ends || undefined,
});

// Stabilní textová podoba pro porovnání (databáze si pořadí klíčů přeskládá).
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// Historie úprav: kdo, kdy a co ve skupině udělal. Jen se do ní přidává; držíme posledních LOG_MAX záznamů.
export const LOG_MAX = 300;
const LOG_ACTS = ['add', 'edit', 'del', 'pay', 'move', 'unmove', 'join', 'group', 'restore', 'import'];
const logOrder = (x, y) => x.t - y.t || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
// Sjednocení dvou historií podle id (stejný záznam z obou zařízení se nezdvojí), seřazené podle času.
export function mergeLog(a = [], b = []) {
  const byId = new Map();
  for (const l of [...a, ...b]) if (!byId.has(l.id)) byId.set(l.id, l);
  return [...byId.values()].sort(logOrder).slice(-LOG_MAX);
}

// Sloučí dvě verze skupiny tak, aby se neztratila změna z žádného zařízení:
// záznamy se párují podle id a vyhrává novější úprava; smazané si pamatujeme v `dead`.
export function merge(a, b) {
  const meta = (b.mu || 0) > (a.mu || 0) ? b : a;
  const other = meta === a ? b : a;
  const dead = { ...(a.dead || {}) };
  for (const k in b.dead || {}) dead[k] = Math.max(dead[k] || 0, b.dead[k]);

  const byId = new Map();
  for (const e of [...a.entries, ...b.entries]) {
    const cur = byId.get(e.id);
    if (!cur || (e.u || 0) > (cur.u || 0)) byId.set(e.id, e);
  }
  const entries = [...byId.values()]
    .filter((e) => !(dead[e.id] >= (e.u || 0)))
    .sort((x, y) => (x.u || 0) - (y.u || 0) || (x.id < y.id ? -1 : 1));

  // Člen, na kterého odkazuje nějaký výdaj, nesmí zmizet.
  const members = [...meta.members];
  const used = new Set(entries.flatMap((e) => [e.paidBy, ...Object.keys(e.parts)]));
  for (const m of other.members) {
    if (used.has(m.id) && !members.some((x) => x.id === m.id)) members.push(m);
  }
  // Pravidelné výdaje a konec akce patří k nastavení skupiny (vyhrává novější). Když jsou obě verze stejně staré
  // a jedna je nemá (uložila ji starší verze aplikace, která je nezná), vezmeme je z té druhé.
  const same = (a.mu || 0) === (b.mu || 0);
  const rec = meta.rec?.length ? meta.rec : same ? other.rec : undefined;
  const ends = meta.ends || (same ? other.ends : undefined);
  return { name: meta.name, emoji: meta.emoji, color: meta.color, currency: meta.currency, members, entries, dead, mu: meta.mu || 0,
    log: mergeLog(a.log, b.log), rec: rec?.length ? rec : undefined, ends: ends || undefined };
}

// Data ze serveru mohl upravit kterýkoli člen skupiny, proto jim nevěříme naslepo:
// propustíme jen očekávané položky, typy a rozumné délky. Fotka smí být jen malý obrázek.
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const okId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(v);
const num = (v) => (Number.isFinite(v) ? v : 0);
const cur = (v) => (/^[A-Z]{3}$/.test(v) ? v : 'CZK');
const okUuid = (v) => (typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) ? v : undefined);
const GROUP_COLORS = ['teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'amber', 'green', 'slate'];
const okAvatar = (v) =>
  typeof v === 'string' && v.length < 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : undefined;

export function sanitize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.members) || !Array.isArray(d.entries)) {
    throw new Error('Poškozená data skupiny');
  }
  const members = d.members.slice(0, 100)
    .filter((m) => m && okId(m.id))
    .map((m) => ({ id: m.id, name: str(m.name, 60) || '?', iban: str(m.iban, 50) || undefined, avatar: okAvatar(m.avatar), uid: okUuid(m.uid),
      inactive: m.inactive === true ? true : undefined }));
  const ids = new Set(members.map((m) => m.id));
  const entries = d.entries.slice(0, 5000)
    .filter((e) => e && okId(e.id) && ids.has(e.paidBy) && e.parts && typeof e.parts === 'object')
    .map((e) => ({
      id: e.id,
      kind: ['transfer', 'income'].includes(e.kind) ? e.kind : 'expense',
      title: str(e.title, 120),
      amount: Math.max(0, Math.round(num(e.amount))),
      currency: cur(e.currency),
      rate: num(e.rate) > 0 ? num(e.rate) : 1,
      paidBy: e.paidBy,
      mode: ['equal', 'shares', 'exact'].includes(e.mode) ? e.mode : 'equal',
      parts: Object.fromEntries(Object.entries(e.parts).filter(([k, v]) => ids.has(k) && Number.isFinite(v) && v > 0)),
      category: str(e.category, 20),
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : today(),
      u: num(e.u),
      // kdy a kým byl záznam zadán (u starších záznamů chybí)
      c: num(e.c) > 0 ? Math.round(e.c) : undefined,
      cb: okId(e.cb) && ids.has(e.cb) ? e.cb : undefined,
      // vazba dvou částí převodu dluhu mezi skupinami
      mv: okId(e.mv) ? e.mv : undefined,
      mvg: okId(e.mvg) ? e.mvg : undefined,
      mvd: e.mvd === 'out' || e.mvd === 'in' ? e.mvd : undefined,
      // záznam vytvořený automaticky z pravidelného výdaje
      rid: okId(e.rid) ? e.rid : undefined,
    }));
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const rec = (Array.isArray(d.rec) ? d.rec : []).slice(0, 50)
    .filter((r) => r && okId(r.id) && r.id.length <= 24 && ids.has(r.paidBy) && r.parts && typeof r.parts === 'object' && isDate(r.next))
    .map((r) => ({
      id: r.id,
      kind: ['transfer', 'income'].includes(r.kind) ? r.kind : 'expense',
      title: str(r.title, 120),
      amount: Math.max(0, Math.round(num(r.amount))),
      currency: cur(r.currency),
      rate: num(r.rate) > 0 ? num(r.rate) : 1,
      paidBy: r.paidBy,
      mode: ['equal', 'shares', 'exact'].includes(r.mode) ? r.mode : 'equal',
      parts: Object.fromEntries(Object.entries(r.parts).filter(([k, v]) => ids.has(k) && Number.isFinite(v) && v > 0)),
      category: str(r.category, 20),
      every: r.every === 'week' ? 'week' : 'month',
      day: Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 ? r.day : 1,
      next: r.next,
    }));
  const dead = {};
  if (d.dead && typeof d.dead === 'object') {
    for (const [k, v] of Object.entries(d.dead).slice(0, 5000)) if (okId(k) && Number.isFinite(v)) dead[k] = v;
  }
  const seen = new Set();
  const log = (Array.isArray(d.log) ? d.log : [])
    .filter((l) => l && okId(l.id) && Number.isFinite(l.t) && l.t > 0 && !seen.has(l.id) && seen.add(l.id))
    .map((l) => ({ id: l.id, t: Math.round(l.t), by: okId(l.by) ? l.by : undefined, n: str(l.n, 60),
      a: LOG_ACTS.includes(l.a) ? l.a : 'edit', text: str(l.text, 300) }))
    .sort(logOrder).slice(-LOG_MAX);
  return { name: str(d.name, 80) || 'Skupina', emoji: str(d.emoji, 16) || '👥',
    color: GROUP_COLORS.includes(d.color) ? d.color : undefined, currency: cur(d.currency), members, entries, dead, mu: num(d.mu), log,
    rec: rec.length ? rec : undefined, ends: isDate(d.ends) ? d.ends : undefined };
}

// Otisk sdílené části skupiny – podle něj poznáme, jestli je co synchronizovat.
// Skupiny se při změně nahrazují novým objektem, takže si otisk pro daný objekt stačí spočítat jednou.
const sigCache = new WeakMap();
export const sig = (g) => {
  let s = sigCache.get(g);
  if (s === undefined) sigCache.set(g, (s = canon(sanitize(shared(g)))));
  return s;
};

const fromRow = (row) => ({
  id: okUuid(row.id), version: num(row.version), data: sanitize(row.data),
  invite: /^[0-9a-f]{32}$/.test(row.invite) ? row.invite : '', owner: row.is_owner === true,
});

export async function listRemote() {
  const rows = await rpc('my_groups');
  return (Array.isArray(rows) ? rows : []).map(fromRow).filter((r) => r.id);
}
export async function fetchRemote(gid) {
  const rows = await rpc('get_group', { p_gid: gid });
  return Array.isArray(rows) && rows[0] ? fromRow(rows[0]) : null;
}
export async function joinRemote(token) {
  const rows = await rpc('join_group', { p_token: token });
  const row = Array.isArray(rows) && rows[0] ? fromRow(rows[0]) : null;
  return row && row.id ? row : null;
}
// Jen číslo verze skupiny – levný dotaz, jestli se na serveru něco změnilo (null = nemám přístup).
export async function remoteVersion(gid) {
  const v = await rpc('group_version', { p_gid: gid });
  return Number.isInteger(v) ? v : null;
}
export const leaveRemote = (gid) => rpc('leave_group', { p_gid: gid });
export const resetInvite = (gid) => rpc('reset_invite', { p_gid: gid });
export const kickRemote = (gid, userId) => rpc('kick_member', { p_gid: gid, p_user: userId });
export const deleteAccount = () => rpc('delete_account');
export const isAdmin = () => rpc('is_admin');
export const savePushSub = (endpoint, p256dh, auth) => rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
export const getNotifyPrefs = () => rpc('get_notify_prefs');
export const setNotifyPrefs = (prefs) => rpc('set_notify_prefs', { p_prefs: prefs });
export const deletePushSub = (endpoint) => rpc('delete_push_subscription', { p_endpoint: endpoint });
export async function groupUserIds(gid) {
  const rows = await rpc('group_user_ids', { p_gid: gid });
  return (Array.isArray(rows) ? rows : []).map(okUuid).filter(Boolean);
}

// Hodinové zálohy na serveru: seznam a obsah jedné zálohy (jen pro členy skupiny).
export async function listBackups(gid) {
  const rows = await rpc('list_backups', { p_gid: gid });
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => typeof r.taken_at === 'string')
    .map((r) => ({ at: r.taken_at, entries: num(r.entries) }));
}
export async function getBackup(gid, at) {
  const data = await rpc('get_backup', { p_gid: gid, p_taken_at: at });
  return data ? sanitize(data) : null;
}

// Stáhne aktuální stav, sloučí s lokálním a případně nahraje.
// Vrací { data, invite, owner }, nebo { gone: true } když ke skupině už nemám přístup.
export async function syncGroup(g) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await fetchRemote(g.id);
    if (!row && g.remote) return { gone: true };
    const local = sanitize(shared(g));
    const merged = row ? merge(local, row.data) : local;
    if (row && canon(merged) === canon(row.data)) return { data: merged, invite: row.invite, owner: row.owner, version: row.version };
    const v = await rpc('save_group', { p_gid: g.id, p_data: merged, p_expected: row ? row.version : 0 });
    if (v > 0) {
      if (row) return { data: merged, invite: row.invite, owner: row.owner, version: v };
      const created = await fetchRemote(g.id);
      return { data: merged, invite: created?.invite || '', owner: true, version: created?.version ?? v };
    }
    // Někdo mezitím uložil novější verzi – zkusíme to znovu s jeho změnami.
  }
  throw new Error('Nepodařilo se uložit, zkusím to znovu');
}
