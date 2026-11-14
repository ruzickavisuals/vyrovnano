// Notifikace: přihlášení zařízení k odběru a odesílání zpráv ostatním členům skupiny.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { accessToken } from './auth.js';

const FN = SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/notify';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone povolí notifikace jen aplikaci přidané na plochu.
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

async function call(method, body) {
  const token = await accessToken();
  if (!token) throw new Error('Nepřihlášen');
  const res = await fetch(FN, {
    method,
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Server odpověděl ${res.status}`);
  return res.json();
}

const toBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// 'unsupported' | 'denied' | 'on' | 'off'
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub ? 'on' : 'off';
}

export async function enablePush(save) {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifikace nejsou povolené.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await call('GET');
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }));
  const j = sub.toJSON();
  await save(j.endpoint, j.keys.p256dh, j.keys.auth);
}

export async function disablePush(remove) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await remove(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

// Zkušební zpráva na vlastní zařízení; vrací { sent, devices, failed? }.
export const testPush = () => call('POST', { test: true, title: 'Vyrovnáno', body: 'Zkušební notifikace: funguje to 🎉' });

// Pošle zprávu ostatním členům skupiny. Selhání se nehlásí – notifikace je jen doplněk.
export const notifyGroup = (groupId, title, body) => call('POST', { group_id: groupId, title, body }).catch(() => {});
