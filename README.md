# Mando web para la tele LG (Termux)

Mando a distancia en el navegador para la **LG 32LF592U-ZB** (webOS 2.0, 2015, firmware 03.21.40, IP `192.168.1.39`).
Un pequeño servidor Node.js corre en Termux (Android), habla con la tele por **SSAP** (`ws://192.168.1.39:3000`)
y sirve una página táctil en `http://127.0.0.1:8765` que imita el mando LG.

- Una sola dependencia: [`ws`](https://github.com/websockets/ws) (ya incluida en `node_modules/`, JavaScript puro: no hace falta compilar nada).
- Empareja una vez (aviso en la tele) y guarda la *client-key* en `tv-state.json`, junto al script.
- Reconexión automática; la página muestra **Conectado / Esperando aceptar en la TV / Desconectado** y el volumen.
- Escucha en `0.0.0.0:8765`, así que la tablet puede usar el servidor del móvil (`http://IP-del-móvil:8765`).

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
| Entrada | `ssap://tv/getExternalInputList` (si falla: apps HDMI/AV de `listLaunchPoints`/`listApps`) → `ssap://tv/switchInput {inputId}` (si falla: `system.launcher/launch com.webos.app.hdmiN`) (+ “TV”) |
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

## 7. Estructura

```
lg-remote/
├── server.js            servidor HTTP + WebSocket (/ws) + API (/api/status, /api/action)
├── start.sh             arranque para Termux (wake-lock)
├── lib/lgtv.js          cliente SSAP: registro, client-key, reconexión, keepalive, pointer socket
├── lib/wol.js           Wake-on-LAN sin dependencias
├── lib/pairing.json     manifest de emparejamiento estándar (firmado) de lgtv2
├── public/              index.html, app.js, style.css, manifest + iconos (UI)
├── test/mock-tv.js      tele falsa SSAP (node test/mock-tv.js 3000)
├── test/run-test.js     prueba de extremo a extremo (npm test)
├── config.example.json
└── node_modules/ws      dependencia incluida
```

API para scripts: `curl -X POST http://127.0.0.1:8765/api/action -d '{"type":"button","name":"HOME"}'`
(tipos: `button`, `ssap` {cmd: volumeUp|volumeDown|channelUp|channelDown|powerOff|toast}, `media`, `mute`, `inputs`, `input`,
`liveTv`, `apps`, `launch`, `text`, `enter`, `delete`, `move`, `click`, `scroll`, `screenOff`, `screenOn`, `powerOn`, `reconnect`, `status`).

## 8. Pruebas sin tele

```sh
npm test                         # arranca una tele falsa y comprueba emparejamiento, key, botones, URIs, WoL, reconexión
node test/mock-tv.js 3000 &      # tele falsa manual
TV_IP=127.0.0.1 node server.js   # y abre http://127.0.0.1:8765
```

## Problemas frecuentes

- **Desconectado · ECONNREFUSED / EHOSTUNREACH / ETIMEDOUT**: tele apagada, IP cambiada o el móvil en otra red.
- **No sale el aviso**: activa *LG Connect Apps*; borra `tv-state.json` y reinicia.
- **Emparejamiento rechazado**: se pulsó “Rechazar”; reintentará solo.
- **El texto no aparece**: tiene que haber un campo de texto del sistema con el teclado de la tele abierto. En YouTube se envía como búsqueda (ver “Texto y YouTube”).
- **“500 Application error” en Entrada/Apps**: mira `/api/log` y la consola; se reintenta y se usan alternativas automáticamente.
- **Desde la tablet no carga**: misma Wi-Fi, y usa la IP del móvil que muestra Termux.
