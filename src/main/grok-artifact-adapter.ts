import type { WebContents } from 'electron';
import { canonicalGrokConversationUrl } from './grok-navigation.js';

export interface GrokArtifactCandidate {
  kind: 'code' | 'link';
  text: string;
  url: string;
  name: string;
}
export interface GrokArtifactObservation {
  conversation: string | null;
  revision: number;
  candidates: GrokArtifactCandidate[];
}

// Only stable semantic DOM features are inspected. No page HTML, cookies, or
// unrelated chat history is passed to the main process.
export async function observeGrokArtifact(
  contents: WebContents,
  fileName: string,
): Promise<GrokArtifactObservation> {
  const result = await contents.executeJavaScript(`(() => {
    const filename = ${JSON.stringify(fileName)};
    const key = '__batchStudioArtifactObserverV1';
    if (!window[key]) {
      const state = { revision: 0 };
      const observer = new MutationObserver(() => { state.revision++; });
      observer.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['href', 'download', 'aria-label'],
      });
      window[key] = { state, observer };
    }
    const candidates = [];
    for (const element of [...document.querySelectorAll('pre code')].slice(-12)) {
      const text = element.textContent || '';
      if (text && text.length <= 10_000_000)
        candidates.push({ kind: 'code', text, url: '', name: filename });
    }
    for (const anchor of [...document.querySelectorAll('a[href]')].slice(-300)) {
      const name = anchor.getAttribute('download') ||
        anchor.getAttribute('aria-label') || anchor.textContent || '';
      if (name.trim().includes(filename))
        candidates.push({ kind: 'link', text: '', url: anchor.href || '', name: name.trim().slice(0, 256) });
    }
    return { conversation: location.href, revision: window[key].state.revision, candidates: candidates.slice(-16) };
  })()`, true) as {
    conversation?: unknown;
    revision?: unknown;
    candidates?: unknown;
  };
  const conversation =
    typeof result?.conversation === 'string'
      ? canonicalGrokConversationUrl(result.conversation)
      : null;
  const candidates = Array.isArray(result?.candidates)
    ? result.candidates.filter((item): item is GrokArtifactCandidate => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return (
          (record.kind === 'code' || record.kind === 'link') &&
          typeof record.text === 'string' &&
          record.text.length <= 10_000_000 &&
          typeof record.url === 'string' &&
          record.url.length <= 4096 &&
          typeof record.name === 'string'
        );
      })
    : [];
  return { conversation, revision: Number(result.revision) || 0, candidates };
}

export function isSafeGrokArtifactLink(value: string, fileName: string): boolean {
  if (!value || !fileName) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'blob:') {
      const inner = new URL(url.pathname);
      return inner.protocol === 'https:' && inner.hostname === 'grok.com';
    }
    return url.protocol === 'https:' &&
      (url.hostname === 'grok.com' || url.hostname.endsWith('.grok.com'));
  } catch {
    return false;
  }
}
