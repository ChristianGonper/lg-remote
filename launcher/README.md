# Inicio — prototipo de lanzador para la LG 32LF592U-ZB

App web instalable para la tele (webOS TV **2.0**, firmware 03.21.40, 2015). Es una pantalla de inicio propia: reloj, fila de aplicaciones, entradas HDMI y un hueco de «ahora / cast».

No sustituye al home del sistema y no toca el firmware ni `startup.sh`. Se abre como cualquier otra app, desde Homebrew Channel o desde la lista de apps del [mando del móvil](../README.md).

## Qué puede el runtime

El WebKit de webOS 2 es de la generación de Safari 7/8 (sobre la revisión ~538):

- Solo JavaScript ES5. No hay `let`/`const`, funciones flecha, `Promise`, `fetch` ni `Array.includes`. El código de `js/` está escrito en ES5 a mano, sin empaquetador.
- Flexbox y grid no se usan. La caja es fija de **1280×720** (el panel es 1080p, pero la UI de esta generación se compone a 720p; `appinfo.json` pide `"resolution": "1280x720"` y, si el viewport es otro, la página se escala).
- El SoC es justo: no hay desenfoques, ni fuentes remotas, ni animaciones largas.

## Vista previa en el ordenador

Sin tele y sin PalmServiceBridge, la página usa la lista de esta tele (YouTube, Live TV, LG Store, Ajustes, Homebrew, Yomvi, MiTele; Netflix no está) y las entradas HDMI, AV1 (SCART), AV2 y componentes.

```sh
cd launcher
python3 -m http.server 8770
```

Abre `http://127.0.0.1:8770/?preview=1`. También vale abrir `index.html` como archivo.

| Tecla en el ordenador | En la tele |
|---|---|
| Flechas | Flechas del mando o del mando SSAP (`UP` `DOWN` `LEFT` `RIGHT`) |
| Intro | OK (`ENTER`, keyCode 13) |
| Escape o retroceso | Atrás (keyCode 461). En la vista previa no cierra el navegador: avisa de que en la tele sale de la app |
| R | Botón rojo: vuelve a leer apps y entradas |
| D | Botón azul: panel de diagnóstico con las URI luna |

Capturas a 1280×720 y la comprobación de ES5, del modelo y del `.ipk`, desde la raíz del repositorio (hace falta Chrome para las capturas):

```sh
node launcher/scripts/self-test.js
node launcher/scripts/shoot.js
```

`npm test` en la raíz lanza eso después de las pruebas del mando.

## Mando

El foco se mueve en espacial (no salta al extremo opuesto). OK abre. Atrás cierra la lista y, si no hay lista abierta, llama a `PalmSystem.platformBack()` para volver al inicio del sistema.

KeyCodes que entrega webOS tanto al mando de la tele como a los botones del mando SSAP (el socket de puntero inyecta `UP`/`DOWN`/`LEFT`/`RIGHT`/`ENTER`/`BACK` y el sistema los convierte en estas teclas):

| Botón | keyCode |
|---|---|
| Izquierda, arriba, derecha, abajo | 37, 38, 39, 40 |
| OK | 13 (también 10) |
| Atrás | 461 |
| Rojo / azul | 403 / 406 |

Eso hay que confirmarlo en esta tele con el mando físico y con el del móvil: el socket de puntero a veces mueve un cursor en vez de mandar flechas.

## Cómo habla con la tele

Desde una app web el bus es `PalmServiceBridge` (lo mismo que envuelve `webOSTV.js` 1.x). Si el sistema ya inyectó `webOS.service.request`, se usa ese. Cada llamada guarda el puente hasta la respuesta. En el firmware 03.21.40 una app sin privilegios no puede leer la lista: `com.webos.applicationManager/listLaunchPoints` y `/listApps` responden «Unknown method», y `com.webos.service.applicationmanager` no existe. `launch` sí funciona.

La lista se pide así, y el JSON llega en `stdoutString`:

```sh
luna://org.webosbrew.hbchannel.service/exec
{"command":"luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}'"}
```

Si Homebrew Channel no está, se prueban las dos llamadas directas y, si fallan, se quedan los mosaicos fijos (sin el aviso de lista vacía como único estado útil: el aviso sale, y YouTube, Live TV, LG Store, Ajustes y Homebrew siguen pudiéndose abrir).

| Acción | URI que responde en esta tele |
|---|---|
| Lista de apps | `org.webosbrew.hbchannel.service/exec` → `listLaunchPoints` |
| Abrir app o entrada | `luna://com.webos.applicationManager/launch` `{"id":"..."}` |
| Entradas | `luna://com.webos.service.eim/getAllInputStatus` |

`com.webos.service.tv.externaldevice` no tiene `getExternalInputList`, `listDevices` ni `switchInput` en este firmware. Cambiar de entrada es abrir la app: `com.webos.app.hdmi1` … `hdmi4`, `com.webos.app.externalinput.av1`, `.av2`, `.component`, `.scart`. AV1 y AV2 no se etiquetan las dos como «AV»: AV1 es «AV1 (SCART)» y AV2 es «AV2».

Ids de esta tele, en este orden en la fila:

| Mosaico | Id |
|---|---|
| YouTube | `youtube.leanback.v4` |
| Live TV | `com.webos.app.livetv` |
| Netflix | `netflix` (solo si la lista lo trae; en esta tele no está instalada) |
| LG Store | `com.webos.app.discovery` |
| Ajustes | `com.palm.app.settings` (no `com.webos.app.settings`). `listLaunchPoints` no lo devuelve en este firmware; el mosaico abre ese id igual. Live TV (`com.webos.app.livetv`) también. |
| Homebrew Channel | `org.webosbrew.hbchannel` |

