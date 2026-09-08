export const GROK_PARTITION = 'persist:batch-studio-grok';

const GROK_HOSTS = ['grok.com', 'x.com', 'twitter.com'];
const AUTH_HOSTS = ['accounts.google.com'];

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

export function isGrokNavigationUrl(target: string) {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return [...GROK_HOSTS, ...AUTH_HOSTS].some(allowed => hostMatches(host, allowed));
  } catch {
    return false;
  }
}

export function isOAuthPopupUrl(target: string) {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && AUTH_HOSTS.some(allowed => hostMatches(url.hostname.toLowerCase(), allowed));
  } catch {
    return false;
  }
}
