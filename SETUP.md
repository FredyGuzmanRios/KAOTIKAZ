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
        ├─ CONFIRMAR → genera QR real (PNG propio, sin terceros), Brevo → email con QR, Sheet pasa a CONFIRMADO
        └─ RECHAZAR  → Brevo → email con motivo, Sheet pasa a RECHAZADO

En la puerta: staff entra a /escaneo.html (mismo login) → apunta la
cámara a CUALQUIERA de los QR del correo (uno por persona, no uno solo
por compra) → POST /api/escanear lo valida contra el Sheet y marca
SOLO ese boleto como usado (columna EscaneadoEn, un arreglo con una
marca por persona) — si alguien intenta re-entrar con una captura de
pantalla de un boleto ya usado, el staff ve "YA FUE ESCANEADO" con la
hora del primer ingreso; el resto de los boletos de esa misma compra,
si los hay, siguen sin usarse y cada quien puede entrar por separado.
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
| L | CodigoQR | `["KTZ-K-483920-1-A1B2C3D4","KTZ-K-483920-2-E5F6A7B8"]` (JSON; un código por boleto, no uno solo por compra) |
| M | QREnviado | SI / NO |
| N | EmailRegistro | SI / NO |
| O | EmailConfirmacion | SI / NO |
| P | Notas | motivo de rechazo, etc. |
| Q | EscaneadoEn | `["2026-07-05 21:14",""]` (JSON; un valor por boleto, en el mismo orden que CodigoQR — vacío = esa persona todavía no entra) |
| R | NombresBoletos | `["Luis Torres","Marta Díaz"]` (JSON; solo si se compraron 2+ boletos) |

**El precio ya NO se controla desde la hoja "Config"** (ese mecanismo se
quitó: `init-sheet` reescribía `Config!A1:B1` a 400 cada vez que se
corría, así que era fácil resetear el precio sin querer). Ahora el
precio vigente lo decide `backend-ejemplo/lib/precio.js` por fecha —
ahí hay una tabla de etapas (ej. `$150` hasta el 30 de septiembre 2026,
`$250` normal después). Para cambiar precios o fechas, edita esa tabla
y vuelve a desplegar; no hace falta tocar el Sheet.

Override de emergencia sin redeploy: define `PRECIO_BOLETO` en las
variables de entorno de Coolify y reinicia la app — ese valor gana
sobre la tabla mientras esté definido. Normalmente se deja vacío.

