begin;
-- Only the server evaluates public requests. Managerial slot lookup / creation
-- also checks the membership of the authenticated PostgreSQL role in 002.sql.
revoke execute on function booking_catalog(text),booking_slots(text,uuid,date,uuid),booking_create(text,uuid,uuid,timestamptz,text,text,text,text,uuid,uuid,boolean,boolean),booking_receipt(uuid),customer_update_booking(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function booking_catalog(text),booking_slots(text,uuid,date,uuid),booking_create(text,uuid,uuid,timestamptz,text,text,text,text,uuid,uuid,boolean,boolean),booking_receipt(uuid),customer_update_booking(uuid,timestamptz,uuid) to service_role;
grant execute on function booking_slots(text,uuid,date,uuid),booking_create(text,uuid,uuid,timestamptz,text,text,text,text,uuid,uuid,boolean,boolean) to authenticated;
create table private.public_api_limits(
 bucket text not null,minute timestamptz not null,hits int not null,
 primary key(bucket,minute)
);
create index api_limit_expiry on private.public_api_limits(minute);
create function public.reserve_request_quota(p_origin text,p_write boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare window_start timestamptz:=date_trunc('minute',clock_timestamp()); local_count int;global_count int;
begin
 if length(p_origin)<>64 or p_origin is null then return false; end if;
 delete from private.public_api_limits where minute < window_start-interval '2 minutes';
 insert into private.public_api_limits as l values(p_origin||p_write::text,window_start,1)
 on conflict(bucket,minute) do update set hits=l.hits+1 where l.hits<case when p_write then 12 else 90 end returning hits into local_count;
 if local_count is null then return false;end if;
 insert into private.public_api_limits as l values('global-'||p_write::text,window_start,1)
 on conflict(bucket,minute) do update set hits=l.hits+1 where l.hits<case when p_write then 500 else 4000 end returning hits into global_count;
 return global_count is not null;
end$$;
revoke all on function public.reserve_request_quota(text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_request_quota(text,boolean) to service_role;
commit;
