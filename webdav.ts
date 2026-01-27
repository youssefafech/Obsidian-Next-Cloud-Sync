import { requestUrl } from "obsidian";

export type WebDavPropfindResult = {
  etag: string | null;
  lastModified: string | null;
};

export type WebDavVersionEntry = {
  href: string;
  lastModified: string | null;
  etag: string | null;
  size: number | null;
};

export type WebDavListEntry = {
  path: string;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  isCollection: boolean;
};

export type WebDavResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
};

export type WebDavRequestError = {
  status: number;
  message: string;
};

const DEFAULT_TIMEOUT_MS = 30000;

function base64Encode(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value);
  }
  // Fallback for environments without btoa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = (globalThis as any).Buffer?.from(value, "utf8");
  return buffer ? buffer.toString("base64") : value;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/";
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function requestWithTimeout(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<WebDavResponse> {
  const response = await requestUrl({
    url,
    method: init.method,
    headers: init.headers,
    body: init.body,
    throw: false,
    timeout: timeoutMs,
  });

  const textValue = response.text ?? "";
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: "",
    text: async () => textValue,
  };
}

export class WebDavClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(baseUrl: string, username: string, password: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.authHeader = `Basic ${base64Encode(`${username}:${password}`)}`;
  }

  buildUrl(remotePath: string): string {
    const normalized = remotePath.replace(/^\/+/, "");
    return this.baseUrl + encodePath(normalized);
  }

  private toRemotePathFromHref(href: string): string | null {
    try {
      const base = new URL(this.baseUrl);
      const hrefUrl = new URL(href, base);
      const basePath = base.pathname.replace(/\/+$/, "") + "/";
      if (!hrefUrl.pathname.startsWith(basePath)) return null;
      const relative = hrefUrl.pathname.slice(basePath.length);
      return decodeURIComponent(relative);
    } catch {
      return null;
    }
  }

  private async propfindDocument(url: string, depth: string, body: string): Promise<Document> {
    const response = await requestWithTimeout(url, {
      method: "PROPFIND",
      headers: {
        Authorization: this.authHeader,
        Depth: depth,
        "Content-Type": "text/xml",
      },
      body,
    });

    if (!response.ok) {
      throw { status: response.status, message: response.statusText } as WebDavRequestError;
    }

    const text = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, "text/xml");
  }

  async propfind(remotePath: string): Promise<WebDavPropfindResult> {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getlastmodified />
  </d:prop>
</d:propfind>`;
    const xml = await this.propfindDocument(this.buildUrl(remotePath), "0", body);
    const etagNode = xml.querySelector("getetag");
    const mtimeNode = xml.querySelector("getlastmodified");

    return {
      etag: etagNode?.textContent ?? null,
      lastModified: mtimeNode?.textContent ?? null,
    };
  }

  async list(remotePath: string, depth = "1"): Promise<WebDavListEntry[]> {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getlastmodified />
    <d:getcontenttype />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;
    const xml = await this.propfindDocument(this.buildUrl(remotePath), depth, body);
    const responses = Array.from(xml.getElementsByTagName("response"));
    const entries: WebDavListEntry[] = [];
    for (const responseEl of responses) {
      const href = responseEl.querySelector("href")?.textContent?.trim();
      if (!href) continue;
      const path = this.toRemotePathFromHref(href);
      if (!path) continue;

      let propEl: Element | null = null;
      const propstats = Array.from(responseEl.getElementsByTagName("propstat"));
      for (const propstat of propstats) {
        const status = propstat.querySelector("status")?.textContent ?? "";
        if (status.includes(" 200 ")) {
          propEl = propstat.querySelector("prop");
          break;
        }
      }
      if (!propEl) {
        propEl = responseEl.querySelector("prop");
      }

      const etag = propEl?.querySelector("getetag")?.textContent ?? null;
      const lastModified = propEl?.querySelector("getlastmodified")?.textContent ?? null;
      const contentType = propEl?.querySelector("getcontenttype")?.textContent ?? null;
      const isCollection = !!propEl?.querySelector("resourcetype > collection");

      entries.push({
        path,
        etag,
        lastModified,
        contentType,
        isCollection,
      });
    }
    return entries;
  }

  async propfindFileId(remotePath: string): Promise<string | null> {
    const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:fileid />
  </d:prop>
</d:propfind>`;
    const xml = await this.propfindDocument(this.buildUrl(remotePath), "0", body);
    const fileIdNode = xml.querySelector("fileid");
    return fileIdNode?.textContent ?? null;
  }

  async propfindAbsolute(url: string, depth: string, body: string): Promise<Document> {
    return this.propfindDocument(url, depth, body);
  }

  async getAbsolute(url: string): Promise<WebDavResponse> {
    return requestWithTimeout(url, {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
      },
    });
  }

  async deleteAbsolute(url: string, headers: Record<string, string> = {}): Promise<WebDavResponse> {
    return requestWithTimeout(url, {
      method: "DELETE",
      headers: {
        Authorization: this.authHeader,
        ...headers,
      },
    });
  }

  async putAbsolute(url: string, content: string, headers: Record<string, string> = {}): Promise<WebDavResponse> {
    return requestWithTimeout(url, {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "text/calendar; charset=utf-8",
        ...headers,
      },
      body: content,
    });
  }

  async reportAbsolute(url: string, body: string, depth = "1"): Promise<Document> {
    const response = await requestWithTimeout(url, {
      method: "REPORT",
      headers: {
        Authorization: this.authHeader,
        Depth: depth,
        "Content-Type": "text/xml",
      },
      body,
    });

    if (!response.ok) {
      throw { status: response.status, message: response.statusText } as WebDavRequestError;
    }

    const text = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, "text/xml");
  }

  async get(remotePath: string): Promise<WebDavResponse> {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
      },
    });
  }

  async put(remotePath: string, content: string, headers: Record<string, string> = {}): Promise<WebDavResponse> {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "text/markdown; charset=utf-8",
        ...headers,
      },
      body: content,
    });
  }

  async mkcol(remotePath: string): Promise<WebDavResponse> {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "MKCOL",
      headers: {
        Authorization: this.authHeader,
      },
    });
  }

  async delete(remotePath: string, headers: Record<string, string> = {}): Promise<WebDavResponse> {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "DELETE",
      headers: {
        Authorization: this.authHeader,
        ...headers,
      },
    });
  }

  async move(remotePath: string, destinationPath: string, overwrite = true): Promise<WebDavResponse> {
    return requestWithTimeout(this.buildUrl(remotePath), {
      method: "MOVE",
      headers: {
        Authorization: this.authHeader,
        Destination: this.buildUrl(destinationPath),
        Overwrite: overwrite ? "T" : "F",
      },
    });
  }
}
