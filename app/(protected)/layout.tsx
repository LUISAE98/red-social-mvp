import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSessionUser } from "@/lib/auth-server";
import ProtectedShell from "./ProtectedShell";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getServerSessionUser();

  if (!user) {
    redirect("/login");
  }

  return <ProtectedShell>{children}</ProtectedShell>;
}