import { getServe } from './serve.js'
import { getWechatRuntimeConfig } from '../config/env.js'
import { handleWechatCommand } from '../platforms/wechat/commandRouter.js'
import {
  composeConversationPrompt,
  addUserMessage,
  addAssistantMessage,
  clearConversation,
} from '../memory/conversation.js'
import { getVisionReply } from '../vision/index.js'
import { searchWeb, formatSearchResults, isSearchQuery } from '../search/index.js'

// 图片大小限制 10MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

// wechaty-puppet-wechat4u: 图片消息 text 是 XML，用户文字作为独立 Text 消息随后到达。
// 存 unresolved Promise，让 Text handler await 它，等 GLM 跑完再拼合回复。
const pendingVisionResults = new Map() // imageKey -> { promise, timestamp }

// 引用图片识别：群友发的图片缓存下来，后续引用时匹配
const recentImages = new Map() // roomName:senderAlias -> { base64, timestamp }
const RECENT_IMAGE_TTL = 10 * 60 * 1000 // 10 分钟有效期

// GLM 超时（秒）
const VISION_TIMEOUT_MS = 30000

// ==================== 主动插话（非 @ 群聊消息） ====================
// 冷却：同一群至少隔这么多秒才允许下一次自动回复
const AUTO_REPLY_COOLDOWN = 30 * 1000
// 缓冲：攒够这么多条非 @ 消息后触发一次回复
const AUTO_REPLY_TRIGGER_COUNT = 5
// 缓冲最长保留时间：即便没攒够，超过此时间也触发
const AUTO_REPLY_MAX_BUFFER_AGE = 120 * 1000
// 缓冲过期时间：距离上一条消息超过这么久，说明话题已断，清空重来
const AUTO_REPLY_BUFFER_EXPIRY = 60 * 1000
// 回复时取最近多少条群聊消息作为上下文
const AUTO_REPLY_CONTEXT_COUNT = 10
// 群聊静默多久才开口（秒），防止群友刷屏时抢话
const AUTO_REPLY_SILENCE = 3 * 1000
// 静默等待最长多久：超过此时间还没安静也强行回复（防止活跃群永远不触发）
const AUTO_REPLY_SILENCE_TIMEOUT = 10 * 1000

const roomCooldowns = new Map() // roomName -> lastReplyTimestamp
const roomMsgBuffers = new Map() // roomName -> [{ alias, content, timestamp }]
const triggerReadySince = new Map() // roomName -> trigger 条件首次满足的时间戳

// 冷场救援：某人说话后 N 分钟内无人接话，机器人主动搭话
const COLD_CHAT_TIMEOUT = 3 * 60 * 1000 // 3 分钟
const COLD_CHAT_RESTART_COOLDOWN = 60 * 1000 // 被取消后 60 秒内不重新追
const coldChatStates = new Map() // roomName -> { senderAlias, messages, timerId }
const coldChatCooldowns = new Map() // roomName -> lastCancelledTimestamp

// 共享屏蔽词：命中任一则视为无效回复，不发
const BANNED_PHRASES = [
  '没有回复', '暂无回复', '无回复', '（无回复）', '无可奉告',
  '我没有什么想说的', '不知如何回复', '无法回复', '不回复',
  '无法参与', '不便回复', '难以回复', '不做回复',
]

/**
 * 冷场救援逻辑：记录发言者，3 分钟内无人接话则搭话
 */
