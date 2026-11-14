// Vyrovnáno – rozesílání notifikací (Supabase Edge Function).
// GET  → vrátí veřejný klíč pro přihlášení zařízení k odběru.
// POST → { group_id, title, body } pošle zprávu ostatním členům skupiny.
// Volat ji smí jen přihlášený uživatel a posílat jen do skupin, kde je členem.
// Klíče pro odesílání si funkce vygeneruje sama při prvním spuštění a uloží do tabulky
// app_secrets, kam nemá přístup nikdo kromě serveru.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Kdo volá? Bez platného přihlášení nic.
    const auth = req.headers.get("Authorization") ?? "";
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: who } = await asUser.auth.getUser();
    if (!who?.user) return json({ error: "unauthorized" }, 401);

    // Klíče pro odesílání (vytvoří se jednou).
    let { data: secret } = await admin.from("app_secrets").select("value").eq("name", "vapid").maybeSingle();
    if (!secret) {
      const fresh = webpush.generateVAPIDKeys();
      await admin.from("app_secrets").upsert({ name: "vapid", value: fresh }, { onConflict: "name", ignoreDuplicates: true });
      ({ data: secret } = await admin.from("app_secrets").select("value").eq("name", "vapid").single());
    }
    const keys = secret!.value as { publicKey: string; privateKey: string };
    if (req.method === "GET") return json({ publicKey: keys.publicKey });

    const body = await req.json();
    const gid = String(body.group_id ?? "");
    // Členové skupiny – funkce vrátí seznam jen tomu, kdo je sám členem.
    const { data: members, error } = await asUser.rpc("group_user_ids", { p_gid: gid });
    if (error || !members?.length) return json({ error: "forbidden" }, 403);
    const others = (members as string[]).filter((id) => id !== who.user.id);
    if (!others.length) return json({ sent: 0 });

    const { data: subs } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").in("user_id", others);
    if (!subs?.length) return json({ sent: 0 });

    webpush.setVapidDetails("https://ruzickavisuals.github.io/vyrovnano/", keys.publicKey, keys.privateKey);
    const payload = JSON.stringify({
      title: String(body.title ?? "Vyrovnáno").slice(0, 80),
      body: String(body.body ?? "").slice(0, 240),
      tag: gid,
    });
    let sent = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint); // zařízení odběr zrušilo
      }
    }));
    if (dead.length) await admin.from("push_subscriptions").delete().in("endpoint", dead);
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
