/**
 * CoCanvas E2E 测试（进程内脚本版）。
 *
 * 为什么不用 @playwright/test 的 runner：
 * 本开发环境（Windows + 本机安全层）禁止 Node 创建 piped-stdio 子进程，
 * playwright test runner 启动 worker 用的正是 fork（pipe+IPC），会静默卡死。
 * 进程内直接 chromium.launch() 不受影响（昨天的探针验证过全链路）。
 * 脚本形式在任意环境都能跑，功能与 runner 版等价。
 *
 * 前置：ws 服务 (:7001) 与 vite (:5173) 已启动
 *   cd apps/server && pnpm dev
 *   cd apps/web && pnpm dev
 * 运行：pnpm test:e2e
 */
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

const WEB_BASE = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:5173'
const WS_HEALTH = process.env.E2E_WS_HEALTH ?? 'http://127.0.0.1:7001/health'

/** 极简测试装置：顺序执行，收集成败 */
const tests = []
const test = (name, fn) => tests.push({ name, fn })

async function waitConnected(page) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const badge = await page.locator('.badge').innerText().catch(() => '')
    if (badge === '已连接') return
    await page.waitForTimeout(200)
  }
  throw new Error('等待 .badge.connected 超时')
}

async function openDoc(browser, docId) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${WEB_BASE}/#/doc/${docId}`)
  await waitConnected(page)
  return { context, page }
}

const docText = (page) => page.locator('[data-doc-text]')

// ---------------------------------------------------------------- 测试用例

test('两个标签页实时同步：A 输入 B 可见，反之亦然', async (browser) => {
  const docId = `e2e-sync-${Date.now().toString(36)}`
  const a = await openDoc(browser, docId)
  const b = await openDoc(browser, docId)
  try {
    // A → B
    await a.page.locator('.ProseMirror').click()
    await a.page.keyboard.type('实时协同')
    await expect.poll(() => docText(b.page).getAttribute('data-doc-text')).toBe('实时协同')

    // B → A
    await b.page.locator('.ProseMirror').click()
    await b.page.keyboard.type('，双向同步')
    await expect
      .poll(() => docText(a.page).getAttribute('data-doc-text'))
      .toBe('实时协同，双向同步')

    // 两端一致
    const textA = await docText(a.page).getAttribute('data-doc-text')
    const textB = await docText(b.page).getAttribute('data-doc-text')
    assert.equal(textA, '实时协同，双向同步')
    assert.equal(textB, '实时协同，双向同步')
  } finally {
    await a.context.close()
    await b.context.close()
  }
})

test('互相看到对方光标（awareness 中继）', async (browser) => {
  const docId = `e2e-cursor-${Date.now().toString(36)}`
  const a = await openDoc(browser, docId)
  const b = await openDoc(browser, docId)
  try {
    // B 输入形成选区 → A 应渲染 B 的光标标签
    await b.page.locator('.ProseMirror').click()
    await b.page.keyboard.type('光标测试')

    const label = a.page.locator('.collaboration-cursor__label')
    await expect.poll(() => label.count()).toBe(1)
    // 标签内容是 B 的身份名（sessionStorage 每标签页独立身份）
    const nameB = await b.page.evaluate(() => {
      const raw = sessionStorage.getItem('cocanvas.identity')
      return raw === null ? '' : JSON.parse(raw).name
    })
    assert.equal(await label.innerText(), nameB)
  } finally {
    await a.context.close()
    await b.context.close()
  }
})

test('标题通过 CRDT 同步（Y.Map meta）', async (browser) => {
  const docId = `e2e-title-${Date.now().toString(36)}`
  const a = await openDoc(browser, docId)
  const b = await openDoc(browser, docId)
  try {
    await a.page.locator('.title-input').fill('协同文档标题')
    await expect.poll(() => b.page.locator('.title-input').inputValue()).toBe('协同文档标题')
  } finally {
    await a.context.close()
    await b.context.close()
  }
})

test('中文输入法 composition：远端不见拼音中间态，提交后精确一致', async (browser) => {
  const docId = `e2e-ime-${Date.now().toString(36)}`
  const a = await openDoc(browser, docId)
  const b = await openDoc(browser, docId)
  try {
    const cdp = await a.context.newCDPSession(a.page)
    await a.page.locator('.ProseMirror').click()

    // 1) 模拟拼音输入过程
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
    // 本地应呈现中间态
    await expect.poll(() => docText(a.page).getAttribute('data-doc-text')).toBe('nihao')

    // 2) 关键回归：等一个同步窗口，远端不得出现拼音
    await a.page.waitForTimeout(600)
    assert.notEqual(await docText(b.page).getAttribute('data-doc-text'), 'nihao')
    assert.equal(await docText(b.page).getAttribute('data-doc-text'), '')

    // 3) 选词上屏
    await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 0, selectionEnd: 0 })
    await cdp.send('Input.insertText', { text: '你好' })
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })

    // 4) 两端都恰好是“你好”
    await expect.poll(() => docText(a.page).getAttribute('data-doc-text')).toBe('你好')
    await expect.poll(() => docText(b.page).getAttribute('data-doc-text')).toBe('你好')
  } finally {
    await a.context.close()
    await b.context.close()
  }
})

// ---------------------------------------------------------------- 运行器

async function main() {
  // 前置检查：服务必须已启动
  for (const [name, url] of [['ws 服务', WS_HEALTH], ['web 服务', WEB_BASE]]) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error(`✗ ${name}未启动（${url}）：${err.message}`)
      console.error('  请先运行：cd apps/server && pnpm dev；cd apps/web && pnpm dev')
      process.exit(1)
    }
  }

  const browser = await chromium.launch()
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn(browser)
      console.log(`✓ ${name}`)
    } catch (err) {
      failed += 1
      console.error(`✗ ${name}`)
      console.error(`  ${err.message.split('\n').slice(0, 6).join('\n  ')}`)
    }
  }
  await browser.close()

  console.log(`\n${tests.length - failed}/${tests.length} 通过`)
  process.exit(failed === 0 ? 0 : 1)
}

// expect.poll：脚本版轮询断言（playwright runner 的 expect.poll 等价物）
const expect = {
  poll(fn) {
    return {
      async toBe(expected) {
        const deadline = Date.now() + 10000
        let lastValue
        while (Date.now() < deadline) {
          lastValue = await fn()
          if (lastValue === expected) return
          await new Promise((r) => setTimeout(r, 150))
        }
        throw new Error(
          `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(lastValue)}（10s 超时）`,
        )
      },
    }
  },
}

await main()
