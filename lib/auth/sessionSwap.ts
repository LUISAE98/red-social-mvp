"use client";

// "Estoy cambiando de cuenta", que no es lo mismo que "me estoy yendo".
//
// ⚠️ Existe por un choque real entre dos comportamientos correctos.
//
// `RootChrome` manda a /login a quien cierra sesión, esté donde esté, y hace
// bien: alguien que se sale no puede quedarse en una pantalla a medias.
//
// Pero para pasar de una cuenta a una sesión de invitado hay que cerrar la
// primera antes de abrir la segunda, y durante ese instante no hay nadie. Visto
// desde fuera es idéntico a un cierre de sesión, así que "usar otro correo" en
// mitad de una compra echaba a la persona a la pantalla de login, con la compra
// abierta detrás.
//
// Esto marca ese hueco para que el guardia lo deje pasar. No relaja nada: fuera
// del hueco, un cierre de sesión sigue mandando a /login como siempre.

let cambios = 0;

/** Abre el hueco. Devuelve cómo cerrarlo, y hay que cerrarlo SIEMPRE. */
export function marcarCambioDeCuenta(): () => void {
  cambios += 1;
  let cerrado = false;
  return () => {
    if (cerrado) return;
    cerrado = true;
    cambios -= 1;
  };
}

/** ¿Estamos en mitad de un cambio de cuenta? */
export function hayCambioDeCuenta(): boolean {
  return cambios > 0;
}
