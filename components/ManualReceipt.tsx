"use client";
import { useState, useRef } from "react";
import { db } from "@/lib/db";
import { useTenant } from "@/lib/tenant";
export default function ManualReceipt({ onSaved }: { onSaved: () => void }) {
  const { tenantId } = useTenant(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    key = useRef("");
  return (
    <section className="slot-settings">
      <button
        onClick={() => {
          setOpen(!open);
          key.current = crypto.randomUUID();
        }}
      >
        Registrar recebimento avulso
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            const f = new FormData(e.currentTarget);
            const result = await db().rpc("manual_receipt", {
              t: tenantId,
              amount: Math.round(Number(f.get("amount")) * 100),
              method: f.get("method"),
              description: f.get("description"),
              request: key.current,
            });
            setBusy(false);
            setMessage(
              result.error
                ? result.error.message
                : "Recebimento registrado no caixa.",
            );
            if (!result.error) {
              setOpen(false);
              onSaved();
            }
          }}
        >
          <label>
            Cliente ou descrição
            <input name="description" required maxLength={200} />
          </label>
          <label>
            Valor recebido (R$)
            <input name="amount" required type="number" min=".01" step=".01" />
          </label>
          <label>
            Forma de pagamento
            <select name="method">
              {[
                "PIX",
                "Dinheiro",
                "Cartão de crédito",
                "Cartão de débito",
                "Transferência",
                "Outros",
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button disabled={busy}>
            {busy ? "Registrando…" : "Confirmar recebimento"}
          </button>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
