import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../crypto";
import { log } from "../logger";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  provider: string;
  query: string;
  latencyMs: number;
}

// ---------- Free / no-key providers ----------

async function searchDuckDuckGo(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  // Use DDG HTML endpoint (no key). Parse result links.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "text/html",
    },
    signal: signal ?? AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  // Parse result__a links
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null && snippets.length < 30) {
    snippets.push(stripTags(decodeEntities(sm[1])).slice(0, 500));
  }
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < maxResults) {
    let href = decodeEntities(m[1]);
    // DDG wraps with //duckduckgo.com/l/?uddg=<encoded>
    const uddg = /uddg=([^&"]+)/.exec(href);
    if (uddg) {
      try { href = decodeURIComponent(uddg[1]); } catch { /* keep */ }
    }
    if (href.startsWith("//")) href = "https:" + href;
    if (!href.startsWith("http")) { i++; continue; }
    if (href.includes("duckduckgo.com/")) { i++; continue; }
    const title = stripTags(decodeEntities(m[2])).slice(0, 300) || href;
    let domain = "";
    try { domain = new URL(href).hostname; } catch { domain = "web"; }
    results.push({ title, url: href, snippet: snippets[i] || "", source: domain });
    i++;
  }
  return results;
}

async function searchWikipedia(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}&origin=*`;
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
  const json = await res.json();
  const hits = (json.query?.search ?? []) as Array<{ title: string; snippet: string; timestamp?: string }>;
  return hits.map((h) => ({
    title: h.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    snippet: stripTags(h.snippet ?? "").slice(0, 500),
    source: "wikipedia.org",
    publishedAt: h.timestamp,
  }));
}

// ---------- Paid / keyed providers (optional) ----------

async function searchTavily(apiKey: string, query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: "advanced", include_answer: false }),
    signal: signal ?? AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Tavily returned HTTP ${res.status}`);
  const json = await res.json();
  return ((json.results ?? []) as Array<{ title: string; url: string; content: string; published_date?: string }>)
    .map((r) => {
      let domain = "";
      try { domain = new URL(r.url).hostname; } catch { domain = "tavily"; }
      return { title: r.title, url: r.url, snippet: (r.content ?? "").slice(0, 600), source: domain, publishedAt: r.published_date };
    });
}

async function searchBrave(apiKey: string, query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: signal ?? AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Brave returned HTTP ${res.status}`);
  const json = await res.json();
  const items = (json.web?.results ?? []) as Array<{ title: string; url: string; description: string; age?: string }>;
  return items.map((r) => {
    let domain = "";
    try { domain = new URL(r.url).hostname; } catch { domain = "brave"; }
    return { title: r.title, url: r.url, snippet: (r.description ?? "").slice(0, 600), source: domain };
  });
}

async function searchSerper(apiKey: string, query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: signal ?? AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Serper returned HTTP ${res.status}`);
  const json = await res.json();
  const items = (json.organic ?? []) as Array<{ title: string; link: string; snippet: string; date?: string }>;
  return items.map((r) => {
    let domain = "";
    try { domain = new URL(r.link).hostname; } catch { domain = "serper"; }
    return { title: r.title, url: r.link, snippet: (r.snippet ?? "").slice(0, 600), source: domain, publishedAt: r.date };
  });
}

async function searchSearXNG(baseUrl: string, query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {
    signal: signal ?? AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`SearXNG returned HTTP ${res.status}`);
  const json = await res.json();
  const items = (json.results ?? []) as Array<{ title: string; url: string; content: string; publishedDate?: string }>;
  return items.slice(0, maxResults).map((r) => {
    let domain = "";
    try { domain = new URL(r.url).hostname; } catch { domain = "searxng"; }
    return { title: r.title, url: r.url, snippet: (r.content ?? "").slice(0, 600), source: domain };
  });
}

// ---------- Orchestrator ----------

export async function getSearchConnectors() {
  try {
    return await db.select().from(connectors);
  } catch {
    return [];
  }
}

