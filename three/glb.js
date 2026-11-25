/**
 * Repairs the two defects the Tiiny 3-D service leaves in `painted.glb`:
 *
 *  1. The base colour texture is baked in linear space while glTF defines
 *     `baseColorTexture` as sRGB, so every viewer renders the albedo much too
 *     dark and orange (a pale yellow duck comes out metallic gold).
 *  2. The mesh ships without NORMAL, which makes conforming viewers shade every
 *     triangle flat and the surface look faceted.
 *
 * Geometry, UVs and the metallic/roughness texture are left untouched.
 */
import zlib from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// PNG (8-bit RGB / RGBA, non-interlaced — what the device emits)

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }
  if (!width || !height) throw new Error('PNG is missing the IHDR header')
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace})`)
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 3)
  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]
    cursor += 1
    raw.copy(current, 0, cursor, cursor + stride)
    cursor += stride
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      let value = current[i]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) value += paeth(left, up, upLeft)
      current[i] = value & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const from = x * channels
      const to = (y * width + x) * 3
      pixels[to] = current[from]
      pixels[to + 1] = current[from + 1]
      pixels[to + 2] = current[from + 2]
    }
    current.copy(previous)
  }
  return { width, height, data: pixels }
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

export function encodePng(width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const SRGB = (() => {
  const table = Buffer.alloc(256)
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
    table[i] = Math.round(Math.min(1, Math.max(0, s)) * 255)
  }
  return table
})()

/** Linear light stored as 8-bit sRGB bytes → the sRGB bytes those values mean. */
export function linearToSrgb(pixels) {
  const out = Buffer.alloc(pixels.length)
  for (let i = 0; i < pixels.length; i += 1) out[i] = SRGB[pixels[i]]
  return out
}

// ---------------------------------------------------------------------------
// glTF container

export function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file')
  let offset = 12
  let json = null
  let bin = null
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset)
    const type = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + length > bytes.length) break
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString('utf8', start, start + length))
    else if (type === 0x004e4942) bin = bytes.subarray(start, start + length)
    offset = start + length
  }
  if (!json || !bin) throw new Error('GLB is missing a JSON or BIN chunk')
  return { json, bin }
}

export function buildGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)])
  const binPad = (4 - (bin.length % 4)) % 4
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
  const jsonHead = Buffer.alloc(8)
  jsonHead.writeUInt32LE(jsonChunk.length, 0)
  jsonHead.writeUInt32LE(0x4e4f534a, 4)
  const binHead = Buffer.alloc(8)
  binHead.writeUInt32LE(binChunk.length, 0)
  binHead.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk])
}

function viewBytes(json, bin, index) {
  const view = json.bufferViews[index]
  const start = view.byteOffset || 0
  return bin.subarray(start, start + view.byteLength)
}

function accessorArray(json, bin, index) {
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type]
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0)
  const source = bin.subarray(base, base + accessor.count * components * accessorBytes(accessor.componentType))
  const array = new Float32Array(accessor.count * components)
  for (let i = 0; i < array.length; i += 1) {
    array[i] =
      accessor.componentType === 5126
        ? source.readFloatLE(i * 4)
        : accessor.componentType === 5125
          ? source.readUInt32LE(i * 4)
          : accessor.componentType === 5123
            ? source.readUInt16LE(i * 2)
            : source[i]
  }
  return { array, components, accessor }
}

function accessorBytes(componentType) {
  return componentType === 5126 || componentType === 5125 ? 4 : componentType === 5123 ? 2 : 1
}

/** Area-weighted vertex normals: the mesh ships without NORMAL, so viewers shade it flat. */
export function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    normals[a] += nx
    normals[a + 1] += ny
    normals[a + 2] += nz
    normals[b] += nx
    normals[b + 1] += ny
    normals[b + 2] += nz
    normals[c] += nx
    normals[c + 1] += ny
    normals[c + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= length
    normals[i + 1] /= length
    normals[i + 2] /= length
  }
  return normals
}

/**
 * @returns {{ bytes: Buffer, changes: string[] }}
 */
export function polishGlb(bytes, options = {}) {
  const gamma = options.gamma !== false
  const normals = options.normals !== false
  const { json, bin } = parseGlb(bytes)
  const changes = []
  const replacements = new Map()

  if (gamma) {
    const material = (json.materials || []).find((item) => item?.pbrMetallicRoughness?.baseColorTexture)
    const texture = material ? (json.textures || [])[material.pbrMetallicRoughness.baseColorTexture.index] : null
    const image = texture ? (json.images || [])[texture.source] : null
    if (image && image.bufferView !== undefined && image.mimeType === 'image/png') {
      try {
        const source = viewBytes(json, bin, image.bufferView)
        const decoded = decodePng(source)
        const fixed = linearToSrgb(decoded.data)
        replacements.set(image.bufferView, encodePng(decoded.width, decoded.height, fixed))
        changes.push('baseColor texture: linear → sRGB')
      } catch (error) {
        changes.push(`baseColor texture skipped (${String(error?.message || error)})`)
      }
    } else if (image) {
      changes.push(`baseColor texture skipped (${image.mimeType || 'unknown format'})`)
    }
  }

  if (normals && json.meshes) {
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives || []) {
        if (primitive.attributes?.NORMAL !== undefined || primitive.attributes?.POSITION === undefined) continue
        const position = accessorArray(json, bin, primitive.attributes.POSITION)
        const index = primitive.indices !== undefined ? accessorArray(json, bin, primitive.indices) : null
        const indices = index ? index.array : null
        const count = index ? indices.length : position.array.length / 3
        const normalsArray = computeNormals(position.array, indices || Array.from({ length: count }, (_, i) => i))
        const normalBytes = Buffer.alloc(normalsArray.length * 4)
        for (let i = 0; i < normalsArray.length; i += 1) normalBytes.writeFloatLE(normalsArray[i], i * 4)
        const viewIndex = json.bufferViews.length
        json.bufferViews.push({ buffer: 0, byteLength: normalBytes.length })
        json.accessors.push({ bufferView: viewIndex, componentType: 5126, count: normalsArray.length / 3, type: 'VEC3' })
        primitive.attributes.NORMAL = json.accessors.length - 1
        replacements.set(viewIndex, normalBytes)
        changes.push('NORMAL attribute added (smooth shading)')
      }
    }
  }

  if (!changes.some((line) => !line.includes('skipped'))) return { bytes, changes }

  // Rebuild the binary blob: keep every view, swap the repaired ones, realign to 4 bytes.
  const pieces = []
  let cursor = 0
  for (let i = 0; i < json.bufferViews.length; i += 1) {
    const view = json.bufferViews[i]
    const data = replacements.get(i) || (view.byteLength ? viewBytes(json, bin, i) : Buffer.alloc(0))
    const padded = (4 - (cursor % 4)) % 4
    if (padded) {
      pieces.push(Buffer.alloc(padded))
      cursor += padded
    }
    view.buffer = 0
    view.byteOffset = cursor
    view.byteLength = data.length
    pieces.push(data)
    cursor += data.length
  }
  const nextBin = Buffer.concat(pieces)
  json.buffers = [{ byteLength: nextBin.length }]
  return { bytes: buildGlb(json, nextBin), changes }
}
