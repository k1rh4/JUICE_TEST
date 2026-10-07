'use strict'

const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const { fileURLToPath } = require('node:url')

const maxXmlBytes = 200000
const maxEntityBytes = 65536

function escapeXml (value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function readEntity (uri) {
  const url = new URL(uri)
  if (url.protocol !== 'file:') throw new Error('Only local file entities are enabled')
  const file = await fs.open(fileURLToPath(url), constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxEntityBytes) {
      throw new Error('XML entities must reference regular files of at most 64 KiB')
    }
    const buffer = Buffer.alloc(maxEntityBytes + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxEntityBytes) throw new Error('XML entity size limit exceeded')
    return escapeXml(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally {
    await file.close()
  }
}

function guardXmlParser (parse) {
  return async data => {
    if (Buffer.byteLength(data) > maxXmlBytes || data.includes('\0')) {
      throw new Error('XML input limit exceeded or unsupported encoding')
    }
    const declarations = [...data.matchAll(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s+SYSTEM\s+(["'])([^"']+)\2\s*>/g)]
    if (declarations.length > 16) throw new Error('XML entity count limit exceeded')

    // Resolve bounded file entities ourselves. The native parser receives no entity definitions.
    let prepared = data.replace(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s+SYSTEM\s+(["'])([^"']+)\2\s*>/g, '')
    if (/<!ENTITY|<!DOCTYPE\s+[^\s[>]+\s+(?:SYSTEM|PUBLIC)|%\s*[\w.:-]+\s*;/i.test(prepared)) {
      throw new Error('XML entity expansion and external DTDs are disabled')
    }

    const entities = new Map()
    for (const [, name, , uri] of declarations) {
      if (entities.has(name)) throw new Error('Duplicate XML entity')
      entities.set(name, await readEntity(uri))
    }
    let expandedBytes = Buffer.byteLength(prepared)
    prepared = prepared.replace(/&([A-Za-z_:][\w.:-]*);/g, (reference, name) => {
      if (!entities.has(name)) return reference
      const value = entities.get(name)
      expandedBytes += Buffer.byteLength(value) - Buffer.byteLength(reference)
      if (expandedBytes > maxXmlBytes) throw new Error('XML expansion limit exceeded')
      return value
    })
    return parse(prepared, 200)
  }
}

function guardYamlUpload () {
  const yaml = require('/juice-shop/node_modules/js-yaml')
  const challengeUtils = require('/juice-shop/build/lib/challengeUtils')
  const { challenges } = require('/juice-shop/build/data/datacache')
  return ({ file }, res, next) => {
    if (!/\.ya?ml$/i.test(file?.originalname ?? '')) return res.status(204).end()
    challengeUtils.solveIf(challenges.deprecatedInterfaceChallenge, () => true)
    res.status(410)
    try {
      const data = file?.buffer?.toString() ?? ''
      if (Buffer.byteLength(data) > maxXmlBytes) throw new Error('YAML input limit exceeded')
      let nodes = 0
      let textBytes = 0
      const result = JSON.stringify(yaml.load(data), (key, value) => {
        textBytes += Buffer.byteLength(key) + (typeof value === 'string' ? Buffer.byteLength(value) : 0)
        if (++nodes > 5000 || textBytes > maxXmlBytes) throw new Error('YAML expansion limit exceeded')
        return value
      })
      next(new Error('B2B customer complaints via file upload have been deprecated for security reasons: ' + String(result).slice(0, 400) + ' (' + file.originalname + ')'))
    } catch (error) {
      next(new Error('B2B customer complaints via file upload have been deprecated for security reasons: ' + error.message + ' (' + file.originalname + ')'))
    }
  }
}

module.exports = { guardXmlParser, guardYamlUpload }
