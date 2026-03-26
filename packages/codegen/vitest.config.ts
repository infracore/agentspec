import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.contract.ts'],
    server: {
      deps: {
        // Neither @anthropic-ai/claude-agent-sdk nor openai have full "exports" fields.
        // Let Node handle module resolution directly.
        external: ['@anthropic-ai/claude-agent-sdk', 'openai'],
      },
    },
  },
})
