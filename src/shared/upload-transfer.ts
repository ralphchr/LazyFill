import type { TemporaryFile } from './types.ts'

export const UPLOAD_CHUNK_BYTES = 512 * 1024
export interface FileChunkRequest { type: 'UPLOAD_CHUNK'; id: string; offset: number }
export interface FileChunkResponse { ok: boolean; data?: string; size?: number; message?: string }

export async function loadTemporaryFile(metadata: TemporaryFile, active = () => true): Promise<File> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  // Chrome's JSON messaging cannot carry a File/Blob; transfer bounded chunks.
  for (let offset = 0; offset < metadata.size || offset === 0; offset += UPLOAD_CHUNK_BYTES) {
    if (!active()) throw new Error('Upload stopped.')
    const response: FileChunkResponse = await chrome.runtime.sendMessage({ type: 'UPLOAD_CHUNK', id: metadata.id, offset } satisfies FileChunkRequest)
    if (!response?.ok || typeof response.data !== 'string') throw new Error(response?.message || 'This temporary file is unavailable. Choose it again in FormPass.')
    if (response.size !== metadata.size) throw new Error('The temporary file changed. Choose it again in FormPass.')
    const binary = atob(response.data)
    const expected = Math.min(UPLOAD_CHUNK_BYTES, metadata.size - offset)
    if (binary.length !== expected) throw new Error('Could not read the complete temporary file. Choose it again.')
    chunks.push(Uint8Array.from(binary, character => character.charCodeAt(0)))
  }
  if (!active()) throw new Error('Upload stopped.')
  return new File(chunks, metadata.name, { type: metadata.type, lastModified: metadata.lastModified })
}
