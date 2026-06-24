/* ============================================================
   SINGULARITY V5 — WORKSPACE ENGINE
   T0: Toasts, loading, tooltips, focus management
   T2: Drag/resize/snap, multi-select, undo/redo, keyboard,
       context menus, minimize, persist
   T3: Mobile, orb hub, metrics
   ============================================================ */

const WS = {};

// --- State ---
let zIndexCounter = 100;
let artifactIdCounter = 0;
let lastPosition = { x: 0, y: 0 };
let gridMode = false;
const artifacts = [];
const conversation = [];
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 50;
const selectedWindows = new Set();
let focusedEl = null;

// --- DOM refs (set on init) ---
let layer, projection, orb;

// ============================================================
// T0: TOAST SYSTEM
// ============================================================
function showToast(msg, type) {
  type = type || 'info';
  let container = document.getElementById('toast-container');
  if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icons = { ok: '\u2713', err: '\u2717', info: '\u2139', warn: '\u26a0' };
  t.innerHTML = '<span class="toast-icon" style="color:var(--' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : type === 'warn' ? 'warn' : 'accent') + ')">' + (icons[type] || '') + '</span><span>' + msg + '</span>';
  container.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 300); }, 3000);
}
window.showToast = showToast;

// ============================================================
// T0: TOOLTIP SYSTEM (JS-based)
// ============================================================
let ttEl = null, ttTimer = null;
function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    clearTimeout(ttTimer);
    ttTimer = setTimeout(() => {
      if (!ttEl) { ttEl = document.createElement('div'); ttEl.className = 'tt'; document.body.appendChild(ttEl); }
      ttEl.textContent = el.dataset.tip;
      const rect = el.getBoundingClientRect();
      let x = rect.left + rect.width / 2 - ttEl.offsetWidth / 2;
      let y = rect.top - ttEl.offsetHeight - 6;
      if (y < 0) y = rect.bottom + 6;
      if (x < 4) x = 4;
      if (x + ttEl.offsetWidth > window.innerWidth - 4) x = window.innerWidth - ttEl.offsetWidth - 4;
      ttEl.style.left = x + 'px';
      ttEl.style.top = y + 'px';
      ttEl.classList.add('visible');
    }, 400);
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.target.closest('[data-tip]')) return;
    clearTimeout(ttTimer);
    if (ttEl) ttEl.classList.remove('visible');
  });
}

// ============================================================
// T0: FOCUS MANAGEMENT
// ============================================================
function focusWindow(el) {
  if (!el || !el.parentNode) return;
  zIndexCounter++;
  el.style.zIndex = zIndexCounter;
  document.querySelectorAll('.aw').forEach(w => { w.classList.remove('focused'); if (!selectedWindows.has(w)) w.classList.add('dimmed'); });
  el.classList.add('focused');
  el.classList.remove('dimmed');
  focusedEl = el;
}

function focusLast() {
  const visible = artifacts.filter(a => !a.closed);
  if (visible.length === 0) return;
  const last = visible[visible.length - 1];
  focusWindow(last.el);
  last.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Foco en ultimo artefacto', 'info');
}

// ============================================================
// T2: UNDO/REDO
// ============================================================
function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}
window.pushUndo = pushUndo;

function undo() {
  const action = undoStack.pop();
  if (!action) { showToast('Nada que deshacer', 'info'); return; }
  switch (action.type) {
    case 'create':
      if (action.el && action.el.parentNode) { action.el.classList.add('leaving'); setTimeout(() => action.el.remove(), 300); const a = artifacts.find(x => x.id === action.id); if (a) a.closed = true; updateCount(); renderDrawer(); }
      redoStack.push(action); showToast('Deshecho: crear artefacto', 'info'); break;
    case 'close':
      restoreArtifact(action.id); redoStack.push(action); showToast('Deshecho: cerrar artefacto', 'info'); break;
    case 'move':
      action.el.style.left = action.prevLeft; action.el.style.top = action.prevTop;
      redoStack.push(action); showToast('Deshecho: mover', 'info'); break;
    case 'clear-all':
      action.items.forEach(item => { item.el.style.display = ''; item.closed = false; item.el.classList.add('entering'); setTimeout(() => item.el.classList.remove('entering'), 500); });
      updateCount(); renderDrawer(); redoStack.push(action); showToast('Deshecho: limpiar todo', 'info'); break;
    default: break;
  }
}

function redo() {
  const action = redoStack.pop();
  if (!action) { showToast('Nada que rehacer', 'info'); return; }
  switch (action.type) {
    case 'create':
      action.el.style.display = ''; action.el.classList.add('entering'); setTimeout(() => action.el.classList.remove('entering'), 500);
      const a = artifacts.find(x => x.id === action.id); if (a) a.closed = false; focusWindow(action.el); updateCount(); renderDrawer();
      undoStack.push(action); showToast('Rehecho: crear artefacto', 'info'); break;
    case 'close':
      doCloseArtifact(action.id); undoStack.push(action); showToast('Rehecho: cerrar', 'info'); break;
    case 'move':
      action.el.style.left = action.newLeft; action.el.style.top = action.newTop;
      undoStack.push(action); showToast('Rehecho: mover', 'info'); break;
    default: break;
  }
}

