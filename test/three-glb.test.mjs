/**
 * The exported GLB needs two repairs before it looks right in any viewer:
 * the albedo is linear-encoded (glTF baseColorTexture is sRGB) and NORMAL is
 * missing (flat shading). These tests pin the container surgery, not just the
 * pixel maths, because a bad offset breaks the file for every viewer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildGlb, computeNormals, decodePng, encodePng, linearToSrgb, parseGlb, polishGlb } from '../three/glb.js'

function fixtureGlb({ gray = 128, withNormals = false } = {}) {
  const png = encodePng(2, 2, Buffer.from([gray, gray, gray, gray, gray, gray, gray, gray, gray, gray, gray, gray]))
  const positions = Buffer.alloc(3 * 3 * 4)
  ;[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const uvs = Buffer.alloc(3 * 2 * 4)
  ;[0, 0, 1, 0, 0, 1].forEach((value, index) => uvs.writeFloatLE(value, index * 4))
  const indices = Buffer.alloc(3 * 4)
  ;[0, 1, 2].forEach((value, index) => indices.writeUInt32LE(value, index * 4))
  const normals = Buffer.alloc(3 * 3 * 4)
  ;[0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((value, index) => normals.writeFloatLE(value, index * 4))

  const views = [
    { buffer: 0, byteOffset: 0, byteLength: indices.length },
    { buffer: 0, byteOffset: indices.length, byteLength: positions.length },
    { buffer: 0, byteOffset: indices.length + positions.length, byteLength: uvs.length },
    { buffer: 0, byteOffset: indices.length + positions.length + uvs.length, byteLength: png.length },
  ]
  const bin = Buffer.concat([indices, positions, uvs, png])
  const accessors = [
    { bufferView: 0, componentType: 5125, count: 3, type: 'SCALAR' },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
  ]
  const attributes = { POSITION: 1, TEXCOORD_0: 2 }
  if (withNormals) {
    views.push({ buffer: 0, byteOffset: bin.length, byteLength: normals.length })
    accessors.push({ bufferView: 4, componentType: 5126, count: 3, type: 'VEC3' })
    attributes.NORMAL = 3
  }
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [{ primitives: [{ attributes, indices: 0, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 1, roughnessFactor: 1 } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: withNormals ? bin.length + normals.length : bin.length }],
  }
  const fullBin = withNormals ? Buffer.concat([bin, normals]) : bin
  return buildGlb(json, fullBin)
}

test('big-endian PNG round trip keeps pixels', () => {
  const pixels = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90])
  const png = encodePng(1, 3, pixels)
  const decoded = decodePng(png)
  assert.equal(decoded.width, 1)
  assert.equal(decoded.height, 3)
  assert.deepEqual([...decoded.data], [...pixels])
})

test('linearToSrgb lifts mid-tones the way the renderer expects', () => {
  const out = linearToSrgb(Buffer.from([0, 128, 255]))
  assert.equal(out[0], 0)
  assert.equal(out[1], 188, 'linear 0.5 displays as sRGB 0.74')
  assert.equal(out[2], 255)
})

test('polishGlb re-encodes the albedo as sRGB and adds smooth normals', () => {
  const original = fixtureGlb({ gray: 128 })
  const { bytes, changes } = polishGlb(original)
  assert.ok(changes.some((line) => line.includes('sRGB')), changes.join(' / '))
  assert.ok(changes.some((line) => line.includes('NORMAL')), changes.join(' / '))

  const { json, bin } = parseGlb(bytes)
  const image = json.images[0]
  const view = json.bufferViews[image.bufferView]
  const png = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)
  const decoded = decodePng(png)
  assert.equal(decoded.data[0], 188, '128 linear becomes 188 sRGB')

  const primitive = json.meshes[0].primitives[0]
  assert.equal(typeof primitive.attributes.NORMAL, 'number')
  const accessor = json.accessors[primitive.attributes.NORMAL]
  assert.equal(accessor.type, 'VEC3')
  assert.equal(accessor.count, 3)
  const normalView = json.bufferViews[accessor.bufferView]
  const normalBytes = bin.subarray(normalView.byteOffset || 0, (normalView.byteOffset || 0) + normalView.byteLength)
  for (let i = 0; i < 3; i += 1) {
    const length = Math.hypot(normalBytes.readFloatLE(i * 12), normalBytes.readFloatLE(i * 12 + 4), normalBytes.readFloatLE(i * 12 + 8))
    assert.ok(Math.abs(length - 1) < 1e-5, `normal ${i} is unit length`)
    assert.ok(normalBytes.readFloatLE(i * 12 + 8) > 0.99, 'the fixture faces +Z')
  }

  // geometry and UVs must survive byte for byte
  const positionView = json.bufferViews[primitive.attributes.POSITION]
  const positionBytes = bin.subarray(positionView.byteOffset || 0, (positionView.byteOffset || 0) + positionView.byteLength)
  assert.deepEqual([...positionBytes], [...parseGlb(original).bin.subarray(12, 12 + 36)])
})

test('polishGlb leaves an already-normalised file alone', () => {
  const original = fixtureGlb({ withNormals: true })
  const { bytes } = polishGlb(original, { gamma: false })
  assert.equal(bytes, original, 'nothing changed, nothing rewritten')
})

test('polishGlb can skip each repair independently', () => {
  const original = fixtureGlb({ gray: 128 })
  const noNormals = polishGlb(original, { normals: false })
  assert.equal(parseGlb(noNormals.bytes).json.meshes[0].primitives[0].attributes.NORMAL, undefined)
  const noGamma = polishGlb(original, { gamma: false })
  const { json, bin } = parseGlb(noGamma.bytes)
  const view = json.bufferViews[json.images[0].bufferView]
  assert.equal(decodePng(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)).data[0], 128)
  assert.equal(typeof json.meshes[0].primitives[0].attributes.NORMAL, 'number')
})

test('computeNormals points away from a clockwise-but-flat triangle', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const normals = computeNormals(positions, [0, 1, 2])
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs(normals[i * 3 + 2] - 1) < 1e-6)
    assert.ok(Math.abs(normals[i * 3]) < 1e-6)
  }
})
