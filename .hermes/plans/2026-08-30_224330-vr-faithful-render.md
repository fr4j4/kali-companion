# VR Fiel 1:1 — Render, Widgets, Scroll y Layout en HMD — Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Hacer que los 23 `WindowType` se vean **idénticos al canvas 2D** dentro del HMD Quest, con layout, scroll y widgets interactivos por elemento (no screenshot plano), sin romper locomotion/botones/grip.

**Architecture:** Híbrido: **(A)** `pmndrs/uikit` para UI estructurada nativa WebGL (Yoga flexbox, scroll, hover, input) + **(B)** `three-html-render` (`HTMLTexture` + `InteractionManager`) solo para `html` vivo con JS/CSS arbitrario. Se abandona `html-to-image`/`foreignObject` como path principal por taint/CORS. Un factory `VrWidgetRenderer` mapea `WindowType → componente uikit / HTMLTexture`.

**Tech Stack:** `three@0.185.1`, `@react-three/fiber@8.18.0`, `@react-three/drei@9.122.0`, `@react-three/xr@5.7.1`, `@react-three/uikit@1.x` (+ `@react-three/yoga`), `three-html-render@0.1.2`, `react@18.3.1`. No subir React.

---

## Contexto actual (7ecf9a2)

- `VREntry.tsx`: `RoomCanvas` con `worldIds:Set<string>`, `Widget2DPanel` hace branch `isImmersive ? <HtmlTexturePanel> : <Html transform>`. Lobby sí fiel, HMD no.
- `HtmlTexturePanel.tsx`: `buildHtml()` genera HTML inline → `div -10000px` → `toCanvas(host)` (`html-to-image`). Falla sistemático: `foreignObject` no carga stylesheets/fonts/imgs externas sin data:URL, se taintea con `picsum`, Oculus Browser bloquea uso como WebGL texture → siempre cae a `fallbackTimer 900ms` canvas2D `fillText` plano. Chart mostraba barras porque su fallback era `fillRect`, resto plano.
- `widgetRegistry.tsx`: 23 widgets lazy (`CodeWidget`, `TableWidget`, `ChartWidget`, etc.) ya existen para 2D, pero `HtmlTexturePanel` no los reutiliza (reinventa HTML).
- Investigación: `three-html-render` demo `webxr-vr.html` (4 paneles VR interactivos), `pmndrs/uikit` (Yoga en WebGL, scroll nativo, no DOM), `dom-overlays` (solo un overlay 2D flat, no agarrable).

## Estrategia elegida

**No rasterizar DOM.** Renderizar **nativo en WebGL** con el mismo layout engine que 2D:

- **Por qué uikit:** es `react-three/fiber` + `Yoga`, ya compatible con `fiber@8`, resuelve layout/scroll/hover/input sin DOM, no tiene CORS, es lo que usa `react-three/xr` en prod. `three-html-render` solo para `html` donde el contenido es arbitrario y necesita CSS/JS real.
- **Tradeoff:** hay que portar cada `WindowType` a componente `uikit` una vez, pero se gana fidelidad + interactividad por elemento (checkbox toggle, quiz select, tabla sort) y se elimina el 100% de los fallos `foreignObject`.

---

## Plan paso a paso (tasks 2-5 min)

### Task 0 — Setup deps y polyfill

**Files:** Modify: `kali-web/package.json`, `kali-web/src/main.tsx:1-10`

**Step 1:** `npm install @react-three/uikit @react-three/yoga` (verificar que resuelve con `fiber@8` — si pide `fiber@9`, pin `uikit@1.0.0` legacy).
**Step 2:** En `main.tsx`, antes de `createRoot`, `import { installHtmlInCanvasPolyfill } from 'three-html-render/polyfill'; installHtmlInCanvasPolyfill();` (debe ir antes de crear el renderer; antes lo hacíamos después y bloqueó `gl.xr`).
**Step 3:** `npx tsc --noEmit` OK, `npm run build` y verificar que `VREntry` no sube >200kB.
**Commit:** `chore(vr): deps uikit + polyfill antes de Canvas`

### Task 1 — Factory VrWidgetRenderer

