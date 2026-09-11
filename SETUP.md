# KAOTIKAZ — Guía de configuración

Cómo dejar funcionando la boletera completa: correos con **Brevo**, registro en **Google Sheets** (el "Excel" que alimenta el panel staff), comprobantes en **Google Drive**, notificación por **WhatsApp** (sin API) y deploy en **Coolify**.

## 1. Cómo funciona el flujo

```
Cliente llena el formulario en kaotikaz.com
        │
        ▼
POST /api/compras  (backend valida TODO de nuevo)
        │
        ├─ 1. Sube el comprobante a Google Drive
        ├─ 2. Agrega fila a la hoja "Compras" del Sheet  ← esto alimenta el panel staff
        ├─ 3. Brevo → email de REGISTRO al cliente
        ├─ 4. Brevo → email de AVISO a ti (ADMIN_EMAIL)
        └─ 5. Devuelve link wa.me → el cliente te avisa por WhatsApp con 1 tap
        │
        ▼
Tú entras a /admin.html → ves PENDIENTES (leídos del Sheet)
        │
        ├─ CONFIRMAR → genera QR (simulado), Brevo → email con QR, Sheet pasa a CONFIRMADO
        └─ RECHAZAR  → Brevo → email con motivo, Sheet pasa a RECHAZADO
```

El Google Sheet es la única "base de datos". Puedes abrirlo desde cualquier lado y ver en vivo: quién se registró, si se le mandó cada correo (`EmailRegistro`, `EmailConfirmacion`), su código QR (`CodigoQR`) y si ya se le envió (`QREnviado`).

### Columnas de la hoja "Compras" (no cambiar el orden)

| Col | Campo | Ejemplo |
|-----|-------|---------|
| A | Folio | K-483920 |
| B | Fecha | 2026-07-05 18:40 |
| C | Nombre | Juana Pérez |
| D | Email | juana@mail.com |
| E | WhatsApp | 5512345678 |
| F | Cantidad | 2 |
| G | Monto | 800 |
| H | ClabeCifrada | (texto cifrado AES-256, solo el servidor lo lee) |
| I | ComprobanteURL | link a Drive |
| J | Estado | PENDIENTE / CONFIRMADO / RECHAZADO |
| K | FechaValidado | 2026-07-05 19:02 |
| L | CodigoQR | KTZ-K-483920-A1B2C3D4 |
| M | QREnviado | SI / NO |
| N | EmailRegistro | SI / NO |
| O | EmailConfirmacion | SI / NO |
| P | Notas | motivo de rechazo, etc. |

La hoja "Config" tiene `precio | 400`: cambia ahí el precio del boleto sin tocar código.

## 2. Google (Sheets + Drive) — ~15 min

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) → crea un proyecto (ej. `kaotikaz`).
2. **APIs y servicios → Habilitar APIs**: habilita **Google Sheets API** y **Google Drive API**.
3. **IAM y administración → Cuentas de servicio → Crear cuenta de servicio** (ej. `boletera`). No necesita roles del proyecto.
4. Dentro de la cuenta → **Claves → Agregar clave → JSON**. Se descarga `credenciales.json`. **Guárdalo fuera del repo.**
5. Crea el **Google Sheet** en tu Drive (ej. "Kaotikaz Boletera") y una **carpeta de Drive** (ej. "Kaotikaz Comprobantes").
6. Comparte AMBOS con el correo de la cuenta de servicio (algo como `boletera@kaotikaz.iam.gserviceaccount.com`) como **Editor**. También comparte con los correos de tu staff (solo lectura del Sheet si quieres).
7. Copia los IDs de las URLs:
   - Sheet: `docs.google.com/spreadsheets/d/`**`ESTE_ID`**`/edit` → `SHEETS_ID`
   - Carpeta: `drive.google.com/drive/folders/`**`ESTE_ID`** → `DRIVE_FOLDER_ID`
