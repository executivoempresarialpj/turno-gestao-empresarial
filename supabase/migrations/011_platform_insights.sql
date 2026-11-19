begin;
create table private.subscription_history(
 id bigint generated always as identity primary key,
 tenant_id uuid not null references public.tenants on delete cascade,
 old_status text, status text not null, period_end timestamptz not null,
 plan_id uuid not null, monthly_cents bigint not null, occurred_at timestamptz not null default now()
);
create index subscription_history_period on private.subscription_history(tenant_id,occurred_at desc,id desc);
create function private.subscription_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.subscription_history(tenant_id,old_status,status,period_end,plan_id,monthly_cents)
 select new.tenant_id,case when tg_op='UPDATE' then old.status end,new.status,new.period_end,new.plan_id,p.monthly_cents
 from public.subscription_plans p where p.id=new.plan_id;
 return new;
end $$;
create trigger subscription_snapshot after insert or update of status,period_end,plan_id on public.subscriptions for each row execute function private.subscription_snapshot();
insert into private.subscription_history(tenant_id,status,period_end,plan_id,monthly_cents)
 select s.tenant_id,s.status,s.period_end,s.plan_id,p.monthly_cents from public.subscriptions s join public.subscription_plans p on s.plan_id=p.id;
create table private.platform_notes(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants on delete cascade,note text not null check(length(trim(note)) between 1 and 1000),actor_id uuid,created_at timestamptz not null default now());
create function public.platform_note(t uuid,body text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 insert into private.platform_notes(tenant_id,note,actor_id) values(t,trim(body),auth.uid());
 insert into public.audit_logs(tenant_id,actor_id,action) values(t,auth.uid(),'company.note');
end $$;
create function public.platform_insights(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;lo timestamptz:=p_from::timestamp at time zone 'America/Sao_Paulo';hi timestamptz:=(p_to+1)::timestamp at time zone 'America/Sao_Paulo';
begin perform private.require_platform();
 if p_from is null or p_to is null or p_to-p_from not between 0 and 366 then raise exception 'Período inválido';end if;
 with initial as (select distinct on(tenant_id) tenant_id,status,period_end from private.subscription_history where occurred_at<lo order by tenant_id,occurred_at desc,id desc),
 cohort as (select tenant_id from initial where status='active' and period_end>=lo),
 lost as (select distinct h.tenant_id from private.subscription_history h join cohort c using(tenant_id) where h.occurred_at>=lo and h.occurred_at<hi and h.status='cancelled'),
 usage as (select t.id,t.name,(select count(*) from public.appointments a where a.tenant_id=t.id and a.created_at>=lo and a.created_at<hi) bookings,(select count(*) from public.tenant_memberships m where m.tenant_id=t.id and m.active) members from public.tenants t),
 months as (select generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),'1 month') m),
 cash as (select date_trunc('month',created_at at time zone 'America/Sao_Paulo') m,sum(amount_cents) cents from public.billing_events where created_at>=lo and created_at<hi group by 1)
 select jsonb_build_object('cohort',(select count(*) from cohort),'lost',(select count(*) from lost),'usage',coalesce((select jsonb_agg(to_jsonb(u) order by bookings desc,name) from usage u),'[]'::jsonb),'months',(select jsonb_agg(jsonb_build_object('month',to_char(m,'MM/YYYY'),'cash',coalesce(cents,0)) order by m) from months left join cash using(m)),'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from (select t.name,p.note,p.created_at from private.platform_notes p join public.tenants t on t.id=p.tenant_id order by p.created_at desc limit 30)n),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.platform_note(uuid,text),public.platform_insights(date,date) from public,anon;
grant execute on function public.platform_note(uuid,text),public.platform_insights(date,date) to authenticated;
commit;
