import { currentSession } from '@/lib/admin/session';
import { canManageFeatures } from '@/lib/admin/policy';
import { getOverview } from '@/lib/services/features';
import { Badge, Card, PageHeading, formatDateTime } from '../ui';
import { PublishForm } from './PublishForm';
import { StoreFlagForm } from './StoreFlagForm';

export const dynamic = 'force-dynamic';

export default async function FeaturesPage() {
  const session = await currentSession();

  // メニューからは隠すが、URLを直接開かれても中身は見せない
  if (!canManageFeatures(session.role)) {
    return (
      <>
        <PageHeading title="機能管理" />
        <Card>
          <p className="text-sm text-slate-600">機能を管理する権限がありません。</p>
        </Card>
      </>
    );
  }

  const features = await getOverview(session);

  return (
    <>
      <PageHeading
        title="機能管理"
        description="既定で存在を見せない「隠し機能」の公開・非公開を切り替えます。"
      />

      <div className="space-y-6">
        {features.map((feature) => (
          <Card key={feature.key}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{feature.label}</h2>
              <Badge>隠し機能</Badge>
              {feature.published ? (
                <Badge tone="success">公開中</Badge>
              ) : (
                <Badge tone="warning">非公開</Badge>
              )}
              {feature.updatedAt && (
                <span className="ml-auto text-xs text-slate-400">
                  最終変更 {formatDateTime(feature.updatedAt)}
                </span>
              )}
            </div>

            <p className="mt-2 max-w-3xl text-sm text-slate-600">{feature.summary}</p>

            <p className="mt-3 max-w-3xl rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {feature.published
                ? '公開中は、下の店舗の設定（有効・公開率）に従って端末へ配られ、顧客一覧と帳票に項目が現れます。'
                : '非公開の間は、端末への配信・顧客一覧・帳票・端末設定のどこにも現れません。店舗の設定は保持されるので、公開し直すと元の設定に戻ります。'}
            </p>

            <div className="mt-4">
              <PublishForm
                featureKey={feature.key}
                label={feature.label}
                published={feature.published}
                acknowledgement={feature.acknowledgement}
              />
            </div>

            {feature.published && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-600">店舗ごとの段階リリース</h3>
                <p className="mt-1 text-xs text-slate-500">
                  公開しただけでは、どの店舗にも配られません。店舗を「有効」にし、公開率を決めてください。
                  公開率は端末IDのハッシュで判定するので、同じ端末は毎回同じ結果になります。
                </p>
                <div className="mt-2">
                  {feature.stores.map((store) => (
                    <StoreFlagForm
                      key={store.storeId}
                      featureKey={feature.key}
                      storeId={store.storeId}
                      storeName={store.storeName}
                      enabled={store.enabled}
                      rolloutPercent={store.rolloutPercent}
                      editable={store.editable}
                    />
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-xs text-slate-500">
        受付ボタンやQR受付など通常の機能のON/OFFは「端末設定」で行います。
        顔認証の撮影・照合そのものは、SDK の選定（PRD 21章 Q-1）が済むまで未実装です。
        この画面のスイッチは、公開の入口と、公開前に整えるべき確認事項を先に用意するためのものです。
      </p>
    </>
  );
}
