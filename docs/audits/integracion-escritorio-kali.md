# Integración de Kali con el escritorio: análisis y propuesta

Estado: solo análisis y diseño, sin cambios de código. Basado en `master`, en `feature/platform-backends` (`kali-avatar/src/platform`) y en las auditorías previas de `audits/`. **No se ha probado en ningún escritorio real** (el contenedor no tiene sesión gráfica). Lo que digo de portales, libei y compositores sale del conocimiento del ecosistema y cambia rápido: lo marcado con *(verificar)* hay que comprobarlo en un equipo real antes de comprometerse.

Esfuerzos en días de una persona con el código ya conocido (S = 1–2, M = 3–5, L = 6–10, XL = 10+). Prioridad: P0 imprescindible, P1 alto valor, P2 deseable, P3 más adelante.

---

## 1. Resumen ejecutivo

1. Kali ya tiene el esqueleto correcto: un core con herramientas y consentimiento, un agente nativo (`kali-avatar`) que ejecuta acciones de escritorio y una capa de plataforma con detección única. Lo que falta para que "se sienta parte del sistema" es **ampliar lo que el agente nativo puede hacer** (descubrir y enfocar apps, ver regiones y ventanas, dibujar encima del escritorio, notificar, atajos globales) y, antes que nada, **endurecer el permiso**.
2. **Hallazgo clave de seguridad**: hoy el consentimiento lo exige el *core*. `kali-avatar` ejecuta cualquier `desktop_action` que le llegue (`link.rs` → `spawn_action`) con solo el token de capacidad. En modo cliente/servidor, un core comprometido, un token filtrado o una inyección de prompt que llegue a la UI pueden capturar pantalla sin que nadie lo apruebe en la máquina del usuario. Para la regla "control del PC siempre con consentimiento" el **ejecutor debe ser quien exige el permiso**, no el servidor.
3. Orden recomendado: (0) modelo de permisos en el agente + registro + indicador + botón de pánico; (1) lanzar y enfocar apps, notificaciones, atajo global; (2) ver pantalla por región/ventana y conversar; (3) overlay con texto, flechas y resaltados sin interrumpir; (4) control de ratón/teclado, portapapeles y ventanas; (5) contexto continuo bajo demanda.
4. Wayland: casi todo es viable **excepto en GNOME**, donde no hay layer-shell (overlay), no hay información de ventanas y los atajos/portales dependen de la versión. Hyprland y Sway son los más permisivos; KDE es intermedio y cómodo vía D-Bus. X11 lo permite todo, pero también significa que cualquier cliente puede espiar o inyectar: ahí el permiso de Kali es la única barrera.

---

## 2. Qué hay hoy (resumen por feature)

| Feature | Estado | Observaciones para esta propuesta |
|---|---|---|
| Chat y razonamiento | Sólido (kali-web, artefactos, panel de razonamiento) | Sin cambios; lo nuevo entra como herramientas y como acciones del agente nativo. |
| Voz | STT Vosk, TTS Piper, PTT, wake-word en `kali-web` | Vive en Electron; un atajo global y notificaciones deben poder iniciarla sin abrir la UI (ver `DESKTOP_NATIVE_ARCHITECTURE.md`, fase 4). |
| Avatar flotante | Electron (respaldo) y `kali-avatar` nativo (GTK4 + WebKitGTK, layer-shell o X11) | Ya hay bandeja, cursor global, recuerdo de posición. Es la base natural para overlay e indicadores. |
| Artefactos y ventanas | Ventanas Electron con tamaño/posición recordados | Sin cambio. Interesa un "pin" de artefacto sobre el escritorio (sección 5.3). |
| `launch_app` | Un `.desktop` por nombre exacto, `shlex.split` del `Exec` | Limitado (ver 4.1). |
| `screenshot` / `list_monitors` | Captura completa o de monitor, vía agente (grim/spectacle/gnome-screenshot, maim/scrot) + descripción con visión + guardado en `snapshots/` | No hay región ni ventana, no hay vista previa antes de enviar, no hay portal. |
| Presencia | Modo `presence` del avatar y estado del core | Se puede reutilizar para el indicador "Kali está viendo / controlando". |
| Herramientas del core | `fs_*`, `git_*`, `run_command`, `web_*`, `organize`, `tests`, `create_artifact`, juegos, `launch_app`, `screenshot`, `list_monitors` | Riesgo `safe` / `sensitive` / `dangerous`. |
| Consentimiento | `PermissionGateway` + `ConsentManager` (modal; allow / no_capture / cancel, timeout 60 s), perfiles `general`, `dev`, `files`, `gaming` | Por llamada; sin sesiones con caducidad, sin registro, sin revocación, sin indicador. |
| Plataforma | `Env` (sesión + escritorio), traits `Surface` y `DesktopServices` (cursor, monitores, captura) | Falta `Caps` (propuesto, no implementado) y servicios nuevos (ventanas, entrada, portapapeles, overlay, atajos). |

