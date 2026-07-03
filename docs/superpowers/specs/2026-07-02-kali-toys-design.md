# Kali Toys — Configuración de juegos e IA de juegos

**Goal:** Crear una sección de settings llamada "Kali Toys" que permita configurar la persistencia de sesiones de juego, el timeout de razonamiento de la IA, y —en modo avanzado— parámetros de generación de IA específicos para juegos, incluyendo la posibilidad de usar una conexión/modelo diferente al de chat general.

**Architecture:** La configuración viaja por el mismo pipeline que el resto de settings (`SettingsEvent` → WebSocket → `apply_settings` en `server.py` → `settings` y `user_config.json`). El backend `_handle_game_move` resuelve la conexión de juegos contra su `connection_store` interno y construye un `DirectLLMProvider` efímero o reusa el proveedor general. El frontend muestra la sección Kali Toys en el modal de settings y refleja en ProviderSection qué conexión/modelo está seleccionado para juegos.

**Tech Stack:** Python 3.11+ (kali-core), TypeScript/React + Tailwind (kali-web), WebSocket, JSON.

## Principio rector: referencias, no duplicación

`StatusEvent` y `SettingsEvent` solo transportan **settings** (referencias / foreign keys a entidades). Las propiedades de entidades relacionadas —como `api_url`, `api_key`, `models[]` de una conexión guardada— **no se duplican** en el status. El backend resuelve las referencias internamente contra `connection_store`.

Analogía: `game_connection_id` es una foreign key. No duplicas las columnas de la tabla referenciada en la fila que tiene el FK. Cuando necesitas los datos de la conexión, haces el join (el backend lo hace al resolver).

**Consecuencia:** el frontend nunca necesita la `api_url` de la conexión de juegos porque **no es quien llama al LLM**. El flujo principal de jugadas es WebSocket → backend → LLM. La ruta legacy de `fetch()` directo en `game-llm-provider.ts` se considera obsoleta para jugadas reales.

## Global Constraints

- No modificar la arquitectura de conexiones guardadas; solo consumirla.
- Mantener los valores actuales como defaults para no romper instalaciones existentes.
- Todos los cambios deben tener tests (backend y frontend) o al menos actualizar tests existentes.
- Seguir estilo y patrones existentes (`SettingsEvent`, `StatusEvent`, `UserConfig`, `apply_settings`, etc.).
- La conexión de juegos debe poder ser "Usar conexión de IA activa" (default) u otra conexión guardada.
- El modelo de juegos se elige de la lista de modelos de la conexión seleccionada; si solo hay uno, se usa automáticamente.
- Los cambios aplican inmediatamente (no requieren reinicio).
- `StatusEvent` y `SettingsEvent` solo llevan referencias (settings), no propiedades de entidades relacionadas.
- El backend es el único que llama al LLM para jugadas; el frontend envía `game_move` por WebSocket.

## Campos nuevos

### SettingsEvent / StatusEvent

```typescript
game_connection_id?: string;    // ref a conexión guardada; "" o "active" = usar activa
game_model?: string;             // override de modelo (vacío = primer modelo de la conexión)
game_temperature?: number;        // 0.0–2.0, default 0.7
game_max_tokens?: number;         // mínimo 16, default 256
game_retry_timeout_1_ms?: number; // mínimo 1000, default 12000
game_retry_timeout_2_ms?: number; // mínimo 1000, default 3000
game_retry_timeout_3_ms?: number; // mínimo 1000, default 2000
game_max_retries?: number;        // 1–5, default 2
```

### config.py (env vars con defaults)

```python
game_connection_id: str = os.getenv("KALI_GAME_CONNECTION_ID", "")
game_model: str = os.getenv("KALI_GAME_MODEL", "")
game_temperature: float = float(os.getenv("KALI_GAME_TEMPERATURE", "0.7"))
game_max_tokens: int = int(os.getenv("KALI_GAME_MAX_TOKENS", "256"))
_game_retry_timeouts_raw: str = os.getenv("KALI_GAME_RETRY_TIMEOUTS", "12000,3000,2000")
game_retry_timeouts: list[int] = [int(v.strip()) for v in _game_retry_timeouts_raw.split(",") if v.strip().isdigit()]
game_max_retries: int = int(os.getenv("KALI_GAME_MAX_RETRIES", "2"))
```

### UserConfig (persistencia)

```python
game_connection_id: str | None = None
game_model: str | None = None
game_temperature: float | None = None
game_max_tokens: int | None = None
game_retry_timeout_1_ms: int | None = None
game_retry_timeout_2_ms: int | None = None
game_retry_timeout_3_ms: int | None = None
game_max_retries: int | None = None
```

### Docker env vars

```bash
KALI_GAME_SESSION_PATH=
KALI_GAME_AI_GLOBAL_TIMEOUT_MS=20000
KALI_GAME_CONNECTION_ID=active
KALI_GAME_MODEL=
KALI_GAME_TEMPERATURE=0.7
KALI_GAME_MAX_TOKENS=256
KALI_GAME_RETRY_TIMEOUTS=12000,3000,2000
KALI_GAME_MAX_RETRIES=2
```

## Tasks

### Task 1: Extender protocolo y config backend

**Files:**
- Modify: `kali-web/src/lib/protocol.ts:35-74`
- Modify: `kali-core/kali_core/config.py:26-33`
- Modify: `kali-core/kali_core/user_config.py:24-60`
- Modify: `kali-core/.env.example`
- Test: `kali-core/tests/test_game_session_settings.py`

