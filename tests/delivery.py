"""Validate durable dispatch independently of any external provider credentials."""
import unittest
from uuid import uuid4

from database import BookingLifecycle as Base


class Dispatch(unittest.TestCase):
    setUpClass = classmethod(Base.setUpClass.__func__)

    def test_consent_claim_retry_and_provider_acceptance(self):
        c = self.conn
        service, professional = c.execute("select service_id,professional_id from professional_services limit 1").fetchone()
        c.execute("set role service_role")
        slot = c.execute("select starts_at from booking_slots('demonstracao-local',%s,current_date+2,%s) limit 1",
                         (service, professional)).fetchone()[0]
        c.execute("""select booking_create('demonstracao-local',%s,%s,%s,'Teste envio',
                     '11987654321','entrega@example.test','',%s,%s,true,false)""",
                  (service, professional, slot, uuid4(), uuid4()))
        c.execute("reset role")
        c.execute("set role service_role")
        self.assertEqual(c.execute("select * from claim_deliveries(array['whatsapp'])").fetchall(), [])
        first = c.execute("select id,lease,destination,attempt from claim_deliveries(array['email'])").fetchone()
        self.assertEqual(first[2:], ('entrega@example.test', 1))
        self.assertFalse(c.execute("select * from claim_deliveries(array['email'])").fetchall())
        c.execute("select finish_delivery(%s,%s,'queued',null,'http_429')", first[:2])
        c.execute("reset role")
        c.execute("update private.delivery_jobs set next_attempt=now() where id=%s", first[:1])
        c.execute("set role service_role")
        second = c.execute("select id,lease,attempt from claim_deliveries(array['email'])").fetchone()
        self.assertEqual(second[2], 2)
        self.assertNotEqual(first[1], second[1])
        c.execute("select finish_delivery(%s,%s,'accepted','test-reference',null)", second[:2])
        c.execute("reset role")
        self.assertEqual(c.execute("select state,provider_reference from private.delivery_jobs where id=%s", first[:1]).fetchone(),
                         ('accepted', 'test-reference'))


if __name__ == '__main__':
    unittest.main(defaultTest="Dispatch", verbosity=2)
