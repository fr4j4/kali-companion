/* ============================================================
   SINGULARITY V5 — WIDGETS
   T1: Real interactions for all 20 artifact types
   Uses: marked (markdown), mermaid (diagrams), shiki (code highlight)
   ============================================================ */

const WIDGETS = {};

/* --- Helper: real clipboard copy --- */
async function clipCopy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      btn.classList.add('text-ok');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('text-ok'); }, 1500);
    }
    if (window.showToast) showToast('Copiado al portapapeles', 'ok');
  } catch(e) {
    if (window.showToast) showToast('No se pudo copiar', 'err');
  }
}
window.clipCopy = clipCopy;

/* --- Helper: copy button HTML --- */
function copyBtn(getter, tip) {
  const id = 'cp' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const b = document.getElementById(id);
    if (b) b.onclick = () => clipCopy(typeof getter === 'function' ? getter() : getter, b);
  }, 0);
  return '<button id="' + id + '" class="tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center" data-tip="' + (tip||'Copiar') + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
}
window.copyBtn = copyBtn;

/* --- Helper: download button HTML --- */
function downloadBtn(content, filename, tip) {
  const id = 'dl' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const b = document.getElementById(id);
    if (b) b.onclick = () => {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      if (window.showToast) showToast('Descargado: ' + filename, 'ok');
    };
  }, 0);
  return '<button id="' + id + '" class="tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center" data-tip="' + (tip||'Descargar') + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg></button>';
}
window.downloadBtn = downloadBtn;

// ============================================================
// WIDGET DEFINITIONS
// Each returns: { width, height, icon, title, resizable, minW, minH, headerActions, body, init }
// `init(rootEl)` is called after the window is created for JS wiring
// ============================================================

const SAMPLE_CODE = `// Manejo robusto de errores
use tokio_tungstenite::accept_async;
use futures_util::StreamExt;

async fn handle(stream: TcpStream) {
    match accept_async(stream).await {
        Ok(ws) => {
            while let Some(msg) = ws.next().await {
                if let Ok(m) = msg {
                    ws.send(m).await.ok();
                }
            }
        }
        Err(e) => eprintln!("conn failed: {e}"),
    }
}`;

const SAMPLE_MD = `# Guia de Implementacion Event-Sourced

Esta guia describe como implementar un sistema **event-sourced** con proyecciones **CQRS**.

## Arquitectura

El sistema se divide en tres componentes:

- **Event Store**: append-only, inmutable
- **Proyecciones**: vistas materializadas para lectura
- **Command Handlers**: validan y producen eventos

### Event Store

El event store es la fuente de verdad. Cada evento es inmutable.

\`\`\`rust
record UserRegistered(
    string UserId,
    string Email,
    DateTime Timestamp
);
\`\`\`

> El event sourcing no es sobre guardar el estado actual, sino sobre como llegamos a el.

### Proyecciones

Las proyecciones se reconstruyen aplicando eventos en orden.

<div class="callout callout-warn">Los eventos deben ser inmutables. Nunca modifiques un evento ya persistido.</div>

## Implementacion

### Paso 1: Definir Eventos

1. Identificar agregados raiz
2. Definir eventos por agregado
3. Versionar eventos
4. Implementar upcasters

### Paso 2: Crear Event Store

Usa un store con soporte para optimistic concurrency.

<div class="callout callout-info">Recomendado: EventStoreDB o Postgres con tablas append-only.</div>

### Paso 3: Configurar Replay

El replay reconstruye el estado desde cero. Para sistemas grandes, usa **snapshots**.

## Testing

Para testing, usa \`event-store-testkit\`. Los tests basados en eventos son deterministas.

<div class="callout callout-tip">Los tests basados en eventos siempre reproducen el mismo error.</div>

## Conclusion

El event sourcing con CQRS es poderoso para auditoria completa y replay de estado.

Para mas info consulta la [documentacion oficial](#).`;

const SAMPLE_MERMAID = `flowchart TD
    A[Request] --> B{Autenticado?}
    B -->|no| C[401 Error]
    B -->|si| D[Process]
    D --> E[Response 200]
    A --> F[Log Event]`;

const SAMPLE_JSON = JSON.stringify({
  hero: {
    id: "cv.lyra", name: "Lyra", title: "La Silenciadora",
    tier: "S", stats: { attack: 847, speed: 92, intelligence: 68, defense: 54 },
    abilities: [
      { key: "Q", name: "Silence Blade", cd: 8 },
      { key: "W", name: "Shadow Step", cd: 12 },
      { key: "R", name: "Final Silence", cd: 90 }
    ],
    summonable: true, released_at: null
  }
}, null, 2);

const SAMPLE_LONGTEXT = `[14:32:01] Usuario: Kali, necesito que analices el log de errores del servidor de produccion.
[14:32:03] Kali: Entendido. Procedo a analizar el archivo de log. Examino las ultimas 24 horas.

[14:32:08] Kali: He detectado 3 patrones principales de error:

  1. NullPointerException en Handler.process() — 47 ocurrencias
     - Origen: linea 127 de src/handler.rs
     - Causa probable: response.unwrap() sin validacion
     - Impacto: caida del handler, reconexion del cliente

  2. Timeout en accept_async() — 12 ocurrencias
     - Origen: linea 89 de src/server.rs
     - Causa probable: saturacion del pool de conexiones
     - Impacto: clientes en espera, latencia elevada

  3. Panic en broadcast channel — 3 ocurrencias
     - Origen: linea 234 de src/hub.rs
     - Causa probable: receiver cerrado sin cleanup
     - Impacto: mensaje perdido, posible inconsistencia

[14:33:15] Usuario: Cual es el mas critico?
[14:33:17] Kali: El mas critico es el #1 (NullPointerException). Con 47 ocurrencias en 24 horas, representa el 78% de los errores.

Recomendacion inmediata: reemplazar response.unwrap() con response.ok_or(Error::Null)? para propagar el error sin causar panic.

[14:34:02] Usuario: Genera el patch.
[14:34:04] Kali: Generando diff patch para src/handler.rs...

--- analisis completo ---
total de errores: 62
errores criticos: 50 (81%)
errores no criticos: 12 (19%)
recomendacion: aplicar patch + aumentar pool de conexiones
tiempo estimado de fix: 15 minutos`;

const SAMPLE_TERMINAL_OUTPUT = [
  { t: 'prompt', text: 'cargo build --release' },
  { t: 'out', text: '  Compiling tokio-tungstenite v0.20.0' },
  { t: 'out', text: '  Compiling server v0.1.0 (/workspace)' },
  { t: 'warn', text: '  warning: unused variable: stream' },
  { t: 'warn', text: '    --> src/handler.rs:127:5' },
  { t: 'out', text: '    |' },
  { t: 'warn', text: '127 |     let data = response.unwrap();' },
  { t: 'out', text: '    |     ^^^^^ help: use ok_or instead' },
  { t: 'ok', text: '  Finished release [optimized] target(s) in 4.2s' },
  { t: 'prompt', text: './server --port 8080' },
  { t: 'out', text: '[INFO] Server listening on 0.0.0.0:8080' },
  { t: 'out', text: '[INFO] Waiting for connections...' },
  { t: 'ok', text: '[OK] Client connected from 127.0.0.1:54312' },
  { t: 'out', text: '[INFO] Message received: "ping"' },
  { t: 'out', text: '[INFO] Response sent: "pong"' },
  { t: 'err', text: '[ERROR] Client disconnected: Connection reset by peer' },
];

