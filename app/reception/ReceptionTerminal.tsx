'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as api from '@/lib/client/api-client';
import type { TerminalSession } from '@/lib/client/api-client';
import * as queue from './offline-queue';

/**
 * 受付端末の画面 (PRD 5 / 72)。
 *
 * 横向きタブレット前提。表示するボタンも文言もサーバーから配られたものを
 * そのまま描く。ここに「QRが有効かどうか」などの判定は書かない (PRD 4 Thin Client)。
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
  | { name: 'number' }
  | { name: 'qr' }
  | { name: 'exit' }
  | { name: 'result'; tone: 'success' | 'error'; title: string; detail?: string };

const RESULT_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const CONFIG_POLL_MS = 60_000;

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

  // 送信待ち件数は localStorage（React の外）にあるので外部ストアとして購読する
  const queued = useSyncExternalStore(queue.subscribe, queue.getCount, queue.getServerCount);

  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goHome = useCallback(() => {
    setDigits('');
    setQrToken('');
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

  useEffect(() => () => {
    if (resultTimer.current) clearTimeout(resultTimer.current);
  }, []);

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

  // バージョン確認 (PRD 6-2)
  useEffect(() => {
    void api
      .checkVersion(session)
      .then(({ data }) => {
        if (data.forceUpdate) setUpdateNotice(`${data.message}（${data.latest?.version}）`);
        else if (data.updateAvailable) setUpdateNotice(data.message);
      })
      .catch(() => undefined);
  }, [session]);

  // 復旧時にオフラインキューを送る
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

  const newEventId = () =>
    `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  async function submitNumber() {
    if (digits.length !== 4 || busy) return;
    setBusy(true);
    const clientEventId = newEventId();
    try {
      const { data } = await api.checkin(session, {
        method: 'number',
        accessNumber: digits,
        clientEventId,
      });
      showResult('success', '受付が完了しました', data.message);
    } catch (error) {
      handleFailure(error, { kind: 'checkin', method: 'number', accessNumber: digits }, clientEventId);
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

  async function submitExit() {
    if (digits.length !== 4 || busy) return;
    setBusy(true);
    const clientEventId = newEventId();
    try {
      const { data } = await api.checkout(session, {
        accessNumber: digits,
        clientEventId,
      });
      showResult('success', 'ご利用ありがとうございました', data.message);
    } catch (error) {
      handleFailure(error, { kind: 'checkout', accessNumber: digits }, clientEventId);
    } finally {
      setBusy(false);
      setDigits('');
    }
  }

  /**
   * 通信そのものが失敗した場合はローカルへ積む (原則 P-3)。
   * サーバーが「番号が違う」等の業務エラーを返した場合は積まない。
   * 積んでも同じ理由で失敗するだけで、利用者を待たせるだけになる。
   */
  function handleFailure(
    error: unknown,
    payload: Record<string, unknown>,
    clientEventId: string
  ) {
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
  }

  const actionHandlers = useMemo<Record<string, () => void>>(
    () => ({
      'reception.qr': () => setScreen({ name: 'qr' }),
      'reception.number': () => setScreen({ name: 'number' }),
      'reception.other': () => setScreen({ name: 'exit' }),
      'reception.exit': () => setScreen({ name: 'exit' }),
    }),
    []
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-4">
          {logoUrl ? (
            // 顧客企業のロゴ (PRD 5)。管理画面からアップロードされたものを表示する
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-10 w-auto" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              R
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">{storeName}</p>
            <p className="text-xs text-slate-500">受付端末</p>
          </div>
        </div>
        <StatusBadges online={online} queued={queued} configVersion={configVersion} />
      </header>

      {updateNotice && (
        <div className="bg-amber-100 px-8 py-2 text-center text-sm text-amber-900">
          {updateNotice}
        </div>
      )}

      <main className="flex flex-1 items-center justify-center px-8 py-10">
        {screen.name === 'home' && (
          <div className="flex w-full max-w-2xl flex-col gap-5">
            {buttons.length === 0 && (
              <p className="text-center text-slate-500">
                利用できる受付方法がありません。管理画面で設定を確認してください。
              </p>
            )}
            {buttons.map((button) => (
              <button
                key={button.id}
                type="button"
                onClick={actionHandlers[button.action] ?? (() => setScreen({ name: 'exit' }))}
                className="rounded-2xl bg-white px-8 py-10 text-3xl font-semibold shadow-sm ring-1 ring-slate-200 transition active:scale-[0.99] hover:ring-slate-400"
              >
                {button.label}
              </button>
            ))}
          </div>
        )}

        {(screen.name === 'number' || screen.name === 'exit') && (
          <Keypad
            title={screen.name === 'exit' ? '退出する番号を入力' : '4桁番号を入力'}
            digits={digits}
            busy={busy}
            onDigit={(d) => setDigits((prev) => (prev.length < 4 ? prev + d : prev))}
            onBackspace={() => setDigits((prev) => prev.slice(0, -1))}
            onCancel={goHome}
            onSubmit={screen.name === 'exit' ? submitExit : submitNumber}
          />
        )}

        {screen.name === 'qr' && (
          <QrPanel
            token={qrToken}
            busy={busy}
            onChange={setQrToken}
            onCancel={goHome}
            onSubmit={submitQr}
          />
        )}

        {screen.name === 'result' && (
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
        )}
      </main>
    </div>
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
    <div className="flex items-center gap-3 text-xs">
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
      <span className="text-slate-400">config v{configVersion}</span>
    </div>
  );
}

function Keypad({
  title,
  digits,
  busy,
  onDigit,
  onBackspace,
  onCancel,
  onSubmit,
}: {
  title: string;
  digits: string;
  busy: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="w-full max-w-md">
      <p className="mb-6 text-center text-2xl font-semibold">{title}</p>
      <div className="mb-8 flex justify-center gap-4">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="flex h-20 w-16 items-center justify-center rounded-xl bg-white text-4xl font-bold shadow-sm ring-1 ring-slate-200"
          >
            {digits[i] ?? ''}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <KeyButton key={d} onClick={() => onDigit(d)}>
            {d}
          </KeyButton>
        ))}
        <KeyButton onClick={onBackspace}>←</KeyButton>
        <KeyButton onClick={() => onDigit('0')}>0</KeyButton>
        <button
          type="button"
          disabled={digits.length !== 4 || busy}
          onClick={onSubmit}
          className="rounded-xl bg-slate-900 py-6 text-xl font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? '送信中' : '決定'}
        </button>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-6 w-full rounded-xl py-4 text-slate-600 underline"
      >
        戻る
      </button>
    </div>
  );
}

function KeyButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl bg-white py-6 text-2xl font-semibold shadow-sm ring-1 ring-slate-200 active:bg-slate-100"
    >
      {children}
    </button>
  );
}

function QrPanel({
  token,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  token: string;
  busy: boolean;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 多くの店舗はUSB/Bluetooth のQRリーダーをキーボードとして繋ぐ。
  // 読み取り結果がそのまま入力されるよう、常にフォーカスを当てておく。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="w-full max-w-xl text-center">
      <p className="mb-4 text-2xl font-semibold">QRコードをかざしてください</p>
      <p className="mb-8 text-slate-500">
        読み取り機に予約完了メールのQRコードをかざしてください。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          ref={inputRef}
          value={token}
          onChange={(e) => onChange(e.target.value)}
          placeholder="読み取り結果がここに入ります"
          className="w-full rounded-xl border border-slate-300 px-5 py-5 text-center text-lg"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!token.trim() || busy}
          className="mt-6 w-full rounded-xl bg-slate-900 py-5 text-xl font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? '送信中' : '受付する'}
        </button>
      </form>
      <button type="button" onClick={onCancel} className="mt-6 text-slate-600 underline">
        戻る
      </button>
    </div>
  );
}
