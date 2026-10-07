'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { Sequelize } = require('/juice-shop/node_modules/sequelize')
const { FeedbackModelInit } = require('/juice-shop/build/models/feedback')
const { ComplaintModelInit } = require('/juice-shop/build/models/complaint')
const cache = require('/juice-shop/build/data/datacache')
const verify = require('/juice-shop/build/routes/verify')

test('DB challenge checks respect the startup setting', async () => {
  const seq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
  const keys = [
    'changeProductChallenge', 'feedbackChallenge', 'knownVulnerableComponentChallenge',
    'weirdCryptoChallenge', 'typosquattingNpmChallenge', 'typosquattingAngularChallenge',
    'hiddenImageChallenge', 'supplyChainAttackChallenge', 'dlpPastebinDataLeakChallenge',
    'csafChallenge', 'leakedApiKeyChallenge', 'vulnerableDockerImageChallenge',
    'systemPromptExtractionChallenge'
  ]

  try {
    FeedbackModelInit(seq)
    ComplaintModelInit(seq)
    await seq.sync()
    await seq.query("INSERT INTO Feedbacks (comment, rating, createdAt, updatedAt) VALUES ('xxxxxxxx', 5, datetime('now'), datetime('now'))")
    for (const key of keys) {
      cache.challenges[key] = {
        key,
        solved: false,
        save: async () => { throw new Error('Unexpected challenge completion') }
      }
    }
    cache.products.osaft = { description: '', reload: () => seq.query('SELECT 1') }

    const query = seq.query.bind(seq)
    const pending = new Set()
    let count = 0
    seq.query = (...args) => {
      count++
      const promise = query(...args)
      pending.add(promise)
      promise.then(() => pending.delete(promise), () => pending.delete(promise))
      return promise
    }

    let nextCalls = 0
    verify.databaseRelatedChallenges()({}, {}, () => { nextCalls++ })
    for (let idle = 0; idle < 3;) {
      await new Promise(resolve => setImmediate(resolve))
      if (pending.size) {
        await Promise.all([...pending])
        idle = 0
      } else {
        idle++
      }
    }

    assert.equal(nextCalls, 1)
    assert.equal(count, process.env.JUICE_DB_CHALLENGE_CHECKS === 'false' ? 0 : 44)
    assert.ok(keys.every(key => cache.challenges[key].solved === false))
    assert.equal(typeof verify.jwtChallenges, 'function')
  } finally {
    await seq.close()
  }
})