Lo que ya cubren las auditorías y **no repito**: refactor a backends (`propuesta-backends-de-plataforma.md`), por qué avatar nativo y layer-shell (`avatar-nativo-wayland-x11.md`), reparto de procesos y presupuesto de memoria (`DESKTOP_NATIVE_ARCHITECTURE.md`), sincronización y modo remoto (`auditoria-desktop-remoto.md`), pulido visual (`mejoras-visuales-app-desktop.md`).

---

## 3. Primero lo primero: modelo de permisos (P0, L)

Regla del usuario: **toda acción que implique controlar el PC requiere consentimiento explícito, siempre.** El modelo siguiente la convierte en una propiedad del sistema y no en una convención de cada herramienta.

### 3.1 Principios

1. **Denegar por defecto.** Sin concesión vigente, la acción no se ejecuta.
2. **El ejecutor es quien hace cumplir.** El consentimiento se muestra y se valida en `kali-avatar` (la máquina donde ocurre la acción). El core *solicita*; el agente no ejecuta sin una concesión local válida. Un core remoto o comprometido no puede saltarse el permiso.
3. **UI de confianza.** La tarjeta de consentimiento la dibuja el agente nativo, no contenido web ni artefactos del LLM. Ningún HTML renderizado por Kali puede responderla ni imitarla.
4. **Entrada humana real.** Voz, texto del chat y entrada sintetizada **no** pueden conceder permisos de las clases de control. Un vídeo o un audio pueden decir "sí"; un clic o tecla físicos son lo único aceptable.
5. **Mínimo privilegio, mínima duración.** Las concesiones tienen alcance (qué, dónde, cuánto) y caducan.
6. **Visible siempre.** Mientras Kali observa o controla hay un indicador que el LLM no puede ocultar, y un botón de pánico que funciona aunque el core esté colgado.
7. **Todo queda registrado** en la máquina del usuario.

### 3.2 Clases de acción

| Clase | Ejemplos | Consentimiento | Concesión máxima |
|---|---|---|---|
| `info` | Listar monitores, mostrar overlay, notificar, abrir un artefacto propio | No (siempre visible y descartable; límite de frecuencia) | n/a |
| `observe` | Captura de pantalla / región / ventana, título de ventana activa, modo "mirar" | Sí | Una vez · tarea (máx. 15 min) |
| `launch` | Abrir app, URL o archivo; enfocar ventana existente | Sí | Una vez · tarea · lista permitida por app (creada por el usuario) |
| `clipboard-write` | Poner texto en el portapapeles | Sí | Una vez · tarea |
| `clipboard-read` | Leer el portapapeles | Sí, con vista previa censurable | Solo una vez |
| `window` | Mover, redimensionar, cerrar, minimizar | Sí | Una vez · tarea |
| `input` | Ratón, teclado, desplazamiento, arrastrar | Sí, con vista previa del objetivo | Una vez · tarea (máx. 10 min, atada a una ventana) |

`input` y `clipboard-read` nunca tienen "permitir siempre". `launch` y `observe` pueden tener una lista permitida **explícita** creada por el usuario en Ajustes (opcional, desactivada por defecto). Decisión para el usuario: ¿se permite esa lista, o se mantiene todo estrictamente por acción/tarea? Recomiendo permitirla solo para `launch` y dejar `observe` e `input` sin atajos.

### 3.3 La tarjeta de consentimiento

Debe responder: **qué**, **sobre qué**, **por qué**, **hasta cuándo**.

```
Kali quiere hacer clic        [clase: input]
En: Firefox — "Ajustes de red"   en (812, 430)  ← círculo rojo sobre el punto real
Motivo: "Pulsar 'Guardar' para aplicar el DNS"
[ Permitir esta vez ]  [ Permitir esta tarea (10 min) ]  [ Denegar ]  [ Denegar y detener ]
```

- Botón por defecto: **Denegar**. Sin respuesta en N segundos: denegar.
- Para `input` se dibuja un anillo en el destino (overlay) antes de pedir permiso: "mostrar y luego hacer".
- Para `observe` se enseña qué se va a capturar (marco de región/ventana) y, tras capturar, **vista previa antes de enviar al LLM** (opción "no enviar", que hoy existe como `no_capture` pero sin vista previa).
- La tarjeta ignora cualquier evento de ratón/teclado sintético generado por el propio agente (el ejecutor nunca inyecta eventos sobre sus superficies de consentimiento).
- Voz y chat solo pueden *cancelar*, nunca *conceder*, en clases de control.

