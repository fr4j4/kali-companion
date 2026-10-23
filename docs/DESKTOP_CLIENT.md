# Cliente de escritorio independiente

> Actualización: el cliente se compone ahora de dos piezas. **`kali-avatar`** (Rust, residente y mínimo) gestiona el avatar flotante, la bandeja y las acciones nativas; **`kali-shell`** (Electron) se abre bajo demanda para el chat y las ventanas de artefactos. Si `kali-avatar` no está instalado, `kali-shell` funciona solo como antes (avatar y bandeja propios). Arquitectura: [DESKTOP_NATIVE_ARCHITECTURE.md](DESKTOP_NATIVE_ARCHITECTURE.md); agente nativo: [../kali-avatar/README.md](../kali-avatar/README.md).

## Modos y configuración compartida

- **Remoto**: el cliente se conecta a `backendUrl` (HTTPS/WSS) con los tokens API y de escritorio.
- **Local**: `kali-shell` arranca `kali-core` en `127.0.0.1` (necesita `kali_core` instalado; `KALI_PYTHON` elige el intérprete), genera ambos tokens y los guarda. Si ya hay un core escuchando en el puerto, no lanza otro.
- La configuración vive en `~/.config/kali/desktop.json` (modo `0600`, tokens en texto plano porque `kali-avatar` debe conectar sin Electron). Se importa automáticamente el antiguo `desktop.json` de Electron.
- `kali-shell --open=chat|artifacts|settings|artifact:<sid>:<aid>` y `--avatar=show|hide|toggle` actúan sobre la instancia ya abierta; `--background` arranca sin mostrar ventana.
- Con `kali-avatar` activo, cerrar la última ventana cierra Electron (salvo que el wake word o el modo continuo estén activos: la voz sigue en la UI web).

El backend (`kali-core`) es el motor y conserva sesiones, mensajes, artefactos, permisos y herramientas. La web y el cliente Electron son presentaciones separadas. El cliente Electron incluye una copia compilada de `kali-web`, no instala Python ni arranca el backend. Se configura con la URL del backend y se conecta por HTTPS para recursos/API y WSS para eventos y audio. La instalación se puede copiar a otro computador.

## Arranque y distribución

En el equipo del backend, instala y ejecuta `kali-core` como servicio. Para un cliente remoto, configura `KALI_API_TOKEN` y `KALI_DESKTOP_TOKEN` con valores distintos, publicados a través de un proxy HTTPS con soporte de WebSocket. Mantén el puerto interno del core fuera de la red pública. `KALI_DESKTOP_TOKEN` habilita únicamente el registro de capacidades nativas; el token API sigue siendo obligatorio. La web conserva su forma de acceso habitual.

En el equipo del cliente, ejecuta `npm install` en `kali-web` y `kali-shell` una vez. `scripts/prod.sh` compila ambos y abre el cliente. `npm run dist` desde `kali-shell`, después de compilar `kali-web`, crea AppImage y paquete deb en `kali-shell/release`. El paquete contiene los archivos estáticos de la web. Al primer inicio se solicitan la URL (`https://servidor.example`), el token API y el token de acciones de escritorio. Se admite HTTP únicamente para `localhost` o `127.0.0.1`.

El cliente guarda la URL y la preferencia del avatar en `desktop.json` del directorio de datos de Electron. Los tokens se cifran mediante el almacén seguro del sistema. Si Electron solo ofrece `basic_text`, los tokens se conservan en memoria durante esa ejecución y habrá que introducirlos de nuevo al reiniciar. La configuración se abre desde la bandeja del sistema o la sección Seguridad de la aplicación.

## Interfaz y artefactos

El formato y los datos de los artefactos siguen siendo propiedad del backend. La web y el cliente reutilizan el mismo registro de renderizadores (`widgetRegistry`), por lo que código, documentos, diagramas, imágenes, tablas, juegos y otros widgets comparten la misma implementación visual. Cada cliente guarda localmente la posición y el estado de sus ventanas; esas preferencias no modifican el artefacto. Se recupera el contenido completo por API y se reciben actualizaciones por WebSocket. El botón **Desprender** abre un artefacto en una ventana del sistema que sigue la sesión; cerrarla no borra el artefacto.

