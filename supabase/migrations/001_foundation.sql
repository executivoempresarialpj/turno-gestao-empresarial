begin;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.superadmins(user_id uuid primary key references auth.users(id) on delete cascade);
create table public.subscription_plans (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name)) between 1 and 100),
 monthly_cents integer not null default 0 check(monthly_cents>=0), annual_cents integer not null default 0 check(annual_cents>=0),
 limits jsonb not null default '{}', features jsonb not null default '{}', trial_days int not null default 14 check(trial_days between 0 and 365), active boolean not null default true);
insert into public.subscription_plans(name,features,limits) values
 ('Essencial','{"agenda":true}','{"users":2}'),('Profissional','{"agenda":true,"finance":true,"reports":true}','{"users":10}'),('Premium','{"agenda":true,"finance":true,"reports":true,"integrations":true}','{}');
create table public.tenants (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 150),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug)<=80),
 timezone text not null default 'America/Sao_Paulo', status text not null default 'trial' check(status in ('trial','active','overdue','suspended','cancelled','blocked')),
 created_at timestamptz not null default now());
create function private.validate_timezone() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Fuso horário inválido'; end if;
 return new;
end $$;
create trigger validate_timezone before insert or update of timezone on public.tenants for each row execute function private.validate_timezone();
create table public.tenant_settings (
 tenant_id uuid primary key references public.tenants on delete cascade, description text not null default '', address text not null default '',
 whatsapp text not null default '', instagram text not null default '', logo_url text not null default '', cover_url text not null default '',
 brand_color text not null default '#365dd9' check(brand_color ~ '^#[0-9A-Fa-f]{6}$'),
 min_notice_minutes integer not null default 60 check(min_notice_minutes between 0 and 525600), max_days int not null default 60 check(max_days between 1 and 730),
 cancellation_policy text not null default '');
create table public.tenant_memberships (
 tenant_id uuid not null references public.tenants on delete cascade, user_id uuid not null references auth.users on delete cascade,
 role text not null check(role in ('owner','admin','staff')), active boolean not null default true, primary key(tenant_id,user_id));
create index tenant_memberships_user on public.tenant_memberships(user_id);
create table public.subscriptions (
 tenant_id uuid primary key references public.tenants on delete cascade, plan_id uuid not null references public.subscription_plans,
 status text not null default 'trial' check(status in ('trial','active','overdue','suspended','cancelled')),
 period_end timestamptz not null, created_at timestamptz not null default now());
create table public.billing_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants, provider text not null,
 event_id text not null, amount_cents integer not null, event_type text not null, created_at timestamptz not null default now(), unique(provider,event_id));
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants on delete set null, actor_id uuid, action text not null,
 entity_id text, created_at timestamptz not null default now());
create table public.services (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants on delete cascade, name text not null check(length(trim(name)) between 1 and 150),
 description text not null default '', category text not null default '', image_url text not null default '',
 price_cents integer check(price_cents>=0), duration_minutes integer not null check(duration_minutes between 1 and 1440),
 buffer_minutes integer not null default 0 check(buffer_minutes between 0 and 1440), active boolean not null default true, unique(tenant_id,id));
create table public.professionals (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants on delete cascade,
 name text not null check(length(trim(name)) between 1 and 150), photo_url text not null default '', specialty text not null default '',
 commission_percent numeric(5,2) not null default 0 check(commission_percent between 0 and 100), active boolean not null default true, unique(tenant_id,id));
create table public.professional_services (
 tenant_id uuid not null, professional_id uuid not null, service_id uuid not null, primary key(tenant_id,professional_id,service_id),
 foreign key(tenant_id,professional_id) references public.professionals(tenant_id,id) on delete cascade,
 foreign key(tenant_id,service_id) references public.services(tenant_id,id) on delete cascade);
create table public.working_hours (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants on delete cascade,
 professional_id uuid, weekday integer not null check(weekday between 0 and 6), opens_at time not null, closes_at time not null,
 check(opens_at<closes_at), unique(tenant_id,id), foreign key(tenant_id,professional_id) references public.professionals(tenant_id,id) on delete cascade);