### 3.4 Concesiones ("grants")

```jsonc
{ "id": "g_9f2", "class": "input", "scope": { "window": "firefox#1234", "monitor": "DP-1" },
  "ttl_s": 600, "max_actions": 40, "granted_at": "...", "granted_by": "click" }
```

Caducan por: TTL, número de acciones, fin de la tarea o sesión, desconexión del core, bloqueo de pantalla, inactividad del usuario, cierre o cambio de la ventana atada, cambio de configuración de monitores. El core envía `desktop_action` con `grant_id`; el agente verifica que la concesión exista, esté vigente y cubra la acción. Si no, devuelve `needs_consent` y el agente muestra la tarjeta.

### 3.5 Indicador, pánico y toma de control humana

- **Indicador**: borde fino de color en el monitor afectado (overlay layer-shell o ventana ARGB en X11) y badge en el avatar: ojo = observando, mano = controlando. Además icono de bandeja con estado. En GNOME (sin overlay) se usa badge del avatar + notificación persistente.
- **Pánico**: tecla global (p. ej. `Ctrl+Alt+Esc`), elemento de bandeja y clic en el avatar. Revoca todas las concesiones y detiene la inyección en menos de ~100 ms. Se implementa **dentro del agente**, no depende del core.
- **El humano manda**: si el usuario mueve el ratón o teclea durante una sesión de `input`, Kali se pausa y pide confirmación para continuar.
- **Límites**: acciones por minuto, no escribir en diálogos de contraseña / polkit / bloqueo de pantalla / gestores de contraseñas (lista de `app_id`/clases), no inyectar combinaciones del sistema (cambio de TTY, SysRq).
- **Inyección indirecta (prompt injection)**: el texto visto en pantalla o en la web es no confiable. Una concesión de tarea cubre el *plan mostrado*; si tras leer contenido externo el LLM propone acciones fuera del plan (p. ej. abrir una URL nueva o escribir un comando), se vuelve a pedir `Permitir esta vez`, aunque haya concesión vigente.

### 3.6 Registro de auditoría

`~/.local/state/kali/audit.jsonl`, local a la máquina que ejecuta, solo-añadir, con cadena de hashes. Campos: `ts, session, tool, class, params_redacted, grant_id, decision, decided_by (click|key|timeout|panic), outcome, snapshot_path/sha256`. Visor "Actividad" en bandeja/Ajustes con botón de revocar. No guarda contenido de teclas escritas (solo longitud y destino); las capturas se referencian por ruta y hash, con borrado automático configurable (7 días por defecto).

### 3.7 Cambios concretos en el código actual

- `PermissionGateway.check` hoy devuelve allow/needs_consent por herramienta y perfil. Añadir `class` y `grant` a la decisión y eliminar la excepción por perfil (`allowed_tools`) para las clases `observe`/`input`/`clipboard-*` (la excepción de perfil sigue valiendo para `fs_read`, `web_*`).
- `list_monitors` está como `sensitive` y pide permiso sin necesidad: pasa a `info`.
- `ConsentManager` se amplía con `scope`, `ttl`, `grant_id` y `preview`.
- `kali-avatar` incorpora `consent.rs` (UI de confianza), `grants.rs` (almacén en memoria con caducidad), `audit.rs` y el check previo en `actions::perform`.
- Protocolo: `desktop_registered` devuelve `capabilities` (ya previsto); `desktop_action` añade `grant_id`; nuevos `desktop_needs_consent` / `desktop_revoked`.
- Modo cliente/servidor: el agente rechaza acciones sin concesión local aunque el token sea válido.

Sin esta fase no deberían entrar las de control (4 y 5 de la sección 8).

---

## 4. Mejoras a lo existente

### 4.1 `launch_app` (P1, M)
Problemas observados en `claws/launcher.py`:
- Solo busca `~/.local/share/applications`, `/usr/share/applications` y `/usr/local/share/applications`; ignora `XDG_DATA_DIRS`, Flatpak (`/var/lib/flatpak/exports/share/applications`, `~/.local/share/flatpak/exports/share/applications`) y Snap.
- Nombre exacto del `.desktop`; el LLM tiene que adivinar `org.gnome.Calculator`.
- Troceo manual del `Exec` con `shlex` y borrado de `%X`: no soporta `Terminal=true`, `Path`, acciones (`Actions=new-window`), `DBusActivatable`, `OnlyShowIn`/`NoDisplay`, ni archivos/URL como argumento.
- Siempre lanza una nueva instancia; no enfoca la ya abierta.
- Se ejecuta en el core: en modo remoto abriría la app **en el servidor**.

