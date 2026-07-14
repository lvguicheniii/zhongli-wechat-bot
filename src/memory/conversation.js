const conversations = new Map()

const MAX_HISTORY = 20 // 10轮对话（20条消息）

/**
 * 获取当前时间上下文（北京时间）
 */
export function getCurrentTimeContext() {
  const now = new Date()
  // 用 UTC+8 计算北京时间
  const bjTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const day = days[bjTime.getUTCDay()]
  const year = bjTime.getUTCFullYear()
  const month = String(bjTime.getUTCMonth() + 1).padStart(2, '0')
  const date = String(bjTime.getUTCDate()).padStart(2, '0')
  const hours = String(bjTime.getUTCHours()).padStart(2, '0')
  const minutes = String(bjTime.getUTCMinutes()).padStart(2, '0')
  const seconds = String(bjTime.getUTCSeconds()).padStart(2, '0')
  return `今天是${year}年${month}月${date}日 ${day}，北京时间 ${hours}:${minutes}:${seconds}。`
}

/**
 * 将对话历史 + 时间上下文 + 当前提问组合成完整 prompt
 * @param {string} conversationId 对话标识（群聊用 room:xxx，私聊用 private:xxx）
 * @param {string} currentQuestion 当前用户提问
 * @returns {string} 组合后的完整 prompt
 */
export function composeConversationPrompt(conversationId, currentQuestion) {
  const timeContext = getCurrentTimeContext()
  const messages = conversations.get(conversationId) || []

  // 构建对话历史文本
  let historyText = ''
  for (const m of messages) {
    if (m.role === 'user') {
      historyText += `用户：${m.content}\n`
    } else {
      historyText += `助手：${m.content}\n`
    }
  }

  // 组合最终 prompt
  const parts = [timeContext]

  if (historyText.trim()) {
    parts.push('以下是此前的对话历史，请结合上下文理解并回答用户的最新提问：')
    parts.push(historyText.trim())
  }

  parts.push(`用户最新提问：${currentQuestion}`)

  return parts.join('\n\n')
}

export function getMessages(id, systemPrompt) {
  const history = conversations.get(id) || []

  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...history,
  ]
}

export function addUserMessage(id, content) {
  const history = conversations.get(id) || []

  history.push({
    role: 'user',
    content,
  })

  conversations.set(id, history.slice(-MAX_HISTORY))
}

export function addAssistantMessage(id, content) {
  const history = conversations.get(id) || []

  history.push({
    role: 'assistant',
    content,
  })

  conversations.set(id, history.slice(-MAX_HISTORY))
}

export function clearConversation(id) {
  conversations.delete(id)
}
