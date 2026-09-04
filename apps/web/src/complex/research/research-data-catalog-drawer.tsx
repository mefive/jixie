import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { RESEARCH_FINANCIAL_METRICS_V1 } from '@jixie/shared';
import type {
  ResearchAssetTypeV1,
  ResearchDataCatalogBacktestReportV1,
  ResearchDataCatalogDatasetV1,
  ResearchDataCatalogFactorReportV1,
  ResearchDataCatalogFactorWeatherV1,
  ResearchDataCatalogInstrumentV1,
  ResearchDataCatalogSdkMethodV1,
  ResearchDataCatalogStrategyScanReportV1,
  ResearchDataCatalogScopeV1,
  ResearchFinancialMetricV1,
  ResearchFrequencyV1,
  ResearchTransformV1,
} from '@jixie/shared';
import {
  faArrowRightToBracket,
  faChartLine,
  faCircleCheck,
  faCircleExclamation,
  faDatabase,
  faFileLines,
  faGaugeHigh,
  faLayerGroup,
  faLock,
  faMagnifyingGlass,
  faPercent,
  faTableColumns,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoadingArea } from '@src/components/loading-area';
import { complex } from './complex';
import {
  researchBacktestReportSnippet,
  researchDatasetSnippet,
  researchFactorReportSnippet,
  researchFactorWeatherSnippet,
  researchSeriesSnippet,
  researchStrategyScanReportSnippet,
} from './research-data-catalog';
import { insertResearchPythonSnippet } from './research-python-language';
import './research-data-catalog-drawer.css';

interface ResearchDataCatalogDrawerProps {
  open: boolean;
  onClose: () => void;
}

type AssetFilter = 'all' | ResearchAssetTypeV1;
type CatalogView = ResearchDataCatalogScopeV1;