// ============================================================
// T2: SNAP SYSTEM
// ============================================================
const SNAP_GRID = 20;
const SNAP_THRESHOLD = 8;
let snapGuides = [];

function clearSnapGuides() {
  snapGuides.forEach(g => g.remove());
  snapGuides = [];
}

function showSnapGuide(type, pos) {
  const g = document.createElement('div');
  g.className = 'snap-guide ' + type;
  if (type === 'v') g.style.left = pos + 'px';
  else g.style.top = pos + 'px';
  document.body.appendChild(g);
  snapGuides.push(g);
}

function trySnap(el, x, y) {
  clearSnapGuides();
  if (selectedWindows.size > 1) return { x, y }; // No snap in multi-drag
  // Snap to grid
  if (e_shiftHeld) {
    const gx = Math.round(x / SNAP_GRID) * SNAP_GRID;
    const gy = Math.round(y / SNAP_GRID) * SNAP_GRID;
    if (Math.abs(gx - x) < SNAP_THRESHOLD) x = gx;
    if (Math.abs(gy - y) < SNAP_THRESHOLD) y = gy;
  }
  // Snap to center
  const cx = window.innerWidth / 2 - el.offsetWidth / 2;
  if (Math.abs(x - cx) < SNAP_THRESHOLD) { x = cx; showSnapGuide('v', window.innerWidth / 2); }
  const cy = window.innerHeight / 2 - el.offsetHeight / 2;
  if (Math.abs(y - cy) < SNAP_THRESHOLD) { y = cy; showSnapGuide('h', window.innerHeight / 2); }
  // Snap to edges of other windows
  artifacts.forEach(a => {
    if (a.closed || a.el === el) return;
    const r = a.el.getBoundingClientRect();
    const ax = r.left, ay = r.top, aw = r.width, ah = r.height;
    // Left edge
    if (Math.abs(x - ax) < SNAP_THRESHOLD) { x = ax; showSnapGuide('edge-v', ax); }
    // Right edge
    if (Math.abs(x + el.offsetWidth - ax - aw) < SNAP_THRESHOLD) { x = ax + aw - el.offsetWidth; showSnapGuide('edge-v', ax + aw); }
    // Top edge
    if (Math.abs(y - ay) < SNAP_THRESHOLD) { y = ay; showSnapGuide('edge-h', ay); }
    // Bottom edge
    if (Math.abs(y + el.offsetHeight - ay - ah) < SNAP_THRESHOLD) { y = ay + ah - el.offsetHeight; showSnapGuide('edge-h', ay + ah); }
  });
  return { x, y };
}

// Shift key tracker
let e_shiftHeld = false;
document.addEventListener('keydown', (e) => { if (e.key === 'Shift') e_shiftHeld = true; });
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') e_shiftHeld = false; });

// ============================================================
// T2: MULTI-SELECT
// ============================================================
function toggleSelect(el) {
  if (selectedWindows.has(el)) { selectedWindows.delete(el); el.classList.remove('selected'); }
  else { selectedWindows.add(el); el.classList.add('selected'); }
}

function clearSelection() {
  selectedWindows.forEach(el => el.classList.remove('selected'));
  selectedWindows.clear();
}

// Lasso
let lassoEl = null, lassoStart = null;
function initLasso() {
  const layer = document.getElementById('artifact-layer');
  layer.addEventListener('pointerdown', (e) => {
    if (e.target !== layer) return;
    if (!e_shiftHeld) clearSelection();
    lassoStart = { x: e.clientX, y: e.clientY };
    lassoEl = document.createElement('div');
    lassoEl.id = 'lasso';
    lassoEl.style.left = e.clientX + 'px'; lassoEl.style.top = e.clientY + 'px';
    lassoEl.style.width = '0'; lassoEl.style.height = '0';
    lassoEl.style.display = 'block';
    document.body.appendChild(lassoEl);
    const onMove = (ev) => {
      if (!lassoEl || !lassoStart) return;
      const x1 = Math.min(lassoStart.x, ev.clientX), y1 = Math.min(lassoStart.y, ev.clientY);
      const w = Math.abs(ev.clientX - lassoStart.x), h = Math.abs(ev.clientY - lassoStart.y);
      lassoEl.style.left = x1 + 'px'; lassoEl.style.top = y1 + 'px';
      lassoEl.style.width = w + 'px'; lassoEl.style.height = h + 'px';
      // Select intersecting windows
      clearSelection();
      artifacts.forEach(a => {
        if (a.closed) return;
        const r = a.el.getBoundingClientRect();
        if (r.left < x1 + w && r.right > x1 && r.top < y1 + h && r.bottom > y1) { selectedWindows.add(a.el); a.el.classList.add('selected'); }
      });
    };
    const onUp = () => {
      if (lassoEl) { lassoEl.remove(); lassoEl = null; }
      lassoStart = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

// ============================================================
// T2: CONTEXT MENU
// ============================================================
function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.id = 'ctx-menu';
  items.forEach(item => {
    if (item.sep) { const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); return; }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.innerHTML = (item.icon || '') + '<span>' + item.label + '</span>' + (item.submenu ? '<span class="ctx-submenu-arrow">\u25B8</span>' : '');
    el.onclick = () => { closeContextMenu(); if (item.action) item.action(); };
    menu.appendChild(el);
  });
  menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 20) + 'px';
  document.body.appendChild(menu);
}

function closeContextMenu() {
  const m = document.getElementById('ctx-menu');
  if (m) m.remove();
}

document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ctx-menu')) closeContextMenu(); });

function windowContextMenu(el, e) {
  e.preventDefault();
  focusWindow(el);
  const a = artifacts.find(x => x.el === el);
  showContextMenu(e.clientX, e.clientY, [
    { icon: '\u23AF', label: 'Duplicar', action: () => duplicateArtifact(a) },
    { icon: '\u2197', label: a && a.minimized ? 'Restaurar' : 'Minimizar', action: () => { if (a && a.minimized) restoreMinimized(a.id); else minimizeArtifact(a.id); } },
    { icon: '\u23EB', label: 'Enviar al fondo', action: () => { el.style.zIndex = 10; } },
    { sep: true },
    { icon: '\u2717', label: 'Cerrar', danger: true, action: () => closeArtifact(a.id) },
  ]);
}

function canvasContextMenu(e) {
  if (e.target.id !== 'artifact-layer') return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    { icon: '+', label: 'Nuevo artefacto', submenu: true, action: () => showToast('Usa el panel de Event Lab', 'info') },
    { sep: true },
    { icon: '\u2194', label: gridMode ? 'Modo canvas' : 'Modo grid', action: () => toggleGridLayout() },
    { icon: '\u25C0', label: 'Enfocar ultimo', action: () => focusLast() },
    { sep: true },
    { icon: '\u2717', label: 'Limpiar todo', danger: true, action: () => clearAllArtifacts() },
  ]);
}

