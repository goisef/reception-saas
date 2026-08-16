import { currentSession } from '@/lib/admin/session';
import { collections, ready } from '@/lib/store';
import * as remoteConfig from '@/lib/services/remote-config';
import { Card, PageHeading } from '../ui';
import { saveConfigAction } from './actions';

export const dynamic = 'force-dynamic';

const FLAG_LABEL: Record<string, string> = {
  qrReception: 'QR受付',
  numberReception: '4桁番号受付',
  faceRecognition: '顔認証',
  staffReception: 'スタッフ受付',
  eventReception: 'イベント受付',
  exitNotification: '退出通知',
  calendar: 'カレンダー連携',
  offlineMode: 'オフライン受付',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await ready();
  const session = await currentSession();
  const { storeId } = await searchParams;

  const stores = await collections.stores().list(session.tenantId);
  const selected = storeId ?? stores[0]?.id;
  if (!selected) {
    return <PageHeading title="端末設定" description="店舗が登録されていません。" />;
  }

  const config = await remoteConfig.getRaw(session.tenantId, selected);

  return (
    <>
      <PageHeading
        title="端末設定"
        description="ここで保存した内容は、受付端末を更新しなくても次の設定取得で反映されます（PRD 原則 P-1）。"
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {stores.map((s) => (
          <a
            key={s.id}
            href={`/admin/settings?storeId=${s.id}`}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              s.id === selected ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200'
            }`}
          >
            {s.name}
          </a>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          現在の configVersion: {config.configVersion}
        </span>
      </div>

      <form action={saveConfigAction} className="space-y-6">
        <input type="hidden" name="storeId" value={selected} />

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-600">受付ボタン</h2>
          <div className="space-y-3">
            {config.buttons.map((button) => (
              <div
                key={button.id}
                className="grid items-end gap-3 border-b border-slate-100 pb-3 last:border-0 md:grid-cols-[1fr_100px_100px]"
              >
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-slate-500">
                    文言（{button.action}）
                  </span>
                  <input
                    name={`button.${button.id}.label`}
                    defaultValue={button.label}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-slate-500">並び順</span>
                  <input
                    type="number"
                    name={`button.${button.id}.order`}
                    defaultValue={button.order}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    name={`button.${button.id}.visible`}
                    defaultChecked={button.visible}
                    className="h-4 w-4"
                  />
                  表示
                </label>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-600">Feature Flag / 段階リリース</h2>
          <p className="mb-4 text-xs text-slate-500">
            公開率は端末IDのハッシュで判定します。同じ端末は毎回同じ結果になるので、
            機能が出たり消えたりしません（PRD 4-4）。
          </p>
          <div className="space-y-3">
            {config.flags.map((flag) => (
              <div
                key={flag.key}
                className="grid items-center gap-3 border-b border-slate-100 pb-3 last:border-0 md:grid-cols-[1fr_100px_160px]"
              >
                <span className="text-sm font-medium">{FLAG_LABEL[flag.key] ?? flag.key}</span>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`flag.${flag.key}.enabled`}
                    defaultChecked={flag.enabled}
                    className="h-4 w-4"
                  />
                  有効
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-slate-500">公開率 %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    name={`flag.${flag.key}.rollout`}
                    defaultValue={flag.rolloutPercent}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-600">外観</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">ロゴURL</span>
              <input
                name="logo"
                defaultValue={config.logo ?? ''}
                placeholder="https://.../logo.svg"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">テーマ</span>
              <input
                name="theme"
                defaultValue={config.theme}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">言語</span>
              <input
                name="language"
                defaultValue={config.language}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">通知音</span>
              <input
                name="notificationSound"
                defaultValue={config.notificationSound}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
        </Card>

        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white"
        >
          保存して端末へ配信
        </button>
      </form>
    </>
  );
}