**Si tu Sheet ya existía antes de la columna Q o R:** vuelve a correr
`npm run init-sheet` una vez (con el `.env` de siempre) — solo reescribe
la fila de encabezados (A1:R1), no toca ninguna fila de datos, y así
agrega los encabezados `EscaneadoEn` y `NombresBoletos` que falten.

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
5. Los 4 correos (registro, aviso admin, confirmación con QR, rechazo) ya están como plantillas HTML en `backend-ejemplo/lib/brevo.js` — edita textos/colores ahí. No usamos plantillas de Brevo para no depender de su editor, pero si prefieres, la API acepta `templateId` en lugar de `htmlContent`. El correo de **confirmación** (`plantillaConfirmacion`) incluye la ubicación del venue como link de Google Maps (`UBICACION_URL`, arriba de `plantillaConfirmacion` en ese archivo) — el de registro NO la trae porque el pago todavía no está confirmado. Si el venue cambia, actualiza ese link ahí.
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
proxy de Coolify para `/admin.html` **y** `/escaneo.html` (mismo login de
staff, mismo nivel de sensibilidad). Aunque alguien encontrara un bug en el
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

   Para limitarlo a `/admin.html` y `/escaneo.html` crea un router adicional con regla de path:

   ```
   traefik.http.routers.kadmin.rule=Host(`kaotikaz.com`) && (Path(`/admin.html`) || Path(`/escaneo.html`))
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

## 10. QR real y escaneo de acceso en la puerta — UN QR POR PERSONA

- El QR ya NO lo genera un servicio externo: `lib/qr.js` usa la librería
  `qrcode` (npm) para dibujar el PNG en el propio servidor.
- **Desde que se agregó el nombre por boleto, cada boleto de la compra
  tiene su PROPIO código QR** — no uno solo compartido para toda la
  compra. Si alguien compra 3 boletos (el comprador + 2 invitados con
  nombre), el correo de confirmación trae **3 bloques separados**, cada
  uno con el nombre de esa persona arriba de su propio QR (`lib/qr.js` →
  `generarQrsPorPersona`, `lib/brevo.js` → `plantillaConfirmacion`). Cada
  QR también va **adjunto** al correo como `boleto-<folio>-<N>.png`, así
  cada quien puede guardar/imprimir solo el suyo.
- **La imagen del QR dentro del correo se referencia por su propia URL,
  NO como data-URI incrustado.** Se probó primero con data-URI
  (`<img src="data:image/png;base64,...">`) y no se veía en Gmail — Gmail
  bloquea por default un `<img>` con imagen base64 incrustada, y Brevo
  confirmó que su API de correo transaccional no soporta imágenes inline
  por Content-ID (cid), ni por API ni por SMTP. La solución: un endpoint
  público nuevo, `GET /api/qr/:codigo.png`, que vuelve a dibujar (nunca
  genera uno nuevo) el PNG de un código ya existente — mismo tratamiento
  que ya se usaba para el logo (`LOGO_URL` en `lib/brevo.js`). No exige
  sesión (los clientes de correo cargan imágenes sin cookies) ni consulta
  el Sheet: como el código ya viaja en texto plano en el mismo correo
  (impreso en rosa debajo de cada QR), regenerar su imagen no expone nada
  nuevo. Sí valida el FORMATO del código (regex `KTZ-...`) para no
  convertirse en "conviérteme cualquier texto en QR gratis", y tiene su
  propio límite de peticiones por minuto. La imagen se sirve con
  `Cache-Control` de un año (el PNG de un código dado nunca cambia).
  Verificado con `jsQR` que el PNG servido por esta URL decodifica
  exactamente al mismo texto del código, y que es byte-idéntico al PNG
  que se manda adjunto.
- `/escaneo.html` (link "📷 ESCANEAR ACCESOS" desde `/admin.html`) usa la
  cámara del celular del staff para leer el QR — la decodificación pasa
  100% en el navegador con la librería `jsQR` (cargada desde jsDelivr,
  agregado a la Content-Security-Policy del backend); ninguna imagen
  viaja a un servidor externo.
- Al escanear, `POST /api/escanear` (requiere sesión de staff) busca el
  código dentro del arreglo `CodigoQR` de CADA compra hasta encontrar en
  cuál aparece, y en qué posición (qué persona es). Si no existe en
  ninguna, o el boleto no está `CONFIRMADO`, avisa; si la posición de
  `EscaneadoEn` de esa persona ya tiene fecha, avisa "YA FUE ESCANEADO"
  con la hora de su ingreso (para detectar reingresos con captura de
  pantalla); si es válido y es la primera vez, marca SOLO esa posición
  del arreglo y deja pasar. **Cada persona entra por separado**: escanear
  el QR de un invitado no consume ni afecta el de los demás boletos de la
  misma compra — pueden llegar en momentos distintos, por puertas
  distintas, o directamente no venir sin bloquear a los demás.
- El panel de staff (`/admin.html`) refleja esto: la pestaña Confirmados
  muestra "X/Y entraron" (ámbar mientras falta alguien, verde cuando ya
  entró todo el grupo) y el modal de cada caso lista boleto por boleto
  quién ya entró y a qué hora.
- Limitación conocida: como el Sheet no es una base transaccional, dos
  puertas escaneando el MISMO código en el mismo instante podrían, en
  teoría, dejar pasar ambas antes de que la primera escritura se refleje.
  Para un solo punto de acceso (lo normal en un evento de este tamaño)
  no es un problema real.
- **Compatibilidad con confirmaciones viejas**: si un folio se confirmó
  ANTES de este cambio (con el QR único de un solo código de texto plano
  en vez de un arreglo JSON), `POST /api/escanear` sigue soportándolo:
  al no poder interpretarse como JSON, ese código se trata como un
  arreglo de un solo elemento. Ese boleto viejo se sigue pudiendo
  escanear una vez con normalidad, nada más no se puede "partir" en
  varios accesos independientes porque nunca se guardó así.
- **Antes de desplegar:** `cd backend-ejemplo && npm install` (agrega
  `qrcode` y sube `multer` a 2.x), y probar el flujo completo: confirmar
  un registro de prueba de 2+ boletos con nombre → revisar en un correo
  REAL (no solo en las pruebas) que los QR SÍ se vean dentro del cuerpo
  del correo (no solo como adjunto) → abrir `/escaneo.html` desde un
  celular y escanear cada QR por separado, confirmando que uno no bloquea
  al otro (contra la URL real desplegada, por HTTPS — la cámara del
  navegador exige contexto seguro; `http://localhost` también cuenta como
  seguro para pruebas locales). Verificado en este entorno con el
  servidor real corriendo contra dobles en memoria de Sheets/Brevo
  (Playwright + una decodificación real con `jsQR` del PNG servido por
  `GET /api/qr/:codigo.png`), pero sin un correo real en Gmail todavía —
  eso solo se puede confirmar después del deploy.

## 11. Notas de seguridad ya implementadas

- Los comprobantes ya NO se suben a Google Drive (ver §1 y la nota grande en `server.js` sobre `storageQuotaExceeded`): viajan como archivo adjunto en el correo de "Nuevo registro..." al `ADMIN_EMAIL`, nunca con un link público. (El viejo endpoint `GET /api/comprobante/:folio` que los servía desde Drive ya no existe.)
- El tipo del comprobante se verifica por **contenido real** (magic bytes JPEG/PNG/WebP), no por el MIME que declare el cliente.
- La CLABE se cifra AES-256-GCM antes de tocar el Sheet y solo se descifra para staff autenticado.
- Aviso de privacidad (LFPDPPP) en `aviso-privacidad.html`, enlazado en el formulario. Ajusta el correo de contacto y el plazo de retención a tu realidad.

## 12. Estado actual y pendientes

- ✅ Registro → Sheet + Drive + 2 correos Brevo + aviso WhatsApp (wa.me)
- ✅ Panel staff con login real (bcrypt + cookie firmada), lee del Sheet
- ✅ Confirmar → QR **real** (PNG propio, adjunto + incrustado) + correo; Rechazar → correo con motivo
- ✅ Escaneo de acceso en `/escaneo.html` con cámara + `POST /api/escanear`, marca `EscaneadoEn` para evitar reingresos
- ✅ Turnstile opcional, magic bytes, comprobantes vía proxy autenticado, aviso de privacidad
- ⏳ Basic Auth de Traefik en `/admin.html` y `/escaneo.html` (§8) — se configura en Coolify, no en el código. Conviene extender la regla de path del §8 para cubrir también `/escaneo.html`.
- ⏳ Los correos salen de plantillas en `lib/brevo.js`; personaliza textos ahí
- ⏳ `npm install` + prueba end-to-end del QR/escaneo pendiente de correr (ver §10)