// ============================================================
// T2: MINIMIZE / RESTORE
// ============================================================
function minimizeArtifact(id) {
  const a = artifacts.find(x => x.id === id);
  if (!a) return;
  a.minimized = true;
  a.el.classList.add('minimized');
  updateMinimizeDock();
  showToast('Artefacto minimizado', 'info');
}

function restoreMinimized(id) {
  const a = artifacts.find(x => x.id === id);
  if (!a) return;
  a.minimized = false;
  a.el.classList.remove('minimized');
  updateMinimizeDock();
}

function updateMinimizeDock() {
  let dock = document.getElementById('minimize-dock');
  if (!dock) { dock = document.createElement('div'); dock.id = 'minimize-dock'; document.body.appendChild(dock); }
  dock.innerHTML = '';
  artifacts.filter(a => a.minimized && !a.closed).forEach(a => {
    const bar = document.createElement('div');
    bar.className = 'min-bar';
    bar.innerHTML = '<span>' + (a.icon || '\u25A6') + '</span><span>' + a.title + '</span>';
    bar.onclick = () => restoreMinimized(a.id);
    dock.appendChild(bar);
  });
}

// ============================================================
// WINDOW LIFECYCLE
// ============================================================
function getNextPosition(width, height) {
  height = height || 300;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const margin = 60;
  const maxW = window.innerWidth - width - margin;
  const maxH = window.innerHeight - height - 120;
  let x = cx + 180 + lastPosition.x;
  let y = cy - 100 + lastPosition.y;
  lastPosition.x += 36; lastPosition.y += 36;
  if (x > maxW) { x = margin; lastPosition.x = 0; }
  if (y > maxH) { y = 80; lastPosition.y = 0; }
  if (x < margin) x = margin;
  if (y < 70) y = 70;
  return { left: x, top: y };
}