**Interfaces:**
- Consumes: `SettingsEvent`, `StatusEvent`, `UserConfig`, `settings`
- Produces: `game_connection_id`, `game_model`, `game_temperature`, `game_max_tokens`, `game_retry_timeout_1_ms`, `game_retry_timeout_2_ms`, `game_retry_timeout_3_ms`, `game_max_retries` en todos los layers

- [ ] **Step 1: Añadir campos a `SettingsEvent` y `StatusEvent` en protocol.ts**

```typescript
// En SettingsEvent (línea ~35) y StatusEvent (línea ~400)
  game_connection_id?: string;
  game_model?: string;
  game_temperature?: number;
  game_max_tokens?: number;
  game_retry_timeout_1_ms?: number;
  game_retry_timeout_2_ms?: number;
  game_retry_timeout_3_ms?: number;
  game_max_retries?: number;
```

- [ ] **Step 2: Añadir variables env con defaults en config.py**

```python
# Debajo de game_ai_global_timeout_ms (línea ~33)

game_connection_id: str = os.getenv("KALI_GAME_CONNECTION_ID", "")
game_model: str = os.getenv("KALI_GAME_MODEL", "")
game_temperature: float = float(os.getenv("KALI_GAME_TEMPERATURE", "0.7"))
game_max_tokens: int = int(os.getenv("KALI_GAME_MAX_TOKENS", "256"))
_game_retry_timeouts_raw: str = os.getenv("KALI_GAME_RETRY_TIMEOUTS", "12000,3000,2000")
game_retry_timeouts: list[int] = [int(v.strip()) for v in _game_retry_timeouts_raw.split(",") if v.strip().isdigit()]
game_max_retries: int = int(os.getenv("KALI_GAME_MAX_RETRIES", "2"))
```

- [ ] **Step 3: Exponer campos en `_Settings` y en status payload**

En `config.py`, añadir al final de `_Settings`:
```python
    game_connection_id = game_connection_id
    game_model = game_model
    game_temperature = game_temperature
    game_max_tokens = game_max_tokens
    game_retry_timeouts = game_retry_timeouts
    game_max_retries = game_max_retries
```

En `server.py` `_build_status_payload` (después de `game_ai_global_timeout_ms`):
```python
            "game_connection_id": settings.game_connection_id,
            "game_model": settings.game_model,
            "game_temperature": settings.game_temperature,
            "game_max_tokens": settings.game_max_tokens,
            "game_retry_timeout_1_ms": settings.game_retry_timeouts[0] if len(settings.game_retry_timeouts) > 0 else 12000,
            "game_retry_timeout_2_ms": settings.game_retry_timeouts[1] if len(settings.game_retry_timeouts) > 1 else 3000,
            "game_retry_timeout_3_ms": settings.game_retry_timeouts[2] if len(settings.game_retry_timeouts) > 2 else 2000,
            "game_max_retries": settings.game_max_retries,
```

- [ ] **Step 4: Persistir campos en UserConfig**

En `user_config.py` añadir a la dataclass (después de `game_ai_global_timeout_ms`):
```python
    game_connection_id: str | None = None
    game_model: str | None = None
    game_temperature: float | None = None
    game_max_tokens: int | None = None
    game_retry_timeout_1_ms: int | None = None
    game_retry_timeout_2_ms: int | None = None
    game_retry_timeout_3_ms: int | None = None
    game_max_retries: int | None = None
```

- [ ] **Step 5: Documentar variables en kali-core/.env.example**

Añadir al final del archivo, después de `KALI_PROFILE=dev`:
```bash
# ── Kali Toys / Game AI ────────────────────────────────────
# Ruta de sesiones de juego (vacío = ~/.kali/game-sessions)
KALI_GAME_SESSION_PATH=

# Timeout global de razonamiento IA por jugada (ms).
KALI_GAME_AI_GLOBAL_TIMEOUT_MS=20000

# Conexión IA para juegos: "active" = usar conexión IA activa;
# otro valor = id de una conexión guardada para juegos exclusivos.
KALI_GAME_CONNECTION_ID=active

# Modelo dentro de la conexión de juegos (vacío = primer modelo disponible).
KALI_GAME_MODEL=

# Parámetros de generación de IA para juegos.
KALI_GAME_TEMPERATURE=0.7
KALI_GAME_MAX_TOKENS=256

# Timeouts por intento (ms), separados por coma.
KALI_GAME_RETRY_TIMEOUTS=12000,3000,2000

# Número máximo de reintentos.
KALI_GAME_MAX_RETRIES=2
```

- [ ] **Step 6: Escribir tests backend**

En `kali-core/tests/test_game_session_settings.py`, añadir:

