begin;
update public.subscription_plans set active=false where name<>'Turno';
insert into public.subscription_plans(name,monthly_cents,annual_cents,limits,features,trial_days,active)
 values('Turno',8000,0,'{}','{"agenda":true,"finance":true,"reports":true}',14,true)
 on conflict(name) do update set monthly_cents=8000,annual_cents=0,limits='{}',features='{"agenda":true,"finance":true,"reports":true}',active=true;
commit;
