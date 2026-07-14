import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import OpenAI from 'openai'

const env = dotenv.config().parsed // 环境参数
// 加载环境变量
dotenv.config()
const url = env.TONGYI_URL
const api_key = env.TONGYI_API_KEY
const model_name = env.TONGYI_MODEL || 'qwen-plus'

const openai = new OpenAI({
  apiKey: api_key,
  baseURL: url,
  temperature: 0,
})

const __dirname = path.resolve()
// 判断是否有 .env 文件, 没有则报错
const envPath = path.join(__dirname, '.env')
if (!fs.existsSync(envPath)) {
  console.log('❌ 请先根据文档，创建并配置 .env 文件！')
  process.exit(1)
}

export async function getTongyiReply(prompt) {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: prompt + ' ,用中文回答',
      },
    ],
    model: model_name,
  })

  console.log('🚀🚀🚀 / prompt', prompt)
  const Content = await completion.choices[0].message.content
  console.log('🚀🚀🚀 / reply', Content)
  return `${Content}`
}
