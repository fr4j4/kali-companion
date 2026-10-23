# Plan de implementación: integración de Kali con el escritorio

Rama: `feature/desktop-integration` (desde `development` @ `f235e5c`, con `platform-backends` ya integrada).
Base de análisis: [`docs/audits/integracion-escritorio-kali.md`](../../audits/integracion-escritorio-kali.md). Este documento lo convierte en trabajo ejecutable: orden, archivos, protocolo, pruebas y criterios de aceptación.

## 0. Regla firme (no negociable)

**Toda acción que controle el PC requiere consentimiento explícito del usuario, siempre.** Ninguna fase de control (4 en adelante) se fusiona antes de que la fase 0 esté completa y probada. La regla se hace cumplir **en `kali-avatar` (el ejecutor)**, no solo en el core.

## 1. Punto de partida verificado en `development`

| Pieza | Estado real |
|---|---|
| `kali-avatar/src/platform/` | `Env`, `Surface`, `DesktopServices` (cursor, monitores, captura), backends `x11`, `wayland` (layer/plain), `hyprland`, `kwin`, `capture`. **No hay `Caps` sondeadas.** |
| `kali-avatar/src/actions.rs` | `CAPABILITIES = [launch_app, list_monitors, screenshot]`; `launch_app` usa `gtk-launch`; no hay comprobación de permiso local. |
| `kali-core/desktop.py` | `DesktopBroker` con registro de agentes, capacidades negociadas (`desktop_registered`) y `request()` con timeout de 30 s. |
| `kali-core/collar/consent.py` | Ya hay **concesión por sesión** (`allow_session`, `permission_key`, `grant/revoke/is_granted`), sin caducidad ni alcance ni registro. |
| `kali-core/gaze/local.py` | Captura local con `mss` (servidor); `RemoteGazeClient` usa el agente cuando existe. |
| Tests | `kali-core/tests/test_desktop_broker.py`, `test_profiles.py`, `test_server.py`; tests unitarios Rust en `platform/mod.rs` y `actions.rs`. |

Nota: esto corrige dos puntos del informe, que se basaba en `master`: la captura remota por el agente y las concesiones por sesión ya existen. Lo que sigue faltando es (a) exigir y validar el permiso **en el agente**, (b) caducidad, alcance, indicador, pánico y auditoría.

## 2. Principios de implementación

1. **Pequeños PR por fase**, cada uno compilable y con tests. Orden estricto de dependencias (sección 8).
2. **Ligereza**: sin procesos residentes nuevos; overlay y tarjetas se crean al vuelo; crates pesados tras `cargo features`.
3. **Degradación explícita**: cada trait devuelve `Unsupported(motivo)`; `Caps` decide qué herramientas ve el LLM.
4. **Sin cruces entre backends** (`x11.rs` no importa `wayland*`); lo compartido va en módulos neutros (`portal.rs`, `common.rs`).
5. **Pruebas sin escritorio real**: `xvfb-run` (X11) y `sway`/`cage` headless (layer-shell, captura, entrada virtual) en CI; tests unitarios puros para grants, auditoría y geometría.
6. **Textos i18n** (es/en) para toda tarjeta, notificación y error visible.

## 3. Fase 0: permisos en el ejecutor y base (P0)

**Estado (primer PR de implementación):** hechas 0.1 (`Caps` + `--doctor`, sin integrar aún en `CAPABILITIES`), 0.2 y 0.3 (clases y grants), 0.4 (tarjeta GTK sencilla, aún no layer-shell), 0.5 (enforcement en el agente; `reason` y timeout en el core), 0.6 (auditoría con cadena de hashes, sin visor ni rotación), 0.7 parcial (pánico por bandeja y `--panic`; sin badge) y 0.8 parcial (`list_monitors` pasa a `safe`). Hecho después: una sola tarjeta (`local_consent`), tarjeta en layer-shell, botones desarmados 0,7 s, pausa tras 3 denegaciones, rotación de auditoría, y de la fase 1 `find_apps` y `launch_app` con GIO (1.1 a 1.3). Hecho además: `look_at_screen` por intención con pregunta a la visión, `suggest_capture` con límites en el servidor y chips en chat y avatar, y `kali-avatar --ask-region/--ask-screen` con vista previa (ver `docs/DESKTOP_PERMISSIONS.md`). Pendiente: filtro anti auto-aprobación contra entrada sintética, `ClipboardRead`/`Input` aún sin acciones, visor «Actividad», decisiones de perfil en el gateway.
Decisiones del usuario: modo remoto es un caso real de hoy; escritorios objetivo Hyprland y KDE; lista de apps solo para lanzar; extensión de GNOME solo preliminar.


