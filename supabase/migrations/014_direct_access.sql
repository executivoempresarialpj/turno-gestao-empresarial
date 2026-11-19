begin;
create function public.platform_direct_access(p_user uuid,p_email text,p_tenant uuid,p_name text,p_slug text,p_plan uuid,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid:=p_tenant;lim int;
begin
 perform private.require_platform();
 if not exists(select from auth.users where id=p_user and email=p_email) then raise exception 'Usuário inválido';end if;
 if t is null then
  t:=public.platform_create_company(p_name,p_slug,p_plan,p_email);
  update public.subscriptions set period_end=greatest(period_end,now()+interval '14 days') where tenant_id=t;
 end if;
 perform 1 from public.tenants where id=t for update;
 select (p.limits->>'users')::int into lim from public.subscriptions s join public.subscription_plans p on p.id=s.plan_id where s.tenant_id=t;
 if lim is not null and (select count(*) from public.tenant_memberships where tenant_id=t and active)>=lim then raise exception 'Limite de usuários atingido';end if;
 insert into public.tenant_memberships values(t,p_user,p_role,true);
 delete from private.access_invites where tenant_id=t and email=p_email;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,auth.uid(),'access.created',p_user::text);
 return t;
end $$;
revoke all on function public.platform_direct_access(uuid,text,uuid,text,text,uuid,text) from public,anon;
grant execute on function public.platform_direct_access(uuid,text,uuid,text,text,uuid,text) to authenticated;
commit;
