// Vyrovnáno – rozesílání notifikací (Supabase Edge Function „notify“).
// GET  → vrátí veřejný klíč pro přihlášení zařízení k odběru.
// POST → { group_id, title, body } pošle zprávu ostatním členům skupiny.
// Volat ji smí jen přihlášený uživatel a posílat jen do skupin, kde je sám členem.
// Klíče pro odesílání si funkce vygeneruje při prvním spuštění a uloží do tabulky
// app_secrets, kam nemá přístup nikdo kromě serveru.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import webpush from "npm:web-push@3.6.7";

// Starší verze aplikace posílají text bez ikony. Doplníme ji tady, aby zprávy vypadaly stejně
// bez ohledu na to, jakou verzi má odesílatel. Text, který ikonou už začíná, necháme být.
const plain = (t: string) => /^[\p{L}\p{N}„"(]/u.test(t);
function decorate(text: string, type: string): string {
  if (!text || !plain(text)) return text;
  const joined = text.match(/nový člen ve skupině \((.+)\)\s*$/);
  if (type === "joined" || joined) return joined ? `👋 ${joined[1]} se připojil(a) ke skupině` : `👋 ${text}`;
  const icon = /zrušen převod/.test(text) ? "↩️"
    : type === "deleted" || /smazán/.test(text) ? "🗑️"
    : /převeden (do|ze) skupiny/.test(text) ? "🔀"
    : /uhrazena část/.test(text) ? "💸"
    : /uhrazeno/.test(text) ? "✅"
    : /upraven/.test(text) ? "✏️"
    : /příjem/.test(text) ? "💰"
    : type === "paid" || /převod/.test(text) ? "💸"
    : "🧾";
  return `${icon} ${text}`;
}

/* ---------- Automatické připomínky ---------- */
// Stejný výpočet jako v aplikaci (logic.js): podíly na haléř přesně, zůstatky a návrh plateb.
type Entry = { amount: number; rate?: number; parts: Record<string, number>; paidBy: string; kind?: string };
type Group = { name?: string; emoji?: string; currency?: string; members?: { id: string; name?: string; uid?: string }[]; entries?: Entry[] };
function allocate(total: number, weights: Record<string, number>, first: string) {
  const ids = Object.keys(weights ?? {}).filter((k) => weights[k] > 0).sort();
  const sum = ids.reduce((s, k) => s + weights[k], 0);
  const out: Record<string, number> = {};
  if (!sum || !total) return out;
  let used = 0;
  const rem = ids.map((id) => {
    const exact = (total * weights[id]) / sum;
    const fl = Math.floor(exact);
    out[id] = fl;
    used += fl;
    return { id, r: exact - fl };
  });
  rem.sort((a, b) => Number(b.id === first) - Number(a.id === first) || b.r - a.r || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < total - used; i++) out[rem[i % rem.length].id]++;
  return out;
}
function settle(g: Group) {
  const bal: Record<string, number> = Object.fromEntries((g.members ?? []).map((m) => [m.id, 0]));
  for (const e of g.entries ?? []) {
    const base = Math.round(e.amount * (e.rate || 1));
    const s = allocate(base, e.parts, e.paidBy);
    const sign = e.kind === "income" ? -1 : 1;
    bal[e.paidBy] = (bal[e.paidBy] || 0) + sign * base;
    for (const id in s) bal[id] = (bal[id] || 0) - sign * s[id];
  }
  const debt: { id: string; v: number }[] = [], cred: { id: string; v: number }[] = [];
  for (const id in bal) {
    if (bal[id] < 0) debt.push({ id, v: -bal[id] });
    else if (bal[id] > 0) cred.push({ id, v: bal[id] });
  }
  const out: { from: string; to: string; amount: number }[] = [];
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
function money(cents: number, currency: string) {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
  } catch (_) {
    return `${(cents / 100).toFixed(whole ? 0 : 2)} ${currency}`;
  }
}
type Item = { who: string; amount: number; cur: string; group: string; days?: number };
// Řádek typu „Petr 800 Kč (KANCL), Jana 250 Kč (Byt) a 2 další“.
function listLine(items: Item[], withDays = false) {
  items.sort((a, b) => b.amount - a.amount);
  const shown = items.slice(0, 3).map((i) => `${i.who} ${money(i.amount, i.cur)} (${i.group}${withDays ? `, ${i.days} dní` : ""})`).join(", ");
  const more = items.length - 3;
  return more > 0 ? `${shown} a ${more} další` : shown;
}
const pragueToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
// Kolikátý den bez pohybu se starý dluh připomíná.
const OVERDUE_DAYS = [30, 45, 60, 90];

// Každodenní běh (spouští ho plánovač databáze). Posílá tři druhy zpráv:
//  1) měsíční přehled dluhů – v den, který si člověk zvolil (výchozí 1.),
//  2) upomínku na starý dluh – když dlužník ve skupině 30, 45, 60 a 90 dní nic nezapsal a pořád dluží,
//  3) vyúčtování po konci akce – den po datu konce, které má skupina nastavené.
// `only` omezí běh na jeden účet, `dry` nic neodešle, `force` = "monthly" pošle měsíční přehled bez ohledu na den.
// deno-lint-ignore no-explicit-any
async function daily(admin: any, keys: { publicKey: string; privateKey: string }, only: string, dry: boolean, force: string) {
  const today = pragueToday();
  const dom = Number(today.slice(8, 10));
  const { data: groups } = await admin.from("groups").select("id,data");
  const { data: links } = await admin.from("group_members").select("group_id,user_id");
  const per: Record<string, { owe: Item[]; get: Item[]; old: Item[]; ended: { title: string; owe: Item[]; get: Item[] }[] }> = {};
  const slot = (u: string) => (per[u] ??= { owe: [], get: [], old: [], ended: [] });
  for (const row of groups ?? []) {
    const g = row.data as Group & { ends?: string };
    const users = new Set<string>((links ?? []).filter((l: { group_id: string }) => l.group_id === row.id).map((l: { user_id: string }) => l.user_id));
    const byId = Object.fromEntries((g.members ?? []).map((m) => [m.id, m]));
    const cur = g.currency || "CZK", group = g.name || "Skupina";
    const ended = typeof g.ends === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.ends) && dayDiff(today, g.ends) === 1;
    const fin: Record<string, { title: string; owe: Item[]; get: Item[] }> = {};
    if (ended) for (const m of g.members ?? []) if (m.uid && users.has(m.uid)) fin[m.uid] = { title: `🏁 ${g.emoji || ""} ${group}: akce skončila`.replace("  ", " "), owe: [], get: [] };
    // Poslední den, kdy se daný člen ve skupině objevil v nějakém záznamu.
    const last: Record<string, string> = {};
    for (const e of (g.entries ?? []) as (Entry & { date?: string })[]) {
      const d = typeof e.date === "string" && e.date <= today ? e.date : "";
      if (!d) continue;
      for (const id of [e.paidBy, ...Object.keys(e.parts ?? {})]) if (!last[id] || d > last[id]) last[id] = d;
    }
    for (const p of settle(g)) {
      if (p.amount < 100) continue; // drobné do jedné koruny neřešíme
      const from = byId[p.from], to = byId[p.to];
      if (from?.uid && users.has(from.uid)) {
        const it = { who: to?.name || "?", amount: p.amount, cur, group };
        slot(from.uid).owe.push(it);
        fin[from.uid]?.owe.push(it);
        const days = last[p.from] ? dayDiff(today, last[p.from]) : 0;
        if (OVERDUE_DAYS.includes(days)) slot(from.uid).old.push({ ...it, days });
      }
      if (to?.uid && users.has(to.uid)) {
        const it = { who: from?.name || "?", amount: p.amount, cur, group };
        slot(to.uid).get.push(it);
        fin[to.uid]?.get.push(it);
      }
    }
    for (const u in fin) slot(u).ended.push(fin[u]);
  }
  let ids = Object.keys(per);
  if (only) ids = ids.filter((id) => id === only);
  if (!ids.length) return { today, monthly: 0, overdue: 0, ended: 0, sent: 0 };
  const { data: prefs } = await admin.from("user_prefs").select("user_id,notify").in("user_id", ids);
  const out: { uid: string; title: string; body: string; tag: string }[] = [];
  const count = { monthly: 0, overdue: 0, ended: 0 };
  for (const id of ids) {
    const n = (prefs ?? []).find((x: { user_id: string }) => x.user_id === id)?.notify ?? {};
    const off = (t: string) => n.types && n.types[t] === false;
    const { owe, get, old, ended } = per[id];
    const myDay = Number.isInteger(n.day) && n.day >= 1 && n.day <= 28 ? n.day : 1;
    if ((force === "monthly" || myDay === dom) && !off("reminder") && (owe.length || get.length)) {
      const lines: string[] = [];
      if (owe.length) lines.push(`💸 Dlužíš: ${listLine([...owe])}`);
      if (get.length) lines.push(`💰 Máš dostat: ${listLine([...get])}`);
      out.push({ uid: id, title: owe.length ? "📅 Čas se vyrovnat" : "📅 Přehled dluhů", body: lines.join("\n"), tag: "reminder" });
      count.monthly++;
    }
    if (old.length && !off("overdue")) {
      const same = old.every((o) => o.days === old[0].days);
      out.push({
        uid: id,
        title: same ? `⏰ Dluh už visí ${old[0].days} dní` : "⏰ Staré dluhy pořád visí",
        body: `Dlužíš: ${listLine([...old], !same)}. Vyrovnej to, ať je klid.`,
        tag: "overdue",
      });
      count.overdue++;
    }
    if (!off("ended")) {
      for (const f of ended) {
        const lines: string[] = [];
        if (f.owe.length) lines.push(`💸 Dlužíš: ${f.owe.map((i) => `${i.who} ${money(i.amount, i.cur)}`).join(", ")}`);
        if (f.get.length) lines.push(`💰 Máš dostat: ${f.get.map((i) => `${i.who} ${money(i.amount, i.cur)}`).join(", ")}`);
        if (!lines.length) lines.push("✅ Jsi se všemi vyrovnaný, nic neřeš.");
        out.push({ uid: id, title: f.title, body: lines.join("\n"), tag: "ended" });
        count.ended++;
      }
    }
  }
  if (!out.length) return { today, ...count, sent: 0 };
  const { data: subs } = await admin.from("push_subscriptions").select("user_id,endpoint,p256dh,auth").in("user_id", [...new Set(out.map((o) => o.uid))]);
  if (dry) return { today, ...count, devices: subs?.length ?? 0, sent: 0 };
  webpush.setVapidDetails("https://ruzickavisuals.github.io/vyrovnano/", keys.publicKey, keys.privateKey);
  let sent = 0;
  const dead: string[] = [];
  const jobs: Promise<void>[] = [];
  for (const o of out) {
    const payload = JSON.stringify({ title: o.title.slice(0, 80), body: o.body.slice(0, 300), tag: o.tag });
    for (const s of (subs ?? []).filter((x: { user_id: string }) => x.user_id === o.uid)) {
      jobs.push((async () => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3 * 86400 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.endpoint);
        }
      })());
    }
  }
  await Promise.all(jobs);
  if (dead.length) await admin.from("push_subscriptions").delete().in("endpoint", [...new Set(dead)]);
  return { today, ...count, devices: subs?.length ?? 0, sent };
}

