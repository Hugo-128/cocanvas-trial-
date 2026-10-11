# CoCanvas 开发日志

> ADR 风格：只增不改历史条目。每次开发结束必须追加一节，写清做了什么、
> 关键决策与理由、实测数据、下一步。目标是：陌生助手（其他 AI 平台）读完
> `AGENTS.md` + 本文件的「当前状态」即可接手。

---

## 当前状态

**阶段**：Phase 0 未开始（脚手架 + 两标签页实时同步验证）。
**最近提交**：见 git log。
**代码状态**：零业务代码，仅交接文档（AGENTS.md / README.md / .gitignore）。

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
