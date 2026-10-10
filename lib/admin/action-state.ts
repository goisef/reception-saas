import { headers } from 'next/headers';
import { UserAdminError, type RequestContext } from './users';

/**
 * 管理ユーザー系の Server Action が共通で使う状態と補助。
 *
 * useActionState から返す値は、ブラウザにそのまま届く。
 * パスワード・ハッシュ・内部エラーの詳細は絶対に入れない。
 * リンクだけは作成時に一度だけ返す（再表示できない）。
 */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  link?: { url: string; kind: 'invite' | 'reset'; label: string };
  /**
   * 失敗したときに入力を戻すための値。
   * React はアクションの完了後にフォームを初期値へ戻すので、返さないと
   * エラーのたびに入力が消える。パスワードは決して入れない。
   */
  values?: { email: string; displayName: string; role: string; storeIds: string[] };
};

/** UserAdminError は画面に出す文言へ。それ以外は握り潰さず上へ投げる。 */
export async function guarded(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UserAdminError) return { ok: false, error: error.display };
    throw error;
  }
}

export async function requestContext(): Promise<RequestContext> {
  const head = await headers();
  const forwarded = head.get('x-forwarded-for');
  return {
    // 先頭が元のクライアント。後ろはプロキシ
    ip: forwarded ? forwarded.split(',')[0].trim() : null,
    userAgent: head.get('user-agent'),
  };
}

/**
 * 招待リンクの土台となるURL。
 *
 * Host ヘッダは外から書き換えられるため、設定があればそちらを優先する。
 * リンクを見るのは管理者本人だが、攻撃者のドメインを指すリンクを
 * 本人へ配らせる経路を残さない。
 */
export async function publicOrigin(): Promise<string> {
  const configured = process.env.RECEPTION_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const head = await headers();
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3000';
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/admin/invite/${encodeURIComponent(token)}`;
}
