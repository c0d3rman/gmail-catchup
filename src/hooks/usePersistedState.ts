import type { SenderGroup, ParsedEmail } from '../types/gmail';

const STORAGE_KEY = 'gmail_catchup_state';

interface PersistedState {
  senderGroups: SenderGroup[];
  currentIndex: number;
  todoGroups: SenderGroup[];
  reviewingTodos: boolean;
  lastFetchTime: number;
}

function reviveEmail(e: ParsedEmail & { date: string }): ParsedEmail {
  return { ...e, date: new Date(e.date) };
}

function reviveGroup(g: SenderGroup): SenderGroup {
  return {
    ...g,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emails: g.emails.map((e: any) => reviveEmail(e)),
  };
}

export function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      senderGroups: parsed.senderGroups.map(reviveGroup),
      currentIndex: parsed.currentIndex,
      todoGroups: parsed.todoGroups.map(reviveGroup),
      reviewingTodos: parsed.reviewingTodos ?? false,
      lastFetchTime: parsed.lastFetchTime ?? 0,
    };
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable
  }
}

export function clearPersistedState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