const QUIZ_QUESTIONS = [
  { q: 'Que ocurre cuando intentas usar una variable despues de pasarla con move semantics?', opts: [
    'El programa compila y la variable se clona automaticamente.',
    'El compilador lanza un error de borrow checker.',
    'La variable se convierte en referencia &T implicitamente.',
    'Rust realiza un deep copy del valor en runtime.' ], correct: 1,
    explain: 'El borrow checker detecta que el valor fue movido y no se puede usar despues.' },
  { q: 'Cual es la diferencia entre String y &str en Rust?', opts: [
    'String es heap-allocated y &str es una referencia a una secuencia de bytes.',
    'String es inmutable y &str es mutable.',
    'No hay diferencia, son alias.',
    'String solo funciona en unsafe code.' ], correct: 0,
    explain: 'String posee la memoria en el heap, &str es una referencia (slice) a bytes existentes.' },
  { q: 'Que hace Arc<T> en Rust?', opts: [
    'Compila codigo en tiempo de ejecucion.',
    'Proporciona concurrencia con conteo atomico de referencias.',
    'Crea una referencia circular.',
    'Es lo mismo que Rc<T>.' ], correct: 1,
    explain: 'Arc (Atomic Reference Counted) permite compartir ownership entre threads de forma segura.' },
];

const CHECKLIST_ITEMS = [
  { text: 'Definir eventos de dominio', done: true },
  { text: 'Crear event store append-only', done: true },
  { text: 'Implementar proyecciones de lectura', done: false },
  { text: 'Configurar replay y snapshots', done: false },
  { text: 'Escribir tests con event-store-testkit', done: false },
];

// ============================================================
// WIDGET BUILDERS
// ============================================================

WIDGETS.code = () => ({
  width: 380, height: 360, icon: '💻', title: 'server.rs', resizable: true, minW: 300, minH: 200,
  headerActions: copyBtn(SAMPLE_CODE, 'Copiar codigo'),
  body: '<div class="aw-code-container flex-1 overflow-hidden flex flex-col"></div>',
  init(root) {
    const container = root.querySelector('.aw-code-container');
    const lines = SAMPLE_CODE.split('\n');
    // Try shiki if available, fallback to plain
    if (window.shiki) {
      window.shiki.codeToHtml(SAMPLE_CODE, { lang: 'rust', theme: 'github-dark' }).then(html => {
        container.innerHTML = '<div class="flex text-xs font-mono leading-relaxed flex-1 overflow-hidden">' +
          '<div class="text-right text-muted/50 select-none py-3 px-2.5 border-r border-white/5 bg-white/[0.02] overflow-y-auto scrollbar-thin" style="min-width:34px;">' +
          lines.map((_, i) => '<div>' + (i + 1) + '</div>').join('') + '</div>' +
          '<div class="overflow-auto scrollbar-thin flex-1 py-3 px-3 shiki-code">' + html + '</div></div>';
      }).catch(() => { renderPlain(container, lines); });
    } else { renderPlain(container, lines); }
    function renderPlain(c, lns) {
      c.innerHTML = '<div class="flex text-xs font-mono leading-relaxed flex-1 overflow-hidden">' +
        '<div class="text-right text-muted/50 select-none py-3 px-2.5 border-r border-white/5 bg-white/[0.02] overflow-y-auto scrollbar-thin" style="min-width:34px;">' +
        lns.map((_, i) => '<div>' + (i + 1) + '</div>').join('') + '</div>' +
        '<pre class="m-0 py-3 px-3 text-fg/90 overflow-auto scrollbar-thin flex-1">' + escHtml(SAMPLE_CODE) + '</pre></div>';
    }
    // Status bar
    const sb = document.createElement('div');
    sb.className = 'flex items-center justify-between px-3.5 py-2 bg-white/[0.02] border-t border-white/8 shrink-0';
    sb.innerHTML = '<div class="flex items-center gap-3 badge text-muted"><span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-ok"></span>rust</span><span>' + lines.length + ' lineas</span></div><span class="badge text-muted">UTF-8</span>';
    root.querySelector('.aw-body').appendChild(sb);
  }
});

WIDGETS.hero = () => ({
  width: 280, height: null, icon: '🛡️', title: 'ficha_lyra', resizable: true, minW: 240, minH: 300,
  body: '<div class="aw-hero-container p-5 space-y-4 overflow-y-auto scrollbar-thin flex-1"></div>',
  init(root) {
    const c = root.querySelector('.aw-hero-container');
    c.innerHTML = `
      <div class="relative h-2 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 shrink-0 -mx-5 -mt-5 mb-4 rounded-t-2xl"></div>
      <div class="flex items-center gap-3.5">
        <div class="relative w-14 h-14 rounded-xl bg-gradient-to-br from-pink-500/30 to-purple-600/30 border border-pink-400/25 flex items-center justify-center shrink-0">
          <div class="absolute inset-0 opacity-40 rounded-xl" style="background:radial-gradient(circle at 50% 30%,#f472b6,transparent 70%);"></div>
          <span class="relative font-serif text-2xl text-pink-200" style="font-family:Fraunces;">L</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-0.5"><h3 class="font-semibold text-fg truncate">Lyra</h3><span class="badge px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-300">S-TIER</span></div>
          <p class="text-[11px] text-muted">La Silenciadora</p><p class="text-[10px] text-faint mt-0.5">Crimson Vale · Asesina</p>
        </div>
      </div>
      <div><div class="badge text-muted mb-2">atributos</div><div class="grid grid-cols-3 gap-2">
        <div class="bg-white/[0.04] rounded-lg px-2 py-2 border border-white/5 text-center"><div class="text-[9px] text-muted uppercase mb-0.5">ATK</div><div class="font-mono text-sm font-semibold">847</div></div>
        <div class="bg-white/[0.04] rounded-lg px-2 py-2 border border-white/5 text-center"><div class="text-[9px] text-muted uppercase mb-0.5">SPD</div><div class="font-mono text-sm font-semibold">92</div></div>
        <div class="bg-white/[0.04] rounded-lg px-2 py-2 border border-white/5 text-center"><div class="text-[9px] text-muted uppercase mb-0.5">INT</div><div class="font-mono text-sm font-semibold">68</div></div>
      </div></div>
      <div><div class="badge text-muted mb-1.5">lore</div>
        <p class="text-[11px] text-fg/70 italic leading-relaxed" style="font-family:Fraunces;">"La sombra que silencia la tormenta antes del primer golpe. Nacida en Crimson Vale, juro que ningun grito cruzaria sus fronteras."</p>
      </div>
      <div><div class="badge text-muted mb-2">habilidades</div><div class="space-y-1.5">
        ${[ {k:'Q',n:'Silence Blade',d:'Silencia 2s · CD 8s',desc:'Lanza una daga silenciosa que neutraliza la magia del objetivo durante 2 segundos. Si golpea por la espalda, aplica 1.5x dano critico.'},
           {k:'W',n:'Shadow Step',d:'Teletransporte · CD 12s',desc:'Se teletransporta hasta 8 metros en cualquier direccion, dejando una silueta que explota despues de 1.5s causando dano en area.'},
           {k:'R',n:'Final Silence',d:'Ultimate · CD 90s',desc:'Silencia absoluta durante 5 segundos en un radio de 12 metros. Ninguna habilidad magica puede activarse. Lyra gana 30% de velocidad.'}
        ].map(a => `
          <details class="bg-white/[0.03] border border-white/5 rounded-lg overflow-hidden">
            <summary class="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer list-none">
              <div class="w-6 h-6 rounded-md ${a.k==='Q'?'bg-pink-500/15':a.k==='W'?'bg-purple-500/15':'bg-indigo-500/15'} flex items-center justify-center text-[10px] shrink-0">${a.k}</div>
              <div class="flex-1 min-w-0"><div class="text-[11px] font-medium truncate">${a.n}</div><div class="text-[9px] text-muted">${a.d}</div></div>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted"><path d="m6 9 6 6 6-6"/></svg>
            </summary>
            <div class="px-3 pb-2 text-[10px] text-muted leading-relaxed">${a.desc}</div>
          </details>`).join('')}
      </div></div>
      <div><div class="badge text-muted mb-1.5">sinergias</div><div class="flex gap-1.5 flex-wrap">
        <span class="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300">Crimson Vale</span>
        <span class="text-[9px] px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300">Silencio</span>
        <span class="text-[9px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">Movilidad</span>
      </div></div>
      <button class="aw-summon w-full py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-bold shadow-lg shadow-pink-500/20 transition hover:brightness-110 hover-lift flex items-center justify-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7M12 19V5"/></svg>INVOCAR A LYRA
      </button>`;
    const summon = root.querySelector('.aw-summon');
    if (summon) summon.onclick = () => { if (window.showToast) showToast('Invocando a Lyra...', 'info'); };
  }
});