```python
def test_apply_settings_game_temperature(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_temperature", 0.7)
    settings_helper({"game_temperature": 0.3})
    assert settings.game_temperature == 0.3


def test_apply_settings_game_temperature_rejects_out_of_range(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_temperature", 0.7)
    settings_helper({"game_temperature": 3.0})
    assert settings.game_temperature == 0.7


def test_apply_settings_game_max_tokens(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_tokens", 256)
    settings_helper({"game_max_tokens": 512})
    assert settings.game_max_tokens == 512


def test_apply_settings_game_max_tokens_rejects_too_low(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_tokens", 256)
    settings_helper({"game_max_tokens": 8})
    assert settings.game_max_tokens == 256


def test_apply_settings_game_max_retries(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_retries", 2)
    settings_helper({"game_max_retries": 3})
    assert settings.game_max_retries == 3


def test_apply_settings_game_max_retries_rejects_out_of_range(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_retries", 2)
    settings_helper({"game_max_retries": 10})
    assert settings.game_max_retries == 2


def test_apply_settings_game_connection_id(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_connection_id", "")
    settings_helper({"game_connection_id": "abc123"})
    assert settings.game_connection_id == "abc123"


def test_build_status_payload_includes_game_ai_params(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_temperature", 0.5)
    monkeypatch.setattr(settings, "game_max_tokens", 128)
    monkeypatch.setattr(settings, "game_connection_id", "conn1")
    # ... llamar _build_status_payload y verificar campos
```

- [ ] **Step 7: Ejecutar tests backend**

Run: `cd kali-core && pytest tests/test_game_session_settings.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add kali-core/kali_core/config.py kali-core/kali_core/user_config.py kali-core/kali_core/server.py kali-core/.env.example kali-core/tests/test_game_session_settings.py kali-web/src/lib/protocol.ts
git commit -m "feat(kali-toys): extend protocol and backend config for game AI parameters"
```

---

### Task 2: Aplicar settings en runtime y resolver proveedor de juegos

**Files:**
- Modify: `kali-core/kali_core/server.py` (apply_settings ~2901, _handle_game_move ~1858, _save_user_config_snapshot ~2938, _build_status_payload ~540)
- Modify: `kali-core/kali_core/mind/llm/direct.py:60-83,170-186` (stream con overrides de temperature/max_tokens)
- Test: `kali-core/tests/test_game_session_settings.py`

**Interfaces:**
- Consumes: `game_*` settings, `connection_store` interno del backend, `DirectLLMProvider`
- Produces: `_resolve_game_llm_provider()` helper; `_handle_game_move` usa proveedor correcto con temperature/max_tokens configurados

- [ ] **Step 1: Validar y aplicar settings de juegos en apply_settings**

En `server.py` dentro de `apply_settings` (después del bloque de `game_ai_global_timeout_ms` ~2915), añadir:

```python
        if "game_connection_id" in event:
            settings.game_connection_id = str(event["game_connection_id"])
        if "game_model" in event:
            settings.game_model = str(event["game_model"])
        if "game_temperature" in event:
            try:
                value = float(event["game_temperature"])
                if 0.0 <= value <= 2.0:
                    settings.game_temperature = value
                else:
                    await self.send({"event": "error", "detail": "game_temperature must be between 0.0 and 2.0"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_temperature"})
        if "game_max_tokens" in event:
            try:
                value = int(event["game_max_tokens"])
                if value >= 16:
                    settings.game_max_tokens = value
                else:
                    await self.send({"event": "error", "detail": "game_max_tokens must be at least 16"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_max_tokens"})
        if "game_retry_timeout_1_ms" in event:
            try:
                v = int(event["game_retry_timeout_1_ms"])
                if v >= 1000:
                    settings.game_retry_timeouts[0] = v
                else:
                    await self.send({"event": "error", "detail": "game_retry_timeout_1_ms must be at least 1000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_retry_timeout_1_ms"})
        if "game_retry_timeout_2_ms" in event:
            try:
                v = int(event["game_retry_timeout_2_ms"])
                if v >= 1000:
                    settings.game_retry_timeouts[1] = v
                else:
                    await self.send({"event": "error", "detail": "game_retry_timeout_2_ms must be at least 1000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_retry_timeout_2_ms"})
        if "game_retry_timeout_3_ms" in event:
            try:
                v = int(event["game_retry_timeout_3_ms"])
                if v >= 1000:
                    settings.game_retry_timeouts[2] = v
                else:
                    await self.send({"event": "error", "detail": "game_retry_timeout_3_ms must be at least 1000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_retry_timeout_3_ms"})
        if "game_max_retries" in event:
            try:
                value = int(event["game_max_retries"])
                if 1 <= value <= 5:
                    settings.game_max_retries = value
                else:
                    await self.send({"event": "error", "detail": "game_max_retries must be between 1 and 5"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_max_retries"})
```

- [ ] **Step 2: Actualizar _save_user_config_snapshot**

En `server.py` `_save_user_config_snapshot` (después de `game_ai_global_timeout_ms=settings.game_ai_global_timeout_ms`), añadir:

```python
            game_connection_id=settings.game_connection_id,
            game_model=settings.game_model,
            game_temperature=settings.game_temperature,
            game_max_tokens=settings.game_max_tokens,
            game_retry_timeout_1_ms=settings.game_retry_timeouts[0] if len(settings.game_retry_timeouts) > 0 else None,
            game_retry_timeout_2_ms=settings.game_retry_timeouts[1] if len(settings.game_retry_timeouts) > 1 else None,
            game_retry_timeout_3_ms=settings.game_retry_timeouts[2] if len(settings.game_retry_timeouts) > 2 else None,
            game_max_retries=settings.game_max_retries,
```

- [ ] **Step 3: Cargar UserConfig persistido al inicio**

Asegurar que `UserConfig.load_or_default()` aplique los campos de juegos a `settings` en el startup del servidor. Buscar dónde se aplica `user_config` al startup y añadir:

