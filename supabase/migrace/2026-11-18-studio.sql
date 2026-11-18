-- Vyrovnáno – příjem záznamů z THEVISUALS Studia (18. 11. 2026).
-- Studio po zapsání platby od klienta pošle do jedné určené skupiny příjem s přesným rozdělením.
-- Prokazuje se vlastním klíčem; v databázi je jen jeho otisk (SHA-256) a ID skupiny, do které smí:
--   insert into public.app_secrets (name, value) values ('studio', jsonb_build_object('hash', '<otisk>', 'group_id', '<id skupiny>'));
-- Funkce umí jen přidat, přepsat a smazat záznamy s ID „studio-…“ v té jedné skupině. Jiných záznamů,
-- členů ani jiných skupin se nedotkne. Vrací členy a kategorie skupiny, aby Studio vědělo, komu co patří.
create or replace function public.studio_sync(p_key text, p_ops jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s jsonb;
  gid uuid;
  d jsonb;
  entries jsonb;
  dead jsonb;
  member_ids text[];
  op jsonb;
  eid text;
  old jsonb;
  parts jsonb;
  amount bigint;
  changed integer := 0;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  select a.value into s from public.app_secrets a where a.name = 'studio';
  if s is null or length(coalesce(p_key, '')) < 40
     or coalesce(s->>'hash', '') <> encode(sha256(convert_to(p_key, 'UTF8')), 'hex') then
    raise exception 'unauthorized';
  end if;
  gid := (s->>'group_id')::uuid;
  select g.data into d from public.groups g where g.id = gid for update;
  if d is null then raise exception 'group not found'; end if;

  entries := coalesce(d->'entries', '[]'::jsonb);
  dead := coalesce(d->'dead', '{}'::jsonb);
  select coalesce(array_agg(m->>'id'), '{}') into member_ids from jsonb_array_elements(coalesce(d->'members', '[]'::jsonb)) m;

  if jsonb_typeof(p_ops) = 'array' then
    if jsonb_array_length(p_ops) > 200 then raise exception 'too many operations'; end if;
    for op in select * from jsonb_array_elements(p_ops) loop
      eid := op->>'id';
      if eid is null or eid !~ '^studio-[a-z0-9-]{1,32}$' then raise exception 'bad id'; end if;
      select x into old from jsonb_array_elements(entries) x where x->>'id' = eid limit 1;

      if op->>'op' = 'delete' then
        if old is not null then
          select coalesce(jsonb_agg(x), '[]'::jsonb) into entries from jsonb_array_elements(entries) x where x->>'id' <> eid;
          dead := dead || jsonb_build_object(eid, now_ms);
          changed := changed + 1;
        end if;
        continue;
      end if;

      amount := (op->>'amount')::bigint;
      if amount is null or amount <= 0 or amount > 100000000000 then raise exception 'bad amount'; end if;
      if not (op->>'paidBy' = any(member_ids)) then raise exception 'unknown member'; end if;
      if coalesce(op->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad date'; end if;
      -- Podíly: jen členové skupiny, jen kladná celá čísla, dohromady přesně celá částka.
      select coalesce(jsonb_object_agg(p.key, (p.value)::bigint), '{}'::jsonb) into parts
        from jsonb_each_text(coalesce(op->'parts', '{}'::jsonb)) p
        where p.key = any(member_ids) and (p.value)::bigint > 0;
      if (select coalesce(sum((p.value)::bigint), 0) from jsonb_each_text(parts) p) <> amount then raise exception 'parts do not add up'; end if;

      -- Beze změny se nic nepřepisuje, aby zbytečně nerostla verze skupiny.
      if old is not null and old->>'title' = left(coalesce(op->>'title', ''), 120) and (old->>'amount')::bigint = amount
         and old->>'paidBy' = op->>'paidBy' and old->'parts' = parts and old->>'date' = op->>'date'
         and old->>'category' = left(coalesce(op->>'category', 'other'), 20) then
        continue;
      end if;

      select coalesce(jsonb_agg(x), '[]'::jsonb) into entries from jsonb_array_elements(entries) x where x->>'id' <> eid;
      entries := entries || jsonb_build_array(jsonb_build_object(
        'id', eid, 'kind', 'income', 'title', left(coalesce(op->>'title', ''), 120), 'amount', amount,
        'currency', 'CZK', 'rate', 1, 'paidBy', op->>'paidBy', 'mode', 'exact', 'parts', parts,
        'category', left(coalesce(op->>'category', 'other'), 20), 'date', op->>'date',
        'u', now_ms, 'c', coalesce((old->>'c')::bigint, now_ms)));
      changed := changed + 1;
    end loop;
  end if;

  if changed > 0 then
    d := jsonb_set(jsonb_set(d, '{entries}', entries), '{dead}', dead);
    if pg_column_size(d) > 1000000 then raise exception 'group too large'; end if;
    update public.groups g set data = d, version = g.version + 1, updated_at = now() where g.id = gid;
  end if;

  return jsonb_build_object(
    'group', d->>'name',
    'changed', changed,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', m->>'id', 'name', m->>'name')), '[]'::jsonb) from jsonb_array_elements(coalesce(d->'members', '[]'::jsonb)) m),
    'cats', (select coalesce(jsonb_agg(jsonb_build_object('id', c->>'id', 'name', c->>'n')), '[]'::jsonb) from jsonb_array_elements(coalesce(d->'cats', '[]'::jsonb)) c),
    'entries', (select coalesce(jsonb_agg(x->>'id'), '[]'::jsonb) from jsonb_array_elements(entries) x where x->>'id' like 'studio-%'));
end;
$$;
revoke execute on function public.studio_sync(text, jsonb) from public;
grant execute on function public.studio_sync(text, jsonb) to anon, authenticated;
