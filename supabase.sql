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