8. Convierte el JSON a base64 (una línea) para `GOOGLE_CREDENTIALS_B64`:
   - PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("credenciales.json"))`
   - Linux/Mac: `base64 -w0 credenciales.json`
9. Con el `.env` ya lleno, corre una vez: `cd backend-ejemplo && npm run init-sheet` → crea las hojas "Compras" y "Config" con encabezados.

## 3. Brevo (correos) — ~20 min

El plan gratis da **300 correos/día**, de sobra. Cada registro consume 2 correos (cliente + aviso a ti) y cada confirmación 1.

1. Crea cuenta en [brevo.com](https://www.brevo.com) (con `fredyogr@gmail.com` está bien).
2. **Autentica tu dominio** (crítico para no caer en spam): Settings → **Senders, Domains & Dedicated IPs → Domains → Add a domain** → escribe tu dominio (ej. `kaotikaz.com`). Brevo te da registros DNS (código Brevo, **DKIM** y **DMARC**). Agrégalos como registros **TXT** en el panel DNS de tu dominio, espera unos minutos y dale **Authenticate**.
3. **Crea el remitente**: Senders → Add a sender → ej. `boletos@kaotikaz.com` (al estar el dominio autenticado no necesitas que ese buzón exista para enviar; pero si quieres recibir respuestas, configura redirección de correo en tu proveedor de dominio).
4. **API key**: Settings → **SMTP & API → API Keys → Generate a new API key**. Empieza con `xkeysib-...` → va en `BREVO_API_KEY`. (Ojo: pestaña *API Keys*, no *SMTP*.)
5. Los 4 correos (registro, aviso admin, confirmación con QR, rechazo) ya están como plantillas HTML en `backend-ejemplo/lib/brevo.js` — edita textos/colores ahí. No usamos plantillas de Brevo para no depender de su editor, pero si prefieres, la API acepta `templateId` en lugar de `htmlContent`.
6. Prueba: en Brevo → **Transactional → Logs** ves cada envío, si rebotó, si se abrió.

## 4. WhatsApp (sin API, plan wa.me)

No hay forma gratuita/oficial de que un servidor te **empuje** un WhatsApp. El truco implementado:

- Al terminar el registro, la pantalla de éxito muestra **"📱 AVÍSANOS POR WHATSAPP"**: un link `wa.me/TU_NUMERO` con el mensaje ya escrito (folio, nombre, boletos). El cliente lo manda con 1 tap → te llega la notificación del nuevo registro a tu WhatsApp.
- Además **siempre** te llega el email de aviso a `ADMIN_EMAIL` (ese sí es automático), con link wa.me para contactar TÚ al cliente.
- En el panel staff, cada caso tiene botón de WhatsApp al cliente.

`ADMIN_WHATSAPP` va con código de país y solo dígitos. México: `521` + 10 dígitos, ej. `5215512345678`.

Si más adelante quieres notificación 100 % automática: **CallMeBot** (gratis, te manda mensajes a ti mismo, setup de 2 min) o **WhatsApp Cloud API** de Meta (oficial). Se agregaría con un `fetch` más en `/api/compras`.

## 5. Variables de entorno

Copia `backend-ejemplo/.env.example` a `backend-ejemplo/.env` y llena todo. Para generar los secretos:

```bash
cd backend-ejemplo
npm install
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET (otra distinta)
npm run hash-password -- "TuContraseñaDeStaff"                              # ADMIN_PASSWORD_HASH
```

## 6. Probar en local

```bash
cd backend-ejemplo
npm install
npm run init-sheet     # una sola vez
npm start              # http://localhost:3000  y  /admin.html
```

Prueba completa: haz un registro con tu propio correo → revisa que llegue el email, que aparezca la fila en el Sheet y el comprobante en Drive → entra a `/admin.html`, confirma → revisa el email con QR y que el Sheet marque CONFIRMADO / QREnviado = SI.

## 7. Deploy en Coolify

1. Sube el repo a GitHub (privado). Verifica que `.env` esté en `.gitignore`.
2. En Coolify: **+ New → Application → tu repo de GitHub** (conecta la GitHub App si es la primera vez).
3. Build Pack: **Dockerfile** (ya está en la raíz del repo). Puerto: **3000**.
4. En **Environment Variables** pega TODAS las del `.env` (marca como *Build Variable* ninguna; todas son runtime). Incluye `NODE_ENV=production` — esto activa la cookie `Secure` del panel staff.
5. En **Domains** pon `https://kaotikaz.com` (o el tuyo). En el DNS del dominio crea un registro **A** apuntando a la IP del servidor de Coolify. Coolify emite el certificado HTTPS solo (Let's Encrypt).
6. Deploy. Revisa logs: debe decir `Kaotikaz backend en :3000`.
7. Prueba el flujo completo otra vez ya con el dominio real (el link del correo de aviso, el wa.me, etc.).

