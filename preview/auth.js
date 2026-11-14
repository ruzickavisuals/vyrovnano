// Účty: registrace, přihlášení e-mailem a heslem, Google, obnova a změna hesla.
// Hesla se nikdy neukládají v aplikaci; posílají se jen přihlašovací službě Supabase
// přes šifrované spojení. V zařízení zůstává jen přihlašovací relace.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const BASE = SUPABASE_URL.replace(/\/$/, '') + '/auth/v1';
const SKEY = 'vyrovnano.session';
const here = () => location.origin + location.pathname;

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
function store(j) {
  set({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: pickUser(j.user),
  });
}

// Vrací 'in' (rovnou přihlášen) nebo 'confirm' (je potřeba potvrdit e-mail).
export async function signUp(email, password) {
  const j = await call('/signup?redirect_to=' + encodeURIComponent(here()), { body: { email, password } });
  if (j.access_token) {
    store(j);
    return 'in';
  }
  return 'confirm';
}

export async function signIn(email, password) {
  store(await call('/token?grant_type=password', { body: { email, password } }));
}

export function signInWithGoogle() {
  location.assign(`${BASE}/authorize?provider=google&redirect_to=${encodeURIComponent(here())}`);
}

export async function sendPasswordReset(email) {
  await call('/recover?redirect_to=' + encodeURIComponent(here()), { body: { email } });
}

export async function updatePassword(password) {
  const token = await accessToken();
  if (!token) throw new Error('Přihlášení vypršelo, přihlas se znovu.');
  await call('/user', { method: 'PUT', token, body: { password } });
}

export async function signOut() {
  const token = session?.access_token;
  set(null);
  if (token) await call('/logout', { token }).catch(() => {});
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
  set({
    access_token: at,
    refresh_token: rt,
    expires_at: Math.floor(Date.now() / 1000) + (Number(h.get('expires_in')) || 3600),
    user: pickUser(u),
  });
  return { type: h.get('type') || '' };
}
