// Účty: registrace, přihlášení e-mailem a heslem, Google, obnova a změna hesla.
// Hesla se nikdy neukládají v aplikaci; posílají se jen přihlašovací službě Supabase
// přes šifrované spojení. V zařízení zůstává jen přihlašovací relace.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const BASE = SUPABASE_URL.replace(/\/$/, '') + '/auth/v1';
const SKEY = 'vyrovnano.session';
const here = () => location.origin + location.pathname;
// Adresa pro návrat z přihlášení. Čekající pozvánku do skupiny pošleme s sebou, aby se neztratila,
// ani když se přihlášení dokončí v jiném prohlížeči (třeba odkaz otevřený v Messengeru a návrat do Safari).
function back() {
  let t = '';
  try {
    const j = JSON.parse(localStorage.getItem('vyrovnano.join'));
    if (j && /^[a-f0-9]{32}$/.test(j.t)) t = j.t;
  } catch {}
  return here() + (t ? '?join=' + t : '');
}

let session = null;
try {
  const s = JSON.parse(localStorage.getItem(SKEY));
  if (s && s.access_token && s.refresh_token && s.user?.id) session = s;
} catch {}

const listeners = new Set();
function set(s) {
  session = s;
  if (s) localStorage.setItem(SKEY, JSON.stringify(s));
  else localStorage.removeItem(SKEY);
  listeners.forEach((f) => f(s));
}
export const getSession = () => session;
export const onAuthChange = (f) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

// Uživateli ukazujeme jen vlastní texty, nikdy syrovou odpověď serveru.
const MSG = {
  invalid_credentials: 'Nesprávný e-mail nebo heslo.',
  email_not_confirmed: 'Nejdřív potvrď e-mail odkazem, který ti přišel.',
  user_already_exists: 'Účet s tímto e-mailem už existuje. Zkus se přihlásit.',
  email_exists: 'Účet s tímto e-mailem už existuje. Zkus se přihlásit.',
  weak_password: 'Heslo je příliš slabé, zvol delší.',
  same_password: 'Nové heslo musí být jiné než to staré.',
  email_address_invalid: 'Tenhle e-mail nevypadá platně.',
  validation_failed: 'Zkontroluj e-mail a heslo.',
  over_email_send_rate_limit: 'Příliš mnoho pokusů, zkus to za chvíli.',
  over_request_rate_limit: 'Příliš mnoho pokusů, zkus to za chvíli.',
  signup_disabled: 'Registrace je momentálně vypnutá.',
  mfa_verification_failed: 'Kód nesedí. Zadej aktuální kód z ověřovací aplikace.',
  mfa_challenge_expired: 'Ověření vypršelo, zkus to znovu.',
  mfa_factor_not_found: 'Dvoufázové ověření už není nastavené. Zkus to znovu.',
  insufficient_aal: 'Nejdřív se ověř kódem z ověřovací aplikace.',
  too_many_enrolled_mfa_factors: 'Dvoufázové ověření už je zapnuté.',
};

async function call(path, { method = 'POST', body, token } = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Nejde se připojit k serveru. Jsi online?');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(MSG[j.error_code] || 'Něco se nepovedlo. Zkus to prosím znovu.');
    e.status = res.status;
    throw e;
  }
  return j;
}

const pickUser = (u) => ({
  id: u.id, email: u.email || '', provider: u.app_metadata?.provider || 'email',
  // Jméno z Google účtu (pokud je) použijeme jako výchozí jméno v profilu.
  name: String(u.user_metadata?.full_name || u.user_metadata?.name || '').slice(0, 60),
});

// Úroveň ověření zapsaná v přihlašovacím tokenu: aal1 = jen heslo, aal2 = i kód z ověřovací aplikace.
function aalOf(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1';
  } catch {
    return 'aal1';
  }
}
// Dvoufázové ověření: null = vypnuté; jinak { id, ok }, kde ok říká, jestli už je tahle relace ověřená kódem.
function mfaOf(u, token, prev) {
  if (!Array.isArray(u?.factors)) return prev ? { id: prev.id, ok: aalOf(token) === 'aal2' } : null;
  const f = u.factors.find((x) => x.status === 'verified' && x.factor_type === 'totp');
  return f ? { id: f.id, ok: aalOf(token) === 'aal2' } : null;
}
function store(j, u = j.user) {
  set({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
    user: pickUser(u),
    mfa: mfaOf(u, j.access_token, session?.user?.id === u.id ? session.mfa : null),
  });
}

// Pravidla pro nová hesla: délka a kontrola proti databázi uniklých hesel (Have I Been Pwned).
// Ven se posílá jen prvních 5 znaků otisku hesla, nikdy heslo samotné. Když služba neodpoví, kontrola se přeskočí.
export const MIN_PASSWORD = 10;
async function checkPassword(password) {
  if (password.length < MIN_PASSWORD) throw new Error(`Heslo musí mít aspoň ${MIN_PASSWORD} znaků.`);
  let found = false;
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0, 5), { referrerPolicy: 'no-referrer' });
    if (res.ok) found = (await res.text()).split('\n').some((l) => l.split(':')[0].trim() === hex.slice(5));
  } catch {}
  if (found) throw new Error('Tohle heslo se objevilo v uniklých databázích hesel, takže ho útočníci zkoušejí jako první. Zvol prosím jiné.');
}