WIDGETS.img = () => ({
  width: 260, height: null, icon: '🖼️', title: 'concept_lyra.png', resizable: false,
  body: '<div class="aw-img-container rounded-2xl overflow-hidden flex flex-col"></div>',
  init(root) {
    const c = root.querySelector('.aw-img-container');
    c.innerHTML = `
      <div class="aw-img-viewer relative aspect-square bg-gradient-to-br from-rose-950 via-purple-950 to-indigo-950 overflow-hidden cursor-zoom-in">
        <div class="absolute inset-0 opacity-60" style="background:radial-gradient(circle at 60% 40%,rgba(244,114,182,0.3),transparent 50%),radial-gradient(circle at 30% 70%,rgba(167,139,250,0.2),transparent 45%);"></div>
        <div class="absolute inset-0 flex items-center justify-center"><div class="w-0.5 h-32 bg-gradient-to-b from-transparent via-pink-300/50 to-transparent rounded-full" style="box-shadow:0 0 25px rgba(244,114,182,0.5);"></div></div>
        <div class="absolute inset-0" style="background-image:radial-gradient(rgba(255,255,255,0.04) 1px,transparent 0);background-size:3px 3px;"></div>
        <div class="absolute top-2 left-2 badge text-white/50 bg-black/40 px-2 py-1 rounded">concept_v1</div>
      </div>
      <div class="px-3 py-2.5 flex items-center justify-between bg-black/40 border-t border-white/5">
        <div class="min-w-0"><div class="text-[11px] text-fg/80 truncate">concept_lyra.png</div><div class="badge text-muted mt-0.5">1024x1024 · 2.4MB</div></div>
        <button class="aw-img-open px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-accent transition shrink-0">Abrir</button>
      </div>`;
    const viewer = root.querySelector('.aw-img-viewer');
    const openBtn = root.querySelector('.aw-img-open');
    const openLightbox = () => {
      const lb = document.createElement('div');
      lb.className = 'fixed inset-0 z-[10002] bg-black/90 flex items-center justify-center cursor-zoom-out';
      lb.innerHTML = '<div class="relative w-[80vw] h-[80vh] bg-gradient-to-br from-rose-950 via-purple-950 to-indigo-950 rounded-2xl overflow-hidden"><div class="absolute inset-0 opacity-60" style="background:radial-gradient(circle at 60% 40%,rgba(244,114,182,0.3),transparent 50%),radial-gradient(circle at 30% 70%,rgba(167,139,250,0.2),transparent 45%);"></div><div class="absolute inset-0 flex items-center justify-center"><div class="w-1 h-48 bg-gradient-to-b from-transparent via-pink-300/50 to-transparent rounded-full" style="box-shadow:0 0 30px rgba(244,114,182,0.5);"></div></div><div class="absolute top-4 right-4 text-white/60 text-sm">Click para cerrar</div></div>';
      lb.onclick = () => lb.remove();
      document.body.appendChild(lb);
    };
    if (viewer) viewer.onclick = openLightbox;
    if (openBtn) openBtn.onclick = openLightbox;
  }
});

WIDGETS.link = () => ({
  width: 300, height: null, icon: '🔗', title: 'enlace', resizable: false,
  body: `<a class="block p-4 hover:bg-white/[0.02] transition" href="https://crimsonvale.wiki/heroes/lyra" target="_blank" rel="noopener">
    <div class="flex items-start gap-3">
      <div class="w-11 h-11 rounded-xl bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg truncate mb-0.5">Wiki Oficial — Crimson Vale</div>
        <div class="text-[11px] text-muted line-clamp-2 leading-relaxed mb-2">Documentacion completa de heroes, builds, lore y mecanicas de juego. Actualizado al parche 3.4.</div>
        <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-sm bg-accent/30"></div><span class="badge text-muted truncate">crimsonvale.wiki/heroes/lyra</span></div>
      </div>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-faint shrink-0 mt-1"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
    </div></a>`
});

