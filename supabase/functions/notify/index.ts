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

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
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
