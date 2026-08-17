'use client';

/**
 * 受付端末から API v1 を叩くクライアント。
 *
 * 端末はここでしかサーバーと話さない。画面側にビジネスロジックを持たせないため、
 * 「受付できたか」「何を表示するか」はすべてレスポンスの内容に従う (PRD 4)。
 */

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    /** 来店客に見せる文言。サーバーが決める (PRD 4 Thin Client) */
    display?: string;
    details?: { field: string; message: string }[];
  };
};

export class TerminalApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    /**
     * 画面に出す文言。サーバーが display を返さなかった場合のみ
     * 汎用文言にフォールバックする。message は開発者向けなので出さない。
     */
    readonly display: string = 'ただいま受付できません。スタッフにお声がけください。'
  ) {
    super(message);
    this.name = 'TerminalApiError';
  }
}

export type TerminalSession = {
  apiKey: string;
  storeId: string;
  deviceId: string;
  appVersion: string;
};

function headers(session: TerminalSession, extra: Record<string, string> = {}): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.apiKey}`,
    'X-Device-Id': session.deviceId,
    'X-App-Version': session.appVersion,
    ...extra,
  };
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const body = json as ApiErrorBody;
    throw new TerminalApiError(
      body.error?.code ?? 'unknown',
      body.error?.message ?? '通信に失敗しました',
      response.status,
      body.error?.display
    );
  }
  return json as T;
}

export type CheckinResponse = {
  data: {
    visit: { id: string; accessNumber: string | null; scheduledExitAt: string | null };
    accessNumber: string | null;
    message: string;
    duplicate: boolean;
  };
};

export type CheckoutResponse = {
  data: {
    visit: { id: string };
    stayMinutes: number;
    overdueMinutes: number;
    message: string;
  };
};

export async function checkin(
  session: TerminalSession,
  payload: {
    method: 'qr' | 'number' | 'staff' | 'event' | 'custom' | 'face' | 'vendor';
    qrToken?: string;
    accessNumber?: string;
    guestName?: string;
    clientEventId: string;
  }
): Promise<CheckinResponse> {
  const response = await fetch('/api/v1/checkins', {
    method: 'POST',
    // clientEventId を Idempotency-Key にも使う。二度押しでも二重受付にならない
    headers: headers(session, { 'Idempotency-Key': payload.clientEventId }),
    body: JSON.stringify({ storeId: session.storeId, ...payload }),
  });
  return parse<CheckinResponse>(response);
}

export async function checkout(
  session: TerminalSession,
  payload: { accessNumber: string; clientEventId: string }
): Promise<CheckoutResponse> {
  const response = await fetch('/api/v1/checkouts', {
    method: 'PATCH',
    headers: headers(session, { 'Idempotency-Key': payload.clientEventId }),
    body: JSON.stringify({ storeId: session.storeId, accessNumber: payload.accessNumber }),
  });
  return parse<CheckoutResponse>(response);
}

export async function heartbeat(session: TerminalSession, configVersion: number): Promise<void> {
  await fetch('/api/v1/device/heartbeat', {
    method: 'POST',
    headers: headers(session),
    body: JSON.stringify({
      storeId: session.storeId,
      platform: 'pwa',
      appVersion: session.appVersion,
      configVersion,
    }),
  });
}

export type VersionResponse = {
  data: {
    updateAvailable: boolean;
    forceUpdate: boolean;
    message: string;
    latest: { version: string; releaseNotes: string } | null;
  };
};

export async function checkVersion(session: TerminalSession): Promise<VersionResponse> {
  const response = await fetch(
    `/api/v1/device/version?platform=pwa&version=${encodeURIComponent(session.appVersion)}`,
    { headers: headers(session) }
  );
  return parse<VersionResponse>(response);
}

export type ConfigResponse = {
  data: {
    configVersion: number;
    buttons: { id: string; label: string; action: string; order: number }[];
    features: Record<string, boolean>;
    theme: string;
    logo: string | null;
  };
};

export async function fetchConfig(session: TerminalSession): Promise<ConfigResponse> {
  const response = await fetch(
    `/api/v1/device/config?storeId=${encodeURIComponent(session.storeId)}`,
    { headers: headers(session) }
  );
  return parse<ConfigResponse>(response);
}
