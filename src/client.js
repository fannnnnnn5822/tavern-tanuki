/**
 * SillyTavern HTTP API client.
 *
 * Handles Basic Auth, CSRF token acquisition and session cookies so that
 * every endpoint can be called with a single `post()` / `get()`.
 *
 * Configuration comes from the constructor or environment variables:
 *   ST_URL      (default: http://127.0.0.1:8000)
 *   ST_USER     (optional, HTTP Basic Auth user)
 *   ST_PASSWORD (optional, HTTP Basic Auth password)
 */
export class STClient {
  constructor({ baseUrl, user, password } = {}) {
    this.baseUrl = (baseUrl ?? process.env.ST_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
    this.user = user ?? process.env.ST_USER ?? '';
    this.password = password ?? process.env.ST_PASSWORD ?? '';
    this.csrfToken = null;
    this.cookies = new Map();
  }

  #authHeader() {
    if (!this.user && !this.password) return {};
    const b64 = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return { Authorization: `Basic ${b64}` };
  }

  #cookieHeader() {
    if (this.cookies.size === 0) return {};
    const value = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    return { Cookie: value };
  }

  #storeCookies(response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const line of setCookies) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /** Fetch a CSRF token (and session cookie). Called lazily; retried on 403. */
  async init() {
    const res = await fetch(`${this.baseUrl}/csrf-token`, {
      headers: { ...this.#authHeader() },
    });
    this.#storeCookies(res);
    if (!res.ok) {
      throw new Error(`CSRF token request failed: HTTP ${res.status}. Check ST_URL/ST_USER/ST_PASSWORD.`);
    }
    const data = await res.json();
    this.csrfToken = data.token;
  }

  async #request(method, path, body, retry = true) {
    if (!this.csrfToken) await this.init();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.csrfToken,
        ...this.#authHeader(),
        ...this.#cookieHeader(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.#storeCookies(res);
    if (res.status === 403 && retry) {
      // Session/CSRF expired — refresh once and retry.
      this.csrfToken = null;
      return this.#request(method, path, body, false);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  post(path, body = {}) {
    return this.#request('POST', path, body);
  }

  get(path) {
    return this.#request('GET', path, undefined);
  }
}
