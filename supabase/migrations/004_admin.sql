begin;
create table private.access_invites(
 tenant_id uuid references public.tenants on delete cascade, email text not null, role text not null check(role in ('admin','owner','staff')),
 expires_at timestamptz not null, primary key(tenant_id,email));
alter table public.subscriptions add column asaas_id text unique;
create table private.asaas_receipts(payment_id text primary key, tenant_id uuid not null references public.tenants, amount_cents integer not null, refunded boolean not null default false);

create function private.require_platform() returns void language plpgsql set search_path='' as $$
begin if not public.is_superadmin() then raise exception 'Acesso exclusivo da plataforma' using errcode='42501'; end if; end $$;

create function public.platform_create_company(p_name text,p_slug text,p_plan uuid,p_email text) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid; days integer;
begin perform private.require_platform();
 if p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'E-mail inválido'; end if;
 select trial_days into strict days from public.subscription_plans where id=p_plan and active;
 insert into public.tenants(name,slug) values(trim(p_name),lower(trim(p_slug))) returning id into t;
 insert into public.subscriptions(tenant_id,plan_id,period_end) values(t,p_plan,now()+make_interval(days=>days));
 insert into private.access_invites values(t,lower(trim(p_email)),'owner',now()+interval '7 days');
 return t; end $$;