Objetivo: el agente rechaza toda acción no autorizada localmente, con indicador, pánico y auditoría.

### 0.1 `Caps` sondeadas y `--doctor` (S)
- `platform/caps.rs`: struct `Caps` (layer_shell, overlay, window_list, window_focus, capture_{full,region,window,stream}, input_inject, clipboard_{read,write}, shortcuts, notifications, tray) con sondeo en hilo y límite de 2 s por sonda; log al arrancar.
- `actions::CAPABILITIES` pasa a derivarse de `Caps`.
- CLI `kali-avatar --doctor`: imprime `Env`, `Caps` y herramientas ausentes con la orden de instalación sugerida.
- Aceptación: tests de `Caps` con entorno inyectado (`from_lookup`); `--doctor` en Xvfb muestra X11 sin layer-shell.

### 0.2 Clases de acción y política (M)
- `kali-avatar/src/perms/mod.rs`: `ActionClass { Info, Observe, Launch, ClipboardWrite, ClipboardRead, Window, Input }`, tabla acción→clase, y `Policy` (qué clases admiten concesión de tarea, TTL máximo, `max_actions`).
- Config en `~/.config/kali/desktop.toml` (`[permissions]`): `launch_allowlist = []` (opcional, vacío por defecto), TTLs máximos. `Input` y `ClipboardRead` **no** admiten "siempre" (validación al cargar la config, error si se intenta).
- Aceptación: tests de tabla y de validación de config.

### 0.3 Concesiones (grants) en el agente (M)
- `perms/grants.rs`: almacén en memoria; `Grant { id, class, scope{window?, monitor?, app?}, ttl, max_actions, used }`; `check(class, params) -> Allowed(grant_id) | NeedsConsent`; revocación por: TTL, contador, fin de sesión/desconexión del core, bloqueo de pantalla, inactividad, cierre de la ventana atada, cambio de monitores.
- Reloj inyectable para tests; sin dependencias nuevas.
- Aceptación: tests de caducidad, alcance, revocación en cadena y límite de acciones.

### 0.4 Tarjeta de consentimiento de confianza (L)
- `perms/consent_ui.rs`: ventana GTK (layer-shell `overlay` con teclado exclusivo en Wayland; ventana modal con tipo diálogo en X11/GNOME) mostrando **qué / sobre qué / por qué / hasta cuándo**; botones: *Permitir esta vez*, *Permitir esta tarea (N min)*, *Denegar* (por defecto), *Denegar y detener*. Timeout → denegar.
- Solo acepta eventos de puntero/teclado reales (el agente nunca inyecta sobre sus propias superficies; filtro de coordenadas en `Input`).
- Voz/chat nunca conceden en clases de control (el core no puede resolver esta tarjeta; solo puede cancelarla).
- Aceptación: smoke en Xvfb que abre la tarjeta y comprueba que `Deny` es el foco por defecto y que el timeout deniega.

### 0.5 Enforcement en `actions::perform` y protocolo (M)
- `perform()` consulta `grants::check`. Sin concesión → `Err(needs_consent)` y el agente abre la tarjeta (flujo asíncrono: la acción espera la decisión hasta el timeout de la solicitud).
- Protocolo (`docs/PROTOCOL.md` + `kali-web/src/lib/protocol.ts` + `desktop.py`): `desktop_action` añade `grant_id` y `reason`/`plan_step` opcionales; nuevos eventos `desktop_needs_consent` (agente→core, informativo), `desktop_revoked` (agente→core), `desktop_activity` (agente→core, para la UI).
- Core: `DesktopBroker.request` sube el timeout cuando hay consentimiento pendiente (hoy 30 s fijos); `ToolResult` traduce `needs_consent`/`denied` a mensajes claros para el LLM.
- El agente aplica la política **aunque el token sea válido** (modelo cliente/servidor).
- Aceptación: tests Rust de `perform` sin concesión; test Python `test_desktop_broker.py` ampliado (timeout dinámico, `denied`, `revoked`).

### 0.6 Auditoría local (S)
- `perms/audit.rs`: `~/.local/state/kali/audit.jsonl`, solo-añadir, cadena de hashes (SHA-256 del registro anterior), campos `ts, tool, class, params_redacted, grant_id, decision, decided_by(click|key|timeout|panic), outcome, snapshot sha256`. No registra el contenido tecleado, solo longitud y destino. Rotación a 10 MB.
- Entrada de bandeja "Actividad…" abre un visor GTK con revocar por concesión.
- Aceptación: test de verificación de la cadena (detecta una línea alterada).

