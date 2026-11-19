begin;
create table public.daily_slots(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants on delete cascade,weekday int not null check(weekday between 0 and 6),at_time time not null,unique(tenant_id,weekday,at_time));
alter table public.daily_slots enable row level security;
grant select on public.daily_slots to authenticated;
create policy owner_slots on public.daily_slots for select to authenticated using(public.can_manage(tenant_id));
create function private.simple_defaults() returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid;s uuid;w int;
begin
 insert into public.professionals(tenant_id,name) values(new.id,'Atendimento') returning id into p;
 insert into public.services(tenant_id,name,description,price_cents,duration_minutes) values(new.id,'Atendimento','Agendamento',null,1) returning id into s;
 insert into public.professional_services values(new.id,p,s);
 for w in 1..6 loop
  insert into public.daily_slots(tenant_id,weekday,at_time) values(new.id,w,'09:00'),(new.id,w,'10:00'),(new.id,w,'11:00'),(new.id,w,'14:00'),(new.id,w,'15:00');
 end loop;
 return new;
end $$;
create trigger simple_defaults after insert on public.tenants for each row execute function private.simple_defaults();
create function public.simple_schedule(p_slug text,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.tenants;out jsonb;
begin
 select * into strict t from public.tenants where slug=p_slug and public.tenant_available(id);
 if p_day<(now() at time zone t.timezone)::date or p_day>(now() at time zone t.timezone)::date+60 then raise exception 'Data indisponível';end if;
 select jsonb_build_object('name',t.name,'slug',t.slug,'timezone',t.timezone,'description',cfg.description,'address',cfg.address,'logo',cfg.logo_url,'cover',cfg.cover_url,'color',cfg.brand_color,'slots',coalesce((select jsonb_agg(jsonb_build_object('time',to_char(d.at_time,'HH24:MI'),'busy',exists(select 1 from public.appointments a where a.tenant_id=t.id and a.status not in ('cancelled','no_show') and a.starts_at=((p_day+d.at_time) at time zone t.timezone))) order by d.at_time) from public.daily_slots d where d.tenant_id=t.id and d.weekday=extract(dow from p_day)),'[]'::jsonb))
 into out from public.tenant_settings cfg where cfg.tenant_id=t.id;
 return out;
end $$;
create function public.simple_book(p_slug text,p_day date,p_time time,p_name text,p_phone text,p_notes text,p_key uuid,p_token uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tenants;a uuid;c uuid;s uuid;p uuid;moment timestamptz;phone_clean text:=regexp_replace(p_phone,'[^0-9]','','g');
begin
 if length(trim(p_name)) not between 2 and 120 or length(phone_clean) not between 10 and 15 or length(coalesce(p_notes,''))>1500 or p_key is null or p_token is null or p_key=p_token then raise exception 'Dados inválidos';end if;
 select * into strict t from public.tenants where slug=p_slug and public.tenant_available(id);
 perform pg_advisory_xact_lock(hashtextextended(t.id::text,0));
 select ap.id into a from public.booking_secrets k join public.appointments ap on ap.id=k.appointment_id where k.request_key=p_key and k.token_hash=sha256(uuid_send(p_token)) and ap.tenant_id=t.id;
 if a is not null then return a;end if;
 moment:=(p_day+p_time) at time zone t.timezone;
 if moment<now()+interval '15 minutes' or p_day>(now() at time zone t.timezone)::date+60 or not exists(select 1 from public.daily_slots where tenant_id=t.id and weekday=extract(dow from p_day) and at_time=p_time) then raise exception 'Horário indisponível';end if;
 if exists(select 1 from public.appointments where tenant_id=t.id and status not in ('cancelled','no_show') and starts_at=moment) or exists(select 1 from public.blocked_times where tenant_id=t.id and starts_at<=moment and ends_at>moment) then raise exception 'Horário ocupado';end if;
 if (select count(*) from public.appointments a join public.customers c on c.id=a.customer_id where a.tenant_id=t.id and c.phone=phone_clean and a.created_at>now()-interval '1 hour')>=4 then raise exception 'Limite de reservas';end if;
 select id into strict s from public.services where tenant_id=t.id and name='Atendimento' limit 1;
 select id into strict p from public.professionals where tenant_id=t.id and name='Atendimento' limit 1;
 insert into public.customers(tenant_id,name,phone) values(t.id,trim(p_name),phone_clean) on conflict do nothing returning id into c;
 if c is null then select id into strict c from public.customers where tenant_id=t.id and phone=phone_clean and lower(trim(name))=lower(trim(p_name)) and email is null;end if;
 insert into public.appointments(tenant_id,service_id,professional_id,customer_id,starts_at,ends_at,busy_until,notes) values(t.id,s,p,c,moment,moment+interval '1 minute',moment+interval '1 minute',coalesce(p_notes,'')) returning id into a;
 insert into public.booking_secrets values(a,p_key,sha256(uuid_send(p_token)));
 return a;
end $$;
create function public.simple_save_slots(p_tenant uuid,p_weekday int,p_times text[]) returns void language plpgsql security definer set search_path='' as $$
declare time_text text;
begin
 if not public.can_manage(p_tenant) or p_weekday not between 0 and 6 or cardinality(p_times)>30 then raise exception 'Acesso ou horários inválidos';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,0));
 delete from public.daily_slots where tenant_id=p_tenant and weekday=p_weekday;
 foreach time_text in array p_times loop
  if time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Hora inválida';end if;
  insert into public.daily_slots(tenant_id,weekday,at_time) values(p_tenant,p_weekday,time_text::time);
 end loop;
end $$;
revoke all on function public.simple_schedule(text,date),public.simple_book(text,date,time,text,text,text,uuid,uuid),public.simple_save_slots(uuid,int,text[]) from public,anon,authenticated;
grant execute on function public.simple_schedule(text,date),public.simple_book(text,date,time,text,text,text,uuid,uuid) to service_role;
grant execute on function public.simple_save_slots(uuid,int,text[]) to authenticated;
commit;