function createWindow(type, title, width, height, bodyHTML, opts) {
  opts = opts || {};
  const id = ++artifactIdCounter;
  const el = document.createElement('div');
  el.className = 'aw entering';
  el.dataset.id = id; el.dataset.type = type;
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', title);
  el.style.width = width + 'px';
  if (height) el.style.height = height + 'px';

  const pos = getNextPosition(width, height || 300);
  el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px';

  const resizable = opts.resizable !== false;
  const minW = opts.minW || 260, minH = opts.minH || 180;

  el.innerHTML =
    '<div class="aw-header flex items-center justify-between px-3.5 py-2.5 bg-white/[0.03] border-b border-white/8 shrink-0">' +
      '<div class="flex items-center gap-2 min-w-0">' +
        '<div class="aw-drag-dots"><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
        (opts.icon ? '<span class="text-sm shrink-0">' + opts.icon + '</span>' : '') +
        '<span class="badge text-muted truncate">' + title + '</span>' +
        '<span class="aw-focus-label">enfocado</span>' +
      '</div>' +
      '<div class="flex items-center gap-1 shrink-0">' +
        (opts.headerActions || '') +
        '<button class="aw-min-btn tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-fg transition flex items-center justify-center" data-tip="Minimizar" aria-label="Minimizar"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg></button>' +
        '<button class="aw-close tooltip w-6 h-6 rounded hover:bg-red-500/20 text-muted hover:text-red-300 transition flex items-center justify-center" data-tip="Cerrar" aria-label="Cerrar"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>' +
    '</div>' +
    '<div class="aw-body flex-1 overflow-hidden flex flex-col min-h-0">' + bodyHTML + '</div>' +
    (resizable ? '<div class="aw-resize" aria-label="Redimensionar"></div>' : '');

  layer.appendChild(el);

  // Wire buttons
  el.querySelector('.aw-close').onclick = (e) => { e.stopPropagation(); closeArtifact(id); };
  el.querySelector('.aw-min-btn').onclick = (e) => { e.stopPropagation(); minimizeArtifact(id); };

  // Focus on click
  el.addEventListener('pointerdown', () => focusWindow(el));

  // Context menu
  el.querySelector('.aw-header').addEventListener('contextmenu', (e) => windowContextMenu(el, e));

  // Keyboard: Enter to focus, Delete to close
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && focusedEl === el) { closeArtifact(id); }
  });

  // Drag
  const header = el.querySelector('.aw-header');
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (gridMode) return;
    if (e.shiftKey) { toggleSelect(el); return; }
    if (!selectedWindows.has(el)) clearSelection();
    focusWindow(el);
    const startX = e.clientX, startY = e.clientY;
    const origLeft = parseInt(el.style.left), origTop = parseInt(el.style.top);
    let hasMoved = false;
    const onMove = (ev) => {
      hasMoved = true;
      let nx = origLeft + (ev.clientX - startX);
      let ny = origTop + (ev.clientY - startY);
      nx = Math.max(0, Math.min(window.innerWidth - 80, nx));
      ny = Math.max(50, Math.min(window.innerHeight - 60, ny));
      const snapped = trySnap(el, nx, ny);
      nx = snapped.x; ny = snapped.y;
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
      // Move selected group
      if (selectedWindows.size > 1 && selectedWindows.has(el)) {
        selectedWindows.forEach(other => {
          if (other === el) return;
          const oLeft = parseInt(other.style.left) + (ev.clientX - startX);
          const oTop = parseInt(other.style.top) + (ev.clientY - startY);
          other.style.left = Math.max(0, Math.min(window.innerWidth - 80, oLeft)) + 'px';
          other.style.top = Math.max(50, Math.min(window.innerHeight - 60, oTop)) + 'px';
        });
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      clearSnapGuides();
      if (hasMoved) {
        pushUndo({ type: 'move', el: el, prevLeft: origLeft + 'px', prevTop: origTop + 'px', newLeft: el.style.left, newTop: el.style.top });
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // Resize
  if (resizable) {
    const handle = el.querySelector('.aw-resize');
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      focusWindow(el);
      const startX = e.clientX, startY = e.clientY;
      const origW = el.offsetWidth, origH = el.offsetHeight;
      const onMove = (ev) => {
        let nw = Math.max(minW, origW + (ev.clientX - startX));
        let nh = Math.max(minH, origH + (ev.clientY - startY));
        el.style.width = nw + 'px'; el.style.height = nh + 'px';
      };
      const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // Register
  const entry = { id, type, title, el, closed: false, minimized: false, timestamp: new Date(), icon: opts.icon };
  artifacts.push(entry);
  zIndexCounter++; el.style.zIndex = zIndexCounter;
  focusWindow(el);
  setTimeout(() => el.classList.remove('entering'), 500);

  // Init widget
  if (opts.init) {
    try { opts.init(el); } catch(err) { console.error('Widget init error:', err); showToast('Error al renderizar widget', 'err'); }
  }

  pushUndo({ type: 'create', id, el });
  updateCount(); renderDrawer();
  return { el, id, entry };
}

function closeArtifact(id) {
  const a = artifacts.find(x => x.id === id);
  if (!a) return;
  pushUndo({ type: 'close', id });
  doCloseArtifact(id);
}

function doCloseArtifact(id) {
  const a = artifacts.find(x => x.id === id);
  if (!a) return;
  a.closed = true;
  a.el.classList.add('leaving');
  setTimeout(() => { a.el.style.display = 'none'; a.el.classList.remove('leaving'); }, 300);
  if (a.minimized) { a.minimized = false; updateMinimizeDock(); }
  updateCount(); renderDrawer();
  showToast('Artefacto cerrado', 'info');
}

function restoreArtifact(id) {
  const a = artifacts.find(x => x.id === id);
  if (!a || !a.closed) return;
  a.closed = false;
  a.el.style.display = '';
  a.el.classList.add('entering');
  setTimeout(() => a.el.classList.remove('entering'), 500);
  zIndexCounter++; a.el.style.zIndex = zIndexCounter;
  updateCount(); renderDrawer(); focusWindow(a.el);
}

function duplicateArtifact(a) {
  if (!a) return;
  const tpl = WIDGETS[a.type];
  if (!tpl) return;
  const cfg = tpl();
  const w = createWindow(a.type, cfg.title + ' (copia)', cfg.width, cfg.height, cfg.body, { icon: cfg.icon, resizable: cfg.resizable, minW: cfg.minW, minH: cfg.minH, headerActions: cfg.headerActions, init: cfg.init });
  // Offset
  w.el.style.left = (parseInt(a.el.style.left) + 40) + 'px';
  w.el.style.top = (parseInt(a.el.style.top) + 40) + 'px';
  showToast('Artefacto duplicado', 'ok');
}

function clearAllArtifacts() {
  const open = artifacts.filter(a => !a.closed);
  if (open.length === 0) return;
  pushUndo({ type: 'clear-all', items: open.map(a => ({ ...a })) });
  open.forEach(a => { a.closed = true; a.el.classList.add('leaving'); setTimeout(() => { a.el.style.display = 'none'; a.el.classList.remove('leaving'); }, 300); });
  updateMinimizeDock(); updateCount(); renderDrawer();
  showToast(open.length + ' artefactos limpiados', 'ok');
}

// ============================================================
// COUNT + DRAWER
// ============================================================
function updateCount() {
  const el = document.getElementById('aw-count');
  if (el) el.textContent = artifacts.filter(a => !a.closed).length;
}

function renderDrawer() {
  const list = document.getElementById('drawer-list');
  if (!list) return;
  document.getElementById('drawer-total').textContent = artifacts.length;
  const libCount = document.getElementById('lib-count');
  if (libCount) libCount.textContent = artifacts.length;
  list.innerHTML = '';
  if (artifacts.length === 0) {
    list.innerHTML = '<div class="text-center py-8"><div class="text-3xl mb-2 opacity-30">\u{1F4DA}</div><p class="text-muted text-xs">Sin artefactos aun.</p><p class="text-faint text-[10px] mt-1">Toca el orbe o escribe para generar uno.</p></div>';
    return;
  }
  const iconMap = { code:'\u{1F4BB}', hero:'\u{1F6E1}\uFE0F', img:'\u{1F5BC}\uFE0F', link:'\u{1F517}', markdown:'\u{1F4DD}', mermaid:'\u{1F500}', music:'\u{1F3B5}', longtext:'\u{1F4C4}', chart:'\u{1F4CA}', json:'\u{1F5C2}\uFE0F', terminal:'\u{1F5A5}\uFE0F', checklist:'\u2705', video:'\u{1F3AC}', quiz:'\u2753', diff:'\u{1F527}', table:'\u{1F4CB}', controls:'\u{1F39A}\uFE0F' };
  // Sort/filter controls
  const filterBar = document.createElement('div');
  filterBar.className = 'flex items-center gap-1.5 mb-2';
  filterBar.innerHTML = '<input type="text" id="drawer-search" placeholder="Filtrar..." class="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-fg outline-none focus:border-accent/40 transition">';
  list.appendChild(filterBar);
  const search = filterBar.querySelector('#drawer-search');
  let filterText = '';

  function renderItems() {
    const existing = list.querySelectorAll('.drawer-item');
    existing.forEach(e => e.remove());
    const filtered = artifacts.slice().reverse().filter(a => {
      if (!filterText) return true;
      return a.title.toLowerCase().includes(filterText) || a.type.toLowerCase().includes(filterText);
    });
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-center text-muted text-xs py-4 drawer-item';
      empty.textContent = 'Sin resultados.';
      list.appendChild(empty);
      return;
    }
    filtered.forEach(a => {
      const item = document.createElement('div');
      item.className = 'drawer-item flex items-center gap-3 p-2.5 rounded-xl border border-white/5 hover:bg-white/5 transition cursor-pointer ' + (a.closed ? 'opacity-50' : '');
      const time = a.timestamp.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      item.innerHTML =
        '<div class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm shrink-0">' + (iconMap[a.type] || '\u{1F4E6}') + '</div>' +
        '<div class="flex-1 min-w-0"><div class="text-xs text-fg truncate">' + a.title + '</div><div class="badge text-muted mt-0.5">' + a.type + ' · ' + time + ' · ' + (a.closed ? 'cerrado' : 'activo') + '</div></div>' +
        (a.closed ? '<button class="badge text-accent hover:text-fg transition px-2 py-1 rounded hover:bg-white/5 shrink-0">recuperar</button>' : '<div class="w-2 h-2 rounded-full bg-ok shrink-0"></div>');
      if (a.closed) { item.querySelector('button').onclick = () => restoreArtifact(a.id); }
      else { item.onclick = () => focusWindow(a.el); }
      list.appendChild(item);
    });
  }
  search.oninput = () => { filterText = search.value.toLowerCase(); renderItems(); };
  renderItems();
}

function toggleDrawer() {
  const d = document.getElementById('drawer');
  d.classList.toggle('closed');
  renderDrawer();
}

// ============================================================
// LAYOUT TOGGLE
// ============================================================
function toggleGridLayout() {
  gridMode = !gridMode;
  document.body.classList.toggle('grid-mode', gridMode);
  const btn = document.getElementById('layout-btn');
  if (btn) btn.innerHTML = gridMode
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/></svg> Canvas'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Grid';
  showToast(gridMode ? 'Modo grid' : 'Modo canvas', 'info');
}

// ============================================================
// CONVERSATION MODAL
// ============================================================
function openConversationModal() {
  const modal = document.getElementById('conv-modal');
  const list = document.getElementById('conv-list');
  list.innerHTML = '';
  if (conversation.length === 0) {
    list.innerHTML = '<div class="text-center py-8"><div class="text-3xl mb-2 opacity-30">\u{1F4AC}</div><p class="text-muted text-xs">No hay conversacion aun.</p><p class="text-faint text-[10px] mt-1">Inicia una conversacion para ver el historial aqui.</p></div>';
  } else {
    conversation.forEach((turn, i) => {
      const num = String(i + 1).padStart(2, '0');
      const isUser = turn.role === 'user';
      const time = turn.timestamp.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const div = document.createElement('div');
      div.className = 'flex items-start gap-3';
      div.innerHTML =
        '<div class="badge ' + (isUser ? 'text-muted' : 'text-accent') + ' pt-1 w-8 text-right shrink-0">' + num + '</div>' +
        '<div class="flex-1"><div class="badge mb-1.5 flex items-center gap-2">' +
          '<span class="' + (isUser ? '' : 'text-accent') + '">' + (isUser ? 'tu' : 'kali') + '</span>' +
          '<span class="text-faint">·</span><span class="text-muted">' + time + '</span>' +
          (turn.artifactTypes.length ? '<span class="text-faint">·</span><span class="flex gap-1">' + turn.artifactTypes.map(function(t) { return '<span class="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-muted">' + t + '</span>'; }).join('') + '</span>' : '') +
        '</div><p style="font-family:Fraunces,serif;' + (isUser ? 'font-style:italic;color:#64748b;font-size:0.95rem;' : 'font-size:1rem;') + '">' + turn.text + '</p></div>';
      list.appendChild(div);
      if (i < conversation.length - 1) { const sep = document.createElement('div'); sep.className = 'h-px bg-white/5 ml-11'; list.appendChild(sep); }
    });
  }
  modal.classList.remove('hidden'); modal.classList.add('flex');
  modal.setAttribute('aria-hidden', 'false');
}
function closeConversationModal() {
  const m = document.getElementById('conv-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  m.setAttribute('aria-hidden', 'true');
}

// ============================================================
// STREAMING TEXT + LOG
// ============================================================
function streamText(text) {
  projection.innerHTML = '';
  let i = 0;
  const interval = setInterval(() => {
    projection.innerHTML = text.slice(0, i) + '<span class="cursor"></span>';
    i++;
    if (i > text.length) clearInterval(interval);
  }, 25);
}

function logConversation(role, text, artifactTypes) {
  conversation.push({ role: role, text: text, timestamp: new Date(), artifactTypes: artifactTypes || [] });
}

// ============================================================
// T2: KEYBOARD SHORTCUTS
// ============================================================
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const inInput = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT');

    // Escape — universal
    if (e.key === 'Escape') {
      closeSpotlight(); closeConversationModal(); closeContextMenu(); clearSelection();
      if (focusedEl) { focusedEl.blur(); focusedEl = null; document.querySelectorAll('.aw').forEach(w => w.classList.remove('dimmed', 'focused')); }
      return;
    }

    // Ctrl+Z / Ctrl+Shift+Z — undo/redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !inInput) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !inInput) { e.preventDefault(); redo(); return; }

    // Ctrl+A — select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inInput) { e.preventDefault(); artifacts.forEach(a => { if (!a.closed) { selectedWindows.add(a.el); a.el.classList.add('selected'); } }); showToast(selectedWindows.size + ' seleccionados', 'info'); return; }

    // Ctrl+D — duplicate focused
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !inInput && focusedEl) { e.preventDefault(); const a = artifacts.find(x => x.el === focusedEl); if (a) duplicateArtifact(a); return; }

    // Ctrl+F — global search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !inInput) { e.preventDefault(); showToast('Busqueda global: usa el spotlight', 'info'); document.getElementById('spotlight').classList.remove('hidden'); document.getElementById('cmd-input').focus(); return; }

    // Ctrl+S — save workspace
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && !inInput) { e.preventDefault(); saveWorkspace(); return; }

    // Ctrl+B — toggle drawer
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !inInput) { e.preventDefault(); toggleDrawer(); return; }

    // Ctrl+G — toggle grid
    if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !inInput) { e.preventDefault(); toggleGridLayout(); return; }

    // Ctrl+L — focus last
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !inInput) { e.preventDefault(); focusLast(); return; }

    // Delete — close focused
    if (e.key === 'Delete' && !inInput && focusedEl) { e.preventDefault(); const a = artifacts.find(x => x.el === focusedEl); if (a) closeArtifact(a.id); return; }

    // Tab — cycle focus between windows
    if (e.key === 'Tab' && !inInput) {
      e.preventDefault();
      const visible = artifacts.filter(a => !a.closed);
      if (visible.length === 0) return;
      const currentIdx = visible.findIndex(a => a.el === focusedEl);
      const nextIdx = e.shiftKey ? (currentIdx - 1 + visible.length) % visible.length : (currentIdx + 1) % visible.length;
      focusWindow(visible[nextIdx].el);
      return;
    }

    // Arrow keys — nudge focused
    if (focusedEl && !inInput && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 1;
      let nx = parseInt(focusedEl.style.left), ny = parseInt(focusedEl.style.top);
      if (e.key === 'ArrowLeft') nx -= step;
      if (e.key === 'ArrowRight') nx += step;
      if (e.key === 'ArrowUp') ny -= step;
      if (e.key === 'ArrowDown') ny += step;
      focusedEl.style.left = nx + 'px'; focusedEl.style.top = ny + 'px';
      return;
    }

    // Ctrl+[1-9] — focus nth artifact
    if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key) && !inInput) {
      e.preventDefault();
      const visible = artifacts.filter(a => !a.closed);
      const idx = parseInt(e.key) - 1;
      if (idx < visible.length) focusWindow(visible[idx].el);
      return;
    }

    // ? — show keyboard help
    if (e.key === '?' && !inInput) { e.preventDefault(); toggleKbdHelp(); return; }

    // Any printable key — open spotlight
    if (!inInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      document.getElementById('spotlight').classList.remove('hidden');
      const inp = document.getElementById('cmd-input');
      inp.focus();
    }
  });
}

