import "server-only";
import { serverDb } from "@/lib/server";

class GatewayError extends Error {
  constructor(readonly status: number) {
    super("Falha na solicitação ao Asaas");
  }
}

async function gateway(
  path: string,
  body?: object,
  method = body ? "POST" : "GET",
) {
  const root =
    process.env.ASAAS_ENVIRONMENT === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const response = await fetch(root + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: process.env.ASAAS_API_KEY!,
      "User-Agent": "Turno/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new GatewayError(response.status);
  return response.json();
}
export async function billingLink(subscription: string) {
  if (!process.env.ASAAS_API_KEY)
    return "Configure a chave do Asaas para consultar a cobrança.";
  const bills = await gateway(
    "/subscriptions/" +
      encodeURIComponent(subscription) +
      "/payments?status=PENDING&limit=1",
  );
  const url = bills.data?.[0]?.invoiceUrl;
  if (typeof url !== "string")
    return "Ainda não há fatura pendente disponível no Asaas.";
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !(parsed.hostname === "asaas.com" || parsed.hostname.endsWith(".asaas.com"))
  )
    return "URL de fatura não reconhecida.";
  return parsed.href;
}

export async function createBilling(f: FormData) {
  if (!process.env.ASAAS_API_KEY)
    return "Configure ASAAS_API_KEY para emitir cobranças.";
  const field = (k: string) => String(f.get(k) ?? "").trim(),
    document = field("document").replace(/[.\s/-]/g, ""),
    name = field("payer"),
    email = field("email"),
    t = field("tenant"),
    due = field("due");
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
  if (
    field("consent") !== "on" ||
    !/^\d{11}$|^\d{14}$/.test(document) ||
    !name ||
    name.length > 150 ||
    !email.includes("@") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
    due < today
  )
    return "Confira documento, identificação, autorização e primeiro vencimento.";
  const client = await serverDb();
  const { data: reservation, error } = await client.rpc(
    "platform_begin_billing",
    { t },
  );
  if (error)
    return "A emissão está em andamento, já existe cobrança ou o plano está indisponível. Confira o preço mensal e o vínculo no Asaas.";
  let canRelease = true;
  try {
    const customer = await gateway("/customers", {
      name,
      email,
      cpfCnpj: document,
      externalReference: t,
      notificationDisabled: false,
    });
    if (typeof customer.id !== "string") throw Error("Cliente sem ID");
    canRelease = false;
    const sub = await gateway("/subscriptions", {
      customer: customer.id,
      billingType: "PIX",
      value: reservation.monthly_cents / 100,
      nextDueDate: due,
      cycle: "MONTHLY",
      description: "Assinatura " + reservation.name,
      externalReference: reservation.attempt,
    });
    if (typeof sub.id !== "string") throw Error("Assinatura sem ID");
    const { error: finish } = await client.rpc("platform_finish_billing", {
      t,
      p_attempt: reservation.attempt,
      p_subscription: sub.id,
    });
    if (finish) throw Error("Conciliação pendente");
    try {
      return await billingLink(sub.id);
    } catch {
      return "Assinatura criada. Consulte a primeira fatura no painel.";
    }
  } catch (e) {
    // A timeout after dispatch may mean the recurring charge already exists.
    if (
      canRelease ||
      (e instanceof GatewayError && [400, 401, 403, 422].includes(e.status))
    ) {
      const release = await client.rpc("platform_finish_billing", {
        t,
        p_attempt: reservation.attempt,
        p_subscription: null,
      });
      if (!release.error)
        return "Emissão recusada. Confira os dados e a configuração do Asaas.";
    }
    return (
      "Conciliação necessária. Localize a assinatura no Asaas pela referência " +
      reservation.attempt +
      " e vincule o ID antes de emitir outra cobrança."
    );
  }
}

export async function cancelBilling(t: string) {
  if (!process.env.ASAAS_API_KEY)
    return "Configure a chave do Asaas para cancelar a cobrança.";
  const client = await serverDb();
  const { data: s, error } = await client
    .from("subscriptions")
    .select("asaas_id")
    .eq("tenant_id", t)
    .single();
  if (error || !s?.asaas_id) return "Assinatura externa não encontrada.";
  try {
    await gateway(
      "/subscriptions/" + encodeURIComponent(s.asaas_id),
      undefined,
      "DELETE",
    );
  } catch (e) {
    if (!(e instanceof GatewayError && e.status === 404))
      return "O Asaas não confirmou o cancelamento. Tente novamente.";
  }
  const applied = await client.rpc("platform_cancel_billing", {
    t,
    p_subscription: s.asaas_id,
  });
  return applied.error
    ? "Cancelamento enviado. Tente novamente para reconciliar o estado local."
    : "Assinatura cancelada no Asaas e acesso encerrado.";
}
