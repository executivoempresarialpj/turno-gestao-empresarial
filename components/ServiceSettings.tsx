"use client";
import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant";
import { db } from "@/lib/db";
export default function ServiceSettings() {
  const { tenantId } = useTenant(),
    [rows, setRows] = useState<
      { id: string; name: string; price_cents: number | null }[]
    >([]),
    [message, setMessage] = useState("");
  const load = () =>
    db()
      .from("services")
      .select("id,name,price_cents")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name")
      .then((r) => setRows(r.data || []));
  useEffect(() => {
    void load();
  }, [tenantId]);
  return (
    <section className="slot-settings">
      <h2>Serviços e valores</h2>
      <p>
        Os clientes escolhem o serviço antes de confirmar. O valor entra na
        previsão de faturamento.
      </p>
      {rows.map((r) => (
        <form
          key={r.id}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const result = await db()
              .from("services")
              .update({
                name: f.get("name"),
                price_cents: Math.round(Number(f.get("price")) * 100),
              })
              .eq("tenant_id", tenantId)
              .eq("id", r.id);
            setMessage(
              result.error ? result.error.message : "Serviço atualizado.",
            );
            void load();
          }}
        >
          <label>
            Serviço
            <input name="name" required defaultValue={r.name} />
          </label>
          <label>
            Valor (R$)
            <input
              type="number"
              name="price"
              min="0"
              step=".01"
              required
              defaultValue={(r.price_cents || 0) / 100}
            />
          </label>
          <button>Salvar</button>
          <button
            type="button"
            onClick={async () => {
              await db()
                .from("services")
                .update({ active: false })
                .eq("tenant_id", tenantId)
                .eq("id", r.id);
              void load();
            }}
          >
            Desativar
          </button>
        </form>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          const { error } = await db()
            .from("services")
            .insert({
              tenant_id: tenantId,
              name: f.get("name"),
              price_cents: Math.round(Number(f.get("price")) * 100),
              duration_minutes: 1,
            });
          setMessage(error ? error.message : "Serviço criado.");
          if (!error) {
            form.reset();
            void load();
          }
        }}
      >
        <label>
          Novo serviço
          <input name="name" required maxLength={150} />
        </label>
        <label>
          Valor (R$)
          <input type="number" name="price" required min="0" step=".01" />
        </label>
        <button>Adicionar serviço</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
