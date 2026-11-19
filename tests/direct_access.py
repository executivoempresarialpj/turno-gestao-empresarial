import unittest
from uuid import uuid4
import psycopg
import database

class DirectAccess(unittest.TestCase):
    setUpClass=classmethod(database.BookingLifecycle.setUpClass.__func__)
    def test_owner_can_create_company_and_activated_member(self):
        c=self.conn
        operator,user=uuid4(),uuid4()
        email="test@login.turno.invalid"
        c.execute("insert into auth.users(id,email) values(%s,'operator@test.invalid'),(%s,%s)",(operator,user,email))
        c.execute("insert into private.superadmins values(%s)",(operator,))
        plan=c.execute("select id from subscription_plans where name='Profissional'").fetchone()[0]
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(operator),))
        tenant=c.execute("select platform_direct_access(%s,%s,null,'Empresa teste','empresa-direta',%s,'owner')",(user,email,plan)).fetchone()[0]
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(user),))
        self.assertTrue(c.execute("select can_manage(%s)",(tenant,)).fetchone()[0])
        with self.assertRaises(psycopg.Error):
            c.execute("select platform_direct_access(%s,%s,null,'Outra','outra-direta',%s,'owner')",(user,email,plan))

if __name__=='__main__':unittest.main()
