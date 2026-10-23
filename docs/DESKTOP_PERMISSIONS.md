# Permisos del agente de escritorio

`kali-avatar` es quien decide si una acción nativa puede ejecutarse, no el core. Aunque el core remoto (o su token) esté comprometido, el agente no captura la pantalla ni lanza aplicaciones sin una respuesta del usuario en su propia máquina.

Regla: **toda acción que observe o controle el PC requiere consentimiento explícito, siempre.**

## Clases

| Clase | Acciones hoy | Consentimiento |
|---|---|---|
| `info` | `list_monitors`, `find_apps` | No |
| `observe` | `screenshot` | Sí |
| `launch` | `launch_app` | Sí (salvo apps de la lista del usuario) |
| `clipboard-write`, `clipboard-read`, `window`, `input` | (fases 2 a 4) | Sí; `clipboard-read` nunca admite concesión de tarea |

Una acción desconocida se rechaza.

## La tarjeta de consentimiento

La dibuja el agente (no contenido web ni el core). Muestra qué se pide, la clase y el motivo que dio Kali. El botón por defecto es **Denegar**; cerrar la ventana o 60 s sin respuesta también deniegan. Opciones: *Permitir esta vez*, *Permitir esta tarea* (hasta 15 min y 100 acciones; 10 min y 40 para `input`), *Denegar*, *Denegar y detener* (revoca todo). Voz y chat no pueden responderla.

Medidas contra errores y abusos:

- Los botones de permitir se activan 0,7 s después de aparecer la tarjeta, para que un clic dirigido a otra cosa no conceda nada. `Esc` deniega.
- Una sola tarjeta a la vez; las demás peticiones esperan.
- Tres denegaciones en un minuto pausan las peticiones nuevas hasta que pase el minuto, sin mostrar más tarjetas.
- En compositores con layer-shell (Hyprland, Sway, KDE) la tarjeta se dibuja en la capa `overlay`, sin robar el teclado hasta que se hace clic.
- Para `launch_app` el agente resuelve el nombre a una única aplicación instalada (id exacto) y la tarjeta muestra su nombre real; el core no puede poner etiquetas. Si el nombre es ambiguo no se lanza nada y se devuelven sugerencias.
- Para `screenshot` la tarjeta avisa de que la imagen se enviará al modelo de IA.

## Una sola tarjeta

El agente anuncia la capacidad `local_consent` al registrarse. Si está presente, el core no muestra su propia tarjeta para `screenshot` ni `launch_app` (el agente la muestra y deniega si no hay respuesta). Sin agente, o con un agente antiguo, el core sigue preguntando.

## Concesiones de tarea

Atadas a la clase y al objetivo (app o monitor): una concesión para el monitor `DP-1` no cubre `HDMI-A-1`. Caducan por tiempo, por número de acciones, al desconectarse del core y con el pánico.

## Pánico

- Bandeja: «Revocar todos los permisos».
- Terminal: `kali-avatar --panic` (envía `SIGUSR1` a la instancia en marcha).

Revoca todo e invalida las tarjetas abiertas. No depende del core.

## Lista de apps para lanzar

En `~/.config/kali/desktop.json`:

```json
{ "permissions": { "launchAllowlist": ["org.mozilla.firefox"] } }
```

Solo `launch_app` la respeta. Vacía por defecto.

## Auditoría

`~/.local/state/kali/audit.jsonl` (permisos 0600), una línea JSON por decisión y resultado, cada una con el SHA-256 de la anterior para detectar ediciones o borrados en medio del archivo. A los 10 MB se rota a `audit.jsonl.1` y la cadena continúa. No guarda contenido capturado ni tecleado.

## Diagnóstico

`kali-avatar --doctor` imprime la sesión detectada, las herramientas de captura disponibles y la ruta de auditoría.

## Protocolo

`desktop_action` puede llevar `reason` (texto, máx. 300 caracteres) que se muestra en la tarjeta como cita del motivo indicado por Kali. Las acciones que pueden pedir consentimiento esperan hasta 90 s en el core; `list_monitors`, 30 s. Si el usuario deniega, `desktop_action_result` vuelve con `ok: false` y `error`.

## Aplicaciones

`find_apps(query)` busca entre las aplicaciones instaladas (GIO: todos los directorios XDG, Flatpak y Snap) por nombre, tipo y palabras clave y devuelve hasta 5 con su `id`. `launch_app(name)` solo lanza si `name` identifica exactamente una aplicación (id o nombre); si no, devuelve sugerencias. El lanzamiento usa GIO, que gestiona terminal, activación por D-Bus y notificación de arranque.