function toggleKbdHelp() {
  let help = document.getElementById('kbd-help');
  if (!help) {
    help = document.createElement('div');
    help.id = 'kbd-help'; help.className = 'kbd-help';
    help.innerHTML =
      '<div class="glass-strong rounded-3xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto scrollbar-thin">' +
        '<div class="flex items-center justify-between mb-4"><h2 class="text-base font-semibold">Atajos de teclado</h2><button onclick="document.getElementById(\'kbd-help\').classList.remove(\'visible\')" class="w-8 h-8 rounded-lg hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
        '<div class="space-y-2 text-xs">' +
          [['Ctrl+Z', 'Deshacer'], ['Ctrl+Shift+Z', 'Rehacer'], ['Ctrl+A', 'Seleccionar todo'], ['Ctrl+D', 'Duplicar enfocado'], ['Delete', 'Cerrar enfocado'], ['Ctrl+F', 'Busqueda global'], ['Ctrl+S', 'Guardar workspace'], ['Ctrl+B', 'Toggle drawer'], ['Ctrl+G', 'Toggle grid/canvas'], ['Ctrl+L', 'Enfocar ultimo'], ['Tab', 'Ciclar foco'], ['Flechas', 'Mover 1px'], ['Shift+Flechas', 'Mover 20px'], ['Ctrl+[1-9]', 'Enfocar artefacto #N'], ['Esc', 'Desenfocar / cerrar modales'], ['?', 'Mostrar esta ayuda']].map(function(row) {
            return '<div class="flex items-center justify-between py-1.5 border-b border-white/5"><span class="text-fg/80">' + row[1] + '</span><span class="kbd">' + row[0] + '</span></div>';
          }).join('') +
        '</div>' +
      '</div>';
    document.body.appendChild(help);
  }
  help.classList.toggle('visible');
}