Propuesta:
1. Mover la ejecución al agente (acción `launch_app` ya existe en `actions.rs`) y usar `Gio.AppInfo` (`gtk4::gio`): descubre todas las rutas XDG, resuelve nombres localizados, `launch_uris`, activación por D-Bus y acciones del `.desktop`.
2. Nueva herramienta `find_apps(query)`: búsqueda difusa por nombre, `GenericName`, `Keywords` y categorías, con puntuación; devuelve 5 candidatos con icono. El LLM elige y llama a `launch_app(id)`.
3. `launch_app` acepta `uri`/`file` opcionales (abrir una URL o un archivo con una app concreta) y `action` (p. ej. "nueva ventana privada").
4. **Enfocar si ya está abierta**: `focus_or_launch`. Para el modelo de 4.4 se necesita la lista de ventanas.
5. Lanzar con `systemd-run --user --scope` (o `setsid`) para que la app no muera con el agente y no herede su entorno completo; cuidar `WAYLAND_DISPLAY`/`DISPLAY` correctos.
6. Consentimiento: clase `launch`. Tarjeta con nombre e icono de la app, argumentos y "Permitir siempre esta app" (lista permitida opcional).

### 4.2 Captura de pantalla (P1, M)
Hoy: pantalla completa o monitor, con descripción de visión; sin región, sin ventana, sin vista previa, sin portal, tamaño sin comprimir.
- **Región** (`screenshot_region`): selección interactiva por el usuario (slurp en wlroots, portal interactivo en GNOME/KDE, `maim -s` en X11). La región elegida por el usuario es en sí un acto de consentimiento, pero se sigue pidiendo confirmar el envío al LLM.
- **Ventana** (`screenshot_window`): la activa o una elegida por el usuario. X11: `xcap`/`maim -i`; Hyprland: geometría por `hyprctl` + `grim -g`; Sway: `swaymsg -t get_tree` + `grim -g`; KDE: `spectacle -a`; GNOME: portal.
- **Portal como ruta segura por defecto en Wayland**: `org.freedesktop.portal.Screenshot` (cuando exista `ashpd`/zbus) en lugar de depender de herramientas externas; grim/spectacle siguen como ruta rápida sin diálogo en wlroots/KDE.
- **Vista previa y recorte** antes de enviar; reducción (1568 px de lado largo suele bastar para visión) y recompresión para ahorrar tokens y ancho de banda en modo remoto.
- **Privacidad**: opción de difuminar regiones (campos de contraseña / ventanas marcadas como privadas), borrar capturas tras N días, y no guardar si el usuario lo pide.
- Capturar siempre **en el agente** y subir al core solo la imagen aprobada. El core no debe poder pedir "la pantalla del servidor" (ya previsto como `KALI_ALLOW_SERVER_SCREEN`).

### 4.3 Avatar y presencia (P2, M)
- El avatar se vuelve el **ancla de interacción**: arrastrar un archivo, texto o imagen sobre él abre una conversación con ese contenido (drop target GTK; funciona en X11 y Wayland).
- Menú contextual rápido (clic derecho / mantener): "Mirar mi pantalla", "Pregunta sobre una región", "Mostrar actividad", "Pausar permisos".
- Estados nuevos: observando, controlando, esperando permiso (la UI ya recibe `presence`).
- **Sin foco robado** y modo "no molestar": respetar inhibición de inactividad/juegos a pantalla completa (idle-inhibit / ventana fullscreen) para no mostrar overlays ni notificaciones.

### 4.4 Ventanas de artefacto (P3, S–M)
- "Anclar" un artefacto sobre el escritorio como panel semitransparente click-through (usa el mismo backend de overlay que la fase 3).
- `app_id` fijos (`kali-artifact`, `kali-main`) para que cada usuario pueda poner reglas de ventana en su compositor (ya recomendado en la arquitectura).

### 4.5 Voz (P2, M)
- Atajo global de pulsar-para-hablar que funcione con la UI cerrada (ver 5.5). Hoy mic/PTT están en `kali-web`.
- Confirmaciones de permiso **no** por voz (regla 3.1.4), pero sí lectura en voz alta de lo que se está pidiendo.

---

## 5. Features nuevos