## 8. Seguridad del panel staff: segunda capa con Basic Auth (Traefik)

Además del login propio (bcrypt + cookie firmada), pon Basic Auth a nivel del
proxy de Coolify SOLO para `/admin.html`. Aunque alguien encontrara un bug en el
login de la app, tendría que pasar primero el del proxy.

1. Genera el usuario/contraseña en formato htpasswd (los `$` se duplican para Docker):

   ```bash
   docker run --rm httpd:alpine htpasswd -nbB staff 'TuOtraContraseña' | sed -e 's/\$/\$\$/g'
   ```

2. En Coolify → tu aplicación → **Advanced → Custom Labels** (o el campo de labels de Docker), agrega:

   ```
   traefik.http.middlewares.admin-auth.basicauth.users=staff:$$2y$$05$$...hash...
   traefik.http.routers.<nombre-router-https>.middlewares=admin-auth
   ```

   Para limitarlo SOLO a `/admin.html` crea un router adicional con regla de path:

   ```
   traefik.http.routers.kadmin.rule=Host(`kaotikaz.com`) && Path(`/admin.html`)
   traefik.http.routers.kadmin.entrypoints=https
   traefik.http.routers.kadmin.tls=true
   traefik.http.routers.kadmin.middlewares=admin-auth
   ```

   (El nombre exacto del router principal lo ves en los labels que Coolify ya
   generó para tu app; Traefik da prioridad al router con regla más específica.)

3. Al abrir `/admin.html` el navegador pedirá el usuario/contraseña del proxy y
   DESPUÉS verás el login de la app. Dos llaves distintas — guárdalas por separado.

## 9. CAPTCHA — Cloudflare Turnstile (gratis)

El honeypot ya frena bots básicos; Turnstile frena los sofisticados. Es gratis e invisible para la mayoría de usuarios.

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile** → **Add site**.
2. Nombre: Kaotikaz. Domain: `kaotikaz.com` (agrega también `localhost` para probar en local). Widget mode: **Managed**.
3. Te da dos llaves: **Site Key** → `TURNSTILE_SITE_KEY` y **Secret Key** → `TURNSTILE_SECRET`.
4. Ponlas en el `.env` (local) y en las variables de Coolify. Reinicia.

Comportamiento: si las variables están vacías, el sitio funciona **sin** captcha (modo dev). Con las llaves puestas, el widget aparece en el paso 2 del formulario y el servidor rechaza cualquier compra sin token válido.

## 10. Notas de seguridad ya implementadas

- Los comprobantes NUNCA se sirven con link público de Drive: el panel staff los ve vía `GET /api/comprobante/:folio`, que exige sesión y descarga el archivo con la service account.
- El tipo del comprobante se verifica por **contenido real** (magic bytes JPEG/PNG/WebP), no por el MIME que declare el cliente.
- La CLABE se cifra AES-256-GCM antes de tocar el Sheet y solo se descifra para staff autenticado.
- Aviso de privacidad (LFPDPPP) en `aviso-privacidad.html`, enlazado en el formulario. Ajusta el correo de contacto y el plazo de retención a tu realidad.

## 11. Estado actual y pendientes

- ✅ Registro → Sheet + Drive + 2 correos Brevo + aviso WhatsApp (wa.me)
- ✅ Panel staff con login real (bcrypt + cookie firmada), lee del Sheet
- ✅ Confirmar → QR **simulado** + correo con QR; Rechazar → correo con motivo
- ✅ Turnstile opcional, magic bytes, comprobantes vía proxy autenticado, aviso de privacidad
- ⏳ QR real validable en puerta: sustituir `lib/qr.js` por la librería `qrcode` (genera PNG propio y se adjunta al correo) + una vista de escaneo para el staff
- ⏳ Basic Auth de Traefik en `/admin.html` (§8) — se configura en Coolify, no en el código
- ⏳ Los correos salen de plantillas en `lib/brevo.js`; personaliza textos ahí
