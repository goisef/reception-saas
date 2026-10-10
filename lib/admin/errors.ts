/**
 * 管理画面の操作で起きる、画面にそのまま出してよいエラー。
 *
 * display には利用者へ見せる文言だけを入れる。内部の事情やスタックは含めない。
 * Server Action は guarded() (lib/admin/action-state.ts) でこれを受け、
 * 画面の状態へ変換する。それ以外の例外は握り潰さず上へ投げる。
 */
export class AdminActionError extends Error {
  constructor(public readonly display: string) {
    super(display);
    this.name = 'AdminActionError';
  }
}