### 5.1 Ver la pantalla y conversar sobre ella (P1)
Flujo recomendado ("pregúntale a Kali sobre esto"):
1. El usuario pulsa el atajo (o dice "mira esto"). El avatar entra en modo selección: pantalla completa, ventana o región.
2. Kali captura localmente, muestra vista previa, el usuario confirma ("Enviar").
3. La imagen entra al chat como adjunto y Kali responde. El contexto de esa captura permanece en la conversación; no hay captura nueva sin pedirla.
4. Opcional: OCR local (`tesseract`) o modelo de visión local para respuestas sin salir del equipo. El texto OCR es útil para citar y busca barato.

Contexto continuo **bajo demanda** (P3, XL): modo "mirar conmigo" que dura N minutos con indicador permanente. Captura a baja frecuencia (0,5–1 fps) o por cambio de ventana/actividad, con diferencia de imágenes para no enviar fotogramas iguales, y envío al LLM solo cuando el usuario pregunta o cuando hay un cambio relevante que él pidió vigilar. Wayland: `ScreenCast` + PipeWire (permiso del portal además del de Kali). X11: captura periódica con `xcap`. Cuesta tokens y batería: debe ser siempre explícito, con límite de tiempo y de coste.

Información de contexto complementaria (todo `observe`): título y `app_id` de la ventana activa (Hyprland/Sway/KDE/X11; en GNOME Wayland no está disponible sin extensión), lista de ventanas abiertas, texto seleccionado (primary selection: `wl-paste -p` en wlroots/KDE, `xclip -o` en X11).

### 5.2 Descubrimiento y manejo de ventanas (P1 lectura, P3 gestión)
- `list_windows` (clase `observe`): título, `app_id`, monitor, espacio de trabajo, foco.
- `focus_window` (clase `launch`): `hyprctl dispatch focuswindow`, `swaymsg [con_id=…] focus`, KWin vía script/D-Bus, X11 `_NET_ACTIVE_WINDOW`. En GNOME Wayland no se puede enfocar ventanas ajenas sin extensión (solo `xdg-activation` para apps que Kali lanza).
- `move/resize/close` (clase `window`, P3) con los mismos mecanismos.

### 5.3 Overlay: mostrar información sin interrumpir (P1, L)
Objetivo: texto, flechas, resaltados, números y un "puntero fantasma" dibujados sobre el escritorio, sin robar foco, sin bloquear clics y que desaparecen solos.

**Implementación por backend**
- **Wayland con layer-shell (Hyprland, Sway, KDE)**: una superficie `overlay` por monitor, anclada a los cuatro bordes, `keyboard_interactivity = none`, `exclusive_zone = -1`, **región de entrada vacía** (`wl_surface.set_input_region(empty)`) para que sea click-through. Se crea **solo cuando hay algo que mostrar** y se destruye al terminar (no residente, ahorra memoria). Dibujo con cairo/GTK (`DrawingArea`) para formas simples; WebKit solo si hace falta HTML rico.
- **X11**: ventana ARGB `override-redirect` o con tipo `_NET_WM_WINDOW_TYPE_NOTIFICATION/DOCK`, `_NET_WM_STATE_ABOVE`, XShape con región de entrada vacía. Necesita compositor para transparencia (casi universal).
- **GNOME Wayland**: sin layer-shell. Degradación: panel pequeño en el avatar, notificación con la información y, si se necesita señalar, ventana flotante normal (no siempre encima ni click-through). Solución completa solo con una extensión de GNOME Shell propia (P3, XL, *(verificar mantenimiento por versión)*).

**Primitivas** (herramienta `annotate`, clase `info`): `text`, `arrow(from,to)`, `rect`/`ellipse`, `badge(n)`, `pointer(x,y)`, `clear`. Cada elemento con `ttl`, color y monitor. Límite de elementos y de frecuencia. `Esc` o clic en el avatar lo borra todo.

**Cómo saber dónde dibujar (el punto difícil)**
- Un modelo de visión no es fiable devolviendo coordenadas exactas. Opciones, de menos a más robusta: (a) cuadrícula superpuesta o **marcas numeradas** en la captura (Set-of-Marks) para que el LLM elija "la casilla 7"; (b) detección de elementos con la **API de accesibilidad AT-SPI** (da rectángulos exactos por widget en apps GTK/Qt/Electron con accesibilidad activada); (c) combinar ambas.
- En Wayland las coordenadas AT-SPI son relativas a la ventana; hay que sumar la geometría de la ventana (compositor) y la escala del monitor. Hay que tratar siempre **escala fraccional y transformaciones** (el campo `transform` ya existe en `Monitor`).
- Empezar con (a) y con regiones elegidas por el usuario; añadir (b) en fase 5.

