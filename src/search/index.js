import axios from 'axios'
import dotenv from 'dotenv'

const env = dotenv.config().parsed || {}

const BING_API_KEY = env.BING_API_KEY || ''

const SEARCH_TIMEOUT = 10000

/**
 * 判断用户提问是否真正需要联网搜索。
 * 三类触发：① 明确要求搜索  ② 时间敏感词  ③ 评价一个可能有新动态的事物
 */
export function isSearchQuery(text) {
  const explicitSearch = ['帮我搜', '搜索一下', '查一下', '查一查', '帮我查', '搜一下']
  if (explicitSearch.some((kw) => text.includes(kw))) return true

  const timeSensitive = [
    '最新', '最近', '新闻', '今天', '现在', '当前', '刚发布',
    '这个月', '今年', '本周', '上周', '昨天', '刚刚',
    '出了什么', '更新了什么', '新出了', '上线了',
    '有什么新', '热点', '热门事件', '发生了什么',
  ]
  if (timeSensitive.some((kw) => text.includes(kw))) return true

  // 评价/看法类问题——用户可能在问有最新动态的事物，搜一下更准确
  const evaluation = ['如何评价', '怎么评价', '评价一下', '如何看待', '你怎么看']
  return evaluation.some((kw) => text.includes(kw))
}

/**
 * 清理用户提问为搜索关键词。
 * 不做过度拆分——只去掉命令前缀和多余的代词/虚词，保留自然语句结构，
 * 这样 Bing 才能正确理解搜索意图。
 * "你如何看待原神的最新PV" → "原神 最新PV"
 */
function cleanSearchQuery(text) {
  return text
    // 去掉搜索命令前缀
    .replace(/帮我搜索一下|帮我搜一下|帮我搜|搜索一下|搜一下|帮我查一下|查一下|查一查/gi, '')
    // 去掉提问句式壳子，保留内容主干
    .replace(/你如何看待|你怎么看|如何看待|怎么评价|如何评价|评价一下|你觉得|你认为|说说看/gi, '')
    .replace(/关于|有关|对于|针对|根据|有什么|是什么|怎么样|有没有/gi, '')
    .replace(/最新|最近|新闻|今天|现在|当前|刚上线|新出的|新出了/gi, '')
    .replace(/请|帮我|可以|能不能|能否/gi, '')
    // 去掉标点，留空格
    .replace(/[？？!！,，.。、：:；;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Bing Web Search API（Azure 付费）
 */
async function searchBingApi(query, count = 5) {
  const response = await axios.get('https://api.bing.microsoft.com/v7.0/search', {
    headers: { 'Ocp-Apim-Subscription-Key': BING_API_KEY },
    params: { q: query, count, mkt: 'zh-CN', textFormat: 'Raw' },
    timeout: SEARCH_TIMEOUT,
  })

  return (response.data?.webPages?.value || []).map((r) => ({
    title: r.name,
    snippet: r.snippet,
    url: r.url,
  }))
}

/**
 * Bing 网页抓取（免费，国内可用）
 */
async function searchBingScrape(query) {
  const response = await axios.get('https://cn.bing.com/search', {
    params: { q: query, count: 8 },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    timeout: SEARCH_TIMEOUT,
  })

  const html = response.data
  const results = []

  const blockPattern = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi
  const blocks = html.match(blockPattern) || []

  for (const block of blocks.slice(0, 8)) {
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    const url = titleMatch[1].replace(/&amp;/g, '&')
    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim()

    let snippet = ''
    const snippetMatch =
      block.match(/<p[^>]*class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<div[^>]*class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim()
      snippet = snippet.replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*[—–-]\s*/, '')
    }

    if (title && title.length > 2) {
      results.push({ title, snippet: snippet || title, url })
    }
  }

  if (results.length <= 1) {
    const altTitlePattern = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let m
    while ((m = altTitlePattern.exec(html)) !== null && results.length < 8) {
      const url = m[1].replace(/&amp;/g, '&')
      const title = m[2].replace(/<[^>]+>/g, '').trim()
      if (title.length > 2 && !results.some((r) => r.url === url)) {
        results.push({ title, snippet: title, url })
      }
    }
  }

  return results.filter((r) => !r.url.includes('/translator') && !r.url.includes('/images/'))
}

/**
 * 执行搜索
 */
export async function searchWeb(query) {
  const searchQuery = cleanSearchQuery(query)
  // 兜底：如果清理后内容太短，直接用原始问题
  const finalQuery = searchQuery.length > 2 ? searchQuery : query

  console.log('🔍 搜索:', finalQuery)

  if (BING_API_KEY) {
    try {
      const results = await searchBingApi(finalQuery)
      if (results.length > 0) {
        console.log(`🔍 Bing API 返回 ${results.length} 条结果`)
        return { results, source: 'Bing' }
      }
    } catch (e) {
      console.warn('⚠️ Bing API 失败，回退网页抓取:', e.message)
    }
  }

  try {
    const results = await searchBingScrape(finalQuery)
    console.log(`🔍 Bing 网页抓取返回 ${results.length} 条结果`)
    return { results, source: 'Bing' }
  } catch (e) {
    console.warn('⚠️ Bing 网页抓取失败:', e.message)
    return { results: [], source: 'none' }
  }
}

/**
 * 将搜索结果格式化为 prompt 文本。
 * 允许 AI 结合自身知识，搜索结果只是参考资料而非唯一答案来源。
 */
export function formatSearchResults(searchResult) {
  if (!searchResult.results || searchResult.results.length === 0) {
    return ''
  }

  const lines = searchResult.results.map((r, i) => {
    const prefix = `${i + 1}.`
    const line = `${prefix} ${r.title}\n   ${r.snippet}`
    return r.url ? `${line}\n   来源: ${r.url}` : line
  })

  return [
    `以下是通过 ${searchResult.source} 搜索到的近期信息，可作为参考：`,
    ...lines,
    '请结合上述搜索结果和你的知识库来回答用户问题。如果搜索结果不完整或有误，可以用你自己的知识补充或纠正。',
  ].join('\n')
}
