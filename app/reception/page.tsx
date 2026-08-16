import type { Metadata } from 'next';
import ReceptionTerminal from './ReceptionTerminal';
import ServiceWorkerRegistrar from './ServiceWorkerRegistrar';
import { terminalProvisioning } from '@/lib/client/terminal-config';
import { collections, ready } from '@/lib/store';
import * as remoteConfig from '@/lib/services/remote-config';

export const metadata: Metadata = {
  title: '受付 | Reception',
  description: '無人受付端末',
};

/** 端末アプリ自体の版数。API に申告し、強制アップデート判定に使う。 */
const APP_VERSION = '1.5.0';

// 端末設定は管理画面から即時反映させたいのでキャッシュしない
export const dynamic = 'force-dynamic';

export default async function ReceptionPage() {
  await ready();
  const provisioning = terminalProvisioning();

  const store = await collections.stores().get(provisioning.tenantId, provisioning.storeId);
  const config = await remoteConfig.resolve({
    tenantId: provisioning.tenantId,
    storeId: provisioning.storeId,
    deviceId: provisioning.deviceId,
  });

  return (
    <>
      <ServiceWorkerRegistrar />
      <ReceptionTerminal
        session={{
          apiKey: provisioning.apiKey,
          storeId: provisioning.storeId,
          deviceId: provisioning.deviceId,
          appVersion: APP_VERSION,
        }}
        storeName={store?.name ?? '受付'}
        logoUrl={config.logo}
        initialButtons={config.buttons}
        initialConfigVersion={config.configVersion}
      />
    </>
  );
}
