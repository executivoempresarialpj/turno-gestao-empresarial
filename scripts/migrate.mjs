import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
if(process.env.VERCEL_ENV!=='production')process.exit(0);
const url=new URL(process.env.POSTGRES_URL_NON_POOLING);
url.searchParams.delete('sslmode');
const client = new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('./supabase-ca.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
try {
 await client.connect();
 await client.query("select pg_advisory_lock(hashtext('turno.deployment'))");
 await client.query("create schema if not exists supabase_migrations");
 await client.query("create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text)");
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const [version,...name]=file.slice(0,-4).split('_');
  if((await client.query('select version from supabase_migrations.schema_migrations where version=$1',[version])).rowCount)continue;
  const sql=(await readFile('supabase/migrations/'+file,'utf8')).replace(/^\s*begin;/i,'').replace(/commit;\s*$/i,'');
  await client.query('begin');
  try{
   await client.query(sql);
   await client.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[version,name.join('_')]);
   await client.query('commit');
   console.log('Migração aplicada: '+file);
  }catch(error){await client.query('rollback');throw error}
 }
 if(process.env.TURNO_INITIAL_OWNER_ID){
  const result=await client.query(
   'insert into private.superadmins(user_id) select id from auth.users where id=$1 and lower(email)=lower($2) on conflict do nothing',
   [process.env.TURNO_INITIAL_OWNER_ID,process.env.TURNO_INITIAL_OWNER_EMAIL]
  );
  const owner=await client.query('select 1 from private.superadmins where user_id=$1',[process.env.TURNO_INITIAL_OWNER_ID]);
  if(owner.rowCount!==1)throw Error('Conta de proprietário indisponível.');
  console.log('Acesso inicial de proprietário verificado.');
 }
} finally {await client.end()}
