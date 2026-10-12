# CoCanvas 开发日志

> ADR 风格：只增不改历史条目。每次开发结束必须追加一节，写清做了什么、
> 关键决策与理由、实测数据、下一步。目标是：陌生助手（其他 AI 平台）读完
> `AGENTS.md` + 本文件的「当前状态」即可接手。

---

## 当前状态

**阶段**：Phase 0 代码完成并验证（monorepo + 自写 ws 服务端 + 自研 provider + Web UI），
已 git commit；docker-compose / CI / .env.example 未做（见 `docs/PROGRESS-2026-10-12.md`）。
**项目位置已变更**：`C:/programing/workbuddy/cocanvas`（原 E: 盘为 exFAT，pnpm 无法建符号链接，详见 2026-10-12 条目）。
**最近提交**：见 git log（Phase 0 实现 + 本文档条目已提交）。
**验证状态**：typecheck 3/3 包通过；集成测试 6/6 通过；E2E 4/4 通过（含 IME composition 回归）。

---

## 2026-10-11 · 立项与交接文档

### 背景

用户在 WorkBuddy 另一会话中已确定：以 PaperScope（`E:/programing/workbuddy/paperscope`，
AI 学习伴侣）为主线，CoCanvas 作为第二项目独立开发。分工逻辑：两个项目领域互补
（AI 应用工程 ↔ 分布式系统/实时工程），合起来展示跨领域能力。

本项目的设计论证来自导师评审稿 `E:/programing/AI study/03_目标态描述与方向评估.md`
第 3 节，关键结论已内联到 `AGENTS.md`。用户工作方法：**用简历成品效果倒逼开发**——
先确认目标态有技术含量，再投入；每完成一个里程碑同步更新简历条目
（措辞库在 `paperscope/docs/RESUME.md` 第 2 节）。

### 决策记录

**CDR-001：采用 Yjs CRDT 而非 OT**
理由：OT 依赖中心化变换函数与版本向量，离线分支与乱序到达处理复杂；
CRDT 天然满足交换律/结合律，收敛逻辑简单。代价是历史体积随编辑增长
→ 必须配套快照压缩（Phase 4）。这个 trade-off 必须能讲清楚，
否则会被认为"随手选了个库"。

**CDR-002：服务端自写，不用 y-websocket 示例 server**
y-websocket 的 `bin/utils` 没有持久化、权限、多实例能力，是示例代码。
自写 server 是本项目区别于"教程复刻"的核心。协议实现参考 y-protocols 源码。

**CDR-003：双通道可靠性分级**
内容通道（Yjs update / sync 消息）：不可丢失、必须收敛，落库 + Redis Streams
确认 + 重连全量同步。状态通道（awareness 光标/选区）：可丢可滞后，追求低延迟，
不落库不重放。两类数据的一致性要求不同，拆通道是实战与教程的分界。

**CDR-004：跨实例广播用 Redis Streams 而非 Pub/Sub**
Streams 有持久化与 consumer group，支持回溯与确认；Pub/Sub 即发即弃，断线即丢。
多实例下 update 广播的可靠性要有保障。**代价：必须处理重复投递 → 应用侧幂等
（Phase 3 核心任务）**。

**CDR-005：建议 Phase 5 收手，Phase 6 视时间**
Phase 0–5（协同 + 离线 + 多实例 + 压缩 + 压测）已越过"教程复刻"门槛。
Phase 6 的 V6 延伸（E2EE、AI 作为 CRDT 客户端协同编辑）是真正前沿、公开实现少，
但必须 Phase 5 稳固后再动，且开工前先写设计段。

**CDR-006：pnpm monorepo，端口避开 PaperScope**
PaperScope 已占用 5432/6379/8000。CoCanvas 用 5433（PG）/ 6380（Redis）/
7001（ws）/ 5173（vite）。绝不为图省事改 paperscope 的 .env。

### 已建立的文件

