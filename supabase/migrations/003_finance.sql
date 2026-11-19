create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  appointment_id uuid not null,
  amount_cents bigint not null check(amount_cents between 1 and 99999999999),
  kind text not null check(kind in ('payment','refund','discount')),
  method text not null check(method in ('PIX','Dinheiro','Cartão de crédito','Cartão de débito','Transferência','Outros')),
  created_at timestamptz not null default now(),
  request_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  unique(tenant_id,request_id),
  foreign key(tenant_id,appointment_id) references public.appointments(tenant_id,id)
);
create index payments_dates on public.payments(tenant_id,created_at);
create index payments_balance on public.payments(tenant_id,appointment_id);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  description text not null check(length(trim(description)) between 1 and 200),
  category text not null check(length(trim(category)) between 1 and 80),
  amount_cents bigint not null check(amount_cents between 1 and 99999999999),
  due_date date not null,
  paid_on date,
  method text check(method in ('PIX','Dinheiro','Cartão de crédito','Cartão de débito','Transferência','Outros')),
  created_at timestamptz not null default now(),
  request_id uuid not null,
  unique(tenant_id,request_id),
  check((paid_on is null) = (method is null))
);
create index expenses_dates on public.expenses(tenant_id,due_date,paid_on);
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
revoke all on public.payments,public.expenses from anon,authenticated;
grant select on public.payments,public.expenses to authenticated;
create policy financial_receipts on public.payments for select to authenticated using(public.can_manage(tenant_id) and public.has_feature(tenant_id,'finance'));
create policy financial_expenses on public.expenses for select to authenticated using(public.can_manage(tenant_id) and public.has_feature(tenant_id,'finance'));