export const ResearchDataCatalogDrawer = complex.component(
  ({ open, onClose }: ResearchDataCatalogDrawerProps) => {
    const store = complex.useStore();
    const { message } = App.useApp();
    const { t, i18n } = useTranslation('research');
    const [view, setView] = useState<CatalogView>('instruments');
    const [query, setQuery] = useState('');
    const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
    const [selected, setSelected] = useState<ResearchDataCatalogInstrumentV1 | null>(null);
    const [selectedDataset, setSelectedDataset] = useState<ResearchDataCatalogDatasetV1 | null>(
      null,
    );
    const [selectedReport, setSelectedReport] = useState<ResearchDataCatalogFactorReportV1 | null>(
      null,
    );
    const [selectedBacktestReport, setSelectedBacktestReport] =
      useState<ResearchDataCatalogBacktestReportV1 | null>(null);
    const [selectedFactorWeather, setSelectedFactorWeather] =
      useState<ResearchDataCatalogFactorWeatherV1 | null>(null);
    const [selectedStrategyScan, setSelectedStrategyScan] =
      useState<ResearchDataCatalogStrategyScanReportV1 | null>(null);
    const [selectedMethodName, setSelectedMethodName] = useState<string | null>(null);
    const [measureId, setMeasureId] = useState('market.adjusted_close');
    const [frequency, setFrequency] = useState<ResearchFrequencyV1>('daily');
    const [transform, setTransform] = useState<ResearchTransformV1>('level');
    const [financialIdentifier, setFinancialIdentifier] = useState('000858.SZ');
    const [financialMetrics, setFinancialMetrics] = useState<ResearchFinancialMetricV1[]>([
      'revenueGrowthYoY',
      'returnOnInvestedCapital',
      'freeCashFlowToFirm',
      'enterpriseValue',
    ]);
    const [dates, setDates] = useState<[Dayjs, Dayjs]>([dayjs().subtract(5, 'year'), dayjs()]);

    useEffect(() => {
      if (!open) {
        return undefined;
      }
      const timer = window.setTimeout(
        () => {
          void store.searchDataCatalog(
            query,
            view === 'instruments' && assetFilter !== 'all' ? assetFilter : undefined,
            view,
          );
        },
        query ? 180 : 0,
      );
      return () => window.clearTimeout(timer);
    }, [assetFilter, open, query, store, view]);

    const catalog = store.dataCatalogLoader.result;
    const selectedMethod = catalog?.sdkMethods.find(
      (method) => method.qualifiedName === selectedMethodName,
    );
    const visibleInstruments = useMemo(
      () => rankCatalogInstruments(catalog?.instruments ?? [], query),
      [catalog?.instruments, query],
    );
    const compatibleMeasures = useMemo(
      () =>
        (catalog?.measures ?? []).filter(
          (measure) => !selected || selected.compatibleMeasureIds.includes(measure.id),
        ),
      [catalog?.measures, selected],
    );
    const selectedMeasure = compatibleMeasures.find((measure) => measure.id === measureId);
    useEffect(() => {
      if (selectedMeasure && !selectedMeasure.transforms.includes(transform)) {
        setTransform(selectedMeasure.transforms[0] ?? 'level');
      }
    }, [selectedMeasure, transform]);
    const snippet =
      view === 'backtest_reports'
        ? selectedStrategyScan
          ? researchStrategyScanReportSnippet(selectedStrategyScan)
          : selectedBacktestReport
            ? researchBacktestReportSnippet(selectedBacktestReport)
            : ''
        : view === 'factor_reports'
          ? selectedFactorWeather
            ? researchFactorWeatherSnippet(selectedFactorWeather)
            : selectedReport && !selectedReport.sealed
              ? researchFactorReportSnippet(selectedReport)
              : ''
          : view === 'datasets'
            ? selectedDataset &&
              selectedDataset.localDataCoverage.status === 'ready' &&
              (!isSingleStockFinancialDataset(selectedDataset) || financialIdentifier) &&
              (!isFinancialUniverseDataset(selectedDataset) || financialMetrics.length > 0)
              ? researchDatasetSnippet({
                  dataset: selectedDataset,
                  start: dates[0].format('YYYYMMDD'),
                  end: dates[1].format('YYYYMMDD'),
                  identifier: financialIdentifier,
                  metrics: financialMetrics,
                })
              : ''
            : selected && measureId && selected.sdkAccess?.status !== 'not_ready'
              ? researchSeriesSnippet({
                  instrument: selected,
                  measure: measureId,
                  start: dates[0].format('YYYYMMDD'),
                  end: dates[1].format('YYYYMMDD'),
                  frequency,
                  transform,
                })
              : '';

    const chooseInstrument = (instrument: ResearchDataCatalogInstrumentV1) => {
      setSelected(instrument);
      if (!instrument.compatibleMeasureIds.includes(measureId)) {
        setMeasureId(instrument.compatibleMeasureIds[0] ?? 'market.adjusted_close');
      }
      if (instrument.localDataCoverage?.status === 'ready') {
        const coverageStart = catalogDate(instrument.localDataCoverage.startDate);
        const coverageEnd = catalogDate(instrument.localDataCoverage.endDate);
        const preferredStart = coverageEnd.subtract(5, 'year');
        setDates([
          preferredStart.isBefore(coverageStart) ? coverageStart : preferredStart,
          coverageEnd,
        ]);
      }
    };
    const chooseDataset = (dataset: ResearchDataCatalogDatasetV1) => {
      setSelectedDataset(dataset);
      if (isSingleStockFinancialDataset(dataset)) {
        setFinancialIdentifier(dataset.identifier);
      }
      if (dataset.localDataCoverage.status === 'ready') {
        const coverageStart = catalogDate(dataset.localDataCoverage.startDate);
        const coverageEnd = catalogDate(dataset.localDataCoverage.endDate);
        const preferredStart = coverageEnd.subtract(5, 'year');
        setDates([
          preferredStart.isBefore(coverageStart) ? coverageStart : preferredStart,
          coverageEnd,
        ]);
      }
    };
    const insert = () => {
      if (!store.documentId || !snippet) {
        return;
      }
      const documentId = store.documentId;
      onClose();
      window.setTimeout(async () => {
        if (insertResearchPythonSnippet(documentId, snippet)) {
          await store.flushPendingChanges();
          void message.success(t('dataCatalog.inserted'));
        } else {
          void message.warning(t('dataCatalog.noPythonCell'));
        }
      }, 120);
    };

    return (
      <Drawer
        className="jx-researchDataCatalog"
        width={460}
        open={open}
        onClose={onClose}
        title={
          <span className="jx-researchDataCatalog-title">
            <FontAwesomeIcon icon={faDatabase} /> {t('dataCatalog.title')}
          </span>
        }
        extra={
          <Tooltip title={t('dataCatalog.insert')}>
            <Button
              type="primary"
              shape="circle"
              disabled={!snippet}
              icon={<FontAwesomeIcon icon={faArrowRightToBracket} />}
              aria-label={t('dataCatalog.insert')}
              data-testid="research-data-catalog-insert"
              onClick={insert}
            />
          </Tooltip>
        }
      >
        <p className="jx-researchDataCatalog-intro">{t('dataCatalog.intro')}</p>
        <Segmented<CatalogView>
          block
          className="jx-researchDataCatalog-views"
          value={view}
          options={(['instruments', 'datasets', 'factor_reports', 'backtest_reports'] as const).map(
            (value) => ({
              value,
              label: t(`dataCatalog.view.${value}`),
            }),
          )}
          onChange={(value) => {
            setView(value);
            setQuery('');
            setSelected(null);
            setSelectedDataset(null);
            setSelectedReport(null);
            setSelectedBacktestReport(null);
            setSelectedFactorWeather(null);
            setSelectedStrategyScan(null);
            setSelectedMethodName(null);
          }}
        />
        <section
          className="jx-researchDataCatalog-capabilities"
          data-testid="research-data-catalog-capabilities"
        >
          <div className="jx-researchDataCatalog-sectionHead">
            <strong>{t('dataCatalog.capabilities')}</strong>
            <span>{t('dataCatalog.runtime', { version: 'research-py-v1' })}</span>
          </div>
          <div className="jx-researchDataCatalog-methods">
            {(catalog?.sdkMethods ?? []).map((method) => (
              <button
                key={method.qualifiedName}
                type="button"
                className={classNames('jx-researchDataCatalog-method', {
                  'jx-researchDataCatalog-method--active':
                    selectedMethod?.qualifiedName === method.qualifiedName,
                })}
                aria-expanded={selectedMethod?.qualifiedName === method.qualifiedName}
                data-testid={`research-data-catalog-method-${method.name}`}
                onClick={() =>
                  setSelectedMethodName((value) =>
                    value === method.qualifiedName ? null : method.qualifiedName,
                  )
                }
              >
                <span className="jx-researchDataCatalog-methodIcon">
                  <FontAwesomeIcon icon={researchDataMethodIcon(method.qualifiedName)} />
                </span>
                <span className="jx-researchDataCatalog-methodText">
                  <code>{method.qualifiedName}</code>
                  <span>{localizedMethodDescription(method, i18n.language)}</span>
                </span>
              </button>
            ))}
          </div>
          {selectedMethod && (
            <div
              className="jx-researchDataCatalog-methodDetail"
              data-testid="research-data-catalog-method-detail"
            >
              <div className="jx-researchDataCatalog-methodStatus">
                <span>
                  <FontAwesomeIcon icon={faCircleCheck} /> {t('dataCatalog.sdkReady')}
                </span>
                <code>{selectedMethod.signature}</code>
              </div>
              {selectedMethod.returnColumns.length > 0 && (
                <div className="jx-researchDataCatalog-methodMeta">
                  <span>{t('dataCatalog.returns')}</span>
                  <div>
                    {selectedMethod.returnColumnDetails.map((column) => (
                      <Tooltip
                        key={column.name}
                        title={localizedColumnDescription(column, i18n.language)}
                      >
                        <Tag>{column.name}</Tag>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}
              <div className="jx-researchDataCatalog-methodExample">
                <span>{t('dataCatalog.example')}</span>
                <pre>{selectedMethod.example}</pre>
              </div>
            </div>
          )}
        </section>

        <Input
          allowClear
          autoFocus
          value={query}
          prefix={<FontAwesomeIcon icon={faMagnifyingGlass} />}
          placeholder={t(dataCatalogSearchPlaceholder(view))}
          aria-label={t(dataCatalogSearchPlaceholder(view))}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
            setSelectedDataset(null);
            setSelectedReport(null);
            setSelectedBacktestReport(null);
            setSelectedFactorWeather(null);
            setSelectedStrategyScan(null);
          }}
        />
        {view === 'instruments' && (
          <Segmented<AssetFilter>
            block
            className="jx-researchDataCatalog-assets"
            value={assetFilter}
            options={(['all', 'stock', 'etf', 'index', 'future'] as const).map((value) => ({
              value,
              label: t(`dataCatalog.assetType.${value}`),
            }))}
            onChange={(value) => setAssetFilter(value)}
          />
        )}

        {view === 'instruments' ? (
          <>
            <section className="jx-researchDataCatalog-section">
              <div className="jx-researchDataCatalog-sectionHead">
                <strong>{t('dataCatalog.instruments')}</strong>
                {catalog && query && (
                  <span>{t('dataCatalog.matches', { count: visibleInstruments.length })}</span>
                )}
              </div>
              <LoadingArea
                loader={store.dataCatalogLoader}
                showDelay={120}
                loading={() => (
                  <div className="jx-researchDataCatalog-skeleton">
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                  </div>
                )}
              >
                {!query ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('dataCatalog.searchHint')}
                  />
                ) : visibleInstruments.length ? (
                  <div className="jx-researchDataCatalog-results">
                    {visibleInstruments.map((instrument) => (
                      <button
                        key={`${instrument.assetType}:${instrument.identifier}`}
                        type="button"
                        className={classNames('jx-researchDataCatalog-result', {
                          'jx-researchDataCatalog-result--active':
                            selected?.assetType === instrument.assetType &&
                            selected.identifier === instrument.identifier,
                        })}
                        data-testid={`research-data-catalog-result-${instrument.identifier}`}
                        onClick={() => chooseInstrument(instrument)}
                      >
                        <span className="jx-researchDataCatalog-resultIcon">
                          <FontAwesomeIcon icon={faChartLine} />
                        </span>
                        <span className="jx-researchDataCatalog-resultText">
                          <strong>{localizedInstrumentName(instrument, i18n.language)}</strong>
                          <code>{instrument.identifier}</code>
                          <span
                            className={classNames('jx-researchDataCatalog-coverage', {
                              'jx-researchDataCatalog-coverage--missing':
                                instrument.localDataCoverage?.status === 'missing',
                            })}
                            data-testid={`research-data-catalog-coverage-${instrument.identifier}`}
                          >
                            <FontAwesomeIcon
                              icon={
                                instrument.localDataCoverage?.status === 'ready'
                                  ? faCircleCheck
                                  : faCircleExclamation
                              }
                            />
                            {localizedCoverage(instrument, i18n.language, t)}
                          </span>
                        </span>
                        <span className="jx-researchDataCatalog-resultTags">
                          <Tag>{t(`dataCatalog.assetType.${instrument.assetType}`)}</Tag>
                          {instrument.researchRegistry && (
                            <Tag>
                              {t(`dataCatalog.registryRole.${instrument.researchRegistry.role}`)}
                            </Tag>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('dataCatalog.noMatches')}
                  />
                )}
              </LoadingArea>
            </section>

            {selected && (
              <section
                className="jx-researchDataCatalog-config"
                data-testid="research-data-catalog-config"
              >
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.seriesConfig')}</strong>
                  <code>{selected.identifier}</code>
                </div>
                <div className="jx-researchDataCatalog-selectedMeta">
                  <div>
                    <span>{t('dataCatalog.localCoverage')}</span>
                    <strong>{localizedCoverage(selected, i18n.language, t)}</strong>
                  </div>
                  {selected.researchRegistry && (
                    <div>
                      <span>{t('dataCatalog.registryExposure')}</span>
                      <strong>
                        {selected.researchRegistry.exposureId} ·{' '}
                        {t(`dataCatalog.registryRole.${selected.researchRegistry.role}`)}
                      </strong>
                    </div>
                  )}
                  {selected.researchRegistry &&
                    selected.researchRegistry.knownLimitations.length > 0 && (
                      <p>
                        {t('dataCatalog.registryLimitations', {
                          count: selected.researchRegistry.knownLimitations.length,
                        })}
                      </p>
                    )}
                </div>
                <label>
                  <span>{t('dataCatalog.measure')}</span>
                  <Select
                    value={measureId}
                    options={compatibleMeasures.map((measure) => ({
                      value: measure.id,
                      label: `${i18n.language.startsWith('zh') ? measure.nameZh : measure.nameEn} · ${measure.id}`,
                    }))}
                    onChange={setMeasureId}
                  />
                </label>
                <label>
                  <span>{t('dataCatalog.period')}</span>
                  <DatePicker.RangePicker
                    allowClear={false}
                    value={dates}
                    onChange={(value) => {
                      if (value?.[0] && value[1]) {
                        setDates([value[0], value[1]]);
                      }
                    }}
                  />
                </label>
                <div className="jx-researchDataCatalog-configRow">
                  <label>
                    <span>{t('dataCatalog.frequency')}</span>
                    <Select
                      value={frequency}
                      options={(['daily', 'monthly'] as const).map((value) => ({
                        value,
                        label: t(`frequency.${value}`),
                      }))}
                      onChange={setFrequency}
                    />
                  </label>
                  <label>
                    <span>{t('dataCatalog.transform')}</span>
                    <Select
                      value={transform}
                      options={(selectedMeasure?.transforms ?? ['level']).map((value) => ({
                        value,
                        label: t(`transform.${value}`),
                      }))}
                      onChange={setTransform}
                    />
                  </label>
                </div>
                <pre className="jx-researchDataCatalog-preview">{snippet}</pre>
              </section>
            )}
          </>
        ) : view === 'datasets' ? (
          <>
            <section className="jx-researchDataCatalog-section">
              <div className="jx-researchDataCatalog-sectionHead">
                <strong>{t('dataCatalog.datasets')}</strong>
                {catalog && (
                  <span>{t('dataCatalog.matches', { count: catalog.datasets.length })}</span>
                )}
              </div>
              <LoadingArea
                loader={store.dataCatalogLoader}
                showDelay={120}
                loading={() => (
                  <div className="jx-researchDataCatalog-skeleton">
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                  </div>
                )}
              >
                {(catalog?.datasets ?? []).length ? (
                  <div className="jx-researchDataCatalog-results">
                    {(catalog?.datasets ?? []).map((dataset) => (
                      <button
                        key={dataset.id}
                        type="button"
                        className={classNames('jx-researchDataCatalog-result', {
                          'jx-researchDataCatalog-result--active':
                            selectedDataset?.id === dataset.id,
                        })}
                        data-testid={`research-data-catalog-dataset-${dataset.id}`}
                        onClick={() => chooseDataset(dataset)}
                      >
                        <span className="jx-researchDataCatalog-resultIcon">
                          <FontAwesomeIcon icon={researchDataMethodIcon(dataset.method)} />
                        </span>
                        <span className="jx-researchDataCatalog-resultText">
                          <strong>{localizedDatasetName(dataset, i18n.language)}</strong>
                          <code>{dataset.method}</code>
                          <span
                            className={classNames('jx-researchDataCatalog-coverage', {
                              'jx-researchDataCatalog-coverage--missing':
                                dataset.localDataCoverage.status === 'missing',
                            })}
                          >
                            <FontAwesomeIcon
                              icon={
                                dataset.localDataCoverage.status === 'ready'
                                  ? faCircleCheck
                                  : faCircleExclamation
                              }
                            />
                            {localizedDatasetCoverage(dataset, t)}
                          </span>
                        </span>
                        <span className="jx-researchDataCatalog-resultTags">
                          <Tag>{datasetMethodTag(dataset.method)}</Tag>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('dataCatalog.noDatasetMatches')}
                  />
                )}
              </LoadingArea>
            </section>

            {selectedDataset && (
              <section
                className="jx-researchDataCatalog-config"
                data-testid="research-data-catalog-dataset-config"
              >
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.datasetConfig')}</strong>
                  <code>{selectedDataset.method}</code>
                </div>
                <div className="jx-researchDataCatalog-selectedMeta">
                  <div>
                    <span>{t('dataCatalog.dataset')}</span>
                    <strong>{localizedDatasetName(selectedDataset, i18n.language)}</strong>
                  </div>
                  <div>
                    <span>{t('dataCatalog.localCoverage')}</span>
                    <strong>{localizedDatasetCoverage(selectedDataset, t)}</strong>
                  </div>
                  <p>{localizedDatasetDescription(selectedDataset, i18n.language)}</p>
                </div>
                {isSingleStockFinancialDataset(selectedDataset) && (
                  <label>
                    <span>{t('dataCatalog.stockCode')}</span>
                    <Input
                      value={financialIdentifier}
                      maxLength={20}
                      onChange={(event) => setFinancialIdentifier(event.target.value.trim())}
                    />
                  </label>
                )}
                {isFinancialUniverseDataset(selectedDataset) && (
                  <label>
                    <span>{t('dataCatalog.financialMetrics')}</span>
                    <Select<ResearchFinancialMetricV1[]>
                      mode="multiple"
                      className="jx-researchDataCatalog-fullControl"
                      maxCount={8}
                      value={financialMetrics}
                      options={RESEARCH_FINANCIAL_METRICS_V1.map((metric) => ({
                        value: metric,
                        label: metric,
                      }))}
                      onChange={setFinancialMetrics}
                    />
                  </label>
                )}
                <label>
                  <span>
                    {isSingleDateDataset(selectedDataset)
                      ? t('dataCatalog.asOfDate')
                      : t('dataCatalog.period')}
                  </span>
                  {isSingleDateDataset(selectedDataset) ? (
                    <DatePicker
                      allowClear={false}
                      value={dates[1]}
                      onChange={(value) => value && setDates([dates[0], value])}
                    />
                  ) : (
                    <DatePicker.RangePicker
                      allowClear={false}
                      value={dates}
                      onChange={(value) => {
                        if (value?.[0] && value[1]) {
                          setDates([value[0], value[1]]);
                        }
                      }}
                    />
                  )}
                </label>
                <pre className="jx-researchDataCatalog-preview">{snippet}</pre>
              </section>
            )}
          </>
        ) : view === 'factor_reports' ? (
          <>
            <section className="jx-researchDataCatalog-section">
              <div className="jx-researchDataCatalog-sectionHead">
                <strong>{t('dataCatalog.factorReports')}</strong>
                {catalog && (
                  <span>{t('dataCatalog.matches', { count: catalog.factorReports.length })}</span>
                )}
              </div>
              <LoadingArea
                loader={store.dataCatalogLoader}
                showDelay={120}
                loading={() => (
                  <div className="jx-researchDataCatalog-skeleton">
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                  </div>
                )}
              >
                {(catalog?.factorReports ?? []).length ? (
                  <div className="jx-researchDataCatalog-results">
                    {(catalog?.factorReports ?? []).map((report) => (
                      <button
                        key={report.id}
                        type="button"
                        className={classNames('jx-researchDataCatalog-result', {
                          'jx-researchDataCatalog-result--active': selectedReport?.id === report.id,
                          'jx-researchDataCatalog-result--sealed': report.sealed,
                        })}
                        data-testid={`research-data-catalog-report-${report.id}`}
                        onClick={() => {
                          setSelectedReport(report);
                          setSelectedFactorWeather(null);
                        }}
                      >
                        <span className="jx-researchDataCatalog-resultIcon">
                          <FontAwesomeIcon icon={report.sealed ? faLock : faFileLines} />
                        </span>
                        <span className="jx-researchDataCatalog-resultText">
                          <strong>{report.factorName}</strong>
                          <code>{report.factor}</code>
                          <span className="jx-researchDataCatalog-reportDate">
                            {dayjs(report.computedAt ?? report.createdAt).format('YYYY-MM-DD')}
                          </span>
                        </span>
                        <span className="jx-researchDataCatalog-resultTags">
                          <Tag>{t(`dataCatalog.reportPhase.${report.phase}`)}</Tag>
                          <Tag>{t(`dataCatalog.analysisKind.${report.analysisKind}`)}</Tag>
                          {report.sealed && <Tag color="gold">{t('dataCatalog.sealed')}</Tag>}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t(
                      query ? 'dataCatalog.noReportMatches' : 'dataCatalog.noFactorReports',
                    )}
                  />
                )}
              </LoadingArea>
            </section>

            {selectedReport && (
              <section
                className="jx-researchDataCatalog-config"
                data-testid="research-data-catalog-report-config"
              >
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.reportConfig')}</strong>
                  <code>{selectedReport.id}</code>
                </div>
                <div className="jx-researchDataCatalog-selectedMeta">
                  <div>
                    <span>{t('dataCatalog.factor')}</span>
                    <strong>
                      {selectedReport.factorName} · {selectedReport.factor}
                    </strong>
                  </div>
                  <div>
                    <span>{t('dataCatalog.analysis')}</span>
                    <strong>
                      {t(`dataCatalog.analysisKind.${selectedReport.analysisKind}`)} ·{' '}
                      {t(`dataCatalog.reportPhase.${selectedReport.phase}`)}
                    </strong>
                  </div>
                  <div>
                    <span>{t('dataCatalog.reportDate')}</span>
                    <strong>
                      {dayjs(selectedReport.computedAt ?? selectedReport.createdAt).format(
                        'YYYY-MM-DD HH:mm',
                      )}
                    </strong>
                  </div>
                  {selectedReport.sealed && (
                    <p className="jx-researchDataCatalog-sealedNotice">
                      <FontAwesomeIcon icon={faLock} /> {t('dataCatalog.sealedHint')}
                    </p>
                  )}
                </div>
                {!selectedReport.sealed && (
                  <pre className="jx-researchDataCatalog-preview">{snippet}</pre>
                )}
              </section>
            )}

            {(catalog?.factorWeather ?? []).length > 0 && (
              <section className="jx-researchDataCatalog-section">
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.factorWeather')}</strong>
                  <span>{t('dataCatalog.matches', { count: catalog?.factorWeather.length })}</span>
                </div>
                <div className="jx-researchDataCatalog-results">
                  {(catalog?.factorWeather ?? []).map((weather) => (
                    <button
                      key={weather.factorId}
                      type="button"
                      className={classNames('jx-researchDataCatalog-result', {
                        'jx-researchDataCatalog-result--active':
                          selectedFactorWeather?.factorId === weather.factorId,
                      })}
                      data-testid={`research-data-catalog-factor-weather-${weather.factorId}`}
                      onClick={() => {
                        setSelectedFactorWeather(weather);
                        setSelectedReport(null);
                      }}
                    >
                      <span className="jx-researchDataCatalog-resultIcon">
                        <FontAwesomeIcon icon={faChartLine} />
                      </span>
                      <span className="jx-researchDataCatalog-resultText">
                        <strong>{weather.factorName}</strong>
                        <code>{weather.factorId}</code>
                        <span className="jx-researchDataCatalog-reportDate">
                          {weather.computedThrough
                            ? formatCatalogDate(weather.computedThrough)
                            : t('dataCatalog.noComputedThrough')}
                        </span>
                      </span>
                      <span className="jx-researchDataCatalog-resultTags">
                        <Tag>{weather.direction}</Tag>
                        <Tag>{t('dataCatalog.weatherPoints', { count: weather.pointCount })}</Tag>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {selectedFactorWeather && (
              <section
                className="jx-researchDataCatalog-config"
                data-testid="research-data-catalog-factor-weather-config"
              >
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.factorWeather')}</strong>
                  <code>{selectedFactorWeather.factorId}</code>
                </div>
                <pre className="jx-researchDataCatalog-preview">{snippet}</pre>
              </section>
            )}
          </>
        ) : (
          <>
            <section className="jx-researchDataCatalog-section">
              <div className="jx-researchDataCatalog-sectionHead">
                <strong>{t('dataCatalog.backtestReports')}</strong>
                {catalog && (
                  <span>{t('dataCatalog.matches', { count: catalog.backtestReports.length })}</span>
                )}
              </div>
              <LoadingArea
                loader={store.dataCatalogLoader}
                showDelay={120}
                loading={() => (
                  <div className="jx-researchDataCatalog-skeleton">
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                  </div>
                )}
              >
                {(catalog?.backtestReports ?? []).length ? (
                  <div className="jx-researchDataCatalog-results">
                    {(catalog?.backtestReports ?? []).map((report) => (
                      <button
                        key={report.id}
                        type="button"
                        className={classNames('jx-researchDataCatalog-result', {
                          'jx-researchDataCatalog-result--active':
                            selectedBacktestReport?.id === report.id,
                        })}
                        data-testid={`research-data-catalog-backtest-report-${report.id}`}
                        onClick={() => {
                          setSelectedBacktestReport(report);
                          setSelectedStrategyScan(null);
                        }}
                      >
                        <span className="jx-researchDataCatalog-resultIcon">
                          <FontAwesomeIcon icon={faGaugeHigh} />
                        </span>
                        <span className="jx-researchDataCatalog-resultText">
                          <strong>{report.strategyName}</strong>
                          <code>{report.id}</code>
                          <span className="jx-researchDataCatalog-reportDate">
                            {formatCatalogRange(report.start, report.end)}
                          </span>
                        </span>
                        <span className="jx-researchDataCatalog-resultTags">
                          <Tag>{t(`dataCatalog.strategyLanguage.${report.language}`)}</Tag>
                          <Tag>
                            {dayjs(report.computedAt ?? report.createdAt).format('YYYY-MM-DD')}
                          </Tag>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t(
                      query
                        ? 'dataCatalog.noBacktestReportMatches'
                        : 'dataCatalog.noBacktestReports',
                    )}
                  />
                )}
              </LoadingArea>
            </section>

            {selectedBacktestReport && (
              <section
                className="jx-researchDataCatalog-config"
                data-testid="research-data-catalog-backtest-report-config"
              >
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.backtestReportConfig')}</strong>
                  <code>{selectedBacktestReport.id}</code>
                </div>
                <div className="jx-researchDataCatalog-selectedMeta">
                  <div>
                    <span>{t('dataCatalog.strategy')}</span>
                    <strong>{selectedBacktestReport.strategyName}</strong>
                  </div>
                  <div>
                    <span>{t('dataCatalog.period')}</span>
                    <strong>
                      {formatCatalogRange(selectedBacktestReport.start, selectedBacktestReport.end)}
                    </strong>
                  </div>
                  <div>
                    <span>{t('dataCatalog.runtimeLanguage')}</span>
                    <strong>
                      {t(`dataCatalog.strategyLanguage.${selectedBacktestReport.language}`)}
                    </strong>
                  </div>
                  <div>
                    <span>{t('dataCatalog.reportDate')}</span>
                    <strong>
                      {dayjs(
                        selectedBacktestReport.computedAt ?? selectedBacktestReport.createdAt,
                      ).format('YYYY-MM-DD HH:mm')}
                    </strong>
                  </div>
                </div>
                <pre className="jx-researchDataCatalog-preview">{snippet}</pre>
              </section>
            )}

            {(catalog?.strategyScanReports ?? []).length > 0 && (
              <section className="jx-researchDataCatalog-section">
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.strategyScans')}</strong>
                  <span>
                    {t('dataCatalog.matches', { count: catalog?.strategyScanReports.length })}
                  </span>
                </div>
                <div className="jx-researchDataCatalog-results">
                  {(catalog?.strategyScanReports ?? []).map((report) => (
                    <button
                      key={report.id}
                      type="button"
                      className={classNames('jx-researchDataCatalog-result', {
                        'jx-researchDataCatalog-result--active':
                          selectedStrategyScan?.id === report.id,
                      })}
                      data-testid={`research-data-catalog-strategy-scan-${report.id}`}
                      onClick={() => {
                        setSelectedStrategyScan(report);
                        setSelectedBacktestReport(null);
                      }}
                    >
                      <span className="jx-researchDataCatalog-resultIcon">
                        <FontAwesomeIcon icon={faGaugeHigh} />
                      </span>
                      <span className="jx-researchDataCatalog-resultText">
                        <strong>{report.strategyName}</strong>
                        <code>{report.id}</code>
                        <span className="jx-researchDataCatalog-reportDate">
                          {dayjs(report.updatedAt).format('YYYY-MM-DD')}
                        </span>
                      </span>
                      <span className="jx-researchDataCatalog-resultTags">
                        {report.parameterNames.map((parameter) => (
                          <Tag key={parameter}>{parameter}</Tag>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {selectedStrategyScan && (
              <section
                className="jx-researchDataCatalog-config"
                data-testid="research-data-catalog-strategy-scan-config"
              >
                <div className="jx-researchDataCatalog-sectionHead">
                  <strong>{t('dataCatalog.strategyScans')}</strong>
                  <code>{selectedStrategyScan.id}</code>
                </div>
                <pre className="jx-researchDataCatalog-preview">{snippet}</pre>
              </section>
            )}
          </>
        )}
      </Drawer>
    );
  },
  'ResearchDataCatalogDrawer',
);

type SingleStockFinancialDataset = ResearchDataCatalogDatasetV1 & {
  method: 'data.equity_financial_statements' | 'data.equity_financial_metrics';
  identifier: string;
};

type FinancialUniverseDataset = ResearchDataCatalogDatasetV1 & {
  method: 'data.equity_financial_cross_section' | 'data.equity_financial_panel';
  universe: string;
};

function isSingleStockFinancialDataset(
  dataset: ResearchDataCatalogDatasetV1,
): dataset is SingleStockFinancialDataset {
  return (
    dataset.method === 'data.equity_financial_statements' ||
    dataset.method === 'data.equity_financial_metrics'
  );
}

function isFinancialUniverseDataset(
  dataset: ResearchDataCatalogDatasetV1,
): dataset is FinancialUniverseDataset {
  return (
    dataset.method === 'data.equity_financial_cross_section' ||
    dataset.method === 'data.equity_financial_panel'
  );
}

function isSingleDateDataset(dataset: ResearchDataCatalogDatasetV1): boolean {
  return (
    dataset.method === 'data.cross_section' ||
    dataset.method === 'data.equity_financial_statements' ||
    dataset.method === 'data.equity_financial_metrics' ||
    dataset.method === 'data.equity_financial_cross_section'
  );
}

function localizedInstrumentName(
  instrument: ResearchDataCatalogInstrumentV1,
  language: string,
): string {
  return language.startsWith('zh') ? instrument.nameZh : (instrument.nameEn ?? instrument.nameZh);
}

function localizedDatasetName(dataset: ResearchDataCatalogDatasetV1, language: string): string {
  return language.startsWith('zh') ? dataset.nameZh : dataset.nameEn;
}

function datasetMethodTag(method: ResearchDataCatalogDatasetV1['method']): string {
  switch (method) {
    case 'data.commodity_returns':
      return 'returns';
    case 'data.commodity_warehouse_receipts':
      return 'receipts';
    case 'data.commodity_holdings':
      return 'holdings';
    default:
      return method.replace('data.', '');
  }
}

function localizedDatasetDescription(
  dataset: ResearchDataCatalogDatasetV1,
  language: string,
): string {
  return language.startsWith('zh') ? dataset.descriptionZh : dataset.descriptionEn;
}

function localizedMethodDescription(
  method: ResearchDataCatalogSdkMethodV1,
  language: string,
): string {
  return language.startsWith('zh') ? method.descriptionZh : method.descriptionEn;
}

function localizedColumnDescription(
  column: ResearchDataCatalogSdkMethodV1['returnColumnDetails'][number],
  language: string,
): string {
  return language.startsWith('zh') ? column.descriptionZh : column.descriptionEn;
}

function researchDataMethodIcon(qualifiedName: string) {
  switch (qualifiedName) {
    case 'results.backtest_report':
      return faGaugeHigh;
    case 'results.factor_report':
      return faFileLines;
    case 'data.cross_section':
    case 'data.equity_financial_cross_section':
      return faTableColumns;
    case 'data.panel':
    case 'data.equity_financial_panel':
      return faLayerGroup;
    case 'data.yield_curve':
      return faPercent;
    default:
      return faChartLine;
  }
}

function dataCatalogSearchPlaceholder(
  view: CatalogView,
):
  | 'dataCatalog.searchPlaceholder'
  | 'dataCatalog.datasetSearchPlaceholder'
  | 'dataCatalog.reportSearchPlaceholder'
  | 'dataCatalog.backtestReportSearchPlaceholder' {
  if (view === 'factor_reports') {
    return 'dataCatalog.reportSearchPlaceholder';
  }
  if (view === 'datasets') {
    return 'dataCatalog.datasetSearchPlaceholder';
  }
  return view === 'backtest_reports'
    ? 'dataCatalog.backtestReportSearchPlaceholder'
    : 'dataCatalog.searchPlaceholder';
}

function localizedDatasetCoverage(
  dataset: ResearchDataCatalogDatasetV1,
  translate: TFunction<'research'>,
): string {
  const coverage = dataset.localDataCoverage;
  if (coverage.status !== 'ready') {
    return translate('dataCatalog.datasetCoverageMissing');
  }
  return translate('dataCatalog.datasetCoverageReady', {
    start: formatCatalogDate(coverage.startDate),
    end: formatCatalogDate(coverage.endDate),
  });
}

function localizedCoverage(
  instrument: ResearchDataCatalogInstrumentV1,
  language: string,
  translate: TFunction<'research'>,
): string {
  const coverage = instrument.localDataCoverage;
  if (coverage?.status !== 'ready') {
    return translate('dataCatalog.coverageMissing');
  }
  return translate('dataCatalog.coverageReady', {
    start: formatCatalogDate(coverage.startDate),
    end: formatCatalogDate(coverage.endDate),
    count: coverage.observationCount.toLocaleString(language),
  });
}

function formatCatalogDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

function formatCatalogRange(start: string, end: string): string {
  return `${formatCatalogDate(start)} – ${formatCatalogDate(end)}`;
}

function catalogDate(value: string): Dayjs {
  return dayjs(formatCatalogDate(value));
}

function rankCatalogInstruments(
  instruments: ResearchDataCatalogInstrumentV1[],
  query: string,
): ResearchDataCatalogInstrumentV1[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return instruments;
  }
  const score = (instrument: ResearchDataCatalogInstrumentV1) => {
    const values = [instrument.identifier, instrument.nameZh, instrument.nameEn ?? ''].map(
      (value) => value.toLocaleLowerCase(),
    );
    return Math.max(
      ...values.map((value) =>
        value === normalizedQuery ? 100 : value.startsWith(normalizedQuery) ? 50 : 10,
      ),
    );
  };
  return [...instruments].sort((left, right) => score(right) - score(left));
}
