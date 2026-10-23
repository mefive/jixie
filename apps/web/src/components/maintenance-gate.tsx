import { Spin } from 'antd';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { maintenanceStore } from '@src/store';
import './maintenance-gate.css';

/**
 * 根据维护状态展示可用性门禁，并处理服务恢复与部署刷新。
 *
 * Gate application availability during maintenance and handle recovery and deployment refresh.
 */
export const MaintenanceGate = observer(() => {
  const { t } = useTranslation('common');
  const status = maintenanceStore.status;
  const serviceUnavailable = maintenanceStore.serviceUnavailable;
  if (!status?.active && !serviceUnavailable) {
    return null;
  }

  const stage = serviceUnavailable
    ? t('maintenance.stages.reconnecting')
    : t('maintenance.stages.publishing');

  return (
    <div className="jx-maintenanceGate">
      <section className="jx-maintenanceGate-card" aria-live="polite">
        <Spin size="large" />
        <div className="jx-maintenanceGate-copy">
          <h1 className="jx-maintenanceGate-title">
            {serviceUnavailable ? t('maintenance.serviceUnavailableTitle') : t('maintenance.title')}
          </h1>
          <p className="jx-maintenanceGate-description">
            {serviceUnavailable
              ? t('maintenance.serviceUnavailableDescription')
              : status.error
                ? t('maintenance.retrying')
                : status.kind === 'deploy'
                  ? t('maintenance.deploymentDescription')
                  : t('maintenance.description')}
          </p>
        </div>
        <dl className="jx-maintenanceGate-details">
          <div className="jx-maintenanceGate-detail">
            <dt className="jx-maintenanceGate-detailLabel">{t('maintenance.stage')}</dt>
            <dd className="jx-maintenanceGate-detailValue">{stage}</dd>
          </div>
        </dl>
        <p className="jx-maintenanceGate-footnote">{t('maintenance.returnNote')}</p>
      </section>
    </div>
  );
});
