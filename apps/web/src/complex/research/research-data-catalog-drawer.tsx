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
import type {
  ResearchAssetTypeV1,
  ResearchDataCatalogInstrumentV1,
  ResearchDataCatalogSdkMethodV1,
  ResearchFrequencyV1,
  ResearchTransformV1,
} from '@jixie/shared';
import {
  faArrowRightToBracket,
  faChartLine,
  faCircleCheck,
  faCircleExclamation,
  faDatabase,
  faLayerGroup,
  faMagnifyingGlass,
  faPercent,
  faTableColumns,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoadingArea } from '@src/components/loading-area';
import { complex } from './complex';
import { researchSeriesSnippet } from './research-data-catalog';
import { insertResearchPythonSnippet } from './research-python-language';
import './research-data-catalog-drawer.css';

interface ResearchDataCatalogDrawerProps {
  open: boolean;
  onClose: () => void;
}

type AssetFilter = 'all' | ResearchAssetTypeV1;

export const ResearchDataCatalogDrawer = complex.component(
  ({ open, onClose }: ResearchDataCatalogDrawerProps) => {
    const store = complex.useStore();
    const { message } = App.useApp();
    const { t, i18n } = useTranslation('research');
    const [query, setQuery] = useState('');
    const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
    const [selected, setSelected] = useState<ResearchDataCatalogInstrumentV1 | null>(null);
    const [selectedMethodName, setSelectedMethodName] = useState<string | null>(null);
    const [measureId, setMeasureId] = useState('market.adjusted_close');
    const [frequency, setFrequency] = useState<ResearchFrequencyV1>('daily');
    const [transform, setTransform] = useState<ResearchTransformV1>('level');
    const [dates, setDates] = useState<[Dayjs, Dayjs]>([dayjs().subtract(5, 'year'), dayjs()]);

    useEffect(() => {
      if (!open) {
        return undefined;
      }
      const timer = window.setTimeout(
        () => {
          void store.searchDataCatalog(query, assetFilter === 'all' ? undefined : assetFilter);
        },
        query ? 180 : 0,
      );
      return () => window.clearTimeout(timer);
    }, [assetFilter, open, query, store]);

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
      selected && measureId && selected.sdkAccess?.status !== 'not_ready'
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
    const insert = () => {
      if (!store.documentId || !snippet) {
        return;
      }
      const documentId = store.documentId;
      onClose();
      window.setTimeout(() => {
        if (insertResearchPythonSnippet(documentId, snippet)) {
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
              <div className="jx-researchDataCatalog-methodMeta">
                <span>{t('dataCatalog.returns')}</span>
                <div>
                  {selectedMethod.returnColumns.map((column) => (
                    <Tag key={column}>{column}</Tag>
                  ))}
                </div>
              </div>
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
          placeholder={t('dataCatalog.searchPlaceholder')}
          aria-label={t('dataCatalog.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
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
      </Drawer>
    );
  },
  'ResearchDataCatalogDrawer',
);

function localizedInstrumentName(
  instrument: ResearchDataCatalogInstrumentV1,
  language: string,
): string {
  return language.startsWith('zh') ? instrument.nameZh : (instrument.nameEn ?? instrument.nameZh);
}

function localizedMethodDescription(
  method: ResearchDataCatalogSdkMethodV1,
  language: string,
): string {
  return language.startsWith('zh') ? method.descriptionZh : method.descriptionEn;
}

function researchDataMethodIcon(qualifiedName: string) {
  switch (qualifiedName) {
    case 'data.cross_section':
      return faTableColumns;
    case 'data.panel':
      return faLayerGroup;
    case 'data.yield_curve':
      return faPercent;
    default:
      return faChartLine;
  }
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
