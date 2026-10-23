# Permisos del agente de escritorio

`kali-avatar` es quien decide si una acción nativa puede ejecutarse, no el core. Aunque el core remoto (o su token) esté comprometido, el agente no captura la pantalla ni lanza aplicaciones sin una respuesta del usuario en su propia máquina.

Regla: **toda acción que observe o controle el PC requiere consentimiento explícito, siempre.**

## Clases

| Clase | Acciones hoy | Consentimiento |
|---|---|---|
| `info` | `list_monitors` | No |
| `observe` | `screenshot` | Sí |
| `launch` | `launch_app` | Sí (salvo apps de la lista del usuario) |
| `clipboard-write`, `clipboard-read`, `window`, `input` | (fases 2 a 4) | Sí; `clipboard-read` nunca admite concesión de tarea |

Una acción desconocida se rechaza.

## La tarjeta de consentimiento

La dibuja el agente (no contenido web ni el core). Muestra qué se pide, la clase y el motivo que dio Kali. El botón por defecto es **Denegar**; cerrar la ventana o 60 s sin respuesta también deniegan. Opciones: *Permitir esta vez*, *Permitir esta tarea* (hasta 15 min y 100 acciones; 10 min y 40 para `input`), *Denegar*, *Denegar y detener* (revoca todo). Voz y chat no pueden responderla.

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

`~/.local/state/kali/audit.jsonl` (permisos 0600), una línea JSON por decisión y resultado, cada una con el SHA-256 de la anterior para detectar ediciones o borrados. No guarda contenido capturado ni tecleado.

## Diagnóstico

`kali-avatar --doctor` imprime la sesión detectada, las herramientas de captura disponibles y la ruta de auditoría.

## Protocolo

`desktop_action` puede llevar `reason` (texto, máx. 300 caracteres) que se muestra en la tarjeta como cita del motivo indicado por Kali. Las acciones que pueden pedir consentimiento esperan hasta 90 s en el core; `list_monitors`, 30 s. Si el usuario deniega, `desktop_action_result` vuelve con `ok: false` y `error`.
