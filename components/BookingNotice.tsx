"use client";
import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
type Notice = {
  id: string;
  message: string;
  created_at: string;
  appointment_id: string;
};
export default function BookingNotice({
  tenantId,
  timezone,
}: {
  tenantId: string;
  timezone: string;
}) {
  const [notice, setNotice] = useState(""),
    [details, setDetails] = useState("");
  useEffect(() => {
    const client = db(),
      baseline = new Date().toISOString();
    let alive = true,
      last = "",
      generation = 0;
    async function show(row: Notice) {
      if (!alive || row.created_at < baseline || row.id === last) return;
      last = row.id;
      const version = ++generation;
      setNotice(row.message);
      setDetails("");
      const { data } = await client
        .from("appointments")
        .select(
          "starts_at,price_cents,customers(name),services(name),professionals(name)",
        )
        .eq("tenant_id", tenantId)
        .eq("id", row.appointment_id)
        .maybeSingle();
      if (!alive || version !== generation || !data) return;
      const names = [data.customers, data.services, data.professionals].map(
        (v) => (v as unknown as { name: string } | null)?.name,
      );
      setDetails(
        [
          ...names,
          new Date(data.starts_at).toLocaleString("pt-BR", {
            timeZone: timezone,
          }),
          data.price_cents == null
            ? "Sob consulta"
            : (data.price_cents / 100).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              }),
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }
    const channel = client
      .channel("workspace-notice-" + tenantId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: "tenant_id=eq." + tenantId,
        },
        (event) => void show(event.new as Notice),
      )
      .subscribe();
    const timer = setInterval(async () => {
      const { data } = await client
        .from("notifications")
        .select("id,message,created_at,appointment_id")
        .eq("tenant_id", tenantId)
        .gte("created_at", baseline)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) void show(data);
    }, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [tenantId, timezone]);
  return notice ? (
    <div className="bookingnotice" role="status">
      <Bell size={20} />
      <div>
        <strong>{notice}</strong>
        <small>{details}</small>
        <Link href="/agenda">Ver na agenda</Link>
      </div>
      <button aria-label="Dispensar aviso" onClick={() => setNotice("")}>
        <X size={14} />
      </button>
    </div>
  ) : null;
}