async function handleColdChat(room, roomName, alias, content, conversationId, getReply) {
  let state = coldChatStates.get(roomName)

  // 换人说话了 → 说明有人接话，取消当前救援并设冷却
  if (state && state.senderAlias !== alias) {
    if (state.timerId) clearTimeout(state.timerId)
    coldChatStates.delete(roomName)
    coldChatCooldowns.set(roomName, Date.now())
    return
  }

  // 冷却期内不创建新救援（防止 A 说完 B 接了话，B 的"回应"被当作新一轮冷场）
  if (!state && coldChatCooldowns.has(roomName)) {
    if (Date.now() - coldChatCooldowns.get(roomName) < COLD_CHAT_RESTART_COOLDOWN) return
    coldChatCooldowns.delete(roomName)
  }

  // 同一个人继续说话 OR 首次记录
  if (!state) {
    state = { senderAlias: alias, messages: [], timerId: null }
    coldChatStates.set(roomName, state)
  }

  state.messages.push({ alias, content, timestamp: Date.now() })
  if (state.messages.length > 8) state.messages = state.messages.slice(-8)

  // 重置倒计时
  if (state.timerId) clearTimeout(state.timerId)
  state.timerId = setTimeout(async () => {
    // 到点了，检查冷却
    const lastReply = roomCooldowns.get(roomName) || 0
    if (Date.now() - lastReply < AUTO_REPLY_COOLDOWN) {
      coldChatStates.delete(roomName)
      return
    }

    // 设置冷却 + 清空主动插话缓冲，防止随后触发一条夹带旧上下文的回复
    roomCooldowns.set(roomName, Date.now())
    roomMsgBuffers.set(roomName, [])
    triggerReadySince.delete(roomName)
    coldChatStates.delete(roomName)

    const msgs = state.messages
    const context = msgs.map((m) => `${m.alias}：${m.content}`).join('\n')

    const rescuePrompt = [
      '【你是群聊的参与者，群里有个哥们发了消息好几分钟没人理，你去搭个话，别让人冷场。以下是他的消息：】',
      context,
      '【消息结束。请针对他的内容自然搭话。】',
    ].join('\n')

    console.log('❄️ 冷场救援:', roomName)
    const reply = await getReply(rescuePrompt)
    const trimmed = reply.trim()

    if (BANNED_PHRASES.some((p) => trimmed.includes(p)) || trimmed.length < 4) return

    const cleanReply = trimmed
      .replace(/^(贴吧老哥[：:]\s*|回复[：:]\s*|\(回复\)[：:]?\s*)+/i, '')
      .trim()
    // 冷场救援不写对话历史，避免污染 @ 回复的上下文
    await room.say(cleanReply)
  }, COLD_CHAT_TIMEOUT)
}

/**
 * 主动插话逻辑：攒满消息后读取最近 10 条群聊记录，直接回复
 */