- `AGENTS.md` —— 唯一权威入口：定位、选型（含被否决方案）、架构、Phase 0–6
  路线图（每阶段验收命令）、8 条红线、Windows 环境坑、简历锚点对照表
- `README.md` —— 人读简版
- `.gitignore` —— 含 `.env` 绝不入库
- `docs/DEVLOG.md` —— 本文件

### 下一步（Phase 0）

1. `pnpm` 就绪（corepack；不要 npm install -g）
2. monorepo 脚手架：apps/web（React+Vite+TS+TipTap）、apps/server（ws+y-protocols）、
   packages/protocol（共享消息类型）
3. server：sync/awareness 最小实现（内存房间，不落库）
4. web：TipTap + Collaboration + Awareness 光标
5. **验收**：两标签页实时同步 + 中文输入法 composition 回归测试 + 至少 1 个自动化测试

### 已知高危坑（开发前必读 AGENTS.md 6.4）

ProseMirror composition 事件与 Yjs 事务的交互：中文拼音输入过程中，
其他客户端可能看到中间态或选词后内容错乱。Phase 0 就要写回归测试。

---

## 2026-10-11 ~ 10-12 · Phase 0 实现（脚手架 + 双标签页实时同步 + IME 回归）

### 背景

按 AGENTS.md 第 4 节路线图完成 Phase 0：pnpm monorepo（apps/web、apps/server、
packages/protocol）、自写 ws 服务端、自研客户端 provider、TipTap 编辑器 UI、
自动化测试（集成 + E2E）。本文记录实现内容、关键决策、实测数据与环境发现。

### 实现内容

**packages/protocol（新增）**——前后端共享层：
- `constants.ts`：wire 协议选择器（PROTOCOL_SYNC=0 / PROTOCOL_AWARENESS=1，沿用
  y-websocket 约定保证生态兼容）、关闭码、DOC_ID_PATTERN、重连策略参数
- `provider.ts`：**CoCanvasProvider**——自研客户端同步层：WebSocket 连接管理
  （指数退避 + 抖动重连）、wire 帧组装、内容/状态双通道分流、出站内容按住
  （composition 保护，见 CDR-011）、断线期间编辑不丢（重连后 sync step1/step2
  双向对账合并）
- `awareness.ts`：`extractAwarenessClientIDs`——服务端据此跟踪每个连接上报的
  clientID，断连精准清光标
- 包入口导出 TS 源码（workspace 内直接消费，无构建步骤）

**apps/server（新增）**——自写 ws 服务端（红线 1：不用 y-websocket 示例 server）：
- `server.ts`：`createCoCanvasServer({host, port})` 工厂（port=0 供测试）、
  /room/<docId> 路由（正则 + DOC_ID_PATTERN 双重校验）、/health 端点、
  优雅停机（SIGINT/SIGTERM）
- `room.ts`：Room = 内存 Y.Doc + Awareness + 连接集合。sync step1/step2/update
  全协议处理；doc update 广播排除来源连接；awareness 广播排除来源连接；
  **断连立即 removeAwarenessStates 并广播**（不等 30s 超时）；空房间自动销毁
  （awareness.destroy + doc.destroy，防 setInterval 泄漏）
- `config.ts` / `index.ts`：环境配置 + CLI 入口

**apps/web（新增）**——React 19 + Vite 8 + TipTap 2.27.3：
- hash 路由（#/ 首页、#/doc/<id> 编辑器），免服务端 SPA fallback 配置
- 首页：新建/打开文档（随机 ID）、最近文档（localStorage）
- 编辑器页：标题输入框（**Y.Map('meta') 存进 CRDT，多端自动同步**）、
  连接状态徽标（已连接/连接中/已断开·重连中）、在线协作者彩色头像
- `sync/useProvider.ts`：provider 生命周期 hook（enabled 开关防无效重连循环）
- `editor/CollabEditor.tsx`：StarterKit（history:false）+ Collaboration +
  CollaborationCursor + CompositionHold；`data-doc-text` 属性作为 E2E 精确文本缝隙