**Seguridad del overlay**: no cuenta como control (no actúa), pero puede engañar al usuario ("pulsa aquí" sobre un botón peligroso). Se etiqueta siempre con el nombre de Kali y no puede tapar los diálogos de consentimiento (la tarjeta de permiso va por encima y en otra capa).

### 5.4 Control del ordenador (P2/P3, XL en total)
Siempre bajo clase `input` / `window` / `clipboard-*` (sección 3).

| Capacidad | X11 | Hyprland | Sway | KDE Wayland | GNOME Wayland |
|---|---|---|---|---|---|
| Ratón/teclado sintéticos | XTEST (`x11rb`) ✅ | `zwlr_virtual_pointer` / `zwp_virtual_keyboard` o `hyprctl dispatch` ✅ ; portal RemoteDesktop *(verificar)* | Protocolos virtuales wlroots ✅ | Portal RemoteDesktop + libei ✅ *(Plasma 6)* | Portal RemoteDesktop + libei ✅ *(GNOME 45+)* |
| Con consentimiento del compositor | No existe | No (el de Kali es el único) | No | Sí (diálogo del portal) | Sí (diálogo del portal) |
| uinput (`ydotool`) | Sí | Sí | Sí | Sí | Sí |

Notas:
- **Ruta preferida en Wayland**: portal `org.freedesktop.portal.RemoteDesktop` + `ConnectToEIS` (libei; en Rust el crate `reis`). Es la vía sancionada, tiene su propio diálogo de permiso y token de reutilización. Hay doble diálogo (el de Kali y el del compositor); se puede minimizar pidiendo el del portal una vez por tarea y usando el de Kali para cada acción concreta.
- **wlroots**: los protocolos de ratón/teclado virtual existen, pero no hay diálogo de sistema; todo el peso del consentimiento recae en Kali (de ahí que la sección 3 sea P0).
- **uinput/ydotool**: funciona en todas partes, pero requiere acceso a `/dev/uinput` (regla udev o root), actúa a nivel de kernel y esquiva a los compositores. Solo como último recurso, desactivado por defecto y con advertencia explícita. No lo recomiendo como camino principal.
- **Atajo "mostrar y luego hacer"**: antes de cada clic, anillo en destino y pausa de ~0,5–1 s con cancelación por `Esc`.
- **Portapapeles**: wlroots/KDE: `wl-copy`/`wl-paste` (protocolo data-control); GNOME no expone data-control: solo con el portal Clipboard dentro de una sesión RemoteDesktop *(verificar)*; X11: `xclip` o `arboard`.
- **Ventanas ajenas en GNOME Wayland**: no se pueden listar ni mover; es la mayor laguna y justifica una extensión opcional.

### 5.5 Notificaciones y atajos globales (P1, S + M)
- **Notificaciones** (`org.freedesktop.Notifications`, vía `notify-rust` o zbus): universal, sin permisos especiales. Útiles para: tarea terminada, "Kali necesita tu atención", consentimiento pendiente cuando el usuario no mira el avatar. Las acciones de la notificación sirven como aviso, pero la decisión de clases de control se toma siempre en la tarjeta de confianza.
- **Atajos globales** con degradación en tres niveles:
  1. Portal `org.freedesktop.portal.GlobalShortcuts` (KDE, GNOME reciente, Hyprland vía xdph; *verificar versiones*).
  2. Cliente CLI: `kali-avatar --toggle | --ask | --region | --panic` que habla con la instancia en ejecución por socket Unix. El usuario pega una línea en `hyprland.conf` / Sway / atajos de KDE o GNOME. Funciona **en todas partes** y es el método más fiable para wlroots.
  3. X11: `XGrabKey`.
- Atajos recomendados: abrir/ocultar Kali, preguntar sobre región, pulsar-para-hablar, **pánico**.

### 5.6 Otras ideas con buen retorno
- **Acciones de "Abrir con Kali"** en gestor de archivos (`.desktop` con `MimeType`): arrastrar o enviar un archivo a Kali.
- **Búsqueda universal**: lanzador tipo "krunner/rofi" propio con el LLM ("abre el proyecto X", "pon el PDF de ayer"), construido sobre `find_apps` + `fs_list`.
- **Integración con sesión**: pausar overlays con pantalla bloqueada, detectar juego a pantalla completa (ya hay perfil `gaming`) y conectar con los modos de Kali.
- **Entorno de inicio**: `systemd --user` para `kali-avatar` (ya hay unidades en `packaging/`), autostart y primer arranque con comprobación de capacidades ("Falta `grim`: instala para capturar").
- **Doctor**: `kali-avatar --doctor` que imprime `Env`, `Caps` y qué herramientas faltan. Evita muchas incidencias en distintos escritorios.

