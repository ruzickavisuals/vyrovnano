-- Vyrovnáno: databáze pro účty a sdílené skupiny.
-- Vložte celé do Supabase → SQL Editor → New query a stiskněte Run.
-- Skript jde bezpečně spustit opakovaně.

-- Úklid po starší verzi bez účtů (pokud jste ji někdy spustili).
drop function if exists public.get_group(text);
drop function if exists public.save_group(text, jsonb, integer);
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'groups'
               and column_name = 'id' and data_type = 'text') then
    drop table public.groups;
  end if;
end $$;

-- Skupina = jeden dokument s výdaji. Pozvánka je dlouhý náhodný kód.
create table if not exists public.groups (
  id uuid primary key,
  data jsonb not null,
  version integer not null default 1,
  invite text not null unique default replace(gen_random_uuid()::text, '-', ''),
  owner uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kdo má ke které skupině přístup.
create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

-- Tabulky nejsou přístupné napřímo nikomu. Vše jde jen přes funkce níže,
-- a každá z nich si ověřuje přihlášeného uživatele a jeho členství.
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.groups, public.group_members from anon, authenticated;

-- Moje skupiny (jen ty, kde jsem členem).
create or replace function public.my_groups()
returns table (id uuid, data jsonb, version integer, invite text, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select g.id, g.data, g.version, g.invite, coalesce(g.owner = auth.uid(), false)
  from public.groups g
  join public.group_members m on m.group_id = g.id
  where m.user_id = auth.uid();
$$;

-- Jedna skupina; nečlen nedostane nic.
create or replace function public.get_group(p_gid uuid)
returns table (data jsonb, version integer, invite text, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select g.data, g.version, g.invite, coalesce(g.owner = auth.uid(), false)
  from public.groups g
  join public.group_members m on m.group_id = g.id
  where g.id = p_gid and m.user_id = auth.uid();
$$;

-- Účty, které mají ke skupině přístup (vidí jen člen).
create or replace function public.group_user_ids(p_gid uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from public.group_members m
  where m.group_id = p_gid
    and exists (select 1 from public.group_members x where x.group_id = p_gid and x.user_id = auth.uid());
$$;

-- Uložení. p_expected = 0 zakládá novou skupinu; jinak uloží jen tehdy,
-- když mezitím nikdo neuložil novější verzi. Vrací číslo verze, nebo -1 při kolizi.
create or replace function public.save_group(p_gid uuid, p_data jsonb, p_expected integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v integer;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if pg_column_size(p_data) > 1000000 then raise exception 'group too large'; end if;

  if p_expected = 0 then
    if (select count(*) from public.groups g where g.owner = me) >= 200 then
      raise exception 'too many groups';
    end if;
    insert into public.groups (id, data, owner) values (p_gid, p_data, me)
      on conflict (id) do nothing returning version into v;
    if v is null then return -1; end if;
    insert into public.group_members (group_id, user_id) values (p_gid, me);
    return v;
  end if;

  if not exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = me) then
    raise exception 'forbidden';
  end if;
  update public.groups g
    set data = p_data, version = g.version + 1, updated_at = now()
    where g.id = p_gid and g.version = p_expected
    returning g.version into v;
  return coalesce(v, -1);
end;
$$;

-- Připojení přes pozvánku. Neplatný kód nevrátí nic.
create or replace function public.join_group(p_token text)
returns table (id uuid, data jsonb, version integer, invite text, is_owner boolean)
language sql volatile security definer set search_path = ''
as $$
  insert into public.group_members (group_id, user_id)
    select g.id, auth.uid() from public.groups g
    where g.invite = p_token and auth.uid() is not null and length(p_token) >= 32
      and (select count(*) from public.group_members m where m.group_id = g.id) < 100
  on conflict do nothing;

  select g.id, g.data, g.version, g.invite, coalesce(g.owner = auth.uid(), false)
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  where g.invite = p_token;
$$;

-- Opuštění skupiny. Poslední člen ji tím smaže; odchází-li vlastník, předá ji nejstaršímu členovi.
create or replace function public.leave_group(p_gid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid();
begin
  delete from public.group_members m where m.group_id = p_gid and m.user_id = me;
  if not found then return; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_gid) then
    delete from public.groups g where g.id = p_gid;
  else
    update public.groups g
      set owner = (select m.user_id from public.group_members m where m.group_id = p_gid order by m.joined_at limit 1)
      where g.id = p_gid and (g.owner = me or g.owner is null);
  end if;
end;
$$;

-- Zrušení staré pozvánky a vytvoření nové (jen vlastník).
create or replace function public.reset_invite(p_gid uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  update public.groups g set invite = replace(gen_random_uuid()::text, '-', '')
    where g.id = p_gid and g.owner = auth.uid()
    returning g.invite into t;
  if t is null then raise exception 'forbidden'; end if;
  return t;
end;
$$;

-- Odebrání přístupu jinému účtu (jen vlastník). Zároveň zruší starou pozvánku,
-- aby se odebraný nemohl vrátit starým odkazem. Vrací novou pozvánku.
create or replace function public.kick_member(p_gid uuid, p_user uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  if p_user = auth.uid() then raise exception 'use leave_group'; end if;
  update public.groups g set invite = replace(gen_random_uuid()::text, '-', '')
    where g.id = p_gid and g.owner = auth.uid()
    returning g.invite into t;
  if t is null then raise exception 'forbidden'; end if;
  delete from public.group_members m where m.group_id = p_gid and m.user_id = p_user;
  return t;
end;
$$;

-- Smazání vlastního účtu. Skupiny, kde jsem jediný, zmizí; ostatní zůstanou zbylým členům.
create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from public.groups g
    where exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = me)
      and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id <> me);
  update public.groups g
    set owner = (select m.user_id from public.group_members m
                 where m.group_id = g.id and m.user_id <> me order by m.joined_at limit 1)
    where g.owner = me;
  delete from auth.users u where u.id = me;
end;
$$;

-- ===== Správce aplikace a ochrana čísel účtů =====
-- Správce se přidává ručně v SQL Editoru (záměrně ne z aplikace):
--   insert into public.app_admins (user_id) select id from auth.users where email = 'váš e-mail';
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Hlídá dvě věci u členů skupiny při každém uložení:
--  1) propojení člena s účtem (uid): běžný uživatel smí jen přivlastnit volného člena sobě
--     nebo své propojení zrušit; cizí propojení mění jen vlastník skupiny nebo správce;
--  2) číslo účtu (iban): mění ho jen ten, komu člen patří, nebo správce.
-- Nedovolená změna se neodmítá, ale tiše vrátí na původní hodnotu, aby se zařízení nezasekla.
create or replace function public.protect_members(p_old jsonb, p_new jsonb, p_me uuid, p_can_uid boolean, p_can_iban boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  res jsonb := '[]'::jsonb;
  m jsonb;
  o jsonb;
  fixed jsonb;
  changed boolean := false;
  mine text := p_me::text;
begin
  if (p_can_uid and p_can_iban) or jsonb_typeof(p_new -> 'members') is distinct from 'array' then
    return p_new;
  end if;
  for m in select t.val from jsonb_array_elements(p_new -> 'members') as t(val) loop
    o := null;
    if jsonb_typeof(p_old -> 'members') = 'array' then
      select t.val into o from jsonb_array_elements(p_old -> 'members') as t(val)
        where t.val ->> 'id' = m ->> 'id' limit 1;
    end if;
    fixed := m;

    if not p_can_uid and coalesce(m ->> 'uid', '') <> coalesce(o ->> 'uid', '') then
      if not ((coalesce(o ->> 'uid', '') = '' and m ->> 'uid' = mine)
           or (o ->> 'uid' = mine and coalesce(m ->> 'uid', '') = '')) then
        fixed := fixed - 'uid';
        if coalesce(o ->> 'uid', '') <> '' then fixed := fixed || jsonb_build_object('uid', o -> 'uid'); end if;
        changed := true;
      end if;
    end if;

    if not p_can_iban and coalesce(m ->> 'iban', '') <> coalesce(o ->> 'iban', '')
       and coalesce(fixed ->> 'uid', '') <> mine then
      fixed := fixed - 'iban';
      if coalesce(o ->> 'iban', '') <> '' then fixed := fixed || jsonb_build_object('iban', o -> 'iban'); end if;
      changed := true;
    end if;

    res := res || jsonb_build_array(fixed);
  end loop;

  if changed then
    p_new := jsonb_set(p_new, '{members}', res);
    -- Novější časové razítko zajistí, že opravenou verzi převezmou všechna zařízení.
    p_new := jsonb_set(p_new, '{mu}', to_jsonb(greatest(
      case when jsonb_typeof(p_new -> 'mu') = 'number' then (p_new ->> 'mu')::numeric::bigint else 0 end + 1,
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint)));
  end if;
  return p_new;
end;
$$;
revoke execute on function public.protect_members(jsonb, jsonb, uuid, boolean, boolean) from public, anon, authenticated;

create or replace function public.save_group(p_gid uuid, p_data jsonb, p_expected integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v integer;
  me uuid := auth.uid();
  adm boolean;
  old_data jsonb;
  old_owner uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if pg_column_size(p_data) > 1000000 then raise exception 'group too large'; end if;
  adm := exists (select 1 from public.app_admins a where a.user_id = me);

  if p_expected = 0 then
    if (select count(*) from public.groups g where g.owner = me) >= 200 then
      raise exception 'too many groups';
    end if;
    insert into public.groups (id, data, owner)
      values (p_gid, public.protect_members(null, p_data, me, true, adm), me)
      on conflict (id) do nothing returning version into v;
    if v is null then return -1; end if;
    insert into public.group_members (group_id, user_id) values (p_gid, me);
    return v;
  end if;

  if not exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = me) then
    raise exception 'forbidden';
  end if;
  select g.data, g.owner into old_data, old_owner from public.groups g where g.id = p_gid for update;
  update public.groups g
    set data = public.protect_members(old_data, p_data, me, adm or coalesce(old_owner = me, false), adm),
        version = g.version + 1, updated_at = now()
    where g.id = p_gid and g.version = p_expected
    returning g.version into v;
  return coalesce(v, -1);
end;
$$;
revoke execute on function public.save_group(uuid, jsonb, integer) from public, anon;
grant execute on function public.save_group(uuid, jsonb, integer) to authenticated;

-- ===== Notifikace =====
-- Zařízení, která si notifikace zapnula. Čte je jen serverová funkce „notify“.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Klíče, které si serverová funkce sama vygeneruje. Nikdo jiný k nim nesmí.
create table if not exists public.app_secrets (
  name text primary key,
  value jsonb not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'invalid subscription';
  end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = me) >= 20 then
    delete from public.push_subscriptions s where s.user_id = me
      and s.endpoint = (select x.endpoint from public.push_subscriptions x where x.user_id = me order by x.created_at limit 1);
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, me, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;

revoke execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;

-- Volby notifikací (co komu má chodit). Čte je serverová funkce „notify“.
create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  notify jsonb not null default '{}'::jsonb
);
alter table public.user_prefs enable row level security;
revoke all on public.user_prefs from anon, authenticated;

create or replace function public.get_notify_prefs()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.notify from public.user_prefs p where p.user_id = auth.uid()), '{}'::jsonb);
$$;

