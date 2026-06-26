// htmlUtils — helpers injected into HTML artifact iframes before the user's
// content runs. Two concerns:
//
// 1. Sandbox compatibility shim: a sandboxed iframe without `allow-same-origin`
//    loads under an opaque origin, which makes several origin-gated Web APIs
//    throw SecurityError on access (localStorage, sessionStorage, document.cookie,
//    indexedDB, caches, navigator.serviceWorker, navigator.clipboard) or return
//    "null" (window.origin). Any generated HTML that touches those APIs on load
//    crashes before its script finishes, leaving let/const bindings in the
//    temporal dead zone and breaking interactive buttons.
//
//    We inject a single IIFE before any user script that polyfills all of these
//    with in-memory / no-op / rejecting stubs so typical generated games and
//    interactive sites work. Each polyfill is installed independently with an
//    isolated check-then-define pattern, so one failing polyfill never prevents
//    the others from installing. The shim is non-persistent across iframe
//    re-mounts, which is acceptable for a preview.
//
// 2. Hash guard: intercepts clicks on in-page anchor links (<a href="#id">)
//    so they scroll within the iframe instead of navigating the parent window.

// Single monolithic IIFE. Kept as a string because it is injected into the
// iframe's srcDoc (we cannot import a separate .js into a srcdoc document).
//
// Robustness principles:
// - Each polyfill is independent; one failure does not abort the others.
// - Check-then-define: reading the property to detect breakage is in its own
//   try/catch, separate from the Object.defineProperty that installs the shim.
// - configurable: true, writable: true on every defineProperty to minimise
//   conflicts with native accessors and allow re-installation if needed.
// - Never overwrite a working API: only shim when the native one is broken.
// - console is snapshotted before any user script can override it, so the
//   shim's internal warnings survive a console.log = ... in the HTML.
const SANDBOX_SHIM_SCRIPT = `<script>
  (function () {
  var _c = window.console;
  function warn(m) {
  try { _c.warn("[kali-sandbox] " + m); } catch (e) {}
  }

  var lsStore = null, ssStore = null;
  function makeStorage() {
  var d = {};
  var n = 0;
  function keys() { return Object.keys(d); }
  function dispatch(k, ov, nv, ur) {
  try {
  var ev = new StorageEvent("storage", { key: k, newValue: nv, oldValue: ov, url: ur || "", storageArea: lsStore });
  window.dispatchEvent(ev);
  } catch (e) {}
  }
  return {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
  setItem: function (k, v) {
  var ov = d[k];
  if (!Object.prototype.hasOwnProperty.call(d, k)) { n++; }
  d[k] = String(v);
  try { dispatch(k, ov, d[k]); } catch (e) {}
  },
  removeItem: function (k) {
  var ov = d[k];
  if (Object.prototype.hasOwnProperty.call(d, k)) { delete d[k]; n--; }
  try { dispatch(k, ov, null); } catch (e) {}
  },
  clear: function () {
  var was = d;
  d = {};
  n = 0;
  try { for (var oldK in was) { dispatch(oldK, was[oldK], null); } } catch (e) {}
  },
  key: function (i) { var ks = keys(); return i >= 0 && i < ks.length ? ks[i] : null; },
  get length() { return n; }
  };
  }
  function installIfBroken(target, prop, factory) {
  var broken = false;
  try {
  var val = target[prop];
  if (val && typeof val === "object" && typeof val.getItem === "function") { return; }
  if (!val) { broken = true; }
  } catch (e) { broken = true; }
  if (!broken) { return; }
  try { Object.defineProperty(target, prop, { value: factory(), configurable: true, writable: true }); }
  catch (e) { warn("failed to install " + prop + ": " + e.message); }
  }
  lsStore = makeStorage();
  ssStore = makeStorage();
  installIfBroken(window, "localStorage", function () { return lsStore; });
  installIfBroken(window, "sessionStorage", function () { return ssStore; });

  try {
  var cookieMap = {};
  var cookieGet = function () {
  var parts = [];
  for (var k in cookieMap) { parts.push(k + "=" + cookieMap[k]); }
  return parts.join("; ");
  };
  var cookieSet = function (s) {
  if (typeof s !== "string") { return; }
  var pairs = s.split(";");
  for (var i = 0; i < pairs.length; i++) {
  var p = pairs[i].trim();
  if (!p) { continue; }
  var eq = p.indexOf("=");
  if (eq < 0) { continue; }
  var k = p.slice(0, eq);
  var v = p.slice(eq + 1);
  if (/^(expires|max-age|path|domain|secure|samesite)$/i.test(k)) { continue; }
  cookieMap[k] = v;
  }
  };
  var cookieBroken = false;
  try { void document.cookie; } catch (e) { cookieBroken = true; }
  if (cookieBroken) {
  try { Object.defineProperty(document, "cookie", { get: cookieGet, set: cookieSet, configurable: true }); }
  catch (e) { warn("failed to install document.cookie"); }
  }
  } catch (e) { warn("cookie shim error: " + e.message); }

  try {
  var originBroken = false;
  try { if (window.origin === "null" || typeof window.origin === "undefined") { originBroken = true; } }
  catch (e) { originBroken = true; }
  if (originBroken) {
  try { Object.defineProperty(window, "origin", { value: "https://kali-sandbox.local", configurable: true, writable: true }); }
  catch (e) {}
  }
  } catch (e) {}

  try {
  var idbBroken = false;
  try { void window.indexedDB; } catch (e) { idbBroken = true; }
  if (idbBroken || !window.indexedDB) {
  function FakeObjectStore(name, db) {
  this.name = name;
  this._db = db;
  this._data = db._stores[name] || {};
  }
  FakeObjectStore.prototype.get = function (key) {
  var req = {};
  var self = this;
  setTimeout(function () {
  try { req.result = self._data[key]; req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  FakeObjectStore.prototype.put = function (value, key) {
  var req = {};
  var self = this;
  var k = key !== undefined ? key : (value && typeof value === "object" && "id" in value ? value.id : null);
  setTimeout(function () {
  try { self._data[k] = value; self._db._stores[self.name] = self._data; req.result = k; req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  FakeObjectStore.prototype.add = function (value, key) { return this.put(value, key); };
  FakeObjectStore.prototype.delete = function (key) {
  var req = {};
  var self = this;
  setTimeout(function () {
  try { delete self._data[key]; req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  FakeObjectStore.prototype.clear = function () {
  var req = {};
  var self = this;
  setTimeout(function () {
  try { self._data = {}; self._db._stores[self.name] = {}; req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  FakeObjectStore.prototype.count = function () {
  var req = {};
  var self = this;
  setTimeout(function () {
  try { req.result = Object.keys(self._data).length; req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  function FakeDB(name, version) {
  this.name = name;
  this.version = version || 1;
  this._stores = {};
  this.objectStoreNames = { length: 0, contains: function () { return false; } };
  }
  FakeDB.prototype.transaction = function (stores, mode) {
  var self = this;
  return {
  objectStore: function (name) { if (!self._stores[name]) { self._stores[name] = {}; } return new FakeObjectStore(name, self); },
  oncomplete: null, onerror: null, onabort: null, mode: mode || "readonly", db: self
  };
  };
  FakeDB.prototype.createObjectStore = function (name) {
  this._stores[name] = {};
  this.objectStoreNames.length++;
  this.objectStoreNames.contains = function (n) { return n === name; };
  return new FakeObjectStore(name, this);
  };
  FakeDB.prototype.deleteObjectStore = function (name) { delete this._stores[name]; };
  FakeDB.prototype.close = function () {};
  function FakeIDB() { this._dbs = {}; }
  FakeIDB.prototype.open = function (name, version) {
  var req = {};
  var self = this;
  setTimeout(function () {
  try {
  if (!self._dbs[name]) {
  self._dbs[name] = { name: name, version: version || 1, _stores: {} };
  req.transaction = new FakeDB(name, version);
  req.readyState = "done";
  if (typeof req.onupgradeneeded === "function") { req.onupgradeneeded({ target: req }); }
  }
  var db = new FakeDB(name, version || 1);
  db._stores = self._dbs[name]._stores;
  req.result = db;
  req.readyState = "done";
  if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); }
  } catch (e) {
  req.error = e; req.readyState = "done";
  if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); }
  }
  }, 0);
  return req;
  };
  FakeIDB.prototype.deleteDatabase = function (name) {
  var req = {};
  var self = this;
  setTimeout(function () {
  try { delete self._dbs[name]; req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  FakeIDB.prototype.databases = function () {
  var req = {};
  var self = this;
  setTimeout(function () {
  try { req.result = Object.keys(self._dbs).map(function (n) { return { name: n, version: 1 }; }); req.readyState = "done"; if (typeof req.onsuccess === "function") { req.onsuccess({ target: req }); } }
  catch (e) { if (typeof req.onerror === "function") { req.onerror({ target: req, error: e }); } }
  }, 0);
  return req;
  };
  try { Object.defineProperty(window, "indexedDB", { value: new FakeIDB(), configurable: true, writable: true }); }
  catch (e) { warn("failed to install indexedDB"); }
  }
  } catch (e) { warn("indexedDB shim error: " + e.message); }

  try {
  var cachesBroken = false;
  try { void window.caches; } catch (e) { cachesBroken = true; }
  if (cachesBroken || !window.caches) {
  function FakeCache() { this._entries = {}; }
  FakeCache.prototype.match = function (req) { var p = typeof req === "string" ? req : (req && req.url ? req.url : String(req)); return Promise.resolve(this._entries[p] || undefined); };
  FakeCache.prototype.put = function (req, resp) { var p = typeof req === "string" ? req : (req && req.url ? req.url : String(req)); this._entries[p] = resp; return Promise.resolve(); };
  FakeCache.prototype.add = function (req) { var p = typeof req === "string" ? req : (req && req.url ? req.url : String(req)); this._entries[p] = { ok: true }; return Promise.resolve(); };
  FakeCache.prototype.delete = function (req) { var p = typeof req === "string" ? req : (req && req.url ? req.url : String(req)); delete this._entries[p]; return Promise.resolve(true); };
  FakeCache.prototype.keys = function () { return Promise.resolve(Object.keys(this._entries)); };
  function FakeCacheStorage() { this._caches = {}; }
  FakeCacheStorage.prototype.open = function (name) { if (!this._caches[name]) { this._caches[name] = new FakeCache(); } return Promise.resolve(this._caches[name]); };
  FakeCacheStorage.prototype.match = function (req) {
  var p = typeof req === "string" ? req : (req && req.url ? req.url : String(req));
  for (var k in this._caches) { if (this._caches[k]._entries[p]) { return Promise.resolve(this._caches[k]._entries[p]); } }
  return Promise.resolve(undefined);
  };
  FakeCacheStorage.prototype.has = function (name) { return Promise.resolve(name in this._caches); };
  FakeCacheStorage.prototype.delete = function (name) { delete this._caches[name]; return Promise.resolve(true); };
  FakeCacheStorage.prototype.keys = function () { return Promise.resolve(Object.keys(this._caches)); };
  try { Object.defineProperty(window, "caches", { value: new FakeCacheStorage(), configurable: true, writable: true }); }
  catch (e) { warn("failed to install caches"); }
  }
  } catch (e) { warn("caches shim error: " + e.message); }

  try {
  if (navigator) {
  if (!navigator.clipboard) {
  try {
  Object.defineProperty(navigator, "clipboard", {
  value: { readText: function () { return Promise.resolve(""); }, writeText: function () { return Promise.resolve(); } },
  configurable: true, writable: true
  });
  } catch (e) {}
  }
  if (!navigator.serviceWorker) {
  try {
  Object.defineProperty(navigator, "serviceWorker", {
  value: {
  register: function () { return Promise.reject(new Error("ServiceWorker not available in sandbox")); },
  getRegistrations: function () { return Promise.resolve([]); },
  ready: Promise.reject(new Error("no SW"))
  },
  configurable: true, writable: true
  });
  } catch (e) {}
  }
  }
  } catch (e) { warn("navigator shim error: " + e.message); }
  })();
</script>`;