### 0.7 Indicador y pánico (M)
- Indicador: badge en el avatar (ojo = observando, mano = controlando) y entrada de bandeja con estado; borde de color en el monitor afectado (se completa en fase 3 con el overlay; aquí solo el badge).
- Pánico: `kali-avatar --panic` y entrada de bandeja; atajo global se añade en fase 1. Revoca todo y aborta acciones en curso; funciona sin core.
- Aceptación: test de que `panic` vacía el almacén y rechaza acciones en vuelo.

### 0.8 Core: alinear el gateway (S)
- `claws/list_monitors.py` → riesgo `safe` (info).
- `collar/gateway.py`: añadir `action_class` a `PermissionDecision`; para `observe`/`input`/`clipboard-*` ignorar la excepción por `allowed_tools` de perfil; los perfiles siguen valiendo para `fs_*`, `web_*`.
- `ConsentManager.request()` incluye `scope`, `ttl`, `preview` para que la tarjeta del agente y el modal web muestren lo mismo.
- Aceptación: `test_profiles.py` cubre que `screenshot` pide consentimiento incluso con perfil permisivo.

### 0.9 Documentación (S)
- `docs/PROTOCOL.md`, `docs/DESKTOP_CLIENT.md`, `kali-avatar/README.md`; nueva `docs/DESKTOP_PERMISSIONS.md` con el modelo.

**Esfuerzo fase 0: 8–12 días.** Hito: ninguna acción de escritorio se ejecuta sin concesión local, con auditoría y pánico.

## 4. Fase 1: integrarse sin molestar (P1)

| Tarea | Detalle | Archivos | Esf. |
|---|---|---|---|
| 1.1 Lanzador con `Gio.AppInfo` | Reemplaza `gtk-launch`; `launch_app` por id, `uri`/`file`, `action` del `.desktop`; lanza con `systemd-run --user --scope` o `setsid`; respeta Flatpak/Snap/`XDG_DATA_DIRS` | `kali-avatar/src/apps.rs`, `actions.rs` | M |
| 1.2 `find_apps` | Búsqueda difusa por Name/GenericName/Keywords/Categories, `NoDisplay`/`OnlyShowIn`, top 5 con icono; clase `Info` | `apps.rs`, core `claws/launcher.py` | M |
| 1.3 Core: herramientas | `find_apps`, `launch_app` (id, uri, action) ejecutadas **siempre por el agente** (el core ya no lanza en el servidor); error claro sin agente | `claws/launcher.py`, `desktop.py` | S |
| 1.4 Notificaciones | `notify-rust` o zbus; tarjeta pendiente y "tarea terminada"; acciones solo informativas | `kali-avatar/src/notify.rs` | S |
| 1.5 CLI + socket | `kali-avatar --toggle|--ask|--region|--ptt|--panic|--doctor` contra socket Unix en `$XDG_RUNTIME_DIR` (permisos 0600) | `ipc.rs`, `main.rs` | M |
| 1.6 Atajos globales | Niveles: portal GlobalShortcuts (`ashpd`), CLI (documentado para Hyprland/Sway/KDE/GNOME), `XGrabKey` en X11 | `platform/shortcuts.rs` + backends | M |
| 1.7 Lista de ventanas (lectura) | `list_windows`/ventana activa: EWMH (X11), `hyprctl clients -j`, `swaymsg -t get_tree`, KWin script/D-Bus; GNOME → `Unsupported`; clase `Observe` | `platform/windows.rs` + backends | M |
| 1.8 `focus_or_launch` | Enfoca ventana existente si el backend puede, si no lanza; clase `Launch` | `apps.rs`, backends | S |
| 1.9 Lista permitida de apps | Opcional en `desktop.toml`; ajuste en la UI web (sección Escritorio) | `perms`, `kali-web` | S |

**Esfuerzo: 6–8 días.** Aceptación: "abre Firefox" resuelve Flatpak y nativo; segunda petición enfoca la ventana; `kali-avatar --toggle` mapeado en Hyprland funciona; GNOME muestra la degradación en `--doctor`.

## 5. Fase 2: ver la pantalla y conversar (P1)

