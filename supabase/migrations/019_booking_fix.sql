begin;
create table public.date_slots(tenant_id uuid not null references public.tenants on delete cascade,day date not null,times time[] not null,primary key(tenant_id,day));
alter table public.date_slots enable row level security;
grant select,insert,update,delete on public.date_slots to authenticated;
create policy manager_dates on public.date_slots for all to authenticated using(public.can_manage(tenant_id)) with check(public.can_manage(tenant_id));
create function public.effective_slots(t uuid,d date) returns table(at_time time) language sql stable security definer set search_path='' as $$
 select unnest(times) from public.date_slots where tenant_id=t and day=d
 union
 select at_time from public.daily_slots where tenant_id=t and weekday=extract(dow from d) and not exists(select from public.date_slots where tenant_id=t and day=d)
$$;
revoke all on function public.effective_slots(uuid,date) from public;
insert into public.professionals(tenant_id,name) select id,'Atendimento' from public.tenants t where not exists(select from public.professionals where tenant_id=t.id and active);
insert into public.services(tenant_id,name,duration_minutes) select id,'Atendimento',1 from public.tenants t where not exists(select from public.services where tenant_id=t.id and active);
drop function public.simple_book(text,date,time,text,text,text,uuid,uuid);
create or replace function public.simple_schedule(p_slug text,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.tenants;out jsonb;
begin
 select * into strict t from public.tenants where slug=p_slug and public.tenant_available(id);
 if p_day<(now() at time zone t.timezone)::date or p_day>(now() at time zone t.timezone)::date+60 then raise exception 'Data indisponível';end if;
 select jsonb_build_object('name',t.name,'slug',t.slug,'timezone',t.timezone,'description',cfg.description,'address',cfg.address,'logo',cfg.logo_url,'cover',cfg.cover_url,'color',cfg.brand_color,'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price_cents) order by name) from public.services where tenant_id=t.id and active),'[]'::jsonb),'slots',coalesce((select jsonb_agg(jsonb_build_object('time',to_char(d.at_time,'HH24:MI'),'busy',exists(select 1 from public.appointments a where a.tenant_id=t.id and a.status not in ('cancelled','no_show') and a.starts_at=((p_day+d.at_time) at time zone t.timezone))) order by d.at_time) from public.effective_slots(t.id,p_day) d),'[]'::jsonb))
 into out from public.tenant_settings cfg where cfg.tenant_id=t.id;
 return out;
end $$;
create or replace function public.simple_book(p_slug text,p_day date,p_time time,p_name text,p_phone text,p_notes text,p_key uuid,p_token uuid,p_service uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tenants;a uuid;c uuid;s uuid;p uuid;moment timestamptz;phone_clean text:=regexp_replace(p_phone,'[^0-9]','','g');
begin
 if length(trim(p_name)) not between 2 and 120 or length(phone_clean) not between 10 and 15 or length(coalesce(p_notes,''))>1500 or p_key is null or p_token is null or p_key=p_token then raise exception 'Dados inválidos';end if;
 select * into strict t from public.tenants where slug=p_slug and public.tenant_available(id);
 perform pg_advisory_xact_lock(hashtextextended(t.id::text,0));
 select ap.id into a from public.booking_secrets k join public.appointments ap on ap.id=k.appointment_id where k.request_key=p_key and k.token_hash=sha256(uuid_send(p_token)) and ap.tenant_id=t.id;
 if a is not null then return a;end if;
 moment:=(p_day+p_time) at time zone t.timezone;
 if moment<now()+interval '15 minutes' or p_day>(now() at time zone t.timezone)::date+60 or not exists(select 1 from public.effective_slots(t.id,p_day) where at_time=p_time) then raise exception 'Horário indisponível';end if;
 if exists(select 1 from public.appointments where tenant_id=t.id and status not in ('cancelled','no_show') and starts_at=moment) or exists(select 1 from public.blocked_times where tenant_id=t.id and starts_at<=moment and ends_at>moment) then raise exception 'Horário ocupado';end if;
 if (select count(*) from public.appointments a join public.customers c on c.id=a.customer_id where a.tenant_id=t.id and c.phone=phone_clean and a.created_at>now()-interval '1 hour')>=4 then raise exception 'Limite de reservas';end if;
 select id into strict s from public.services where tenant_id=t.id and active and (p_service is null or id=p_service) order by id limit 1;
 select id into strict p from public.professionals where tenant_id=t.id and active order by id limit 1;
 insert into public.customers(tenant_id,name,phone) values(t.id,trim(p_name),phone_clean) on conflict do nothing returning id into c;
 if c is null then select id into strict c from public.customers where tenant_id=t.id and phone=phone_clean and lower(trim(name))=lower(trim(p_name)) and email is null;end if;
 insert into public.appointments(tenant_id,service_id,professional_id,customer_id,starts_at,ends_at,busy_until,notes,price_cents) values(t.id,s,p,c,moment,moment+interval '1 minute',moment+interval '1 minute',coalesce(p_notes,''),(select price_cents from public.services where id=s)) returning id into a;
 insert into public.booking_secrets values(a,p_key,sha256(uuid_send(p_token)));
 return a;
end $$;

revoke all on function public.simple_book(text,date,time,text,text,text,uuid,uuid,uuid) from public;
grant execute on function public.simple_book(text,date,time,text,text,text,uuid,uuid,uuid) to service_role;
alter table public.payments alter column appointment_id drop not null;
alter table public.payments add column description text;
create function public.manual_receipt(t uuid,amount bigint,method text,description text,request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare item uuid;
begin
 if not public.can_manage(t) then raise exception 'Acesso negado';end if;
 if length(trim(description)) not between 1 and 200 then raise exception 'Informe a descrição';end if;
 insert into public.payments(tenant_id,amount_cents,kind,method,description,request_id,actor_id) values(t,amount,'payment',method,description,request,auth.uid()) on conflict(tenant_id,request_id) do nothing returning id into item;
 if item is null then select id into item from public.payments where tenant_id=t and request_id=request;end if;
 return item;
end $$;
revoke all on function public.manual_receipt(uuid,bigint,text,text,uuid) from public;
grant execute on function public.manual_receipt(uuid,bigint,text,text,uuid) to authenticated;
create or replace function public.financial_report(p_tenant uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare tz text; first_instant timestamptz; last_instant timestamptz; result jsonb;
begin
 if not (public.can_manage(p_tenant) and public.has_feature(p_tenant,'finance')) then raise exception 'Sem permissão para consultar o financeiro'; end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'Selecione um período de até 367 dias'; end if;
 select timezone into strict tz from tenants where id=p_tenant;
 first_instant:=p_start::timestamp at time zone tz;
 last_instant:=(p_end+1)::timestamp at time zone tz;
 with bookings as (
  select a.id,a.starts_at,a.price_cents,a.status,c.name customer,s.name service,p.name professional,
   coalesce(sum(case v.kind when 'refund' then -v.amount_cents else v.amount_cents end),0) credited,
   coalesce(sum(v.amount_cents) filter(where v.kind='discount'),0) discounted,
   coalesce(sum(case v.kind when 'payment' then v.amount_cents when 'refund' then -v.amount_cents end),0) received
  from appointments a join customers c on c.id=a.customer_id join services s on s.id=a.service_id left join professionals p on p.id=a.professional_id
  left join payments v on v.appointment_id=a.id and v.created_at<last_instant
  where a.tenant_id=p_tenant and a.starts_at>=first_instant and a.starts_at<last_instant
  group by a.id,c.name,s.name,p.name
 ), entries as (
  select v.id,v.created_at at time zone tz local_time,v.kind,v.method,v.amount_cents,
   coalesce(s.name,v.description) service,coalesce(p.name,'') professional,coalesce(c.name,'Externo') customer
  from payments v left join appointments a on a.id=v.appointment_id left join customers c on c.id=a.customer_id
  left join services s on s.id=a.service_id left join professionals p on p.id=a.professional_id
  where v.tenant_id=p_tenant and v.created_at>=first_instant and v.created_at<last_instant
 ), costs as (
 select id,description,category,amount_cents,due_date,paid_on,method,series_id,installment from expenses
 where tenant_id=p_tenant and (due_date between p_start and p_end or paid_on between p_start and p_end)
 )
 select jsonb_build_object('timezone',tz,'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by starts_at desc) from bookings b),'[]'),
 'entries',coalesce((select jsonb_agg(to_jsonb(e) order by local_time desc) from entries e),'[]'),
 'expenses',coalesce((select jsonb_agg(to_jsonb(k) order by due_date desc) from costs k),'[]'),
 'commissions',coalesce((select sum(amount_cents) from commissions where tenant_id=p_tenant and earned_at>=first_instant and earned_at<last_instant),0))
 into result;
 return result;
end $$;
revoke all on function public.financial_report(uuid,date,date) from public,anon;
grant execute on function public.financial_report(uuid,date,date) to authenticated;


commit;