```python
if cfg.game_connection_id is not None:
    settings.game_connection_id = cfg.game_connection_id
if cfg.game_model is not None:
    settings.game_model = cfg.game_model
if cfg.game_temperature is not None:
    settings.game_temperature = cfg.game_temperature
if cfg.game_max_tokens is not None:
    settings.game_max_tokens = cfg.game_max_tokens
if cfg.game_retry_timeout_1_ms is not None:
    settings.game_retry_timeouts[0] = cfg.game_retry_timeout_1_ms
if cfg.game_retry_timeout_2_ms is not None:
    settings.game_retry_timeouts[1] = cfg.game_retry_timeout_2_ms
if cfg.game_retry_timeout_3_ms is not None:
    settings.game_retry_timeouts[2] = cfg.game_retry_timeout_3_ms
if cfg.game_max_retries is not None:
    settings.game_max_retries = cfg.game_max_retries
```

- [ ] **Step 4: Helper para resolver proveedor de juegos**

Añadir método en la clase Connection (o donde corresponda según la arquitectura de `connection_store`):

```python
async def _resolve_game_llm_provider(self) -> LLMProvider | None:
    """Return an LLM provider for game moves.

    If game_connection_id is unset or 'active', reuse the server's active LLM.
    Otherwise build a temporary DirectLLMProvider from a saved connection,
    resolving the reference internally — never exposing connection properties
    in StatusEvent.
    """
    gid = settings.game_connection_id
    if not gid or gid == "active":
        return self.server.llm_provider

    conn = self.server.connection_store.get(gid)
    if not conn:
        logger.warning("[game_move] game_connection_id=%s not found, falling back to active", gid)
        return self.server.llm_provider

    model = settings.game_model or (conn.models[0] if conn.models else "")
    if not model:
        logger.warning("[game_move] no model available for connection %s, falling back to active", gid)
        return self.server.llm_provider

    return DirectLLMProvider(
        api_url=conn.api_url,
        api_key=conn.api_key,
        model=model,
        max_tokens=settings.game_max_tokens,
    )
```

- [ ] **Step 5: Modificar _handle_game_move para usar el helper**

En `server.py` `_handle_game_move` (~línea 1876), cambiar:

```python
# Antes:
llm = self.server.llm_provider

# Después:
llm = await self._resolve_game_llm_provider()
```

- [ ] **Step 6: Aplicar temperature y max_tokens configurados en direct.py**

Refactorizar `DirectLLMProvider.stream()` para que los kwargs de `temperature` y `max_tokens` puedan ser sobrescritos por parámetros opcionales:

```python
async def stream(
    self,
    messages: list[dict],
    tools: list[ToolDef] | None = None,
    *,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> AsyncIterator[StreamEvent]:
    # ...
    kwargs: dict = {
        "model": self._model,
        "messages": full,
        "stream": True,
        "temperature": temperature if temperature is not None else 0.7,
        "max_tokens": max_tokens if max_tokens is not None else self._max_tokens,
    }
```

Luego, en `_handle_game_move`, cuando se use el proveedor de juegos:

```python
async for event in llm.stream(
    messages,
    temperature=settings.game_temperature,
    max_tokens=settings.game_max_tokens,
):
```

Si el proveedor es el activo (no efímero), también aplica los overrides de temperature/max_tokens de juegos. El `DirectLLMProvider` efímero ya se construye con `max_tokens=settings.game_max_tokens`, pero el override de `stream()` garantiza consistencia.

- [ ] **Step 7: Tests de integración**

Añadir tests que verifiquen:
- `_resolve_game_llm_provider` retorna el proveedor activo cuando `game_connection_id` es `"active"` o vacío.
- `_resolve_game_llm_provider` retorna un `DirectLLMProvider` con la URL/key/modelo correctos cuando `game_connection_id` apunta a una conexión guardada.
- `_resolve_game_llm_provider` cae al proveedor activo cuando la conexión no existe.
- `stream()` respeta los overrides de `temperature` y `max_tokens`.

- [ ] **Step 8: Ejecutar tests**

Run: `cd kali-core && pytest tests/ -k game -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add kali-core/kali_core/server.py kali-core/kali_core/mind/llm/direct.py kali-core/tests/test_game_session_settings.py
git commit -m "feat(kali-toys): apply game AI settings and resolve per-game LLM provider"
```

---

### Task 3: Añadir configuración Docker

**Files:**
- Modify: `docker/.env.example`
- Modify: `docker/docker-compose.yml`

**Interfaces:**
- Consumes: variables de entorno estándar de Kali
- Produces: `KALI_GAME_*` disponibles en el contenedor

- [ ] **Step 1: Añadir variables a docker/.env.example**

Al final del archivo, después de la sección de Paths:

```bash
# ── Kali Toys / Game AI ────────────────────────────────────────────────────
# Ruta de sesiones de juego.
# KALI_GAME_SESSION_PATH=/app/data/game-sessions

# Timeout global de razonamiento IA por jugada (ms).
KALI_GAME_AI_GLOBAL_TIMEOUT_MS=20000

# Conexión IA para juegos: "active" usa la activa;
# otro valor es el id de una conexión guardada.
KALI_GAME_CONNECTION_ID=active

# Modelo dentro de la conexión de juegos (vacío = primer modelo disponible).
# KALI_GAME_MODEL=

# Parámetros de generación de IA para juegos.
KALI_GAME_TEMPERATURE=0.7
KALI_GAME_MAX_TOKENS=256

# Timeouts por intento (ms), separados por coma.
KALI_GAME_RETRY_TIMEOUTS=12000,3000,2000

# Número máximo de reintentos.
KALI_GAME_MAX_RETRIES=2
```

