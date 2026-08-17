'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as api from '@/lib/client/api-client';
import type { TerminalSession } from '@/lib/client/api-client';
import { NUMBER_MAX_LENGTH, NUMBER_MIN_LENGTH } from '@/lib/domain/access-number';
import * as queue from './offline-queue';
import { Numpad } from './Numpad';
import { Clock } from './Clock';

/**
 * 受付端末の画面 (PRD 5 / 72)。
 *
 * このプロダクトで最も使われる画面。来店客が毎回触るので、
 * 「迷わない」「速い」を他のどの画面より優先する。
 *
 * QRと番号入力を同時に出しているのは、来店客に「どちらで受付するか」を
 * 選ばせる一手間を省くため。持っている方をそのまま使えばよい。
 *
 * 表示するボタンも文言もサーバーから配られたものを描く。
 * ここに「QRが有効かどうか」などの判定は書かない (PRD 4 Thin Client)。
 */

type ButtonConfig = { id: string; label: string; action: string; order: number };

type Props = {
  session: TerminalSession;
  storeName: string;
  logoUrl: string | null;
  initialButtons: ButtonConfig[];
  initialConfigVersion: number;
};

type Screen =
  | { name: 'home' }
  | { name: 'result'; tone: 'success' | 'error'; title: string; detail?: string };

const RESULT_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const CONFIG_POLL_MS = 60_000;

/**
 * 受付要求の重複排除キー。オフライン再送でも二重受付にならないよう
 * サーバーへ渡す (PRD Q-6)。
 *
 * コンポーネントの外に置いているのは、レンダー中に定義すると
 * Date.now / Math.random が「描画のたびに結果が変わる関数」として
 * 検出されるため。実際に呼ぶのは操作イベントの中だけ。
 */
