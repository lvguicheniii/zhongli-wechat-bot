# 钟离 — 微信 AI 群聊机器人

基于 [Wechaty](https://github.com/wechaty/wechaty) 和 [wechat-bot](https://github.com/wangrongding/wechat-bot)的微信 AI 群聊机器人，接入 DeepSeek + GLM-4.5V 双模型，支持图片识别、联网搜索、主动插话、冷场救援。
原本是下了大佬的项目之后和朋友自娱自乐，但是使用过程中发现一些帮助的地方，在大佬的基础上添加了一些新的功能，分享出来

---

## 核心功能

| 功能 | 说明 |
|------|------|
| AI 对话 | @机器人 即可对话，支持多轮上下文记忆 |
| 图片识别 | 发图或引用图提问，GLM-4.5V 识别后 DeepSeek 回答 |
| 主动插话 | 群聊攒够 5 条消息后自动判断话题参与 |
| 冷场救援 | 3 分钟无人接话，机器人搭话暖场 |
| 联网搜索 | 含"最新/新闻/如何评价"等问题自动搜索后回答 |
| 多群支持 | 白名单机制，多群独立上下文 |

---

## 准备工作

- **Node.js** ≥ 18
- 一个不常用的**微信小号**（Web 协议有封号风险）
- [SiliconFlow](https://siliconflow.cn) 注册获取 API Key（≈10 元够用很久）

## 快速开始

```bash
# 1. 克隆项目
git clone <你的仓库地址>
cd wechat-bot

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
```

编辑 `.env`，填入必填项：

```ini
# ========== 必填 ==========
# AI 对话模型（SiliconFlow）
DEEPSEEK_API_KEY='sk-xxxxxxxx'
DEEPSEEK_URL='https://api.siliconflow.cn/v1'
DEEPSEEK_MODEL='deepseek-ai/DeepSeek-V3'

# 图片识别模型（SiliconFlow）
VISION_API_KEY='sk-xxxxxxxx'
VISION_BASE_URL='https://api.siliconflow.cn/v1'
VISION_MODEL='zai-org/GLM-4.5V'

# 机器人微信昵称（必须和微信账号昵称一致）
BOT_NAME='@钟离'

# 白名单
ALIAS_WHITELIST='你的微信昵称'
ROOM_WHITELIST='群名1,群名2'

# ========== 可选 ==========
# 系统预设人格
DEEPSEEK_SYSTEM_MESSAGE='...'

# 联网搜索（不填则自动用免费 Bing 抓取）
BING_API_KEY=''
```

```bash
# 4. 启动
npm start
```

终端会显示二维码，用微信小号扫描登录。

---

## Docker 部署

```bash
docker build -t wechat-bot .
docker run -d --name wechat-bot -v $(pwd)/.env:/app/.env wechat-bot
```

---

## 环境变量完整说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek API Key（SiliconFlow） |
| `DEEPSEEK_URL` | ✅ | API 地址 |
| `DEEPSEEK_MODEL` | ✅ | 模型名称 |
| `DEEPSEEK_SYSTEM_MESSAGE` | - | 系统预设人格 |
| `VISION_API_KEY` | ✅ | 图片识别 API Key |
| `VISION_BASE_URL` | ✅ | 图片识别 API 地址 |
| `VISION_MODEL` | ✅ | 图片识别模型 |
| `BOT_NAME` | ✅ | 机器人微信昵称（带 @） |
| `ALIAS_WHITELIST` | ✅ | 联系人白名单（逗号分隔） |
| `ROOM_WHITELIST` | ✅ | 群聊白名单（逗号分隔） |
| `SERVICE_TYPE` | ✅ | `deepseek` |
| `AUTO_REPLY_PREFIX` | - | 消息前缀过滤 |
| `BING_API_KEY` | - | 联网搜索 Bing Key |
| `BOT_COMMAND_PREFIX` | - | 内置命令前缀，默认 `/` |

---

## 内置命令

在群里 @机器人发送：

| 命令 | 说明 |
|------|------|
| `/统计 群 群名` | 统计群聊消息数据 |
| `/分析 好友 昵称` | AI 分析聊天记录 |
| `重置对话` | 清空当前会话上下文 |
| `清除记忆` | 同上 |

---

## 目录结构

```
src/
├── wechaty/          # 消息处理核心
│   ├── sendMessage.js   # 消息路由、插话、冷场救援
│   └── serve.js         # AI 服务懒加载
├── vision/           # 图片识别（GLM-4.5V）
├── search/           # 联网搜索（Bing）
├── memory/           # 对话记忆
├── deepseek/         # DeepSeek Provider
├── platforms/wechat/ # Wechaty 机器人 & 命令路由
└── analysis/         # 聊天记录分析
```

---

## 常见问题

**Q: 扫码后一直登录中？**
A: Web 协议限制，尝试重启程序重新扫码。

**Q: 图片识别不工作？**
A: 检查 `VISION_API_KEY` 是否正确，网络是否可达 `api.siliconflow.cn`。

**Q: 群聊不回复？**
A: 检查 `ROOM_WHITELIST` 是否包含群名，`BOT_NAME` 是否与微信昵称一致。
