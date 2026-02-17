import type { SenderGroup, ParsedEmail } from '../types/gmail';

const DB_NAME = 'gmail_catchup';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const STATE_KEY = 'persisted';

export interface PersistedState {
  senderGroups: SenderGroup[];
  currentIndex: number;
  todoGroups: SenderGroup[];
  reviewingTodos: boolean;
  lastFetchTime: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

export async function loadPersistedState(): Promise<PersistedState | null> {
  try {
    // Migrate from localStorage if present
    const legacy = localStorage.getItem('gmail_catchup_state');
    if (legacy) {
      localStorage.removeItem('gmail_catchup_state');
      const parsed = JSON.parse(legacy);
      const state: PersistedState = {
        senderGroups: parsed.senderGroups.map(reviveGroup),
        currentIndex: parsed.currentIndex,
        todoGroups: parsed.todoGroups.map(reviveGroup),
        reviewingTodos: parsed.reviewingTodos ?? false,
        lastFetchTime: parsed.lastFetchTime ?? 0,
      };
      await savePersistedState(state);
      return state;
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
      req.onsuccess = () => {
        db.close();
        if (!req.result) { resolve(null); return; }
        try {
          resolve({
            senderGroups: req.result.senderGroups.map(reviveGroup),
            currentIndex: req.result.currentIndex,
            todoGroups: req.result.todoGroups.map(reviveGroup),
            reviewingTodos: req.result.reviewingTodos ?? false,
            lastFetchTime: req.result.lastFetchTime ?? 0,
          });
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(state, STATE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Storage unavailable
  }
}

export async function clearPersistedState(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(STATE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Storage unavailable
  }
}