async function handleAutoReply(room, roomName, alias, content, conversationId, getReply) {
  // 冷场救援追踪（fire-and-forget，不阻塞主流程）
  handleColdChat(room, roomName, alias, content, conversationId, getReply)

  // 获取当前缓冲
  let buffer = roomMsgBuffers.get(roomName) || []

  // 话题断档检测：上一条消息距现在已经超过过期阈值，说明聊天已断，清空重来
  if (buffer.length > 0) {
    const gap = Date.now() - buffer[buffer.length - 1].timestamp
    if (gap > AUTO_REPLY_BUFFER_EXPIRY) {
      console.log('🗑️ 缓冲过期，清空旧上下文')
      buffer = []
      triggerReadySince.delete(roomName)
    }
  }

  // 更新消息缓冲
  buffer.push({ alias, content, timestamp: Date.now() })
  if (buffer.length > 30) buffer = buffer.slice(-30)
  roomMsgBuffers.set(roomName, buffer)

  // 冷却检查
  const lastReply = roomCooldowns.get(roomName) || 0
  if (Date.now() - lastReply < AUTO_REPLY_COOLDOWN) return

  // 触发条件：攒够 5 条才触发；或者缓冲超时且至少 3 条（太少没上下文价值）
  const oldestInBuffer = buffer[0]?.timestamp || Date.now()
  const enoughMessages = buffer.length >= AUTO_REPLY_TRIGGER_COUNT
  const bufferTimedOut = buffer.length >= 3 && Date.now() - oldestInBuffer > AUTO_REPLY_MAX_BUFFER_AGE

  if (!enoughMessages && !bufferTimedOut) {
    triggerReadySince.delete(roomName)
    return
  }

  // 记录触发条件首次满足的时间
  if (!triggerReadySince.has(roomName)) {
    triggerReadySince.set(roomName, Date.now())
  }
  const waitingTime = Date.now() - triggerReadySince.get(roomName)

  // 静默检查：等 3 秒安静，但最多等 10 秒就强行回复
  const lastMsgAge = Date.now() - buffer[buffer.length - 1].timestamp
  if (lastMsgAge < AUTO_REPLY_SILENCE && waitingTime < AUTO_REPLY_SILENCE_TIMEOUT) {
    return // 继续等
  }

  triggerReadySince.delete(roomName)

  // ⚠️ 立即设置冷却，防止 await 期间新消息触发重复回复
  roomCooldowns.set(roomName, Date.now())
  // 已经要回复了，取消冷场救援
  if (coldChatStates.has(roomName)) {
    const cs = coldChatStates.get(roomName)
    if (cs.timerId) clearTimeout(cs.timerId)
    coldChatStates.delete(roomName)
    coldChatCooldowns.delete(roomName)
  }

  // 取最近 10 条作为上下文
  const recent = buffer.slice(-AUTO_REPLY_CONTEXT_COUNT)
  roomMsgBuffers.set(roomName, []) // 清空缓冲

  const context = recent.map((m) => `${m.alias}：${m.content}`).join('\n')

  const replyPrompt = [
    '【你是群聊的参与者，id孙笑川，以下是最近的群聊消息。请作为群成员自然接话。】',
    context,
    '【群聊记录结束。请直接回复，不要输出任何前缀或说明。】',
  ].join('\n')

  console.log(`🤖 主动插话（${roomName}，${recent.length} 条消息）`)
  const reply = await getReply(replyPrompt)

  const trimmed = reply.trim()

  // 屏蔽机器人式无效回复
  if (BANNED_PHRASES.some((p) => trimmed.includes(p)) || trimmed.length < 4) {
    console.log('🤖 主动插话被屏蔽（无效回复）:', trimmed.slice(0, 40))
    return
  }

  // 清理 ai 可能产生的自说自话前缀
  const cleanReply = trimmed
    .replace(/^(孙笑川[：:]\s*|回复[：:]\s*|\(回复\)[：:]?\s*|【回复】[：:]?\s*)+/i, '')
    .trim()

  console.log('🤖 主动插话:', cleanReply.slice(0, 80))

  // 存入对话历史
  addUserMessage(conversationId, context)
  addAssistantMessage(conversationId, cleanReply)

  await room.say(cleanReply)
}

/**
 * 将 Wechaty 图片消息转为 base64 data URL
 */
async function imageToBase64Url(msg) {
  const fileBox = await msg.toFileBox()
  const buffer = await fileBox.toBuffer()
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`图片过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），请压缩后重试`)
  }
  const mimeType = fileBox.mediaType || 'image/jpeg'
  const base64 = buffer.toString('base64')
  return `data:${mimeType};base64,${base64}`
}

/**
 * 检测图片消息 text 是否为 XML 负载（非用户真实输入）
 */
function isXmlPayload(text) {
  const t = text.trimStart()
  return t.startsWith('<?xml') || t.startsWith('<msg>')
}

/**
 * 处理图片消息：GLM-4.5V 识别
 *
 * 关键设计：text 是 XML 时不做回复，改为存一个 unresolved Promise。
 * 随后的 Text 消息会 await 这个 Promise，等 GLM 返回后再拼合回复。
 */
async function handleImageMessage({ msg, bot, room, contact, alias, roomName, imageKey, getReply }) {
  const imgUrl = await imageToBase64Url(msg)

  // 缓存图片（按 room:sender），后续引用图片时可用
  const cacheKey = `${roomName || 'private'}:${alias}`
  recentImages.set(cacheKey, { base64: imgUrl, timestamp: Date.now() })

  const rawText = msg.text() || ''
  const isXml = isXmlPayload(rawText)

  if (isXml) {
    // ========= text 是 XML：存 Promise，fire-and-forget，不做回复 =========
    console.log('🖼️ 收到图片消息（XML 负载），开始异步识别，等待后续文字...')

    const visionPromise = Promise.race([
      getVisionReply(
        '请仔细识别并描述这张图片。如果图片中有角色/人物，请直接说出角色名字、出处作品；如果是物体/场景，请描述关键特征。',
        imgUrl,
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('图片识别超时')), VISION_TIMEOUT_MS),
      ),
    ]).catch((err) => {
      console.error('👁️ 图片识别失败:', err.message)
      return null // null = 识别失败
    })

    pendingVisionResults.set(imageKey, {
      promise: visionPromise,
      timestamp: Date.now(),
    })

    return // 不回复，等 Text 消息来拿结果
  }

  // ========= text 是真实文字（罕见）：直接识别 + 回复 =========
  console.log('🖼️ 收到图片消息（含真实 text），直接识别 + 回复')
  const visionDesc = await Promise.race([
    getVisionReply(rawText.trim(), imgUrl),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('图片识别超时')), VISION_TIMEOUT_MS),
    ),
  ]).catch((err) => {
    console.error('👁️ 图片识别失败:', err.message)
    return null
  })

  if (!visionDesc) {
    if (room) await room.say('图片识别失败，请重试。')
    else await contact.say('图片识别失败，请重试。')
    return
  }

  await replyWithVision({ room, contact, conversationId: imageKey, getReply, visionDesc, userText: rawText.trim() })
}

