import { Progress, Spin } from 'antd';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { maintenanceStore } from '@src/store';
import './maintenance-gate.css';

export const MaintenanceGate = observer(() => {
  const { t } = useTranslation('common');
  const status = maintenanceStore.status;
  const serviceUnavailable = maintenanceStore.serviceUnavailable;
  if (!status?.active && !serviceUnavailable) {
    return null;
  }

  const percent =
    (status?.totalDates ?? 0) > 0
      ? Math.min(100, Math.round((status.completedDates / status.totalDates) * 100))
      : 0;
  const stage = serviceUnavailable
    ? t('maintenance.stages.reconnecting')
    : status?.stage
      ? t(`maintenance.stages.${status.stage}`, { defaultValue: status.stage })
      : t('maintenance.preparing');

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
        {!serviceUnavailable && status.totalDates > 0 && (
          <Progress className="jx-maintenanceGate-progress" percent={percent} showInfo={false} />
        )}
        <dl className="jx-maintenanceGate-details">
          <div className="jx-maintenanceGate-detail">
            <dt className="jx-maintenanceGate-detailLabel">{t('maintenance.stage')}</dt>
            <dd className="jx-maintenanceGate-detailValue">{stage}</dd>
          </div>
          {!serviceUnavailable && status.lastSuccessfulDailyDate && (
            <div className="jx-maintenanceGate-detail">
              <dt className="jx-maintenanceGate-detailLabel">
                {t('maintenance.availableThrough')}
              </dt>
              <dd className="jx-maintenanceGate-detailValue">{status.lastSuccessfulDailyDate}</dd>
            </div>
          )}
          {!serviceUnavailable && status.totalDates > 0 && (
            <div className="jx-maintenanceGate-detail">
              <dt className="jx-maintenanceGate-detailLabel">{t('maintenance.progress')}</dt>
              <dd className="jx-maintenanceGate-detailValue">
                {status.completedDates} / {status.totalDates}
              </dd>
            </div>
          )}
        </dl>
        <p className="jx-maintenanceGate-footnote">{t('maintenance.returnNote')}</p>
      </section>
    </div>
  );
});