WIDGETS.markdown = () => ({
  width: 420, height: 500, icon: '📝', title: 'guia_implementacion.md', resizable: true, minW: 320, minH: 280,
  headerActions: copyBtn(SAMPLE_MD, 'Copiar MD') + downloadBtn(SAMPLE_MD, 'guia.md', 'Descargar .md'),
  body: '<div class="aw-md-container flex flex-1 overflow-hidden"></div>',
  init(root) {
    const c = root.querySelector('.aw-md-container');
    // TOC sidebar
    const toc = document.createElement('div');
    toc.className = 'w-32 shrink-0 border-r border-white/5 p-3 overflow-y-auto scrollbar-thin';
    toc.innerHTML = '<div class="badge text-muted mb-2">contenidos</div><div class="space-y-1 text-[10px] aw-toc"></div>';
    c.appendChild(toc);
    // Content
    const content = document.createElement('div');
    content.className = 'prose-md flex-1 overflow-y-auto scrollbar-thin p-5 aw-md-content';
    c.appendChild(content);

    if (window.marked) {
      content.innerHTML = window.marked.parse(SAMPLE_MD);
      // Wire callouts: convert blockquote divs
      content.querySelectorAll('blockquote').forEach(bq => {
        const text = bq.textContent;
        if (text.includes('inmutables')) { bq.outerHTML = '<div class="callout callout-warn">' + text + '</div>'; }
        else if (text.includes('Recomendado')) { bq.outerHTML = '<div class="callout callout-info">' + text + '</div>'; }
        else if (text.includes('deterministas')) { bq.outerHTML = '<div class="callout callout-tip">' + text + '</div>'; }
      });
    } else {
      content.innerHTML = '<p style="color:var(--muted)">marked.js no cargado. Mostrando texto plano:</p><pre style="white-space:pre-wrap;font-size:12px;">' + escHtml(SAMPLE_MD) + '</pre>';
    }

    // Build TOC from headings
    const tocList = toc.querySelector('.aw-toc');
    const headings = content.querySelectorAll('h1, h2, h3');
    headings.forEach((h, i) => {
      h.id = 'md-sec-' + i;
      const a = document.createElement('a');
      a.className = 'block text-fg/60 hover:text-accent transition truncate';
      a.style.paddingLeft = (h.tagName === 'H1' ? 0 : h.tagName === 'H2' ? 8 : 16) + 'px';
      a.textContent = h.textContent;
      a.href = '#' + h.id;
      a.onclick = (e) => { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      tocList.appendChild(a);
    });
    if (headings.length === 0) toc.style.display = 'none';
  }
});

WIDGETS.mermaid = () => ({
  width: 400, height: 380, icon: '🔀', title: 'flow_auth.mmd', resizable: true, minW: 300, minH: 250,
  headerActions: copyBtn(SAMPLE_MERMAID, 'Copiar fuente') + downloadBtn(SAMPLE_MERMAID, 'flow.mmd', 'Descargar .mmd'),
  body: '<div class="aw-mermaid-container flex-1 overflow-auto scrollbar-thin p-4 flex items-center justify-center bg-white/[0.01]"></div>',
  init(root) {
    const c = root.querySelector('.aw-mermaid-container');
    if (window.mermaid) {
      window.mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: { primaryColor: 'rgba(34,211,238,0.1)', primaryTextColor: '#e2e8f0', primaryBorderColor: 'rgba(34,211,238,0.3)', lineColor: 'rgba(255,255,255,0.2)', secondaryColor: 'rgba(244,114,182,0.1)', tertiaryColor: 'rgba(129,140,248,0.1)' } });
      const id = 'mm-' + Date.now();
      window.mermaid.render(id, SAMPLE_MERMAID).then(res => {
        c.innerHTML = '<div class="mermaid-container">' + res.svg + '</div>';
        c.style.cursor = 'grab';
        // Pan
        let panning = false, px = 0, py = 0, sx = 0, sy = 0;
        const svg = c.querySelector('svg');
        if (svg) {
          let zoom = 1;
          c.onpointerdown = (e) => { panning = true; px = e.clientX; py = e.clientY; sx = parseInt(svg.style.translateX || 0); sy = parseInt(svg.style.translateY || 0); };
          c.onpointermove = (e) => { if (!panning) return; svg.style.transform = 'translate(' + (sx + e.clientX - px) + 'px,' + (sy + e.clientY - py) + 'px) scale(' + zoom + ')'; };
          c.onpointerup = () => panning = false;
          c.onwheel = (e) => { e.preventDefault(); zoom = Math.max(0.3, Math.min(3, zoom + (e.deltaY < 0 ? 0.1 : -0.1))); svg.style.transform = (svg.style.transform.replace(/scale\([^)]+\)/, '') || '') + ' scale(' + zoom + ')'; };
        }
      }).catch(() => { c.innerHTML = '<p style="color:var(--muted);text-align:center">Error renderizando Mermaid</p>'; });
    } else {
      c.innerHTML = '<p style="color:var(--muted);text-align:center">mermaid.js no cargado</p>';
    }
  }
});

