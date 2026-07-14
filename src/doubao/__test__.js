import { getDoubaoReply } from './index.js'

// 测试 open ai api
async function testMessage() {
  let message
  message = await getDoubaoReply('猪可以吃钛合金吗')
  console.log('🌸🌸🌸 / message: ', message)
  message = await getDoubaoReply('这是哪里？', 'https://ark-project.tos-cn-beijing.ivolces.com/images/view.jpeg')
  console.log('🌸🌸🌸 / message: ', message)
}

testMessage()