// Vrací 'in' (rovnou přihlášen) nebo 'confirm' (je potřeba potvrdit e-mail).
export async function signUp(email, password) {
  await checkPassword(password);
  const j = await call('/signup?redirect_to=' + encodeURIComponent(back()), { body: { email, password } });
  if (j.access_token) {
    store(j);
    return 'in';
  }
  return 'confirm';
}

export async function signIn(email, password) {
  const j = await call('/token?grant_type=password', { body: { email, password } });
  // Plné údaje o účtu (včetně toho, jestli má zapnuté dvoufázové ověření) si načteme ještě před přihlášením.
  const u = await call('/user', { method: 'GET', token: j.access_token }).catch(() => j.user);
  store(j, u);
}

export function signInWithGoogle() {
  location.assign(`${BASE}/authorize?provider=google&redirect_to=${encodeURIComponent(back())}`);
}

export async function sendPasswordReset(email) {
  await call('/recover?redirect_to=' + encodeURIComponent(here()), { body: { email } });
}

export async function updatePassword(password) {
  await checkPassword(password);
  const token = await accessToken();
  if (!token) throw new Error('Přihlášení vypršelo, přihlas se znovu.');
  await call('/user', { method: 'PUT', token, body: { password } });
}

export async function signOut() {
  const token = session?.access_token;
  set(null);
  // scope=local: odhlásí jen tohle zařízení, ostatní (třeba telefon) zůstanou přihlášená.
  if (token) await call('/logout?scope=local', { token }).catch(() => {});
}

// Platný přístupový token; krátce před vypršením ho obnoví.
let refreshing = null;
export async function accessToken() {
  if (!session) return null;
  if (session.expires_at - Date.now() / 1000 > 60) return session.access_token;
  refreshing ||= call('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } })
    .then(store)
    .catch((e) => {
      if (e.status >= 400 && e.status < 500) set(null); // relace už neplatí → odhlásit
    })
    .finally(() => (refreshing = null));
  await refreshing;
  return session?.access_token || null;
}

// Návrat z Google přihlášení, z potvrzení e-mailu nebo z odkazu na obnovu hesla:
// přihlašovací údaje přijdou za znakem # v adrese. Převezmeme je a adresu hned vyčistíme.
export async function consumeUrl() {
  const h = new URLSearchParams(location.hash.slice(1));
  const at = h.get('access_token'), rt = h.get('refresh_token');
  if (h.get('error') || h.get('error_code')) {
    history.replaceState(null, '', location.pathname);
    // Vypršelý odkaz z e-mailu vs. nedokončené přihlášení přes jinou službu (např. Google).
    return {
      error: h.get('error_code') === 'otp_expired'
        ? 'Odkaz je neplatný nebo už vypršel. Zkus to prosím znovu.'
        : 'Přihlášení přes Google se nepodařilo dokončit. Zkus to prosím znovu nebo se přihlas e-mailem a heslem.',
    };
  }
  if (!at || !rt) return {};
  history.replaceState(null, '', location.pathname);
  const u = await call('/user', { method: 'GET', token: at });
  store({ access_token: at, refresh_token: rt, expires_in: h.get('expires_in') }, u);
  return { type: h.get('type') || '' };
}

/* ---------- Dvoufázové ověření (kód z ověřovací aplikace) ---------- */

// Zjistí aktuální stav ze serveru – třeba když si ověření zapneš na jiném zařízení.
export async function refreshMfa() {
  const token = await accessToken();
  if (!token || !session) return;
  const u = await call('/user', { method: 'GET', token }).catch((e) => {
    // Relace byla na serveru ukončena (odhlášení odjinud, zapnutí dvoufázového ověření): vrátíme se na přihlášení.
    if (e.status === 401 || e.status === 403) set(null);
    return null;
  });
  if (!u || !session || u.id !== session.user.id) return;
  const mfa = mfaOf(u, session.access_token, null);
  if (JSON.stringify(mfa) !== JSON.stringify(session.mfa || null)) set({ ...session, mfa });
}

// Začátek zapínání: vrátí adresu pro QR kód a tajný klíč pro ruční zadání.
export async function mfaStart() {
  const token = await accessToken();
  if (!token) throw new Error('Přihlášení vypršelo, přihlas se znovu.');
  const u = await call('/user', { method: 'GET', token });
  // Nedokončené pokusy z dřívějška uklidíme, jinak by překážely.
  for (const f of u.factors || []) {
    if (f.status !== 'verified') await call('/factors/' + f.id, { method: 'DELETE', token }).catch(() => {});
  }
  const j = await call('/factors', { token, body: { factor_type: 'totp', friendly_name: 'Vyrovnáno ' + Date.now(), issuer: 'Vyrovnáno' } });
  return { id: j.id, uri: j.totp.uri, secret: j.totp.secret };
}

// Ověření kódem: při zapínání i při každém přihlášení. Po úspěchu je relace plně ověřená.
export async function mfaVerify(factorId, code) {
  const token = await accessToken();
  if (!token) throw new Error('Přihlášení vypršelo, přihlas se znovu.');
  const ch = await call(`/factors/${factorId}/challenge`, { token, body: {} });
  const j = await call(`/factors/${factorId}/verify`, { token, body: { challenge_id: ch.id, code } });
  set({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
    user: session.user,
    mfa: { id: factorId, ok: true },
  });
}

export async function mfaDisable() {
  const token = await accessToken();
  if (!token || !session?.mfa) return;
  await call('/factors/' + session.mfa.id, { method: 'DELETE', token });
  set({ ...session, mfa: null });
}