function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function ReceptionTerminal({
  session,
  storeName,
  logoUrl,
  initialButtons,
  initialConfigVersion,
}: Props) {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [buttons, setButtons] = useState(initialButtons);
  const [configVersion, setConfigVersion] = useState(initialConfigVersion);
  const [digits, setDigits] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  /** 番号入力を「受付」と「退出」のどちらに使うか */
  const [numberMode, setNumberMode] = useState<'checkin' | 'exit'>('checkin');

  const queued = useSyncExternalStore(queue.subscribe, queue.getCount, queue.getServerCount);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goHome = useCallback(() => {
    setDigits('');
    setQrToken('');
    setNumberMode('checkin');
    setScreen({ name: 'home' });
  }, []);

  const showResult = useCallback(
    (tone: 'success' | 'error', title: string, detail?: string) => {
      setScreen({ name: 'result', tone, title, detail });
      if (resultTimer.current) clearTimeout(resultTimer.current);
      // 次の利用者のために自動で初期画面へ戻す。個人名を出しっぱなしにしない
      resultTimer.current = setTimeout(goHome, RESULT_TIMEOUT_MS);
    },
    [goHome]
  );

  useEffect(
    () => () => {
      if (resultTimer.current) clearTimeout(resultTimer.current);
    },
    []
  );

  // 端末の死活通知。途絶えると管理者へ「端末が通信できていません」が飛ぶ
  useEffect(() => {
    let cancelled = false;
    const beat = async () => {
      try {
        await api.heartbeat(session, configVersion);
        if (!cancelled) setOnline(true);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session, configVersion]);

  // 設定の定期取得。管理画面でボタンを変えたら、端末を触らずに反映される
  useEffect(() => {
    const poll = async () => {
      try {
        const { data } = await api.fetchConfig(session);
        setButtons(data.buttons);
        setConfigVersion(data.configVersion);
      } catch {
        // 取得できなくても前回の設定で動き続ける
      }
    };
    const id = setInterval(poll, CONFIG_POLL_MS);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    void api
      .checkVersion(session)
      .then(({ data }) => {
        if (data.forceUpdate) setUpdateNotice(`${data.message}（${data.latest?.version}）`);
        else if (data.updateAvailable) setUpdateNotice(data.message);
      })
      .catch(() => undefined);
  }, [session]);

  const flushQueue = useCallback(async () => {
    await queue.flush(async (request) => {
      if (request.kind === 'checkin') {
        await api.checkin(session, {
          method: request.payload.method as 'number',
          accessNumber: request.payload.accessNumber as string | undefined,
          qrToken: request.payload.qrToken as string | undefined,
          clientEventId: request.clientEventId,
        });
      } else {
        await api.checkout(session, {
          accessNumber: request.payload.accessNumber as string,
          clientEventId: request.clientEventId,
        });
      }
    });
  }, [session]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushQueue]);

  /**
   * 通信そのものが失敗した場合はローカルへ積む (原則 P-3)。
   * サーバーが「番号が違う」等の業務エラーを返した場合は積まない。
   * 積んでも同じ理由で失敗するだけで、利用者を待たせるだけになる。
   */
  const handleFailure = useCallback(
    (error: unknown, payload: Record<string, unknown>, clientEventId: string) => {
      const isBusinessError = error instanceof api.TerminalApiError && error.status < 500;
      if (isBusinessError) {
        // message は外部連携先の開発者向けなので画面には出さない。
        // 来店客に見せる文言はサーバーが display で配る。
        showResult('error', '受付できませんでした', (error as api.TerminalApiError).display);
        return;
      }

      const { kind, ...rest } = payload;
      queue.enqueue({
        clientEventId,
        kind: kind as 'checkin' | 'checkout',
        payload: rest,
        queuedAt: new Date().toISOString(),
      });
      setOnline(false);
      showResult(
        'success',
        '受付を承りました',
        '通信が回復し次第、自動的に反映されます。そのままお進みください。'
      );
    },
    [showResult]
  );

  async function submitNumber() {
    if (digits.length < NUMBER_MIN_LENGTH || busy) return;
    setBusy(true);
    const clientEventId = newEventId();
    const exiting = numberMode === 'exit';
    try {
      if (exiting) {
        const { data } = await api.checkout(session, { accessNumber: digits, clientEventId });
        showResult('success', 'ご利用ありがとうございました', data.message);
      } else {
        const { data } = await api.checkin(session, {
          method: 'number',
          accessNumber: digits,
          clientEventId,
        });
        showResult('success', '受付が完了しました', data.message);
      }
    } catch (error) {
      handleFailure(
        error,
        exiting
          ? { kind: 'checkout', accessNumber: digits }
          : { kind: 'checkin', method: 'number', accessNumber: digits },
        clientEventId
      );
    } finally {
      setBusy(false);
      setDigits('');
    }
  }

  async function submitQr() {
    if (!qrToken.trim() || busy) return;
    setBusy(true);
    const clientEventId = newEventId();
    try {
      const { data } = await api.checkin(session, {
        method: 'qr',
        qrToken: qrToken.trim(),
        clientEventId,
      });
      showResult('success', '受付が完了しました', data.message);
    } catch (error) {
      handleFailure(
        error,
        { kind: 'checkin', method: 'qr', qrToken: qrToken.trim() },
        clientEventId
      );
    } finally {
      setBusy(false);
      setQrToken('');
    }
  }

  /** 総合受付・業者受付。氏名を取らず、担当者の呼び出しだけを行う。 */
  async function submitCall(method: 'staff' | 'vendor', label: string) {
    if (busy) return;
    setBusy(true);
    const clientEventId = newEventId();
    try {
      await api.checkin(session, { method, guestName: label, clientEventId });
      showResult('success', '担当者を呼び出しました', 'そのままお待ちください。');
    } catch (error) {
      handleFailure(error, { kind: 'checkin', method, guestName: label }, clientEventId);
    } finally {
      setBusy(false);
    }
  }

  const qrButton = useMemo(
    () => buttons.find((b) => b.action === 'reception.qr'),
    [buttons]
  );
  const numberButton = useMemo(
    () => buttons.find((b) => b.action === 'reception.number'),
    [buttons]
  );
  /** 下部の呼び出し系。QR と番号以外はここへ並べる。 */
  const callButtons = useMemo(
    () =>
      buttons
        .filter((b) => b.action !== 'reception.qr' && b.action !== 'reception.number')
        .sort((a, b) => a.order - b.order),
    [buttons]
  );

  return (
    <div className="kiosk flex min-h-dvh flex-col bg-white text-slate-900">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-3">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // 顧客企業のロゴ (PRD 5)。管理画面からアップロードされたものを表示する
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-10 w-auto" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-xl font-bold text-white">
              R
            </div>
          )}
          <div>
            <p className="text-lg font-bold tracking-wide">{storeName}</p>
            <p className="text-xs text-slate-500">受付端末</p>
          </div>
        </div>

        <p className="hidden text-sm font-medium text-slate-600 lg:block">
          ようこそ。画面を操作して受付を開始してください
        </p>

        <div className="flex items-center gap-4">
          <StatusBadges online={online} queued={queued} configVersion={configVersion} />
          <Clock />
        </div>
      </header>

      {updateNotice && (
        <div className="bg-amber-100 px-6 py-2 text-center text-sm text-amber-900">
          {updateNotice}
        </div>
      )}

      {screen.name === 'home' ? (
        <>
          <main className="flex flex-1 flex-col md:flex-row">
            {qrButton && (
              <section className="flex flex-1 flex-col items-center justify-center border-b border-slate-100 bg-slate-50 p-6 md:border-b-0 md:border-r">
                <h2 className="mb-1 text-2xl font-bold">{qrButton.label}</h2>
                <p className="mb-5 text-center text-sm text-slate-500">
                  スマートフォン等でお持ちの
                  <br />
                  QRコードをかざしてください
                </p>
                <QrPanel token={qrToken} busy={busy} onChange={setQrToken} onSubmit={submitQr} />
              </section>
            )}

            {numberButton && (
              <section className="flex flex-1 flex-col items-center justify-center p-6">
                <h2 className="mb-1 text-2xl font-bold">
                  {numberMode === 'exit' ? '退出する番号を入力' : numberButton.label}
                </h2>
                <p className="mb-4 text-sm text-slate-500">
                  {NUMBER_MIN_LENGTH}〜{NUMBER_MAX_LENGTH}桁の番号（予約・VIP・共通）
                </p>

                {/* 退出も番号入力なので、同じテンキーを使い分ける */}
                <div className="mb-5 inline-flex rounded-lg bg-slate-100 p-1">
                  <ModeTab
                    active={numberMode === 'checkin'}
                    onClick={() => {
                      setNumberMode('checkin');
                      setDigits('');
                    }}
                  >
                    受付
                  </ModeTab>
                  <ModeTab
                    active={numberMode === 'exit'}
                    onClick={() => {
                      setNumberMode('exit');
                      setDigits('');
                    }}
                  >
                    退出
                  </ModeTab>
                </div>

                <Numpad
                  digits={digits}
                  busy={busy}
                  submitLabel={numberMode === 'exit' ? '退出する' : '受付する'}
                  onDigit={(d) =>
                    setDigits((prev) => (prev.length < NUMBER_MAX_LENGTH ? prev + d : prev))
                  }
                  onBackspace={() => setDigits((prev) => prev.slice(0, -1))}
                  onSubmit={submitNumber}
                />
              </section>
            )}

            {!qrButton && !numberButton && (
              <div className="flex flex-1 items-center justify-center p-10 text-center text-slate-500">
                利用できる受付方法がありません。
                <br />
                管理画面で設定を確認してください。
              </div>
            )}
          </main>

          {callButtons.length > 0 && (
            <footer className="flex shrink-0 flex-col gap-3 bg-slate-800 p-4 sm:flex-row">
              {callButtons.map((button) => (
                <button
                  key={button.id}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    submitCall(button.action === 'reception.event' ? 'vendor' : 'staff', button.label)
                  }
                  className="flex-1 rounded-lg bg-slate-700 px-4 py-4 text-base font-medium text-white transition-colors hover:bg-slate-600 disabled:opacity-50"
                >
                  {button.label}
                </button>
              ))}
            </footer>
          )}
        </>
      ) : (
        <main className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-2xl text-center">
            <div
              className={`rounded-3xl px-10 py-16 ${
                screen.tone === 'success'
                  ? 'bg-emerald-50 ring-1 ring-emerald-200'
                  : 'bg-rose-50 ring-1 ring-rose-200'
              }`}
            >
              <p className="text-4xl font-bold">{screen.title}</p>
              {screen.detail && <p className="mt-6 text-xl text-slate-700">{screen.detail}</p>}
            </div>
            <button
              type="button"
              onClick={goHome}
              className="mt-8 rounded-full bg-slate-900 px-10 py-4 text-lg font-medium text-white"
            >
              最初に戻る
            </button>
          </div>
        </main>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-8 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadges({
  online,
  queued,
  configVersion,
}: {
  online: boolean;
  queued: number;
  configVersion: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`rounded-full px-3 py-1 font-medium ${
          online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
        }`}
      >
        {online ? 'オンライン' : 'オフライン'}
      </span>
      {queued > 0 && (
        <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">
          送信待ち {queued}件
        </span>
      )}
      <span className="hidden text-slate-400 xl:inline">config v{configVersion}</span>
    </div>
  );
}

function QrPanel({
  token,
  busy,
  onChange,
  onSubmit,
}: {
  token: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 多くの店舗はUSB/Bluetooth のQRリーダーをキーボードとして繋ぐ。
  // 読み取り結果がそのまま入力されるよう、常にフォーカスを当てておく。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="flex w-full max-w-sm flex-col items-center"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-5 flex h-44 w-44 items-center justify-center rounded-2xl border-4 border-dashed border-slate-300 bg-white">
        <svg
          viewBox="0 0 24 24"
          className="h-20 w-20 text-slate-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3zM19 19h2v2h-2zM14 19h2v2h-2zM19 14h2v2h-2z" />
        </svg>
      </div>
      <input
        ref={inputRef}
        value={token}
        onChange={(e) => onChange(e.target.value)}
        placeholder="読み取り結果がここに入ります"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={!token.trim() || busy}
        className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-base font-semibold text-white disabled:bg-slate-300"
      >
        {busy ? '送信中' : '受付する'}
      </button>
    </form>
  );
}
