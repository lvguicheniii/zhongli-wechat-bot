import { remark } from 'remark'
import stripMarkdown from 'strip-markdown'
import OpenAI from 'openai'
import dotenv from 'dotenv'
const env = dotenv.config().parsed // 环境参数
import fs from 'fs'
import path from 'path'

const __dirname = path.resolve()
// 判断是否有 .env 文件, 没有则报错
const envPath = path.join(__dirname, '.env')
if (!fs.existsSync(envPath)) {
  console.log('❌ 请先根据文档，创建并配置.env文件！')
  process.exit(1)
}

let config = {
  apiKey: env.DEEPSEEK_API_KEY,
}
if (env.DEEPSEEK_URL) {
  config.baseURL = env.DEEPSEEK_URL
}
const openai = new OpenAI(config)
const chosen_model = env.DEEPSEEK_MODEL
export async function getDeepseekReply(prompt) {
  console.log('🚀🚀🚀 / prompt', prompt)
  const response = await openai.chat.completions.create({
    messages: [
      { role: 'system', content: env.DEEPSEEK_SYSTEM_MESSAGE },
      { role: 'user', content: prompt },
    ],
    model: chosen_model,
  })
  console.log('🚀🚀🚀 / reply', response.choices[0].message.content)
  return `${response.choices[0].message.content}`
}
