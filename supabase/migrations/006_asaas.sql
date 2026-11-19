begin;
create table private.billing_provisioning (
 tenant_id uuid primary key references public.tenants,
 attempt uuid not null unique, monthly_cents int not null, plan_id uuid not null references public.subscription_plans,
 started_at timestamptz not null default now(), provider_subscription text
);
create function public.platform_begin_billing(t uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subscriptions; plan public.subscription_plans; attempt_id uuid:=gen_random_uuid();
begin perform private.require_platform();
 select * into strict s from public.subscriptions where tenant_id=t for update;
 if s.asaas_id is not null or s.status in ('cancelled','suspended') then raise exception 'Assinatura já vinculada ou indisponível';end if;
 select * into strict plan from public.subscription_plans where id=s.plan_id and active and monthly_cents>0;
 insert into private.billing_provisioning(tenant_id,attempt,monthly_cents,plan_id) values(t,attempt_id,plan.monthly_cents,plan.id);
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,auth.uid(),'billing.provision.requested',attempt_id::text);
 return jsonb_build_object('attempt',attempt_id,'monthly_cents',plan.monthly_cents,'name',plan.name);
end $$;
create function public.platform_finish_billing(t uuid,p_attempt uuid,p_subscription text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 perform 1 from private.billing_provisioning where tenant_id=t and attempt=p_attempt for update;
 if not found then raise exception 'Solicitação desconhecida';end if;
 if p_subscription is null then delete from private.billing_provisioning where tenant_id=t;
 else
 update public.subscriptions set asaas_id=p_subscription where tenant_id=t and (asaas_id is null or asaas_id=p_subscription);
 if not found then raise exception 'Vínculo divergente';end if;
 update private.billing_provisioning set provider_subscription=p_subscription where tenant_id=t;
 end if;
end $$;
revoke all on function public.platform_begin_billing(uuid),public.platform_finish_billing(uuid,uuid,text) from public,anon;
grant execute on function public.platform_begin_billing(uuid),public.platform_finish_billing(uuid,uuid,text) to authenticated;
create function public.platform_cancel_billing(t uuid,p_subscription text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_platform();
 update public.subscriptions set status='cancelled',period_end=now() where tenant_id=t and asaas_id=p_subscription;
 if not found then raise exception 'Assinatura divergente';end if;
 update public.tenants set status='cancelled' where id=t;
end $$;
revoke all on function public.platform_cancel_billing(uuid,text) from public,anon;
grant execute on function public.platform_cancel_billing(uuid,text) to authenticated;
commit;
