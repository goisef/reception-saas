import type { Role } from '../domain/types';

/**
 * 管理ユーザーの運用ルール。I/O を持たない純粋関数だけを置く。
 *
 * 「誰が誰にどのロールを付けられるか」「どんなパスワードを許すか」は、
 * 間違えると権限昇格やアカウント乗っ取りに直結する。データストア抜きで
 * 網羅的にテストできるよう、画面やサービスから切り離している。
 */

// ---------------------------------------------------------------------------
// ロール
// ---------------------------------------------------------------------------

export const ROLE_LABEL: Record<Role, string> = {
  SuperAdmin: 'スーパー管理者',
  TenantAdmin: 'テナント管理者',
  AreaManager: 'エリアマネージャー',
  StoreManager: '店長',
  Staff: 'スタッフ',
  ReceptionOnly: '受付専用',
  Viewer: '閲覧のみ',
};

/** 大きいほど強い。 */
const RANK: Record<Role, number> = {
  SuperAdmin: 70,
  TenantAdmin: 60,
  AreaManager: 50,
  StoreManager: 40,
  Staff: 30,
  ReceptionOnly: 20,
  Viewer: 10,
};

/** 画面の選択肢に出す順。 */
export const ROLES_BY_RANK: Role[] = (Object.keys(RANK) as Role[]).sort(
  (a, b) => RANK[b] - RANK[a]
);

/** 利用者の管理そのものを行えるロール。 */
const USER_ADMIN_ROLES: Role[] = ['SuperAdmin', 'TenantAdmin'];

export function canManageUsers(role: Role): boolean {
  return USER_ADMIN_ROLES.includes(role);
}

/**
 * 付与してよいロール。
 *
 * SuperAdmin はプラットフォーム運営側の権限で、テナントの画面から
 * 作れてはならない。それ以外は自分と同じか下まで。自分より強いロールを
 * 付けられると、一度の操作で権限昇格できてしまう。
 */
export function assignableRoles(actor: Role): Role[] {
  if (!canManageUsers(actor)) return [];
  return ROLES_BY_RANK.filter((r) => r !== 'SuperAdmin' && RANK[r] <= RANK[actor]);
}

export function canAssignRole(actor: Role, target: Role): boolean {
  return assignableRoles(actor).includes(target);
}

/**
 * 既存の利用者を操作してよいか。
 * 自分より強い人（TenantAdmin から見た SuperAdmin）には触れない。
 */
export function canModifyUser(actor: Role, target: Role): boolean {
  return canManageUsers(actor) && RANK[target] <= RANK[actor];
}

/**
 * 店舗の指定が必須のロール。
 *
 * 店舗の範囲が空なのは「全店舗」を意味する。店長やスタッフを
 * 店舗を選ばずに作れてしまうと、意図せず全店舗の権限を持つ。
 */
export function roleNeedsStores(role: Role): boolean {
  return role === 'AreaManager' || role === 'StoreManager' || role === 'Staff';
}

/** 管理者が最後の1人になっていないかの判定に使う。 */
export function isAdminRole(role: Role): boolean {
  return canManageUsers(role);
}

// ---------------------------------------------------------------------------
// パスワード
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 10;
/**
 * 上限。PBKDF2 は入力が長いほど重くなる。無制限だと、巨大なパスワードを
 * 投げるだけでサーバーを遅くできる。
 */
export const PASSWORD_MAX_LENGTH = 128;

/** 推測されやすい代表例。網羅は目的ではなく、最悪の選択を弾くための最小限。 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'iloveyou12',
  'reception',
  'reception-dev',
  'receptionsaas',
  'admin12345',
  'welcome123',
]);

/**
 * パスワードの検証。問題なければ null、あればその理由を返す。
 *
 * 文字種の組み合わせ（大文字・記号を必須にする等）は強制しない。
 * 長さに比べて安全性への寄与が小さく、「Password1!」のような
 * 予測しやすい形を増やすだけになるため。
 */
export function validatePassword(
  password: string,
  context: { email?: string } = {}
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください。`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `パスワードは${PASSWORD_MAX_LENGTH}文字以内にしてください。`;
  }
  if (new Set(password).size === 1) {
    return '同じ文字だけのパスワードは使えません。';
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    return 'よく使われるパスワードのため使えません。別のものにしてください。';
  }
  if (context.email) {
    const email = context.email.trim().toLowerCase();
    const local = email.split('@')[0] ?? '';
    if (lowered === email || (local.length >= 4 && lowered === local)) {
      return 'メールアドレスと同じパスワードは使えません。';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 招待リンクの有効期限
// ---------------------------------------------------------------------------

/**
 * 招待は相手が気付くまで時間がかかる。再設定は「いま本人が困っている」
 * 状況で、放置されたリンクは攻撃面になるだけなので短くする。
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;
