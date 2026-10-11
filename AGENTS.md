# CoCanvas — 交接必读（给接手的 AI 助手）

> 本文件是 CoCanvas 项目的唯一权威入口。**接手前必须完整读完本文件**，
> 再看 `docs/DEVLOG.md` 的「当前状态」一节。两份文档以本文件为最高规格。
>
> 写给陌生助手：你没有这个项目的任何对话历史。本文件刻意写得自包含——
> 项目是什么、为什么这样做、做到哪了、下一步做什么、什么不能做，全在这里。
> 不要凭 Yjs/WebSocket 的通用经验自行发挥，本项目的关键决策都有理由，改动前先问用户。

---

## 0. 三十秒上手

- **项目**：CoCanvas —— 基于 CRDT 的多人实时协作文档编辑器（TypeScript 全栈）
- **位置**：`E:/programing/workbuddy/cocanvas`
- **当前状态**：**Phase 0 未开始，零业务代码**（2026-10-11 建立）
- **下一步**：Phase 0 —— pnpm monorepo 脚手架 + 两标签页实时同步的最小验证（见第 4 节）
- **启动命令**：见第 6 节（环境注意事项，Windows 上有坑）
- **用户偏好**：逐阶段推进，每阶段交付**可验证的测试命令**，不要一次性铺开全部代码；
  前端先用朴素实现，不追求美观；UI 细节后期迭代

---

## 1. 产品定位

### 1.1 一句话

多个用户（可能离线、可能乱序、可能分布在不同服务器实例上）在同一个文档上并发编辑，
保证最终所有人看到一致内容，且不丢任何输入。

### 1.2 为什么做这个项目（用户动机，很重要）

用户的简历策略是**用成品效果倒逼开发**：先把目标态想清楚，确认有技术含量、
能过简历初筛，再投入。本项目已通过导师评审流程的自我论证
（论证稿在 `E:/programing/AI study/03_目标态描述与方向评估.md` 第 3 节，可读可不读，
关键结论已内联到本文件）。

用户同时在做另一个项目 PaperScope（`E:/programing/workbuddy/paperscope`，AI 学习伴侣）。
两个项目分工：**PaperScope 偏 AI 应用与数据建模，CoCanvas 偏分布式系统与实时工程**，
合起来展示跨领域能力。CoCanvas 是独立项目，不是 PaperScope 的模块。

### 1.3 最大的风险，也是本项目的生死线

Yjs 这类 CRDT 库高度成熟。**如果只是"用 Yjs 官方示例搭一个房间"，
面试官第一个问题就是"Yjs 帮你做了什么，你做了什么？"——答不上来，项目从加分项变减分项。**

所以本项目的所有设计决策都围绕一条原则：

> **主动锁死在"库不覆盖的层"做深度。**

| 浅做（扣分，禁止） | 深做（加分，本项目要做） |
|---|---|
| 接 Yjs 官方示例 + 一个房间 | 自写服务端：持久化、权限、Redis 广播、快照压缩 |
| 单实例 WebSocket | 多实例 + Redis Streams 广播 + 应用侧幂等 |
| 只做在线协同 | 离线编辑 + 重连合并 + 冲突可复现测试 |
| 复制粘贴权限中间件 | 权限与内容解耦（为 E2EE 铺路） |
| 无压测 | k6 压测，报 P95 与连接拐点（实测值，不吹） |

### 1.4 演进路径（天花板）

| 版本 | 形态 | 对应 Phase |
|---|---|---|
| V1 | 单文档多人实时编辑，字符级并发，多人光标 | Phase 1 |
| V2 | 离线编辑 → 重连自动合并，弱网不丢字 | Phase 2 |
| V3 | 服务端水平扩展，多实例同一房间 | Phase 3 |
| V4 | 历史压缩 + 快照，冷启动 O(全量) → O(快照+增量) | Phase 4 |
| V5 | 压测报告：P95 同步延迟与并发拐点 | Phase 5 |
| V6 | 延伸：RBAC/版本回放、协作画布、E2EE、AI 作为协作成员 | Phase 6（视时间） |

**建议做到 Phase 5 收手**（即 V3+压缩+压测）。这两层已越过"教程复刻"门槛。
Phase 6 是差异化延伸，其中"AI 也作为一个 CRDT 客户端参与协同编辑"目前公开实现不多，
是真正的技术前沿，但也是最容易烂尾的，**必须 Phase 5 稳固后再动**。

---

## 2. 技术选型（含被否决的替代方案）

改任何一项前，先读懂"理由"列，并问用户。

