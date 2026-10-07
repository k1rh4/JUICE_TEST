'use strict'

const enabled = process.env.JUICE_DB_CHALLENGE_CHECKS ?? 'true'

if (enabled !== 'true' && enabled !== 'false') {
  throw new Error('JUICE_DB_CHALLENGE_CHECKS must be true or false')
}

if (enabled === 'false') {
  const verify = require('/juice-shop/build/routes/verify.js')
  if (typeof verify.databaseRelatedChallenges !== 'function') {
    throw new Error('This Juice Shop image does not expose databaseRelatedChallenges')
  }
  verify.databaseRelatedChallenges = () => (_req, _res, next) => next()
  process.stderr.write('[JUICETEST] Per-request DB challenge checks disabled\n')
}
