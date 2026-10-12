/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  test: {
    // provider 集成测试跑在 Node 环境（不需要 DOM）
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
