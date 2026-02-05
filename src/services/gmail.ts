import type { GmailMessage, GmailMessagePart, ParsedEmail, GmailListResponse, SenderGroup } from '../types/gmail';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function parseEmailAddress(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].replace(/"/g, '').trim(), email: match[2] };
  }
  return { name: from, email: from };
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers) return '';
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

function decodeBase64Url(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return '';
  }
}

function extractFromParts(parts: GmailMessagePart[] | undefined, mimeType: string): string {
  if (!parts) return '';

  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      const result = extractFromParts(part.parts, mimeType);
      if (result) return result;
    }
  }

  return '';
}

function extractBodies(message: GmailMessage): { text: string; html: string } {
  const payload = message.payload;
  if (!payload) return { text: message.snippet ?? '', html: '' };

  let text = '';
  let html = '';

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  if (payload.parts) {
    text = extractFromParts(payload.parts, 'text/plain') || text;
    html = extractFromParts(payload.parts, 'text/html') || html;
  }

  if (!text && !html) {
    text = message.snippet ?? '';
  }

  return { text, html };
}

export function parseGmailMessage(message: GmailMessage): ParsedEmail | null {
  if (!message || !message.id || !message.payload) {
    return null;
  }

  const headers = message.payload.headers;
  const fromRaw = getHeader(headers, 'From');
  const { name, email } = parseEmailAddress(fromRaw || 'Unknown');
  const { text, html } = extractBodies(message);

  return {
    id: message.id,
    threadId: message.threadId ?? message.id,
    from: name || 'Unknown',
    fromEmail: email || 'unknown@unknown.com',
    subject: getHeader(headers, 'Subject') || '(no subject)',
    snippet: message.snippet ?? '',
    bodyText: text,
    bodyHtml: html,
    date: new Date(parseInt(message.internalDate ?? '0')),
    isUnread: message.labelIds?.includes('UNREAD') ?? false,
    isStarred: message.labelIds?.includes('STARRED') ?? false,
    isImportant: message.labelIds?.includes('IMPORTANT') ?? false,
    labels: message.labelIds ?? [],
  };
}

async function fetchMessage(
  accessToken: string,
  messageId: string,
  retryCount = 0
): Promise<GmailMessage | null> {
  try {
    const response = await fetch(
      `${GMAIL_API_BASE}/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (response.status === 429) {
      // Rate limited - exponential backoff
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 500 + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchMessage(accessToken, messageId, retryCount + 1);
      }
      return null;
    }

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

export interface LoadingProgress {
  phase: 'listing' | 'fetching';
  total: number;
  loaded: number;
}

// Concurrency limiter to avoid overwhelming the API
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
      completed++;
      onProgress?.(completed);
    }
  }

  // Start concurrent workers
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

export async function fetchAllUnreadEmails(
  accessToken: string,
  onProgress?: (progress: LoadingProgress) => void
): Promise<ParsedEmail[]> {
  const allMessageIds: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  // Phase 1: Fetch all message IDs (fast)
  do {
    const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
    listUrl.searchParams.set('q', 'is:unread in:inbox');
    listUrl.searchParams.set('maxResults', '500');
    if (pageToken) {
      listUrl.searchParams.set('pageToken', pageToken);
    }

    const listResponse = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to fetch emails: ${listResponse.statusText}`);
    }

    const listData: GmailListResponse = await listResponse.json();

    if (listData.messages) {
      allMessageIds.push(...listData.messages);
    }

    pageToken = listData.nextPageToken;
    onProgress?.({ phase: 'listing', total: allMessageIds.length, loaded: 0 });
  } while (pageToken);

  if (allMessageIds.length === 0) {
    return [];
  }

  const total = allMessageIds.length;

  // Phase 2: Fetch full message details with controlled concurrency
  const messages = await parallelMap(
    allMessageIds,
    (msg) => fetchMessage(accessToken, msg.id),
    15, // 15 concurrent requests - balances speed vs rate limits
    (completed) => {
      onProgress?.({ phase: 'fetching', total, loaded: completed });
    }
  );

  // Parse and filter valid messages
  const emails: ParsedEmail[] = [];
  for (const msg of messages) {
    if (msg) {
      const parsed = parseGmailMessage(msg);
      if (parsed) {
        emails.push(parsed);
      }
    }
  }

  return emails;
}