- [ ] **Step 2: Añadir variables a docker-compose.yml**

En `services.kali.environment` (después de `KALI_PROFILE`):

```yaml
      # ── Kali Toys / Game AI ──
      - KALI_GAME_SESSION_PATH=${KALI_GAME_SESSION_PATH:-}
      - KALI_GAME_AI_GLOBAL_TIMEOUT_MS=${KALI_GAME_AI_GLOBAL_TIMEOUT_MS:-20000}
      - KALI_GAME_CONNECTION_ID=${KALI_GAME_CONNECTION_ID:-active}
      - KALI_GAME_MODEL=${KALI_GAME_MODEL:-}
      - KALI_GAME_TEMPERATURE=${KALI_GAME_TEMPERATURE:-0.7}
      - KALI_GAME_MAX_TOKENS=${KALI_GAME_MAX_TOKENS:-256}
      - KALI_GAME_RETRY_TIMEOUTS=${KALI_GAME_RETRY_TIMEOUTS:-12000,3000,2000}
      - KALI_GAME_MAX_RETRIES=${KALI_GAME_MAX_RETRIES:-2}
```

- [ ] **Step 3: Verificar compose**

Run: `cd docker && docker compose config > /dev/null`
Expected: valid config, sin errores

- [ ] **Step 4: Commit**

```bash
git add docker/.env.example docker/docker-compose.yml
git commit -m "feat(docker): expose KALI_GAME_* environment variables"
```

---

### Task 4: Crear sección Kali Toys en UI

**Files:**
- Create: `kali-web/src/components/settings/KaliToysSection.tsx`
- Modify: `kali-web/src/components/SettingsModal.tsx:8,39-55,156-175`
- Modify: `kali-web/src/components/settings/BehaviorSection.tsx` (quitar game_session_path y game_ai_global_timeout_ms)
- Modify: `kali-web/src/locale/en/common.json`
- Modify: `kali-web/src/locale/es/common.json`
- Test: tests de UI si existen para SettingsModal

**Interfaces:**
- Consumes: `systemStatus` (StatusEvent), `connections` de `useStage`, `onUpdate`
- Produces: `KaliToysSection` componente exportado

- [ ] **Step 1: Crear KaliToysSection.tsx**