/**
 * 将视觉识别结果 + 用户文字拼合，通过 DeepSeek 回复一次
 */
async function replyWithVision({ room, contact, conversationId, getReply, visionDesc, userText }) {
  const question = userText || '请根据图片内容回复'

  const deepseekPrompt = [
    '【用户发来了一张图片，视觉AI已识别出以下内容，请严格据此回答】',
    '---图片识别结果---',
    visionDesc,
    '---识别结果结束---',
    `用户对图片的提问：${question}`,
    '请直接回答用户的问题，不要说你"没看到图片"或让用户"描述图片内容"。',
  ].join('\n')

  const fullPrompt = composeConversationPrompt(conversationId, deepseekPrompt)
  addUserMessage(conversationId, `[发送了一张图片] ${question}`)
  const response = await getReply(fullPrompt)
  addAssistantMessage(conversationId, response)

  if (room) {
    await room.say(response)
  } else {
    await contact.say(response)
  }
}

/**
 * 默认消息发送
 */
export async function defaultMessage(msg, bot, ServiceType = 'GPT') {
  const { botName, autoReplyPrefix, aliasWhiteList, roomWhiteList, commandPrefix } = getWechatRuntimeConfig()
  const getReply = getServe(ServiceType)
  const contact = msg.talker()

  const content = msg.text()
  const room = msg.room()
  const roomName = (await room?.topic()) || null
  const alias = (await contact.alias()) || (await contact.name())
  const remarkName = await contact.alias()
  const name = await contact.name()
  const isText = msg.type() === bot.Message.Type.Text
  const isImage = msg.type() === bot.Message.Type.Image
  const isRoom = roomWhiteList.includes(roomName) && content.includes(`${botName}`)
  const isAlias = aliasWhiteList.includes(remarkName) || aliasWhiteList.includes(name)
  const isBotSelf = botName === `@${remarkName}` || botName === `@${name}`
  const isBotSelfDebug = content.trimStart().startsWith('你是谁')
  const isAuthorizedCommand = (room && isRoom) || (!room && isAlias)

  const conversationId = room ? `room:${roomName}` : `private:${alias}`

  const isRelevant = isText || isImage
  if ((isBotSelf && !isBotSelfDebug) || !isRelevant) return

  try {
    // ==================== 命令处理 ====================
    if (content.replace(`${botName}`, '').trimStart().startsWith(commandPrefix)) {
      if (!isAuthorizedCommand) return
      const commandResult = await handleWechatCommand(content, {
        serviceType: ServiceType,
        roomName,
        alias,
        name,
      })
      if (commandResult.handled) {
        if (commandResult.reply) await (room || contact).say(commandResult.reply)
        return
      }
    }

    // ==================== 图片消息处理 ====================
    // 群聊图片：白名单群的图片一律识别暂存——用户可能随后 @机器人 提问
    // key 含发送者，确保文字 @ 到达时能对上号
    if (room && roomWhiteList.includes(roomName) && isImage) {
      const imageKey = `img:room:${roomName}:${alias}`
      try {
        await handleImageMessage({ msg, bot, room, contact, alias, roomName, imageKey, getReply })
      } catch (e) {
        console.error('群聊图片处理失败:', e.message)
        pendingVisionResults.delete(imageKey)
        await room.say(`图片处理失败：${e.message || '请重试'}`)
      }
      return
    }

    // 私聊图片
    if (!room && isAlias && isImage) {
      const imageKey = `img:private:${alias}`
      try {
        await handleImageMessage({ msg, bot, room: null, contact, alias, roomName, imageKey, getReply })
      } catch (e) {
        console.error('私聊图片处理失败:', e.message)
        pendingVisionResults.delete(imageKey)
        await contact.say(`图片处理失败：${e.message || '请重试'}`)
      }
      return
    }

    // ==================== 文本消息处理 ====================

    // 首要：检查是否有待完的图片识别 Promise（图片先到、文字后到的场景）
    // 群聊 key = img:room:群名:发送者，私聊 key = img:private:发送者
    const imageKey = room ? `img:room:${roomName}:${alias}` : `img:private:${alias}`
    const pendingVision = pendingVisionResults.get(imageKey)
    if (pendingVision && Date.now() - pendingVision.timestamp < 45000) {
      pendingVisionResults.delete(imageKey)

      // 提取用户实际文字
      let userText
      if (room && isRoom) {
        userText =
          (await msg.mentionText()) ||
          content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '').trim()
      } else {
        userText = content.replace(`${autoReplyPrefix}`, '').trim()
      }
      if (!userText || userText.length === 0) {
        userText = '请描述这张图片'
      }

      // 重置命令仍可触发
      const resetKeywords = ['重置对话', '清除记忆', '清理上下文']
      if (resetKeywords.some((kw) => userText === kw)) {
        clearConversation(conversationId)
        pendingVision.promise.then(() => {}).catch(() => {}) // 让 pending promise 自行结
        if (room) await room.say('✅ 对话上下文已清除，你可以开始新的对话了。')
        else await contact.say('✅ 对话上下文已清除，你可以开始新的对话了。')
        return
      }

      console.log('🔗 等待图片识别结果...')
      const startWait = Date.now()
      const visionDesc = await pendingVision.promise
      const waited = ((Date.now() - startWait) / 1000).toFixed(1)
      console.log(`🔗 图片识别完成（等待 ${waited}s）`)

      if (!visionDesc) {
        // 识别失败，但用户文字还能独立回复
        console.log('⚠️ 图片识别失败，仅用文字回复')
        const fullPrompt = composeConversationPrompt(conversationId, userText)
        addUserMessage(conversationId, userText)
        const response = await getReply(fullPrompt)
        addAssistantMessage(conversationId, response)
        if (room) await room.say(response)
        else await contact.say(response)
        return
      }

      await replyWithVision({
        room: room || null,
        contact,
        conversationId,
        getReply,
        visionDesc,
        userText,
      })
      return
    }

    // ==================== 引用图片识别 ====================
    // 仅当 @ 了机器人才触发，防止群友互相引用图时机器人乱入
    if (isAuthorizedCommand && isText) {
      const quotedImageMatch = content.match(/「(.+?)：\[图片\]/)
      if (quotedImageMatch) {
        const quotedSender = quotedImageMatch[1]
        const cacheKey = `${roomName || 'private'}:${quotedSender}`
        const cached = recentImages.get(cacheKey)

        // 10 分钟内有效
        if (cached && Date.now() - cached.timestamp < RECENT_IMAGE_TTL) {
          // 提取用户对引用图的提问
          let userText
          if (room) {
            userText = content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '').replace(/「.+?：\[图片\]」/g, '').trim()
          } else {
            userText = content.replace(`${autoReplyPrefix}`, '').replace(/「.+?：\[图片\]」/g, '').trim()
          }
          if (!userText) userText = '请描述这张图片'

          console.log('📎 引用图片识别:', quotedSender)

          // 调 GLM 识别这张缓存图
          const visionDesc = await Promise.race([
            getVisionReply(userText, cached.base64),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('图片识别超时')), VISION_TIMEOUT_MS),
            ),
          ]).catch((err) => {
            console.error('👁️ 引用图识别失败:', err.message)
            return null
          })

          if (visionDesc) {
            await replyWithVision({
              room: room || null,
              contact,
              conversationId,
              getReply,
              visionDesc,
              userText,
            })
          }
          return
        }

        // 缓存过期 → 贴吧老哥式吐槽
        if (room && (isRoom || roomWhiteList.includes(roomName))) {
          await room.say('老图别问了，翻聊天记录很累的不知道吗？')
        } else {
          await contact.say('老图别问了，翻聊天记录很累的不知道吗？')
        }
        return
      }
    }

    // 普通文本：重置对话命令
    const resetKeywords = ['重置对话', '清除记忆', '清理上下文']
    const checkReset = (rawText) => resetKeywords.some((kw) => rawText.trim() === kw)

    /**
     * 统一的文本回复处理：检测是否需要联网搜索，需要则先搜再回
     */
    async function textReply(question, target) {
      console.log('🌸🌸🌸 / question:', question)

      // 检测是否需要联网搜索
      let searchResult = null
      if (isSearchQuery(question)) {
        console.log('🔍 检测到搜索需求...')
        searchResult = await searchWeb(question)
      }

      // 拼接最终 prompt
      let finalPrompt
      if (searchResult && searchResult.results.length > 0) {
        const searchText = formatSearchResults(searchResult)
        finalPrompt = composeConversationPrompt(conversationId, `${searchText}\n\n用户提问：${question}`)
        addUserMessage(conversationId, `[搜索: ${question}] ${question}`)
      } else {
        finalPrompt = composeConversationPrompt(conversationId, question)
        addUserMessage(conversationId, question)
      }

      const response = await getReply(finalPrompt)
      addAssistantMessage(conversationId, response)
      await target.say(response)
    }

    // 群聊文本
    if (isRoom && room && content.replace(`${botName}`, '').trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question =
        (await msg.mentionText()) ||
        content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '')
      if (checkReset(question)) {
        clearConversation(conversationId)
        await room.say('✅ 对话上下文已清除，你可以开始新的对话了。')
        return
      }
      await textReply(question, room)
    }

    // 私聊文本
    if (isAlias && !room && content.trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question = content.replace(`${autoReplyPrefix}`, '')
      if (checkReset(question)) {
        clearConversation(conversationId)
        await contact.say('✅ 对话上下文已清除，你可以开始新的对话了。')
        return
      }
      await textReply(question, contact)
    }

    // 主动插话：白名单群中的非 @ 消息（机器人未被动点名时，自己找话插）
    if (room && roomWhiteList.includes(roomName) && isText && !content.includes(botName)) {
      await handleAutoReply(room, roomName, alias, content, conversationId, getReply)
      return
    }
  } catch (e) {
    console.error(e)
  }
}