create or replace function public.set_notify_prefs(p_prefs jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_prefs) <> 'object' or pg_column_size(p_prefs) > 2000 then raise exception 'invalid prefs'; end if;
  insert into public.user_prefs (user_id, notify) values (me, p_prefs)
    on conflict (user_id) do update set notify = excluded.notify;
end;
$$;

revoke execute on function public.get_notify_prefs(), public.set_notify_prefs(jsonb) from public, anon;
grant execute on function public.get_notify_prefs(), public.set_notify_prefs(jsonb) to authenticated;

-- ===== Zálohy =====
-- Každou hodinu se uloží kopie každé skupiny, která se od poslední zálohy změnila.
-- Uchovává se posledních 48 verzí na skupinu; starší se mažou.
-- Zálohy smazaných skupin zůstávají 30 dní (obnovit je může jen správce projektu).
create table if not exists public.group_backups (
  group_id uuid not null,
  taken_at timestamptz not null default now(),
  version integer not null,
  data jsonb not null,
  primary key (group_id, taken_at)
);
alter table public.group_backups enable row level security;
revoke all on public.group_backups from anon, authenticated;

create or replace function public.backup_groups()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.group_backups (group_id, version, data)
    select g.id, g.version, g.data from public.groups g
    where not exists (select 1 from public.group_backups b where b.group_id = g.id and b.version = g.version);

  delete from public.group_backups b
    using (select x.group_id, x.taken_at,
                  row_number() over (partition by x.group_id order by x.taken_at desc) as rn
           from public.group_backups x) old
    where b.group_id = old.group_id and b.taken_at = old.taken_at and old.rn > 48;

  delete from public.group_backups b
    where b.taken_at < now() - interval '30 days'
      and not exists (select 1 from public.groups g where g.id = b.group_id);
