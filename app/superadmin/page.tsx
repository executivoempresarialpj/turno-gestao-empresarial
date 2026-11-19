import AdminInsights from "@/components/AdminInsights";
import { redirect } from "next/navigation";
import { serverDb } from "@/lib/server";
import Form from "./Form";
import "./style.css";
export const dynamic = "force-dynamic";
const money = (v: number) =>
  (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statuses: Record<string, string> = {
  active: "Ativa",
  trial: "Em teste",
  overdue: "Inadimplente",
  cancelled: "Cancelada",
  suspended: "Suspensa",
  blocked: "Bloqueada",
};
const roleOptions = (
  <>
    <option value="owner">Proprietário</option>
    <option value="admin">Administrador</option>
    <option value="staff">Funcionário</option>
  </>
);
const hidden = (key: string, value: string) => (
  <input type="hidden" name={key} value={value} />
);
const date = (v: string) =>
  new Date(v).toLocaleDateString("pt-BR", { timeZone: "UTC" });
export default async function Platform({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const c = await serverDb();
  if (!(await c.rpc("is_superadmin")).data) redirect("/login");
  const filters = await searchParams;
  const [tenants, plans, subs, users, logs, summary] = await Promise.all([
    c.from("tenants").select("id,name,slug,status").order("name"),
    c.from("subscription_plans").select("*").order("monthly_cents"),
    c.from("subscriptions").select("*"),
    c.from("tenant_memberships").select("*"),
    c
      .from("audit_logs")
      .select("id,action,created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    c.rpc("platform_summary"),
  ]);
  if ([tenants, plans, subs, users, logs, summary].some((r) => r.error))
    throw Error("Falha ao carregar dados administrativos");
  const data = summary.data;
  const businesses = tenants.data ?? [],
    catalog = plans.data ?? [];
  const planOptions = catalog.map((p) => (
      <option key={p.id} value={p.id}>
        {p.name}
      </option>
    )),
    statOptions = Object.entries(statuses).map(([k, v]) => (
      <option key={k} value={k}>
        {v}
      </option>
    ));
  return (
    <main className="platform">
      <header>
        <strong>Turno <small>ADMINISTRAÇÃO</small></strong>
        <form
          action={async () => {
            "use server";
            await (await serverDb()).auth.signOut();
            redirect("/login");
          }}
        >
          <button>Sair</button>
        </form>
      </header>
      <div className="platform-body">
        <nav>
          <a href="#empresas">Empresas</a>
          <a href="#planos">Planos</a>
          <a href="#auditoria">Auditoria</a>
        </nav>
        <h1>Seu negócio, em uma visão.</h1><p className="platform-intro">Gerencie empresas, acessos e assinaturas em um só lugar.</p>
        <div className="platform-metrics">
          {[
            ["Empresas", data.companies],
            ["Em teste", data.trials],
            ["Assinaturas ativas", data.active],
            ["Inadimplentes", data.overdue],
            ["Suspensas", data.suspended],
            ["MRR", money(data.mrr)],
            ["ARR", money(data.mrr * 12)],
            ["Recebimentos líquidos", money(data.received)],
            ["Agendamentos", data.appointments],
            ["Usuários", data.users],
            ["Assinaturas canceladas", data.cancelled],
          ].map(([label, value]) => (
            <article key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        <section id="empresas">
          <h2>Empresas</h2>
          <details open>
            <summary>Nova empresa</summary>
            <Form label="Criar empresa e acesso">
              {hidden("op", "create")}
              <label>
                Nome comercial
                <input required name="name" maxLength={150} />
              </label>
              <label>
                Identificador público
                <input
                  required
                  name="slug"
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={80}
                />
              </label>
              <label>
                Plano
                <select name="plan">
                  {catalog
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Usuário de acesso
                <input required name="username" pattern="[a-z0-9][a-z0-9._-]{2,49}" placeholder="empresa.teste" autoComplete="off" />
              </label><label>Senha inicial<input name="password" type="password" minLength={12} required autoComplete="new-password"/>
              </label>
            </Form>
          </details>
          <form method="get">
            <label>
              Pesquisar empresa
              <input name="q" defaultValue={filters.q} />
            </label>
            <label>
              Status
              <select name="status" defaultValue={filters.status}>
                <option value="">Todos</option>
                {statOptions}
              </select>
            </label>
            <button>Filtrar</button>
          </form>
          {businesses
            .filter((t) => !filters.status || t.status === filters.status)
            .filter((t) =>
              t.name.toLowerCase().includes((filters.q ?? "").toLowerCase()),
            )
            .map((t) => {
              const s = subs.data?.find((s) => s.tenant_id === t.id);
              return (
                <details key={t.id}>
                  <summary>
                    {t.name} · {statuses[t.status]}
                  </summary>
                  <p>
                    /agendar/{t.slug} · Vencimento{" "}
                    {s ? date(s.period_end) : "indisponível"}
                  </p>
                  <Form label="Atualizar empresa">
                    {hidden("op", "edit")}
                    {hidden("tenant", t.id)}
                    <label>
                      Nome
                      <input required name="name" defaultValue={t.name} />
                    </label>
                    <label>
                      Plano
                      <select name="plan" defaultValue={s?.plan_id}>
                        {planOptions}
                      </select>
                    </label>
                    <label>
                      Status de acesso
                      <select name="status" defaultValue={t.status}>
                        {statOptions}
                      </select>
                    </label>
                    <label>
                      Vencimento do acesso (UTC)
                      <input
                        type="date"
                        required
                        name="end"
                        defaultValue={s?.period_end.slice(0, 10)}
                      />
                    </label>
                  </Form>
                  <h3>Retenção da empresa</h3>
                  <Form label="Aplicar ação de retenção">
                    {hidden("op", "retention")}
                    {hidden("tenant", t.id)}
                    <label>
                      Ação
                      <select name="operation">
                        <option value="schedule">
                          Bloquear e iniciar retenção
                        </option>
                        <option value="restore">Retirar solicitação</option>
                        <option value="purge">
                          Excluir definitivamente após retenção
                        </option>
                      </select>
                    </label>
                    <label>
                      Confirme o identificador {t.slug}
                      <input name="confirm" required />
                    </label>
                  </Form>
                  <h3>Criar acesso</h3>
                  <Form label="Criar usuário">
                    {hidden("op", "invite")}
                    {hidden("tenant", t.id)}
                    <label>
                      Usuário
                      <input name="username" required pattern="[a-z0-9][a-z0-9._-]{2,49}" />
                    </label><label>Senha inicial<input name="password" type="password" minLength={12} required autoComplete="new-password"/>
                    </label>
                    <label>
                      Permissão
                      <select name="role" defaultValue="admin">
                        {roleOptions}
                      </select>
                    </label>
                  </Form>
                  {users.data
                    ?.filter((m) => m.tenant_id === t.id)
                    .map((m) => (
                      <div key={m.user_id}>
                        <Form label="Encerrar sessões nesta empresa">
                          {hidden("op", "revoke")}
                          {hidden("tenant", t.id)}
                          {hidden("user", m.user_id)}
                          <span>Usuário {m.user_id}</span>
                        </Form>
                        <Form label="Definir nova senha">{hidden("op","password")}{hidden("tenant",t.id)}{hidden("user",m.user_id)}<label>Nova senha<input type="password" name="password" required minLength={12} autoComplete="new-password"/></label></Form>
                        <Form label="Atualizar acesso">
                          {hidden("op", "member")}
                          {hidden("tenant", t.id)}
                          {hidden("user", m.user_id)}
                          <span>Usuário {m.user_id}</span>
                          <label>
                            Permissão
                            <select name="role" defaultValue={m.role}>
                              {roleOptions}
                            </select>
                          </label>
                          <label>
                            Acesso
                            <select
                              name="active"
                              defaultValue={String(m.active)}
                            >
                              <option value="true">Ativo</option>
                              <option value="false">Desativado</option>
                            </select>
                          </label>
                        </Form>
                      </div>
                    ))}
                </details>
              );
            })}
        </section>
        <AdminInsights />
        <section id="planos">
          <h2>Planos comerciais</h2>
          {catalog.filter(p=>p.name==="Turno").map(p=><p key={p.id}><strong>{p.name}</strong> · {money(p.monthly_cents)} por mês · controle manual de vencimento por empresa.</p>)}
        </section>
        <section>
          <h2>Configuração global</h2>
          <Form label="Atualizar prazo de retenção">
            {hidden("op", "retention")}
            {hidden("operation", "configure")}
            <label>
              Dias de retenção para novas solicitações
              <input type="number" name="days" required min={1} max={3650} />
            </label>
          </Form>
        </section>
        <section id="auditoria">
          <h2>Auditoria recente</h2>
          {logs.data?.length ? (
            logs.data.map((row) => (
              <p key={row.id}>
                {date(row.created_at)} · {row.action}
              </p>
            ))
          ) : (
            <p>Nenhuma atividade registrada.</p>
          )}
        </section>
      </div>
    </main>
  );
}
