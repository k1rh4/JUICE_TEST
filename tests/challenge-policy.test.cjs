'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const staticData = require('/juice-shop/build/data/staticData')
const utils = require('/juice-shop/build/lib/utils')
const challengeUtils = require('/juice-shop/build/lib/challengeUtils')
const { challenges } = require('/juice-shop/build/data/datacache')
const xml = require('/juice-shop/build/lib/xml')
const uploads = require('/juice-shop/build/routes/fileUpload')
const nonDos = process.env.JUICE_CHALLENGE_POLICY === 'non-dos'
const blocked = ['rceChallenge', 'rceOccupyChallenge', 'noSqlCommandChallenge', 'xxeDosChallenge', 'yamlBombChallenge']

test('challenge availability matches the selected policy', async () => {
  const records = await staticData.loadStaticChallengeData()
  const disabled = records.filter(record => !utils.getChallengeEnablementStatus({ disabledEnv: record.disabledEnv?.join(';') ?? '' }).enabled)
  if (nonDos) {
    assert.deepEqual(disabled.map(record => record.key).sort(), [...blocked].sort())
  } else {
    assert.equal(disabled.length, 18)
  }
  for (const record of records) {
    const status = utils.getChallengeEnablementStatus({ disabledEnv: record.disabledEnv?.join(';') ?? '' })
    challenges[record.key] = { ...record, disabledEnv: status.disabledBecause, solved: false }
  }
  challenges.deprecatedInterfaceChallenge.solved = true
})

test('DoS challenges cannot be enabled or marked solved', { skip: !nonDos }, async () => {
  for (const key of blocked) {
    const challenge = { key, solved: false, disabledEnv: null, save: () => { throw new Error('Unexpected save') } }
    assert.equal(utils.isChallengeEnabled(challenge), false)
    await challengeUtils.solve(challenge)
    challengeUtils.solveIf(challenge, () => true)
    assert.equal(challenge.solved, false)
  }
  assert.equal(utils.isChallengeEnabled(challenges.reflectedXssChallenge), true)
  assert.equal(utils.isChallengeEnabled(challenges.xxeFileDisclosureChallenge), true)
})

test('B2B orders do not evaluate submitted code', { skip: !nonDos }, () => {
  const { b2bOrder } = require('/juice-shop/build/routes/b2bOrder')
  let response
  b2bOrder()({ body: { cid: 'test', get orderLinesData () { throw new Error('DoS code was read') } } }, {
    json: value => { response = value }
  }, error => { throw error })
  assert.equal(response.cid, 'test')
  assert.ok(response.orderNo)
})

test('review queries reject injected expressions while normal IDs work', { skip: !nonDos }, async () => {
  const db = require('/juice-shop/build/data/mongodb')
  const { showProductReviews } = require('/juice-shop/build/routes/showProductReviews')
  const originalFind = db.reviewsCollection.find
  const queries = []
  db.reviewsCollection.find = async query => { queries.push(query); return [] }
  try {
    for (const id of ['1', '1 || true']) {
      await new Promise((resolve, reject) => {
        showProductReviews()({ params: { id }, headers: {} }, { json: resolve }, reject)
      })
    }
    assert.deepEqual(queries, [{ $where: 'this.product == 1' }, { $where: 'this.product == NaN' }])
  } finally {
    db.reviewsCollection.find = originalFind
  }
})

test('XML accepts ordinary data and bounded local file disclosure', { skip: !nonDos }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'juicetest-xml-'))
  const file = path.join(dir, 'sample.txt')
  try {
    await fs.writeFile(file, 'fixture <text> & value')
    assert.match(await xml.parseXmlString('<r>ordinary</r>'), /ordinary/)
    const result = await xml.parseXmlString('<!DOCTYPE r [<!ENTITY x SYSTEM "' + pathToFileURL(file) + '">]><r>&x;</r>')
    assert.match(result, /fixture &lt;text&gt; &amp; value/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('XML blocks expansion, external DTDs, device files and excessive output', { skip: !nonDos }, async () => {
  for (const data of [
    '<!DOCTYPE r [<!ENTITY x "text"><!ENTITY y "&x;&x;">]><r>&y;</r>',
    '<!DOCTYPE r SYSTEM "file:///tmp/dtd"><r/>',
    '<!DOCTYPE r [<!ENTITY % x SYSTEM "file:///tmp/dtd">%x;]><r/>',
    '<!DOCTYPE r [<!ENTITY x SYSTEM "https://example.invalid/data">]><r>&x;</r>',
    '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///dev/zero">]><r>&x;</r>',
    '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///dev/urandom">]><r>&x;</r>'
  ]) {
    await assert.rejects(xml.parseXmlString(data), /disabled|Only local|regular files/)
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'juicetest-expansion-'))
  const file = path.join(dir, 'sample.txt')
  try {
    await fs.writeFile(file, 'x'.repeat(65536))
    await assert.rejects(xml.parseXmlString('<!DOCTYPE r [<!ENTITY x SYSTEM "' + pathToFileURL(file) + '">]><r>&x;&x;&x;&x;</r>'), /expansion limit/)
    await fs.appendFile(file, 'x')
    await assert.rejects(xml.parseXmlString('<!DOCTYPE r [<!ENTITY x SYSTEM "' + pathToFileURL(file) + '">]><r>&x;</r>'), /regular files/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('YAML allows ordinary uploads and bounds alias expansion', { skip: !nonDos }, () => {
  const run = data => {
    let status, error
    const res = { status: value => { status = value; return res }, end: () => {} }
    uploads.handleYamlUpload({ file: { originalname: 'test.yaml', buffer: Buffer.from(data) } }, res, value => { error = value })
    assert.equal(status, 410)
    return error.message
  }
  assert.match(run('message: ordinary'), /"message":"ordinary"/)
  let data = 'a: &a [text, text, text, text, text]\n'
  for (let i = 1; i < 8; i++) {
    const name = String.fromCharCode(97 + i)
    const previous = String.fromCharCode(96 + i)
    data += name + ': &' + name + ' [' + Array(5).fill('*' + previous).join(', ') + ']\n'
  }
  assert.match(run(data), /YAML expansion limit exceeded/)
  assert.match(run('a: &a [*a]'), /circular/i)
  assert.equal(challenges.yamlBombChallenge.solved, false)
})