| 层 | 选择 | 主要备选 | 理由 |
|---|---|---|---|
| CRDT | **Yjs** | Automerge | 生态最全（ProseMirror/IndexedDB/awareness 绑定齐全）、二进制紧凑、TS 原生。Automerge 的 Rust 内核性能更好但生态绑定少 |
| 并发模型 | **CRDT** | OT | 本项目的方法论主张：OT 依赖中心化变换函数与版本向量，离线分支与乱序到达处理复杂；CRDT 天然满足交换律/结合律，收敛逻辑简单。**代价是历史体积随编辑增长** → 必须配套快照压缩（Phase 4）。这个 trade-off 必须能讲清楚 |
| 编辑器 | **TipTap 2**（ProseMirror） | Quill / Lexical / slate | y-prosemirror 绑定最成熟；ProseMirror 的 schema/transaction 模型可控。**已知坑：中文输入法 composition 与 CRDT 的交互必须实测**（见第 6 节） |
| 前端 | **React 18 + Vite + TypeScript** | Next.js | 纯客户端应用，无需 SSR；Vite 启动快。UI 先用最朴素写法，不上 Tailwind/shadcn（用户明确要求朴素优先） |
| 服务端 | **Node + ws + y-protocols** | y-websocket 自带 server | y-websocket 的 `bin/utils` 是**示例代码**，没有持久化、权限、多实例。必须自写 server，参考其协议实现但自己组织代码 |
| 跨实例广播 | **Redis Streams** | Pub/Sub | Streams 有持久化与 consumer group，支持回溯与确认；Pub/Sub 即发即弃，断线即丢。多实例场景下 awareness 消息可丢，但 update 广播的可靠性要有保障 |
| 持久化 | **PostgreSQL** | Redis 全量 / MongoDB | updates 二进制追加 + snapshots 表，结构简单可靠。PG 与 PaperScope 共用一套 Docker 基建经验 |
| 离线队列 | **y-indexeddb** | 手写 localStorage | IndexedDB 容量大、异步、结构化；官方绑定，少造轮子 |
| 包管理 | **pnpm monorepo** | npm workspaces | 硬链接省空间、严格依赖隔离。结构：`apps/web` `apps/server` `packages/protocol`（前后端共享的消息类型与协议常量） |

---

## 3. 架构

### 3.1 数据流

```
浏览器 A                    服务端（可多实例）                 浏览器 B
┌──────────┐   WebSocket    ┌─────────────────────┐   WebSocket  ┌──────────┐
│ TipTap   │◄── update ────►│  RoomManager        │◄── update ──►│ TipTap   │
│  + Yjs   │   awareness   │   ├─ sync protocol  │   awareness  │  + Yjs   │
│          │                │   ├─ 持久化 worker  │              │          │
│ IndexedDB│                │   └─ Redis 广播     │              │ IndexedDB│
└──────────┘                └─────────┬───────────┘              └──────────┘
      │                               │                              │
      └── 离线时本地 CRDT 合并 ────────┘                              │
                                      │                              │
                              ┌───────▼────────┐              ┌───────▼────────┐
                              │ Redis Streams  │◄────────────►│ 其他实例        │
                              │ (跨实例广播)    │              └────────────────┘
                              └───────┬────────┘
                                      │ 异步落库
                              ┌───────▼────────┐
                              │ PostgreSQL     │
                              │ docs/updates/  │
                              │ snapshots      │
                              └────────────────┘
```

### 3.2 两条通道，两种可靠性（本项目核心设计之一）

| 通道 | 内容 | 可靠性要求 | 传输方式 |
|---|---|---|---|
| **内容通道** | Yjs update 二进制、sync 协议消息 | **不可丢失、必须收敛**：落库 + Redis Streams 确认 + 客户端重连后全量同步 | WebSocket + Redis Streams |
| **状态通道** | awareness（光标、选区、在线状态） | **可丢、可滞后**：追求低延迟，不落库不重放 | WebSocket + Redis 即发即弃 |

把两者拆成不同通道、不同可靠性等级，是实战与教程的分界。
**不要把 awareness 消息写进 updates 表，也不要在内容通道上做去重节流。**

### 3.3 目录结构（Phase 0 建立）

```
cocanvas/
├── AGENTS.md            ← 本文件（唯一权威入口）
├── README.md            ← 简短的人读版
├── docs/
│   ├── DEVLOG.md        ← 开发日志（ADR 风格，每次必追加）
│   └── PROTOCOL.md      ← 消息协议细节（Phase 1 建）
├── apps/
│   ├── web/             ← React + Vite + TipTap + Yjs
│   └── server/          ← Node + ws + y-protocols + Redis + PG
├── packages/
│   └── protocol/        ← 前后端共享：消息类型、房间协议常量、错误码
├── deploy/
│   └── docker-compose.yml  ← 本地全栈（PG + Redis + server + web）
└── .github/workflows/ci.yml
```

