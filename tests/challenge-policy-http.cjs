'use strict'

const assert = require('node:assert/strict')

if (process.env.JUICETEST_ISOLATED_HTTP_TEST !== 'true') {
  throw new Error('Run only in a disposable container with JUICETEST_ISOLATED_HTTP_TEST=true')
}

const base = 'http://127.0.0.1:3000'
const blocked = ['rceChallenge', 'rceOccupyChallenge', 'noSqlCommandChallenge', 'xxeDosChallenge', 'yamlBombChallenge'].sort()

async function upload (name, data) {
  const form = new FormData()
  form.append('file', new Blob([data]), name)
  const res = await fetch(base + '/file-upload', { method: 'POST', body: form })
  return { status: res.status, body: await res.text() }
}

async function main () {
  const initial = (await (await fetch(base + '/api/Challenges')).json()).data
  assert.deepEqual(initial.filter(c => c.disabledEnv !== null).map(c => c.key).sort(), blocked)
  assert.equal((await fetch(base + '/rest/products/search?q=apple')).status, 200)
  assert.equal((await fetch(base + '/rest/products/1/reviews')).status, 200)
  const login = await fetch(base + '/rest/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@juice-sh.op', password: 'admin123' })
  })
  assert.equal(login.status, 200)
  const { authentication } = await login.json()
  const order = await fetch(base + '/b2b/v2/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authentication.token },
    body: JSON.stringify({ cid: 'test', orderLinesData: 'deliberately invalid JavaScript' })
  })
  assert.equal(order.status, 200)
  const ordinary = await upload('test.xml', '<r>ordinary XML</r>')
  assert.equal(ordinary.status, 410)
  assert.match(ordinary.body, /ordinary XML/)
  const xxe = await upload('test.xml', '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>')
  assert.equal(xxe.status, 410)
  assert.match(xxe.body, /root:/)
  const device = await upload('test.xml', '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///dev/zero">]><r>&x;</r>')
  assert.equal(device.status, 410)
  assert.match(device.body, /regular files/)
  const internal = await upload('test.xml', '<!DOCTYPE r [<!ENTITY x "text"><!ENTITY y "&x;&x;">]><r>&y;</r>')
  assert.equal(internal.status, 410)
  assert.match(internal.body, /expansion and external DTDs are disabled/)
  assert.match((await upload('test.yaml', 'message: ordinary YAML')).body, /ordinary YAML/)
  let yaml = 'a: &a [text, text, text, text, text]\n'
  for (let i = 1; i < 8; i++) {
    yaml += String.fromCharCode(97 + i) + ': &' + String.fromCharCode(97 + i) + ' [' + Array(5).fill('*' + String.fromCharCode(96 + i)).join(', ') + ']\n'
  }
  const bomb = await upload('test.yaml', yaml)
  assert.equal(bomb.status, 410)
  assert.match(bomb.body, /YAML expansion limit exceeded/)
  const final = (await (await fetch(base + '/api/Challenges')).json()).data
  assert.ok(final.filter(c => blocked.includes(c.key)).every(c => !c.solved))
  assert.ok(final.find(c => c.key === 'xxeFileDisclosureChallenge').solved)
  assert.ok(final.find(c => c.key === 'deprecatedInterfaceChallenge').solved)
  console.log(JSON.stringify({
    total: final.length,
    disabled: final.filter(c => c.disabledEnv !== null).map(c => c.name),
    checks: 'HTTP checks passed; non-DoS XML challenges solved; DoS challenges unsolved'
  }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
