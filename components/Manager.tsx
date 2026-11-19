"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { db } from "@/lib/db";
import { useTenant } from "@/lib/tenant";
import { CalendarWorkspace } from "./ManagerCalendar";
import "./manager.css";

export type Row = Record<string, any>;
type Data = Record<string, Row[]>;
export const statusNames: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  in_progress: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Não compareceu",
};
export const money = (c: number | null) =>
  c == null
    ? "Sob consulta"
    : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const days = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mgfield">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} className="mgdialog" onCancel={close}>
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label="Fechar">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Hours({ initial }: { initial: Row[] }) {
  const [hours, set] = useState(initial);
  return (
    <fieldset>
      <legend>Horários de atendimento</legend>
      <p className="mgmuted">
        Adicione um intervalo para cada turno. Separe os turnos para reservar o
        almoço.
      </p>
      <input type="hidden" name="hours" value={JSON.stringify(hours)} />
      {hours.map((h, i) => (
        <div className="mghour" key={i}>
          <select
            aria-label="Dia"
            value={h.weekday}
            onChange={(e) =>
              set(
                hours.map((a, j) =>
                  i === j ? { ...a, weekday: +e.target.value } : a,
                ),
              )
            }
          >
            {days.map((v, n) => (
              <option key={v} value={n}>
                {v}
              </option>
            ))}
          </select>
          {["opens_at", "closes_at"].map((k, n) => (
            <input
              required
              aria-label={n ? "Fim" : "Início"}
              key={k}
              type="time"
              value={String(h[k]).slice(0, 5)}
              onChange={(e) =>
                set(
                  hours.map((a, j) =>
                    i === j ? { ...a, [k]: e.target.value } : a,
                  ),
                )
              }
            />
          ))}
          <button
            type="button"
            aria-label="Excluir turno"
            onClick={() => set(hours.filter((_, j) => i !== j))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          set([...hours, { weekday: 1, opens_at: "09:00", closes_at: "18:00" }])
        }
      >
        + Turno
      </button>
    </fieldset>
  );
}
export function csv(rows: string[][]) {
  const body = rows
    .map((r) =>
      r
        .map(
          (cell) =>
            '"' +
            (/^[=+@\-\t\r]/.test(cell) ? "'" : "") +
            cell.replaceAll('"', '""') +
            '"',
        )
        .join(";"),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "clientes.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const titles: Record<string, string> = {
  clientes: "Clientes",
  agenda: "Agenda",
  profissionais: "Profissionais",
  servicos: "Serviços",
  configuracoes: "Configurações",
};
const descriptions: Record<string, string> = {
  clientes: "Histórico de relacionamento e atendimento.",
  agenda: "Organize os atendimentos e a disponibilidade da equipe.",
  profissionais: "Gerencie sua equipe e os horários de cada profissional.",
  servicos: "Catálogo de serviços disponíveis para agendamento.",
  configuracoes: "Perfil público, identidade visual e regras de reserva.",
};
const baseTables = [
  "services",
  "professionals",
  "professional_services",
  "working_hours",
];
export function Manager({ section }: { section: string }) {
  const { tenantId, slug, tenantName, role } = useTenant();
  const manager = role === "owner" || role === "admin";
  const [data, setData] = useState<Data>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Row | null>(null),
    [query, setQuery] = useState("");
  const [resource, setResource] = useState<Row | null>(null),
    [finance, setFinance] = useState(false);
  const loading = useRef(false);
  const latestBooking = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!tenantId || loading.current) return;
    loading.current = true;
    try {
      const names = [
        ...baseTables,
        "tenants",
        ...(section === "configuracoes" || section === "servicos"
          ? ["resources", "service_resources"]
          : []),
        ...(section === "agenda"
          ? [
              "customers",
              "appointments",
              "blocked_times",
              "appointment_status_history",
            ]
          : section === "clientes"
            ? ["customers", "appointments", "payments"]
            : section === "configuracoes"
              ? ["tenant_settings"]
              : []),
      ];
      const entries = await Promise.all(
        names.map(async (table) => {
          let rows: Row[] = [];
          if (table === "customers" && !manager) {
            if (section === "agenda") {
              for (let offset = 0; ; offset += 500) {
                const { data: batch, error } = await db()
                  .rpc("manager_calendar_names", { p_tenant: tenantId })
                  .range(offset, offset + 499);
                if (error) throw error;
                rows.push(...batch);
                if (batch.length < 500) break;
              }
            }
            return [table, rows] as const;
          }
          for (let offset = 0; ; offset += 500) {
            const { data: batch, error } = await db()
              .from(table)
              .select("*")
              .eq(table === "tenants" ? "id" : "tenant_id", tenantId)
              .order(
                [
                  "professional_services",
                  "tenant_settings",
                  "service_resources",
                ].includes(table)
                  ? table === "professional_services"
                    ? "professional_id"
                    : table === "service_resources"
                      ? "resource_id"
                      : "tenant_id"
                  : "id",
              )
              .range(offset, offset + 499);
            if (error) throw error;
            rows.push(...batch);
            if (batch.length < 500) break;
          }
          return [table, rows] as const;
        }),
      );
      const result = Object.fromEntries(entries);
      if (section === "agenda") {
        const recent = [...result.appointments].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        )[0];
        if (
          recent &&
          latestBooking.current !== null &&
          latestBooking.current !== recent.id
        ) {
          const who = (table: string, id: string) =>
            result[table].find((r) => r.id === id)?.name || "";
          const time = new Date(recent.starts_at).toLocaleString("pt-BR", {
            timeZone: result.tenants[0]?.timezone || "America/Sao_Paulo",
          });
          setNotice(
            "Novo agendamento recebido! " +
              who("customers", recent.customer_id) +
              " · " +
              who("services", recent.service_id) +
              " · " +
              time +
              " · " +
              who("professionals", recent.professional_id) +
              " · " +
              money(recent.price_cents),
          );
        }
        latestBooking.current = recent?.id || "";
      }
      if (section === "clientes" && manager) {
        const { data: enabled } = await db().rpc("has_feature", {
          t: tenantId,
          feature: "finance",
        });
        setFinance(enabled === true);
      }
      setData(result);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      loading.current = false;
    }
  }, [tenantId, section, manager]);
  useEffect(() => {
    void load();
    if (!tenantId || section !== "agenda") return;
    const ch = db()
      .channel("manager-agenda-" + tenantId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: "tenant_id=eq." + tenantId,
        },
        (event: any) => {
          void load();
        },
      )
      .subscribe();
    const timer = setInterval(load, 10000);
    return () => {
      clearInterval(timer);
      void db().removeChannel(ch);
    };
  }, [load, section, tenantId]);
  const run = async (fn: () => PromiseLike<any>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (result?.error) throw result.error;
      setEdit(null);
      setNotice(message);
      await load();
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const service = section === "servicos",
    client = section === "clientes",
    settings = section === "configuracoes";
  const table = service ? "services" : client ? "customers" : "professionals";
  const records = (data[table] || []).filter((r) =>
    (r.name + " " + (r.phone || ""))
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  function save(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const f: Row = Object.fromEntries(fd);
    const hours = JSON.parse(f.hours || "[]");
    if (hours.some((h: Row) => h.opens_at >= h.closes_at)) {
      setError("O fim do turno deve ser posterior ao início.");
      return;
    }
    const op = settings
      ? () =>
          db().rpc("manager_settings", {
            p_tenant: tenantId,
            p_name: f.name,
            p_timezone: f.timezone,
            p_fields: f,
            p_hours: hours,
          })
      : client
        ? () =>
            db()
              .from("customers")
              .update({ notes: f.notes })
              .eq("tenant_id", tenantId)
              .eq("id", edit?.id)
        : () =>
            db().rpc("manager_catalog", {
              p_tenant: tenantId,
              p_kind: service ? "service" : "professional",
              p_id: edit?.id || null,
              p_fields: {
                ...f,
                resources: fd.getAll("resources"),
                active: fd.has("active"),
                price_cents:
                  f.price === "" ? null : Math.round(Number(f.price) * 100),
              },
              p_assigned: fd.getAll("assigned"),
              p_hours: hours,
            });
    void run(op, "Alterações salvas.").catch(() => {});
  }
  async function saveResource(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    try {
      await run(
        () =>
          resource?.id
            ? db()
                .from("resources")
                .update({ name })
                .eq("tenant_id", tenantId)
                .eq("id", resource.id)
            : db().from("resources").insert({ name, tenant_id: tenantId }),
        "Recurso salvo.",
      );
      setResource(null);
    } catch {}
  }
  async function exportClients() {
    try {
      await run(async () => {
        const { data, error } = await db().rpc("manager_export_customers", {
          p_tenant: tenantId,
          p_search: query,
        });
        if (error) throw error;
        csv([["Nome", "WhatsApp", "E-mail"], ...data]);
      }, "Arquivo CSV exportado.");
    } catch {}
  }
  const field = (
    n: string,
    label: string,
    type = "text",
    options: Record<string, any> = {},
  ) => (
    <Field key={n} label={label}>
      <input name={n} type={type} defaultValue={edit?.[n] ?? ""} {...options} />
    </Field>
  );
  function openSettings() {
    setEdit({
      ...data.tenant_settings?.[0],
      name: data.tenants?.[0]?.name || tenantName,
      timezone: data.tenants?.[0]?.timezone || "America/Sao_Paulo",
    });
  }
  const history =
    client && edit
      ? (data.appointments || [])
          .filter((a) => a.customer_id === edit.id)
          .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
      : [];
  const totals = (data.payments || [])
    .filter((p) => history.some((a) => a.id === p.appointment_id))
    .reduce(
      (n, p) =>
        n +
        (p.kind === "payment"
          ? p.amount_cents
          : p.kind === "refund"
            ? -p.amount_cents
            : 0),
      0,
    );
  const done = history.filter((a) => a.status === "completed"),
    next = history
      .filter(
        (a) =>
          ["pending", "confirmed"].includes(a.status) &&
          new Date(a.starts_at) > new Date(),
      )
      .at(-1);
  const counts = new Map<string, number>();
  for (const a of done)
    counts.set(a.service_id, (counts.get(a.service_id) || 0) + 1);
  const favorite = [...counts].sort((a, b) => b[1] - a[1])[0];
  const timezone = data.tenants?.[0]?.timezone || "America/Sao_Paulo";
  if (client && !manager)
    return (
      <section className="mg">
        <h1>Clientes</h1>
        <p>
          O cadastro de clientes está disponível para administradores do
          estabelecimento.
        </p>
      </section>
    );
  return (
    <section className="mg">
      <div className="mgheading">
        <div>
          <h1>{titles[section]}</h1>
          <p>{descriptions[section]}</p>
        </div>
        {manager &&
          !!data.services &&
          (settings ? (
            <button className="mgprimary" onClick={openSettings}>
              Editar configurações
            </button>
          ) : !client && section !== "agenda" ? (
            <button
              className="mgprimary"
              onClick={() =>
                setEdit({
                  active: true,
                  duration_minutes: 30,
                  buffer_minutes: 0,
                  commission_percent: 0,
                })
              }
            >
              + {service ? "Novo serviço" : "Novo profissional"}
            </button>
          ) : null)}
      </div>
      {error && (
        <p role="alert" className="mgerror">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mgnotice">
          {notice}
        </p>
      )}
      {!data.services ? (
        <p>Carregando…</p>
      ) : section === "agenda" ? (
        <CalendarWorkspace
          data={data}
          tenant={tenantId!}
          slug={slug}
          timezone={timezone}
          reload={load}
        />
      ) : settings ? (
        <section className="mgpanel">
          <h2>{data.tenants?.[0]?.name || tenantName}</h2>
          <p>{data.tenant_settings?.[0]?.description}</p>
          <a href={"/agendar/" + slug}>Abrir página de agendamento ↗</a>
          <hr />
          <p>Fuso horário · {timezone}</p>
          {data.working_hours
            .filter((h) => !h.professional_id)
            .sort((a, b) => a.weekday - b.weekday)
            .map((h) => (
              <p key={h.id}>
                {days[h.weekday]} · {h.opens_at.slice(0, 5)} –{" "}
                {h.closes_at.slice(0, 5)}
              </p>
            ))}
          <hr />
          <h3>Recursos compartilhados</h3>
          {data.resources.map((r) => (
            <div className="mgtools" key={r.id}>
              <b>{r.name}</b>
              {manager && (
                <button onClick={() => setResource(r)}>Editar</button>
              )}
            </div>
          ))}
          {manager && (
            <button onClick={() => setResource({})}>+ Adicionar recurso</button>
          )}
        </section>
      ) : (
        <section className="mgpanel">
          <div className="mgtools">
            <input
              aria-label="Pesquisar"
              placeholder="Pesquisar por nome…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {client && manager && (
              <button disabled={busy} onClick={exportClients}>
                Exportar CSV
              </button>
            )}
          </div>
          <div className="mgtable">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>
                    {service
                      ? "Duração"
                      : client
                        ? "WhatsApp"
                        : "Especialidade"}
                  </th>
                  <th>
                    {service ? "Preço" : client ? "Atendimentos" : "Status"}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      {service && !r.active && " · Inativo"}
                    </td>
                    <td>
                      {service
                        ? r.duration_minutes + " min"
                        : client
                          ? r.phone
                          : r.specialty || "—"}
                    </td>
                    <td>
                      {service
                        ? money(r.price_cents)
                        : client
                          ? data.appointments.filter(
                              (a) =>
                                a.customer_id === r.id &&
                                a.status === "completed",
                            ).length
                          : r.active
                            ? "Ativo"
                            : "Inativo"}
                    </td>
                    <td>
                      {(manager || client) && (
                        <button onClick={() => setEdit(r)}>
                          {client ? "Ver ficha" : "Editar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!records.length && (
              <p className="mgmuted">Nenhum registro encontrado.</p>
            )}
          </div>
        </section>
      )}
      {resource && (
        <Modal title="Recurso compartilhado" close={() => setResource(null)}>
          <form onSubmit={saveResource}>
            {error && <p role="alert">{error}</p>}
            <Field label="Nome da sala ou equipamento">
              <input
                name="name"
                maxLength={150}
                defaultValue={resource.name || ""}
                required
              />
            </Field>
            <footer>
              {resource.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Excluir este recurso e desvincular dos serviços?",
                      )
                    )
                      return;
                    try {
                      await run(
                        () =>
                          db()
                            .from("resources")
                            .delete()
                            .eq("tenant_id", tenantId)
                            .eq("id", resource.id),
                        "Recurso excluído.",
                      );
                      setResource(null);
                    } catch {}
                  }}
                >
                  Excluir
                </button>
              )}
              <button disabled={busy} className="mgprimary">
                Salvar recurso
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {edit && (
        <Modal
          title={
            settings
              ? "Editar estabelecimento"
              : client
                ? edit.name
                : (edit.id ? "Editar " : "Adicionar ") +
                  (service ? "serviço" : "profissional")
          }
          close={() => setEdit(null)}
        >
          <form onSubmit={save}>
            {error && <p role="alert">{error}</p>}
            {client ? (
              <>
                <p>
                  {edit.phone} · {edit.email}
                </p>
                <dl>
                  <dt>Atendimentos concluídos</dt>
                  <dd>{done.length}</dd>
                  {manager && finance && (
                    <>
                      <dt>Total recebido</dt>
                      <dd>{money(totals)}</dd>
                    </>
                  )}
                  <dt>Último atendimento</dt>
                  <dd>
                    {done[0]
                      ? new Date(done[0].starts_at).toLocaleString("pt-BR", {
                          timeZone: timezone,
                        })
                      : "—"}
                  </dd>
                  <dt>Próxima reserva</dt>
                  <dd>
                    {next
                      ? new Date(next.starts_at).toLocaleString("pt-BR", {
                          timeZone: timezone,
                        })
                      : "—"}
                  </dd>
                  <dt>Serviço mais frequente</dt>
                  <dd>
                    {favorite
                      ? data.services.find((s) => s.id === favorite[0])?.name
                      : "—"}
                  </dd>
                </dl>
                <h3>Histórico de atendimentos</h3>
                {data.appointments
                  .filter((a) => a.customer_id === edit.id)
                  .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
                  .map((a) => (
                    <p key={a.id}>
                      {new Date(a.starts_at).toLocaleString("pt-BR", {
                        timeZone: timezone,
                      })}{" "}
                      · {data.services.find((s) => s.id === a.service_id)?.name}{" "}
                      · {statusNames[a.status]}
                    </p>
                  ))}
                <Field label="Observações internas">
                  <textarea
                    name="notes"
                    readOnly={!manager}
                    defaultValue={edit.notes || ""}
                  />
                </Field>
              </>
            ) : (
              <>
                {field("name", "Nome", "text", {
                  required: true,
                  maxLength: 160,
                })}
                {settings ? (
                  <>
                    {[
                      ["description", "Descrição"],
                      ["address", "Endereço"],
                      ["whatsapp", "WhatsApp"],
                      ["instagram", "Instagram"],
                      ["logo_url", "URL do logo", "url"],
                      ["cover_url", "URL da capa", "url"],
                      ["brand_color", "Cor principal", "color"],
                      ["timezone", "Fuso horário IANA"],
                      [
                        "min_notice_minutes",
                        "Antecedência mínima (min)",
                        "number",
                      ],
                      ["max_days", "Limite de antecedência (dias)", "number"],
                      ["cancellation_policy", "Política de cancelamento"],
                    ].map(([n, l, t]) =>
                      field(n, l, t, {
                        min: n === "max_days" ? 1 : 0,
                        required: [
                          "timezone",
                          "max_days",
                          "min_notice_minutes",
                        ].includes(n),
                      }),
                    )}
                    <Hours
                      initial={data.working_hours.filter(
                        (h) => !h.professional_id,
                      )}
                    />
                  </>
                ) : (
                  <>
                    {service ? (
                      <>
                        {field("category", "Categoria")}
                        {field("description", "Descrição")}
                        {field(
                          "price",
                          "Preço em reais (vazio para sob consulta)",
                          "number",
                          {
                            min: 0,
                            step: 0.01,
                            defaultValue:
                              edit.price_cents == null
                                ? ""
                                : edit.price_cents / 100,
                          },
                        )}
                        {field("duration_minutes", "Duração (min)", "number", {
                          min: 1,
                          required: true,
                        })}
                        {field(
                          "buffer_minutes",
                          "Intervalo de preparação (min)",
                          "number",
                          { min: 0, required: true },
                        )}
                        {field("image_url", "Imagem (URL)", "url")}
                      </>
                    ) : (
                      <>
                        {field("specialty", "Especialidade")}
                        {field("photo_url", "Foto (URL)", "url")}
                        {field("commission_percent", "Comissão (%)", "number", {
                          min: 0,
                          max: 100,
                          step: 0.01,
                          required: true,
                        })}
                        <Hours
                          initial={data.working_hours.filter(
                            (h) => h.professional_id === edit.id,
                          )}
                        />
                      </>
                    )}
                    {service && (
                      <fieldset>
                        <legend>Recursos necessários</legend>
                        {!data.resources.length && (
                          <a href="/configuracoes">
                            Cadastrar recurso nas configurações
                          </a>
                        )}
                        {data.resources.map((r) => (
                          <label className="mgcheck" key={r.id}>
                            <input
                              type="checkbox"
                              name="resources"
                              value={r.id}
                              defaultChecked={data.service_resources.some(
                                (x) =>
                                  x.service_id === edit.id &&
                                  x.resource_id === r.id,
                              )}
                            />
                            {r.name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <fieldset>
                      <legend>
                        {service
                          ? "Profissionais habilitados"
                          : "Serviços realizados"}
                      </legend>
                      {data[service ? "professionals" : "services"].map((v) => (
                        <label className="mgcheck" key={v.id}>
                          <input
                            name="assigned"
                            type="checkbox"
                            value={v.id}
                            defaultChecked={data.professional_services.some(
                              (x) =>
                                x.service_id === (service ? edit.id : v.id) &&
                                x.professional_id ===
                                  (service ? v.id : edit.id),
                            )}
                          />
                          {v.name}
                        </label>
                      ))}
                    </fieldset>
                    <label className="mgcheck">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={edit.active}
                      />
                      Ativo
                    </label>
                  </>
                )}
              </>
            )}
            <footer>
              {service && edit.id && manager && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Excluir este serviço? Se já houver atendimentos vinculados, desative o serviço para preservar o histórico.",
                      )
                    )
                      void run(
                        () =>
                          db()
                            .from("services")
                            .delete()
                            .eq("id", edit.id)
                            .eq("tenant_id", tenantId),
                        "Serviço excluído.",
                      ).catch(() => {});
                  }}
                >
                  Excluir serviço
                </button>
              )}
              <button type="button" onClick={() => setEdit(null)}>
                Fechar
              </button>
              {manager && (
                <button className="mgprimary" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar alterações"}
                </button>
              )}
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
