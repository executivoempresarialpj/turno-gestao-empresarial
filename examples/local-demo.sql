-- Executar manualmente em Postgres local com psql, após as migrations.
-- Requer variável owner_email correspondente a um usuário de teste criado pelo Auth.
\set ON_ERROR_STOP on
begin;
select set_config('turno.demo_owner', :'owner_email', true);
do $$
declare
  tenant uuid;
  operator_id uuid;
  service uuid;
  professional uuid;
  weekday int;
begin
  select id into strict operator_id from auth.users where lower(email)=lower(current_setting('turno.demo_owner'));
  insert into public.tenants(name,slug,status)
    values ('Demonstração local · Estúdio Horizonte','demo-estudio-horizonte','trial') returning id into tenant;
  update public.tenant_settings set description='Estabelecimento fictício para testes locais.',
    min_notice_minutes=0, address='Endereço de demonstração' where tenant_id=tenant;
  insert into public.subscriptions(tenant_id,plan_id,period_end)
    select tenant,id,now()+interval '30 days' from public.subscription_plans where name='Profissional';
  insert into public.tenant_memberships values(tenant,operator_id,'owner',true);
  insert into public.professionals(tenant_id,name,specialty) values(tenant,'Ana Demo','Consultoria') returning id into professional;
  insert into public.services(tenant_id,name,description,price_cents,duration_minutes)
    values(tenant,'Consulta inicial','Avaliação individual',12000,45) returning id into service;
  insert into public.professional_services values(tenant,professional,service);
  for weekday in 1..6 loop
    insert into public.working_hours(tenant_id,professional_id,weekday,opens_at,closes_at)
    values(tenant,null,weekday,'09:00','12:00'),(tenant,null,weekday,'13:00','18:00'),
          (tenant,professional,weekday,'09:00','12:00'),(tenant,professional,weekday,'13:00','18:00');
  end loop;
end $$;
commit;