| Tarea | Detalle | Esf. |
|---|---|---|
| 2.1 Captura de región | Selector del usuario: `slurp` (wlroots), portal interactivo (GNOME/KDE), `maim -s` (X11); `Observe` | M |
| 2.2 Captura de ventana | Activa o elegida; geometría desde 1.7 + `grim -g`/`spectacle -a`/`maim -i`/portal | M |
| 2.3 Portal Screenshot | Módulo `portal.rs` (`ashpd`/zbus), usado en GNOME y como alternativa segura en el resto | M |
| 2.4 Vista previa antes de enviar | Ventana de confirmación con recorte, difuminado de zonas y "no enviar" | M |
| 2.5 Reducción y recompresión | Lado largo ≤1568 px, PNG/WebP; límite de tamaño y ancho de banda remoto | S |
| 2.6 Flujo "pregunta sobre esto" | Atajo → selector → vista previa → adjunto al chat (evento nuevo `attachment` o reutilizar `input` con imagen); arrancar la UI bajo demanda con `--open chat` | L |
| 2.7 Arrastrar y soltar al avatar | Drop target GTK para archivos, texto e imágenes | M |
| 2.8 Política de capturas | Retención configurable (7 días por defecto), borrado seguro, opción "no guardar"; `snapshots/` del core solo guarda lo aprobado | S |
| 2.9 Core: herramientas | `screenshot` con `mode: full|region|window`, `list_windows`, `active_window`; descripción de visión sobre la imagen aprobada | M |

**Esfuerzo: 7–10 días.** Aceptación: región, ventana y pantalla completa funcionan en X11 (Xvfb) y en Sway headless; GNOME usa portal con diálogo propio; ninguna imagen sale del equipo sin pasar por la vista previa.

## 6. Fase 3: overlay sin interrumpir (P1)

| Tarea | Detalle | Esf. |
|---|---|---|
| 3.1 Trait `Overlay` | `show(monitor, elements, ttl)`, `clear()`; superficie creada al vuelo y destruida al terminar | S |
| 3.2 Backend layer-shell | Capa `overlay`, anclaje total, `keyboard_interactivity=none`, `exclusive_zone=-1`, región de entrada **vacía** | M |
| 3.3 Backend X11 | Ventana ARGB con `_NET_WM_STATE_ABOVE` y XShape con entrada vacía | M |
| 3.4 Dibujo | Cairo/`DrawingArea`: texto, flecha, rect/elipse, badge numerado, puntero; escala fraccional y `transform` del monitor | M |
| 3.5 Degradación GNOME | Información en la burbuja del avatar + notificación; sin "siempre encima" | S |
| 3.6 Herramienta `annotate` | Esquema de elementos con `ttl`, color, monitor; límite de elementos y de frecuencia; etiqueta de Kali; `Esc`/clic en avatar limpia; clase `Info` | M |
| 3.7 Set-of-Marks | Capturas con cuadrícula/marcas numeradas para que el LLM referencie casillas en vez de píxeles; traducción a coordenadas de monitor | M |
| 3.8 Indicador de estado en pantalla | Borde de color en el monitor mientras se observa o controla | S |
| 3.9 Capa de consentimiento por encima | La tarjeta de 0.4 siempre sobre cualquier overlay | S |

**Esfuerzo: 7–10 días.** Aceptación: overlay click-through verificado (un clic atraviesa la superficie) en Sway headless y Xvfb; destruido tras el TTL; sin crecimiento de memoria tras 100 overlays.

## 7. Fase 4: control del ordenador (P2)

**Prerrequisito: fase 0 completa y fase 3 (anillo de vista previa).**

| Tarea | Detalle | Esf. |
|---|---|---|
| 4.1 Trait `Input` | `pointer_move`, `click`, `scroll`, `key`, `type_text`; `Unsupported` si no hay backend | S |
| 4.2 X11 | XTEST con `x11rb` | M |
| 4.3 wlroots (Hyprland/Sway) | `zwlr_virtual_pointer` + `zwp_virtual_keyboard`; mapa de teclas XKB | L |
| 4.4 KDE/GNOME | Portal `RemoteDesktop` + `ConnectToEIS` (libei, crate `reis`), token de reutilización | L |
| 4.5 Vista previa "mostrar y hacer" | Anillo en el destino + pausa de 0,5–1 s con cancelación por `Esc` antes de cada clic | M |
| 4.6 Toma de control humana | Detectar entrada real del usuario y pausar la sesión de `input` | M |
| 4.7 Guardas | Lista de `app_id`/clases bloqueadas (polkit, gestores de contraseñas, bloqueo de pantalla); filtro de combinaciones del sistema; límite de acciones por minuto; filtro anti auto-aprobación | M |
| 4.8 Portapapeles | `wl-clipboard` (wlroots/KDE), portal Clipboard (GNOME), `arboard`/`xclip` (X11); lectura con vista previa y solo "una vez" | M |
| 4.9 Gestión de ventanas | `focus` (si falta), `move`/`resize`/`close` por backend, clase `Window` | M |
| 4.10 Herramientas del core | `mouse_click`, `type_text`, `press_keys`, `scroll`, `clipboard_get/set`, `window_action`, con plan de pasos visible | M |
| 4.11 `uinput` | **Solo como último recurso, desactivado por defecto** y con advertencia | S |

