begin;
create function public.platform_manual_subscription(t uuid,p_name text,p_plan uuid,p_status text,p_end timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_platform();
 if p_end is null then raise exception 'Informe o vencimento';end if;
 update public.tenants set name=p_name,status=p_status where id=t;
 if not found then raise exception 'Empresa não encontrada';end if;
 update public.subscriptions set plan_id=p_plan,status=case when p_status='blocked' then 'suspended' else p_status end,period_end=p_end where tenant_id=t;
end $$;
revoke all on function public.platform_manual_subscription(uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.platform_manual_subscription(uuid,text,uuid,text,timestamptz) to authenticated;
revoke execute on function public.platform_begin_billing(uuid),public.platform_finish_billing(uuid,uuid,text),public.platform_cancel_billing(uuid,text),public.asaas_event(text,text,text,text,int,date) from authenticated,service_role;
commit;