- `editor/compositionHold.ts`：中文输入法保护扩展（见 CDR-011）
- 身份存 **sessionStorage**（每标签页独立协作者，双标签 demo 光标可区分）

**测试**：
- `apps/web/src/sync/provider.integration.test.ts`：6 个用例，进程内起真实服务端 +
  两个 provider 走真实 WebSocket：双向同步收敛、晚加入者拿全量、awareness 中继、
  断连即清光标、**离线编辑→重连自动合并（零丢字）**、非法路径 4001 拒绝
- `apps/web/tests/e2e.mjs`：4 个用例（进程内 chromium，见 CDR-012）：双标签实时
  同步、互相可见光标、标题 CRDT 同步、**IME composition 回归**

### 决策记录

**CDR-007：TipTap 2.27.3 + React 19，不用 TipTap 3**
调研发现 TipTap 3 已发布（3.31.4）但 `@tiptap/extension-collaboration-cursor`
只有 2.x（peer 要求 @tiptap/core ^2.7.0），多光标是 Phase 0 验收项。
选 2.27.3（AGENTS.md 原本就选 TipTap 2，判断仍正确）+ React 19（tiptap 2.27
peer 范围兼容）。等 cursor 扩展移植 v3 再升级。

**CDR-008：provider 放 packages/protocol 而非 apps/web**
理由：① 集成测试在 apps/web 跑（验收命令 `cd apps/web && pnpm test`），
需要 import server（workspace devDep）+ provider；② provider 是环境无关的
（WebSocket + Yjs，Node 22 全局 WebSocket 可直接用）；③ 未来 Phase 2 离线
provider 演进时前后端共享。包名叫 protocol 但含参考客户端实现，DEVLOG 备案。

**CDR-009：y-protocols 1.0.7 已移除 wire 层助手，外层帧格式由本项目自定义**
读源码确认：1.0.7 的 sync.js 只剩子类型常量（step1=0/step2=1/update=2）与
readSyncMessage 等编解码原语；awareness.js 只剩 Awareness 类与
encode/apply/removeAwarenessUpdate，**无 messageAwareness 常量、无
readAwarenessMessage**。wire 组装（selector + 子协议）落在
packages/protocol/constants.ts——这正是"库不覆盖的层"。

**CDR-010：标题等文档元数据放 Y.Map('meta') 进 CRDT**
零后端成本、自动同步、演示价值（改名即同步）。代价：元数据与内容共用一个
doc；Phase 1 建 docs 表+权限时再评估是否外迁，届时注意迁移。

**CDR-011：中文输入法 composition 修复——provider 出站按住 + 批量合并**
实测复现了 AGENTS.md 6.4 的坑：y-prosemirror 1.3.7 **无任何 composition 保护**
（全源码无 compos 字样），composition 期间 PM 把拼音中间态当普通交易写进
CRDT 并广播，远端看到 "nihao" 闪烁。修复（`provider.setContentHold()` +
`CompositionHold` 扩展）：compositionstart/update 时按住出站 doc update，
compositionend 时释放，积压 update 用 `Y.mergeUpdates` 合并为**一条**发出；
远端对单条 update 原子应用，中间态净效果抵消，只渲染最终提交态。
已知取舍：本地 CRDT 历史仍有中间 op（Phase 4 快照压缩兜底）；彻底零污染需
patch y-prosemirror，不做。安全阀：composition 事件后 5s 无新事件自动释放，
防 compositionend 丢失导致无限期按住。

**CDR-012：E2E 用进程内脚本而非 @playwright/test runner**
本环境 Node 无法创建 piped-stdio 子进程（见环境发现），playwright test
runner 启 worker 用 fork（pipe+IPC）会静默卡死；进程内 chromium.launch()
正常（昨天探针验证）。故 E2E 写成 `tests/e2e.mjs`（chromium + node:assert +
极简轮询断言），功能等价且任意环境可跑。@playwright/test 仍作为库依赖
（chromium 导出）。若换到无此限制的环境，可改回 runner 版。

