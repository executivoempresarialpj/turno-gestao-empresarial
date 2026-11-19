"""Exercises provisioning, refund, delinquency, reconciliation and cancellation."""
import unittest
from uuid import uuid4

import psycopg
import database


class BillingLifecycle(unittest.TestCase):
    setUpClass = classmethod(database.BookingLifecycle.setUpClass.__func__)

    def test_monthly_contract(self):
        c = self.conn
        admin = uuid4()
        c.execute("insert into auth.users(id) values (%s)", (admin,))
        c.execute("insert into private.superadmins values (%s)", (admin,))
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claim.sub',%s,false)", (str(admin),))
        c.execute("select platform_plan(null,'Comercial',7990,82900,14,true,'{}','{}')")
        plan = c.execute("select id from subscription_plans where name='Comercial'").fetchone()[0]
        t = c.execute("select platform_create_company('Contrato QA','contrato-qa',%s,'owner@example.test')", (plan,)).fetchone()[0]
        intent = c.execute("select platform_begin_billing(%s)", (t,)).fetchone()[0]
        self.assertEqual(intent['monthly_cents'], 7990)
        with self.assertRaises(psycopg.errors.UniqueViolation):
            c.execute("select platform_begin_billing(%s)", (t,))
        c.execute("select platform_finish_billing(%s,%s,'sub_qa')", (t,intent['attempt']))
        c.execute("select platform_subscription(%s,'Contrato QA',%s,'trial',now()-interval '1 day','sub_qa')", (t,plan))
        c.execute("set role service_role")
        def event(event_id, kind):
            c.execute("select asaas_event(%s,%s,'sub_qa','pay_qa',7990,current_date)", (event_id,kind))
        event('evt_1','PAYMENT_OVERDUE')
        c.execute("reset role")
        self.assertEqual(c.execute("select status from subscriptions where tenant_id=%s", (t,)).fetchone()[0], "overdue")
        c.execute("set role service_role")
        event('evt_2','PAYMENT_RECEIVED')
        event('evt_2','PAYMENT_RECEIVED')
        event('evt_3','PAYMENT_RECEIVED')
        event('evt_4','PAYMENT_REFUNDED')
        event('evt_5','PAYMENT_REFUNDED')
        c.execute("reset role")
        self.assertEqual(c.execute("select sum(amount_cents),count(*) from billing_events where tenant_id=%s",(t,)).fetchone(),(0,5))
        c.execute("set role authenticated")
        c.execute("select platform_cancel_billing(%s,'sub_qa')", (t,))
        self.assertFalse(c.execute("select tenant_available(%s)", (t,)).fetchone()[0])


if __name__ == "__main__":
    unittest.main()