**Files:** Create: `kali-web/src/vr/widgets/VrWidgetRenderer.tsx`
**Objective:** Un componente que recibe `ArtifactEvent` y renderiza el widget correcto en uikit.

```tsx
export function VrWidgetRenderer({ ev, onAction }: { ev: ArtifactEvent; onAction?: (a)=>void }) {
  switch(ev.windowType){
    case 'table': return <VrTable ev={ev} />;
    case 'checklist': return <VrChecklist ev={ev} onToggle={onAction} />;
    case 'code': return <VrCode ev={ev} />;
    case 'html': return <VrHtml ev={ev} />; // usa HTMLTexture
    // ... 23 cases
  }
}
```

Cada `Vr*` reutiliza `parseContent(ev)` del widget 2D para no duplicar parsing.
**TDD:** test `VrWidgetRenderer.test.tsx` shallow: para cada `windowType` el factory renderiza sin throw.
**Commit:** `feat(vr): factory VrWidgetRenderer`

### Task 2 — Portar widgets estructurados a uikit (lote 1: table, checklist, code, terminal, json, diff)

**Files:** Create: `kali-web/src/vr/widgets/VrTable.tsx`, `VrChecklist.tsx`, `VrCode.tsx`, etc.

Ejemplo `VrTable` (Yoga):

```tsx
import { Container, Text } from '@react-three/uikit';
export function VrTable({ev}){
  const {data}=parseContent(ev); const rows=(data as any).rows||[];
  return <Container flexDirection="column" padding={8} gap={4}>
    <Container flexDirection="row">{Object.keys(rows[0]).map(c=> <Text key={c} fontSize={10} color="#38bdf8">{c}</Text>)}</Container>
    <Container flexDirection="column" overflow="scroll" maxHeight={300}>
      {rows.map(r=> <Container key={r.id} flexDirection="row">{Object.values(r).map(v=> <Text>{String(v)}</Text>)}</Container>)}
    </Container>
  </Container>
}
```

`VrChecklist` usa `Container hover` + `onClick` para toggle (emite `onAction` que hace `chat.sendEvent` o local).
**Validation:** `npm run build` + debug launcher `table`/`checklist` se ve con grid/bordes y scroll con stick.
**Commit:** `feat(vr): VrTable/Checklist/Code con scroll uikit`

### Task 3 — Scroll y layout base

**Files:** Modify: `kali-web/src/vr/VREntry.tsx:Widget2DPanel`, `kali-web/src/vr/widgets/*`

**Objective:** Todos los `Vr*` van dentro de `Container overflow="scroll"` con `maxHeight 300` (Yoga). El panel externo `GripGrab` da el marco `0.86×0.58m`; dentro el `Container` hace scroll con `thumbstick` (capturar `onScroll` del `Interactive`). Añadir `Scrollbar` visual `uikit`.

**Step:** Probar con `debug → Spawn todos (23)` — 6 paneles, cada uno scrollable sin solaparse (usa `VRPanel` cursor Y secuencial ya existente).
**Commit:** `feat(vr): scroll Yoga en Vr*`

### Task 4 — Widgets restantes (lote 2: chart, mermaid, qr, link, image, entity, quiz, document...)

**Files:** Create: `VrChart.tsx` (usa `Container` barras + `Text`), `VrMermaid.tsx` (rasteriza SVG a `CanvasTexture` vía `mermaid.render` offscreen, no DOM), `VrQr.tsx` (`qrcode` lib → `CanvasTexture`), `VrImage.tsx` ( `<Image>` de `uikit` con `crossOrigin`, fallback placeholder si CORS), `VrQuiz.tsx` (`Container` con `onClick` por opción).

**Validation:** debug launchers para cada tipo: `chart` barras, `qr` escaneable, `quiz` clickea opción y emite evento.
**Commit:** `feat(vr): VrChart/Mermaid/Qr/Image/Quiz fiels`

### Task 5 — HTML vivo con three-html-render

**Files:** Create: `kali-web/src/vr/widgets/VrHtml.tsx`

