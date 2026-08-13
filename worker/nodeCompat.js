/**
 * Node-style request/response adapter — Phase 12 D6.
 *
 * Cloudflare Workers hand you a `Request` and want a `Response`. The 58
 * handlers in api/ were written for Vercel's Node runtime and expect
 * `(req, res)`. Rather than rewrite all of them — which on a billing system
 * would mean re-verifying 800 tests to gain nothing — this adapts between the
 * two shapes.
 *
 * The surface is genuinely small, which is what makes the approach sound. A
 * survey of api/ found the handlers use exactly:
 *
 *   req   method, headers, body, query, and a readable stream
 *   res   setHeader, status().json(), status().send(), writableEnded
 *
 * THE ONE THING THIS MUST NOT GET WRONG is the raw body. `readRawBody()` in
 * api/_lib/handler.js needs the EXACT bytes Paystack signed — re-serialising a
 * parsed object changes key order, whitespace and unicode escaping, and the
 * HMAC then fails on every legitimate webhook. So the bytes are read once, up
 * front, and handed over untouched.
 */

/** Same ceiling the middleware chain enforces, applied before we buffer. */
const MAX_BODY_BYTES = 256 * 1024;

class NodeResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = new Headers();
    this.body = null;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    // Node's setHeader REPLACES; Headers.append would accumulate duplicates and
    // produce things like "Cache-Control: no-store, no-store".
    this.headers.set(name, String(value));
    return this;
  }

  getHeader(name) {
    return this.headers.get(name);
  }

  removeHeader(name) {
    this.headers.delete(name);
    return this;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(payload) {
    if (!this.headers.has('Content-Type')) {
      this.headers.set('Content-Type', 'application/json; charset=utf-8');
    }
    this.body = JSON.stringify(payload);
    this.writableEnded = true;
    return this;
  }

  send(payload) {
    if (typeof payload === 'object' && payload !== null && !(payload instanceof Uint8Array)) {
      return this.json(payload);
    }
    this.body = payload;
    this.writableEnded = true;
    return this;
  }

  end(payload) {
    if (payload !== undefined) this.body = payload;
    this.writableEnded = true;
    return this;
  }

  toResponse() {
    // 204 and 304 must not carry a body; a Worker returning one throws.
    const bodyless = this.statusCode === 204 || this.statusCode === 304;
    return new Response(bodyless ? null : this.body, {
      status: this.statusCode,
      headers: this.headers,
    });
  }
}

/**
 * Builds the `req` object the handlers expect.
 *
 * @param {Request} request
 * @param {object}  [pathParams]  from the route table, e.g. { secret: '...' }
 */
export async function toNodeRequest(request, pathParams = {}) {
  const url = new URL(request.url);

  // Header names are lower-cased, matching Node. Handlers index them directly
  // (`req.headers['content-type']`, `req.headers.authorization`), so the case
  // has to be predictable.
  const headers = {};
  for (const [key, value] of request.headers) {
    headers[key.toLowerCase()] = value;
  }

  // Search params first, then path params — a route parameter is structural
  // and must not be overridable by a query string of the same name. The Daraja
  // callback authenticates on `req.query.secret`, so letting `?secret=` win
  // would hand an attacker the check.
  const query = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  Object.assign(query, pathParams);

  let rawBody = null;
  const hasBody = !['GET', 'HEAD'].includes(request.method);

  if (hasBody) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      // Signalled rather than thrown so the caller can answer 413 in the
      // handlers' own error shape.
      return { tooLarge: true };
    }
    rawBody = Buffer.from(buffer);
  }

  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query,
    // The exact signed bytes. `readRawBody()` returns this untouched, and
    // `parseJsonBody()` parses it — so nothing between the wire and the HMAC
    // ever re-serialises the payload.
    body: rawBody,
    // There is no stream left to read: arrayBuffer() consumed it. Saying so
    // sends readRawBody down its Buffer branch instead of trying to iterate.
    readable: false,
    socket: null,
  };
}

export function createNodeResponse() {
  return new NodeResponse();
}

export { MAX_BODY_BYTES, NodeResponse };
