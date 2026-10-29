import { copyFile, readFile, access, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

// Deterministic PNG icons, with no image service or binary build dependency.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}
function icon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size
    const foreground = (px > .25 && px < .37 && py > .22 && py < .78)
      || (px > .25 && px < .73 && py > .22 && py < .34)
      || (px > .25 && px < .61 && py > .43 && py < .55)
    const offset = y * (size * 4 + 1) + 1 + x * 4
    pixels.set(foreground ? [218, 244, 155, 255] : [35, 79, 66, 255], offset)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

await copyFile('manifest.json', 'dist/manifest.json')
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'))
const icons = {}
for (const size of [16, 32, 48, 128]) {
  const name = `icon-${size}.png`
  await writeFile(`dist/${name}`, icon(size))
  icons[size] = name
}
manifest.icons = icons
manifest.action.default_icon = icons
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
for (const file of [manifest.action.default_popup, ...manifest.content_scripts.flatMap(script => script.js)]) await access(`dist/${file}`)
console.log('Packaged FormPass in dist/ — load this folder in Edge or Chrome.')
