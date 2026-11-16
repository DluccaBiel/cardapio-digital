/**
 * Leitura de páginas públicas do site do lead.
 * Regras:
 * - Apenas páginas públicas (home/about/contato) — nunca áreas logadas ou scraping em massa.
 * - Timeout de 8s por requisição.
 * - SSRF guard: só http/https, bloqueia localhost/IP privado e revalida CADA redirect.
 * - User-Agent padronizado, accept-language pt-BR.
 *
 * Limitação: o guard checa o hostname literal; DNS que resolve para IP privado
 * não é detectado aqui (resolver/pinnar IP antes de usar em produção).
 */

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const USER_AGENT = 'UndercutBot/1.0 (+https://undercuthub.vercel.app)';
const MAX_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 1_000_000;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', '0.0.0.0']);

// ============================================================
// TIPOS
// ============================================================

export type PublicPageResult = {
  url: string;
  title: string;
  htmlSnippet: string; // trecho de texto limpo (tags removidas)
  textContent: string; // versão texto-only (até 2000 chars)
  metaDescription: string | null;
  h1: string[];
  links: Array<{ href: string; text: string }>; // links relevantes
  loadingError: boolean;
  responseTimeMs: number;
};

// ============================================================
// SSRF GUARD
// ============================================================

export function isUrlBloqueada(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;

  // IPv6 literal: bloqueia loopback, link-local e ULA
  if (host.includes(':')) return host === '::1' || /^(fe80|fc|fd)/.test(host) || host.startsWith('::ffff:');

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return false;
}

function erro(url: string, startTime: number): PublicPageResult {
  return {
    url,
    title: '',
    htmlSnippet: '',
    textContent: '',
    metaDescription: null,
    h1: [],
    links: [],
    loadingError: true,
    responseTimeMs: Date.now() - startTime,
  };
}

// ============================================================
// FUNÇÃO PRINCIPAL: Buscar página pública
// ============================================================

export async function fetchPublicPage(url: string): Promise<PublicPageResult> {
  const startTime = Date.now();
  let currentUrl = url;
  let res: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isUrlBloqueada(currentUrl)) return erro(url, startTime);

    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
        redirect: 'manual', // cada redirect é revalidado pelo guard
        signal: AbortSignal.timeout(MAX_TIMEOUT_MS),
      });
    } catch {
      return erro(url, startTime);
    }

    if (res.status < 300 || res.status >= 400) break;
    const location = res.headers.get('location');
    if (!location || hop === MAX_REDIRECTS) return erro(url, startTime);
    currentUrl = new URL(location, currentUrl).toString();
  }

  if (!res || !res.ok) return erro(url, startTime);

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) return erro(url, startTime);

  let html: string;
  try {
    html = (await res.text()).slice(0, MAX_HTML_BYTES);
  } catch {
    return erro(url, startTime);
  }

  const result = extrairDoHTML(html, currentUrl);
  result.responseTimeMs = Date.now() - startTime;
  return result;
}

// ============================================================
// EXTRAÇÃO DE DADOS DO HTML
// ============================================================

function semTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extrairDoHTML(html: string, url: string): PublicPageResult {
  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const textOnly = semTags(cleanHtml).substring(0, 2000);

  const titleMatch = cleanHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? semTags(titleMatch[1]) : '';

  const h1: string[] = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m: RegExpExecArray | null;
  while ((m = h1Regex.exec(cleanHtml)) && h1.length < 5) {
    const clean = semTags(m[1]);
    if (clean) h1.push(clean);
  }

  const metaDescMatch = cleanHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const metaDescription = metaDescMatch ? metaDescMatch[1] : null;

  const links: Array<{ href: string; text: string }> = [];
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = linkRegex.exec(cleanHtml)) && links.length < 10) {
    const text = semTags(m[2]);
    if (!text) continue;
    try {
      const parsed = new URL(m[1], url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') links.push({ href: parsed.toString(), text });
    } catch {
      // ignora URLs malformadas
    }
  }

  return {
    url,
    title: title || 'Sem título',
    htmlSnippet: textOnly.substring(0, 300),
    textContent: textOnly,
    metaDescription,
    h1,
    links,
    loadingError: false,
    responseTimeMs: 0,
  };
}

/** Placeholder: robots.txt ainda não é consultado (ver cabeçalho do arquivo). */
export function verificarRobotsTxt(_domain: string): boolean {
  return true;
}
