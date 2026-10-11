# CoCanvas

基于 CRDT（Yjs）的多人实时协作文档编辑器。支持离线编辑与重连自动合并，
服务端可水平扩展（多实例 + Redis Streams 广播），update 增量落库 + 阈值快照压缩。

TypeScript · Node.js (WebSocket) · Yjs (CRDT) · Redis Streams · PostgreSQL · React + TipTap

## 状态

**Phase 0 未开始**（2026-10-11 立项）。开发路线图、验收标准、架构红线见
[`AGENTS.md`](./AGENTS.md)——那是本项目的唯一权威文档，接手开发必读。

## 设计主张

- **CRDT 而非 OT**：OT 依赖中心化变换函数与版本向量，离线分支与乱序到达处理复杂；
  CRDT 天然满足交换律/结合律。代价是历史体积增长 → 配套快照压缩。
- **双通道可靠性分级**：编辑内容不可丢失（落库 + Streams 确认 + 全量重同步），
  awareness（光标/选区）可丢可滞后，追求低延迟。
- **深度锁死在库不覆盖的层**：自写服务端（持久化/权限/广播/压缩），
  不用 y-websocket 示例 server 当生产代码。

## 本地开发（Phase 0 完成后更新本节）

```bash
# 前置：Docker Desktop 已手动启动；端口规划见 AGENTS.md 6.2
pnpm install
cd apps/server && pnpm dev    # ws 服务 :7001
cd apps/web && pnpm dev       # 前端 :5173
```

## 文档

- `AGENTS.md` — 架构、路线图、红线、环境坑（唯一权威入口）
- `docs/DEVLOG.md` — 开发日志（ADR 风格，每次开发必追加）
