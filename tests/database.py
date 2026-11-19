"""Integration tests against a disposable PostgreSQL database. Run directly."""
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]


class BookingLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admin = os.environ["TEST_DATABASE_URL"]
        database = "agenda_test_" + uuid4().hex
        cls.admin = psycopg.connect(admin, autocommit=True)
        cls.admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        cls.addClassCleanup(cls.admin.close)
        cls.addClassCleanup(cls.admin.execute, sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database)))
        cls.dsn = make_conninfo(admin, dbname=database)
        cls.conn = psycopg.connect(cls.dsn, autocommit=True)
        cls.addClassCleanup(cls.conn.close)
        for role in ["anon", "authenticated", "service_role"]:
            if not cls.admin.execute("select 1 from pg_roles where rolname=%s", (role,)).fetchone():
                cls.admin.execute(sql.SQL("create role {}").format(sql.Identifier(role)))
        cls.conn.execute("""
            create schema auth; create schema extensions;
            create schema storage;
            create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
            create table storage.objects(id uuid primary key,name text,bucket_id text);
            create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
            create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
            create function auth.uid() returns uuid language sql stable as
            $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
            grant usage on schema auth to authenticated,anon;
            create publication supabase_realtime;
        """)
        for path in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            cls.conn.execute(path.read_text())
        cls.conn.execute((ROOT / "supabase/seed.sql").read_text())

    def test_manager_catalog_and_availability(self):
        from psycopg.types.json import Jsonb
        with psycopg.connect(self.dsn) as c:
            user = uuid4()
            tenant = c.execute("insert into tenants(name,slug) values('Agenda de teste','agenda-gerente') returning id").fetchone()[0]
            c.execute("insert into subscriptions(tenant_id,plan_id,period_end) select %s,id,now()+interval '1 month' from subscription_plans limit 1", (tenant,))
            c.execute("insert into auth.users(id) values(%s)", (user,))
            c.execute("insert into tenant_memberships values(%s,%s,'owner',true)", (tenant,user))
            c.execute("set local role authenticated")
            c.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(user),))
            settings = dict(description='', address='', whatsapp='', instagram='', logo_url='', cover_url='', brand_color='#123456', min_notice_minutes=0, max_days=60, cancellation_policy='')
            hours = Jsonb([dict(weekday=i,opens_at='09:00',closes_at='12:00') for i in range(7)])
            c.execute("select manager_settings(%s,'Empresa','America/Sao_Paulo',%s,%s)", (tenant,Jsonb(settings),hours))
            service = Jsonb(dict(name='Consulta QA',description='',category='',price_cents=None,duration_minutes=30,buffer_minutes=15,image_url='',active=True))
            service_id = c.execute("select manager_catalog(%s,'service',null,%s,'{}','[]')",(tenant,service)).fetchone()[0]
            person = Jsonb(dict(name='Profissional QA',specialty='',photo_url='',commission_percent=5,active=True))
            professional = c.execute("select manager_catalog(%s,'professional',null,%s,%s,%s)",(tenant,person,[service_id],hours)).fetchone()[0]
            slots = "select count(*) from booking_slots('agenda-gerente',%s,current_date+2,%s)"
            self.assertGreater(c.execute(slots,(service_id,professional)).fetchone()[0],0)
            c.execute("select manager_block(%s,%s,(current_date+2)+time '09:00',(current_date+2)+time '12:00','Férias')",(tenant,professional))
            self.assertEqual(c.execute(slots,(service_id,professional)).fetchone()[0],0)
            c.rollback()

    def test_onboarding_and_saas_billing(self):
        c = self.conn
        c.execute("reset role")
        operator, invited = uuid4(), uuid4()
        c.execute("insert into auth.users(id,email,email_confirmed_at) values(%s,'operator@example.test',now()),(%s,'owner@example.test',now())",(operator,invited))
        c.execute("insert into private.superadmins values(%s)",(operator,))
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(operator),))
        plan = c.execute("select id from subscription_plans where name='Profissional'").fetchone()[0]
        tenant = c.execute("select platform_create_company('Empresa QA','empresa-qa',%s,'owner@example.test')",(plan,)).fetchone()[0]
        c.execute("select platform_subscription(%s,'Empresa QA',%s,'trial',now()+interval '2 days','sub_test')",(tenant,plan))
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(invited),))
        c.execute("select accept_platform_invites()")
        self.assertTrue(c.execute("select can_manage(%s)",(tenant,)).fetchone()[0])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            c.execute("select platform_create_company('Outra','outra',%s,'owner@example.test')",(plan,))
        c.execute("reset role")
        c.execute("set role service_role")
        for _ in range(2):
            c.execute("select asaas_event('evt_qa','PAYMENT_RECEIVED','sub_test','pay_test',10000,current_date)")
        c.execute("reset role")
        self.assertEqual(c.execute("select status from subscriptions where tenant_id=%s",(tenant,)).fetchone()[0],'active')
        self.assertEqual(c.execute("select sum(amount_cents) from billing_events where tenant_id=%s",(tenant,)).fetchone()[0],10000)

    def test_public_lifecycle_and_accounting(self):
        c = self.conn
        db = lambda query, params=(): c.execute(query, params).fetchone()[0]
        t, s, p = c.execute("select tenant_id,service_id,professional_id from professional_services").fetchone()
        owner, outsider = uuid4(), uuid4()
        c.execute("insert into auth.users(id) values(%s),(%s)", (owner,outsider))
        c.execute("insert into tenant_memberships values(%s,%s,'owner',true)", (t,owner))
        c.execute("set role anon")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            db("select booking_catalog('demonstracao-local')")
        c.execute("set role service_role")
        for i in range(13):
            self.assertEqual(db("select reserve_request_quota(%s,true)", ("a"*64,)), i < 12)
        self.assertTrue(db("select booking_catalog('demonstracao-local')"))
        slots = [r[0] for r in c.execute("select starts_at from booking_slots('demonstracao-local',%s,current_date+2,%s)", (s,p))]
        self.assertGreater(len(slots),5)
        def book(start, key, token):
            with psycopg.connect(self.dsn) as worker:
                worker.execute("set role service_role")
                return worker.execute("""select booking_create('demonstracao-local',%s,%s,%s,
                'Cliente Teste','11999990000',null,null,%s,%s)""", (s,p,start,key,token)).fetchone()[0]
        payloads = [(uuid4(),uuid4()), (uuid4(),uuid4())]
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = [pool.submit(book,slots[0],*pair) for pair in payloads]
        winners = [i for i,attempt in enumerate(attempts) if attempt.exception() is None]
        self.assertEqual(len(winners),1, [str(a.exception()) for a in attempts])
        key, token = payloads[winners[0]]
        reservation = attempts[winners[0]].result()
        self.assertEqual(book(slots[0],key,token),reservation)
        self.assertTrue(db("select booking_receipt(%s)",(token,)))
        c.execute("select customer_update_booking(%s,%s,%s)", (token,slots[-1],p))
        replacement = book(slots[0],uuid4(),uuid4())
        c.execute("select customer_update_booking(%s)", (token,))
        self.assertIn(slots[-1],[r[0] for r in c.execute("select starts_at from booking_slots('demonstracao-local',%s,current_date+2,%s)",(s,p))])
        c.execute("reset role")
        c.execute("set role authenticated")
        db("select set_config('request.jwt.claim.sub',%s,false)",(str(outsider),))
        self.assertEqual(db("select count(*) from appointments"),0)
        db("select set_config('request.jwt.claim.sub',%s,false)",(str(owner),))
        self.assertEqual(db("select count(*) from notifications where appointment_id=%s",(reservation,)),3)
        c.execute("select manager_update_booking(%s,'completed')",(replacement,))
        self.assertEqual(db("select count(*) from payments"),0)
        payment = (t,replacement,4500,'payment','PIX',uuid4())
        receipt = db("select record_payment(%s,%s,%s,%s,%s,%s)",payment)
        self.assertEqual(db("select record_payment(%s,%s,%s,%s,%s,%s)",payment),receipt)
        db("select record_expense(%s,'Materiais','Insumos',1000,current_date,current_date,'PIX',%s)",(t,uuid4()))
        self.assertEqual(db("select (select sum(amount_cents) from payments)-(select sum(amount_cents) from expenses)"),3500)
        dashboard = db("select dashboard(%s,current_date-1,current_date+3)",(t,))
        self.assertEqual((dashboard['received'],dashboard['spent']),(4500,1000))
        operational = db("select analytics(%s,current_date-1,current_date+3)",(t,))
        self.assertEqual(operational['ticket'],4500)
        self.assertEqual(operational['expenses'],[{'name':'Insumos','cash':1000}])
        self.assertEqual(operational['comparison'][1]['count'],2)
        self.assertEqual(operational['comparison'][1]['cash'],4500)
        self.assertEqual(operational['cancelRate'],50)
        self.assertGreater(operational['occupancy'],0)
        self.assertLessEqual(operational['occupancy'],100)
        self.assertEqual(sum(row['cash'] for row in operational['team']),4500)
        c.execute("reset role")
        c.execute("update subscriptions set status='suspended' where tenant_id=%s",(t,))
        self.assertFalse(db("select tenant_available(%s)",(t,)))
        c.execute("update subscriptions set status='active' where tenant_id=%s",(t,))
        self.assertTrue(db("select tenant_available(%s)",(t,)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
