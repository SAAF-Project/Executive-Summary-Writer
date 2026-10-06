import type { StoredPresentation } from "./types";

const PRESENTATION_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
type PersistedPresentation = Omit<StoredPresentation, "sourceFile"> & { sourceBytes?: ArrayBuffer; sourceFile?: Blob };

/** Replace this boundary with authenticated object storage + a DB in phase two. */
export interface TemplateRepository {
  list(): Promise<StoredPresentation[]>;
  put(record: StoredPresentation): Promise<void>;
  remove(id: string): Promise<void>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("audit-template-studio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("presentations", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser storage is unavailable. Enable storage or use a regular browser window."));
    request.onblocked = () => reject(new Error("Close other ESWriter tabs and try again."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = database.transaction("presentations", mode);
      const request = action(tx.objectStore("presentations"));
      tx.oncomplete = () => { database.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => {
        database.close();
        reject(new Error("Could not save to this browser. Storage may be full or disabled. Keep this page open and download a copy to keep your work."));
      };
    } catch {
      database.close();
      reject(new Error("Browser storage is full or unavailable. Enable storage or free some space, then try saving again."));
    }
  });
}

export const browserRepository: TemplateRepository = {
  async list() {
    const records = await transaction<PersistedPresentation[]>("readonly", store => store.getAll());
    return records.filter(record => record.definition.schemaVersion === 1).map(record => {
      const { sourceBytes, sourceFile, ...rest } = record;
      return { ...rest, sourceFile: sourceBytes ? new Blob([sourceBytes], { type: PRESENTATION_TYPE }) : sourceFile ?? new Blob() };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async put(record) {
    // Store bytes instead of browser File/Blob handles, including in WebKit.
    const { sourceFile, ...rest } = record;
    const sourceBytes = await sourceFile.arrayBuffer();
    await transaction("readwrite", store => store.put({ ...rest, sourceBytes }));
  },
  async remove(id) { await transaction("readwrite", store => store.delete(id)); },
};