```tsx
// KaliToysSection — game session persistence and game-specific AI settings.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Gamepad2 } from "lucide-react";
import type { StatusEvent } from "../../lib/protocol";
import { useStage } from "../../stage/StageProvider";
import { SelectField, SliderField, TextField, ToggleField } from "./fields";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
}

const DEFAULT_TIMEOUTS = [12_000, 3_000, 2_000];
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 256;

export function KaliToysSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const { connections } = useStage();
  const [advanced, setAdvanced] = useState(false);

  const gameSessionPath = systemStatus?.game_session_path ?? "";
  const gameAiGlobalTimeoutMs = systemStatus?.game_ai_global_timeout_ms ?? 20_000;
  const gameConnectionId = systemStatus?.game_connection_id ?? "active";
  const gameModel = systemStatus?.game_model ?? "";
  const gameTemperature = systemStatus?.game_temperature ?? DEFAULT_TEMPERATURE;
  const gameMaxTokens = systemStatus?.game_max_tokens ?? DEFAULT_MAX_TOKENS;
  const timeout1 = systemStatus?.game_retry_timeout_1_ms ?? DEFAULT_TIMEOUTS[0];
  const timeout2 = systemStatus?.game_retry_timeout_2_ms ?? DEFAULT_TIMEOUTS[1];
  const timeout3 = systemStatus?.game_retry_timeout_3_ms ?? DEFAULT_TIMEOUTS[2];
  const gameMaxRetries = systemStatus?.game_max_retries ?? DEFAULT_MAX_RETRIES;

  const activeLabel = t("settings.game_connection_active");
  const connectionOptions = [
    { id: "active", label: activeLabel },
    ...connections.map((c) => ({
      id: c.id,
      label: `${c.kind === "local" ? "Local" : "Cloud"}: ${c.api_url}`,
    })),
  ];

  const selectedConnection = connections.find((c) => c.id === gameConnectionId);
  const availableModels = selectedConnection?.models ?? [];
  const showModelSelector = gameConnectionId !== "active" && availableModels.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Gamepad2 size={15} className="text-accent" />
        <span className="text-sm font-semibold text-foreground">
          {t("settings.section.kali_toys")}
        </span>
      </div>

      <TextField
        label={t("settings.game_session_path")}
        value={gameSessionPath}
        onChange={(v) => onUpdate({ game_session_path: v })}
        placeholder="~/.kali/game-sessions"
        helperText={t("settings.game_session_path_hint")}
      />

      <SliderField
        label={t("settings.game_ai_global_timeout_ms")}
        value={gameAiGlobalTimeoutMs / 1000}
        min={5}
        max={120}
        step={5}
        onChange={(v) => onUpdate({ game_ai_global_timeout_ms: Math.round(v * 1000) })}
        displayValue={`${(gameAiGlobalTimeoutMs / 1000).toFixed(0)}${t("common.seconds_abbrev")}`}
        helperText={t("settings.game_ai_global_timeout_ms_hint")}
      />

      <SelectField
        label={t("settings.game_connection_id")}
        value={gameConnectionId}
        onChange={(v) => {
          const patch: Record<string, unknown> = { game_connection_id: v, game_model: "" };
          onUpdate(patch);
        }}
      >
        {connectionOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SelectField>

      {showModelSelector && (
        <SelectField
          label={t("settings.game_model")}
          value={gameModel || availableModels[0]}
          onChange={(v) => onUpdate({ game_model: v })}
        >
          {availableModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
      )}

      <ToggleField
        label={t("settings.advanced_configuration")}
        checked={advanced}
        onChange={setAdvanced}
      />

      {advanced && (
        <div className="flex flex-col gap-4 pl-3 border-l-2 border-border">
          <SliderField
            label={t("settings.game_temperature")}
            value={gameTemperature}
            min={0}
            max={1.5}
            step={0.1}
            onChange={(v) => onUpdate({ game_temperature: v })}
            displayValue={gameTemperature.toFixed(1)}
          />

          <SliderField
            label={t("settings.game_max_tokens")}
            value={gameMaxTokens}
            min={16}
            max={4096}
            step={16}
            onChange={(v) => onUpdate({ game_max_tokens: Math.round(v) })}
            displayValue={String(gameMaxTokens)}
          />

          <SliderField
            label={t("settings.game_retry_timeout_1_ms")}
            value={timeout1}
            min={1000}
            max={60_000}
            step={1000}
            onChange={(v) => onUpdate({ game_retry_timeout_1_ms: Math.round(v) })}
            displayValue={`${timeout1}ms`}
          />

          <SliderField
            label={t("settings.game_retry_timeout_2_ms")}
            value={timeout2}
            min={1000}
            max={30_000}
            step={1000}
            onChange={(v) => onUpdate({ game_retry_timeout_2_ms: Math.round(v) })}
            displayValue={`${timeout2}ms`}
          />

          <SliderField
            label={t("settings.game_retry_timeout_3_ms")}
            value={timeout3}
            min={1000}
            max={20_000}
            step={1000}
            onChange={(v) => onUpdate({ game_retry_timeout_3_ms: Math.round(v) })}
            displayValue={`${timeout3}ms`}
          />

          <SliderField
            label={t("settings.game_max_retries")}
            value={gameMaxRetries}
            min={1}
            max={5}
            step={1}
            onChange={(v) => onUpdate({ game_max_retries: Math.round(v) })}
            displayValue={String(gameMaxRetries)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrar en SettingsModal.tsx**

Añadir `Gamepad2` al import de lucide-react:
```tsx
import { Cpu, Volume2, Sliders, Palette, Gauge, Mic, Info, Gamepad2 } from "lucide-react";
```

Añadir import:
```tsx
import { KaliToysSection } from "./settings/KaliToysSection";
```

Actualizar `SectionId`:
```tsx
type SectionId = "provider" | "generation" | "voice" | "stt" | "behavior" | "kali_toys" | "appearance" | "about";
```

Añadir a `SECTIONS` (después de "behavior"):
```tsx
{ id: "kali_toys", icon: Gamepad2, labelKey: "settings.section.kali_toys" },
```

Añadir en `renderSection()`:
```tsx
if (active === "kali_toys") return <KaliToysSection systemStatus={systemStatus} onUpdate={onUpdate} />;
```

- [ ] **Step 3: Añadir strings de i18n**

En `kali-web/src/locale/en/common.json` añadir:
```json
"settings.section.kali_toys": "Kali Toys",
"settings.game_connection_id": "Game AI connection",
"settings.game_connection_active": "Use active AI connection",
"settings.game_model": "Game model",
"settings.game_temperature": "Game AI temperature",
"settings.game_max_tokens": "Game AI max tokens",
"settings.game_retry_timeout_1_ms": "Retry 1 timeout",
"settings.game_retry_timeout_2_ms": "Retry 2 timeout",
"settings.game_retry_timeout_3_ms": "Retry 3 timeout",
"settings.game_max_retries": "Max retries",
"settings.advanced_configuration": "Show advanced configuration",
```

En `kali-web/src/locale/es/common.json` añadir:
```json
"settings.section.kali_toys": "Kali Juegos",
"settings.game_connection_id": "Conexión IA de juegos",
"settings.game_connection_active": "Usar conexión de IA activa",
"settings.game_model": "Modelo de juegos",
"settings.game_temperature": "Temperatura IA de juegos",
"settings.game_max_tokens": "Máx. tokens IA de juegos",
"settings.game_retry_timeout_1_ms": "Timeout reintento 1",
"settings.game_retry_timeout_2_ms": "Timeout reintento 2",
"settings.game_retry_timeout_3_ms": "Timeout reintento 3",
"settings.game_max_retries": "Máx. reintentos",
"settings.advanced_configuration": "Mostrar configuración avanzada",
```

- [ ] **Step 4: Mover game_session_path y game_ai_global_timeout_ms de BehaviorSection a KaliToysSection**

En `kali-web/src/components/settings/BehaviorSection.tsx`:
- Eliminar las variables `gameSessionPath` y `gameAiGlobalTimeoutMs` (líneas 43-44).
- Eliminar el `<TextField>` de `game_session_path` (líneas 212-218).
- Eliminar el `<SliderField>` de `game_ai_global_timeout_ms` (líneas 220-229).

- [ ] **Step 5: Ejecutar lint/typecheck del frontend**

Run: `cd kali-web && npm run lint && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add kali-web/src/components/settings/KaliToysSection.tsx kali-web/src/components/SettingsModal.tsx kali-web/src/components/settings/BehaviorSection.tsx kali-web/src/locale/en/common.json kali-web/src/locale/es/common.json
git commit -m "feat(ui): add Kali Toys settings section with game AI parameters"
```

---

### Task 5: Mostrar badge de juegos en ProviderSection

**Files:**
- Modify: `kali-web/src/components/settings/connections/ConnectionCard.tsx`
- Modify: `kali-web/src/components/settings/ProviderSection.tsx`
- Modify: `kali-web/src/components/settings/connections/ConnectionsList.tsx`
- Modify: `kali-web/src/locale/en/common.json` y `es/common.json`

**Interfaces:**
- Consumes: `game_connection_id`, `game_model` del `systemStatus` (StatusEvent — solo referencias)
- Produces: UI badges indicando qué conexión/modelo se usa para juegos

- [ ] **Step 1: Pasar game config a ConnectionsList / ConnectionCard**

En `ProviderSection.tsx`, extraer de `systemStatus`:
```tsx
const gameConnectionId = systemStatus?.game_connection_id ?? "active";
const gameModel = systemStatus?.game_model ?? "";
```

Pasarlos a `<ConnectionsList ... gameConnectionId={gameConnectionId} gameModel={gameModel} />`.

En `ConnectionsList.tsx`, aceptar las props y pasarlas a `<ConnectionCard ... gameConnectionId={gameConnectionId} gameModel={gameModel} />`.

- [ ] **Step 2: Modificar ConnectionCard para mostrar badges**

Añadir props `gameConnectionId` y `gameModel` a `ConnectionCard`.

Lógica de badges:
```tsx
const isActive = connection.id === activeConnectionId;
const isGame = connection.id === gameConnectionId;
```

En el render, añadir un contenedor de badges:
```tsx
<div className="flex gap-1.5 flex-wrap">
  {isActive && (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
      {t("connections.badge_active")}
    </span>
  )}
  {isGame && (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ai-signal/10 text-ai-signal border border-ai-signal/30">
      {t("connections.badge_games")}
    </span>
  )}
