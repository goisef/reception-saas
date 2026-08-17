import { describe, expect, it } from 'vitest';
import {
  issueToken,
  passwordMatches,
  verifyToken,
} from '@/lib/access/session';

/**
 * 共有URLの目隠しの検証。
 *
 * プロダクトの認証ではなく「URLが漏れても中身が見えない」ための一枚なので、
 * 見るべきは「鍵を知らない人がトークンを作れないこと」と
 * 「期限が切れること」の2点。
 */

const SECRET = 'test-session-secret';

describe('アクセストークン', () => {
  it('発行したトークンは同じ鍵で検証できる', async () => {
    const token = await issueToken(SECRET);
    expect(await verifyToken(SECRET, token)).toBe(true);
  });

  it('鍵が違えば通らない', async () => {
    const token = await issueToken(SECRET);
    expect(await verifyToken('another-secret', token)).toBe(false);
  });

  it('期限を書き換えても署名が合わないので通らない', async () => {
    // 有効期限はトークンに平文で入っているが、鍵を知らないと延ばせない
    const token = await issueToken(SECRET);
    const [, signature] = token.split('.');
    const forged = `${Math.floor(Date.now() / 1000) + 999999}.${signature}`;
    expect(await verifyToken(SECRET, forged)).toBe(false);
  });

  it('期限を過ぎたトークンは通らない', async () => {
    const issuedAt = Date.now() - 13 * 60 * 60 * 1000;
    const token = await issueToken(SECRET, issuedAt);
    expect(await verifyToken(SECRET, token)).toBe(false);
    // 発行直後なら通る（期限の判定だけで落ちていないことの確認）
    expect(await verifyToken(SECRET, token, issuedAt + 1000)).toBe(true);
  });

  it('壊れた値や未設定でも例外にならず false を返す', async () => {
    expect(await verifyToken(SECRET, undefined)).toBe(false);
    expect(await verifyToken(SECRET, '')).toBe(false);
    expect(await verifyToken(SECRET, 'garbage')).toBe(false);
    expect(await verifyToken(SECRET, 'no-signature.')).toBe(false);
    expect(await verifyToken(SECRET, '.only-signature')).toBe(false);
  });
});

describe('パスワード照合', () => {
  it('一致・不一致を判定する', async () => {
    expect(await passwordMatches('correct-horse', 'correct-horse')).toBe(true);
    expect(await passwordMatches('correct-horse', 'correct-hors')).toBe(false);
    expect(await passwordMatches('correct-horse', '')).toBe(false);
  });

  it('長さが違っても判定できる（長さで早期returnしていない）', async () => {
    expect(await passwordMatches('short', 'a-much-longer-password')).toBe(false);
  });
});
