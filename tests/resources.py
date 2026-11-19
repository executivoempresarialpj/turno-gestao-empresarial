"""Two different professionals share a room. Exercise real overlapping writes."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
import unittest

import psycopg
import database


class ResourceConflict(unittest.TestCase):
    setUpClass = classmethod(database.BookingLifecycle.setUpClass.__func__)

    def test_two_professionals_share_room_and_outsider_cannot_modify(self):
        c = self.conn
        t, s, first = c.execute("select tenant_id,service_id,professional_id from professional_services").fetchone()
        second = c.execute("insert into professionals(tenant_id,name) values(%s,'Equipe 2') returning id",(t,)).fetchone()[0]
        c.execute("insert into professional_services values(%s,%s,%s)",(t,second,s))
        c.execute("""insert into working_hours(tenant_id,professional_id,weekday,opens_at,closes_at)
          select tenant_id,%s,weekday,opens_at,closes_at from working_hours where professional_id=%s""",(second,first))
        room = c.execute("insert into resources(tenant_id,name) values (%s,'Sala A') returning id",(t,)).fetchone()[0]
        c.execute("insert into service_resources values (%s,%s,%s)",(t,room,s))
        start = c.execute("select starts_at from booking_slots('demonstracao-local',%s,current_date+3,%s) limit 1",(s,first)).fetchone()[0]
        barrier = Barrier(2)
        def submit(professional):
            with psycopg.connect(self.dsn) as conn:
                conn.execute("set role service_role")
                barrier.wait(timeout=8)
                return conn.execute("""select booking_create('demonstracao-local',%s,%s,%s,
                 'Visitante','11999901111',null,null,%s,%s)""",(s,professional,start,uuid4(),uuid4())).fetchone()[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = [pool.submit(submit,p) for p in (first,second)]
        self.assertEqual(sum(f.exception() is None for f in outcomes),1)
        other = c.execute("insert into tenants(name,slug) values('Outro','outro') returning id").fetchone()[0]
        c.execute("insert into subscriptions(tenant_id,plan_id,period_end) select %s,id,now()+interval '10 days' from subscription_plans limit 1",(other,))
        uid=uuid4()
        c.execute("insert into auth.users(id) values (%s)",(uid,))
        c.execute("insert into tenant_memberships values (%s,%s,'owner',true)",(other,uid))
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(uid),))
        self.assertEqual(c.execute("update resources set name='Teste' where id=%s",(room,)).rowcount,0)
        self.assertEqual(c.execute("delete from resources where id=%s",(room,)).rowcount,0)
        self.assertEqual(c.execute("select count(*) from appointments where tenant_id=%s",(t,)).fetchone()[0],0)

if __name__ == "__main__":
    unittest.main()
