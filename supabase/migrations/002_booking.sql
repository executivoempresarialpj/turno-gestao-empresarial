create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;
create table customers(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants,
 name text not null, phone text not null, email text, notes text, unique(tenant_id,id)
);
create unique index customer_identity on customers(tenant_id,phone,lower(trim(name)),lower(coalesce(email,'')));
create table appointments(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants,
 customer_id uuid not null, service_id uuid not null, professional_id uuid not null,
 starts_at timestamptz not null, ends_at timestamptz not null, busy_until timestamptz not null,
 price_cents integer, status text not null default 'pending' check(status in ('pending','confirmed','in_progress','completed','cancelled','no_show')),
 notes text, notify_email boolean not null default false, notify_whatsapp boolean not null default false, created_at timestamptz not null default now(), unique(tenant_id,id),
 foreign key(tenant_id,customer_id) references customers(tenant_id,id),
 foreign key(tenant_id,professional_id) references professionals(tenant_id,id),
 foreign key(tenant_id,service_id) references services(tenant_id,id),
 check(starts_at<ends_at and ends_at<=busy_until),
 exclude using gist(professional_id with =,tstzrange(starts_at,busy_until,'[)') with &&) where (status not in ('cancelled','no_show'))
);
create table booking_resources(
 tenant_id uuid not null, appointment_id uuid not null,resource_id uuid not null, occupied tstzrange not null,
 primary key(appointment_id,resource_id), foreign key(tenant_id,appointment_id) references appointments(tenant_id,id),
 foreign key(tenant_id,resource_id) references resources(tenant_id,id),exclude using gist(resource_id with =,occupied with &&)
);
create table booking_secrets(appointment_id uuid primary key references appointments,request_key uuid unique not null, token_hash bytea unique not null);
create table appointment_status_history(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,appointment_id uuid not null,status text not null,starts_at timestamptz not null,created_at timestamptz not null default now(),foreign key(tenant_id,appointment_id) references appointments(tenant_id,id));
create table notifications(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,appointment_id uuid not null,message text not null, created_at timestamptz not null default now(),foreign key(tenant_id,appointment_id) references appointments(tenant_id,id));
create index notifications_recent on notifications(tenant_id,created_at desc);
create index appointment_period on appointments(tenant_id,starts_at);
create index appointment_customer on appointments(tenant_id,customer_id);
alter table booking_secrets enable row level security;
revoke all on booking_secrets from anon,authenticated;
alter table booking_resources enable row level security;
do $$ declare t text;begin foreach t in array array['appointments','customers','appointment_status_history','notifications'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from anon,authenticated',t);
 execute format('grant select on %I to authenticated',t);
 execute format('create policy read_member on %I for select to authenticated using(can_access(tenant_id))',t);
end loop; end $$;
revoke all on booking_resources from anon,authenticated;
grant update(notes) on customers to authenticated;
create policy customer_notes on customers for update to authenticated using(can_manage(tenant_id)) with check(can_manage(tenant_id));
do $$begin if exists(select from pg_publication where pubname='supabase_realtime' and not puballtables) then alter publication supabase_realtime add table public.notifications,public.appointments; end if; end$$;

create function booking_catalog(p_slug text) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('name',t.name,'timezone',t.timezone,'slug',t.slug,'description',s.description,'logo_url',s.logo_url,'cover_url',s.cover_url,'address',s.address,'whatsapp',s.whatsapp,'instagram',s.instagram,'brand_color',s.brand_color,'policy',s.cancellation_policy,'max_days',s.max_days,
 'hours',coalesce((select jsonb_agg(jsonb_build_object('day',weekday,'open',opens_at,'close',closes_at) order by weekday,opens_at) from working_hours where tenant_id=t.id and professional_id is null),'[]'),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'price',v.price_cents,'minutes',v.duration_minutes,'image',v.image_url,'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name) from professional_services ps join professionals p on p.id=ps.professional_id where ps.service_id=v.id and p.active),'[]')) order by v.name) from services v where v.tenant_id=t.id and v.active),'[]'))
 from tenants t left join tenant_settings s on s.tenant_id=t.id where t.slug=p_slug and tenant_available(t.id)
$$;
create function booking_candidates(p_slug text,p_service uuid,p_day date,p_professional uuid,p_ignore uuid)
 returns table(starts_at timestamptz,professional_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
 select distinct g.slot,p.id from tenants t join tenant_settings cfg on cfg.tenant_id=t.id
 join services s on s.tenant_id=t.id and s.id=p_service and s.active
 join professional_services ps on ps.service_id=s.id join professionals p on p.id=ps.professional_id and p.active
 join working_hours h on h.tenant_id=t.id and h.professional_id is null and h.weekday=extract(dow from p_day)
 cross join lateral (select make_interval(mins=>s.duration_minutes+s.buffer_minutes) as duration) d
 cross join lateral generate_series((p_day+h.opens_at) at time zone t.timezone,((p_day+h.closes_at) at time zone t.timezone)-d.duration,interval '15 minutes') g(slot)
 where t.slug=p_slug and tenant_available(t.id) and (current_setting('role')<>'authenticated' or can_access(t.id)) and (p_professional is null or p.id=p_professional)
 and g.slot>=now()+make_interval(mins=>cfg.min_notice_minutes) and p_day<=(now() at time zone t.timezone)::date+cfg.max_days
 and (not exists(select from working_hours w where w.professional_id=p.id) or exists(select from working_hours w where w.professional_id=p.id and w.weekday=h.weekday and g.slot>=(p_day+w.opens_at) at time zone t.timezone and g.slot+d.duration<=(p_day+w.closes_at) at time zone t.timezone))
 and not exists(select from blocked_times b where b.tenant_id=t.id and (b.professional_id is null or b.professional_id=p.id) and tstzrange(b.starts_at,b.ends_at) && tstzrange(g.slot,g.slot+d.duration))
 and not exists(select from appointments a where a.professional_id=p.id and a.id is distinct from p_ignore and a.status not in ('cancelled','no_show') and tstzrange(a.starts_at,a.busy_until) && tstzrange(g.slot,g.slot+d.duration))
 and not exists(select from service_resources sr join booking_resources br using(resource_id) where sr.service_id=s.id and br.appointment_id is distinct from p_ignore and br.occupied && tstzrange(g.slot,g.slot+d.duration))
 order by 1,2
$$;
revoke all on function booking_candidates(text,uuid,date,uuid,uuid) from public,anon,authenticated;
create function booking_slots(p_slug text,p_service uuid,p_day date,p_professional uuid default null)
returns table(starts_at timestamptz,professional_id uuid) language sql stable security definer set search_path=public,pg_temp as $$select * from booking_candidates(p_slug,p_service,p_day,p_professional,null)$$;
create function sync_booking() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 delete from booking_resources where appointment_id=new.id;
 if new.status not in ('cancelled','no_show') then
 insert into booking_resources select new.tenant_id,new.id,resource_id,tstzrange(new.starts_at,new.busy_until) from service_resources where service_id=new.service_id order by resource_id;
 end if;
 insert into appointment_status_history(tenant_id,appointment_id,status,starts_at) values(new.tenant_id,new.id,new.status,new.starts_at);
 insert into notifications(tenant_id,appointment_id,message) values(new.tenant_id,new.id,case when tg_op='INSERT' then 'Novo agendamento recebido!' when new.status='cancelled' then 'Agendamento cancelado' else 'Agendamento atualizado' end);
 return new;
end$$;
create trigger booking_events after insert or update on appointments for each row execute function sync_booking();
create function booking_create(p_slug text,p_service uuid,p_professional uuid,p_start timestamptz,p_name text,p_phone text,p_email text,p_notes text,p_key uuid,p_token uuid,p_notify_email boolean default false,p_notify_whatsapp boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t tenants; s services;c uuid; a uuid;phone_clean text:=regexp_replace(p_phone,'[^0-9]','','g');hash bytea:=sha256(uuid_send(p_token));begin
 if p_token is null or p_key is null or p_key=p_token or length(trim(p_name)) not between 2 and 120 or p_name is null or phone_clean is null or length(phone_clean) not between 10 and 15 or length(p_notes)>1500 or length(p_email)>254 or (nullif(p_email,'') is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Revise os dados de contato.';end if;
 select * into strict t from tenants where slug=p_slug and tenant_available(id) and (current_setting('role')<>'authenticated' or can_access(id));
 perform pg_advisory_xact_lock(hashtextextended(t.id::text,0));
 select a1.id into a from booking_secrets k join appointments a1 on a1.id=k.appointment_id where k.request_key=p_key and k.token_hash=hash and a1.tenant_id=t.id;
 if found then return a;end if;
 if not can_access(t.id) and ((select count(*) from appointments ap join customers cu on cu.id=ap.customer_id where ap.tenant_id=t.id and cu.phone=phone_clean and ap.created_at>now()-interval '1 hour')>=4 or (select count(*) from appointments where tenant_id=t.id and created_at>now()-interval '1 minute')>=20) then raise exception 'Limite de reservas atingido. Tente mais tarde.';end if;
 if not exists(select from booking_candidates(p_slug,p_service,(p_start at time zone t.timezone)::date,p_professional,null) where starts_at=p_start and professional_id=p_professional) then raise exception 'Este horário ficou indisponível.'; end if;
 select * into strict s from services where id=p_service;
 insert into customers(tenant_id,name,phone,email) values(t.id,trim(p_name),phone_clean,nullif(lower(trim(p_email)),'')) on conflict do nothing returning id into c;
 if c is null then select id into strict c from customers where tenant_id=t.id and phone=phone_clean and lower(trim(name))=lower(trim(p_name)) and lower(coalesce(email,''))=lower(coalesce(trim(p_email),'')); end if;
 insert into appointments(tenant_id,service_id,professional_id,customer_id,starts_at,ends_at,busy_until,price_cents,notes,notify_email,notify_whatsapp) values(t.id,s.id,p_professional,c,p_start,p_start+make_interval(mins=>s.duration_minutes),p_start+make_interval(mins=>s.duration_minutes+s.buffer_minutes),s.price_cents,left(p_notes,1500),coalesce(p_notify_email,false),coalesce(p_notify_whatsapp,false)) returning id into a;
 insert into booking_secrets values(a,p_key,hash);return a;
end$$;
create function booking_receipt(p_token uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at,'price',a.price_cents,'service',s.name,'professional',p.name,'tenant',t.name,'timezone',t.timezone,'slug',t.slug,'service_id',a.service_id,'professional_id',a.professional_id,'policy',cfg.cancellation_policy)
 from booking_secrets k join appointments a on a.id=k.appointment_id join services s on s.id=a.service_id join professionals p on p.id=a.professional_id join tenants t on t.id=a.tenant_id left join tenant_settings cfg on cfg.tenant_id=t.id where k.token_hash=sha256(uuid_send(p_token))
$$;
create function update_booking_core(p_id uuid,p_status text,p_start timestamptz,p_professional uuid,p_consumer boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a appointments;t tenants;s services;begin
 select * into strict a from appointments where id=p_id;
 select * into strict t from tenants where id=a.tenant_id and tenant_available(id);
 perform pg_advisory_xact_lock(hashtextextended(t.id::text,0));
 select * into strict a from appointments where id=p_id for update;
 if p_consumer and (a.status not in ('pending','confirmed') or a.starts_at<=now()) then raise exception 'A reserva já foi encerrada.';end if;
 if p_start is not null then
 if p_consumer and (select count(*) from appointment_status_history h where h.appointment_id=a.id and h.created_at>now()-interval '1 hour')>=10 then raise exception 'Limite de remarcações atingido. Entre em contato com o estabelecimento.';end if;
 if a.status not in ('pending','confirmed') then raise exception 'Reserva indisponível para remarcação.';end if;
 p_professional:=coalesce(p_professional,a.professional_id);
 if not exists(select from booking_candidates(t.slug,a.service_id,(p_start at time zone t.timezone)::date,p_professional,a.id) where starts_at=p_start) then raise exception 'Horário indisponível.';end if;
 select * into strict s from services where id=a.service_id;
 update appointments set starts_at=p_start,ends_at=p_start+make_interval(mins=>s.duration_minutes),busy_until=p_start+make_interval(mins=>s.duration_minutes+s.buffer_minutes),professional_id=p_professional,status=coalesce(p_status,a.status) where id=p_id;
 elsif p_status is distinct from a.status then
 if a.status in ('completed','cancelled','no_show') or p_status is null then raise exception 'Reserva já encerrada.';end if;
 update appointments set status=p_status where id=p_id;
 end if;
end$$;
revoke all on function update_booking_core(uuid,text,timestamptz,uuid,boolean) from public,anon,authenticated;
create function customer_update_booking(p_token uuid,p_start timestamptz default null,p_professional uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a uuid;begin select appointment_id into strict a from booking_secrets where token_hash=sha256(uuid_send(p_token));perform update_booking_core(a,case when p_start is null then 'cancelled' else null end,p_start,p_professional,true);end$$;
create function manager_update_booking(p_id uuid,p_status text,p_start timestamptz default null,p_professional uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if not exists(select from appointments where id=p_id and can_access(tenant_id)) then raise exception 'Acesso negado.';end if; perform update_booking_core(p_id,p_status,p_start,p_professional,false);end$$;
revoke all on function manager_update_booking(uuid,text,timestamptz,uuid) from public,anon;
grant execute on function manager_update_booking(uuid,text,timestamptz,uuid) to authenticated;
grant execute on function booking_receipt(uuid),customer_update_booking(uuid,timestamptz,uuid),booking_slots(text,uuid,date,uuid),booking_catalog(text),booking_create(text,uuid,uuid,timestamptz,text,text,text,text,uuid,uuid,boolean,boolean) to anon,authenticated;
reset search_path;