// ============================================================
// T2: PERSISTENCE (localStorage)
// ============================================================
function saveWorkspace() {
  try {
    const state = artifacts.map(a => ({
      id: a.id, type: a.type, title: a.title, closed: a.closed, minimized: a.minimized,
      timestamp: a.timestamp.toISOString(),
      pos: { left: a.el.style.left, top: a.el.style.top, width: a.el.style.width, height: a.el.style.height, zIndex: a.el.style.zIndex }
    }));
    localStorage.setItem('kali_workspace', JSON.stringify(state));
    showToast('Workspace guardado', 'ok');
  } catch(e) { showToast('Error al guardar', 'err'); }
}

function loadWorkspace() {
  try {
    const data = localStorage.getItem('kali_workspace');
    if (!data) return;
    // For static mockup, just show toast. Real restore would re-create windows.
    showToast('Workspace previo detectado', 'info');
  } catch(e) { /* ignore */ }
}

// Auto-save every 5 seconds
setInterval(() => { if (artifacts.length > 0) saveWorkspace(); }, 5000);

// ============================================================
// SPOTLIGHT
// ============================================================
function closeSpotlight() { const s = document.getElementById('spotlight'); if (s) s.classList.add('hidden'); }

function sendCommand() {
  const input = document.getElementById('cmd-input');
  if (input.value) WS.trigger('text', input.value);
  input.value = ''; closeSpotlight();
}

