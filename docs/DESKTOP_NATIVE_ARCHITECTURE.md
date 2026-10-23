# Arquitectura: escritorio con avatar nativo (propuesta)

Estado: propuesta de diseño sobre `feature/desktop-client-remote-core`. Las cifras de memoria son estimaciones a validar con mediciones (fase 1).
Contexto: ver `docs/DESKTOP_CLIENT.md` (estado actual) y la auditoría de la rama.

## 1. Objetivos y prioridades

1. **Ligero**: lo que queda residente (siempre encendido) debe ser mínimo; lo pesado se lanza bajo demanda.
2. **Sin perder features**: chat, voz (PTT, wake-word, TTS), artefactos con todos los widgets, acciones nativas, modo local y cliente/servidor.
3. **Nativo de verdad** en Wayland (layer-shell) y X11 (ARGB + XShape), con degradación en GNOME Wayland.
4. **Una sola UI**: los widgets viven en `kali-web`; nada se reescribe para el escritorio.

## 2. Principio rector: separar por ciclo de vida

| Capa | Proceso | Vida | Hace |
|---|---|---|---|
| Motor | `kali-core` (Python) | residente (local o remoto) | sesiones, LLM, tools, STT/TTS, permisos |
| **Agente de escritorio** | `kali-avatar` (Rust, nuevo) | **residente, mínimo** | avatar flotante, bandeja, conexión de presencia, acciones nativas, lanzar la UI |
| UI rica | `kali-shell` (Electron) | **bajo demanda** | ventana principal, ventanas de artefactos, audio de voz (hasta fase 4) |
| UI web | `kali-web` (React) | compilado, servido por core o empaquetado | todos los widgets y pantallas |

Así, en reposo solo corren `kali-core` y `kali-avatar`; Electron se abre cuando el usuario abre chat o un artefacto.

## 3. Estructura del repositorio

```
kali-companion/
├─ kali-core/               Backend Python (sin cambios de lugar)
├─ kali-web/                UI React
│   ├─ src/avatar/          SVG + mood engine (se extrae lógica pura, ver §5)
│   ├─ src/desktop/         Pantallas específicas del escritorio (setup, artefacto, avatar)
│   └─ avatar.html          NUEVA segunda entrada Vite: bundle mínimo solo-avatar
├─ kali-shell/              Electron (UI rica bajo demanda). Renombrable a kali-desktop-ui
│   └─ src/                 main.ts, preload.ts; sidecar.ts se reutiliza para modo local
├─ kali-avatar/             NUEVO · agente nativo (Rust)
│   ├─ src/layer.rs         Ventana: gtk4-layer-shell (Wayland) / ARGB+XShape (X11)
│   ├─ src/tray.rs          StatusNotifierItem (ksni)
│   ├─ src/link.rs          WS al core (modo presencia) + reconexión
│   ├─ src/actions.rs       launch_app, list_monitors, screenshot (portal/grim/xcap)
│   ├─ src/config.rs        Config compartida + libsecret
│   └─ src/launch.rs        Lanza/enfoca kali-shell con argumentos
├─ packages/                (fase 2) código TS compartido
│   ├─ protocol/            Tipos de eventos + WSClient (hoy en kali-web/src/lib)
│   └─ avatar-core/         Tipos, presets, derivación de estado/emoción (puro, sin React)
├─ docs/                    + DESKTOP_NATIVE_ARCHITECTURE.md, PROTOCOL.md ampliado
├─ docker/  scripts/        + build de kali-avatar, servicio systemd de usuario
└─ kali-vr-android/         (rama VR, fuera de alcance)
```

Regla de dependencias: `kali-avatar` y `kali-shell` dependen del **protocolo** del core y del **bundle** de `kali-web`, nunca entre sí ni del código Python.

## 4. Contrato de shell (clave para poder cambiar de tecnología)

`kali-web` solo conoce la interfaz `window.kaliDesktop` (`DesktopBridge`, ya existente). Se la declara estable y versionada (`bridgeVersion`). Implementaciones intercambiables:

- Electron (`preload.ts`, hoy).
- Nativa (fase 5, opcional): `kali-avatar` abre ventanas WebKitGTK que inyectan el mismo bridge. Permitiría **eliminar Electron** si la medición lo justifica, sin tocar `kali-web`.

## 5. Cambios necesarios

### 5.1 `kali-core`
1. **Modo presencia** en `hello` (`{"mode":"presence"}`): sin replay de historial/artefactos; el core envía solo eventos de estado (`turn_start/delta/turn_end`, `tts_start/stop`, `stt_*`, `consent_request`, `status`). Es también la base del delta-sync pedido en la auditoría (A2).
2. **Registro de agentes de escritorio por sesión** (arregla A3): `desktop_register` guarda `{conn, capabilities[], platform}` en un registro del servidor; ya no depende del ContextVar del turno. Si una tool nativa no tiene agente, error claro en lugar de usar la pantalla del servidor (flag `KALI_ALLOW_SERVER_SCREEN`).
3. **Capacidades negociadas**: `desktop_registered` devuelve `capabilities` (p. ej. `launch_app`, `screenshot`, `list_monitors`, `layer_overlay`).
4. **Heartbeat + `seq`** por sesión (ping 25 s) para reconexión barata, común a todos los clientes.
5. **Origen de audio** (`audio_sink: client|server`): en modo local el core podría reproducir TTS y capturar mic directamente (fase 4), liberando a la UI de la voz.
6. **Mood server-side opcional** (fase 4): evento `presence {state, emotion, text_tail}` ya calculado, para que el agente pueda ser casi sin lógica.

