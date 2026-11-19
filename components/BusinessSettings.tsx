"use client";
import ServiceSettings from "./ServiceSettings";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { useTenant } from "@/lib/tenant";
import SlotSettings from "./SlotSettings";
export default function BusinessSettings() {
  const { tenantId, tenantName, slug } = useTenant();
  const [name, setName] = useState(tenantName),
    [description, setDescription] = useState(""),
    [address, setAddress] = useState(""),
    [color, setColor] = useState("#624bd7"),
    [logo, setLogo] = useState(""),
    [cover, setCover] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    db()
      .from("tenant_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .single()
      .then(({ data }) => {
        if (data) {
          setDescription(data.description || "");
          setAddress(data.address || "");
          setColor(data.brand_color || "#624bd7");
          setLogo(data.logo_url || "");
          setCover(data.cover_url || "");
        }
      });
  }, [tenantId]);
  async function upload(file: File | undefined, kind: "cover" | "logo") {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5242880
    ) {
      setMessage("Escolha JPG, PNG ou WebP de até 5 MB.");
      return;
    }
    setMessage("Enviando imagem…");
    const path =
      tenantId + "/" + crypto.randomUUID() + "." + file.type.split("/")[1];
    const { error } = await db()
      .storage.from("business-images")
      .upload(path, file);
    if (error) {
      setMessage(error.message);
      return;
    }
    const url = db().storage.from("business-images").getPublicUrl(path)
      .data.publicUrl;
    const saved = await db()
      .from("tenant_settings")
      .update({ [kind === "cover" ? "cover_url" : "logo_url"]: url })
      .eq("tenant_id", tenantId);
    if (saved.error) {
      setMessage(saved.error.message);
      return;
    }
    if (kind === "cover") setCover(url);
    else setLogo(url);
    setMessage("Imagem publicada.");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("Salvando…");
    const c = db();
    const first = await c.rpc("manager_settings", {
      p_tenant: tenantId,
      p_name: name,
      p_timezone: "America/Sao_Paulo",
      p_fields: {
        description,
        address,
        whatsapp: "",
        instagram: "",
        logo_url: logo,
        cover_url: cover,
        brand_color: color,
        min_notice_minutes: 15,
        max_days: 60,
        cancellation_policy: "",
      },
      p_hours: [],
    });
    const second = await c
      .from("tenant_settings")
      .update({
        description,
        address,
        brand_color: color,
        logo_url: logo,
        cover_url: cover,
      })
      .eq("tenant_id", tenantId);
    setMessage(
      first.error || second.error
        ? "Falha ao salvar. Confira os dados."
        : "Página pública atualizada.",
    );
  }
  return (
    <>
      <SlotSettings />
      <ServiceSettings />
      <section className="slot-settings">
        <small>IDENTIDADE VISUAL</small>
        <h2>Sua página de agendamento</h2>
        <form className="business-form" onSubmit={submit}>
          <label>
            Nome do negócio
            <input
              value={name}
              maxLength={150}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Descrição
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Endereço
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label>
            Cor principal
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <label>
            Enviar logo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void upload(e.target.files?.[0], "logo")}
            />
          </label>
          <label>
            Enviar foto de capa
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void upload(e.target.files?.[0], "cover")}
            />
          </label>
          {cover && (
            <img
              src={cover}
              alt="Prévia da capa"
              style={{
                width: "100%",
                borderRadius: 12,
                maxHeight: 200,
                objectFit: "cover",
              }}
            />
          )}
          <label>
            URL da logo
            <input
              type="url"
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="https://"
            />
          </label>
          <label>
            URL da imagem de capa
            <input
              type="url"
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              placeholder="https://"
            />
          </label>
          <button>Salvar aparência</button>
        </form>
        <p role="status">{message}</p>
        <a href={"/agendar/" + slug}>Ver minha página pública ↗</a>
      </section>
    </>
  );
}