const HASH_GUARD_SCRIPT = `<script>(function(){document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest('a[href^="#"]');if(!a)return;e.preventDefault();var id=a.getAttribute('href').slice(1);if(!id){window.scrollTo({top:0,behavior:'smooth'});return;}var el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});});})();</script>`;

/**
 * Inject a script at the earliest possible point so it runs before any
 * user-supplied <script>. Targets <head> first (before any children),
 * then falls back to <html> start, then to the very start of the document.
 */
function injectAtHeadStart(html: string, script: string): string {
  if (typeof html !== "string" || html.length === 0) return html;

  const headOpenMatch = html.match(/<head[^>]*>/i);
  if (headOpenMatch && headOpenMatch.index !== undefined) {
    const insertAt = headOpenMatch.index + headOpenMatch[0].length;
    return html.slice(0, insertAt) + script + html.slice(insertAt);
  }

  const htmlOpenMatch = html.match(/<html[^>]*>/i);
  if (htmlOpenMatch && htmlOpenMatch.index !== undefined) {
    const insertAt = htmlOpenMatch.index + htmlOpenMatch[0].length;
    return html.slice(0, insertAt) + script + html.slice(insertAt);
  }

  return script + html;
}

/**
 * Inject a script right before the closing </body> (after all user content).
 * Falls back to appending at the end.
 */
function injectBeforeBodyClose(html: string, script: string): string {
  if (typeof html !== "string" || html.length === 0) return html;
  const bodyCloseIdx = html.search(/<\/body>/i);
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + script + html.slice(bodyCloseIdx);
  }
  return html + script;
}

/**
 * Inject the sandbox compatibility shim + hash guard into an HTML document so
 * it can run inside a strict sandbox (no allow-same-origin). The shim is
 * placed at the start of <head> (runs first); the hash guard is placed
 * before </body> (runs after DOM is ready).
 */
export function injectHashGuard(html: string): string {
  if (typeof html !== "string" || html.length === 0) return html;
  const withShim = injectAtHeadStart(html, SANDBOX_SHIM_SCRIPT);
  return injectBeforeBodyClose(withShim, HASH_GUARD_SCRIPT);
}
