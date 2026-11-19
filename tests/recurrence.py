"""Run as a script with the same disposable database settings as database.py."""
import unittest
from uuid import uuid4
import database

class RecurringObligations(unittest.TestCase):
    def test_end_of_month_retry_and_settlement(self):
        fixture = database.BookingLifecycle
        fixture.setUpClass()
        self.addCleanup(fixture.doClassCleanups)
        c = fixture.conn
        owner = uuid4()
        tenant = c.execute("select id from tenants where slug='demonstracao-local'").fetchone()[0]
        c.execute("insert into auth.users(id) values(%s)", (owner,))
        c.execute("insert into tenant_memberships values(%s,%s,'owner',true)", (tenant,owner))
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(owner),))
        params = (tenant,uuid4())
        sql = """select record_expense_series(%s,'Internet','Internet',8500,'2028-01-31',null,null,%s,'monthly',3)"""
        series = c.execute(sql,params).fetchone()[0]
        self.assertEqual(c.execute(sql,params).fetchone()[0],series)
        installments = c.execute("select id,due_date::text from expenses where series_id=%s order by installment",(series,)).fetchall()
        self.assertEqual([row[1] for row in installments],['2028-01-31','2028-02-29','2028-03-31'])
        c.execute("select settle_expense(%s,%s,'2028-02-01','PIX')",(tenant,installments[0][0]))
        feb = c.execute("select financial_report(%s,'2028-02-01','2028-02-29')",(tenant,)).fetchone()[0]
        self.assertEqual(len(feb['expenses']),2)
        self.assertEqual(sum(e['amount_cents'] for e in feb['expenses'] if e['paid_on']),8500)
        self.assertEqual(sum(e['amount_cents'] for e in feb['expenses'] if e['paid_on'] is None),8500)

if __name__ == '__main__':
    unittest.main(verbosity=2)
