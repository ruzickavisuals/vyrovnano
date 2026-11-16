-- Jednorázově: vlastní kategorie ve třech skupinách a zpětné zařazení záznamů podle klíčových slov.
create temp table _r (grp text, cat text, n int);
do $$
declare
  cfg jsonb := '[
    {"id": "322b1273-29d1-4f8d-ba1d-704037ab55c0",
     "cats": [
       {"id": "kcestavasek", "e": "🚙", "n": "Cesta Vašek", "k": ["auto vašek", "cesta vašek"]},
       {"id": "kcestafilip", "e": "🚗", "n": "Cesta Filip", "k": ["auto filip", "cesta filip"]},
       {"id": "ktiskfotek", "e": "🖨️", "n": "Tisk fotek", "k": ["tisk", "fotky", "foto papír"]},
       {"id": "kfotokoutek", "e": "📸", "n": "Fotokoutek", "k": ["fotobudk", "nebudk", "fotokout"]},
       {"id": "kbalicek", "e": "📦", "n": "Balíček", "k": ["balíč"]}],
     "rules": [["kcestavasek", "\\m(auto|cesta) vasek"], ["kcestafilip", "\\m(auto|cesta) filip"],
               ["ktiskfotek", "\\m(tisk|fotky|foto papir)"], ["kfotokoutek", "\\m(fotobudk|nebudk|fotokout)"],
               ["kbalicek", "\\mbalic"], ["deposit", "\\m(zaloh|kauc)"], ["wedding", "^(svatb|cash\\M)"]]},
    {"id": "4e659d8b-ec60-4e09-abfa-b0b71f3c995a",
     "cats": [
       {"id": "kstudio", "e": "📸", "n": "Studio", "k": ["studio", "ateli"]},
       {"id": "kprojektyfa", "e": "🎬", "n": "Projekty FA", "k": ["fa"]}],
     "rules": [["kprojektyfa", "\\mfa\\M"], ["kstudio", "\\m(studio\\M|ateli)"], ["deposit", "\\m(zaloh|kauc)"]]},
    {"id": "21eb9626-c416-4094-b630-168d153b7b87",
     "cats": [],
     "rules": [["deposit", "\\m(zaloh|kauc)"]]}
  ]';
  c jsonb; g record; e jsonb; r jsonb; out jsonb; t text; hit text; moved int;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  d jsonb;
begin
  for c in select * from jsonb_array_elements(cfg) loop
    select * into g from public.groups where id = (c ->> 'id')::uuid for update;
    if not found then insert into _r values (c ->> 'id', 'SKUPINA NENALEZENA', 0); continue; end if;
    out := '[]'::jsonb; moved := 0;
    for e in select val from jsonb_array_elements(g.data -> 'entries') with ordinality as x(val, ord) order by ord loop
      hit := null;
      if e ->> 'kind' is distinct from 'transfer' then
        t := lower(translate(coalesce(e ->> 'title', ''), 'áäčďéěíňóöřšťúůüýžÁÄČĎÉĚÍŇÓÖŘŠŤÚŮÜÝŽ', 'aacdeeinoorstuuuyzaacdeeinoorstuuuyz'));
        for r in select * from jsonb_array_elements(c -> 'rules') loop
          if t ~ (r ->> 1) then hit := r ->> 0; exit; end if;
        end loop;
      end if;
      if hit is not null and (e ->> 'category') is distinct from hit then
        e := e || jsonb_build_object('category', hit, 'u', now_ms);
        moved := moved + 1;
        insert into _r values (g.data ->> 'name', hit, 1);
      end if;
      out := out || jsonb_build_array(e);
    end loop;
    d := jsonb_set(g.data, '{entries}', out);
    if jsonb_array_length(c -> 'cats') > 0 then
      d := jsonb_set(d, '{cats}', c -> 'cats');
      d := jsonb_set(d, '{mu}', to_jsonb(now_ms));
    end if;
    if moved > 0 or jsonb_array_length(c -> 'cats') > 0 then
      d := jsonb_set(d, '{log}', coalesce(d -> 'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', 'lkat' || substr(md5(g.id::text), 1, 10), 't', now_ms, 'n', 'Automaticky', 'a', 'group',
        'text', 'kategorie podle klíčových slov: zpětně zařazeno ' || moved || ' záznamů')));
      update public.groups set data = d, version = version + 1, updated_at = now() where id = g.id;
    end if;
    insert into _r values (g.data ->> 'name', '= celkem přesunuto', moved);
  end loop;
end $$;
select grp, cat, sum(n) as n from _r group by 1, 2 order by 1, 2;
