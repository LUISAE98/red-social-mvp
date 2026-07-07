import { Suspense } from "react";
import ResetPasswordClient from "./ResetPasswordClient";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Cargando...</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}