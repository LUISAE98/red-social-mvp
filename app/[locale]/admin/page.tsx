import { redirect } from "next/navigation";

// Server Component: redirección directa (307) sin JS de cliente ni parpadeo.
// El destino gestiona su propia auth.
export default function AdminPage() {
  redirect("/admin/reports");
}
