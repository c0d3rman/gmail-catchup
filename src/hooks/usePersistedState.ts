import type { SenderGroup, ParsedEmail } from '../types/gmail';

const DB_NAME = 'gmail_catchup';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const LEGACY_STATE_KEY = 'persisted';

// State is stored per account so switching accounts never surfaces another
// account's emails.
function stateKey(account: string): string {
  return `persisted:${account.toLowerCase()}`;
}

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

function getRaw(key: string): Promise<PersistedState | null> {
  return openDB().then(db => new Promise<PersistedState | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
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
  }));
}

function putRaw(key: string, state: PersistedState): Promise<void> {
  return openDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function deleteRaw(key: string): Promise<void> {
  return openDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export async function loadPersistedState(account: string): Promise<PersistedState | null> {
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
      await savePersistedState(account, state);
      return state;
    }

    const existing = await getRaw(stateKey(account));
    if (existing) return existing;

    // Migrate the pre-multi-account key into whichever account is signed in now
    const unkeyed = await getRaw(LEGACY_STATE_KEY);
    if (unkeyed) {
      await deleteRaw(LEGACY_STATE_KEY);
      await putRaw(stateKey(account), unkeyed);
      return unkeyed;
    }

    return null;
  } catch {
    return null;
  }
}

export async function savePersistedState(account: string, state: PersistedState): Promise<void> {
  try {
    await putRaw(stateKey(account), state);
  } catch {
    // Storage unavailable
  }
}

export async function clearPersistedState(account: string): Promise<void> {
  try {
    await deleteRaw(stateKey(account));
  } catch {
    // Storage unavailable
  }
}
