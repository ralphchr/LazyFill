import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { listUploads, readUpload, removeUpload, saveUploads } from '../src/shared/upload-store.ts'
import { loadTemporaryFile, UPLOAD_CHUNK_BYTES } from '../src/shared/upload-transfer.ts'
import type { FileChunkRequest } from '../src/shared/upload-transfer.ts'

test('stores user files durably, transfers multiple chunks unchanged, and deletes without stale data', async t => {
  const bytes = Uint8Array.from({ length: UPLOAD_CHUNK_BYTES + 317 }, (_, i) => i % 251)
  const file = new File([bytes], 'my-upload.pdf', { type: 'application/pdf', lastModified: 12345 })
  const [metadata] = await saveUploads([file])
  assert.deepEqual(await listUploads(), [metadata])
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
  t.after(() => { if (original) Object.defineProperty(globalThis, 'chrome', original); else Reflect.deleteProperty(globalThis, 'chrome') })
  const offsets: number[] = []
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async (request: FileChunkRequest) => {
    offsets.push(request.offset)
    const record = await readUpload(request.id)
    if (!record) return { ok: false, message: 'Temporary file removed' }
    const chunk = await record.blob.slice(request.offset, request.offset + UPLOAD_CHUNK_BYTES).arrayBuffer()
    return { ok: true, data: Buffer.from(chunk).toString('base64'), size: record.size }
  } } } })
  const restored = await loadTemporaryFile(metadata)
  assert.equal(restored.name, file.name)
  assert.equal(restored.type, file.type)
  assert.equal(restored.lastModified, file.lastModified)
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), bytes)
  assert.deepEqual(offsets, [0, UPLOAD_CHUNK_BYTES])
  await assert.rejects(() => loadTemporaryFile(metadata, () => false), /stopped/)
  await removeUpload(metadata.id)
  assert.deepEqual(await listUploads(), [])
  await assert.rejects(() => loadTemporaryFile(metadata), /removed/)
})

test('empty user files remain user files without generated substitute data', async () => {
  const [metadata] = await saveUploads([new File([], 'empty.txt', { type: 'text/plain' })])
  const record = await readUpload(metadata.id)
  assert.equal(record!.size, 0)
  assert.equal(await record!.blob.text(), '')
  await removeUpload(metadata.id)
})
