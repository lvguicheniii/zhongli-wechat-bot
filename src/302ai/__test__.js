import { get302AiReply } from './index.js'

// 测试 302 ai api
async function testMessage() {
  const message = await get302AiReply('hello')
  console.log('🌸🌸🌸 / message: ', message)
}

testMessage()
