"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { serverDb } from "@/lib/server";
export async function mutate(_: string, f: FormData): Promise<string> {
  const client = await serverDb();
  const { data: allowed } = await client.rpc("is_superadmin");
  if (!allowed) return "Acesso negado.";
  const field = (k: string) => String(f.get(k) ?? "").trim();
  const op = field("op"),
    t = field("tenant"),
    email = field("email").toLowerCase();
  try {
    let result;
    if (op === "retention") {
      const r = await client.rpc("platform_retention", {
        t: t || null,
        operation: field("operation"),
        confirmation: field("confirm"),
        days: field("days") ? Number(field("days")) : null,
      });
      if (r.error) return r.error.message;
      revalidatePath("/superadmin");
      return r.data;
    }
    if (op === "revoke") {
      result = await client.rpc("platform_revoke_sessions", {
        t,
        u: field("user"),
      });
    }
    if (["create","invite","password"].includes(op)) {
      const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
      const password=String(f.get("password")??"");
      if(password.length<12)return "Use uma senha com pelo menos 12 caracteres.";
      if(op==="password"){
        const {data:membership}=await client.from("tenant_memberships").select("user_id").eq("tenant_id",t).eq("user_id",field("user")).single();
        if(!membership)return "Acesso não encontrado.";
        const {error}=await service.auth.admin.updateUserById(membership.user_id,{password});
        if(error)return "Falha ao atualizar a senha.";
        await client.rpc("platform_revoke_sessions",{t,u:membership.user_id});
        return "Senha alterada. O responsável já pode entrar.";
      }
      const username=field("username").toLowerCase();
      if(!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username))return "Use um usuário com 3 a 50 letras minúsculas, números, pontos ou traços.";
      const accountEmail=username+"@login.turno.invalid";
      const {data:created,error}=await service.auth.admin.createUser({email:accountEmail,password,email_confirm:true,user_metadata:{username}});
      if(error||!created.user)return "Usuário já utilizado ou senha recusada. Escolha outro usuário e confira a senha.";
      const linked=await client.rpc("platform_direct_access",{p_user:created.user.id,p_email:accountEmail,p_tenant:op==="create"?null:t,p_name:field("name"),p_slug:field("slug"),p_plan:field("plan")||null,p_role:op==="create"?"owner":field("role")});
      if(linked.error){
        await service.auth.admin.deleteUser(created.user.id);
        return linked.error.message;
      }
      revalidatePath("/superadmin");
      return "Acesso criado. Usuário: "+username+". Entre em /login com a senha definida.";
    }
    if (op === "member")
      result = await client.rpc("platform_member", {
        t,
        p_user: field("user"),
        p_role: field("role"),
        p_active: field("active") === "true",
      });
    if (op === "edit")
      result = await client.rpc("platform_manual_subscription", {
        t,
        p_name: field("name"),
        p_plan: field("plan"),
        p_status: field("status"),
        p_end: new Date(field("end") + "T23:59:59Z").toISOString(),
      });
    if (op === "plan")
      result = await client.rpc("platform_plan", {
        p_id: field("id") || null,
        p_name: field("name"),
        p_month: Math.round(Number(field("month")) * 100),
        p_year: Math.round(Number(field("year")) * 100),
        p_days: Number(field("days")),
        p_active: field("active") === "true",
        p_limits: JSON.parse(field("limits")),
        p_features: JSON.parse(field("features")),
      });
    if (!result || result.error) throw result?.error;
    revalidatePath("/superadmin");
    return "Alterações salvas.";
  } catch {
    return "Operação recusada. Verifique os campos, as permissões e possíveis registros duplicados.";
  }
}