```tsx
import { HTMLTexture, InteractionManager } from 'three-html-render';
export function VrHtml({ev}){
  const ref=useRef<HTMLDivElement>(null);
  const [tex,setTex]=useState<THREE.Texture|null>(null);
  useEffect(()=>{
    if(!ref.current) return;
    ref.current.innerHTML = typeof parseContent(ev).data==='string' ? parseContent(ev).data as string : ev.content!;
    const t=new HTMLTexture(ref.current); // polyfill captura
    t.needsUpdate=true; setTex(t);
    return()=>t.dispose();
  },[ev.content]);
  // + InteractionManager para raycast
}
```

El `div` vive en `document.body -10000px` pero `HTMLTexture` lo pinta nativo; `InteractionManager.connect(renderer,camera).add(mesh)` hace que `trigger` envíe `click` al DOM. Toggle `preview↔código` ya no es raster, es swap de `innerHTML`.

**Validation:** `debug → html` muestra `<h1>` azul, lista y `const x=1` con estilos, y el botón dentro del html es clickeable con ray.
**Commit:** `feat(vr): VrHtml vivo con HTMLTexture`

### Task 6 — Integrar en Widget2DPanel y eliminar HtmlTexturePanel

**Files:** Modify: `kali-web/src/vr/VREntry.tsx:Widget2DPanel` (reemplazar `HtmlTexturePanel` por `VrWidgetRenderer` dentro de `<Container>` uikit), Delete: `kali-web/src/vr/HtmlTexturePanel.tsx` (o dejar como `legacy`).

Branch `isImmersive` ahora:

```tsx
<Container width={520} height={340} backgroundColor="#0b0f14" borderRadius={8} overflow="scroll">
  <VrWidgetRenderer ev={ev} onAction={handleAction} />
</Container>
```

Lobby sigue con `<Html transform>`.

**Validation:** `tsc --noEmit`, `vitest 77/77`, `build` <15s, `curl /src/vr/VREntry.tsx` ya no menciona `toCanvas`.
**Commit:** `refactor(vr): Widget2DPanel usa VrWidgetRenderer uikit`

### Task 7 — Interacción por elemento y persistencia

**Files:** Modify: `kali-web/src/vr/widgets/VrChecklist.tsx`, `VrQuiz.tsx`, etc.

Cada widget que es interactivo emite `onAction` → `chat.sendEvent({event:"artifact_action", id, action})` o muta local `setArtifactContent` para demo. Grip sigue moviendo el panel entero, trigger ahora hace hit-test en el `Container` hijo (uikit ya lo hace).

**Validation:** en Quest, checklist tildar, quiz seleccionar, tabla sort (si se añade) funcionan sin teclado.
**Commit:** `feat(vr): interactividad por elemento`

### Task 8 — QA con debug launchers + fresh-clone

**Files:** None (test)

Run: `vitest`, `tsc`, `build`, `git pull fresh-clone`, `curl` checks, probar en Quest los 23 launchers (`Panel debug → Spawn todos`), verificar locomotion (stick), Y/X, grip, scroll.

**Risks & mitigations:**
- `uikit` pide `fiber@9` → pin a `1.0.x` o usar `drei` `ScrollArea` como fallback.
- `three-html-render` polyfill debe instalarse antes de `Canvas` o rompe XR (ya pasó en `4a91749`) → test en `fresh-clone` con `curl` que `installHtmlInCanvasPolyfill` está en `main.tsx`.
- `mermaid`/`qrcode` raster en worker para no bloquear main thread → usar `OffscreenCanvas`.
- Memoria: 6 `CanvasTexture` 602×406 ≈ 5.6MB → OK, pero limitar a 6 paneles visibles (ya existe `slice(0,6)`).

**Open questions:**
- ¿`html` con `<script>` debe ejecutarse? `HTMLTexture` lo ejecuta, `uikit` no. Decisión: sandbox `iframe` para html con JS, o solo preview estático.
- ¿Scroll con thumbstick vs ray drag? `uikit` soporta ambos; elegir uno para no duplicar.

---
*Plan guardado para implementar con TDD, commits atómicos y validación en `fresh-clone` (`https://192.168.1.14:8444/#/vr`).*