WIDGETS.music = () => ({
  width: 320, height: null, icon: '🎵', title: 'now_playing', resizable: false,
  body: '<div class="aw-music p-5 space-y-4"></div>',
  init(root) {
    const c = root.querySelector('.aw-music');
    c.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="relative w-20 h-20 rounded-xl bg-gradient-to-br from-indigo-600/40 to-purple-600/40 border border-white/10 overflow-hidden shrink-0">
          <div class="absolute inset-0 opacity-50" style="background:radial-gradient(circle at 40% 40%,rgba(129,140,248,0.4),transparent 60%);"></div>
          <div class="absolute inset-0 flex items-center justify-center"><div class="w-6 h-6 rounded-full border-2 border-white/30"></div></div>
        </div>
        <div class="min-w-0 flex-1"><div class="text-sm font-semibold truncate">Shadow Pulse</div><div class="text-[11px] text-muted truncate">Crimson Vale OST · Vol 3</div><div class="badge text-faint mt-1">lossless · 320kbps</div></div>
      </div>
      <div>
        <div class="flex items-center gap-2 mb-1.5">
          <span class="badge text-muted aw-time-cur">0:00</span>
          <div class="aw-seek flex-1 h-1.5 bg-white/8 rounded-full cursor-pointer relative"><div class="aw-progress h-full bg-accent rounded-full" style="width:0%;"></div></div>
          <span class="badge text-muted">3:42</span>
        </div>
        <div class="flex items-end justify-center gap-0.5 h-8 mt-3 aw-visualizer">
          ${Array.from({length:24},(_,i)=>'<div class="music-bar w-1 bg-accent/60 rounded-full" style="height:100%;animation-delay:'+(i*40)+'ms;"></div>').join('')}
        </div>
      </div>
      <div class="flex items-center justify-center gap-4">
        <button class="w-9 h-9 rounded-full hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 19V5l-7 7 7 7zm7-14v14l-7-7 7-7z" transform="scale(-1,1) translate(-29,0)"/></svg></button>
        <button class="aw-play w-12 h-12 rounded-full bg-accent text-bg flex items-center justify-center shadow-lg shadow-accent/30 hover:brightness-110 transition">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="w-9 h-9 rounded-full hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 19V5l-7 7 7 7zm7-14v14l-7-7 7-7z"/></svg></button>
      </div>
      <div class="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted shrink-0"><path d="M11 5 6 9H2v6h4l5 4V5z"/></svg>
        <div class="aw-vol flex-1 h-1 bg-white/8 rounded-full cursor-pointer"><div class="h-full bg-muted rounded-full" style="width:65%;"></div></div>
        <span class="badge text-muted shrink-0">65%</span>
      </div>`;
    // Play/pause
    let playing = false;
    const playBtn = root.querySelector('.aw-play');
    const vis = root.querySelector('.aw-visualizer');
    const progress = root.querySelector('.aw-progress');
    const timeCur = root.querySelector('.aw-time-cur');
    let progressVal = 0;
    let timer = null;
    if (playBtn) playBtn.onclick = () => {
      playing = !playing;
      if (playing) {
        playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        vis.querySelectorAll('.music-bar').forEach(b => b.classList.remove('paused'));
        timer = setInterval(() => {
          progressVal = (progressVal + 0.5) % 100;
          progress.style.width = progressVal + '%';
          const sec = Math.floor(progressVal * 2.22);
          timeCur.textContent = Math.floor(sec/60) + ':' + String(sec%60).padStart(2,'0');
        }, 200);
      } else {
        playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        vis.querySelectorAll('.music-bar').forEach(b => b.classList.add('paused'));
        if (timer) clearInterval(timer);
      }
    };
    // Seek
    const seek = root.querySelector('.aw-seek');
    if (seek) seek.onclick = (e) => {
      const rect = seek.getBoundingClientRect();
      progressVal = ((e.clientX - rect.left) / rect.width) * 100;
      progress.style.width = progressVal + '%';
    };
  }
});

WIDGETS.longtext = () => ({
  width: 380, height: 420, icon: '📄', title: 'transcript_session.txt', resizable: true, minW: 280, minH: 200,
  headerActions: copyBtn(SAMPLE_LONGTEXT, 'Copiar') + downloadBtn(SAMPLE_LONGTEXT, 'transcript.txt', 'Descargar .txt'),
  body: '<div class="aw-longtext flex-1 overflow-hidden flex flex-col"></div>',
  init(root) {
    const c = root.querySelector('.aw-longtext');
    const lines = SAMPLE_LONGTEXT.split('\n');
    c.innerHTML = `
      <div class="aw-search-bar flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <input type="text" placeholder="Buscar..." class="aw-search-input flex-1 bg-transparent outline-none text-xs text-fg placeholder:text-muted">
        <span class="badge text-muted aw-search-count"></span>
      </div>
      <div class="aw-text-content flex-1 overflow-y-auto scrollbar-thin p-4" style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;line-height:1.6;color:rgba(226,232,240,0.7);">
        ${lines.map(l => '<div class="aw-line">' + escHtml(l) + '</div>').join('')}
      </div>
      <div class="flex items-center justify-between px-3.5 py-2 bg-white/[0.02] border-t border-white/8 shrink-0">
        <span class="badge text-muted">${SAMPLE_LONGTEXT.split(/\s+/).length} palabras · ${lines.length} lineas</span>
      </div>`;
    // Search
    const input = root.querySelector('.aw-search-input');
    const count = root.querySelector('.aw-search-count');
    const lineEls = root.querySelectorAll('.aw-line');
    if (input) input.oninput = () => {
      const q = input.value.toLowerCase();
      let matches = 0;
      lineEls.forEach(el => {
        if (!q) { el.style.background = ''; el.innerHTML = escHtml(el.textContent); }
        else if (el.textContent.toLowerCase().includes(q)) {
          matches++;
          el.style.background = 'rgba(34,211,238,0.08)';
          const txt = el.textContent;
          const idx = txt.toLowerCase().indexOf(q);
          el.innerHTML = escHtml(txt.slice(0, idx)) + '<mark style="background:rgba(34,211,238,0.3);color:#fff;border-radius:2px;padding:0 1px;">' + escHtml(txt.slice(idx, idx + q.length)) + '</mark>' + escHtml(txt.slice(idx + q.length));
        } else { el.style.background = ''; el.innerHTML = escHtml(el.textContent); }
      });
      count.textContent = q ? matches + ' matches' : '';
    };
  }
});

WIDGETS.chart = () => ({
  width: 360, height: 340, icon: '📊', title: 'latency_comparison', resizable: true, minW: 300, minH: 250,
  headerActions: downloadBtn('latency_data.csv', 'data.csv', 'Exportar CSV'),
  body: '<div class="aw-chart flex-1 overflow-hidden flex flex-col p-4 relative"></div>',
  init(root) {
    const c = root.querySelector('.aw-chart');
    const data = [
      { name: 'GPT-4o', lat: 142, tput: 85 }, { name: 'Claude', lat: 98, tput: 92 },
      { name: 'Llama', lat: 210, tput: 78 }, { name: 'Mistral', lat: 187, tput: 81 },
      { name: 'Gemini', lat: 155, tput: 88 }
    ];
    const maxLat = 250, maxTput = 100;
    const barW = 24, gap = 14, startY = 50;
    const chartH = 140;
    c.innerHTML = `
      <div class="flex items-center gap-4 mb-3 shrink-0">
        <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded bg-accent"></div><span class="badge text-muted cursor-pointer aw-toggle-lat">latencia (ms)</span></div>
        <div class="flex items-center gap-1.5"><div class="w-3 h-3 rounded bg-accent3"></div><span class="badge text-muted cursor-pointer aw-toggle-tput">throughput (tok/s)</span></div>
      </div>
      <svg viewBox="0 0 340 ${chartH + 40}" class="w-full flex-1 aw-chart-svg">
        <line x1="40" y1="${chartH + 20}" x2="330" y2="${chartH + 20}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <line x1="40" y1="10" x2="40" y2="${chartH + 20}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        ${[0, 50, 100, 150, 200, 250].map(v => { const y = chartH + 20 - (v / maxLat) * chartH; return '<text x="35" y="' + y + '" text-anchor="end" font-size="8" fill="#64748b">' + v + '</text><line x1="40" y1="' + y + '" x2="330" y2="' + y + '" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>'; }).join('')}
        ${data.map((d, i) => {
          const x = 55 + i * (barW + gap * 2);
          const latH = (d.lat / maxLat) * chartH;
          const tputH = (d.tput / maxTput) * chartH;
          return '<rect class="chart-bar aw-lat-bar" x="' + x + '" y="' + (chartH + 20 - latH) + '" width="' + barW + '" height="' + latH + '" rx="3" fill="rgba(34,211,238,0.5)" data-name="' + d.name + '" data-val="' + d.lat + 'ms"/>' +
                 '<rect class="chart-bar aw-tput-bar" x="' + (x + barW + 2) + '" y="' + (chartH + 20 - tputH) + '" width="' + barW + '" height="' + tputH + '" rx="3" fill="rgba(244,114,182,0.4)" data-name="' + d.name + '" data-val="' + d.tput + ' tok/s"/>' +
                 '<text x="' + (x + barW) + '" y="' + (chartH + 35) + '" text-anchor="middle" font-size="8" fill="#64748b">' + d.name + '</text>';
        }).join('')}
      </svg>
      <div class="px-3 py-2 bg-white/[0.02] border-t border-white/8 shrink-0 flex items-center justify-between mt-auto">
        <span class="badge text-muted">5 modelos · recomendado: <span class="text-accent">Llama 3.1</span></span>
      </div>`;
    // Tooltip
    const svg = root.querySelector('.aw-chart-svg');
    const tt = document.createElement('div');
    tt.className = 'chart-tooltip'; tt.style.display = 'none';
    c.appendChild(tt);
    svg.querySelectorAll('.chart-bar').forEach(bar => {
      bar.addEventListener('pointerenter', (e) => {
        tt.textContent = bar.dataset.name + ': ' + bar.dataset.val;
        tt.style.display = 'block';
      });
      bar.addEventListener('pointermove', (e) => {
        tt.style.left = (e.clientX - c.getBoundingClientRect().left + 10) + 'px';
        tt.style.top = (e.clientY - c.getBoundingClientRect().top - 20) + 'px';
      });
      bar.addEventListener('pointerleave', () => { tt.style.display = 'none'; });
    });
    // Legend toggle
    const latBars = svg.querySelectorAll('.aw-lat-bar');
    const tputBars = svg.querySelectorAll('.aw-tput-bar');
    root.querySelector('.aw-toggle-lat').onclick = () => { latBars.forEach(b => b.style.opacity = b.style.opacity === '0' ? '1' : '0'); };
    root.querySelector('.aw-toggle-tput').onclick = () => { tputBars.forEach(b => b.style.opacity = b.style.opacity === '0' ? '1' : '0'); };
  }
});

WIDGETS.json = () => ({
  width: 360, height: 420, icon: '🗂️', title: 'api_response.json', resizable: true, minW: 280, minH: 200,
  headerActions: copyBtn(SAMPLE_JSON, 'Copiar JSON') + '<button class="aw-json-expand tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center" data-tip="Expandir todo"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button><button class="aw-json-collapse tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center" data-tip="Colapsar todo"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg></button>',
  body: '<div class="aw-json flex-1 overflow-hidden flex flex-col"></div>',
  init(root) {
    const c = root.querySelector('.aw-json');
    function buildTree(obj, key, isLast) {
      const id = 'j' + Math.random().toString(36).slice(2, 7);
      if (obj === null) return '<div><span class="json-key">"' + key + '"</span>: <span class="json-null">null</span>' + (isLast ? '' : ',') + '</div>';
      if (typeof obj !== 'object') {
        let cls = 'json-num', val = obj;
        if (typeof obj === 'string') { cls = 'json-string'; val = '"' + obj + '"'; }
        if (typeof obj === 'boolean') { cls = 'json-bool'; }
        return '<div><span class="json-key">"' + key + '"</span>: <span class="' + cls + '">' + val + '</span>' + (isLast ? '' : ',') + '</div>';
      }
      const keys = Object.keys(obj);
      const isArray = Array.isArray(obj);
      const open = isArray ? '[' : '{';
      const close = isArray ? ']' : '}';
      let inner = '';
      keys.forEach((k, i) => { inner += buildTree(obj[k], isArray ? i : k, i === keys.length - 1); });
      return '<div><span class="json-toggle open" data-target="' + id + '"></span><span class="json-key">"' + key + '"</span>: ' + open + '</div><div id="' + id + '" style="padding-left:16px;">' + inner + '</div><div>' + close + (isLast ? '' : ',') + '</div>';
    }
    const parsed = JSON.parse(SAMPLE_JSON);
    c.innerHTML = '<div class="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-white/[0.02] text-[9px] text-muted font-mono">GET /api/v2/hero/lyra</div><div class="flex-1 overflow-auto scrollbar-thin p-3 font-mono text-[11px] leading-relaxed">' + buildTree(parsed, 'root', true) + '</div><div class="px-3 py-2 bg-white/[0.02] border-t border-white/8 shrink-0 flex items-center justify-between"><span class="badge text-muted">hero.lyra · v2</span><span class="badge text-ok">200 OK</span></div>';
    // Toggle
    c.querySelectorAll('.json-toggle').forEach(t => {
      t.onclick = () => {
        t.classList.toggle('open');
        const target = document.getElementById(t.dataset.target);
        if (target) target.style.display = t.classList.contains('open') ? 'block' : 'none';
      };
    });
    // Expand/collapse all
    const expandBtn = root.querySelector('.aw-json-expand');
    const collapseBtn = root.querySelector('.aw-json-collapse');
    if (expandBtn) expandBtn.onclick = () => { c.querySelectorAll('.json-toggle').forEach(t => { t.classList.add('open'); const tg = document.getElementById(t.dataset.target); if (tg) tg.style.display = 'block'; }); };
    if (collapseBtn) collapseBtn.onclick = () => { c.querySelectorAll('.json-toggle').forEach(t => { t.classList.remove('open'); const tg = document.getElementById(t.dataset.target); if (tg) tg.style.display = 'none'; }); };
  }
});

WIDGETS.terminal = () => ({
  width: 380, height: 360, icon: '🖥️', title: 'terminal · bash', resizable: true, minW: 280, minH: 200,
  body: '<div class="aw-term flex-1 overflow-hidden flex flex-col bg-black/40"></div>',
  init(root) {
    const c = root.querySelector('.aw-term');
    const out = document.createElement('div');
    out.className = 'aw-term-out flex-1 overflow-y-auto scrollbar-thin p-3';
    c.appendChild(out);

    function appendLine(t, text) {
      const div = document.createElement('div');
      div.className = 'term-line';
      if (t === 'prompt') div.innerHTML = '<span class="term-prompt">kali@workspace:~$</span> <span class="term-out">' + escHtml(text) + '</span>';
      else div.innerHTML = '<span class="term-' + t + '">' + escHtml(text) + '</span>';
      out.appendChild(div);
      out.scrollTop = out.scrollHeight;
    }

    SAMPLE_TERMINAL_OUTPUT.forEach(l => appendLine(l.t, l.text));

    // Input line
    const inputLine = document.createElement('div');
    inputLine.className = 'term-line flex items-center gap-1 p-3 border-t border-white/5';
    inputLine.innerHTML = '<span class="term-prompt">kali@workspace:~$</span> ';
    const input = document.createElement('input');
    input.className = 'term-input flex-1';
    input.setAttribute('aria-label', 'Terminal input');
    inputLine.appendChild(input);
    c.appendChild(inputLine);

    const history = [];
    let histIdx = -1;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = input.value.trim();
        if (!cmd) return;
        history.push(cmd); histIdx = history.length;
        appendLine('prompt', cmd);
        input.value = '';
        // Fake response
        setTimeout(() => {
          if (cmd === 'ls') { appendLine('out', 'src/  Cargo.toml  target/  README.md'); }
          else if (cmd === 'help') { appendLine('out', 'Comandos: ls, pwd, cargo build, clear, help'); }
          else if (cmd === 'pwd') { appendLine('out', '/workspace'); }
          else if (cmd === 'clear') { out.innerHTML = ''; }
          else if (cmd.startsWith('cargo')) { appendLine('ok', '  Compiling...'); appendLine('ok', '  Finished in 4.2s'); }
          else { appendLine('err', '  command not found: ' + cmd); }
        }, 300);
      } else if (e.key === 'ArrowUp') { e.preventDefault(); if (histIdx > 0) { histIdx--; input.value = history[histIdx]; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (histIdx < history.length - 1) { histIdx++; input.value = history[histIdx]; } else { histIdx = history.length; input.value = ''; } }
    });
  }
});

WIDGETS.checklist = () => ({
  width: 300, height: null, icon: '✅', title: 'tareas_implementacion', resizable: true, minW: 240, minH: 200,
  body: '<div class="aw-checklist p-4 space-y-3 overflow-y-auto scrollbar-thin flex-1"></div>',
  init(root) {
    const c = root.querySelector('.aw-checklist');
    function render() {
      const done = CHECKLIST_ITEMS.filter(i => i.done).length;
      const pct = Math.round((done / CHECKLIST_ITEMS.length) * 100);
      c.innerHTML = `
        <div class="flex items-center justify-between"><span class="text-sm font-semibold">Implementacion Event-Sourced</span><span class="badge text-accent">${done}/${CHECKLIST_ITEMS.length}</span></div>
        <div class="h-1.5 bg-white/8 rounded-full overflow-hidden"><div class="h-full bg-accent rounded-full transition-all duration-300" style="width:${pct}%;"></div></div>
        <div class="space-y-2 pt-1">
          ${CHECKLIST_ITEMS.map((item, i) => `
            <div class="check-item ${item.done ? 'done' : ''} flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-white/5 cursor-pointer" data-idx="${i}">
              <div class="check-box w-4 h-4 rounded border-2 ${item.done ? 'border-accent bg-accent' : 'border-white/20'} flex items-center justify-center shrink-0">
                ${item.done ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#02040a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}
              </div>
              <span class="check-label text-xs ${item.done ? 'text-fg/60 line-through' : 'text-fg'}">${item.text}</span>
            </div>`).join('')}
        </div>
        <div class="aw-add-task flex items-center gap-2">
          <input type="text" placeholder="Nueva tarea..." class="aw-new-task flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50 transition">
          <button class="aw-add-btn w-7 h-7 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition flex items-center justify-center shrink-0"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>
        </div>`;
      // Wire toggles
      c.querySelectorAll('.check-item').forEach(el => {
        el.onclick = () => {
          const idx = parseInt(el.dataset.idx);
          CHECKLIST_ITEMS[idx].done = !CHECKLIST_ITEMS[idx].done;
          render();
          if (window.pushUndo) window.pushUndo({ type: 'checklist-toggle', idx, prev: !CHECKLIST_ITEMS[idx].done });
        };
      });
      // Add task
      const addBtn = c.querySelector('.aw-add-btn');
      const newTask = c.querySelector('.aw-new-task');
      const addTask = () => {
        const v = newTask.value.trim();
        if (!v) return;
        CHECKLIST_ITEMS.push({ text: v, done: false });
        newTask.value = '';
        render();
        if (window.showToast) showToast('Tarea anadida', 'ok');
      };
      if (addBtn) addBtn.onclick = addTask;
      if (newTask) newTask.onkeydown = (e) => { if (e.key === 'Enter') addTask(); };
    }
    render();
  }
});

WIDGETS.video = () => ({
  width: 360, height: null, icon: '🎬', title: 'tutorial_websocket.mp4', resizable: false,
  body: '<div class="aw-video video-container relative group bg-black rounded-b-2xl overflow-hidden"></div>',
  init(root) {
    const c = root.querySelector('.aw-video');
    c.innerHTML = `
      <div class="aspect-video relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center">
        <div class="absolute inset-0 opacity-30" style="background:radial-gradient(circle at 50% 50%,rgba(34,211,238,0.15),transparent 60%);"></div>
        <button class="aw-play-btn relative w-14 h-14 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center hover:bg-white/20 transition">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="absolute top-2 left-2 badge text-white/60 bg-black/50 px-2 py-1 rounded">HD 1080p</div>
      </div>
      <div class="video-controls absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
        <div class="aw-vseek h-1 bg-white/20 rounded-full mb-2 cursor-pointer"><div class="aw-vprogress h-full bg-accent rounded-full" style="width:23%;"></div></div>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <button class="aw-vplay text-white/80 hover:text-white transition"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
            <span class="badge text-white/60 aw-vtime">2:15 / 9:42</span>
          </div>
          <button class="aw-vfs text-white/60 hover:text-white transition"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
        </div>
      </div>`;
    let playing = false;
    const playBtn = root.querySelector('.aw-play-btn');
    const vplay = root.querySelector('.aw-vplay');
    const toggle = () => {
      playing = !playing;
      const icon = playing ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' : '<path d="M8 5v14l11-7z"/>';
      playBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="white">' + icon + '</svg>';
      vplay.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' + icon + '</svg>';
    };
    if (playBtn) playBtn.onclick = toggle;
    if (vplay) vplay.onclick = toggle;
    root.querySelector('.aw-vfs').onclick = () => { if (c.requestFullscreen) c.requestFullscreen(); };
    root.querySelector('.aw-vseek').onclick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      root.querySelector('.aw-vprogress').style.width = pct + '%';
    };
  }
});

WIDGETS.quiz = () => ({
  width: 320, height: null, icon: '❓', title: 'quiz_rust_ownership', resizable: false,
  body: '<div class="aw-quiz p-5 space-y-4"></div>',
  init(root) {
    const c = root.querySelector('.aw-quiz');
    let qIdx = 0;
    let score = 0;
    let answered = false;

    function render() {
      answered = false;
      const q = QUIZ_QUESTIONS[qIdx];
      c.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="badge text-muted">pregunta ${qIdx + 1} de ${QUIZ_QUESTIONS.length}</span>
          <div class="flex gap-1">
            ${QUIZ_QUESTIONS.map((_, i) => '<div class="quiz-score-dot w-1.5 h-1.5 rounded-full ' + (i < qIdx ? 'bg-ok' : i === qIdx ? 'bg-accent' : 'bg-white/10') + '"></div>').join('')}
          </div>
        </div>
        <div><div class="text-sm font-semibold mb-1">${q.q.split('?')[0]}?</div></div>
        <div class="space-y-2 aw-quiz-opts">
          ${q.opts.map((opt, i) => '<div class="quiz-option p-3 rounded-xl border border-white/8 text-[12px] text-fg/80" data-idx="' + i + '">' + escHtml(opt) + '</div>').join('')}
        </div>
        <div class="aw-quiz-explain hidden p-3 rounded-xl bg-white/[0.03] border border-white/8 text-[11px] text-muted leading-relaxed"></div>
        <div class="flex items-center justify-between pt-1">
          <span class="badge text-muted">score: <span class="text-accent">${score}</span></span>
          <button class="aw-quiz-next px-4 py-2 rounded-xl bg-accent text-bg text-xs font-semibold hover:bg-accent2 transition btn-glow opacity-50 cursor-not-allowed">Siguiente</button>
        </div>`;
      const opts = c.querySelectorAll('.quiz-option');
      const explain = c.querySelector('.aw-quiz-explain');
      const nextBtn = c.querySelector('.aw-quiz-next');
      opts.forEach(opt => {
        opt.onclick = () => {
          if (answered) return;
          answered = true;
          const idx = parseInt(opt.dataset.idx);
          if (idx === q.correct) { opt.classList.add('correct'); score++; if (window.showToast) showToast('Correcto!', 'ok'); }
          else { opt.classList.add('wrong'); opts[q.correct].classList.add('correct'); if (window.showToast) showToast('Incorrecto', 'err'); }
          explain.textContent = q.explain;
          explain.classList.remove('hidden');
          nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        };
      });
      if (nextBtn) nextBtn.onclick = () => {
        if (!answered) return;
        qIdx = (qIdx + 1) % QUIZ_QUESTIONS.length;
        if (qIdx === 0) { if (window.showToast) showToast('Quiz completado! Score: ' + score, 'ok'); score = 0; }
        render();
      };
    }
    render();
  }
});