// ============================================================
// VOICE BAR
// ============================================================
function showVoiceBar() { document.getElementById('voice-bar').classList.remove('hidden'); }
function hideVoiceBar() { document.getElementById('voice-bar').classList.add('hidden'); }

// ============================================================
// TRIGGER (main entry point for creating artifacts)
// ============================================================
const TRIGGER_TEXTS = {
  text: 'He analizado el contexto. La arquitectura debe priorizar baja latencia sobre consistencia inmediata. Te recomiendo event-sourced con CQRS.',
  code: 'Aqui tienes la implementacion tecnica con manejo de errores:',
  hero: 'He recuperado los datos completos del personaje:',
  img: 'Generando la representacion visual del concepto...',
  link: 'Para profundizar, te recomiendo la documentacion oficial:',
  markdown: 'He compilado un documento con la guia completa de implementacion:',
  mermaid: 'Te dibuje el flujo de autenticacion del sistema:',
  music: 'Te preparé un tema para acompanar la sesion de trabajo:',
  longtext: 'Aqui esta el transcript completo del analisis de logs:',
  chart: 'Comparativa de latencia y throughput entre los modelos evaluados:',
  json: 'Respuesta de la API con los datos del heroe solicitado:',
  terminal: 'Output del build y runtime del servidor:',
  checklist: 'Descompuse la tarea en pasos. Marca los completados:',
  video: 'Te encontre un tutorial que cubre exactamente este tema:',
  quiz: 'Te prepare una pregunta para validar tu conocimiento:',
  diff: 'Detecte un bug. Aqui esta el patch corregido:',
  table: 'Aqui tienes la comparativa de los modelos evaluados:',
  controls: 'Te deje un panel para ajustar los parametros del modelo:',
  voice: 'Sincronizando salida de audio. Me escuchas con claridad?',
};

