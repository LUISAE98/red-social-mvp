"use client";

// Catálogo de estados del panel de registro para retiros.
//
// 🔒 SOLO EN DESARROLLO. En producción devuelve 404, ver la guarda del componente.
//
//    Vivió un rato bajo `/admin`, y ahí el portero exige el claim de moderador CON sesión
//    de Google. Revisando el diseño se entra con la cuenta de creador de prueba, no con la
//    del dueño, así que rebotaba a la portada. Aquí no hace falta candado: la página no lee
//    un solo dato de nadie, solo pinta cadenas de `messages`.
//
// 🎯 PARA QUÉ. Los avisos del panel aparecen en situaciones que casi nunca se pueden provocar
//    a mano: una cuenta que Stripe restringe, un sello vencido, un país sin ruta de pago.
//    Sin esto, la única forma de ver cómo se leen era esperar a que le pasara a un creador.
//
// ⚠️ IMPORTA LOS COMPONENTES DE VERDAD, no copias. `Paso` y `Aviso` salen del propio panel,
//    así que cualquier cambio de estilo o de copy se ve aquí solo. Una maqueta con estilos
//    duplicados habría empezado a mentir en el primer ajuste — que es exactamente lo que pasó
//    con los ~60 comentarios de «$3» que hubo que barrer.
//
// Los textos salen de `messages`, así que esta pantalla también sirve para revisar la copy
// en cualquier idioma: cambia el locale de la URL y se traduce sola.

import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { Paso, Aviso } from "@/app/[locale]/(protected)/wallet/components/CreatorPayoutSetupPanel";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Bloque con título, para separar las familias de estados. */
function Seccion({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 44 }}>
      <h2
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          margin: "0 0 4px",
          letterSpacing: "-0.01em",
        }}
      >
        {titulo}
      </h2>
      {nota && (
        <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", margin: "0 0 16px", lineHeight: 1.5 }}>
          {nota}
        </p>
      )}
      <div style={{ display: "grid", gap: 18 }}>{children}</div>
    </section>
  );
}

/** Cada caso, con su etiqueta de cuándo ocurre. */
function Caso({ cuando, children }: { cuando: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "rgba(168,85,247,0.9)",
          marginBottom: 8,
        }}
      >
        {cuando}
      </div>
      {/* Fondo del panel real, para que el gris de los avisos se juzgue sobre lo que va. */}
      <div style={{ background: "#0a0a0a", borderRadius: 14, padding: "18px 20px" }}>{children}</div>
    </div>
  );
}

