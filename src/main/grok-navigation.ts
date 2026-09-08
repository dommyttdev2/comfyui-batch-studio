export const GROK_PARTITION = 'persist:batch-studio-grok';

const GROK_HOSTS = ['grok.com', 'x.ai', 'x.com', 'twitter.com'];
const AUTH_ENTRY_HOSTS = ['accounts.google.com'];

function hostMatches(hostname: string, allowed: string) {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

export function isSafeExternalUrl(target: string) {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSecureWebUrl(target: string) {
  try {
    return new URL(target).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isGrokNavigationUrl(target: string) {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return [...GROK_HOSTS, ...AUTH_ENTRY_HOSTS].some(allowed => hostMatches(host, allowed));
  } catch {
    return false;
  }
}

export function canonicalGrokConversationUrl(target: string): string | null {
  try {
    const url = new URL(target);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !hostMatches(host, 'grok.com')) return null;
    const match = url.pathname.match(/^\/c\/([^/?#]+)/);
    return match ? `https://grok.com/c/${encodeURIComponent(decodeURIComponent(match[1]))}` : null;
  } catch {
    return null;
  }
}

export function isOAuthPopupUrl(target: string) {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && AUTH_ENTRY_HOSTS.some(allowed => hostMatches(url.hostname.toLowerCase(), allowed));
  } catch {
    return false;
  }
}
