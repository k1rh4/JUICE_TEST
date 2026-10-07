'use strict'

const policy = process.env.JUICE_CHALLENGE_POLICY ?? 'default'

if (!['default', 'non-dos'].includes(policy)) {
  throw new Error('JUICE_CHALLENGE_POLICY must be default or non-dos')
}

if (policy === 'non-dos') {
  const config = require('/juice-shop/node_modules/config')
  const staticData = require('/juice-shop/build/data/staticData')
  const utils = require('/juice-shop/build/lib/utils')
  const challengeUtils = require('/juice-shop/build/lib/challengeUtils')
  const fileUpload = require('/juice-shop/build/routes/fileUpload')
  const xml = require('/juice-shop/build/lib/xml')
  const { guardXmlParser, guardYamlUpload } = require('./non-dos-uploads.cjs')
  const blocked = new Set([
    'rceChallenge', 'rceOccupyChallenge', 'noSqlCommandChallenge',
    'xxeDosChallenge', 'yamlBombChallenge'
  ])

  if (config.get('challenges.safetyMode') === 'disabled') {
    throw new Error('The non-dos policy requires challenges.safetyMode to be auto or enabled')
  }

  const loadChallenges = staticData.loadStaticChallengeData
  staticData.loadStaticChallengeData = async () => {
    const challenges = await loadChallenges()
    for (const key of blocked) {
      if (!challenges.some(challenge => challenge.key === key)) {
        throw new Error('Missing DoS challenge in this Juice Shop image: ' + key)
      }
    }
    return challenges.map(challenge => ({
      ...challenge,
      disabledEnv: blocked.has(challenge.key) ? ['Docker', 'Heroku', 'Windows'] : undefined
    }))
  }

  const isEnabled = utils.isChallengeEnabled
  utils.isChallengeEnabled = challenge => !blocked.has(challenge?.key) && isEnabled(challenge)
  const solve = challengeUtils.solve
  challengeUtils.solve = (challenge, ...args) => {
    if (!blocked.has(challenge?.key)) return solve(challenge, ...args)
  }

  // XML/YAML uploads share the Deprecated Interface switch with the DoS challenges.
  xml.parseXmlString = guardXmlParser(xml.parseXmlString)
  fileUpload.handleYamlUpload = guardYamlUpload()
  process.stderr.write('[JUICETEST] Non-DoS challenges enabled; 5 DoS challenges disabled\n')
}