export function groupEmailsBySender(emails: ParsedEmail[]): SenderGroup[] {
  const groups = new Map<string, SenderGroup>();

  for (const email of emails) {
    const key = email.fromEmail.toLowerCase();
    const existing = groups.get(key);

    if (existing) {
      existing.emails.push(email);
    } else {
      groups.set(key, {
        senderEmail: email.fromEmail,
        senderName: email.from,
        emails: [email],
      });
    }
  }

  const sortedGroups = Array.from(groups.values());

  for (const group of sortedGroups) {
    group.emails.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  sortedGroups.sort((a, b) => {
    const aLatest = a.emails[0].date.getTime();
    const bLatest = b.emails[0].date.getTime();
    return bLatest - aLatest;
  });

  return sortedGroups;
}

export async function markAsRead(accessToken: string, messageId: string): Promise<void> {
  const url = `${GMAIL_API_BASE}/messages/${messageId}/modify`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removeLabelIds: ['UNREAD'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to mark as read: ${response.statusText}`);
  }
}

export async function markAsUnread(accessToken: string, messageId: string): Promise<void> {
  const url = `${GMAIL_API_BASE}/messages/${messageId}/modify`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addLabelIds: ['UNREAD'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to mark as unread: ${response.statusText}`);
  }
}

export async function markMultipleAsUnread(accessToken: string, messageIds: string[]): Promise<void> {
  await parallelMap(messageIds, (id) => markAsUnread(accessToken, id), 10);
}

export async function markMultipleAsRead(accessToken: string, messageIds: string[]): Promise<void> {
  // Mark in parallel with concurrency limit
  await parallelMap(messageIds, (id) => markAsRead(accessToken, id), 10);
}

// Reader view utilities - uses markup structure to extract main content
export function extractReaderContent(html: string): string {
  if (!html) return '';

  const div = document.createElement('div');
  div.innerHTML = html;

  // Remove elements by semantic selectors (classes, ids, roles commonly used in email templates)
  const selectorsToRemove = [
    // Footer patterns
    '[class*="footer"]', '[id*="footer"]',
    '[class*="Footer"]', '[id*="Footer"]',
    // Signatures
    '[class*="signature"]', '[id*="signature"]',
    '[class*="Signature"]', '[id*="Signature"]',
    // Legal/disclaimers
    '[class*="disclaimer"]', '[class*="legal"]',
    '[class*="Disclaimer"]', '[class*="Legal"]',
    // Unsubscribe sections
    '[class*="unsubscribe"]', '[class*="Unsubscribe"]',
    '[class*="optout"]', '[class*="opt-out"]',
    // Social/sharing
    '[class*="social"]', '[class*="Social"]',
    '[class*="share"]', '[class*="Share"]',
    // Privacy/terms
    '[class*="privacy"]', '[class*="Privacy"]',
    '[class*="terms"]', '[class*="Terms"]',
    // Powered by
    '[class*="powered"]', '[class*="Powered"]',
    // Preheader (hidden preview text)
    '[class*="preheader"]', '[class*="Preheader"]',
    '[class*="preview"]', '[class*="Preview"]',
    // Hidden elements
    '[style*="display:none"]', '[style*="display: none"]',
    '[aria-hidden="true"]',
    // Tracking pixels
    'img[width="1"]', 'img[height="1"]',
    'img[src*="track"]', 'img[src*="pixel"]', 'img[src*="beacon"]',
  ];

  selectorsToRemove.forEach(selector => {
    try {
      div.querySelectorAll(selector).forEach(el => el.remove());
    } catch {
      // Invalid selector, skip
    }
  });

  // Remove very small text (typically legal fine print) - check computed or inline styles
  div.querySelectorAll('*').forEach(el => {
    const style = (el as HTMLElement).style;
    const fontSize = style?.fontSize;
    if (fontSize) {
      const size = parseInt(fontSize);
      if (size > 0 && size < 10) {
        el.remove();
      }
    }
  });

  // Remove elements that contain only links (navigation/footer links)
  div.querySelectorAll('td, div, p').forEach(el => {
    const text = el.textContent?.trim() ?? '';
    const links = el.querySelectorAll('a');
    // If element has multiple links and very little non-link text, it's likely navigation
    if (links.length >= 3) {
      let linkText = '';
      links.forEach(a => linkText += a.textContent ?? '');
      if (linkText.length > 0 && text.length > 0 && linkText.length / text.length > 0.8) {
        el.remove();
      }
    }
  });

  // Remove horizontal rules that often separate content from footer
  // and everything after them if it looks like boilerplate
  const hrs = div.querySelectorAll('hr');
  hrs.forEach(hr => {
    const parent = hr.parentElement;
    if (parent) {
      let sibling = hr.nextElementSibling;
      const toRemove: Element[] = [hr];
      let textAfterHr = '';
      while (sibling) {
        textAfterHr += sibling.textContent ?? '';
        toRemove.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      // If text after hr is short or contains common footer words, remove it
      if (textAfterHr.length < 500) {
        toRemove.forEach(el => el.remove());
      }
    }
  });

  // Get the cleaned text
  let text = div.innerText;

  // Clean up excessive whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .trim();

  return text;
}