El avatar flotante muestra el estado, la conexión y, si se activa, la última respuesta. Un clic abre la ventana principal. El icono de bandeja permite abrir chat, artefactos, configuración, mostrar/ocultar el avatar y salir. El avatar se muestra por defecto después de configurar una conexión. Desde Seguridad se ajustan visibilidad, texto y tamaño (pequeño, mediano, grande). La ventana principal se puede cerrar para dejar la aplicación en la bandeja.

## Acciones y compatibilidad

Las herramientas de archivos, búsqueda, red, modelo, voz y otras funciones del core siguen actuando en el equipo del backend. Con la conexión registrada y autorizada, `launch_app`, `list_monitors` y `screenshot` se ejecutan en el computador del cliente. Los permisos de herramienta del backend siguen vigentes. Cada solicitud se asocia a la conexión y sesión que originó el turno; otra conexión no puede responder por ella. Al desconectarse se cancela la solicitud pendiente.

| Entorno | Avatar y bandeja | Monitores y captura | Abrir aplicaciones |
| --- | --- | --- | --- |
| Hyprland/Wayland | El cliente solicita flotación y fijación mediante `hyprctl`; el compositor decide la posición. Bandeja según el panel instalado. | `hyprctl` para salidas, `grim` para PNG. | `gtk-launch` sobre entradas `.desktop`. |
| KDE/GNOME Wayland | Ventana normal; el compositor decide apilamiento. La bandeja depende de la extensión/panel. | Enumeración de Electron y captura mediante `desktopCapturer`, sujeta a permisos del portal. | `gtk-launch`. |
| X11 | Ventana flotante normal y bandeja según panel. | Enumeración y captura de Electron. | `gtk-launch`. |

Electron no puede garantizar una capa sobre todas las ventanas ni posición absoluta en Wayland. El avatar no usa Layer Shell; Hyprland puede necesitar [reglas locales](https://wiki.hypr.land/configuring/core/rules/window-rules/) para fijar monitor y posición, mientras KDE/GNOME aplican sus propias políticas. La captura en escritorios distintos de Hyprland depende del portal/sistema y debe verificarse en el equipo del cliente. Las acciones nativas solo están disponibles mientras la ventana principal mantiene su WebSocket activo.

## Protocolo

Novedades: `hello` admite `{"mode":"presence"}` (sin replay de historial ni wake word; el core reenvía una copia compacta de `turn_start`, `delta`, `turn_end`, `tts_audio` sin audio, `stt_*`, `tool_event`, etc.); `desktop_register` admite `capabilities` y `desktop_registered` las devuelve; `ping` recibe `pong`. Un agente registrado atiende acciones de cualquier turno de su sesión (o de todas si no se vinculó a una). Con `KALI_ALLOW_SERVER_SCREEN=0` el core nunca captura su propia pantalla cuando no hay agente.

Tras `auth`, el cliente envía `desktop_register` con el token de capacidades y luego `hello`. El core responde `desktop_registered` y envía `desktop_action` con identificador, acción y parámetros solo a la conexión del turno. El cliente responde `desktop_action_result` con `ok`, `result` o `error`. La API/WS de artefactos sigue siendo la misma para web y escritorio. La URL y los tokens se pueden cambiar sin reinstalar el cliente.

## Verificación sin GUI

Se puede ejecutar `npm run typecheck` y `npm run build` en `kali-web` y `kali-shell`, y las pruebas de `test_desktop_broker.py` sin sesión gráfica. El arranque Electron se puede probar con `xvfb-run` en X11 virtual; la posición en Hyprland, la bandeja del panel y los permisos del portal requieren una prueba posterior en un escritorio real.
