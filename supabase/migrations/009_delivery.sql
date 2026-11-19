begin;
create table private.delivery_jobs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,appointment_id uuid not null,
 channel text not null check(channel in ('email','whatsapp')),
 state text not null default 'queued' check(state in ('queued','processing','accepted','failed','uncertain','expired')),
 attempts int not null default 0, next_attempt timestamptz not null default now(),
 lease uuid,provider_reference text,last_error text,created_at timestamptz not null default now(),
 unique(appointment_id,channel),
 foreign key(tenant_id,appointment_id) references public.appointments(tenant_id,id)
);
create index delivery_due on private.delivery_jobs(state,next_attempt);
create function private.enqueue_confirmation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.notify_email then insert into private.delivery_jobs(tenant_id,appointment_id,channel) values(new.tenant_id,new.id,'email'); end if;
 if new.notify_whatsapp then insert into private.delivery_jobs(tenant_id,appointment_id,channel) values(new.tenant_id,new.id,'whatsapp'); end if;
 return new;
end$$;
create trigger enqueue_confirmation after insert on public.appointments for each row execute function private.enqueue_confirmation();

create function public.claim_deliveries(p_channels text[]) returns table(id uuid,lease uuid,channel text,attempt int,destination text,company text,service text,professional text,local_start text)
language plpgsql security definer set search_path='' as $$
begin
 -- A lost connection after submission can leave the WhatsApp outcome unknown.
 update private.delivery_jobs j set state='uncertain',lease=null,last_error='lease_expired' where j.state='processing' and j.channel='whatsapp' and j.next_attempt<now();
 update private.delivery_jobs j set state='expired',lease=null where j.state in ('queued','processing') and j.next_attempt<=now() and
 (j.created_at<now()-interval '12 hours' or not exists(select from public.appointments a where a.id=j.appointment_id and a.status in ('confirmed','pending') and a.starts_at>now() and public.tenant_available(a.tenant_id)));
 return query with ready as (
 select j.id from private.delivery_jobs j where j.state in ('queued','processing') and j.next_attempt<=now() and j.channel=any(p_channels) order by j.created_at limit 5 for update skip locked
 ), claimed as (
 update private.delivery_jobs j set state='processing',lease=gen_random_uuid(),attempts=j.attempts+1,next_attempt=now()+interval '5 minutes' from ready r where r.id=j.id returning j.*
 )
 select j.id,j.lease,j.channel,j.attempts,case when j.channel='email' then c.email else c.phone end,t.name,s.name,p.name,to_char(a.starts_at at time zone t.timezone,'DD/MM/YYYY HH24:MI')||' ('||t.timezone||')'
 from claimed j join public.appointments a on a.id=j.appointment_id join public.customers c on c.id=a.customer_id join public.tenants t on t.id=j.tenant_id join public.services s on s.id=a.service_id join public.professionals p on p.id=a.professional_id;
end$$;
create function public.finish_delivery(p_id uuid,p_lease uuid,p_state text,p_reference text,p_error text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_state not in ('accepted','failed','queued','uncertain') then raise exception 'Invalid delivery state';end if;
 update private.delivery_jobs set state=case when p_state='queued' and attempts>=6 then 'failed' else p_state end,
 lease=null,next_attempt=now()+make_interval(mins=>least(60,attempts*attempts)),provider_reference=left(p_reference,180),last_error=left(p_error,80)
 where id=p_id and lease=p_lease and state='processing';
end$$;
revoke all on function public.claim_deliveries(text[]),public.finish_delivery(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_deliveries(text[]),public.finish_delivery(uuid,uuid,text,text,text) to service_role;
commit;
