import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { serverDb } from "@/lib/server";
import Shell from "@/lib/shell";
export const dynamic = "force-dynamic";
type Company = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login");
  const supabase = await serverDb();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role,tenant_id,tenants(id,name,slug,timezone,status)")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("tenant_id");
  if (error) throw Error("Não foi possível carregar a empresa.");
  const memberships = (data ?? [])
    .map((m) => ({
      role: String(m.role),
      company: m.tenants as unknown as Company,
    }))
    .filter((m) => m.company && ["active", "trial"].includes(m.company.status));
  const preferred = (await cookies()).get("turno-workspace")?.value;
  const membership =
    memberships.find((m) => m.company.id === preferred) ?? memberships[0];
  if (!membership && (await supabase.rpc("is_superadmin")).data) redirect("/superadmin");
  if (!membership)
    return (
      <main className="setup">
        <h1>Acesso indisponível</h1>
        <p>Consulte o responsável pela sua assinatura.</p>
        <a href="/login">Voltar ao login</a>
      </main>
    );
  const t = membership.company;
  return (
    <Shell
      companies={memberships.map((m) => ({
        id: m.company.id,
        name: m.company.name,
      }))}
      tenant={{
        tenantId: t.id,
        tenantName: t.name,
        slug: t.slug,
        timezone: t.timezone,
        role: membership.role,
      }}
      email={user.email || ""}
    >
      {children}
    </Shell>
  );
}
