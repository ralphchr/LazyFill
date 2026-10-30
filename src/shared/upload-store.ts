import type { TemporaryFile } from './types.ts'

interface StoredFile extends TemporaryFile { blob: Blob }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('formpass-uploads', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open temporary file storage.'))
    request.onblocked = () => reject(new Error('Close other FormPass windows and try again.'))
  })
}

async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('files', mode)
      let request: IDBRequest<T>
      try { request = work(tx.objectStore('files')) } catch (error) { tx.abort(); reject(error); return }
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not save the file. Check available browser storage.'))
    })
  } finally { db.close() }
}

export async function listUploads(): Promise<TemporaryFile[]> {
  const records = await transaction<StoredFile[]>('readonly', store => store.getAll())
  return records.map(({ id, name, type, size, lastModified }) => ({ id, name, type, size, lastModified }))
}

export async function saveUploads(files: File[]): Promise<TemporaryFile[]> {
  const records = files.map(file => ({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, blob: file }))
  if (!records.length) return []
  await transaction('readwrite', store => {
    let request!: IDBRequest
    for (const record of records) request = store.put(record)
    return request
  })
  return records.map(({ id, name, type, size, lastModified }) => ({ id, name, type, size, lastModified }))
}

export async function removeUpload(id: string): Promise<void> {
  await transaction('readwrite', store => store.delete(id))
}

export async function readUpload(id: string): Promise<StoredFile | undefined> {
  return transaction('readonly', store => store.get(id))
}