end;
$$;
revoke execute on function public.backup_groups() from public, anon, authenticated;

-- Seznam záloh skupiny (jen pro člena).
create or replace function public.list_backups(p_gid uuid)
returns table (taken_at timestamptz, entries integer)
language sql stable security definer set search_path = ''
as $$
  select b.taken_at, coalesce(jsonb_array_length(b.data -> 'entries'), 0)
  from public.group_backups b
  where b.group_id = p_gid
    and exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = auth.uid())
  order by b.taken_at desc;
$$;

-- Obsah jedné zálohy (jen pro člena).
create or replace function public.get_backup(p_gid uuid, p_taken_at timestamptz)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select b.data from public.group_backups b
  where b.group_id = p_gid and b.taken_at = p_taken_at
    and exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = auth.uid());
$$;

revoke execute on function public.list_backups(uuid), public.get_backup(uuid, timestamptz) from public, anon;
grant execute on function public.list_backups(uuid), public.get_backup(uuid, timestamptz) to authenticated;

-- Hodinový plánovač (rozšíření pg_cron je součástí Supabase). Opakované spuštění úlohu jen přepíše.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('vyrovnano-hodinova-zaloha', '0 * * * *', 'select public.backup_groups()');
-- První záloha hned teď.
select public.backup_groups();

-- Funkce smí volat jen přihlášený uživatel, nikdy anonymní návštěvník.
revoke execute on function
  public.my_groups(), public.get_group(uuid), public.group_user_ids(uuid),
  public.save_group(uuid, jsonb, integer), public.join_group(text), public.leave_group(uuid),
  public.reset_invite(uuid), public.kick_member(uuid, uuid), public.delete_account()
  from public, anon;
grant execute on function
  public.my_groups(), public.get_group(uuid), public.group_user_ids(uuid),
  public.save_group(uuid, jsonb, integer), public.join_group(text), public.leave_group(uuid),
  public.reset_invite(uuid), public.kick_member(uuid, uuid), public.delete_account()
  to authenticated;