También están en la tele, y salen en «Todas»: `com.webos.app.browser`, `com.webos.app.smartshare`, `canal.yomvi`, `com.mitele.app`.

El hueco «Ahora / Cast» no puede leer una sesión de cast: webOS 2 no se la da a una app web. Muestra la entrada con señal (o «Sin reproducción») y deja el cast marcado como no disponible.

Al arrancar se llama a `PalmSystem.stageReady()` para quitar el splash. `disableBackHistoryAPI` hace que Atrás llegue a la página (keyCode 461) en vez de al historial. `handlesRelaunch` pide un solo proceso.

## Empaquetar el ipk

Sin el SDK de LG (el script escribe el `ar` de Debian: `debian-binary`, `control.tar.gz`, `data.tar.gz`, con la app en `usr/palm/applications/com.christiangonper.launcher/`):

```sh
node launcher/scripts/make-icons.js   # ya deja icon.png, largeIcon.png y splash.png en launcher/
node launcher/scripts/pack-ipk.js
```

Sale `launcher/dist/com.christiangonper.launcher_0.1.2_all.ipk` y su sha256.

Si tienes `ares-package` del SDK, también vale (el resultado debe ser el mismo tipo de ipk):

```sh
ares-package launcher -o launcher/dist
```

## Instalar por SSH

La tele está rooteada, con Homebrew Channel 0.7.3 y SSH de root por clave. IP de esta tele: `192.168.1.39`.

Desde el ordenador:

```sh
scp launcher/dist/com.christiangonper.launcher_0.1.2_all.ipk root@192.168.1.39:/tmp/
ssh root@192.168.1.39
```

En la tele, y dejando el comando abierto hasta que el JSON diga `installed` (Ctrl+C después):

```sh
luna-send -i luna://com.webos.appInstallService/dev/install '{"id":"com.christiangonper.launcher","ipkUrl":"/tmp/com.christiangonper.launcher_0.1.2_all.ipk","subscribe":true}'
```

Si este `luna-send` de webOS 2 no admite `-i`, la variante de una respuesta es:

```sh
luna-send -n 1 luna://com.webos.appInstallService/dev/install '{"id":"com.christiangonper.launcher","ipkUrl":"/tmp/com.christiangonper.launcher_0.1.2_all.ipk","subscribe":true}'
```

Para abrirla sin buscar el icono:

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.christiangonper.launcher"}'
```

Si `dev/install` responde que el id no coincide con el del paquete, reintenta con `"id":"com.ares.defaultName"` (es el comodín que usa el propio Homebrew Channel; el id real lo lee del `appinfo.json`).

Homebrew Channel también instala por su servicio, pero ese camino quiere una URL http(s) y el sha256 que imprime `pack-ipk.js`, no un archivo local:

```sh
luna-send -n 1 luna://org.webosbrew.hbchannel.service/install '{"ipkUrl":"https://…/com.christiangonper.launcher_0.1.2_all.ipk","ipkHash":"<sha256>"}'
```

### Si dev/install dice que hace falta el modo desarrollador

El root con Homebrew Channel 0.7.3 suele dejarlo activo. Si no, actívalo desde la app de desarrollador de LG y repite el `luna-send`. Como último recurso, con root, se puede copiar a mano (sigue sin tocar el arranque):

```sh
cd /tmp
rm -rf /tmp/launcher-unpack && mkdir /tmp/launcher-unpack && cd /tmp/launcher-unpack
ar x /tmp/com.christiangonper.launcher_0.1.2_all.ipk
tar -xzf data.tar.gz
mkdir -p /media/developer/apps/usr/palm/applications/com.christiangonper.launcher
cp -a usr/palm/applications/com.christiangonper.launcher/. /media/developer/apps/usr/palm/applications/com.christiangonper.launcher/
luna-send -n 1 luna://com.webos.applicationManager/rescan '{}'
```

`rescan` puede no existir en este firmware. En ese caso reinstala con `dev/install` o reinicia la tele. No edites `/var/lib/webosbrew/startup.sh`.

Para quitarla, cuando toque:

```sh
luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{"id":"com.christiangonper.launcher"}'
```

## Qué hay que comprobar en la tele

La vista previa no puede verificar el bus luna ni el mando de verdad. En la 32LF592U, con el ipk instalado:

1. `dev/install` termina en `installed` y aparece **Inicio** en Homebrew Channel y en la lista de apps. El home del sistema sigue siendo el de LG.
2. La app sale del splash (`stageReady`) y se ve entera a 1280×720, sin recortes.
3. Las flechas mueven el foco, OK abre y Atrás cierra la lista o sale de la app. Repetir con el mando de la tele y con los botones del mando SSAP del móvil.
4. El botón azul muestra `hbchannel.service/exec` en la lista y `eim/getAllInputStatus` en las entradas. No debe salir «Sin lista de la tele».
5. Netflix no sale (no está instalada). YouTube abre `youtube.leanback.v4`. Live TV abre `com.webos.app.livetv`.
6. LG Store abre `com.webos.app.discovery`.
7. Ajustes muestra «Sistema» (no «No está en la lista») y abre `com.palm.app.settings` aunque `listLaunchPoints` no lo traiga. Homebrew Channel abre `org.webosbrew.hbchannel`.
8. HDMI abre `com.webos.app.hdmiN`. AV1 (SCART) abre `externalinput.av1` y AV2 abre `externalinput.av2` (no las dos como «AV»). Componentes abre `externalinput.component`.
9. El reloj es la hora local. «Cast» sigue en «no disponible»; como mucho se marca la entrada que tiene señal.
10. Nada de esto modifica el arranque ni el firmware.
