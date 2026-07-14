/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OfflineAction {
  id?: number;
  url: string;
  method: string;
  body: any;
  timestamp: number;
  description: string;
}

const DB_NAME = "hh_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "offline_actions";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported on this environment"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

export const offlineDb = {
  saveOfflineAction: async (action: Omit<OfflineAction, "id" | "timestamp"> & { id?: number }): Promise<number> => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const record = {
          ...action,
          timestamp: Date.now()
        };
        const request = store.add(record);

        request.onsuccess = () => {
          resolve(request.result as number);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (err) {
      console.error("IndexedDB saveOfflineAction failed:", err);
      throw err;
    }
  },

  getOfflineActions: async (): Promise<OfflineAction[]> => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          // Sort by timestamp to ensure we replay actions in chronological order
          const sorted = (request.result as OfflineAction[]).sort((a, b) => a.timestamp - b.timestamp);
          resolve(sorted);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (err) {
      console.error("IndexedDB getOfflineActions failed:", err);
      return [];
    }
  },

  deleteOfflineAction: async (id: number): Promise<void> => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (err) {
      console.error(`IndexedDB deleteOfflineAction failed for ID ${id}:`, err);
      throw err;
    }
  },

  clearOfflineActions: async (): Promise<void> => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (err) {
      console.error("IndexedDB clearOfflineActions failed:", err);
      throw err;
    }
  }
};
