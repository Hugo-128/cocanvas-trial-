# CoCanvas

基于 CRDT（Yjs）的多人实时协作文档编辑器。支持离线编辑与重连自动合并，
服务端可水平扩展（多实例 + Redis Streams 广播），update 增量落库 + 阈值快照压缩。

TypeScript · Node.js (WebSocket) · Yjs (CRDT) · Redis Streams · PostgreSQL · React + TipTap

## 状态

**Phase 0 完成并验证**（2026-10-12）：monorepo + 自写 ws 服务端 + 自研客户端
provider + TipTap 编辑器 UI。typecheck 3/3、集成测试 6/6、E2E 4/4（含中文输入法
composition 回归）。已 git commit；续作清单见
[`docs/PROGRESS-2026-10-12.md`](./docs/PROGRESS-2026-10-12.md)。
开发路线图、验收标准、架构红线见 [`AGENTS.md`](./AGENTS.md)——那是本项目的唯一权威文档。

## 本地开发

```bash
# 前置：项目在 C 盘 NTFS（E 盘 exFAT 无法跑 pnpm）；Docker 按需手动启动
pnpm install --ignore-scripts   # 必须带 --ignore-scripts（本机 Node spawn 限制）

cd apps/server && pnpm dev      # ws 服务 :7001
cd apps/web && pnpm dev         # 前端 :5173
# 浏览器开两个标签页打开同一 URL，如 http://localhost:5173/#/doc/demo-1
```

测试：

```bash
pnpm typecheck                  # 三包类型检查
cd apps/web && pnpm test        # 集成测试（进程内起真实服务端，6 用例）
pnpm test:e2e                   # E2E（进程内 chromium，4 用例；需服务先起着）
```

本机环境坑（代理变量、spawn 限制、pnpm 状态恢复）见 `AGENTS.md` 第 6 节，
交接必读。

## 文档

- `AGENTS.md` — 架构、路线图、红线、环境坑（唯一权威入口）
- `docs/DEVLOG.md` — 开发日志（ADR 风格，每次开发必追加）