export async function webSearch(query: string, opts?: { maxResults?: number; privacyMode?: boolean; signal?: AbortSignal }): Promise<SearchResponse> {
  const start = Date.now();
  const maxResults = Math.min(20, Math.max(1, opts?.maxResults ?? 8));
  const errors: string[] = [];

  // Privacy mode: only self-hosted SearXNG allowed (no cloud search APIs, no external DDG/Wikipedia? DDG is external).
  // In privacy mode we allow SearXNG if configured; otherwise refuse cloud search.
  if (opts?.privacyMode) {
    const rows = await getSearchConnectors();
    const searx = rows.find((r) => r.type === "search_searxng" && r.enabled);
    if (searx) {
      const baseUrl = (searx.config as { baseUrl?: string })?.baseUrl || "";
      if (baseUrl) {
        try {
          const results = await searchSearXNG(baseUrl, query, maxResults, opts?.signal);
          return { results, provider: "searxng (local)", query, latencyMs: Date.now() - start };
        } catch (e) {
          throw new Error(`Privacy Mode: self-hosted search failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    throw new Error("Privacy Mode is on: cloud web search is disabled. Configure a self-hosted SearXNG connector to search privately, or turn Privacy Mode off.");
  }

  // 1. Try configured keyed providers first (best quality)
  try {
    const rows = await getSearchConnectors();
    const keyed = rows.filter((r) => r.enabled && ["search_tavily", "search_brave", "search_serper", "search_searxng"].includes(r.type));
    for (const c of keyed) {
      try {
        const secrets = c.secretsEncrypted ? JSON.parse(decryptSecret(c.secretsEncrypted) || "{}") : {};
        if (c.type === "search_tavily" && secrets.apiKey) {
          const results = await searchTavily(secrets.apiKey, query, maxResults, opts?.signal);
          if (results.length) return { results, provider: "tavily", query, latencyMs: Date.now() - start };
        } else if (c.type === "search_brave" && secrets.apiKey) {
          const results = await searchBrave(secrets.apiKey, query, maxResults, opts?.signal);
          if (results.length) return { results, provider: "brave", query, latencyMs: Date.now() - start };
        } else if (c.type === "search_serper" && secrets.apiKey) {
          const results = await searchSerper(secrets.apiKey, query, maxResults, opts?.signal);
          if (results.length) return { results, provider: "serper", query, latencyMs: Date.now() - start };
        } else if (c.type === "search_searxng") {
          const baseUrl = (c.config as { baseUrl?: string })?.baseUrl || "";
          if (baseUrl) {
            const results = await searchSearXNG(baseUrl, query, maxResults, opts?.signal);
            if (results.length) return { results, provider: "searxng", query, latencyMs: Date.now() - start };
          }
        }
      } catch (e) {
        errors.push(`${c.type}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    errors.push(`connector lookup: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Free providers (no key): DDG + Wikipedia in parallel
  const [ddg, wiki] = await Promise.allSettled([
    searchDuckDuckGo(query, maxResults, opts?.signal),
    searchWikipedia(query, 3, opts?.signal),
  ]);
  const merged: SearchResult[] = [];
  if (ddg.status === "fulfilled") merged.push(...ddg.value);
  else errors.push(`duckduckgo: ${ddg.reason instanceof Error ? ddg.reason.message : String(ddg.reason)}`);
  if (wiki.status === "fulfilled") {
    for (const w of wiki.value) {
      if (!merged.some((m) => m.url === w.url)) merged.push(w);
    }
  }
  if (merged.length) {
    await log("info", "search", `Search "${query}" → ${merged.length} results (free providers)`);
    return { results: merged.slice(0, maxResults), provider: "duckduckgo+wikipedia (free)", query, latencyMs: Date.now() - start };
  }
  await log("error", "search", `Search failed: ${query}`, { errors });
  throw new Error(`Web search failed. ${errors.slice(0, 2).join(" ")} Configure Tavily/Brave/Serper in Connectors for higher reliability.`);
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (family === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return true;
    if (normalized.startsWith("::ffff:")) {
      const tail = normalized.slice("::ffff:".length);
      if (isIP(tail) === 4) return isPrivateAddress(tail);
      const parts = tail.split(":");
      if (parts.length === 2) {
        const n = parts.map((part) => Number.parseInt(part, 16));
        if (n.every(Number.isFinite)) return isPrivateAddress(`${n[0] >> 8}.${n[0] & 255}.${n[1] >> 8}.${n[1] & 255}`);
      }
    }
    return false;
  }
  return true;
}

export async function assertPublicHttpUrl(input: string | URL): Promise<URL> {
  let parsed: URL;
  try { parsed = input instanceof URL ? new URL(input.toString()) : new URL(input); }
  catch { throw new Error("Invalid URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http(s) URLs are allowed.");
  if (parsed.username || parsed.password) throw new Error("URLs containing credentials are not allowed.");
  if (parsed.port && !["80", "443"].includes(parsed.port)) throw new Error("Only standard public web ports are allowed.");
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Blocked: local network URLs are not allowed.");
  }
  const family = isIP(host.replace(/^\[|\]$/g, ""));
  if (family) {
    if (isPrivateAddress(host.replace(/^\[|\]$/g, ""))) throw new Error("Blocked: local or reserved IP addresses are not allowed.");
  } else {
    let addresses: Array<{ address: string; family: number }>;
    try { addresses = await lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error("The public hostname could not be resolved."); }
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("Blocked: the hostname resolves to a local or reserved IP address.");
    }
  }
  return parsed;
}

export async function fetchWebpage(url: string, opts?: { maxChars?: number; signal?: AbortSignal }): Promise<{ title: string; text: string; url: string }> {
  let current = await assertPublicHttpUrl(url);
  let res: Response | null = null;
  // Revalidate each hop instead of allowing fetch() to follow an unchecked redirect.
  for (let redirects = 0; redirects <= 3; redirects++) {
    res = await fetch(current.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json",
      },
      signal: opts?.signal ?? AbortSignal.timeout(25000),
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(res.status)) break;
    const location = res.headers.get("location");
    if (!location || redirects === 3) throw new Error("Page redirect limit reached.");
    current = await assertPublicHttpUrl(new URL(location, current));
  }
  if (!res) throw new Error("No response from the page.");
  if (!res.ok) throw new Error(`Fetch failed (HTTP ${res.status})`);
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > 5_000_000) throw new Error("Page is too large to retrieve safely.");
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const raw = (await res.text()).slice(0, 5_000_000);
  const maxChars = Math.min(30000, Math.max(500, opts?.maxChars ?? 12000));
  if (contentType.includes("application/json") || contentType.startsWith("text/plain")) {
    return { title: current.hostname, text: raw.slice(0, maxChars), url: current.toString() };
  }
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error(`Unsupported page content type: ${contentType.split(";")[0]}.`);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? current.hostname;
  const body = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = stripTags(decodeEntities(body)).replace(/\s+/g, " ").trim().slice(0, maxChars);
  return { title: stripTags(decodeEntities(title)).trim().slice(0, 300), text, url: current.toString() };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