WS.trigger = function(type, customText) {
  customText = customText || '';
  orb.style.filter = 'drop-shadow(0 0 60px #22d3ee)';

  // Loading skeleton
  if (type !== 'text' && type !== 'voice') {
    showToast('Generando artefacto...', 'info');
  }

  setTimeout(function() {
    var text = customText || TRIGGER_TEXTS[type] || '';
    if (text) { streamText(text); logConversation('kali', text, [type]); }
    if (type === 'voice') { orb.style.background = 'radial-gradient(circle at 35% 30%, #34d399, #22d3ee 45%, #0891b2 90%)'; showVoiceBar(); }
    if (type === 'text' && customText) { logConversation('user', customText); orb.style.filter = 'drop-shadow(0 0 40px rgba(34,211,238,0.4))'; return; }
    var tpl = WIDGETS[type];
    if (tpl) {
      var cfg = tpl();
      createWindow(type, cfg.title, cfg.width, cfg.height, cfg.body, { icon: cfg.icon, resizable: cfg.resizable, minW: cfg.minW, minH: cfg.minH, headerActions: cfg.headerActions, init: cfg.init });
    }
    orb.style.filter = 'drop-shadow(0 0 40px rgba(34,211,238,0.4))';
  }, 400);
};

// ============================================================
// INIT
// ============================================================
WS.init = function() {
  layer = document.getElementById('artifact-layer');
  projection = document.getElementById('projection');
  orb = document.getElementById('orb');

  initTooltips();
  initKeyboard();
  initLasso();

  // Canvas context menu
  layer.addEventListener('contextmenu', canvasContextMenu);

  // Spotlight Enter
  var cmdInput = document.getElementById('cmd-input');
  if (cmdInput) cmdInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendCommand(); });

  // Conversation modal click-outside
  var modal = document.getElementById('conv-modal');
  if (modal) modal.addEventListener('pointerdown', function(e) { if (e.target === modal) closeConversationModal(); });

  // Orb click — cycle states
  var orbStates = [
    { bg: 'radial-gradient(circle at 30% 30%, #67e8f9, #22d3ee 40%, #0891b2 100%)', label: 'idle · esperando' },
    { bg: 'radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 45%, #b45309 90%)', label: 'escuchando · 0:03' },
    { bg: 'radial-gradient(circle at 35% 30%, #f9a8d4, #f472b6 45%, #a855f7 90%)', label: 'pensando · 0.8s' },
    { bg: 'radial-gradient(circle at 35% 30%, #6ee7b7, #34d399 45%, #059669 90%)', label: 'hablando · 0:12' }
  ];
  var orbIdx = 0;
  var orbLabel = document.getElementById('orb-label');
  orb.addEventListener('click', function() {
    orbIdx = (orbIdx + 1) % orbStates.length;
    var s = orbStates[orbIdx];
    orb.style.background = s.bg;
    if (orbLabel) orbLabel.textContent = s.label;
  });

  // Debug panel drag
  var panel = document.getElementById('debug-panel');
  if (panel) {
    var dbgDrag = false, dbgOff = { x: 0, y: 0 };
    panel.addEventListener('pointerdown', function(e) {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      dbgDrag = true; dbgOff.x = e.clientX - panel.offsetLeft; dbgOff.y = e.clientY - panel.offsetTop;
    });
    document.addEventListener('pointermove', function(e) { if (!dbgDrag) return; panel.style.left = (e.clientX - dbgOff.x) + 'px'; panel.style.top = (e.clientY - dbgOff.y) + 'px'; panel.style.right = 'auto'; });
    document.addEventListener('pointerup', function() { dbgDrag = false; });
  }

  // Load previous workspace
  loadWorkspace();

  // Render initial drawer
  renderDrawer();
};

// Expose globally
window.WS = WS;
window.showToast = showToast;
window.focusWindow = focusWindow;
window.focusLast = focusLast;
window.toggleDrawer = toggleDrawer;
window.toggleGridLayout = toggleGridLayout;
window.clearAllArtifacts = clearAllArtifacts;
window.openConversationModal = openConversationModal;
window.closeConversationModal = closeConversationModal;
window.hideVoiceBar = hideVoiceBar;
window.sendCommand = sendCommand;
window.closeSpotlight = closeSpotlight;
window.pushUndo = pushUndo;