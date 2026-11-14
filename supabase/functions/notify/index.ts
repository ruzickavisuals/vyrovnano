// Vyrovnáno – rozesílání notifikací (Supabase Edge Function „notify“).
// GET  → vrátí veřejný klíč pro přihlášení zařízení k odběru.
// POST → { group_id, title, body } pošle zprávu ostatním členům skupiny.
// Volat ji smí jen přihlášený uživatel a posílat jen do skupin, kde je sám členem.
// Klíče pro odesílání si funkce vygeneruje při prvním spuštění a uloží do tabulky
// app_secrets, kam nemá přístup nikdo kromě serveru.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import webpush from "npm:web-push@3.6.7";

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
      if (!others.length) return Response.json({ sent: 0 });

      const { data: subs } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").in("user_id", others);
      if (!subs?.length) return Response.json({ sent: 0 });

      webpush.setVapidDetails("https://ruzickavisuals.github.io/vyrovnano/", keys.publicKey, keys.privateKey);
      const payload = JSON.stringify({
        title: String(body.title ?? "Vyrovnáno").slice(0, 80),
        body: String(body.body ?? "").slice(0, 240),
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
