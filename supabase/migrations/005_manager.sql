-- Keep assignments and recurring availability consistent when a form is saved.
create function public.manager_catalog(p_tenant uuid,p_kind text,p_id uuid,p_fields jsonb,p_assigned uuid[],p_hours jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare item uuid:=coalesce(p_id,gen_random_uuid()); h jsonb;
begin
 if not public.can_manage(p_tenant) then raise exception 'Permissão insuficiente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,0));
 if length(trim(p_fields->>'name')) not between 1 and 160 then raise exception 'Nome inválido'; end if;
 if p_kind='service' then
 insert into services(id,tenant_id,name,category,description,price_cents,duration_minutes,buffer_minutes,image_url,active)
 values(item,p_tenant,trim(p_fields->>'name'),p_fields->>'category',p_fields->>'description',(p_fields->>'price_cents')::integer,(p_fields->>'duration_minutes')::int,(p_fields->>'buffer_minutes')::int,p_fields->>'image_url',(p_fields->>'active')::boolean)
 on conflict(id) do update set name=excluded.name,category=excluded.category,description=excluded.description,price_cents=excluded.price_cents,duration_minutes=excluded.duration_minutes,buffer_minutes=excluded.buffer_minutes,image_url=excluded.image_url,active=excluded.active where services.tenant_id=p_tenant;
 if not found then raise exception 'Serviço inválido'; end if;
 delete from professional_services where tenant_id=p_tenant and service_id=item;
 insert into professional_services(tenant_id,service_id,professional_id) select p_tenant,item,unnest(p_assigned);
 if p_fields ? 'resources' then
 delete from service_resources where tenant_id=p_tenant and service_id=item;
 insert into service_resources(tenant_id,service_id,resource_id) select p_tenant,item,value::uuid from jsonb_array_elements_text(p_fields->'resources');
 -- Preserve historical assignments and atomically recompute the future claims.
 delete from booking_resources br using appointments a
 where br.appointment_id=a.id and a.tenant_id=p_tenant and a.service_id=item and a.busy_until>now() and a.status in ('pending','confirmed','in_progress');
 insert into booking_resources(tenant_id,appointment_id,resource_id,occupied)
 select p_tenant,a.id,sr.resource_id,tstzrange(a.starts_at,a.busy_until,'[)') from appointments a
 join service_resources sr on sr.service_id=a.service_id
 where a.tenant_id=p_tenant and a.service_id=item and a.busy_until>now() and a.status in ('pending','confirmed','in_progress')
 order by sr.resource_id,a.starts_at;
 end if;
 elsif p_kind='professional' then
 insert into professionals(id,tenant_id,name,specialty,photo_url,commission_percent,active)
 values(item,p_tenant,trim(p_fields->>'name'),p_fields->>'specialty',p_fields->>'photo_url',(p_fields->>'commission_percent')::numeric,(p_fields->>'active')::boolean)
 on conflict(id) do update set name=excluded.name,specialty=excluded.specialty,photo_url=excluded.photo_url,commission_percent=excluded.commission_percent,active=excluded.active where professionals.tenant_id=p_tenant;
 if not found then raise exception 'Profissional inválido'; end if;
 delete from professional_services where tenant_id=p_tenant and professional_id=item;
 insert into professional_services(tenant_id,professional_id,service_id) select p_tenant,item,unnest(p_assigned);
 delete from working_hours where tenant_id=p_tenant and professional_id=item;
 for h in select value from jsonb_array_elements(p_hours) loop
 insert into working_hours(tenant_id,professional_id,weekday,opens_at,closes_at) values(p_tenant,item,(h->>'weekday')::int,(h->>'opens_at')::time,(h->>'closes_at')::time);
 end loop;
 else raise exception 'Tipo inválido'; end if;
 return item;
end $$;
revoke all on function public.manager_catalog(uuid,text,uuid,jsonb,uuid[],jsonb) from public,anon;
grant execute on function public.manager_catalog(uuid,text,uuid,jsonb,uuid[],jsonb) to authenticated;
create function public.manager_settings(p_tenant uuid,p_name text,p_timezone text,p_fields jsonb,p_hours jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare h jsonb;
begin
 if not public.can_manage(p_tenant) then raise exception 'Permissão insuficiente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,0));
 if length(trim(p_name)) not between 1 and 160 or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Nome ou fuso inválido'; end if;
 update tenants set name=trim(p_name),timezone=p_timezone where id=p_tenant;
 insert into tenant_settings(tenant_id,description,address,whatsapp,instagram,logo_url,cover_url,brand_color,min_notice_minutes,max_days,cancellation_policy)
 values(p_tenant,p_fields->>'description',p_fields->>'address',p_fields->>'whatsapp',p_fields->>'instagram',p_fields->>'logo_url',p_fields->>'cover_url',p_fields->>'brand_color',(p_fields->>'min_notice_minutes')::int,(p_fields->>'max_days')::int,p_fields->>'cancellation_policy')
 on conflict(tenant_id) do update set description=excluded.description,address=excluded.address,whatsapp=excluded.whatsapp,instagram=excluded.instagram,logo_url=excluded.logo_url,cover_url=excluded.cover_url,brand_color=excluded.brand_color,min_notice_minutes=excluded.min_notice_minutes,max_days=excluded.max_days,cancellation_policy=excluded.cancellation_policy;
 delete from working_hours where tenant_id=p_tenant and professional_id is null;
 for h in select value from jsonb_array_elements(p_hours) loop
 insert into working_hours(tenant_id,weekday,opens_at,closes_at) values(p_tenant,(h->>'weekday')::int,(h->>'opens_at')::time,(h->>'closes_at')::time);
 end loop;
end $$;
revoke all on function public.manager_settings(uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.manager_settings(uuid,text,text,jsonb,jsonb) to authenticated;
create function public.manager_block(p_tenant uuid,p_professional uuid,p_start timestamp,p_end timestamp,p_reason text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare z text;
begin
 if not can_manage(p_tenant) then raise exception 'Permissão insuficiente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,0));
 select timezone into strict z from tenants where id=p_tenant;
 if exists(select 1 from appointments where tenant_id=p_tenant and (p_professional is null or professional_id=p_professional) and status not in ('cancelled','no_show') and tstzrange(starts_at,busy_until) && tstzrange(p_start at time zone z,p_end at time zone z)) then raise exception 'Há atendimento marcado neste intervalo'; end if;
 insert into blocked_times(tenant_id,professional_id,starts_at,ends_at,reason) values(p_tenant,p_professional,p_start at time zone z,p_end at time zone z,p_reason);
end $$;
revoke all on function public.manager_block(uuid,uuid,timestamp,timestamp,text) from public,anon;
grant execute on function public.manager_block(uuid,uuid,timestamp,timestamp,text) to authenticated;

-- Staff can identify customers in calendars without access to their private records.
drop policy read_member on public.customers;
create policy customer_manager_read on public.customers for select to authenticated using(public.can_manage(tenant_id));
create function public.manager_calendar_names(p_tenant uuid)
returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select c.id,c.name from public.customers c where c.tenant_id=p_tenant and public.can_access(p_tenant) order by c.id
$$;
create function public.manager_export_customers(p_tenant uuid,p_search text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.can_manage(p_tenant) then raise exception 'Permissão insuficiente'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(c.name,c.phone,coalesce(c.email,'')) order by c.name,c.id),'[]'::jsonb)
 into result from public.customers c where c.tenant_id=p_tenant and strpos(lower(c.name||' '||c.phone),lower(coalesce(p_search,'')))>0;
 insert into public.audit_logs(tenant_id,actor_id,action) values(p_tenant,auth.uid(),'customers.export');
 return result;
end $$;
revoke all on function public.manager_calendar_names(uuid),public.manager_export_customers(uuid,text) from public,anon;
grant execute on function public.manager_calendar_names(uuid),public.manager_export_customers(uuid,text) to authenticated;
revoke insert,update,delete on public.service_resources from authenticated;
