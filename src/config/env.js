import dotenv from 'dotenv'

const dotenvResult = dotenv.config()

export const env = {
  ...(dotenvResult.parsed || {}),
  ...process.env,
}

export function readCsvEnv(key) {
  return (env[key] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readCsvEnvOrDefault(key, fallback) {
  const values = readCsvEnv(key)
  return values.length ? values : fallback
}

export function getWechatRuntimeConfig() {
  return {
    botName: env.BOT_NAME || '',
    autoReplyPrefix: env.AUTO_REPLY_PREFIX || '',
    aliasWhiteList: readCsvEnv('ALIAS_WHITELIST'),
    roomWhiteList: readCsvEnv('ROOM_WHITELIST'),
    dataDir: env.WECHAT_DATA_DIR || '.data/wechat',
    storeMessages: env.WECHAT_STORE_MESSAGES !== 'false',
    commandPrefix: env.BOT_COMMAND_PREFIX || '/',
    enableRemoteOpenCli: env.ENABLE_REMOTE_OPENCLI === 'true',
  }
}

export function getLarkRuntimeConfig() {
  return {
    bin: env.LARK_CLI_BIN || 'lark-cli',
    defaultIdentity: env.LARK_DEFAULT_IDENTITY || 'user',
    agentIdentity: env.LARK_AGENT_IDENTITY || 'bot',
    agentEventKey: env.LARK_AGENT_EVENT_KEY || 'im.message.receive_v1',
    agentChatTypes: readCsvEnvOrDefault('LARK_AGENT_CHAT_TYPES', ['p2p', 'group']),
    agentMessageTypes: readCsvEnvOrDefault('LARK_AGENT_MESSAGE_TYPES', ['text', 'post']),
    agentChatWhiteList: readCsvEnv('LARK_AGENT_CHAT_WHITELIST'),
    agentUserWhiteList: readCsvEnv('LARK_AGENT_USER_WHITELIST'),
    agentIgnoreSenderIds: readCsvEnv('LARK_AGENT_IGNORE_SENDER_IDS'),
    agentReplyPrefix: env.LARK_AGENT_REPLY_PREFIX || '',
    agentGroupMentionName: env.LARK_AGENT_GROUP_MENTION_NAME || '',
    agentGroupAutoReply: env.LARK_AGENT_GROUP_AUTO_REPLY === 'true',
    dataDir: env.LARK_DATA_DIR || '.data/lark',
    storeMessages: env.LARK_STORE_MESSAGES !== 'false',
    dedupSize: Number(env.LARK_AGENT_DEDUP_SIZE || 500),
  }
}

export function getOpenCliRuntimeConfig() {
  return {
    bin: env.OPENCLI_BIN || '',
    npmPackage: env.OPENCLI_NPM_PACKAGE || '@jackwener/opencli',
  }
}

export function getPiRuntimeConfig() {
  return {
    bin: env.PI_BIN || '',
    npmPackage: env.PI_NPM_PACKAGE || '@earendil-works/pi-coding-agent',
    agentArgs: env.PI_AGENT_ARGS || '--print --no-session',
  }
}
