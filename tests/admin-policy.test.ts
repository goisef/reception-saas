import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLES_BY_RANK,
  assignableRoles,
  canAssignRole,
  canManageUsers,
  canModifyUser,
  roleNeedsStores,
  validatePassword,
} from '@/lib/admin/policy';
import { isRevokedByPasswordChange } from '@/lib/admin/session';
import type { Role } from '@/lib/domain/types';

describe('利用者を管理できる人', () => {
  it('SuperAdmin と TenantAdmin だけ', () => {
    const allowed = ROLES_BY_RANK.filter(canManageUsers);
    expect(allowed.sort()).toEqual(['SuperAdmin', 'TenantAdmin']);
  });
});

describe('付与できるロール', () => {
  it('SuperAdmin はどのロールからも付与できない', () => {
    // プラットフォーム運営の権限を、テナントの画面から作れてはならない
    for (const actor of ROLES_BY_RANK) {
      expect(canAssignRole(actor, 'SuperAdmin')).toBe(false);
    }
  });

  it('自分より強いロールは付与できない', () => {
    expect(assignableRoles('TenantAdmin')).toContain('TenantAdmin');
    expect(assignableRoles('TenantAdmin')).toContain('Viewer');
    expect(assignableRoles('TenantAdmin')).not.toContain('SuperAdmin');
  });

  it('管理者でないロールは何も付与できない', () => {
    for (const actor of ['AreaManager', 'StoreManager', 'Staff', 'ReceptionOnly', 'Viewer'] as Role[]) {
      expect(assignableRoles(actor)).toEqual([]);
    }
  });

  it('SuperAdmin に触れるのは SuperAdmin だけ', () => {
    expect(canModifyUser('TenantAdmin', 'SuperAdmin')).toBe(false);
    expect(canModifyUser('SuperAdmin', 'SuperAdmin')).toBe(true);
    expect(canModifyUser('TenantAdmin', 'TenantAdmin')).toBe(true);
    expect(canModifyUser('TenantAdmin', 'Viewer')).toBe(true);
    expect(canModifyUser('StoreManager', 'Viewer')).toBe(false);
  });
});

describe('店舗の指定が必須のロール', () => {
  it('店舗を持つ現場ロールは必須、全体ロールは任意', () => {
    // 店舗の範囲が空だと「全店舗」になる。現場のロールで空を許さない
    expect(roleNeedsStores('StoreManager')).toBe(true);
    expect(roleNeedsStores('AreaManager')).toBe(true);
    expect(roleNeedsStores('Staff')).toBe(true);
    expect(roleNeedsStores('TenantAdmin')).toBe(false);
    expect(roleNeedsStores('Viewer')).toBe(false);
  });
});

describe('パスワードの検証', () => {
  it('十分に長ければ通す', () => {
    expect(validatePassword('correct horse battery staple')).toBeNull();
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1) + 'b')).toBeNull();
  });

  it('短すぎるものは弾く', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/文字以上/);
    expect(validatePassword('')).toMatch(/文字以上/);
  });

  it('長すぎるものは弾く', () => {
    // PBKDF2 は長い入力ほど重い。巨大な入力でサーバーを遅くされない
    expect(validatePassword('a1'.repeat(PASSWORD_MAX_LENGTH))).toMatch(/文字以内/);
    expect(validatePassword('ab'.repeat(PASSWORD_MAX_LENGTH / 2))).toBeNull();
  });

  it('同じ文字だけは弾く', () => {
    expect(validatePassword('z'.repeat(20))).toMatch(/同じ文字/);
  });

  it('よく使われるものは大文字小文字を変えても弾く', () => {
    expect(validatePassword('Password123')).toMatch(/よく使われる/);
    expect(validatePassword('RECEPTION-DEV')).toMatch(/よく使われる/);
  });

  it('メールアドレスと同じものは弾く', () => {
    const email = 'someone.long@example.com';
    expect(validatePassword(email, { email })).toMatch(/メールアドレス/);
    expect(validatePassword('someone.long', { email })).toMatch(/メールアドレス/);
    // 短いローカル部は偶然の一致が多いので対象にしない
    expect(validatePassword('a-very-different-passphrase', { email })).toBeNull();
  });

  it('文字種の組み合わせは強制しない', () => {
    expect(validatePassword('alllowercaseletters')).toBeNull();
  });
});

describe('パスワード変更によるセッション失効', () => {
  const changedAt = '2026-08-25T10:00:30.500Z';
  const changedSec = Math.floor(Date.parse(changedAt) / 1000);

  it('変更より前に発行したセッションは無効', () => {
    expect(isRevokedByPasswordChange(changedSec - 1, changedAt)).toBe(true);
    expect(isRevokedByPasswordChange(changedSec - 3600, changedAt)).toBe(true);
  });

  it('変更と同じ秒以降に発行したセッションは有効', () => {
    // 変更した端末が直後に張り直すセッションを巻き込まない
    expect(isRevokedByPasswordChange(changedSec, changedAt)).toBe(false);
    expect(isRevokedByPasswordChange(changedSec + 1, changedAt)).toBe(false);
  });

  it('変更履歴が無い・読めない場合は失効させない', () => {
    // 古いデータには passwordChangedAt が無い
    expect(isRevokedByPasswordChange(1, null)).toBe(false);
    expect(isRevokedByPasswordChange(1, undefined)).toBe(false);
    expect(isRevokedByPasswordChange(1, 'not-a-date')).toBe(false);
  });
});