**Esfuerzo: 12–18 días.** Aceptación: pruebas de extremo a extremo en X11 (Xvfb) y Sway headless; en KDE/GNOME validación manual por checklist (los portales preguntan por sí mismos). Test negativo: sin concesión no se mueve el cursor; con la concesión caducada, tampoco; el pánico detiene una secuencia en curso.

## 8. Fase 5: contexto continuo y robustez (P3)

- 5.1 Modo "mirar conmigo": `ScreenCast` + PipeWire (Wayland) / polling (X11), diferencias de imagen, límites de tiempo y coste, indicador permanente. **XL**.
- 5.2 AT-SPI para rectángulos precisos de elementos (coordenadas relativas a ventana + geometría del compositor). **L**.
- 5.3 OCR local opcional (`tesseract`) y modo "solo visión local". **M**.
- 5.4 Extensión de GNOME Shell (overlay, lista de ventanas) si se decide. **XL**, mantenimiento por versión.
- 5.5 Empaquetado: Flatpak (portales ya listos), `.deb`/AUR, unidades systemd, `--doctor` en el instalador. **M**.

## 9. Orden de PR y dependencias

```
PR1  caps + doctor (0.1)          ─┐
PR2  perms: clases/grants (0.2,0.3)├─> PR4 enforcement + protocolo (0.5) ─> PR5 auditoría+pánico (0.6,0.7) ─> PR6 core gateway+docs (0.8,0.9)
PR3  consent UI (0.4)             ─┘
PR7  apps + CLI + atajos + ventanas lectura (fase 1)
PR8  captura región/ventana + portal + vista previa + flujo (fase 2)
PR9  overlay + annotate (fase 3)
PR10 input X11 + guardas + control humano (4.1,4.2,4.5–4.7)  -> PR11 wlroots -> PR12 portal/libei -> PR13 portapapeles+ventanas+herramientas
PR14+ fase 5
```

Cada PR: compila en CI (`cargo build`, `cargo test`, `pytest`, `tsc`), añade tests de su tarea y actualiza docs.

## 10. Matriz de pruebas

| Escenario | Automático | Manual |
|---|---|---|
| X11 | Xvfb + `xdotool`/XTEST de verificación | i3/XFCE |
| Sway / wlroots | `sway` headless (`WLR_BACKENDS=headless`) | Hyprland real |
| KDE Plasma 6 | Solo unitarios | Checklist por funcionalidad |
| GNOME (45–48) | Solo unitarios | Checklist: portales, degradación |

Orden de validación manual: **Hyprland y X11** primero; luego KDE, Sway, GNOME. Los puntos *(verificar)* del informe se cierran aquí.

## 11. Decisiones abiertas para el usuario

1. Lista de apps siempre permitidas solo para lanzar: recomendado, opcional y vacía por defecto.
2. Extensión de GNOME Shell: ¿se invierte, o se acepta la degradación?
3. ¿Modo cliente/servidor remoto como caso real hoy? Si sí, el enforcement de 0.5 es bloqueante para cualquier despliegue.
4. Doble diálogo en Wayland (portal + Kali) en control: aceptado por diseño; reducir con tokens de reutilización.

## 12. Riesgos

- **Portales y compositores cambian rápido** (GNOME 45–48, Plasma 6, `xdph`): validar versión mínima soportada en `Caps` y documentarla.
- **Coordenadas desde el LLM** poco fiables: Set-of-Marks primero, AT-SPI después.
- **Superficie de ataque nueva** (socket IPC, control de entrada): socket 0600, sin red, sin ejecución de comandos arbitrarios desde el CLI, pruebas negativas obligatorias.
- **Peso**: vigilar RAM residente tras cada fase (objetivo: no superar +20 MB sobre `kali-avatar` actual en reposo).
- **Mantenimiento**: Rust crece; mantener módulos pequeños y `Unsupported` explícito en lugar de ramas por escritorio.

## 13. Estimación total

| Fase | Días |
|---|---|
| 0 Permisos y base | 8–12 |
| 1 Integrarse | 6–8 |
| 2 Ver y conversar | 7–10 |
| 3 Overlay | 7–10 |
| 4 Control | 12–18 |
| 5 Contexto continuo y robustez | 15+ |
| **Total** | **55–73** |

Fases 0 a 3 (sin control) son ~28–40 días y ya entregan lanzar, ver y señalar con permisos sólidos.