create function public.record_payment(p_tenant uuid,p_booking uuid,p_amount bigint,p_kind text,p_method text,p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare previous public.payments; booking public.appointments; received bigint; discounted bigint; inserted uuid;
begin
 if not (public.can_manage(p_tenant) and public.has_feature(p_tenant,'finance')) then raise exception 'Sem permissão'; end if;
 select * into strict booking from public.appointments where tenant_id=p_tenant and id=p_booking for update;
 select * into previous from public.payments where tenant_id=p_tenant and request_id=p_request;
 if found then
   if (previous.appointment_id,previous.amount_cents,previous.kind,previous.method) is distinct from (p_booking,p_amount,p_kind,p_method) then raise exception 'Solicitação já utilizada'; end if;
   return previous.id;
 end if;
 select coalesce(sum(case kind when 'payment' then amount_cents when 'refund' then -amount_cents end),0),
 coalesce(sum(amount_cents) filter(where kind='discount'),0) into received,discounted
 from public.payments where tenant_id=p_tenant and appointment_id=p_booking;
 if p_kind='refund' and p_amount>received then raise exception 'Estorno superior ao recebido'; end if;
 if p_kind in ('payment','discount') and booking.price_cents is not null and received+discounted+p_amount>booking.price_cents then raise exception 'Valor superior ao saldo do atendimento'; end if;
 insert into public.payments(tenant_id,appointment_id,amount_cents,kind,method,request_id,actor_id)
 values(p_tenant,p_booking,p_amount,p_kind,p_method,p_request,auth.uid()) returning id into inserted;
 return inserted;
end $$;

create function public.record_expense(p_tenant uuid,p_description text,p_category text,p_amount bigint,p_due date,p_paid date,p_method text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare inserted uuid; previous public.expenses;
begin
 if not (public.can_manage(p_tenant) and public.has_feature(p_tenant,'finance')) then raise exception 'Sem permissão'; end if;
 insert into public.expenses(tenant_id,description,category,amount_cents,due_date,paid_on,method,request_id)
 values(p_tenant,trim(p_description),trim(p_category),p_amount,p_due,p_paid,p_method,p_request)
 on conflict(tenant_id,request_id) do nothing returning id into inserted;
 if inserted is null then
   select * into strict previous from public.expenses where tenant_id=p_tenant and request_id=p_request;
   if (previous.description,previous.category,previous.amount_cents,previous.due_date,previous.paid_on,previous.method)
    is distinct from (trim(p_description),trim(p_category),p_amount,p_due,p_paid,p_method) then raise exception 'Solicitação já utilizada'; end if;
   return previous.id;
 end if;
 return inserted;
end $$;

create function public.settle_expense(p_tenant uuid,p_id uuid,p_date date,p_method text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not (public.can_manage(p_tenant) and public.has_feature(p_tenant,'finance')) then raise exception 'Sem permissão'; end if;
 if p_date is null or p_method is null then raise exception 'Informe data e meio de pagamento'; end if;
 update public.expenses set paid_on=p_date,method=p_method where tenant_id=p_tenant and id=p_id and paid_on is null;
 if not found then raise exception 'Despesa indisponível para baixa'; end if;
end $$;
revoke all on function public.record_payment(uuid,uuid,bigint,text,text,uuid),public.record_expense(uuid,text,text,bigint,date,date,text,uuid),public.settle_expense(uuid,uuid,date,text) from public,anon;
grant execute on function public.record_payment(uuid,uuid,bigint,text,text,uuid),public.record_expense(uuid,text,text,bigint,date,date,text,uuid),public.settle_expense(uuid,uuid,date,text) to authenticated;
create trigger logged after insert on public.payments for each row execute function private.record_change();
create trigger logged after insert or update on public.expenses for each row execute function private.record_change();
create table public.commissions(
 tenant_id uuid not null references public.tenants,appointment_id uuid primary key,
 professional_id uuid not null,rate numeric(5,2) not null check(rate between 0 and 100),amount_cents bigint not null,
 earned_at timestamptz not null default now(),
 foreign key(tenant_id,appointment_id) references public.appointments(tenant_id,id),
 foreign key(tenant_id,professional_id) references public.professionals(tenant_id,id)
);
alter table public.commissions enable row level security;
revoke all on public.commissions from anon,authenticated;
grant select on public.commissions to authenticated;
create policy commissions_read on public.commissions for select to authenticated using(public.can_manage(tenant_id) and public.has_feature(tenant_id,'finance'));
create function private.earn_commission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and new.price_cents is not null then
 insert into public.commissions(tenant_id,appointment_id,professional_id,rate,amount_cents)
 select new.tenant_id,new.id,p.id,p.commission_percent,round(new.price_cents*p.commission_percent/100)
 from public.professionals p where p.tenant_id=new.tenant_id and p.id=new.professional_id and p.commission_percent>0
 on conflict(appointment_id) do nothing;
 elsif new.status<>'completed' then delete from public.commissions where appointment_id=new.id; end if;
 return null;
end $$;
create trigger commission_on_completion after insert or update of status on public.appointments for each row execute function private.earn_commission();
-- Recurring obligations are materialized in one transaction, including future
-- unpaid installments. Each due date is calculated from the original date.
create table public.expense_series (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),request_id uuid not null,
 frequency text not null check(frequency in ('weekly','monthly','yearly')), occurrences int not null check(occurrences between 2 and 120),
 request_payload jsonb not null,unique(tenant_id,request_id),unique(tenant_id,id)
);
alter table public.expense_series enable row level security;
revoke all on public.expense_series from anon,authenticated;
grant select on public.expense_series to authenticated;
create policy read_series on public.expense_series for select to authenticated using(public.can_manage(tenant_id) and public.has_feature(tenant_id,'finance'));
alter table public.expenses add column series_id uuid,add column installment smallint,
 add foreign key(tenant_id,series_id) references public.expense_series(tenant_id,id),
 add check((series_id is null)=(installment is null)),add unique(series_id,installment);

create function public.record_expense_series(p_tenant uuid,p_description text,p_category text,p_amount bigint,p_due date,p_paid date,p_method text,p_request uuid,p_frequency text,p_occurrences int)
returns uuid language plpgsql security definer set search_path='' as $$
declare series uuid; stored public.expense_series; payload jsonb; step interval;
begin
 if not (public.can_manage(p_tenant) and public.has_feature(p_tenant,'finance')) then raise exception 'Sem permissão'; end if;
 payload:=jsonb_build_array(trim(p_description),trim(p_category),p_amount,p_due,p_paid,p_method,p_frequency,p_occurrences);
 insert into public.expense_series(tenant_id,request_id,frequency,occurrences,request_payload)
 values(p_tenant,p_request,p_frequency,p_occurrences,payload) on conflict(tenant_id,request_id) do nothing returning id into series;
 if series is null then
  select * into strict stored from public.expense_series where tenant_id=p_tenant and request_id=p_request;
  if stored.request_payload<>payload then raise exception 'Solicitação já utilizada'; end if;
  return stored.id;
 end if;
 step:=case p_frequency when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' else interval '1 year' end;
 insert into public.expenses(tenant_id,description,category,amount_cents,due_date,paid_on,method,request_id,series_id,installment)
 select p_tenant,trim(p_description),trim(p_category),p_amount,(p_due+i*step)::date,case when i=0 then p_paid end,case when i=0 then p_method end,gen_random_uuid(),series,i+1
 from generate_series(0,p_occurrences-1) i;
 return series;
end $$;
revoke all on function public.record_expense_series(uuid,text,text,bigint,date,date,text,uuid,text,int) from public,anon;
grant execute on function public.record_expense_series(uuid,text,text,bigint,date,date,text,uuid,text,int) to authenticated;

create function public.financial_report(p_tenant uuid,p_start date,p_end date)
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
  from appointments a join customers c on c.id=a.customer_id join services s on s.id=a.service_id join professionals p on p.id=a.professional_id
  left join payments v on v.appointment_id=a.id and v.created_at<last_instant
  where a.tenant_id=p_tenant and a.starts_at>=first_instant and a.starts_at<last_instant
  group by a.id,c.name,s.name,p.name
 ), entries as (
  select v.id,v.created_at at time zone tz local_time,v.kind,v.method,v.amount_cents,
   s.name service,p.name professional,c.name customer
  from payments v join appointments a on a.id=v.appointment_id join customers c on c.id=a.customer_id
  join services s on s.id=a.service_id join professionals p on p.id=a.professional_id
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

