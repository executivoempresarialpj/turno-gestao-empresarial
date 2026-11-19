"use client";
import { createContext, useContext } from "react";
export const TenantContext = createContext({
  tenantId: "",
  tenantName: "",
  slug: "",
  timezone: "America/Sao_Paulo",
  role: "",
});
export const useTenant = () => useContext(TenantContext);
