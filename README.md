# Mando web para la tele LG (Termux)

Mando a distancia en el navegador para la **LG 32LF592U-ZB** (webOS 2.0, 2015, firmware 03.21.40, IP `192.168.1.39`).
Un pequeño servidor Node.js corre en Termux (Android), habla con la tele por **SSAP** (`ws://192.168.1.39:3000`)
y sirve una página táctil en `http://127.0.0.1:8765` que imita el mando LG.

- Una sola dependencia: [`ws`](https://github.com/websockets/ws) (ya incluida en `node_modules/`, JavaScript puro: no hace falta compilar nada).
- Empareja una vez (aviso en la tele) y guarda la *client-key* en `tv-state.json`, junto al script.
- Reconexión automática; la página muestra **Conectado / Esperando aceptar en la TV / Desconectado** y el volumen.
- Escucha en `0.0.0.0:8765` (solo IPv4: el kernel de esta tele no tiene IPv6), así que la tablet puede usar el servidor del móvil (`http://IP-del-móvil:8765`).
- La pestaña **Enviar** manda un enlace o un archivo del móvil a la tele (vídeo, foto o audio). No duplica la pantalla.

## 1. Instalación en Termux

Instala **Termux desde F-Droid** (o GitHub); la versión de Google Play está abandonada.

```sh
pkg update && pkg upgrade
pkg install nodejs git
```

### Opción A (recomendada): git

```sh
cd ~
git clone https://github.com/ChristianGonper/lg-remote.git
cd lg-remote
```

Para actualizar más adelante:

```sh
cd ~/lg-remote && git pull
```

(Tu `config.json` y `tv-state.json` no están en git, así que `git pull` no los toca.)

### Opción B: zip

1. Descarga `lg-remote.zip` en el móvil (carpeta *Descargas*).
2. En Termux, da acceso al almacenamiento **una vez**: `termux-setup-storage` (acepta el permiso).
3. Copia y descomprime:
   ```sh
   pkg install unzip
   cd ~ && unzip ~/storage/downloads/lg-remote.zip
   cd lg-remote
   ```

> No ejecutes el proyecto desde `~/storage/...` (la memoria compartida no permite ejecutables ni enlaces); cópialo a `~` como arriba.

`node_modules/ws` ya viene incluido. Si algún día lo borras: `npm install`.

## 2. Configuración (opcional)

Por defecto usa la IP `192.168.1.39`, puerto 3000 (ws). Para cambiar algo:

```sh
cp config.example.json config.json
nano config.json
```

| Clave | Variable de entorno | Por defecto | Significado |
|---|---|---|---|
| `tvIp` | `TV_IP` | `192.168.1.39` | IP de la tele (mejor fíjala en el router con reserva DHCP) |
| `tvPort` | `TV_PORT` | 3000 (3001 si `secure`) | Puerto SSAP |
| `secure` | `TV_SECURE` | `false` | `true` = `wss://IP:3001` (certificado autofirmado aceptado) |
| `mac` | `TV_MAC` | (vacío) | MAC para Wake-on-LAN; si está vacío se usa la que la tele da por SSAP |
| `host` | `HOST` | `0.0.0.0` | Interfaz de escucha (`127.0.0.1` = solo este móvil) |
| `port` | `PORT` | `8765` | Puerto de la página |
| `wolAddresses` | `WOL_ADDRESSES` | `255.255.255.255, 192.168.1.255, IP tele` | Destinos del paquete mágico |
| `ytSearch` | `YT_SEARCH` | `auto` | Formato de búsqueda en YouTube: `url`, `hash`, `q` o plantilla con `{q}` (ver “Texto y YouTube”) |
| `castHost` | `CAST_HOST` | (vacío = autodetectar) | IPv4 que la tele usa para bajar archivos. Si está vacío se elige la IPv4 de esta máquina que está en la misma subred /24 que la tele (`192.168.1.34` si la tele es `192.168.1.39`) |
| `castMaxMb` | `CAST_MAX_MB` | `2048` | Tamaño máximo de un archivo subido desde el móvil |
| `castDir` | `CAST_DIR` | temporal del sistema | Carpeta de esos archivos (uno cada vez; se borran a las `castTtlHours`) |
| `castTtlHours` | `CAST_TTL_HOURS` | `12` | Horas que se conserva el archivo servido |
| `castDryRun` | `CAST_DRY_RUN` | `false` | `true` = la pestaña Enviar calcula los mensajes SSAP pero no los manda |
| `ytAutoOkMs` | `YT_AUTO_OK_MS` | `18000` | Tras abrir YouTube en frío, espera estos milisegundos (cuando la app ya está delante) y pulsa OK una vez. `0` lo desactiva |

Ejemplo sin fichero: `TV_IP=192.168.1.50 node server.js`.

## 3. Arrancar

```sh
cd ~/lg-remote
./start.sh          # o: node server.js
```

Abre **http://127.0.0.1:8765** en Chrome del móvil.
Desde la tablet: `http://IP-del-móvil:8765` (el servidor la muestra al arrancar; ambos en la misma Wi-Fi).
También puedes instalar Termux en la tablet y ejecutarlo allí.

**La primera vez** la tele (encendida) muestra un aviso de *“Solicitud de conexión”*: acéptalo con el mando físico.
La página muestra “Esperando aceptar en la TV” hasta entonces. La key se guarda en `tv-state.json` y no vuelve a preguntar.
Si la tele no muestra el aviso, revisa en la tele *Ajustes → Red → LG Connect Apps* (activado).

Para parar: `Ctrl+C` en Termux. Para volver a emparejar desde cero: borra `tv-state.json`.

## 4. Dejarlo funcionando

- **Que Android no lo mate**: `start.sh` ya ejecuta `termux-wake-lock` (verás la notificación de Termux “wake lock held”).
  Quita la optimización de batería para Termux (Ajustes de Android → Apps → Termux → Batería → Sin restricciones).
  Para liberar: `termux-wake-unlock`.
- **En segundo plano dentro de Termux**: `nohup ./start.sh > lg-remote.log 2>&1 &`
- **Arranque al encender el móvil (opcional)**: instala la app **Termux:Boot** (F-Droid), ábrela una vez y:
  ```sh
  mkdir -p ~/.termux/boot
  printf '#!/data/data/com.termux/files/usr/bin/sh\ntermux-wake-lock\ncd ~/lg-remote && node server.js > lg-remote.log 2>&1\n' > ~/.termux/boot/lg-remote.sh
  chmod +x ~/.termux/boot/lg-remote.sh
  ```
- **Acceso directo en la pantalla de inicio**: en Chrome con la página abierta → menú ⋮ → **Añadir a pantalla de inicio** (o *Instalar aplicación*).
  Se abre a pantalla completa, en vertical, con icono propio. (El servidor tiene que estar corriendo en Termux.)
  Opcional: con **Termux:Widget** puedes poner un botón que lance el servidor: `mkdir -p ~/.shortcuts && ln -s ~/lg-remote/start.sh ~/.shortcuts/mando-lg`.

## 5. Encendido: limitaciones (léelo)

**Apagar** funciona siempre que la tele esté conectada (`ssap://system/turnOff`).

**Encender** por red es otra historia. Cuando la tele está apagada no hay servidor SSAP: solo se puede despertar con
**Wake-on-LAN** (paquete mágico a su MAC). Está en *Más teclas → Encender (WoL)*; la MAC se aprende sola por SSAP
(`com.webos.service.connectionmanager/getinfo`, Wi-Fi y cable) o se fija con `mac`/`TV_MAC`.

En esta tele (webOS 2.0, 2015, por **Wi-Fi**) lo normal es que **no funcione** o solo funcione un rato:
- Los modelos 2015 no tienen la opción “Mobile TV On / Encender mediante Wi-Fi” (llegó en 2016-2017). Lo más parecido
  es *Ajustes → Red → LG Connect Apps* y, en algunos modelos, *Ajustes → General → Mobile App / Aplicación móvil*: actívalos.
- Al apagarse, la tele mantiene la red unos **2-10 minutos** y luego apaga el módulo Wi-Fi: el WoL solo funciona en esa ventana.
- Por **cable Ethernet** tiene más posibilidades (y entonces hay que usar la MAC *cableada*, que también se envía).
- El paquete debe salir en la **misma red/subred** (se manda a `255.255.255.255`, `192.168.1.255` y la IP de la tele).
- Alternativas fiables: botón físico / mando IR, un móvil con emisor IR, o HDMI-CEC (un Chromecast/consola enciende la tele).

Decisión actual: se enciende con el botón físico o el mando; el botón WoL queda como extra por si funciona.

## 6. Botones implementados

| UI | Cómo se envía |
|---|---|
| Apagar | `ssap://system/turnOff` (pide confirmación) |
| Encender (WoL) | paquete mágico UDP 9 y 7 (ver limitaciones) |
| Vol +/− (mantener = repetir) | `ssap://audio/volumeUp` / `volumeDown` |
| Silencio | `ssap://audio/setMute` alternando (estado de `audio/getVolume`); si falla, tecla `MUTE` |
| CH +/− | `ssap://tv/channelUp` / `channelDown` |
| Entrada | Solo las que devuelve `ssap://tv/getExternalInputList` (si falla: apps HDMI/AV de `listLaunchPoints`/`listApps`). Cambiar: `system.launcher/launch {id}` de esa app (`com.webos.app.hdmiN`, `externalinput.scart` / `av1` / `av2` / `component`); si el lanzamiento falla o no responde, `ssap://tv/switchInput {inputId}`. Una entrada sin señal se lista igual y se puede pulsar. |
| Live TV | `ssap://system.launcher/launch {id: com.webos.app.livetv}` |
| ▲ ▼ ◀ ▶ OK, Atrás, Inicio, Salir | pointer socket: `UP DOWN LEFT RIGHT ENTER BACK HOME EXIT` |
| Ajustes, Q.MENU, Guía, Info, Lista | pointer socket: `MENU QMENU GUIDE INFO LIST` |
| Rojo/Verde/Amarillo/Azul | `RED GREEN YELLOW BLUE` |
| 0-9, guion | `0`…`9`, `DASH` |
| ⏪ ▶ ⏸ ⏹ ⏩ | `ssap://media.controls/rewind\|play\|pause\|stop\|fastForward`; si falla, teclas `REWIND PLAY PAUSE STOP FASTFORWARD` |
| Más teclas | `CC` (subtítulos), `SAP` (audio), `TELETEXT`, `TEXTOPTION`, `ASPECT_RATIO`, `AD`, `3D_MODE`, `RECORD`, `PROGRAM`, `MYAPPS`, `RECENT`, `ASTERISK`, `POWER`, `NETFLIX`; Pantalla off/on (`com.webos.service.tv.power/turnOffScreen` en webOS < 4) |
| Touchpad | pointer socket `type:move dx dy`, toque = `type:click`, dos dedos = `type:scroll` |
| Texto | `ssap://com.webos.service.ime/insertText`, `sendEnterKey`, `deleteCharacters` (campo de texto del sistema abierto). Con YouTube delante: búsqueda por deep link (abajo) e Intro = tecla OK |
| Buscar en YouTube | `system.launcher/launch {id: youtube.leanback.v4, params: {contentTarget: …}}` |
| Apps | `listLaunchPoints` (si falla: `listApps`) → `system.launcher/launch` |
| Aviso de prueba | `ssap://system.notifications/createToast` |

Al pulsar, el móvil vibra (`navigator.vibrate`). Volumen, canales y flechas se repiten manteniendo pulsado.

Los mensajes del pointer socket (`ssap://com.webos.service.networkinput/getPointerInputSocket`) tienen la forma
`type:button\nname:UP\n\n`.

### Nombres de teclas verificados

Contrastados con el código de **aiowebostv** (`aiowebostv/buttons.py`), **bscpylgtv** (`bscpylgtv/buttons.py`) y el README de **lgtv2**.
Seguras en webOS 2 (en lgtv2 y usadas desde 2014): `LEFT RIGHT UP DOWN ENTER BACK EXIT HOME MENU INFO DASH ASTERISK CC
PLAY PAUSE STOP REWIND FASTFORWARD RED GREEN YELLOW BLUE VOLUMEUP VOLUMEDOWN MUTE CHANNELUP CHANNELDOWN 0-9`.

Podrían no hacer nada en webOS 2.0 (vienen de listas de modelos más nuevos): `QMENU`, `GUIDE`, `LIST`, `PROGRAM`, `SAP`,
`TELETEXT`, `TEXTOPTION`, `ASPECT_RATIO`, `AD`, `3D_MODE` (la 32LF592 no es 3D), `RECORD`, `MYAPPS`, `RECENT`, `NETFLIX`, `POWER`.
Una tecla desconocida simplemente se ignora. No hay tecla “INPUT” en esas listas (por eso Entrada usa la lista de entradas;
`INPUT_HUB` existe pero es de modelos recientes). `DASH` es el guion del teclado numérico.

### Texto y YouTube (limitaciones)

- El envío de texto usa el IME del sistema (`com.webos.service.ime/insertText`). Funciona en campos del
  sistema (LG Store, navegador, buscador de LG…), **no en la app de YouTube** de webOS 2: esa app dibuja
  su propio teclado en pantalla y no escucha el IME (la tele responde OK pero no aparece nada). El pointer
  socket tampoco tiene teclas de letras (solo flechas, OK, números…).
- Por eso, si la app en primer plano (`getForegroundAppInfo`) es YouTube, el texto se envía como
  **búsqueda** relanzando YouTube con `params.contentTarget`. Formatos (selector junto a “Buscar en YouTube”):
  - `url` → `https://www.youtube.com/tv?launch=search&q=…` — la app web antigua (webOS 1-3) usa como deep
    link la URL completa (`"contentTarget":"https://www.youtube.com/tv?v=$CONTENTID"`, igual que lgtv2 /
    LGWebOSRemote / ConnectSDK, que usa `?launch=search&v=`).
  - `hash` → `https://www.youtube.com/tv#/search?q=…` (ruta interna de youtube.com/tv).
  - `q` → `q=…` — es el `inAppSearchParams` oficial de la app Cobalt de webOS 4+ (`"contentTarget":"q=$SEARCH_KEYWORD"`).
  - `auto` (por defecto) lee `deeplinkingParams`/`inAppSearchParams` que la propia tele da en `listApps`
    y elige; en esta tele debería resultar `url`. Diagnóstico: `curl -X POST -d '{"type":"ytInfo"}' http://127.0.0.1:8765/api/action`.
  Ninguno está probado en esta tele concreta: si `auto` solo abre YouTube sin buscar, prueba `hash` y `q`.
- Navegar automáticamente el teclado en pantalla de YouTube con flechas/OK **no está implementado**: la
  posición inicial del cursor y la distribución del teclado cambian entre versiones de la app, y un paso
  perdido escribe basura. Como último recurso se puede usar el touchpad/flechas + OK a mano.
- `Intro` con YouTube delante pulsa OK por el pointer socket; `Borrar` (deleteCharacters) no afecta al
  teclado propio de YouTube.

### Errores de la tele

Cada petición SSAP fallida se escribe en la consola de Termux (`ERROR TV ssap://… -> 500 Application error {…}`
con la respuesta cruda) y las últimas 50 se ven en `http://127.0.0.1:8765/api/log`. Los `500 Application error`
de webOS 2 son fallos del servicio de la tele (a menudo transitorios o según la app en primer plano): se
reintenta una vez y después se usan las alternativas de la tabla.

## 7. Enviar a la tele (vídeo, foto o audio)

No es duplicar la pantalla ni usar el Chromecast. La tele **descarga** un enlace http(s) o un archivo que el móvil sirve por la Wi-Fi, y lo abre con su reproductor (o con la app de YouTube). Hace falta que el móvil y la tele estén en la misma red y que el router no aísle los clientes Wi-Fi.

En la pestaña **Enviar**:

1. **URL.** Pega un enlace directo (`mp4`, `mp3`, `jpg`, `m3u8`…) y pulsa Enviar. Un enlace de YouTube (`youtube.com`, `youtu.be`, Shorts, una lista) **no** pasa por el reproductor: se abre `youtube.leanback.v4`.
2. **Archivo del móvil.** Eliges un vídeo, una foto o un audio. El navegador lo sube al Node de Termux (`PUT /api/cast/upload`) y la tele lo pide por HTTP. La respuesta acepta `Range: bytes=` para que el reproductor pueda saltar. Solo se guarda el último archivo (por defecto hasta 2 GB, 12 horas, en el temporal del sistema).
3. **Controles.** Play, pausa y stop usan `ssap://media.controls/play|pause|stop` (si fallan, la tecla del pointer socket; stop además cierra el visor o SmartShare). «Ir» intenta un salto al segundo indicado.

Arriba de la pestaña se muestra la IPv4 que verá la tele, por ejemplo `http://192.168.1.34:8765/…`. Si esa IP no es la de la Wi-Fi, fíjala con `CAST_HOST` (tiene que ser IPv4). Para comprobar que el móvil sirve el archivo, abre esa URL en otro aparato de la misma red antes de culpar a la tele.

**Método** (por si el automático abre la app equivocada):

| Orden | SSAP | Cuándo |
|---|---|---|
| 1 | `ssap://media.viewer/open` `{target, title, mimeType, loop:false}` | El que usa ConnectSDK en webOS 2 (el second-screen anuncia versión 4.0.0/4.0.1). La tele suele responder `{id:"com.webos.app.tvsimpleviewer", sessionId}` |
| 2 | `ssap://system.launcher/launch` de `com.webos.app.smartshare` con el payload DLNA (`fullPath`, `mediaType` VIDEO/AUDIO/IMAGE, `protocolInfo` con `DLNA.ORG_OP=01`) | Reproductor de webOS 1.x–2.x. Solo si el paso 1 falla |
| 3 | El mismo payload con `com.webos.app.photovideo` | Nombre del reproductor en webOS 3–5, por si este firmware lo usa |
| 4 | `ssap://system.launcher/open` `{target}` y, si falla, `com.webos.app.browser` | Navegador. Último recurso |

YouTube, en automático, lanza `youtube.leanback.v4` con `params.contentTarget`. En esta tele la app vieja (v1.0.35) acepta `https://www.youtube.com/tv?v=$CONTENTID` (se lee de `listApps` → `deeplinkingParams`). Si ese lanzamiento falla se prueban `v=ID` y `https://www.youtube.com/watch?v=ID`. El desplegable de la pestaña fuerza uno de los tres. Una búsqueda (`/results?search_query=`) usa el mismo deep link de búsqueda que la pestaña Texto.

En un arranque en frío, YouTube se queda en «¿Quién está viendo?» hasta que se pulsa OK. Antes de lanzar se mira `ssap://com.webos.applicationManager/getForegroundAppInfo`. Si YouTube no está ya delante, al terminar el lanzamiento se vuelve a mirar hasta que pase a primer plano y, entonces, se espera `YT_AUTO_OK_MS` (18 s; `0` no pulsa nada) y se manda **un** `ENTER` por el pointer socket (`type:button` / `name:ENTER`). Mientras tanto la página muestra «saltando selección de usuario…» con Cancelar: si se pulsa antes del ENTER, no se envía. Si YouTube ya estaba delante, no se pulsa OK (ahí el mismo enlace reproduce sin el selector). Si la app no llega a primer plano, tampoco se pulsa, para no darle al OK a lo que haya en pantalla.

`media.controls` documentado en el SSAP público: play, pause, stop, rewind, fastForward. **No incluye seek.** Aun así «Ir» prueba `ssap://media.controls/seek` `{position}` en milisegundos y, si la tele lo rechaza, `ssap://com.webos.media/getForegroundAppInfo` + `ssap://com.webos.media/seek` `{position, mediaId}`. Esa segunda llamada es un servicio interno y en webOS 2 puede no estar expuesto. Si las dos fallan, el mensaje lo dice: usa ⏪ y ⏩ del mando.

Formatos que esta tele de 2015 tiene más números de tragar: MP4 H.264 + AAC, MP3 y JPEG. MKV/AVI dependen del reproductor. HEVC, VP9 y WebM es fácil que no suenen. Un `m3u8` (HLS) se manda como `application/vnd.apple.mpegurl`, pero **no está confirmado** que el visor de webOS 2 lo reproduzca.

La casilla **Probar sin tele** (o `CAST_DRY_RUN=1`) construye los mensajes y no los envía. Equivale a:

```sh
curl -s -X POST http://127.0.0.1:8765/api/action -H 'Content-Type: application/json' \
  -d '{"type":"cast","url":"http://example.com/video.mp4","dryRun":true}'
```

Con la tele de verdad:

```sh
curl -s -X PUT 'http://127.0.0.1:8765/api/cast/upload?name=clip.mp4' \
  -H 'Content-Type: video/mp4' --data-binary @clip.mp4
# la respuesta trae data.url (http://192.168.1.34:8765/cast/…/clip.mp4)
curl -s -X POST http://127.0.0.1:8765/api/action -H 'Content-Type: application/json' \
  -d '{"type":"cast","url":"http://192.168.1.34:8765/cast/TOKEN/clip.mp4","mime":"video/mp4","bytes":12345}'
curl -s -X POST http://127.0.0.1:8765/api/action -H 'Content-Type: application/json' \
  -d '{"type":"castControl","cmd":"seek","seconds":30}'
```

`GET /api/cast` lista la IPv4 anunciada y el archivo que hay ahora mismo.

### Qué hay que comprobar en la tele real

Desde aquí no se llega a `192.168.1.39`. `npm test` cubre el servidor de rangos y el armado de los mensajes contra una tele falsa. En el salón falta ver:

1. Que un MP4, un MP3 y un JPEG servidos por el móvil (no un `127.0.0.1`) se ven y se oyen. Mira en Termux qué `via` ganó: `media.viewer/open` o `smartshare`.
2. Si el automático «acierta» en SSAP pero la pantalla no cambia, prueba a mano SmartShare y luego el navegador.
3. Arrastrar la barra de tiempo del reproductor de la tele contra un archivo local: tiene que pedir `Range` (en el log de Termux no se ve cada petición; desde otro móvil, `curl -D- -H 'Range: bytes=0-100' URL`).
4. Play / pausa / stop mientras ese medio está abierto.
5. «Ir» al segundo 30. Si `/api/log` muestra `404` o `500` en `media.controls/seek` y en `com.webos.media/seek`, este firmware no deja saltar por SSAP.
6. Un enlace `https://www.youtube.com/watch?v=…` abre el vídeo. En frío, el OK automático debe caer en el selector de perfil (unos 18 s después de que YouTube esté delante) y una sola vez; Cancelar no debe pulsarlo. Si YouTube ya estaba abierto, no debe aparecer el selector ni enviarse ese OK. Si el vídeo no sale, cambia el desplegable a `v=` o a `watch?v=`.
7. Un `m3u8` de prueba, sabiendo que puede no funcionar.
8. Un archivo grande (cientos de MB) no lo mata Android a medias: `start.sh` ya toma el wake-lock; la tele tiene que poder hablar con el móvil (sin aislamiento de clientes).

## 8. Estructura

```
lg-remote/
├── server.js            servidor HTTP + WebSocket (/ws) + API (/api/status, /api/action, /api/cast)
├── start.sh             arranque para Termux (wake-lock)
├── lib/lgtv.js          cliente SSAP: registro, client-key, reconexión, keepalive, pointer socket
├── lib/cast.js          mensajes SSAP para enviar un medio o un enlace de YouTube, y el orden de reserva
├── lib/yt-auto-ok.js    un ENTER tras el selector de perfil de YouTube en frío
├── lib/cast-http.js     subida del archivo y HTTP con Range, solo IPv4
├── lib/wol.js           Wake-on-LAN sin dependencias
├── lib/pairing.json     manifest de emparejamiento estándar (firmado) de lgtv2
├── public/              index.html, app.js, style.css, manifest + iconos (UI)
├── test/mock-tv.js      tele falsa SSAP (node test/mock-tv.js 3000)
├── test/cast-test.js    rangos HTTP y mensajes SSAP de envío, sin tele real
├── test/run-test.js     prueba de extremo a extremo del mando (npm test)
├── config.example.json
└── node_modules/ws      dependencia incluida
```

API para scripts: `curl -X POST http://127.0.0.1:8765/api/action -d '{"type":"button","name":"HOME"}'`
(tipos: `button`, `ssap` {cmd: volumeUp|volumeDown|channelUp|channelDown|powerOff|toast}, `media`, `mute`, `inputs`, `input`,
`liveTv`, `apps`, `launch`, `text`, `enter`, `delete`, `move`, `click`, `scroll`, `screenOff`, `screenOn`, `powerOn`, `reconnect`, `status`,
`cast` {url, method?, variant?, dryRun?, mime?, bytes?, title?}, `castControl` {cmd: play|pause|stop|seek, seconds?}, `ytAutoOkCancel`).

## 9. Pruebas sin tele

```sh
npm test                         # cast-test (rangos y SSAP) y, después, la tele falsa del mando
node test/mock-tv.js 3000 &      # tele falsa manual
TV_IP=127.0.0.1 node server.js   # y abre http://127.0.0.1:8765
```

`test/cast-test.js` no habla con ninguna tele de verdad. Comprueba el orden de los mensajes (`media.viewer/open`, SmartShare, YouTube), el seek de reserva y que un `GET` con `Range` devuelve 206 con el trozo pedido. Con la tele falsa en marcha, la casilla «Probar sin tele» de la pestaña Enviar hace lo mismo desde el móvil.

## Problemas frecuentes

- **Desconectado · ECONNREFUSED / EHOSTUNREACH / ETIMEDOUT**: tele apagada, IP cambiada o el móvil en otra red.
- **No sale el aviso**: activa *LG Connect Apps*; borra `tv-state.json` y reinicia.
- **Emparejamiento rechazado**: se pulsó “Rechazar”; reintentará solo.
- **El texto no aparece**: tiene que haber un campo de texto del sistema con el teclado de la tele abierto. En YouTube se envía como búsqueda (ver “Texto y YouTube”).
- **“500 Application error” en Entrada/Apps**: mira `/api/log` y la consola; se reintenta y se usan alternativas automáticamente.
- **Desde la tablet no carga**: misma Wi-Fi, y usa la IP del móvil que muestra Termux.
- **La tele no abre el archivo**: la URL tiene que ser la IPv4 de la Wi-Fi (la pestaña Enviar la muestra), no `127.0.0.1`. Misma red, sin aislamiento de clientes. `GET /api/cast` enseña la IP que se está anunciando; cámbiala con `CAST_HOST` si hace falta.
- **Se abre la app pero no hay imagen**: prueba otro método en el desplegable (SmartShare o navegador) y mira `/api/log`. Un MP4 H.264 cabe; HEVC o WebM en esta tele de 2015 es muy posible que no.
- **YouTube solo abre la portada**: cambia el formato del enlace (`tv?v=`, `v=`, `watch?v=`) y vuelve a enviar.
- **YouTube se queda en «¿Quién está viendo?»**: el OK automático espera 18 s desde que la app está delante. Si el selector sale antes o después, cambia `YT_AUTO_OK_MS`. `0` lo deja en manual. Cancelar en el aviso de la página evita esa pulsación.
- **El salto no hace nada**: en webOS 2 seek no está en la lista pública de SSAP. El error queda en `/api/log`; mientras tanto, ⏪ y ⏩.
