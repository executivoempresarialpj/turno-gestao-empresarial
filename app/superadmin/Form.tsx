"use client";
import { useActionState } from "react";
import { mutate } from "./actions";
export default function Form({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const [message, action, pending] = useActionState(mutate, "");
  return (
    <form action={action}>
      {children}
      <button disabled={pending}>{pending ? "Processando…" : label}</button>
      {message && (
        <p role="status">
          {message}
        </p>
      )}
    </form>
  );
}
