import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_SOURCES, setImageSourceTransport, searchBioicons, searchWellcome, searchEuropePmc, searchServier, searchOpenstax, chooseImageProviders } from '../server/agent/imageSources.js'
import { searchWebImages } from '../server/agent/imgsearch.js'

test('seven requested libraries are registered and automatic plans stay bounded by subject', () => {
  assert.deepEqual(IMAGE_SOURCES.map(s => s.id), ['wikimedia','openverse','europepmc','openstax','servier','bioicons','wellcome'])
  assert.ok(chooseImageProviders('mitochondria').includes('europepmc'))
  assert.ok(chooseImageProviders('medical heart anatomy').includes('servier'))
  assert.ok(chooseImageProviders('history of medicine').includes('wellcome'))
  assert.ok(chooseImageProviders('force diagram').includes('openstax'))
  assert.ok(chooseImageProviders('cell').length <= 4)
})
test('Bioicons uses per-icon author and license rather than the website repository license', async () => {
  setImageSourceTransport(async () => Response.json([{ name:'mitochondria', category:'Cells', author:'Alice', license:'cc-by-3.0' }]))
  try {
    const result = await searchBioicons('mitochondria', 2)
    assert.equal(result[0].author,'Alice'); assert.equal(result[0].license,'cc-by-3.0')
    assert.ok(result[0].image_url.endsWith('/cc-by-3.0/Cells/Alice/mitochondria.svg'))
    assert.ok(result[0].license_url.includes('/cc-by-3.0/LICENSE'))
  } finally { setImageSourceTransport() }
})
test('Wellcome resolves IIIF image info into pixels and preserves non-commercial licenses', async () => {
  setImageSourceTransport(async () => Response.json({ results:[{ id:'i', source:{id:'work',title:'Heart'}, locations:[{url:'https://iiif.wellcomecollection.org/image/a/info.json',locationType:{id:'iiif-image'},license:{label:'CC BY-NC 4.0',url:'https://creativecommons.org/licenses/by-nc/4.0/'},credit:'Museum'}] }] }))
  try { const [item] = await searchWellcome('heart',1); assert.match(item.image_url,/full\/!1600,1600\/0\/default.jpg$/); assert.equal(item.license,'CC BY-NC 4.0'); assert.equal(item.author,'Museum'); assert.ok(item.page_url.endsWith('/work')) } finally { setImageSourceTransport() }
})
test('Europe PMC reads actual JATS figure/caption assets and separates article rights from third-party figures', async () => {
  setImageSourceTransport(async (url, options) => {
    if (String(url).includes('/search?')) return Response.json({resultList:{result:[{pmcid:'PMC123',title:'Mitochondria',authorString:'Author'}]}})
    assert.equal(options.headers.Accept,'*/*')
    return new Response('<article><permissions><license><ext-link xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://creativecommons.org/licenses/by/4.0/"/></license></permissions><fig id="f1"><label>Figure 1</label><caption><p>Mitochondria diagram. Created with BioRender.</p></caption><graphic content-type="image"><?cloudpmc-path blobs/a/b/diagram.webp?></graphic></fig><fig id="f2"><label>Figure 2</label><caption>Unresolved asset</caption><graphic xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="unknown.jpg"/></fig></article>')
  })
  try { const result = await searchEuropePmc('mitochondria',2); assert.equal(result.length,1); assert.equal(result[0].image_url,'https://cdn.ncbi.nlm.nih.gov/pmc/blobs/a/b/diagram.webp'); assert.equal(result[0].license,''); assert.ok(result[0].article_license); assert.match(result[0].caption,/BioRender/); assert.ok(result[0].rights_note) } finally { setImageSourceTransport() }
})
test('Servier uses official image cards, skips branding, and takes the largest declared image variant', async () => {
  setImageSourceTransport(async () => new Response('<img src="logo.png"/><article class="result-thumbnail"><a class="result-thumbnail-image" href="https://smart.servier.com/smart_image/heart/"><img class="wp-post-image" alt="Heart &amp; vessels" src="https://smart.servier.com/small.png" srcset="https://smart.servier.com/small.png 100w, https://smart.servier.com/full.png 800w"/></a></article>'))
  try { const result = await searchServier('heart',2); assert.equal(result.length,1); assert.equal(result[0].image_url,'https://smart.servier.com/full.png'); assert.equal(result[0].title,'Heart & vessels'); assert.equal(result[0].license,'CC BY 4.0') } finally { setImageSourceTransport() }
})
test('OpenStax indexes actual official media and collection rights without guessing captions or image URLs', async () => {
  setImageSourceTransport(async url => String(url).includes('/git/trees/') ? Response.json({tree:[{path:'collections/physics.collection.xml'},{path:'media/Forces_Motion.png'},{path:'media/airforce.png'},{path:'media/logo.png'}]}) : new Response('<collection xmlns:md="http://cnx.rice.edu/mdml"><md:license url="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</md:license></collection>'))
  try { const result = await searchOpenstax('force',2); assert.equal(result.length,1); assert.ok(result[0].image_url.endsWith('/media/Forces_Motion.png')); assert.equal(result[0].license,'CC BY 4.0'); assert.ok(result[0].rights_note) } finally { setImageSourceTransport() }
})
test('explicit provider errors stay visible and cannot silently turn into another library', async () => {
  await assert.rejects(searchWebImages('x',1,{providers:['unknown'],rerank:false}),/不支持/)
  setImageSourceTransport(async () => new Response('',{status:503}))
  try { const r=await searchWebImages('heart',1,{providers:['wellcome'],rerank:false}); assert.equal(r.results.length,0); assert.deepEqual(r.providers,['wellcome']); assert.match(r.warnings[0],/503/) } finally { setImageSourceTransport() }
})