WIDGETS.diff = () => ({
  width: 380, height: 340, icon: '🔧', title: 'fix_null_ptr.patch', resizable: true, minW: 300, minH: 200,
  headerActions: '<button class="aw-apply tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-ok transition flex items-center justify-center" data-tip="Aplicar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></button>',
  body: '<div class="aw-diff font-mono text-[11px] leading-relaxed flex-1 overflow-y-auto scrollbar-thin"></div>',
  init(root) {
    const c = root.querySelector('.aw-diff');
    const lines = [
      { f: 'src/handler.rs', type: 'file' },
      { t: 'del', text: 'let data = response.unwrap();' },
      { t: 'del', text: 'data.process();' },
      { t: 'add', text: 'let data = response.ok_or(Error::Null)?;' },
      { t: 'add', text: 'data.process()?;' },
      { t: 'ctx', text: '// proceso principal' },
      { t: 'ctx', text: 'return Ok(data);' },
      { f: 'src/server.rs', type: 'file' },
      { t: 'add', text: '.max_connections(1000)' },
    ];
    c.innerHTML = lines.map(l => {
      if (l.type === 'file') return '<div class="px-3 py-1.5 bg-white/[0.02] text-muted text-[9px] border-b border-white/5">' + l.f + '</div>';
      if (l.t === 'add') return '<div class="px-3 py-1 diff-add"><span class="text-green-400">+ </span><span class="text-fg">' + escHtml(l.text) + '</span></div>';
      if (l.t === 'del') return '<div class="px-3 py-1 diff-del"><span class="text-red-400">- </span><span class="text-fg/60">' + escHtml(l.text) + '</span></div>';
      return '<div class="px-3 py-1 bg-white/[0.01]"><span class="text-muted">  </span><span class="text-fg/50">' + escHtml(l.text) + '</span></div>';
    }).join('');
    // Status bar
    const sb = document.createElement('div');
    sb.className = 'flex items-center justify-between px-3 py-2 bg-white/[0.02] border-t border-white/8 shrink-0';
    sb.innerHTML = '<div class="flex items-center gap-2 badge"><span class="text-green-400">+3</span><span class="text-red-400">-2</span></div><span class="badge text-muted">2 archivos cambiados</span>';
    root.querySelector('.aw-body').appendChild(sb);
    // Apply
    const apply = root.querySelector('.aw-apply');
    if (apply) apply.onclick = () => { if (window.showToast) showToast('Patch aplicado correctamente', 'ok'); };
  }
});