---

## 6. Qué es viable en cada entorno

Leyenda: ✅ sí · ⚠️ parcial / con herramienta o diálogo extra · ❌ no (sin extensión). Entradas con * son *(verificar)* en un equipo real.

| Capacidad | X11 | Hyprland | Sway | KDE Wayland | GNOME Wayland |
|---|---|---|---|---|---|
| Lanzar apps (`Gio.AppInfo`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Listar ventanas | ✅ EWMH | ✅ `hyprctl clients` | ✅ `get_tree` | ⚠️ script KWin / D-Bus | ❌ |
| Enfocar ventana ajena | ✅ | ✅ | ✅ | ⚠️ script KWin | ❌ |
| Captura pantalla completa / monitor | ✅ maim/scrot/xcap | ✅ grim | ✅ grim | ✅ spectacle / portal | ⚠️ portal (puede preguntar) |
| Captura de ventana / región | ✅ | ✅ (geometría + grim, slurp) | ✅ | ✅ spectacle | ⚠️ portal interactivo |
| Captura continua | ⚠️ polling | ⚠️ ScreenCast* | ⚠️ ScreenCast* | ✅ ScreenCast portal | ✅ ScreenCast portal |
| Overlay click-through | ✅ ARGB + XShape | ✅ layer-shell | ✅ layer-shell | ✅ layer-shell | ❌ (ventana normal) |
| Siempre encima del avatar | ✅ | ✅ | ✅ | ✅ | ❌ |
| Ratón/teclado sintéticos | ✅ XTEST | ✅ virtual-pointer* | ✅ virtual-pointer | ✅ libei/portal | ✅ libei/portal |
| Portapapeles lectura/escritura | ✅ | ✅ wl-clipboard | ✅ | ✅ | ⚠️ solo con foco / portal |
| Notificaciones | ✅ | ✅ (daemon propio) | ✅ (daemon propio) | ✅ | ✅ |
| Atajo global | ✅ XGrabKey | ✅ `bind` + CLI | ✅ `bindsym` + CLI | ✅ portal / atajos | ⚠️ portal reciente / CLI |
| Bandeja (SNI) | ✅ | ✅ | ✅ | ✅ | ❌ (extensión AppIndicator) |

Qué **no** conviene prometer: ver ventanas ajenas en GNOME Wayland, overlay real en GNOME, "siempre encima" por parte de una app normal en Wayland sin layer-shell, control de teclado/ratón sin ningún diálogo en GNOME/KDE (el portal siempre preguntará, y eso es correcto).

Para mantenerlo ligero: no hay procesos nuevos residentes. Todo vive en `kali-avatar`; las superficies del overlay y las tarjetas se crean al vuelo, y las integraciones pesadas (PipeWire, libei, AT-SPI) se cargan bajo demanda detrás de `cargo features` o módulos perezosos. Preferir herramientas externas (`grim`, `slurp`, `wl-clipboard`) para lo no crítico y librerías Rust (`ashpd`, `zbus`, `reis`, `x11rb`) para lo que necesita fiabilidad.

---

## 7. Arquitectura de plataforma que lo soporta

Sobre la capa de `feature/platform-backends` (donde hoy `DesktopServices` solo tiene cursor, monitores y captura, y `Caps` está propuesto pero no implementado):

1. **`Caps` real** con valores sondeados al arrancar: `layer_shell, overlay, window_list, window_focus, capture_{full,region,window,stream}, input_inject, clipboard_{read,write}, global_shortcuts, notifications, tray`. Se envían al core en `desktop_registered`; el LLM solo ve herramientas que el entorno soporta.
2. **Traits pequeños** (cada uno opcional por backend, devuelve `Unsupported` explícito):
   - `Windows` (`list`, `focus`, `move`, `close`, `active`)
   - `Overlay` (`show(elements)`, `clear`)
   - `Input` (`pointer_move`, `click`, `key`, `type_text`, `scroll`)
   - `Clipboard` (`read`, `write`)
   - `Shortcuts` (`register`, eventos)
   - `Capture` extendido (`region`, `window`)
3. **Backends por entorno, sin importaciones cruzadas**, como ya se acordó: `x11.rs`, `wayland_layer.rs` (con `hyprland.rs`, `sway.rs`, `kwin.rs`) y `wayland_plain.rs` (GNOME). El portal (`ashpd`) es un módulo compartido por todos los backends Wayland para captura, atajos, RemoteDesktop y portapapeles.
4. **Capa de permisos delante de todo**: `actions::perform` pasa por `grants::check(class, params)` antes de tocar ningún trait.
5. **CLI local** (`kali-avatar --…`) sobre socket Unix para atajos, `--doctor`, `--panic`. Comparte código con la instancia residente.
6. **Pruebas**: `xvfb-run` para X11; `sway`/`cage` headless con `WLR_BACKENDS=headless` para layer-shell, captura y entrada virtual. Tests unitarios para el almacén de grants (caducidad, ámbito, revocación) y para el registro de auditoría.

---

## 8. Plan por fases

| Fase | Contenido | Prioridad | Esfuerzo | Depende de |
|---|---|---|---|---|
| **0. Permisos y base** | Modelo de permisos (sección 3): clases, grants, tarjeta de confianza en `kali-avatar`, auditoría, indicador, pánico (tecla + bandeja), enforcement en el agente. `Caps` real. CLI local + socket. `list_monitors` a `info`. | **P0** | L–XL (8–12 d) | Rama `platform-backends` integrada |
| **1. Integrarse sin molestar** | `Gio.AppInfo` + `find_apps` + `launch_app` en el agente (flatpak/snap, acciones, URI), `focus_or_launch` donde haya lista de ventanas, notificaciones, atajo global (CLI + portal), `--doctor`. | **P1** | M–L (6–8 d) | 0 |
| **2. Ver y conversar** | Captura de región y ventana, selección interactiva, vista previa y recorte antes de enviar, reducción de imagen, `list_windows` + ventana activa, arrastrar y soltar al avatar, política de borrado de capturas. | **P1** | L (7–10 d) | 0, 1 (atajo) |
| **3. Overlay** | Backend `Overlay` layer-shell + X11, herramienta `annotate` (texto, flecha, rect, badge, puntero), Set-of-Marks, Esc para limpiar, indicadores de estado (borde de color). Degradación GNOME. | **P1** | L (7–10 d) | 0 |
| **4. Control** | `Input` por backend (XTEST, virtual-pointer, portal/libei), preview "mostrar y hacer", toma de control humana, portapapeles, `focus/move/close` de ventana, lista de aplicaciones/ventanas bloqueadas. Pruebas en cada escritorio. | **P2** | XL (12–18 d) | 0, 3 |
| **5. Contexto continuo y robustez** | Modo "mirar conmigo" (ScreenCast/PipeWire, diferencias, límites), AT-SPI para elementos precisos, OCR local, extensión opcional de GNOME, empaquetado Flatpak/portal. | **P3** | XL (15+ d) | 2, 3, 4 |

Entregables sugeridos de valor visible temprano (sin esperar a todo): tras la fase 1, "abre X" bien resuelto y atajo global; tras la 2, "mira esto"; tras la 3, "enséñame dónde está". El control (fase 4) llega cuando los controles de seguridad ya están probados.

---

## 9. Riesgos y decisiones abiertas

1. **Lista permitida de apps** (3.2): ¿se admite para `launch`? Recomendación: sí, opcional y desactivada por defecto. `input` y `clipboard-read` sin "permitir siempre".
2. **Doble diálogo** en Wayland con portales (compositor + Kali). Aceptable: es la barrera de sistema; se reduce con tokens de reutilización.
3. **GNOME**: sin overlay ni ventanas ajenas. Decidir si se invierte en una extensión (mantenimiento por cada versión de Shell) o se acepta la degradación.
4. **Costo y privacidad de la visión**: las capturas van a un LLM (posiblemente en la nube). Vista previa, recorte, difuminado, y un modo "solo local" son parte del diseño, no un extra.
5. **Precisión de coordenadas**: sin AT-SPI el overlay dependerá de marcas numeradas; es suficiente para empezar y es más fiable que pedir píxeles al modelo.
6. **Peso**: el overlay y las tarjetas deben crearse y destruirse; evitar procesos extra y bibliotecas grandes residentes.
7. **Pruebas**: lo marcado *(verificar)* depende de versiones concretas (GNOME 45–48, Plasma 6, `xdg-desktop-portal-hyprland`/`-wlr`). Conviene fijar una matriz mínima de pruebas: **Hyprland y X11 primero** (los que más usa el equipo), luego KDE, Sway y GNOME.
8. **Pregunta pendiente para ti**: qué escritorios usas para probar y si el modo cliente/servidor remoto es un caso real hoy (define cuánto adelantar la validación local del permiso en el agente, sección 3).
