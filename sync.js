// Synchronizace skupin se serverem. Server vydá skupinu jen přihlášenému členovi;
// tady řešíme slučování změn z více zařízení a kontrolu toho, co ze serveru přišlo.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { accessToken } from './auth.js';
import { today } from './logic.js';

export const syncEnabled = !!(SUPABASE_URL && SUPABASE_KEY);

async function rpc(fn, body = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Nepřihlášen');
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server odpověděl ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Část skupiny, která se sdílí se členy.
export const shared = (g) => ({
  name: g.name, emoji: g.emoji, currency: g.currency, members: g.members,
  entries: g.entries, dead: g.dead || {}, mu: g.mu || 0,
});

// Stabilní textová podoba pro porovnání (databáze si pořadí klíčů přeskládá).
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
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
  return { name: meta.name, emoji: meta.emoji, currency: meta.currency, members, entries, dead, mu: meta.mu || 0 };
}

// Data ze serveru mohl upravit kterýkoli člen skupiny, proto jim nevěříme naslepo:
// propustíme jen očekávané položky, typy a rozumné délky. Fotka smí být jen malý obrázek.
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const okId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(v);
const num = (v) => (Number.isFinite(v) ? v : 0);
const cur = (v) => (/^[A-Z]{3}$/.test(v) ? v : 'CZK');
const okUuid = (v) => (typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) ? v : undefined);
const okAvatar = (v) =>
  typeof v === 'string' && v.length < 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : undefined;

export function sanitize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.members) || !Array.isArray(d.entries)) {
    throw new Error('Poškozená data skupiny');
  }
  const members = d.members.slice(0, 100)
    .filter((m) => m && okId(m.id))
    .map((m) => ({ id: m.id, name: str(m.name, 60) || '?', iban: str(m.iban, 50) || undefined, avatar: okAvatar(m.avatar), uid: okUuid(m.uid) }));
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
    }));
  const dead = {};
  if (d.dead && typeof d.dead === 'object') {
    for (const [k, v] of Object.entries(d.dead).slice(0, 5000)) if (okId(k) && Number.isFinite(v)) dead[k] = v;
  }
  return { name: str(d.name, 80) || 'Skupina', emoji: str(d.emoji, 8) || '👥', currency: cur(d.currency), members, entries, dead, mu: num(d.mu) };
}

// Otisk sdílené části skupiny – podle něj poznáme, jestli je co synchronizovat.
export const sig = (g) => canon(sanitize(shared(g)));

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
export const leaveRemote = (gid) => rpc('leave_group', { p_gid: gid });
export const resetInvite = (gid) => rpc('reset_invite', { p_gid: gid });
export const kickRemote = (gid, userId) => rpc('kick_member', { p_gid: gid, p_user: userId });
export const deleteAccount = () => rpc('delete_account');
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
    if (row && canon(merged) === canon(row.data)) return { data: merged, invite: row.invite, owner: row.owner };
    const v = await rpc('save_group', { p_gid: g.id, p_data: merged, p_expected: row ? row.version : 0 });
    if (v > 0) {
      if (row) return { data: merged, invite: row.invite, owner: row.owner };
      const created = await fetchRemote(g.id);
      return { data: merged, invite: created?.invite || '', owner: true };
    }
    // Někdo mezitím uložil novější verzi – zkusíme to znovu s jeho změnami.
  }
  throw new Error('Nepodařilo se uložit, zkusím to znovu');
}