WIDGETS.table = () => ({
  width: 380, height: 340, icon: '📋', title: 'comparativa_modelos.csv', resizable: true, minW: 300, minH: 200,
  headerActions: downloadBtn('modelo,latencia,tokens_s,costo\nGPT-4o,142,85,$$$\nClaude,98,92,$$$\nLlama,210,78,$\nMistral,187,81,$$\nGemini,155,88,$$\n', 'modelos.csv', 'Exportar CSV'),
  body: '<div class="aw-table flex-1 overflow-hidden flex flex-col"></div>',
  init(root) {
    const c = root.querySelector('.aw-table');
    let data = [
      { name: 'GPT-4o', lat: 142, tput: 85, cost: '$$$' },
      { name: 'Claude 3.5', lat: 98, tput: 92, cost: '$$$' },
      { name: 'Llama 3.1', lat: 210, tput: 78, cost: '$' },
      { name: 'Mistral L', lat: 187, tput: 81, cost: '$$' },
      { name: 'Gemini 1.5', lat: 155, tput: 88, cost: '$$' },
    ];
    let sortCol = null, sortAsc = true;

    function render() {
      const cols = [['name', 'Modelo'], ['lat', 'Latencia'], ['tput', 'Tokens/s'], ['cost', 'Costo']];
      c.innerHTML = `
        <div class="flex-1 overflow-auto scrollbar-thin">
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-white/[0.05] backdrop-blur">
              <tr class="text-left badge text-muted">
                ${cols.map(([key, label]) => '<th class="px-3 py-2 font-medium cursor-pointer hover:text-accent aw-sort" data-col="' + key + '">' + label + (sortCol === key ? (sortAsc ? ' \u2191' : ' \u2193') : ' \u2195') + '</th>').join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              ${data.map(d => '<tr class="hover:bg-white/[0.02] transition' + (d.name === 'Llama 3.1' ? ' bg-accent/[0.04]' : '') + '"><td class="px-3 py-2.5 font-medium ' + (d.name === 'Llama 3.1' ? 'text-accent' : '') + '">' + d.name + '</td><td class="px-3 py-2.5 text-right font-mono text-fg/80">' + d.lat + 'ms</td><td class="px-3 py-2.5 text-right font-mono text-fg/80">' + d.tput + '</td><td class="px-3 py-2.5 text-right font-mono ' + (d.cost === '$' ? 'text-ok' : d.cost === '$$$' ? 'text-warn' : '') + '">' + d.cost + '</td></tr>').join('')}
            </tbody>
          </table>
        </div>
        <div class="px-3 py-2 bg-white/[0.02] border-t border-white/8 shrink-0"><span class="badge text-muted">${data.length} filas · recomendado: <span class="text-accent">Llama 3.1</span></span></div>`;
      // Sort
      c.querySelectorAll('.aw-sort').forEach(th => {
        th.onclick = () => {
          const col = th.dataset.col;
          if (sortCol === col) sortAsc = !sortAsc;
          else { sortCol = col; sortAsc = true; }
          data.sort((a, b) => {
            const av = a[col], bv = b[col];
            if (typeof av === 'number') return sortAsc ? av - bv : bv - av;
            return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
          });
          render();
        };
      });
    }
    render();
  }
});