export default function CatalogoDePaneles() {
  // 🔒 Fuera de desarrollo esta ruta no existe. La guarda va aquí y no en el middleware
  //    para que no haya forma de llegar por otro camino.
  if (process.env.NODE_ENV === "production") notFound();

  const t = useTranslations("wallet");

  return (
    <div style={{ padding: "8px 4px 64px", fontFamily: FONT, maxWidth: 620 }}>
      <style>{`@keyframes vbPasoSpin{to{transform:rotate(360deg)}}`}</style>

      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "0 0 6px" }}>
        Registro para retiros · todos los estados
      </h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, margin: "0 0 36px" }}>
        Los componentes son los del panel real, no una maqueta. Cambia el idioma en la URL para
        revisar la copy traducida.
      </p>

      {/* ── LOS RECHAZOS, cada uno dentro de su paso ───────────────────── */}
      <Seccion
        titulo="Rechazos · el aviso vive DENTRO de su paso"
        nota="Un rechazo devuelve el paso a pendiente, así que recupera su botón y el botón nombra la corrección. Antes el paso seguía en verde y el aviso pedía arreglar algo cuyo botón estaba escondido."
      >
        <Caso cuando="La cuenta declarada no es la registrada en Stripe">
          <Paso
            numero={2}
            estado="pendiente"
            titulo={t("payoutSetupStepDeclare")}
            descripcion={t("payoutSetupStepDeclareHint")}
            hecho={t("payoutSetupStepDeclareDone")}
            aviso={{ tono: "alerta", texto: t("payoutSetupAccountMismatch") }}
            accion={t("payoutSetupStepDeclareFix")}
            onAccion={() => {}}
          />
        </Caso>

        <Caso cuando="Stripe restringió la cuenta">
          <Paso
            numero={3}
            estado="pendiente"
            titulo={t("payoutSetupStepPayout")}
            descripcion={t("payoutSetupStepPayoutHint")}
            hecho={t("payoutSetupStepPayoutDone")}
            aviso={{ tono: "alerta", texto: t("payoutSetupPayoutRestricted") }}
            accion={t("payoutSetupStepPayoutResume")}
            onAccion={() => {}}
          />
        </Caso>

        <Caso cuando="El sello digital venció · solo mexicanos">
          <Paso
            numero={4}
            estado="pendiente"
            titulo={t("payoutSetupStepSeal")}
            descripcion={t("payoutSetupStepSealHint")}
            hecho={t("payoutSetupStepSealDone")}
            aviso={{ tono: "alerta", texto: t("payoutSetupSealExpired") }}
            accion={t("payoutSetupStepSealFix")}
            onAccion={() => {}}
          />
        </Caso>
      </Seccion>

      <Seccion
        titulo="En proceso · no hay nada que pulsar"
        nota="El paso informa en vez de pedir. Su botón está apagado y la descripción dice por qué."
      >
        <Caso cuando="Didit revisa la identidad a mano · hasta 48 horas">
          <Paso
            numero={1}
            estado="pendiente"
            titulo={t("payoutSetupStepIdentity")}
            descripcion={t("payoutSetupStepIdentityReviewing")}
            hecho={t("payoutSetupStepIdentityDone")}
            accion={t("payoutSetupStepIdentityCta")}
          />
        </Caso>

        <Caso cuando="Stripe revisa los datos de la cuenta">
          <Paso
            numero={3}
            estado="pendiente"
            titulo={t("payoutSetupStepPayout")}
            descripcion={t("payoutSetupStepPayoutReviewing")}
            hecho={t("payoutSetupStepPayoutDone")}
            accion={t("payoutSetupStepPayoutResume")}
            onAccion={() => {}}
          />
        </Caso>

        <Caso cuando="El sello no se pudo validar · Facturapi lo rechazó">
          <Paso
            numero={4}
            estado="pendiente"
            titulo={t("payoutSetupStepSeal")}
            descripcion={t("payoutSetupStepSealHint")}
            hecho={t("payoutSetupStepSealDone")}
            aviso={{ tono: "alerta", texto: t("payoutSetupSealRejected") }}
            accion={t("payoutSetupStepSealFix")}
            onAccion={() => {}}
          />
        </Caso>
      </Seccion>

      <Seccion
        titulo="Advertencias · no bloquean, pero cambian lo que recibe"
        nota="El paso sigue completado. Solo informan."
      >
        <Caso cuando="Wallbit sin banco local · Chile, Uruguay, Paraguay, Honduras">
          <Paso
            numero={2}
            estado="listo"
            titulo={t("payoutSetupStepWallbit")}
            descripcion={t("payoutSetupStepWallbitHint")}
            hecho={t("payoutSetupStepWallbitDone")}
            aviso={{ tono: "aviso", texto: t("payoutSetupWallbitUsdOnly") }}
            accion={t("payoutSetupStepWallbitCta")}
          />
        </Caso>

        <Caso cuando="Mexicano que cobra en una cuenta fuera de México">
          <Paso
            numero={3}
            estado="listo"
            titulo={t("payoutSetupStepPayout")}
            descripcion={t("payoutSetupStepPayoutHint")}
            hecho={t("payoutSetupStepPayoutDone")}
            aviso={{ tono: "aviso", texto: t("payoutSetupForeignAccountWarning") }}
            accion={t("payoutSetupStepPayoutCta")}
          />
        </Caso>
      </Seccion>

      <Seccion
        titulo="El único aviso que sigue suelto"
        nota="No es de ningún paso: no hay nada que el creador pueda corregir, es su país el que todavía no cobra."
      >
        <Caso cuando="El país de la cuenta no tiene ruta de pago · 58 países">
          <Aviso tono="alerta" texto={t("payoutNoRouteWarning")} />
        </Caso>
      </Seccion>

      {/* ── LOS PASOS, para juzgar los avisos en su sitio ──────────────── */}
      <Seccion titulo="Estados de un paso" nota="Cómo se ve cada paso según en qué punto está.">
        <Caso cuando="Pendiente · con su botón">
          <Paso
            numero={1}
            estado="pendiente"
            titulo={t("payoutSetupStepIdentity")}
            descripcion={t("payoutSetupStepIdentityHint")}
            hecho={t("payoutSetupStepIdentityDone")}
            accion={t("payoutSetupStepIdentityCta")}
            onAccion={() => {}}
          />
        </Caso>

        <Caso cuando="Cargando · spinner morado y botón apagado">
          <Paso
            numero={2}
            estado="pendiente"
            titulo={t("payoutSetupStepDeclare")}
            descripcion={t("payoutSetupStepDeclareHint")}
            hecho={t("payoutSetupStepDeclareDone")}
            cargando
            accion={t("payoutSetupStepDeclareCta")}
          />
        </Caso>

        <Caso cuando="Bloqueado · el paso 3 antes de declarar la cuenta">
          <Paso
            numero={3}
            estado="pendiente"
            titulo={t("payoutSetupStepPayout")}
            descripcion={t("payoutSetupStepPayoutHint")}
            hecho={t("payoutSetupStepPayoutDone")}
            accion={t("payoutSetupStepPayoutCta")}
          />
        </Caso>

        <Caso cuando="En revisión · Stripe está mirando los datos">
          <Paso
            numero={3}
            estado="pendiente"
            titulo={t("payoutSetupStepPayout")}
            descripcion={t("payoutSetupStepPayoutReviewing")}
            hecho={t("payoutSetupStepPayoutDone")}
            accion={t("payoutSetupStepPayoutResume")}
            onAccion={() => {}}
          />
        </Caso>

        <Caso cuando="Hecho · palomita y línea verde">
          <Paso
            numero={4}
            estado="listo"
            titulo={t("payoutSetupStepSeal")}
            descripcion={t("payoutSetupStepSealHint")}
            hecho={t("payoutSetupStepSealDone")}
            accion={t("payoutSetupStepSealReplace")}
            onAccion={() => {}}
          />
        </Caso>
      </Seccion>

      <Seccion
        titulo="El panel completo con un paso rechazado"
        nota="Un mexicano cuya cuenta declarada no coincide con la de Stripe. Es donde se juzga si el aviso gris se nota lo suficiente."
      >
        <Caso cuando="Pasos 1 y 2 hechos, cuenta que no cuadra">
          <div style={{ display: "grid", gap: 32 }}>
            <Paso
              numero={1}
              estado="listo"
              titulo={t("payoutSetupStepIdentity")}
              descripcion={t("payoutSetupStepIdentityHint")}
              hecho={t("payoutSetupStepIdentityDone")}
              accion={t("payoutSetupStepIdentityCta")}
            />
            <Paso
              numero={2}
              estado="pendiente"
              titulo={t("payoutSetupStepDeclare")}
              descripcion={t("payoutSetupStepDeclareHint")}
              hecho={t("payoutSetupStepDeclareDone")}
              aviso={{ tono: "alerta", texto: t("payoutSetupAccountMismatch") }}
              accion={t("payoutSetupStepDeclareFix")}
              onAccion={() => {}}
            />
            <Paso
              numero={3}
              estado="pendiente"
              titulo={t("payoutSetupStepPayout")}
              descripcion={t("payoutSetupStepPayoutHint")}
              hecho={t("payoutSetupStepPayoutDone")}
              accion={t("payoutSetupStepPayoutCta")}
            />
            <Paso
              numero={4}
              estado="pendiente"
              titulo={t("payoutSetupStepSeal")}
              descripcion={t("payoutSetupStepSealHint")}
              hecho={t("payoutSetupStepSealDone")}
              accion={t("payoutSetupStepSealCta")}
              onAccion={() => {}}
            />
          </div>
        </Caso>
      </Seccion>
    </div>
  );
}
