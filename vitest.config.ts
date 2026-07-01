import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@chakra-dsl/core': resolve(__dirname, './packages/core/src/index.ts'),
      '@chakra-dsl/providers': resolve(__dirname, './packages/providers/src/index.ts'),
      '@chakra-dsl/node': resolve(__dirname, './packages/node/src/index.ts'),
    },
  },
});