export default {
  fetch: withSupabase({ auth: ["user", "none"] }, async (req, ctx) => {
    try {
      // Úplná záloha dat pro majitele aplikace: stahuje ji jeho počítač a prokazuje se vlastním klíčem.
      // V databázi je uložený jen otisk klíče (SHA-256), samotný klíč zná jen ten počítač.
      const backupKey = req.headers.get("x-backup-key");
      if (backupKey) {
        const a = ctx.supabaseAdmin;
        const { data: b } = await a.from("app_secrets").select("value").eq("name", "backup").maybeSingle();
        const want = (b?.value as { hash?: string } | null)?.hash;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(backupKey));
        const got = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
        if (!want || want.length !== 64 || backupKey.length < 40 || want !== got) return Response.json({ error: "unauthorized" }, { status: 401 });
        const [groups, members, prefs, admins] = await Promise.all([
          a.from("groups").select("id,data,version,invite,owner,created_at,updated_at").order("created_at"),
          a.from("group_members").select("group_id,user_id,joined_at").order("joined_at"),
          a.from("user_prefs").select("user_id,notify"),
          a.from("app_admins").select("user_id"),
        ]);
        if (groups.error || members.error) return Response.json({ error: "read failed" }, { status: 500 });
        // Účty: jen kdo je kdo (bez hesel – ta má jen přihlašovací služba a ani tady k nim není přístup).
        let users: unknown[] = [];
        try {
          const { data: u } = await a.auth.admin.listUsers({ page: 1, perPage: 1000 });
          users = (u?.users ?? []).map((x: { id: string; email?: string; created_at?: string; app_metadata?: { provider?: string }; user_metadata?: { full_name?: string; name?: string } }) => ({
            id: x.id, email: x.email ?? "", created_at: x.created_at, provider: x.app_metadata?.provider ?? "",
            name: x.user_metadata?.full_name ?? x.user_metadata?.name ?? "",
          }));
        } catch (_) { /* záloha skupin je důležitější než seznam účtů */ }
        return Response.json({
          app: "vyrovnano", kind: "full-backup", taken_at: new Date().toISOString(),
          groups: groups.data, group_members: members.data, user_prefs: prefs.data ?? [], app_admins: admins.data ?? [], users,
        });
      }
      // Plánovač databáze se neprokazuje účtem, ale tajným heslem z tabulky app_secrets.
      const cronKey = req.headers.get("x-cron-key");
      if (cronKey && req.method === "POST") {
        const a = ctx.supabaseAdmin;
        const { data: c } = await a.from("app_secrets").select("value").eq("name", "cron").maybeSingle();
        const want = (c?.value as { key?: string } | null)?.key;
        if (!want || want.length < 32 || want !== cronKey) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { data: v } = await a.from("app_secrets").select("value").eq("name", "vapid").maybeSingle();
        if (!v) return Response.json({ people: 0, sent: 0 });
        const b = await req.json().catch(() => ({}));
        return Response.json(await daily(a, v.value, String(b.only ?? ""), b.dry === true, String(b.force ?? "")));
      }
      const me = ctx.userClaims?.id;
      if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
      const admin = ctx.supabaseAdmin;

      // Klíče pro odesílání (vytvoří se jednou).
      let { data: secret } = await admin.from("app_secrets").select("value").eq("name", "vapid").maybeSingle();
      if (!secret) {
        const fresh = webpush.generateVAPIDKeys();
        await admin.from("app_secrets").upsert({ name: "vapid", value: fresh }, { onConflict: "name", ignoreDuplicates: true });
        ({ data: secret } = await admin.from("app_secrets").select("value").eq("name", "vapid").single());
      }
      const keys = secret!.value as { publicKey: string; privateKey: string };
      if (req.method === "GET") return Response.json({ publicKey: keys.publicKey });

      const body = await req.json();
      const gid = String(body.group_id ?? "");
      let others: string[];
      if (body.test === true) {
        // Zkušební zpráva jde jen na vlastní zařízení volajícího.
        others = [me];
      } else {
        // Členové skupiny – databáze vrátí seznam jen tomu, kdo je sám členem.
        const { data: members, error } = await ctx.supabase.rpc("group_user_ids", { p_gid: gid });
        if (error || !members?.length) return Response.json({ error: "forbidden" }, { status: 403 });
        others = (members as string[]).filter((id) => id !== me);
      }
      if (body.test !== true) {
        // Každý si volí, co mu má chodit. Výchozí je „jen co se mě týká“.
        const type = String(body.type ?? "entry");
        const involved: string[] = Array.isArray(body.involved) ? body.involved.map(String) : [];
        const { data: prefs } = await admin.from("user_prefs").select("user_id,notify").in("user_id", others);
        others = others.filter((id) => {
          const p = (prefs ?? []).find((x) => x.user_id === id)?.notify ?? {};
          if (p.types && p.types[type] === false) return false;
          if ((p.scope ?? "mine") === "mine" && type !== "joined" && !involved.includes(id)) return false;
          return true;
        });
      }
      if (!others.length) return Response.json({ sent: 0 });

      const { data: subs } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").in("user_id", others);
      if (!subs?.length) return Response.json({ sent: 0 });

      webpush.setVapidDetails("https://ruzickavisuals.github.io/vyrovnano/", keys.publicKey, keys.privateKey);
      // Nadpis: název skupiny s její ikonou (starší verze aplikace posílají jen název).
      let title = String(body.title ?? "Vyrovnáno");
      if (body.test !== true && plain(title)) {
        try {
          const { data: g } = await admin.from("groups").select("emoji:data->>emoji").eq("id", gid).maybeSingle();
          const emoji = (g as { emoji?: string } | null)?.emoji;
          if (emoji) title = `${emoji} ${title}`;
        } catch (_) { /* bez ikony */ }
      }
      const payload = JSON.stringify({
        title: title.slice(0, 80),
        body: decorate(String(body.body ?? ""), String(body.type ?? "entry")).slice(0, 240),
        tag: gid,
      });
      let sent = 0;
      let failed = "";
      const dead: string[] = [];
      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.endpoint); // zařízení odběr zrušilo
          else failed = String(code ?? (e as Error).message ?? e).slice(0, 120);
        }
      }));
      if (dead.length) await admin.from("push_subscriptions").delete().in("endpoint", dead);
      return Response.json({ sent, devices: subs.length, ...(failed ? { failed } : {}) });
    } catch (e) {
      return Response.json({ error: String((e as Error).message ?? e) }, { status: 500 });
    }
  }),
};