create table public.blocked_times (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants on delete cascade, professional_id uuid,
 starts_at timestamptz not null, ends_at timestamptz not null, reason text not null default '', check(starts_at<ends_at),unique(tenant_id,id),
 foreign key(tenant_id,professional_id) references public.professionals(tenant_id,id) on delete cascade);
create table public.resources (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants on delete cascade, name text not null check(length(trim(name))>0), unique(tenant_id,id));
create table public.service_resources (
 tenant_id uuid not null, resource_id uuid not null, service_id uuid not null, primary key(tenant_id,resource_id,service_id),
 foreign key(tenant_id,resource_id) references public.resources(tenant_id,id) on delete cascade,
 foreign key(tenant_id,service_id) references public.services(tenant_id,id) on delete cascade);
create function public.is_superadmin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.superadmins where user_id=auth.uid()) $$;
create function public.tenant_available(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tenants x join public.subscriptions s on s.tenant_id=x.id where x.id=t and x.status in ('trial','active') and s.status in ('trial','active') and s.period_end>now()) $$;
create function public.can_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.tenant_available(t) and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active) $$;
create function public.can_manage(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.tenant_available(t) and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active and role in ('owner','admin')) $$;
create function public.has_feature(t uuid,feature text) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_access(t) and exists(select 1 from public.subscriptions s join public.subscription_plans p on p.id=s.plan_id where s.tenant_id=t and p.features -> feature = 'true'::jsonb) $$;
revoke all on function public.has_feature(uuid,text) from public,anon;
grant execute on function public.has_feature(uuid,text) to authenticated,service_role;
do $$
declare n text;
begin
 foreach n in array array['services','professionals','professional_services','working_hours','blocked_times','resources','service_resources','tenant_settings'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on public.%I from anon,authenticated',n);
 execute format('grant select,insert,update,delete on public.%I to authenticated',n);
 execute format('create policy members_read on public.%I for select to authenticated using(public.can_access(tenant_id))',n);
 execute format('create policy managers_write on public.%I for all to authenticated using(public.can_manage(tenant_id)) with check(public.can_manage(tenant_id))',n);
 end loop;
 foreach n in array array['tenants','tenant_memberships','subscriptions','subscription_plans','audit_logs','billing_events'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on public.%I from anon,authenticated',n);
 execute format('grant select on public.%I to authenticated',n);
 end loop;
end $$;
create policy tenant_read on public.tenants for select to authenticated using(public.can_access(id) or public.is_superadmin());
create policy memberships_read on public.tenant_memberships for select to authenticated using((user_id=auth.uid() and active) or public.can_manage(tenant_id) or public.is_superadmin());
create policy subscriptions_read on public.subscriptions for select to authenticated using(public.can_manage(tenant_id) or public.is_superadmin());
create policy plans_read on public.subscription_plans for select to authenticated using(active or public.is_superadmin());
create policy audits_read on public.audit_logs for select to authenticated using(public.is_superadmin());
create policy billing_read on public.billing_events for select to authenticated using(public.is_superadmin());
create function private.record_change() returns trigger language plpgsql security definer set search_path='' as $$
declare rec jsonb;
begin
 rec := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id)
 values(case when tg_table_name='tenants' then (rec->>'id')::uuid else (rec->>'tenant_id')::uuid end,auth.uid(),tg_table_name||'.'||lower(tg_op),coalesce(rec->>'id',rec->>'user_id',rec->>'tenant_id'));
 return null;
end $$;
do $$ declare n text; begin
 foreach n in array array['tenants','tenant_memberships','subscriptions','subscription_plans','billing_events','services','professionals','tenant_settings','working_hours','blocked_times','professional_services','service_resources','resources'] loop
 execute format('create trigger logged after insert or update on public.%I for each row execute function private.record_change()',n);
 end loop; end $$;
create function private.init_settings() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.tenant_settings(tenant_id) values(new.id); return new; end $$;
create trigger tenant_defaults after insert on public.tenants for each row execute function private.init_settings();
revoke all on function public.can_manage(uuid),public.can_access(uuid),public.is_superadmin(),public.tenant_available(uuid) from public,anon;
grant execute on function public.can_manage(uuid),public.can_access(uuid),public.is_superadmin(),public.tenant_available(uuid) to authenticated,service_role;
commit;
