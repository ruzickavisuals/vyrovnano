create or replace function public.backup_groups()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.group_backups (group_id, version, data)
    select g.id, g.version, g.data from public.groups g
    where not exists (select 1 from public.group_backups b where b.group_id = g.id and b.version = g.version);

  -- Necháváme posledních 48 verzí každé skupiny a k tomu poslední verzi z každého dne za 30 dní zpět.
  delete from public.group_backups b
    using (select x.group_id, x.taken_at,
                  row_number() over (partition by x.group_id order by x.taken_at desc) as rn,
                  row_number() over (partition by x.group_id, (x.taken_at at time zone 'Europe/Prague')::date order by x.taken_at desc) as in_day
           from public.group_backups x) old
    where b.group_id = old.group_id and b.taken_at = old.taken_at and old.rn > 48
      and not (old.in_day = 1 and b.taken_at > now() - interval '30 days');

  delete from public.group_backups b
    where b.taken_at < now() - interval '30 days'
      and not exists (select 1 from public.groups g where g.id = b.group_id);
end;
$$;
revoke execute on function public.backup_groups() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'vyrovnano-hodinova-zaloha';
select cron.schedule('vyrovnano-zaloha', '*/15 * * * *', 'select public.backup_groups()');
select public.backup_groups();
select jobname, schedule, active from cron.job order by jobid;
