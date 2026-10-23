# Dónde se ejecuta cada herramienta

Kali tiene dos máquinas posibles: el **servidor** (donde corre `kali-core`, a veces un contenedor) y el **PC del usuario** (donde corre el agente de escritorio `kali-avatar`). En modo todo-en-una-máquina son la misma. Cuando el usuario dice «mi RAM», «mis archivos» o «ejecuta esto», se refiere a su PC, no al servidor.

```
 Todo en una máquina                  Cliente / servidor
┌──────────────────────┐        PC (minigun)                 Servidor (kali)
│ kali-core            │        ┌─────────────────┐   WSS    ┌──────────────────────┐
│ + kali-avatar        │        │ kali-avatar     │◄────────►│ kali-core            │
│ (sin cambios)        │        │  system_info    │          │  web, artefactos,    │
└──────────────────────┘        │  run_command    │          │  juegos, git, tests  │
                                │  fs_read/fs_list│          │  (siempre aquí)      │
                                │  apps, pantalla │          │  y target='server'   │
                                └─────────────────┘          └──────────────────────┘
```

## Clasificación (fija, en el core: `kali_core/targets.py`)

| Tipo | Herramientas | Cómo se decide |
|---|---|---|
| `either` | `system_info`, `run_command`, `fs_read`, `fs_list` | Parámetro `target`: `desktop` (por defecto) o `server`. |
| `desktop` | `launch_app`, `find_apps`, `list_windows`, `focus_window`, `look_at_screen`, `list_monitors` | Solo el PC las tiene. Sin parámetro. |
| `server` | `web_*`, `create_artifact` y artefactos, juegos, `git_*`, `run_tests`, `organize_folder`, `create_terminal_session`, `stt_correct`, `suggest_capture` | Estado, red y repos de Kali. Sin parámetro. |

Una herramienta nueva **debe** añadirse a `TOOL_WHERE`; hay un test que falla si falta.

## Reglas para que el modelo no se equivoque

1. El modelo solo elige cuando hay dos opciones razonables. Si omite `target`, va al PC.
2. `target='server'` solo se usa si el usuario habla de la máquina que aloja a Kali (servidor, contenedor, logs, datos de Kali). La descripción de cada herramienta y el prompt lo dicen, y cada turno lleva una línea `WHERE TOOLS RUN` con el nombre del PC y del servidor.
3. **Sin agente no hay respaldo silencioso.** Si no hay agente de escritorio (y el core no está en modo local), la herramienta devuelve un error que dice que no puede alcanzar el PC y que **no** reintente con `server`. Un agente antiguo sin la acción también da un error claro.
4. **Todo resultado dice de qué máquina viene**: `origin: "[minigun]"` o `"[server]"` (y `machine: {where, host, label}`). Los errores y las denegaciones llevan el mismo prefijo.
5. Modo todo-en-una-máquina: si no hay agente conectado, `either` corre en el propio proceso y se etiqueta `[host · local]`. Si hay un agente conectado, gana el agente.

## Modo local o remoto

`KALI_DEPLOYMENT=local|remote` lo fuerza. Sin definir, un core que escucha solo en loopback (`127.0.0.1`) es local; con `0.0.0.0` (Docker) es remoto. `KALI_SERVER_NAME` cambia el nombre del servidor en los mensajes.

## Permisos

- **En el PC**: el agente pregunta siempre, con su propia tarjeta; el core no pone otra encima ni aplica sus listas blancas o concesiones de sesión.
  - `system_info` (hardware y carga, sin procesos ni usuarios): no pregunta.
  - `run_command`: pregunta **cada vez** y muestra el comando completo. No existe «permitir esta tarea» para comandos.
  - `fs_read` / `fs_list`: preguntan; solo bajo la carpeta personal (más `KALI_AVATAR_FS_ROOTS`), con enlaces simbólicos resueltos, y nunca `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, perfiles de navegador, `.env`, claves `id_*`, `*.pem`, `*.kdbx`.
  - Un agente sin `local_consent` no recibe estas acciones.
- **En el servidor** (`target='server'`): igual que antes (perfil, lista blanca de comandos, consentimiento del core), y la tarjeta añade `[server]`.

## Archivos

Cada destino ve **su** sistema de archivos: `fs_read` en el PC lee `/home/usuario/...` de minigun; con `target='server'`, lee el del servidor (limitado por `working_dirs` del perfil). Las rutas relativas del PC parten de su carpeta personal, no del directorio del servidor.

## Latencia y desconexión

`system_info` espera hasta 30 s; `fs_*`, hasta 90 s (hay tarjeta); los comandos, `timeout + 100 s`. Si el agente se desconecta, la petición falla en el acto con «desktop client disconnected» y el error lleva el nombre del PC.

## Evaluación

`kali-core/tests/data/tool_target_intents.json` (50 frases ES/EN) y `python kali-core/scripts/eval_tool_targets.py [--repeat 3]` miden con el modelo configurado, sin ejecutar nada: ≥ 90 % de acierto en las frases sobre el PC, ≥ 85 % en las del servidor y ≤ 2 % de preguntas sobre el PC contestadas en el servidor.

## Pendiente (fase 2)

`git_*`, `run_tests` y `organize_folder` siguen siendo solo-servidor. Para llevarlos al PC el agente necesita implementarlos (hoy se pueden hacer con `run_command target=desktop`).
