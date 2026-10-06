export const runtime = "nodejs";
export const maxDuration = 30;

type Context = { params: Promise<{ path: string[] }> };
const LIMIT = 27 * 1024 * 1024;

function backend() {
  const configured = process.env.AGENT_API_URL;
  if (!configured && process.env.VERCEL) return null;
  return new URL(configured || "http://127.0.0.1:8000");
}
function isLocal(url: URL) { return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); }
function permitted(path: string, method: string) {
  return method === "GET" && /^(status|sessions\/[a-z0-9-]{36})$/.test(path)
    || method === "POST" && /^(configuration|sessions|sessions\/[a-z0-9-]{36}\/(reply|retry|review))$/.test(path);
}
async function proxy(request: Request, context: Context) {
  const path = (await context.params).path.join("/");
  if (!permitted(path, request.method)) return Response.json({ detail: "Unknown agent action." }, { status: 404 });
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    // Next's internal URL can use localhost while the browser uses 127.0.0.1.
    // Restrict the demo to its explicit loopback origins, including against DNS rebinding.
    const localOrigins = ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"];
    const allowed = process.env.VERCEL ? origin === new URL(request.url).origin : localOrigins.includes(origin ?? "");
    if (origin && !allowed) return Response.json({ detail: "Open this action from ESWriter." }, { status: 403 });
  }
  let upstream: URL | null;
  try { upstream = backend(); }
  catch { return Response.json({ detail: "The agent address is not configured correctly." }, { status: 503 }); }
  const unavailable = "The local agent isn’t running. Start the hackathon demo with npm run demo, then check the connection.";
  if (!upstream) {
    if (path === "status") return Response.json({ connected: false, ready: false, canConfigure: false, message: "The connected hackathon demo runs locally. Open localhost:3000 after starting npm run demo." });
    return Response.json({ detail: "This deployment has no agent service configured. Use the local hackathon demo." }, { status: 503 });
  }
  if (path === "configuration" && (!isLocal(upstream) || process.env.VERCEL)) return Response.json({ detail: "Claude setup is available only in the local demo." }, { status: 403 });
  const headers = new Headers({ "X-Template-Studio": "local-demo" });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  if (process.env.AGENT_API_TOKEN) headers.set("Authorization", `Bearer ${process.env.AGENT_API_TOKEN}`);
  let body: Uint8Array | undefined;
  if (request.method === "POST") {
    if (!contentType?.startsWith("application/json") && !contentType?.startsWith("multipart/form-data")) return Response.json({ detail: "Use a supported request format." }, { status: 415 });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > LIMIT) { await reader.cancel(); return Response.json({ detail: "The audit material is too large for this demo." }, { status: 413 }); }
        chunks.push(chunk.value);
      }
    }
    body = new Uint8Array(size);
    let offset = 0;
    chunks.forEach(chunk => { body!.set(chunk, offset); offset += chunk.byteLength; });
  }
  try {
    const url = new URL(`${upstream.pathname.replace(/\/$/, "")}/${path}`, upstream.origin);
    const response = await fetch(url, { method: request.method, headers, body: body as BodyInit | undefined, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (path === "status") {
      result.canConfigure = result.canConfigure && isLocal(upstream) && !process.env.VERCEL;
      if (process.env.VERCEL) result.maxRequestBytes = 4_000_000;
    }
    return Response.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    if (path === "status") return Response.json({ connected: false, ready: false, canConfigure: false, message: unavailable });
    return Response.json({ detail: "The local agent could not be reached. Check that the demo is running, then retry." }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
