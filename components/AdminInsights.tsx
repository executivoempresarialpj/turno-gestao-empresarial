"use client";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { db } from "@/lib/db";
type Data = {
  cohort: number;
  lost: number;
  usage: { id: string; name: string; bookings: number; members: number }[];
  months: { month: string; cash: number }[];
  notes: { name: string; note: string; created_at: string }[];
};
const currency = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n / 100,
  );
export default function AdminInsights() {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const [start, setStart] = useState(today.slice(0, 7) + "-01"),
    [end, setEnd] = useState(today),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setData(null);
    db()
      .rpc("platform_insights", { p_from: start, p_to: end })
      .then((r) => {
        if (current) {
          setData(r.data);
          setError(r.error ? "Falha ao consultar este período." : "");
        }
      });
    return () => {
      current = false;
    };
  }, [start, end, revision]);
  return (
    <section className="admin-insights">
      <h2>Desempenho comercial</h2>
      <div className="insight-dates">
        <label>
          De{" "}
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Até{" "}
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <h3>Recebimentos mensais do SaaS</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.months}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v) => String(v / 100)} />
              <Tooltip formatter={(v) => currency(Number(v))} />
              <Bar
                name="Recebimentos líquidos"
                dataKey="cash"
                fill="#8169d4"
                maxBarSize={60}
              />
            </BarChart>
          </ResponsiveContainer>
          <p>
            <strong>
              Churn{" "}
              {data.cohort
                ? ((100 * data.lost) / data.cohort).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  }) + "%"
                : "—"}
            </strong>{" "}
            · {data.lost} cancelamentos entre {data.cohort} assinaturas ativas
            no início do período.
          </p>
          <details>
            <summary>Uso por empresa e notas administrativas</summary>
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Reservas criadas</th>
                  <th>Acessos ativos</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.bookings}</td>
                    <td>{u.members}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.usage.length > 0 && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    f = new FormData(form);
                  setBusy(true);
                  try {
                    const r = await db().rpc("platform_note", {
                      t: f.get("company"),
                      body: f.get("body"),
                    });
                    if (r.error) throw r.error;
                    form.reset();
                    setRevision((v) => v + 1);
                  } catch {
                    setError("Falha ao salvar a observação.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Empresa
                  <select name="company">
                    {data.usage.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Observação administrativa
                  <textarea name="body" maxLength={1000} required />
                </label>
                <button disabled={busy}>Adicionar observação</button>
              </form>
            )}
            {data.notes.map((n, i) => (
              <p key={i}>
                <b>{n.name}</b> · {n.note}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
