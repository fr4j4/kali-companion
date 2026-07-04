// lib/api/connections.ts — REST client for the AI provider connections API.
//
// All UI CRUD on saved LLM connections goes through here.  The store lives
// server-side in `kali-core/kali_core/mind/connections_store.py`.  We use
// REST instead of WS so the modal can call `test` and `scan` synchronously
// and get structured JSON without the round-tripping the WS layer would add.
//
// The base URL is discovered the same way as artifacts.ts — Electron sidecar
// port via window.kali, or Vite proxy in browser dev.

import type {
  CloudProviderInfo,
  ConnectionKind,
  ConnectionSummary,
  ConnectionTestResult,
  ApiFormat,
} from "../protocol";

let baseUrlCache: string | null = null;

async function baseUrl(): Promise<string> {
  if (baseUrlCache !== null) return baseUrlCache;
  const kali = (window as unknown as { kali?: { getSidecarPort: () => Promise<unknown> } }).kali;
  if (kali?.getSidecarPort) {
    try {
      const port = await kali.getSidecarPort();
      if (typeof port === "number") {
        baseUrlCache = `http://127.0.0.1:${port}`;
        return baseUrlCache;
      }
    } catch {
      // fall through
    }
  }
  baseUrlCache = "";
  return baseUrlCache;
}

interface ListResponse {
  connections: ConnectionSummary[];
}

interface CreatePayload {
  name: string;
  kind: ConnectionKind;
  api_url: string;
  api_format: ApiFormat;
  api_key?: string;
  vendor_detected?: string;
  models?: string[];
}

interface UpdatePayload {
  name?: string;
  api_url?: string;
  api_format?: ApiFormat;
  api_key?: string;
  vendor_detected?: string;
  models?: string[];
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/connections`);
  if (!res.ok) throw new Error(`listConnections ${res.status}`);
  const data = (await res.json()) as ListResponse;
  return data.connections ?? [];
}

export async function createConnection(payload: CreatePayload): Promise<ConnectionSummary> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `createConnection ${res.status}`);
  }
  return (await res.json()) as ConnectionSummary;
}

export async function updateConnection(id: string, patch: UpdatePayload): Promise<ConnectionSummary> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/connections/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `updateConnection ${res.status}`);
  }
  return (await res.json()) as ConnectionSummary;
}

export async function deleteConnection(id: string): Promise<void> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `deleteConnection ${res.status}`);
  }
}

export async function verifyApiKey(
  apiUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; detail: string }> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/connections/verify-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_url: apiUrl, api_key: apiKey }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `verifyApiKey ${res.status}`);
  }
  return (await res.json()) as { ok: boolean; detail: string };
}

export async function testConnection(
  apiUrl: string,
  apiKey = "",
  connectionId?: string,
): Promise<ConnectionTestResult> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/connections/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_url: apiUrl, api_key: apiKey, connection_id: connectionId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `testConnection ${res.status}`);
  }
  return (await res.json()) as ConnectionTestResult;
}

export interface ScanResult {
  port: number;
  url: string;
  vendor: string;
  models: string[];
}

export async function scanLocal(
  host: string,
  fromPort: number,
  toPort: number,
  signal?: AbortSignal,
): Promise<ScanResult[]> {
  const base = await baseUrl();
  const url = buildUrl(base, "/llm/scan");
  url.searchParams.set("host", host);
  url.searchParams.set("from_port", String(fromPort));
  url.searchParams.set("to_port", String(toPort));
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`scanLocal ${res.status}`);
  const data = (await res.json()) as { endpoints: ScanResult[] };
  return data.endpoints ?? [];
}

export async function listCloudProviders(): Promise<CloudProviderInfo[]> {
  const base = await baseUrl();
  const res = await fetch(`${base}/llm/cloud-providers`);
  if (!res.ok) throw new Error(`listCloudProviders ${res.status}`);
  const data = (await res.json()) as { providers: CloudProviderInfo[] };
  return data.providers ?? [];
}

export async function listModels(apiUrl: string, apiKey = ""): Promise<string[]> {
  const base = await baseUrl();
  const url = buildUrl(base, "/llm/models");
  url.searchParams.set("api_url", apiUrl);
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`listModels ${res.status}`);
  const data = (await res.json()) as { models: string[] };
  return data.models ?? [];
}

/** Build a URL relative to the resolved base.  `new URL("/llm/scan")` fails
 *  when `base` is the empty string (browser dev: Vite proxy uses same origin),
 *  so we fall back to a URL constructed against `window.location.origin`.
 */
function buildUrl(base: string, path: string): URL {
  if (base) return new URL(`${base}${path}`);
  return new URL(path, window.location.origin);
}