import OpenAI from 'openai'
import dotenv from 'dotenv'

const env = dotenv.config().parsed

const openai = new OpenAI({
  apiKey: env.VISION_API_KEY,
  baseURL: env.VISION_BASE_URL || 'https://api.siliconflow.cn/v1',
})

const chosen_model = env.VISION_MODEL || 'zai-org/GLM-4.5V'

/**
 * 调用 GLM-4.5V 视觉模型识别图片
 * @param {string} prompt  对图片的提问 / 指令
 * @param {string} img_url 图片 URL（支持 http(s):// 或 data:image/xxx;base64,...）
 * @returns {Promise<string>} 模型返回的文字描述
 */
export async function getVisionReply(prompt, img_url) {
  console.log('👁️👁️👁️ / vision prompt:', prompt)

  const response = await openai.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: img_url } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    model: chosen_model,
    max_tokens: 1024,
  })

  const reply = response.choices[0].message.content
  console.log('👁️👁️👁️ / vision reply:', reply)
  return reply
}