**CDR-013：身份存 sessionStorage（每标签页独立）**
无账号体系下，localStorage 会让同浏览器两个标签页共用同一身份，光标名字/颜色
完全相同，demo 不可读。sessionStorage：刷新不变、新标签页新身份、跨设备天然不同。

### 实测数据（2026-10-12，本机）

- `pnpm typecheck`：3/3 包通过（protocol / server / web）
- `pnpm test`（apps/web）：6/6 通过，耗时 ~1.2s
- `pnpm test:e2e`：4/4 通过（含 IME composition 回归：远端 600ms 窗口内
  零中间态，提交后两端恰好 "你好"）
- 服务启动：tsx watch（ws :7001）正常；vite dev（:5173）ready ~1s
- 浏览器实测（E2E 覆盖）：两标签页输入互现、光标标签互见、标题同步

### 环境发现（交接必读，吃过大亏）

1. **E: 盘是 exFAT**：不支持 NTFS 符号链接/联接点/硬链接，pnpm 的 virtual store
   与 workspace 链接全部失败（`os error 1` / 函数不正确）。**项目已迁至
   `C:/programing/workbuddy/cocanvas`**（NTFS）。paperscope 是 Python 项目不受
   影响，仍在 E:。AGENTS.md 的位置描述已同步更新。
2. **本机 Node 进程无法创建 piped-stdio 子进程**（spawn 返回 EBUSY；inherit/ignore
   stdio 正常）。影响面：esbuild postinstall（用 `--ignore-scripts` 跳过，二进制
   本身可用）、playwright test runner 的 worker（见 CDR-012）。
   Python/bash 的 spawn 正常。用户自有终端大概率正常（疑似会话级限制）。
3. **环境变量 HTTP_PROXY/HTTPS_PROXY=127.0.0.1:2155**：PowerShell/Node 的 HTTP
   客户端请求 localhost 会走进代理挂起。curl 加 `--noproxy '*'`；跑 E2E 前清掉
   代理变量（`HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= NO_PROXY='*'`）。
4. **本环境 Bash 工具间歇性路径解析失败**（同一命令内首次文件操作随机 ENOENT，
   重试即可）。规避：命令包重试循环；`/tmp/cdproj.sh` 辅助函数（已不必需，
   新会话直接在命令内重试 cd）。
5. **pnpm 12 状态陷阱**：`rm -rf node_modules` 后 `pnpm install` 可能因
   store 里的 projects 注册表/`.pnpm-workspace-state-v1.json` 误判"已安装"而
   跳过链接；若 install 在异常中断后跑，可能把 pnpm-lock.yaml 覆写成 114 字节
   空壳（importers 为空）导致"Already up to date"但不装任何东西。
   **恢复手法：`rm -rf node_modules apps/*/node_modules packages/*/node_modules
   pnpm-lock.yaml && pnpm install --ignore-scripts`**（store 热，约 1-2s）。
6. **ws 默认绑 127.0.0.1**：浏览器连接请用 `ws://127.0.0.1:7001` 而非
   `localhost`（后者可能解析到 ::1 连不上）。

### 已知问题 / 下一步

- ~~**Phase 0 代码尚未 git commit**~~ → **已于 2026-10-12 提交**（git log 首条）
- deploy/docker-compose.yml、.env.example、.github/workflows/ci.yml 未创建
- README.md 的本地开发章节待更新；AGENTS.md §0 状态已更新
- Phase 1（持久化）预览：PG 5433 / Redis 6380；docs/updates/doc_members 三表；
  落库失败重试队列设计见 AGENTS.md Phase 1
- 详见 `docs/PROGRESS-2026-10-12.md` 的待办清单
