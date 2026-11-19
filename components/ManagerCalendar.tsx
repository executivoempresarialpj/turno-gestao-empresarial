"use client";
import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { db } from "@/lib/db";
import { useTenant } from "@/lib/tenant";
import { Field, Modal, money, statusNames, type Row } from "./Manager";
type Props = {
  data: Record<string, Row[]>;
  tenant: string;
  slug: string;
  timezone: string;
  reload: () => Promise<void>;
};
function dateKey(date: Date, zone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function offset(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function CalendarWorkspace({
  data,
  tenant,
  slug,
  timezone,
  reload,
}: Props) {
  const { role } = useTenant();
  const manager = role === "owner" || role === "admin";
  const [receipt, setReceipt] = useState("");
  const today = dateKey(new Date(), timezone);
  const [date, setDate] = useState(today),
    [view, setView] = useState("Dia"),
    [filter, setFilter] = useState(""),
    [service, setService] = useState(""),
    [prof, setProf] = useState(""),
    [status, setStatus] = useState("");
  const [mode, setMode] = useState(""),
    [item, setItem] = useState<Row>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [slot, setSlot] = useState(""),
    [slots, setSlots] = useState<Row[]>([]);
  const d = new Date(date + "T12:00:00Z"),
    start =
      view === "Semana"
        ? offset(date, -((d.getUTCDay() + 6) % 7))
        : view === "Mês"
          ? date.slice(0, 7) + "-01"
          : date;
  const end =
    view === "Semana"
      ? offset(start, 7)
      : view === "Mês"
        ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12))
            .toISOString()
            .slice(0, 10)
        : offset(start, 1);
  const lookup = (t: string, id: string) =>
    data[t]?.find((r) => r.id === id)?.name || "—";
  const time = (v: string) =>
    new Date(v).toLocaleTimeString("pt-BR", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
  function open(kind: string, r: Row = {}) {
    setError("");
    setMode(kind);
    setItem({
      ...r,
      day: date,
      key: crypto.randomUUID(),
      token: crypto.randomUUID(),
    });
    setSlot("");
  }
  useEffect(() => {
    let alive = true;
    setSlots([]);
    setSlot("");
    if ((mode === "create" || mode === "move") && item.service_id && item.day) {
      db()
        .rpc("booking_slots", {
          p_slug: slug,
          p_service: item.service_id,
          p_day: item.day,
          p_professional: item.professional_id || null,
        })
        .then(({ data, error }) => {
          if (alive) {
            if (error) setError(error.message);
            else setSlots(data || []);
          }
        });
    }
    return () => {
      alive = false;
    };
  }, [mode, item.service_id, item.professional_id, item.day, slug]);
  const rows = data.appointments
    .filter((a) => {
      const day = dateKey(new Date(a.starts_at), timezone);
      return (
        day >= start &&
        day < end &&
        (!service || a.service_id === service) &&
        (!prof || a.professional_id === prof) &&
        (!status || a.status === status) &&
        lookup("customers", a.customer_id)
          .toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase())
      );
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  async function action(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const f = Object.fromEntries(new FormData(ev.currentTarget));
      const s = slots.find(
        (r) => r.starts_at + "|" + r.professional_id === slot,
      );
      const result =
        mode === "block"
          ? await db().rpc("manager_block", {
              p_tenant: tenant,
              p_professional: f.professional || null,
              p_start: f.start,
              p_end: f.end,
              p_reason: f.reason,
            })
          : mode === "create"
            ? await db().rpc("booking_create", {
                p_slug: slug,
                p_service: item.service_id,
                p_professional: s?.professional_id,
                p_start: s?.starts_at,
                p_name: f.name,
                p_phone: f.phone,
                p_email: f.email || null,
                p_notes: f.notes || null,
                p_key: item.key,
                p_token: item.token,
              })
            : await db().rpc("manager_update_booking", {
                p_id: item.id,
                p_status: mode === "move" ? item.status : f.status,
                p_start: mode === "move" ? s?.starts_at : null,
                p_professional: mode === "move" ? s?.professional_id : null,
              });
      if (result.error) throw result.error;
      setReceipt(mode === "create" ? "/reserva/" + item.token : "");
      setMode("");
      setNote("Agenda atualizada.");
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mgtools">
        <div className="mgsegment">
          {["Dia", "Semana", "Mês"].map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
        {manager && (
          <button onClick={() => open("block")}>Bloquear horário</button>
        )}
        <button className="mgprimary" onClick={() => window.open("/agendar/"+slug,"_blank")}>
          + Agendamento
        </button>
      </div>
      {note && (
        <p role="status">
          {note}{" "}
          {receipt && <a href={receipt}>Abrir comprovante da reserva ↗</a>}
        </p>
      )}
      <section className="mgpanel">
        <div className="mgtools">
          <input
            aria-label="Data da agenda"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <input
            aria-label="Pesquisar cliente"
            placeholder="Pesquisar cliente…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            aria-label="Serviço"
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            <option value="">Todos os serviços</option>
            {data.services.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Profissional"
            value={prof}
            onChange={(e) => setProf(e.target.value)}
          >
            <option value="">Toda a equipe</option>
            {data.professionals.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos os status</option>
            {Object.entries(statusNames).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {view === "Mês" && (
          <div className="mgmonth">
            {Array.from(
              { length: Number(offset(end, -1).slice(-2)) },
              (_, i) => {
                const day = offset(start, i),
                  count = rows.filter(
                    (r) => dateKey(new Date(r.starts_at), timezone) === day,
                  ).length;
                return (
                  <button
                    key={day}
                    onClick={() => {
                      setDate(day);
                      setView("Dia");
                    }}
                  >
                    <b>{i + 1}</b>
                    <small>{count} ag.</small>
                  </button>
                );
              },
            )}
          </div>
        )}
        {rows.map((a) => (
          <button
            key={a.id}
            className="mgrow"
            onClick={() => open("detail", a)}
          >
            <strong>
              {dateKey(new Date(a.starts_at), timezone)
                .slice(5)
                .split("-")
                .reverse()
                .join("/")}{" "}
              · {time(a.starts_at)}
            </strong>
            <span>
              <b>{lookup("customers", a.customer_id)}</b>
              <small>
                {lookup("services", a.service_id)} ·{" "}
                {lookup("professionals", a.professional_id)}
              </small>
            </span>
            <em className={"mgstatus " + a.status}>{statusNames[a.status]}</em>
            <b>{money(a.price_cents)}</b>
          </button>
        ))}
        {!rows.length && (
          <p className="mgmuted">Nenhum agendamento neste período.</p>
        )}
        {data.blocked_times
          .filter(
            (b) =>
              dateKey(new Date(b.starts_at), timezone) < end &&
              dateKey(new Date(b.ends_at), timezone) >= start &&
              (!prof || !b.professional_id || b.professional_id === prof),
          )
          .map((b) => (
            <p key={b.id}>
              Bloqueio ·{" "}
              {new Date(b.starts_at).toLocaleString("pt-BR", {
                timeZone: timezone,
              })}{" "}
              –{" "}
              {new Date(b.ends_at).toLocaleString("pt-BR", {
                timeZone: timezone,
              })}{" "}
              · {b.reason}{" "}
              {manager && (
                <button
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Liberar este intervalo para novas reservas?",
                      )
                    )
                      return;
                    const { error } = await db()
                      .from("blocked_times")
                      .delete()
                      .eq("tenant_id", tenant)
                      .eq("id", b.id);
                    if (error) setNote(error.message);
                    else {
                      setNote("Horário liberado.");
                      await reload();
                    }
                  }}
                >
                  Liberar horário
                </button>
              )}
            </p>
          ))}
      </section>
      {mode && (
        <Modal
          title={
            {
              detail: "Detalhes do atendimento",
              move: "Reagendar atendimento",
              create: "Novo agendamento",
              block: "Bloquear horário",
            }[mode] || ""
          }
          close={() => setMode("")}
        >
          <form onSubmit={action}>
            {error && (
              <p role="alert" className="mgerror">
                {error}
              </p>
            )}
            {mode === "block" ? (
              <>
                <Field label="Profissional">
                  <select name="professional">
                    <option value="">Todo o estabelecimento</option>
                    {data.professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {["start", "end"].map((k, i) => (
                  <Field
                    label={(i ? "Fim" : "Início") + " · " + timezone}
                    key={k}
                  >
                    <input type="datetime-local" name={k} required />
                  </Field>
                ))}
                <Field label="Motivo">
                  <input name="reason" maxLength={200} required />
                </Field>
              </>
            ) : mode === "detail" ? (
              <>
                <h3>{lookup("customers", item.customer_id)}</h3>
                <p>
                  {lookup("services", item.service_id)} ·{" "}
                  {lookup("professionals", item.professional_id)} ·{" "}
                  {money(item.price_cents)}
                </p>
                <p>
                  {new Date(item.starts_at).toLocaleString("pt-BR", {
                    timeZone: timezone,
                  })}
                </p>
                {item.notes && <p>{item.notes}</p>}
                <Field label="Status">
                  <select name="status" defaultValue={item.status}>
                    {Object.entries(statusNames).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <h3>Histórico</h3>
                {data.appointment_status_history
                  .filter((h) => h.appointment_id === item.id)
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((h) => (
                    <p key={h.id}>
                      {new Date(h.created_at).toLocaleString("pt-BR", {
                        timeZone: timezone,
                      })}{" "}
                      · {statusNames[h.status]}
                    </p>
                  ))}
                {["pending", "confirmed"].includes(item.status) && (
                  <button type="button" onClick={() => open("move", item)}>
                    Escolher novo horário
                  </button>
                )}
                {item.status === "completed" && (
                  <a href="/financeiro">Registrar pagamento no financeiro ↗</a>
                )}
              </>
            ) : (
              <>
                <Field label="Serviço">
                  <select
                    required
                    disabled={mode === "move"}
                    value={item.service_id || ""}
                    onChange={(e) =>
                      setItem({
                        ...item,
                        service_id: e.target.value,
                        professional_id: "",
                      })
                    }
                  >
                    <option value="">Selecione…</option>
                    {data.services
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Profissional">
                  <select
                    value={item.professional_id || ""}
                    onChange={(e) =>
                      setItem({ ...item, professional_id: e.target.value })
                    }
                  >
                    <option value="">Qualquer profissional disponível</option>
                    {data.professionals
                      .filter(
                        (p) =>
                          p.active &&
                          data.professional_services.some(
                            (a) =>
                              a.professional_id === p.id &&
                              a.service_id === item.service_id,
                          ),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Data">
                  <input
                    required
                    type="date"
                    value={item.day}
                    onChange={(e) => setItem({ ...item, day: e.target.value })}
                  />
                </Field>
                <Field label="Horários disponíveis">
                  <select
                    required
                    value={slot}
                    onChange={(e) => setSlot(e.target.value)}
                  >
                    <option value="">
                      {slots.length
                        ? "Selecione…"
                        : "Nenhum horário disponível"}
                    </option>
                    {slots.map((r) => (
                      <option
                        key={r.starts_at + r.professional_id}
                        value={r.starts_at + "|" + r.professional_id}
                      >
                        {time(r.starts_at)} ·{" "}
                        {lookup("professionals", r.professional_id)}
                      </option>
                    ))}
                  </select>
                </Field>
                {mode === "create" && (
                  <>
                    <Field label="Nome completo">
                      <input name="name" minLength={2} required />
                    </Field>
                    <Field label="WhatsApp com DDD">
                      <input name="phone" type="tel" required />
                    </Field>
                    <Field label="E-mail opcional">
                      <input type="email" name="email" />
                    </Field>
                    <Field label="Observações">
                      <textarea name="notes" />
                    </Field>
                  </>
                )}
              </>
            )}
            <footer>
              <button type="button" onClick={() => setMode("")}>
                Fechar
              </button>
              <button className="mgprimary" disabled={busy}>
                {busy ? "Salvando…" : "Confirmar"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
