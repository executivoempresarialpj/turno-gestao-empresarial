import unittest
from uuid import uuid4
import database
class SimpleBooking(unittest.TestCase):
 setUpClass=classmethod(database.BookingLifecycle.setUpClass.__func__)
 def test_date_service_booking_and_cash(self):
  c=self.conn
  t=c.execute("insert into tenants(name,slug,status) values('Novo','novo','active') returning id").fetchone()[0]
  c.execute("insert into subscriptions(tenant_id,plan_id,period_end) select %s,id,now()+interval '1 month' from subscription_plans where name='Turno'",(t,))
  s=c.execute("update services set name='Lavagem',price_cents=8000 where tenant_id=%s returning id",(t,)).fetchone()[0]
  c.execute("insert into date_slots values(%s,current_date+3,array['13:20'::time])",(t,))
  c.execute("set role service_role")
  info=c.execute("select simple_schedule('novo',current_date+3)").fetchone()[0]
  self.assertEqual(info['slots'],[{'time':'13:20','busy':False}])
  token,key=uuid4(),uuid4()
  a=c.execute("select simple_book('novo',current_date+3,'13:20','Visitante','79999009358','',%s,%s,%s)",(key,token,s)).fetchone()[0]
  receipt=c.execute("select booking_receipt(%s)",(token,)).fetchone()[0]
  self.assertEqual(receipt['price'],8000)
  self.assertEqual(receipt['service'],'Lavagem')
  c.execute("reset role")
  u=uuid4()
  c.execute("insert into auth.users(id) values(%s)",(u,))
  c.execute("insert into tenant_memberships values(%s,%s,'owner',true)",(t,u))
  c.execute("set role authenticated")
  c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(u),))
  c.execute("select manual_receipt(%s,12500,'PIX','Cliente externo',%s)",(t,uuid4()))
  r=c.execute("select financial_report(%s,current_date,current_date+4)",(t,)).fetchone()[0]
  self.assertEqual(sum(e['amount_cents'] for e in r['entries']),12500)
  dashboard=c.execute("select dashboard(%s,current_date,current_date+4)",(t,)).fetchone()[0]
  self.assertEqual(dashboard['forecast'],8000)
  self.assertEqual(dashboard['received'],12500)
if __name__=='__main__':unittest.main()
