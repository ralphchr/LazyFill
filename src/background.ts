import { readUpload } from './shared/upload-store.ts'
import { UPLOAD_CHUNK_BYTES } from './shared/upload-transfer.ts'
import type { FileChunkRequest, FileChunkResponse } from './shared/upload-transfer.ts'

chrome.runtime.onMessage.addListener((request: FileChunkRequest, sender, respond: (response: FileChunkResponse) => void) => {
  if (sender.id !== chrome.runtime.id || request?.type !== 'UPLOAD_CHUNK') return
  void (async () => {
    try {
      if (typeof request.id !== 'string' || !Number.isSafeInteger(request.offset) || request.offset < 0) throw new Error('Invalid file request.')
      const file = await readUpload(request.id)
      if (!file || request.offset > file.size) throw new Error('Temporary file removed. Choose a file in FormPass, then Continue.')
      const bytes = new Uint8Array(await file.blob.slice(request.offset, request.offset + UPLOAD_CHUNK_BYTES).arrayBuffer())
      let binary = ''
      for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
      respond({ ok: true, data: btoa(binary), size: file.size })
    } catch (error) { respond({ ok: false, message: error instanceof Error ? error.message : 'Could not read this temporary file.' }) }
  })()
  return true
})
