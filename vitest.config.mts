import { defineConfig } from 'vitest/config';
import path from 'node:path';

const projectRoot = import.meta.dirname;

export default defineConfig({
  test: {
    // ドメイン・サービス層のテストのみ。node:crypto / node:zlib を使うので node 環境。
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Firestore エミュレータ相手の契約テストは往復が入るため既定の5秒では足りない
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(projectRoot) },
  },
});
