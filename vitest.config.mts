import { defineConfig } from 'vitest/config';
import path from 'node:path';

const projectRoot = import.meta.dirname;

export default defineConfig({
  test: {
    // ドメイン・サービス層のテストのみ。node:crypto / node:zlib を使うので node 環境。
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(projectRoot) },
  },
});
