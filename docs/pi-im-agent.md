# Pi Agent + IM Guide

English | [Simplified Chinese](./pi-im-agent.zh-CN.md)

This document explains how to use this project as a runtime shell for a Pi agent, with IM as the external communication channel.

## Target Pipeline

```text
External IM message -> wechat-bot -> Pi agent -> IM reply
```

Currently implemented:

- WeChat IM: receive and reply to messages after QR-code login.
- Pi agent: handles WeChat and Lark messages as a `serve` type.
- Local WeChat data: access chats, group members, statistics, and Moments cache through OpenCLI `wx-cli`.
- Lark IM: login, send messages, read messages, search messages, and consume message events through `lark-cli`.

## Installation Command

If you want to use the `wb` command directly, run this in the project root:

```sh
npm link
```

You can also skip `wb` and use:

```sh
npm run start -- <command>
```

## Environment Configuration

Copy and edit `.env`:

```sh
cp .env.example .env
```

Recommended WeChat + Pi configuration:

```env
BOT_NAME='@Your WeChat nickname'
ALIAS_WHITELIST='Friend alias allowed for private chat'
ROOM_WHITELIST='Group name allowed for access'
AUTO_REPLY_PREFIX=''

WECHAT_DATA_DIR='.data/wechat'
WECHAT_STORE_MESSAGES='true'

PI_BIN='pi'
PI_NPM_PACKAGE='@earendil-works/pi-coding-agent'
PI_AGENT_ARGS='--print --no-session'
```

If your machine does not have a global `pi` command, leave it empty:

```env
PI_BIN=''
```

The project will start Pi through `npx --yes @earendil-works/pi-coding-agent`, but each cold start will be slower.

## Connect Pi Through WeChat QR-code Login

Recommended command:

```sh
wb agent --im wechat --agent pi
```

Equivalent command:

```sh
wb start --serve pi
```

Or use npm:

```sh
npm run agent
npm run start -- start --serve pi
```

After startup, the terminal shows a WeChat QR code. Once login succeeds, the pipeline is:

```text
WeChat QR-code login -> Wechaty receives message -> local JSONL capture -> Pi single-turn agent reply -> WeChat IM sends reply
```

Trigger rules:

- Private chats: the sender must be in `ALIAS_WHITELIST`.
- Group chats: the group name must be in `ROOM_WHITELIST`, and the message must mention `@bot nickname`.
- Non-text messages are not sent to the Pi reply pipeline.

## Built-in WeChat Analysis Commands

You can send commands directly in WeChat chats:

```text
/stats group GroupName
/analyze group GroupName
/stats friend FriendAlias
/analyze friend FriendAlias
```

Notes:

- `/stats` only reads local JSONL and does not call AI.
- `/analyze` calls the current agent or AI service and sends recent message samples to the model.
- For private chats, prefer a local model or local Pi configuration.

## Local WeChat Data and Moments

OpenCLI `wx-cli` can access local WeChat cache data:

```sh
wb wx init
wb wx sessions
wb wx history
wb wx search
wb wx contacts
wb wx members
wb wx stats
wb wx favorites
wb wx sns-feed
wb wx sns-search
wb wx sns-notifications
```

Run this first before initial use:

```sh
wb wx init
```

View the full command list supported by `wx-cli`:

```sh
wb wx help
```

## Lark IM

Lark can log in, read and write messages, search messages, and run an event-based agent:

```sh
wb lark login --no-wait
wb lark status
wb lark messages --chat-id oc_xxx
wb lark search --query "keyword"
wb lark send --chat-id oc_xxx --text "hello"
```

`--no-wait` returns a device-flow authorization link / QR-code information. After you complete authorization, run the read/write commands.

To let Pi reply to Lark messages, configure the event agent:

```env
LARK_AGENT_IDENTITY='bot'
LARK_AGENT_EVENT_KEY='im.message.receive_v1'
LARK_AGENT_CHAT_TYPES='p2p,group'
LARK_AGENT_MESSAGE_TYPES='text,post'
LARK_AGENT_CHAT_WHITELIST=''
LARK_AGENT_USER_WHITELIST=''
LARK_AGENT_REPLY_PREFIX=''
LARK_AGENT_GROUP_MENTION_NAME=''
LARK_AGENT_GROUP_AUTO_REPLY='false'
```

Start:

```sh
wb agent --im lark --agent pi
# or
wb lark agent --agent pi
```

The Lark agent consumes `im.message.receive_v1` through `lark-cli event consume`. Private chats are replied to by default unless a chat or user allowlist is configured. Group chats require `LARK_AGENT_CHAT_WHITELIST` and one of these triggers: reply prefix, group mention name, or `LARK_AGENT_GROUP_AUTO_REPLY=true`.

Before using this path, enable the `im.message.receive_v1` event in the Lark developer console and make sure the app has the required IM scopes.

## Pi Passthrough Commands

Call Pi directly:

```sh
wb pi -- --help
wb pi -- --print "Analyze the current project structure"
```

`PI_AGENT_ARGS` controls the arguments used when Pi runs as the IM reply agent. Default:

```env
PI_AGENT_ARGS='--print --no-session'
```

This means each IM message is handled as a single-turn non-interactive reply. If you want to reuse a session, remove `--no-session`, but note that context and private data may be saved in the Pi session.

## FAQ

### No reply after QR-code login

Check:

- Whether the private chat sender alias is in `ALIAS_WHITELIST`.
- Whether the group name is in `ROOM_WHITELIST`.
- Whether the group chat really mentioned `BOT_NAME`.
- Whether `BOT_NAME` in `.env` has the form `@Your WeChat nickname`.
- Whether the current message is a text message.

### Pi replies slowly

Configure local Pi:

```env
PI_BIN='pi'
```

If this is left empty, the project starts Pi through `npx`. First runs and cold starts will be slower.

### Analyze only, without auto-reply

Use command-line analysis:

```sh
wb analyze --room "Group name" --stats-only
wb analyze --friend "Friend alias" --stats-only
```

Or call AI for deep analysis:

```sh
wb analyze --room "Group name" --serve pi
```

### Safety Boundary

- The project only processes data visible to the locally logged-in account.
- WeChat auto-reply is controlled by allowlists.
- OpenCLI remote execution is disabled by default.
- `/analyze` sends message samples to the current model or agent. Confirm where the model runs and how it is configured before processing private data.
