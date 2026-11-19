create function public.dashboard(p_tenant uuid,p_from date,p_to date) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare tz text; result jsonb;
begin
 if not can_access(p_tenant) then raise exception 'Sem acesso'; end if;
 if p_from is null or p_to is null or p_to-p_from not between 0 and 366 then raise exception 'Período inválido';end if;
 select timezone into strict tz from tenants where id=p_tenant;
 with days as (select generate_series(p_from::timestamp,p_to::timestamp,'1 day')::date d),
 a as (select *, (starts_at at time zone tz)::date d from appointments where tenant_id=p_tenant and starts_at>=p_from::timestamp at time zone tz and starts_at<(p_to+1)::timestamp at time zone tz),
 cash as (select (created_at at time zone tz)::date d,sum(case kind when 'payment' then amount_cents when 'refund' then -amount_cents else 0 end) received from payments where tenant_id=p_tenant and created_at>=p_from::timestamp at time zone tz and created_at<(p_to+1)::timestamp at time zone tz group by 1),
 series as (select days.d,coalesce(received,0) received,coalesce(spent,0) spent from days left join cash using(d) left join (select paid_on d,sum(amount_cents) spent from expenses where tenant_id=p_tenant and paid_on between p_from and p_to group by paid_on) ex using(d))
 select jsonb_build_object('financial',can_manage(p_tenant) and has_feature(p_tenant,'finance'),'bookings',(select count(*) from a),'customers',(select count(distinct customer_id) from a where status='completed'),'forecast',(select coalesce(sum(price_cents),0) from a where status in ('pending','confirmed','in_progress')),'received',(select sum(received) from series),'spent',(select sum(spent) from series),'series',(select jsonb_agg(to_jsonb(series) order by d) from series),'ranking',coalesce((select jsonb_agg(to_jsonb(top_services)) from (select s.name,count(*) n from a join services s on s.id=a.service_id where a.status not in ('cancelled','no_show') group by s.id,s.name order by n desc,s.name limit 5) top_services),'[]'::jsonb),'status',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from a group by status) counts),'{}'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.dashboard(uuid,date,date) from public,anon;
grant execute on function public.dashboard(uuid,date,date) to authenticated;
