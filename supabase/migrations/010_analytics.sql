create index working_hours_week on public.working_hours(tenant_id,weekday,professional_id);
create index working_hours_person on public.working_hours(professional_id,weekday) where professional_id is not null;
create index blocked_times_period on public.blocked_times(tenant_id,starts_at,ends_at);
create index appointments_person_date on public.appointments(tenant_id,professional_id,starts_at);
-- Occupancy uses the union of actual working intervals per active professional.
create function public.analytics(p_tenant uuid,p_from date,p_to date) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare tz text; today date; report jsonb;
begin
 if not can_access(p_tenant) then raise exception 'Acesso negado'; end if;
 if p_from is null or p_to is null or p_to-p_from not between 0 and 366 then raise exception 'Período inválido'; end if;
 select timezone into strict tz from tenants where id=p_tenant;
 today:=(now() at time zone tz)::date;
 with days as (select generate_series(p_from::timestamp,p_to::timestamp,interval '1 day')::date as day),
 capacity as (
 select d.day,p.id,
 coalesce(shop.r,'{}'::tstzmultirange) * (case when custom.defined then coalesce(worker.r,'{}'::tstzmultirange) else coalesce(shop.r,'{}'::tstzmultirange) end)
 - coalesce(blocked.r,'{}'::tstzmultirange) open_ranges,
 coalesce(booked.r,'{}'::tstzmultirange) occupied_ranges
 from days d cross join professionals p
 cross join lateral (select range_agg(tstzrange((d.day+w.opens_at) at time zone tz,(d.day+w.closes_at) at time zone tz)) r from working_hours w where w.tenant_id=p_tenant and professional_id is null and weekday=extract(dow from d.day)) shop
 cross join lateral (select exists(select from working_hours where tenant_id=p_tenant and professional_id=p.id) defined) custom
 cross join lateral (select range_agg(tstzrange((d.day+w.opens_at) at time zone tz,(d.day+w.closes_at) at time zone tz)) r from working_hours w where w.professional_id=p.id and weekday=extract(dow from d.day)) worker
 cross join lateral (select range_agg(tstzrange(b.starts_at,b.ends_at)) r from blocked_times b where b.tenant_id=p_tenant and (b.professional_id is null or b.professional_id=p.id) and b.starts_at<(d.day+1)::timestamp at time zone tz and b.ends_at>d.day::timestamp at time zone tz) blocked
 cross join lateral (select range_agg(tstzrange(a.starts_at,a.busy_until)) r from appointments a where a.tenant_id=p_tenant and a.professional_id=p.id and a.status not in ('cancelled','no_show') and a.starts_at<(d.day+1)::timestamp at time zone tz and a.busy_until>d.day::timestamp at time zone tz) booked
 where p.tenant_id=p_tenant and p.active),
 usage as (select sum((select sum(extract(epoch from upper(r)-lower(r))) from unnest(open_ranges) r)) available,
 sum((select sum(extract(epoch from upper(r)-lower(r))) from unnest(open_ranges*occupied_ranges) r)) occupied from capacity),
 selected as (select * from appointments where tenant_id=p_tenant and starts_at>=p_from::timestamp at time zone tz and starts_at<(p_to+1)::timestamp at time zone tz),
 cash as (select p.*, (p.created_at at time zone tz)::date as day,case p.kind when 'payment' then p.amount_cents when 'refund' then -p.amount_cents else 0 end net from payments p where p.tenant_id=p_tenant and p.created_at>=least(date_trunc('year',p_to::timestamp)::date,p_from-(p_to-p_from+1),date_trunc('month',today::timestamp)::date)::timestamp at time zone tz and p.created_at<(greatest(p_to,today)+1)::timestamp at time zone tz),
 totals as (select count(*) filter(where (starts_at at time zone tz)::date=today) day_count,count(*) filter(where date_trunc('week',starts_at at time zone tz)=date_trunc('week',today::timestamp)) week_count,count(*) filter(where date_trunc('month',starts_at at time zone tz)=date_trunc('month',today::timestamp)) month_count from appointments where tenant_id=p_tenant and starts_at>=least(date_trunc('week',today::timestamp),date_trunc('month',today::timestamp)) at time zone tz and starts_at<greatest(date_trunc('week',today::timestamp)+interval '1 week',date_trunc('month',today::timestamp)+interval '1 month') at time zone tz),
 previous as (select count(*) bookings from appointments where tenant_id=p_tenant and starts_at>=(p_from-(p_to-p_from+1))::timestamp at time zone tz and starts_at<p_from::timestamp at time zone tz)
 select jsonb_build_object(
 'financial',can_manage(p_tenant) and has_feature(p_tenant,'finance'),
 'counts',(select to_jsonb(totals) from totals),'timezone',tz,
 'totalCustomers',(select count(*) from customers where tenant_id=p_tenant),
 'occupancy',(select round(coalesce(occupied,0)*100/nullif(available,0),1) from usage),
 'cancelRate',(select round(100.0*count(*) filter(where status='cancelled')/nullif(count(*),0),1) from selected),
 'ticket',(select round(sum(net)/nullif(count(distinct appointment_id) filter(where kind='payment'),0)) from cash where day between p_from and p_to),
 'dayCash',(select coalesce(sum(net),0) from cash where day=today),
 'monthCash',(select coalesce(sum(net),0) from cash where date_trunc('month',day::timestamp)=date_trunc('month',today::timestamp)),
 'comparison',jsonb_build_array(jsonb_build_object('name','Anterior','count',(select bookings from previous),'cash',(select coalesce(sum(net),0) from cash where day between p_from-(p_to-p_from+1) and p_from-1)),jsonb_build_object('name','Atual','count',(select count(*) from selected),'cash',(select coalesce(sum(net),0) from cash where day between p_from and p_to))),
 'monthly',(select jsonb_agg(jsonb_build_object('name',to_char(m,'MM/YYYY'),'cash',coalesce((select sum(net) from cash where day between m::date and least(p_to,(m+interval '1 month')::date-1)),0)) order by m) from generate_series(date_trunc('year',p_to::timestamp),date_trunc('month',p_to::timestamp),interval '1 month') m),
 'hours',coalesce((select jsonb_agg(to_jsonb(x) order by name) from(select to_char(starts_at at time zone tz,'HH24"h"') name,count(*) count from selected where status not in ('cancelled','no_show') group by 1)x),'[]'),
 'team',coalesce((select jsonb_agg(to_jsonb(x) order by count desc,name) from(select p.name,(select count(*) from selected a where a.professional_id=p.id and a.status='completed') count,(select coalesce(sum(c.net),0) from cash c join appointments a on a.id=c.appointment_id where a.professional_id=p.id and day between p_from and p_to) cash from professionals p where p.tenant_id=p_tenant)x where count<>0 or cash<>0),'[]'),
 'expenses',coalesce((select jsonb_agg(to_jsonb(x) order by cash desc) from(select category name,sum(amount_cents) cash from expenses where tenant_id=p_tenant and paid_on between p_from and p_to group by category)x),'[]')
 ) into report;
 return report;
end $$;
revoke all on function public.analytics(uuid,date,date) from public,anon;
grant execute on function public.analytics(uuid,date,date) to authenticated;
