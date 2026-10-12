/** 服务端配置（Phase 0：仅 ws 端口；PG/Redis 在 Phase 1 引入） */
export interface ServerConfig {
  /** 监听主机，默认 127.0.0.1（容器化时由环境变量覆盖为 0.0.0.0） */
  host: string
  /** 监听端口，默认 7001（避开 paperscope 的 8000） */
  port: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.WS_HOST ?? '127.0.0.1',
    port: Number.parseInt(env.WS_PORT ?? '7001', 10) || 7001,
  }
}