---

## 4. 开发路线图（每阶段必须交付可验证命令）

**通用规则**：每个 Phase 结束 = 代码可跑 + 测试命令可复现 + `docs/DEVLOG.md` 追加条目
（含：做了什么、关键决策与理由、实测数据、下一步）。用户要把本项目交接给其他 AI 平台，
日志必须能被陌生助手直接读懂。

### Phase 0 — 脚手架 + 架构验证（当前阶段）

**目标**：monorepo 跑起来，两个浏览器标签页实时同步同一文档。

任务：
1. pnpm monorepo 初始化（apps/web, apps/server, packages/protocol）
2. server：ws + y-protocols 的 sync/awareness 最小实现（内存房间，不落库）
3. web：TipTap 编辑器 + Collaboration 扩展 + Awareness 光标
4. docker-compose（PG + Redis 先不接，Phase 1 接）

**验收标准**（缺一不可）：
```
cd apps/server && pnpm dev        # 服务起来
cd apps/web && pnpm dev           # 前端起来
# 浏览器开两个标签页打开同一文档 URL
# 标签页 A 输入文字 → 标签页 B 50ms 内出现；互相看到对方光标
# cd apps/web && pnpm test        # 至少 1 个两客户端同步的自动化测试
```
**注意**：中文输入法 composition 必须实测（见 6.4）。两个标签页用同一浏览器即可，
awareness 会按 clientID 区分。

### Phase 1 — V1：单文档协同 + 持久化

- PostgreSQL：`docs` / `updates`（二进制追加）/ `doc_members` 三张表起步
- server：连接时加载 updates 重放 → 新 update 异步落库（**落库失败要能恢复**）
- 断开重连：sync step1/step2 协议做差异同步
- 验收：杀掉 server 重启 → 刷新页面 → 内容与重启前一致；两人同时编辑不冲突

### Phase 2 — V2：离线编辑 + 重连合并

- y-indexeddb 本地持久化 + 断线检测 + 指数退避重连
- 验收：**断网 3 分钟后两端各自编辑 → 恢复网络 → 零丢字且收敛一致**；
  写一个可复现的自动化测试（两个 Y.Doc 实例模拟离线分叉再合并，断言最终状态相等）

### Phase 3 — V3：多实例 + Redis 广播

- Redis Streams：server 收到 update → XADD 广播 → 各实例 XREAD 后推给本地房间
- **幂等设计**：Redis 可能重复投递，落库与广播必须去重（update 的 clock/stateVector 判重）
- 验收：`docker compose up --scale server=2`，两个客户端连到不同实例
  （用不同端口或 nginx 分流）→ 互相同步正常；人为重启一个实例 → 不丢消息

### Phase 4 — V4：快照压缩

- updates 累计超过阈值（如 500 条或 5MB）→ 生成 snapshot（`Y.encodeStateAsUpdate`）
  → 新文档加载改为 snapshot + 后续增量
- 冷启动耗时前后对比，**实测数据记入 DEVLOG**
- 验收：灌入 10,000 次编辑 → 打开耗时从 XX ms 降至 XX ms（实测值）

### Phase 5 — V5：压测报告

- k6（WebSocket 支持）或自写脚本：N 个模拟客户端并发编辑
- 报告：P95 同步延迟、连接数拐点（多少连接时延迟陡增）、CPU/内存曲线
- 产出 `docs/BENCHMARK.md`，**只报实测值**
- 验收：报告含测试方法、环境配置、原始数据

### Phase 6 — V6：延伸（Phase 5 稳固后再评估）

按优先级：RBAC + 版本回放 → 协作画布（同一 CRDT 底座上 Y.Map/Y.Array）→ E2EE → AI 协作者。
**每一项开工前先在 DEVLOG 写设计段（为什么做、做什么、验收什么），再写代码。**

---

## 5. 架构红线（违反任何一条先问用户）

1. **不用 y-websocket 的示例 server 当生产代码**。它的 `bin/utils` 没有持久化、权限、多实例能力。可以参考协议实现，但代码要自己组织。
2. **内容通道与 awareness 通道严格分离**，可靠性等级不同（见 3.2）。不在内容通道节流，不在状态通道落库。
3. **编辑内容永不丢失**。任何"为了性能丢消息"的优化都不允许出现在内容通道上。
4. **幂等是服务端义务**。Redis 重复投递、客户端重连重发，都不能导致重复落库或状态错乱。
5. **中文输入法必须实测**。composition 事件与 CRDT 的交互是已知翻车点（见 6.4），每次改动编辑器相关代码后回归。
6. **不编数字**。简历和报告里所有性能/准确率数字必须来自实测，样本量如实标注。编数字比不写更糟。
7. **朴素优先**。UI 不上组件库/ CSS 框架，先把功能链路跑通。美观是 Phase 5 之后的事。
8. **每阶段交付可验证命令**。不允许"应该可以了"这种交付。

