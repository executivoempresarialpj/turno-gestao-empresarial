-- Opcional e exclusivo de desenvolvimento. Sem clientes, reservas ou pagamentos.
begin;
do $$
declare t uuid; p uuid; s uuid;
begin
 if exists(select 1 from tenants where slug='demonstracao-local') then return; end if;
 insert into tenants(name,slug,status) values('Estúdio Horizonte · Demonstração','demonstracao-local','active') returning id into t;
 insert into subscriptions(tenant_id,plan_id,status,period_end) select t,id,'active',now()+interval '1 year' from subscription_plans where name='Profissional';
 update tenant_settings set description='Estabelecimento fictício para testes locais.',address='Endereço demonstrativo', min_notice_minutes=0 where tenant_id=t;
 insert into professionals(tenant_id,name,specialty) values(t,'Lia · Demonstração','Consultoria') returning id into p;
 insert into services(tenant_id,name,description,price_cents,duration_minutes) values(t,'Consulta demonstrativa','Conversa inicial de avaliação.',9000,45) returning id into s;
 insert into professional_services values(t,p,s);
 insert into working_hours(tenant_id,weekday,opens_at,closes_at) select t,d,'09:00','17:00' from generate_series(0,6) d;
end $$;
commit;
