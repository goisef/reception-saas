'use client';

/**
 * オフライン受付キュー (PRD 12-5 / 原則 P-3)。
 *
 * 通信できないときは受付要求をローカルへ積み、復旧したら順に送る。
 * 各要求には clientEventId を付けてあり、サーバー側は同じIDの受付を
 * 二重に作らない (PRD Q-6)。だから復旧時に何度送っても安全。
 *
 * 保存先は localStorage。IndexedDB のほうが堅牢だが、積むのは
 * 数十件程度の小さな JSON なので、まずは単純な方を採る。
 */

const STORAGE_KEY = 'reception.offline-queue.v1';

export type QueuedRequest = {
  clientEventId: string;
  kind: 'checkin' | 'checkout';
  payload: Record<string, unknown>;
  queuedAt: string;
};

/**
 * 件数バッジ用の外部ストア購読。
 *
 * localStorage は React の外にある状態なので、effect の中で setState して
 * 同期するのではなく useSyncExternalStore で読む。SSR 時は 0 を返す。
 */
const listeners = new Set<() => void>();
let cachedCount: number | null = null;

function notify(): void {
  cachedCount = read().length;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCount(): number {
  if (cachedCount === null) cachedCount = read().length;
  return cachedCount;
}

export function getServerCount(): number {
  return 0;
}

function read(): QueuedRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  } catch {
    return [];
  }
}

function write(items: QueuedRequest[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 保存領域が一杯なら諦める。受付そのものは既に画面上で完了扱いになっている
  }
}

export function enqueue(request: QueuedRequest): void {
  write([...read(), request]);
  notify();
}

export function pending(): QueuedRequest[] {
  return read();
}

export function remove(clientEventId: string): void {
  write(read().filter((r) => r.clientEventId !== clientEventId));
  notify();
}

export function clear(): void {
  write([]);
  notify();
}

/**
 * 溜まった要求を順に送る。1件でも失敗したらそこで止める。
 * 受付順を保ちたいので、後続だけ成功させることはしない。
 */
export async function flush(
  send: (request: QueuedRequest) => Promise<void>
): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  for (const request of read()) {
    try {
      await send(request);
      remove(request.clientEventId);
      sent += 1;
    } catch {
      break;
    }
  }
  notify();
  return { sent, remaining: read().length };
}