---

## 6. 环境注意事项（Windows 实测坑，先读再动手）

### 6.1 Node 与包管理

- 本机 managed Node：`C:/Users/zzx/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`（v22 LTS，够用）
- shell 是 Git Bash；路径用正斜杠
- pnpm 若未安装：`corepack enable` 后 `corepack prepare pnpm@latest --activate`（**不要 npm install -g**）
- monorepo 内 `pnpm install` 在项目本地 node_modules，正常操作

### 6.2 Docker 与端口

- Docker Desktop 需**手动启动**，daemon 不随开机启动。跑 compose 前先 `docker ps` 确认
- **PaperScope 已占用**：5432（PG）、6379（Redis）、8000（API）
- CoCanvas 用：5433（PG）、6380（Redis）、7001（ws server）、5173（vite dev）
- 若复用 PaperScope 的 PG/Redis 容器，必须在 `.env` 里显式换端口映射，**别默默改 paperscope 的 .env**

### 6.3 git

- 本机 git 需要 `safe.directory` 例外（Windows 文件系统所有权问题，不加会报 dubious ownership）：
  ```
  git config --global --add safe.directory "E:/programing/workbuddy/cocanvas"
  ```
- git identity 需用户配置真实姓名/邮箱（paperscope 那边目前是占位值）

### 6.4 中文输入法 + CRDT（已知高危坑）

ProseMirror 的 composition 事件与 Yjs 事务交互有历史问题：
- 现象：中文拼音输入过程中，其他客户端看到中间态（如拼音字母），或选词后内容错乱
- TipTap 2 + y-prosemirror 较新版本已大部分修复，但**必须写回归测试**：
  模拟 `compositionstart` → 输入拼音 → `compositionend` → 断言远端最终只收到提交的中文
- Phase 0 就要测，别等用户反馈

### 6.5 调试心法

- Yjs 的 update 是二进制，调试时用 `Y.encodeStateAsUpdate` / `Y.applyUpdate` 在 Node 里复现，
  比开两个浏览器快得多。**冲突类 bug 的第一现场应该是 Node 脚本，不是浏览器**
- `y-protocols` 的 sync 消息有固定格式，自己写 server 时对着协议源码读一遍

---

## 7. 简历锚点（倒逼开发：每条 bullet 对应一个 Phase）

用户的工作方法：**先确认目标态值得做，再开发；每完成一个里程碑同步更新简历条目**。
以下是本项目目标态对应的简历 bullet（措辞库在 paperscope 的 `docs/RESUME.md` 第 2 节）。
数字全部留空，**必须实测后填**：

| 简历 bullet（摘要） | 对应 Phase | 需要实测的数字 |
|---|---|---|
| 采用 Yjs CRDT 而非 OT，讲清代价与配套压缩 | Phase 0/4 论证 + 实现 | 快照压缩前后冷启动耗时 |
| update 二进制落库 + 阈值快照，冷启动 O(全量)→O(快照+增量) | Phase 1/4 | 10,000 次编辑下打开耗时 XX ms → XX ms |
| WebSocket 网关与业务解耦，Redis Streams 跨实例广播 | Phase 3 | 多实例同房间消息不丢不重（测试报告） |
| 离线 IndexedDB 队列 + 指数退避，弱网零丢字 | Phase 2 | 断网 N 分钟零丢字（测试用例数） |
| awareness 30fps 节流只广播 delta；双通道可靠性分级 | Phase 1/2 | 光标广播流量降幅 |
| k6 压测 P95 同步延迟与连接拐点 | Phase 5 | P95 ms、拐点连接数 |

**给接手助手的提醒**：用户可能会在开发过程中问"这能写进简历吗"——
对照本表回答，没有对应 Phase 支撑的 fancy 功能不要主动加。

---

## 8. 参考资料

- 选型论证稿（导师评审版）：`E:/programing/AI study/03_目标态描述与方向评估.md` 第 3 节
- 简历措辞库：`E:/programing/workbuddy/paperscope/docs/RESUME.md` 第 2 节
- Yjs 协议源码：`node_modules/y-protocols/src/sync.js`（自写 server 的必读文件）
- 开发日志：`docs/DEVLOG.md`（每次开发结束必须追加）