create function public.platform_invite(t uuid,p_email text,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 if p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'E-mail inválido'; end if;
 insert into private.access_invites values(t,lower(trim(p_email)),p_role,now()+interval '7 days') on conflict(tenant_id,email) do update set role=excluded.role,expires_at=excluded.expires_at;
 insert into public.audit_logs(tenant_id,actor_id,action) values(t,auth.uid(),'access.invite');end $$;

create function public.accept_platform_invites() returns void language plpgsql security definer set search_path='' as $$
declare mail text; item record; lim int;
begin select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 for item in select * from private.access_invites where email=mail and expires_at>now() order by tenant_id for update loop
 perform 1 from public.tenants where id=item.tenant_id for update;
 select (p.limits->>'users')::integer into lim from public.subscriptions s join public.subscription_plans p on s.plan_id=p.id where s.tenant_id=item.tenant_id;
 if lim is not null and (select count(*) from public.tenant_memberships where tenant_id=item.tenant_id and active and user_id<>auth.uid())>=lim then raise exception 'Limite de usuários do plano atingido';end if;
 insert into public.tenant_memberships values(item.tenant_id,auth.uid(),item.role,true) on conflict (tenant_id,user_id) do update set role=excluded.role,active=true;
 delete from private.access_invites where tenant_id=item.tenant_id and email=mail;
 insert into public.audit_logs(tenant_id,actor_id,action) values(item.tenant_id,auth.uid(),'access.activated');
 end loop; end $$;

create function public.platform_subscription(t uuid,p_name text,p_plan uuid,p_status text,p_end timestamptz,p_asaas text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 update public.tenants set name=p_name,status=p_status where id=t;
 update public.subscriptions set plan_id=p_plan,status=case when p_status='blocked' then 'suspended' else p_status end,period_end=p_end,asaas_id=nullif(trim(p_asaas),'') where tenant_id=t;
end $$;
create function public.platform_plan(p_id uuid,p_name text,p_month int,p_year int,p_days int,p_active boolean,p_limits jsonb,p_features jsonb) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 if jsonb_typeof(p_limits)<>'object' or jsonb_typeof(p_features)<>'object' or (p_limits?'users' and coalesce(p_limits->>'users','') !~ '^[1-9][0-9]{0,5}$') then raise exception 'Configuração de plano inválida';end if;
 insert into public.subscription_plans(id,name,monthly_cents,annual_cents,trial_days,active,limits,features)
 values(coalesce(p_id,gen_random_uuid()),p_name,p_month,p_year,p_days,p_active,p_limits,p_features)
 on conflict(id) do update set name=excluded.name,monthly_cents=excluded.monthly_cents,annual_cents=excluded.annual_cents,trial_days=excluded.trial_days,active=excluded.active,limits=excluded.limits,features=excluded.features;
 insert into public.audit_logs(actor_id,action) values(auth.uid(),'plan.saved'); end $$;

create function public.platform_member(t uuid,p_user uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 perform 1 from public.tenants where id=t for update;
 if (not p_active or p_role<>'owner') and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=p_user and active and role='owner') and not exists(select 1 from public.tenant_memberships where tenant_id=t and user_id<>p_user and active and role='owner') then raise exception 'Mantenha ao menos um proprietário ativo';end if;
 update public.tenant_memberships set role=p_role,active=p_active where tenant_id=t and user_id=p_user;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,auth.uid(),'access.updated',p_user::text);end $$;

create function public.asaas_event(p_event text,p_kind text,p_subscription text,p_payment text,p_cents int,p_due date) returns void language plpgsql security definer set search_path='' as $$
declare sub public.subscriptions; receipt private.asaas_receipts; recorded integer:=0;
begin
 select * into strict sub from public.subscriptions where asaas_id=p_subscription for update;
 if exists(select 1 from public.billing_events where provider='asaas' and event_id=p_event) then return;end if;
 select * into receipt from private.asaas_receipts where payment_id=p_payment;
 if p_kind='PAYMENT_RECEIVED' and receipt.payment_id is null then
 insert into private.asaas_receipts(payment_id,tenant_id,amount_cents) values(p_payment,sub.tenant_id,p_cents); recorded:=p_cents;
 if sub.status in ('active','trial','overdue') then
 update public.subscriptions set status='active',period_end=greatest(period_end,(p_due+interval '1 month') at time zone 'America/Sao_Paulo') where tenant_id=sub.tenant_id;
 update public.tenants set status='active' where id=sub.tenant_id and status in ('active','overdue','trial');
 end if;
 elsif p_kind='PAYMENT_REFUNDED' then
 if receipt.payment_id is null then raise exception 'Aguardando recebimento correspondente';end if;
 if not receipt.refunded then update private.asaas_receipts set refunded=true where payment_id=p_payment; recorded:=-receipt.amount_cents;end if;
 elsif p_kind='PAYMENT_OVERDUE' and receipt.payment_id is null and sub.period_end<=now() and sub.status in ('active','trial') then
 update public.subscriptions set status='overdue' where tenant_id=sub.tenant_id;
 update public.tenants set status='overdue' where id=sub.tenant_id and status in ('active','trial'); end if;
 insert into public.billing_events(tenant_id,provider,event_id,amount_cents,event_type) values(sub.tenant_id,'asaas',p_event,recorded,p_kind);
end $$;
create function public.platform_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.require_platform();
return jsonb_build_object('companies',(select count(*) from public.tenants),'trials',(select count(*) from public.subscriptions where status='trial' and period_end>now()),'active',(select count(*) from public.subscriptions where status='active' and period_end>now()),'overdue',(select count(*) from public.subscriptions where status='overdue' or (status in ('active','trial') and period_end<=now())),'suspended',(select count(*) from public.subscriptions where status='suspended'),'cancelled',(select count(*) from public.subscriptions where status='cancelled'),'mrr',(select coalesce(sum(p.monthly_cents),0) from public.subscriptions s join public.subscription_plans p on p.id=s.plan_id where s.status='active' and s.period_end>now()),'received',(select coalesce(sum(amount_cents),0) from public.billing_events),'users',(select count(distinct user_id) from public.tenant_memberships where active),'appointments',(select count(*) from public.appointments));
end $$;
do $$declare r record;begin
 for r in select oid::regprocedure as f,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'platform_%' or proname in ('asaas_event','accept_platform_invites')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.f);
 execute format('grant execute on function %s to %I',r.f,case when r.proname='asaas_event' then 'service_role' else 'authenticated' end);end loop;end $$;
commit;
