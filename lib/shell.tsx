"use client";
import BookingNotice from "@/components/BookingNotice";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  LayoutDashboard,
  CalendarDays,
  Users,
  Layers3,
  ContactRound,
  Wallet,
  ChartNoAxesColumn,
  Settings,
  Menu,
  SunMoon,
  LogOut,
  ExternalLink,
  ChevronsUpDown,
  Building2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { TenantContext } from "./tenant";
import { db } from "./db";
const links = [
  ["/", "Visão geral", LayoutDashboard],
  ["/agenda", "Agenda", CalendarDays],
  ["/clientes", "Clientes", Users],
  ["/financeiro", "Financeiro", Wallet],
  ["/relatorios", "Relatórios", ChartNoAxesColumn],
  ["/configuracoes", "Configurações", Settings],
] as const;
export default function Shell({
  tenant,
  companies,
  email,
  children,
}: {
  companies: { id: string; name: string }[];
  tenant: {
    tenantId: string;
    tenantName: string;
    slug: string;
    timezone: string;
    role: string;
  };
  email: string;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    [open, setOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme =
      localStorage.getItem("theme") || "light";
  }, []);
  return (
    <TenantContext.Provider value={tenant}>
      <div className="shell">
        <aside className={open ? "side open" : "side"}>
          <div className="brand">
            <i>
              <img src="/turno-icon.png" alt="" width={36} height={36} />
            </i>
            Turno
          </div>
          <div className="business">
            <Building2 size={18} />
            {companies.length === 1 ? (
              <strong>{tenant.tenantName}</strong>
            ) : (
              <select
                aria-label="Empresa"
                value={tenant.tenantId}
                onChange={(e) => {
                  document.cookie =
                    "turno-workspace=" +
                    e.target.value +
                    "; Path=/; SameSite=Lax";
                  location.reload();
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <small>GESTÃO</small>
          {links.map(([url, label, Icon]) => (
            <Link
              onClick={() => setOpen(false)}
              className={path === url ? "current" : ""}
              key={url}
              href={url}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
          <div className="profile">
            <b>{email.slice(0, 2).toUpperCase()}</b>
            <span>
              {email}
              <small>{tenant.role}</small>
            </span>
            <button
              aria-label="Sair"
              onClick={async () => {
                await db().auth.signOut();
                location.href = "/login";
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>
        <div className="work">
          <header className="top">
            <button
              className="mobile"
              onClick={() => setOpen(!open)}
              aria-label="Menu"
            >
              <Menu />
            </button>
            <span>
              Workspace　/　
              <strong>{links.find(([p]) => p === path)?.[1]}</strong>
            </span>
            <div>
              <a href={"/agendar/" + tenant.slug}>
                Página pública <ExternalLink size={14} />
              </a>
              <button
                aria-label="Alternar tema"
                onClick={() => {
                  let theme =
                    document.documentElement.dataset.theme === "dark"
                      ? "light"
                      : "dark";
                  document.documentElement.dataset.theme = theme;
                  localStorage.setItem("theme", theme);
                }}
              >
                <SunMoon size={18} />
              </button>
            </div>
          </header>
          <BookingNotice
            tenantId={tenant.tenantId}
            timezone={tenant.timezone}
          />
          <main className="content">{children}</main>
        </div>
      </div>
    </TenantContext.Provider>
  );
}
