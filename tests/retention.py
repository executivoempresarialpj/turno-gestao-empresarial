import unittest
from uuid import uuid4

import psycopg
import database


class RetentionAndSessions(unittest.TestCase):
    setUpClass = classmethod(database.BookingLifecycle.setUpClass.__func__)

    def test_block_grace_purge_and_session_revocation(self):
        c = self.conn
        company, slug = c.execute("select id,slug from tenants limit 1").fetchone()
        operator, member, session = uuid4(), uuid4(), uuid4()
        c.execute("create table auth.sessions(id uuid primary key,user_id uuid not null)")
        c.execute("insert into auth.users(id) values (%s),(%s)", (operator, member))
        c.execute("insert into auth.sessions values (%s,%s)", (session, member))
        c.execute("insert into private.superadmins values (%s)", (operator,))
        c.execute("insert into tenant_memberships values (%s,%s,'owner',true)", (company,member))
        c.execute("set role authenticated")
        def identity(user):
            c.execute("select set_config('request.jwt.claim.sub',%s,false)", (str(user),))
        identity(operator)
        c.execute("select platform_revoke_sessions(%s,%s)", (company,member))
        identity(member)
        c.execute("select set_config('request.jwt.claims', jsonb_build_object('session_id',%s::text)::text,false)", (str(session),))
        self.assertFalse(c.execute("select can_manage(%s)", (company,)).fetchone()[0])
        identity(operator)
        c.execute("select platform_retention(%s,'schedule',%s)", (company,slug))
        with self.assertRaises(psycopg.Error):
            c.execute("select platform_retention(%s,'purge',%s)", (company,slug))
        c.execute("reset role")
        c.execute("update private.tenant_retention set eligible_at=now()-interval '1 day' where tenant_id=%s", (company,))
        c.execute("set role authenticated")
        c.execute("select platform_retention(%s,'purge',%s)", (company,slug))
        self.assertEqual(c.execute("select count(*) from tenants where id=%s", (company,)).fetchone()[0],0)

if __name__ == "__main__":
    unittest.main()