</div>
```

Si `isGame` y hay `gameModel`, mostrar debajo:
```tsx
{isGame && gameModel && (
  <p className="text-[10px] text-muted/60">
    {t("connections.game_model_label", { model: gameModel })}
  </p>
)}
```

- [ ] **Step 3: Añadir strings i18n**

En `en/common.json`:
```json
"connections.badge_active": "Active",
"connections.badge_games": "Games",
"connections.game_model_label": "Game model: {{model}}",
```

En `es/common.json`:
```json
"connections.badge_active": "Activa",
"connections.badge_games": "Juegos",
"connections.game_model_label": "Modelo juegos: {{model}}",
```

- [ ] **Step 4: Ejecutar typecheck/lint**

Run: `cd kali-web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kali-web/src/components/settings/connections/ConnectionCard.tsx kali-web/src/components/settings/connections/ConnectionsList.tsx kali-web/src/components/settings/ProviderSection.tsx kali-web/src/locale/en/common.json kali-web/src/locale/es/common.json
git commit -m "feat(ui): show game connection/model badges in AI provider list"
```

---

### Task 6: Consumir configuraciones de juegos en el motor de juegos

**Files:**
- Modify: `kali-web/src/games/ai/game-llm-provider.ts`
- Modify: `kali-web/src/games/ai/ai-slot.ts`
- Modify: `kali-web/src/games/core/constants/game-ai.ts` (defaults)
- Test: `kali-web/src/games/ai/__tests__/ai-slot-timeout.test.ts`

**Interfaces:**
- Consumes: `StatusEvent.game_*` fields (solo referencias y settings, no propiedades de conexiones)
- Produces: `GameLLMProvider` con temperature/max_tokens correctos; `AISlot` usando timeouts configurables

- [ ] **Step 1: Actualizar game-llm-provider.ts**

La ruta de `fetch()` directo en `game-llm-provider.ts` es legacy y no se usa para jugadas reales (el flujo principal es WebSocket → backend). Se actualiza `hasLLMIntegration()` para verificar disponibilidad de IA para juegos:

```typescript
export function hasLLMIntegration(systemStatus: StatusEvent | null): boolean {
  if (!systemStatus) return false;
  // Hay IA para juegos si hay conexión activa o conexión de juegos configurada.
  const hasActive = Boolean(systemStatus.llm_provider && systemStatus.llm_api_url && systemStatus.llm_model);
  const hasGame = Boolean(systemStatus.game_connection_id);
  return hasActive || hasGame;
}
```

`createGameLLMProvider()` se mantiene para compatibilidad, pero se marca como deprecated en un comentario. El flujo principal de jugadas usa `AISlot.decide()` → WebSocket → backend, que resuelve la conexión internamente.

- [ ] **Step 2: Actualizar ai-slot.ts para usar timeouts configurables**

Añadir `systemStatus` como dependencia de `AISlot`. Opción: añadir método `setGameSettings`:

```typescript
export class AISlot implements MoveProvider {
  private _abortController: AbortController | null = null;
  private _getGlobalTimeout: () => number = () => GAME_AI_GLOBAL_TIMEOUT_MS;
  private _retryTimeouts: number[] = [GAME_AI_TIMEOUT_MS, GAME_AI_TIMEOUT_2_MS, GAME_AI_TIMEOUT_3_MS];
  private _maxRetries: number = KALI_MAX_RETRIES;