// ==================== 以下为旧的 shardingMessage（保留兼容） ====================

const SINGLE_MESSAGE_MAX_SIZE = 500

export async function shardingMessage(message, bot) {
  const talker = message.talker()
  const isText = message.type() === bot.Message.Type.Text
  if (talker.self() || message.type() > 10 || (talker.name() === '微信团队' && isText)) return

  const text = message.text()
  const room = message.room()
  if (!room) {
    console.log(`Chat GPT Enabled User: ${talker.name()}`)
    const response = await getChatGPTReply(text)
    await trySay(talker, response)
    return
  }

  let realText = splitMessage(text)
  if (text.indexOf(`${botName}`) === -1) return
  realText = text.replace(`${botName}`, '')
  const response = await getChatGPTReply(realText)
  await trySay(room, `${realText}\n ---------------- \n ${response}`)
}

async function trySay(talker, msg) {
  const messages = []
  let message = msg
  while (message.length > SINGLE_MESSAGE_MAX_SIZE) {
    messages.push(message.slice(0, SINGLE_MESSAGE_MAX_SIZE))
    message = message.slice(SINGLE_MESSAGE_MAX_SIZE)
  }
  messages.push(message)
  for (const m of messages) {
    await talker.say(m)
  }
}

async function splitMessage(text) {
  const item = text.split('- - - - - - - - - - - - - - -')
  return item.length > 1 ? item[item.length - 1] : text
}