WIDGETS.controls = () => ({
  width: 280, height: null, icon: '🎛️', title: 'config_modelo', resizable: false,
  body: '<div class="aw-ctrl p-4 space-y-4"></div>',
  init(root) {
    const c = root.querySelector('.aw-ctrl');
    let temp = 0.7, tokens = 2048, stream = true, voice = false;
    function render() {
      c.innerHTML = `
        <div><div class="badge text-muted mb-1">panel de configuracion</div><div class="text-sm font-semibold">Parametros del Modelo</div></div>
        <div><div class="flex items-center justify-between mb-2"><span class="text-xs text-fg">Temperature</span><span class="font-mono text-xs text-accent aw-temp-val">${temp.toFixed(1)}</span></div>
          <div class="aw-slider relative h-1.5 bg-white/8 rounded-full" data-key="temp" data-min="0" data-max="2" data-val="${temp}"><div class="aw-s-fill h-full bg-accent rounded-full" style="width:${(temp / 2) * 100}%;"></div><div class="aw-s-knob absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-accent shadow-lg shadow-accent/30 border-2 border-bg" style="left:calc(${(temp / 2) * 100}% - 7px);"></div></div>
        </div>
        <div><div class="flex items-center justify-between mb-2"><span class="text-xs text-fg">Max Tokens</span><span class="font-mono text-xs text-accent aw-tokens-val">${tokens}</span></div>
          <div class="aw-slider relative h-1.5 bg-white/8 rounded-full" data-key="tokens" data-min="256" data-max="8192" data-val="${tokens}"><div class="aw-s-fill h-full bg-accent rounded-full" style="width:${(tokens / 8192) * 100}%;"></div><div class="aw-s-knob absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-accent shadow-lg shadow-accent/30 border-2 border-bg" style="left:calc(${(tokens / 8192) * 100}% - 7px);"></div></div>
        </div>
        <div class="flex items-center justify-between"><span class="text-xs text-fg">Stream Response</span><button class="aw-toggle relative w-10 h-5 rounded-full transition ${stream ? 'bg-accent' : 'bg-white/10'}"><div class="absolute top-0.5 ${stream ? 'right-0.5' : 'left-0.5'} w-4 h-4 rounded-full bg-white shadow transition-all"></div></button></div>
        <div class="flex items-center justify-between"><span class="text-xs text-fg">Auto-invocar voz</span><button class="aw-toggle relative w-10 h-5 rounded-full transition ${voice ? 'bg-accent' : 'bg-white/10'}"><div class="absolute top-0.5 ${voice ? 'right-0.5' : 'left-0.5'} w-4 h-4 rounded-full bg-white shadow transition-all"></div></button></div>
        <div><div class="text-xs text-fg mb-2">Modelo</div><div class="relative">
          <select class="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-fg outline-none focus:border-accent/50 transition cursor-pointer"><option>GPT-4o (actual)</option><option>Claude 3.5 Sonnet</option><option>Llama 3.1 70B</option></select>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"><path d="m6 9 6 6 6-6"/></svg>
        </div></div>
        <button class="aw-apply w-full py-2.5 rounded-xl bg-accent text-bg text-xs font-bold hover:bg-accent2 transition btn-glow hover-lift">Aplicar Cambios</button>`;
      // Sliders
      c.querySelectorAll('.aw-slider').forEach(s => {
        s.onpointerdown = (e) => {
          const rect = s.getBoundingClientRect();
          const min = parseFloat(s.dataset.min), max = parseFloat(s.dataset.max), key = s.dataset.key;
          const update = (e) => {
            let pct = (e.clientX - rect.left) / rect.width;
            pct = Math.max(0, Math.min(1, pct));
            const val = min + pct * (max - min);
            s.querySelector('.aw-s-fill').style.width = (pct * 100) + '%';
            s.querySelector('.aw-s-knob').style.left = 'calc(' + (pct * 100) + '% - 7px)';
            if (key === 'temp') { temp = val; c.querySelector('.aw-temp-val').textContent = val.toFixed(1); }
            else { tokens = Math.round(val); c.querySelector('.aw-tokens-val').textContent = tokens; }
          };
          update(e);
          const onMove = (ev) => update(ev);
          const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        };
      });
      // Toggles
      c.querySelectorAll('.aw-toggle').forEach((t, i) => {
        t.onclick = () => {
          if (i === 0) { stream = !stream; }
          else { voice = !voice; }
          render();
        };
      });
      // Apply
      const apply = c.querySelector('.aw-apply');
      if (apply) apply.onclick = () => { if (window.showToast) showToast('Configuracion aplicada', 'ok'); };
    }
    render();
  }
});

/* --- Helper: escape HTML --- */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.escHtml = escHtml;

window.WIDGETS = WIDGETS;