### 5.2 `kali-web`
1. Segunda entrada Vite `avatar.html` que monta solo `AvatarSVG` + cliente de presencia. Evita cargar widgets, router y workspace en el proceso residente. Objetivo: bundle de pocos cientos de KB.
2. Extraer de `AvatarMoodEngine`/`StageProvider` la **derivación de estado** a una función pura `deriveAvatarState(events)` sin dependencia de `useStage`.
3. `DesktopAvatar.tsx`: dejar de depender de IPC de la ventana principal (`setPresence`) y consumir presencia directa del core.
4. Unificar URL/token/WS en un único `lib/connection.ts` (hoy duplicado en 4 sitios).

### 5.3 `kali-shell` (Electron)
1. Pasa a **bajo demanda**: argumentos `--open chat|artifacts|artifact:<sid>:<aid>` manejados en `second-instance`.
2. Elimina el avatar propio cuando existe `kali-avatar` (se conserva como respaldo si no está instalado).
3. Mantiene la bandeja solo como respaldo (la bandeja principal la da `kali-avatar`).
4. `class`/`app_id` fijos (`kali-artifact`, `kali-main`) para reglas del compositor.
5. Lee la config compartida (no su propio `desktop.json`).
6. Reactiva `sidecar.ts` para modo **local** (puerto libre + token generado).

### 5.4 `kali-avatar` (nuevo)
- Rust: `gtk4` + `gtk4-layer-shell` + `webkit6` (transparente) cargando `avatar.html`; `ksni` para bandeja; `tokio-tungstenite` para el WS; `secret-service` para tokens.
- Wayland con layer-shell (Hyprland/Sway/KDE): capa `top`/`overlay`, anclaje a esquina y monitor elegible, `keyboard_interactivity=none`, `input_region` limitada al cuerpo del avatar (click-through).
- GNOME Wayland: ventana normal flotante + aviso (sin layer-shell). Extensión opcional a futuro.
- X11: ventana ARGB, `_NET_WM_WINDOW_TYPE_DOCK`/above, XShape para click-through.
- Si WebKitGTK falla (historial de "Error 71" en Wayland), ruta B: render nativo del SVG con `resvg` y animaciones en Rust; la lógica de estado ya viene de `deriveAvatarState`.

### 5.5 Configuración y secretos
Un solo archivo `~/.config/kali/desktop.toml` (URL, modo local|remoto, avatar: visible/tamaño/esquina/monitor) y tokens en libsecret. Lo leen `kali-avatar` y `kali-shell`. Se acaba la duplicidad entre `desktop.json` de Electron y `localStorage`.

### 5.6 Empaquetado y servicios
- `kali-avatar`: binario estático/deb/AppImage, unidad `systemd --user` (`kali-avatar.service`) y autostart `.desktop`.
- `kali-shell`: se mantiene AppImage/deb; el deb depende opcionalmente de `kali-avatar`.
- `kali-core`: unidad `systemd --user` para modo local.
- Paquete meta `kali-desktop` que instala ambos.

## 6. Topologías

```
Local (una máquina)
  kali-core ◄──ws://127.0.0.1──► kali-avatar ──(bajo demanda)──► kali-shell
  (systemd user)                  (residente)                      (UI rica)

Cliente/servidor
  [servidor] kali-core ◄══wss + tokens (proxy TLS)══► [cliente] kali-avatar → kali-shell
  Acciones nativas (captura, abrir apps) se ejecutan en el cliente.
```

## 7. Presupuesto de ligereza (estimado, validar)

| Escenario | Residente | Con UI abierta |
|---|---|---|
| Hoy (Electron con avatar) | ~300–400 MB | ~400–600 MB |
| Propuesto fase 3 (kali-avatar + WebKitGTK mínimo) | ~80–150 MB | +300 MB (Electron) |
| Fase 5 con render nativo del SVG | ~30–50 MB | +300 MB |
| Fase 5 sin Electron (todo WebKitGTK) | ~100–200 MB | ~150–250 MB |

## 8. Fases

0. **Hecha**: rama de prueba `claude/project-thread-582gq7`.
1. **Base** (sin nativo): medir RAM/CPU actual, `app_id` fijos, args en `second-instance`, modo local con `sidecar.ts`, config compartida, `connection.ts`.
2. **Core**: modo presencia, registro de agentes por sesión, capacidades, heartbeat/seq. Tests en `kali-core/tests`.
3. **Prototipo `kali-avatar`** (WebKitGTK + layer-shell/X11) + entrada `avatar.html`. Matriz Hyprland, Sway, KDE, GNOME, X11.
4. **Voz y bandeja**: bandeja en `kali-avatar`; decidir dónde viven mic y TTS (core local, avatar o Electron oculto). Hasta decidirlo, Electron residente oculto solo si la voz está activa.
5. **Optimización**: render nativo del SVG y/o eliminar Electron con el contrato de shell.

## 9. Riesgos abiertos

- **Voz**: hoy mic/PTT/TTS están en `kali-web`. Si Electron no está corriendo, no hay audio. Es la decisión más importante de la fase 4.
- **WebKitGTK en Wayland** (antecedente de Error 71): hay que reprobar con WebKitGTK 6 antes de comprometerse.
- **Mantenimiento**: añade Rust al repo (Python + TS + Rust). Mitigación: `kali-avatar` pequeño, con CI propio.
- **GNOME Wayland**: sin overlay real; solo degradación.
- **Conflictos de ramas**: la línea VR (`feature/ui3d-mvp`) también toca `kali-web`; conviene integrar el escritorio a `development` primero.
