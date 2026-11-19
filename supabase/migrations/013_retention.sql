begin;
create table private.platform_settings(singleton boolean primary key default true check(singleton),retention_days int not null default 90 check(retention_days between 1 and 3650));
insert into private.platform_settings default values;
create table private.tenant_retention(tenant_id uuid primary key references public.tenants on delete cascade,eligible_at timestamptz not null);
create table private.revoked_sessions(tenant_id uuid not null references public.tenants on delete cascade,user_id uuid not null references auth.users on delete cascade,session_id uuid not null,primary key(tenant_id,session_id));
create function private.member_session_valid(t uuid) returns boolean language sql stable security definer set search_path='' as $$
select not exists(select 1 from private.revoked_sessions r where r.tenant_id=t and r.user_id=auth.uid() and r.session_id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')) $$;
create or replace function public.can_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
select public.tenant_available(t) and private.member_session_valid(t) and exists(select from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active) $$;
create or replace function public.can_manage(t uuid) returns boolean language sql stable security definer set search_path='' as $$
select public.can_access(t) and exists(select from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active and role in ('owner','admin')) $$;
create function public.platform_revoke_sessions(t uuid,u uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 if not exists(select from public.tenant_memberships where tenant_id=t and user_id=u) then raise exception 'Vínculo inválido';end if;
 insert into private.revoked_sessions select t,u,id from auth.sessions where user_id=u on conflict do nothing;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,auth.uid(),'sessions.revoked',u::text);
end $$;
alter table public.billing_events alter column tenant_id drop not null,drop constraint billing_events_tenant_id_fkey,add foreign key(tenant_id) references public.tenants on delete set null;
create function public.platform_retention(t uuid,operation text,confirmation text,days int default null) returns text language plpgsql security definer set search_path='' as $$
declare company public.tenants;deadline timestamptz;status text;remote text;n int;
begin perform private.require_platform();
 if operation='configure' then
 update private.platform_settings set retention_days=days;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'retention.configured',days::text);
 return 'Prazo de retenção atualizado.';
 end if;
 select * into strict company from public.tenants where id=t for update;
 select s.status,s.asaas_id into strict status,remote from public.subscriptions s where tenant_id=t for update;
 if confirmation<>company.slug or confirmation is null then raise exception 'Confirme o identificador da empresa';end if;
 if operation='restore' then delete from private.tenant_retention where tenant_id=t;
 elsif operation in ('schedule','purge') then
 if remote is not null and status<>'cancelled' then raise exception 'Cancele a cobrança antes de excluir';end if;
 if operation='schedule' then
 select retention_days into n from private.platform_settings;
 update public.tenants set status='blocked' where id=t;
 insert into private.tenant_retention values(t,now()+make_interval(days=>n)) on conflict do nothing;
 select eligible_at into deadline from private.tenant_retention where tenant_id=t;
 elsif operation='purge' then
 select eligible_at into strict deadline from private.tenant_retention where tenant_id=t;
 if deadline>now() or company.status<>'blocked' then raise exception 'Retenção vigente ou empresa reativada';end if;
 delete from private.delivery_jobs where tenant_id=t;
 delete from public.notifications where tenant_id=t;
 delete from public.appointment_status_history where tenant_id=t;
 delete from public.booking_resources where tenant_id=t;
 delete from public.payments where tenant_id=t;
 delete from public.commissions where tenant_id=t;
 delete from public.expenses where tenant_id=t;
 delete from public.expense_series where tenant_id=t;
 delete from public.appointments where tenant_id=t;
 delete from public.customers where tenant_id=t;
 delete from private.billing_provisioning where tenant_id=t;
 delete from private.asaas_receipts where tenant_id=t;
 delete from public.tenants where id=t;
 end if;
 else raise exception 'Operação inválida';end if;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'company.retention.'||operation,t::text);
 return case operation when 'schedule' then 'Exclusão liberada a partir de '||deadline::date when 'restore' then 'Solicitação retirada. Revise o status de acesso.' else 'Empresa excluída.' end;
end $$;
revoke all on function public.platform_retention(uuid,text,text,int),public.platform_revoke_sessions(uuid,uuid) from public,anon;
grant execute on function public.platform_retention(uuid,text,text,int),public.platform_revoke_sessions(uuid,uuid) to authenticated;
commit;
