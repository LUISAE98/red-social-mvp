# Cómo crear una cuenta de moderador en Vibra

## Requisitos previos
- Acceso a Firebase Console del proyecto
- Variables de entorno de Firebase Admin configuradas en `.env.local`

---

## Pasos

### 1. Crear una cuenta de Gmail dedicada
Crear una cuenta de Gmail exclusiva para moderación. No usar cuentas personales.

Ejemplo: `moderacion@vibra.mx`

### 2. Activar verificación en dos pasos
En la cuenta de Google recién creada:

1. Ir a [myaccount.google.com](https://myaccount.google.com)
2. Seguridad → Verificación en dos pasos
3. Activar con una app autenticadora (Google Authenticator, Authy, etc.)

### 3. Registrar la cuenta en Vibra
El moderador entra a la app con **"Iniciar sesión con Google"** usando esa cuenta.
Esto crea el usuario en Firebase Auth y genera su UID.

### 4. Obtener el UID
En [Firebase Console](https://console.firebase.google.com) → Authentication → Users → buscar el email del moderador → copiar el UID.

### 5. Asignar el rol de moderador
Desde la raíz del proyecto, correr:

```bash
npx ts-node scripts/set-moderator.ts --uid=<UID_DEL_MODERADOR>
```

### 6. El moderador cierra sesión y vuelve a entrar
El Custom Claim se aplica en el siguiente login. Después ya tiene acceso a `/admin`.

---

## Quitar el rol de moderador

```bash
npx ts-node scripts/set-moderator.ts --uid=<UID_DEL_MODERADOR> --remove
```

---

## Notas de seguridad

- El acceso al panel `/admin` requiere obligatoriamente Google Sign-In. Si el moderador intenta entrar con email/password, el panel muestra pantalla de acceso denegado.
- El rol nunca se asigna desde la app — solo desde este script usando el Admin SDK.
- Cada moderador ve la misma cola de reportes y tiene el mismo nivel de acceso (no hay jerarquía).