  // ...

  setGameSettings(opts: {
    retryTimeouts?: number[];
    maxRetries?: number;
  }): void {
    if (opts.retryTimeouts && opts.retryTimeouts.length > 0) {
      this._retryTimeouts = opts.retryTimeouts;
    }
    if (opts.maxRetries !== undefined && opts.maxRetries >= 1) {
      this._maxRetries = opts.maxRetries;
    }
  }
```

En `decide()`, cambiar:
```typescript
// Antes:
const timeouts = [GAME_AI_TIMEOUT_MS, GAME_AI_TIMEOUT_2_MS, GAME_AI_TIMEOUT_3_MS];

// Después:
const timeouts = this._retryTimeouts.slice(0, this._maxRetries + 1);
```

- [ ] **Step 3: Conectar GameWidget con AISlot para pasar settings**

En `kali-web/src/components/widgets/GameWidget.tsx`, donde ya se llama `aiSlot.setGlobalTimeout(...)`, añadir:

```typescript
aiSlot.setGameSettings({
  retryTimeouts: [
    systemStatus?.game_retry_timeout_1_ms ?? 12_000,
    systemStatus?.game_retry_timeout_2_ms ?? 3_000,
    systemStatus?.game_retry_timeout_3_ms ?? 2_000,
  ],
  maxRetries: systemStatus?.game_max_retries ?? 2,
});
```

- [ ] **Step 4: Actualizar tests**

En `kali-web/src/games/ai/__tests__/ai-slot-timeout.test.ts`, añadir:

```typescript
it("uses configured retry timeouts", async () => {
  const slot = new AISlot("opponent", mockWsClient, () => "session-1");
  slot.setGameSettings({
    retryTimeouts: [5_000, 2_000],
    maxRetries: 1,
  });
  // ... verificar que solo hace 2 intentos (maxRetries + 1 = 2)
  // ... verificar que los timeouts son 5000 y 2000
});

it("falls back to defaults when setGameSettings not called", async () => {
  const slot = new AISlot("opponent", mockWsClient, () => "session-1");
  // ... verificar que usa GAME_AI_TIMEOUT_MS, GAME_AI_TIMEOUT_2_MS, GAME_AI_TIMEOUT_3_MS
});
```

- [ ] **Step 5: Ejecutar tests frontend**

Run: `cd kali-web && npm test -- ai-slot-timeout`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add kali-web/src/games/ai/game-llm-provider.ts kali-web/src/games/ai/ai-slot.ts kali-web/src/components/widgets/GameWidget.tsx kali-web/src/games/ai/__tests__/ai-slot-timeout.test.ts
git commit -m "feat(games): consume configurable game AI settings in game engine"
```

---

### Task 7: Verificación global

**Files:**
- Todo el proyecto

- [ ] **Step 1: Ejecutar tests backend completos**

Run: `cd kali-core && pytest`
Expected: PASS

- [ ] **Step 2: Ejecutar tests frontend completos**

Run: `cd kali-web && npm test`
Expected: PASS

- [ ] **Step 3: Ejecutar lint y typecheck**

Run: `cd kali-web && npm run lint && npx tsc --noEmit`
Expected: PASS

Run: `cd kali-core && ruff check .`
Expected: PASS

- [ ] **Step 4: Verificar Docker compose**

Run: `cd docker && docker compose config > /dev/null`
Expected: valid YAML sin errores

- [ ] **Step 5: Revisar diff final**

Run: `git diff --stat`
Expected: archivos esperados modificados, sin archivos no deseados.

- [ ] **Step 6: Revisar commits**

Run: `git log --oneline -10`
Expected: commits limpios y atómicos por task.

---

## Spec Self-Review

1. **Spec coverage:** Cada requerimiento del usuario está cubierto:
   - Kali Toys section ✅
   - Configuraciones básicas + avanzadas con toggle ✅
   - Docker variables ✅
   - Selección de otra conexión/modelo para juegos ✅
   - Badge en ProviderSection ✅
   - Persistencia ✅
   - Backend usa proveedor de juegos ✅
   - Principio de referencias (no duplicación) ✅

2. **Placeholder scan:** No hay TBD/TODO. Los pasos incluyen código concreto.

3. **Type consistency:** Todos los campos `game_*` se mantienen consistentes entre `SettingsEvent`, `StatusEvent`, `UserConfig`, `settings`, y el frontend. No hay `game_api_url` ni `game_api_key_set` en ningún protocolo — coherente con el principio de referencias.

4. **Scope:** Un solo plan; las tareas son secuenciales naturales (protocolo/backend primero, Docker paralelo, UI después, integración final, verificación).

## User Review Gate

Spec escrito en `docs/superpowers/specs/2026-07-02-kali-toys-design.md`. Revisa y confirma si quieres ajustes antes de generar el plan de implementación.