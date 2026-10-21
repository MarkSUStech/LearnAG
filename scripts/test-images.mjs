import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import sharp from 'sharp'
import { setVaultRoot, resolveInVault } from '../server/vault.js'
import { decodedPixels, imageRequest, extractPdfImages } from '../server/agent/pdfimages.js'
import { inspectImage, imageSource, checkNoteImages } from '../server/agent/imageAssets.js'
import { searchLocalImages, findImages, invalidateImageLibrary } from '../server/agent/imageLibrary.js'
import { searchWebImages, downloadImageToVault } from '../server/agent/imgsearch.js'
import { prepareVisionMessages } from '../server/agent/vision.js'
import { imageAwareTools, MANAGER_TOOLS, TUTOR_TOOLS } from '../server/agent/toolProfiles.js'

const root = path.resolve('.impeccable/review/image-tests-' + Date.now())
fs.mkdirSync(root, { recursive: true }); setVaultRoot(root)
const write = (rel, data) => { const file = resolveInVault(rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data) }
const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#426ca8' } }).png().toBuffer()
write('assets/opaque.png', png)
write('notes/probability.md', '# 随机事件\n\n![泊松分布概率质量图](../assets/opaque.png)\n\n`![代码，不是真图](missing.png)`')

function fixturePdf(image = false) {
  const raw = image ? zlib.deflateSync(Buffer.from(Array.from({ length: 200 * 200 * 3 }, (_, i) => i % 251))) : null
  const content = image ? 'q 200 0 0 200 20 20 cm /Im0 Do Q' : '0.2 0.4 0.8 rg 20 20 180 100 re f'
  const stream = (header, bytes) => Buffer.concat([Buffer.from(header + ` /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')])
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'), Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 240] /Resources ${image ? '<< /XObject << /Im0 5 0 R >> >>' : '<< >>'} /Contents 4 0 R >>`), stream('<<', Buffer.from(content))]
  if (image) objects.push(stream('<< /Type /XObject /Subtype /Image /Width 200 /Height 200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', raw))
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.concat(parts).length); parts.push(Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n')) }
  const start = Buffer.concat(parts).length
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(v => String(v).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`))
  return Buffer.concat(parts)
}
write('textbook/vector.pdf', fixturePdf()); write('textbook/raster.pdf', fixturePdf(true))

test('local search locates image by Markdown caption without contacting the web or treating code as image', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('network must not run') }
  try {
    const found = await findImages({ query: '泊松分布', source: 'auto' })
    assert.equal(found.results[0].path, 'assets/opaque.png'); assert.equal(found.results[0].width, 400)
    assert.equal(found.results[0].references[0].caption, '泊松分布概率质量图'); assert.equal(calls, 0)
    assert.deepEqual(found.searched, ['local'])
    assert.equal((await searchLocalImages('代码，不是真图')).results.length, 0)
  } finally { globalThis.fetch = original }
})
test('read_image supplies bounded real pixels, crop provenance, source preservation and contiguous vision messages', async () => {
  const result = await inspectImage({ path: 'assets/opaque.png', crop: [.25, .25, .5, .5] })
  assert.equal(result.width, 200); assert.equal(result.height, 150); assert.equal(result.image, true)
  assert.ok(fs.readFileSync(resolveInVault('assets/opaque.png')).equals(png)); assert.equal(imageSource(result.path).original, 'assets/opaque.png')
  const messages = [{ role: 'assistant', content: '', tool_calls: [{ id: 'i', type: 'function', function: { name: 'read_image', arguments: JSON.stringify({ path: 'assets/opaque.png' }) } }] }, { role: 'tool', tool_call_id: 'i', content: JSON.stringify(result) }]
  const prepared = prepareVisionMessages(messages)
  assert.equal(prepared[1].role, 'tool'); assert.equal(prepared[2].role, 'user'); assert.equal(prepared[2].content.at(-1).type, 'image_url')
  await assert.rejects(inspectImage({ path: 'assets/opaque.png', crop: [.5, .5, 1, 1] }), /crop/)
  await assert.rejects(inspectImage({ path: '../outside.png' }), /越出/)
})
test('one-bit PDF images expand MSB-first with per-row padding rather than being misread as 8-bit gray', () => {
  const result = decodedPixels({ width: 9, height: 2, kind: 1, data: Uint8Array.from([0b10101010, 0b10000000, 0, 0]) })
  assert.deepEqual([...result.data], [255,0,255,0,255,0,255,0,255, 0,0,0,0,0,0,0,0,0])
  assert.throws(() => decodedPixels({ width: 9, height: 2, kind: 1, data: new Uint8Array(1) }), /不完整/)
})
test('vector PDF no_images is distinct from failure; explicit pages export actual pixels with correct source and cache dimensions', async () => {
  const no = await extractPdfImages({ path: 'textbook/vector.pdf' })
  assert.equal(no.status, 'no_images'); assert.equal(no.count, 0); assert.match(no.hint, /不代表接口故障/)
  const exported = await extractPdfImages({ path: 'textbook/vector.pdf', pages: [1], mode: 'auto' })
  assert.equal(exported.status, 'ok'); assert.equal(exported.count, 1); assert.equal(exported.images[0].kind, 'page')
  const decoded = await sharp(resolveInVault(exported.images[0].file)).metadata(); assert.equal(decoded.width, exported.images[0].width)
  const cached = await extractPdfImages({ path: 'textbook/vector.pdf', pages: [1], mode: 'auto' })
  assert.equal(cached.reused, true); assert.deepEqual(cached.images, exported.images)
  assert.throws(() => imageRequest({ mode: 'page' }, 1), /指定/); assert.throws(() => imageRequest({ pages: [2] }, 1), /页码/)
})
test('raster PDF waits for decoding; changing size filter does not reuse a stale cache', async () => {
  const embedded = await extractPdfImages({ path: 'textbook/raster.pdf', min_size: 100 })
  assert.equal(embedded.count, 1); assert.equal(embedded.images[0].kind, 'embedded'); assert.equal(embedded.images[0].width, 200)
  const filtered = await extractPdfImages({ path: 'textbook/raster.pdf', min_size: 300 })
  assert.equal(filtered.count, 0); assert.equal(filtered.reused, false)
  invalidateImageLibrary()
  const source = await searchLocalImages('vector')
  assert.ok(source.results.some(r => r.pdf?.path === 'textbook/vector.pdf'))
})
test('web providers report partial failure, mix sources, preserve actual provenance and never fabricate licensing', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    if (String(url).includes('openverse')) throw new Error('source offline')
    if (String(url).includes('image.so.com')) return Response.json({ list: [{ title: 'Poisson', img: 'https://images.example/a.png', thumb: 'https://images.example/a.png', link: 'https://example/a' }] })
    return Response.json({ query: { pages: { x: { title: 'File:Poisson', imageinfo: [{ url: 'https://images.example/b.png', descriptionurl: 'https://example/b', extmetadata: { LicenseShortName: { value: 'CC BY' }, Artist: { value: 'Author' } } }] } } } })
  }
  try { const found = await searchWebImages('poisson', 3, { rerank: false, providers: ['so360', 'openverse', 'wikimedia'] }); assert.equal(found.results.length, 2); assert.equal(found.results[0].license, ''); assert.equal(found.results[1].license, 'CC BY'); assert.ok(found.warnings.some(w => w.includes('offline'))) } finally { globalThis.fetch = original }
})
test('network imports validate pixels and size, keep provenance, and do not overwrite a different existing image', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(png, { headers: { 'content-type': 'image/png' } })
  try {
    write('assets/custom.png', Buffer.from('keep original'))
    const imported = await downloadImageToVault({ url: 'https://images.example/test.png', path: 'assets/custom.png', page_url: 'https://example/source', title: '泊松图', license: 'CC BY' })
    assert.notEqual(imported.path, 'assets/custom.png'); assert.equal(fs.readFileSync(resolveInVault('assets/custom.png'), 'utf8'), 'keep original')
    assert.equal(imageSource(imported.path).page_url, 'https://example/source')
    globalThis.fetch = async () => new Response('<html>error</html>', { headers: { 'content-type': 'image/png' } })
    await assert.rejects(downloadImageToVault({ url: 'https://images.example/fake.png' }))
    await assert.rejects(downloadImageToVault({ url: 'http://127.0.0.1/private' }), /公网/)
  } finally { globalThis.fetch = original }
})
test('Markdown image checks flag missing and empty targets but respect valid root and note-relative paths', () => {
  assert.deepEqual(checkNoteImages('![ok](../assets/opaque.png)', 'notes/test.md'), [])
  assert.deepEqual(checkNoteImages('![ok](assets/opaque.png)', 'notes/test.md'), [])
  assert.equal(checkNoteImages('![bad](missing.png)\n\n![empty]()', 'notes/test.md').length, 2)
})
test('image tools are available to all relevant roles but ordinary requests keep the compact profile', () => {
  for (const base of [MANAGER_TOOLS, TUTOR_TOOLS]) {
    assert.equal(imageAwareTools(base, [{ role: 'user', content: '解释二分查找' }]), base)
    const full = imageAwareTools(base, [{ role: 'user', content: '找本地图片并讲解这张图' }]).map(t => t.function.name)
    for (const name of ['search_images', 'read_image', 'download_image', 'extract_pdf_images']) assert.ok(full.includes(name))
    assert.ok(!full.includes('web_fetch'))
  }
})
