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
import { useTranslation } from 'react-i18next';
import type {
  ResearchAssetTypeV1,
  ResearchDataCatalogInstrumentV1,
  ResearchFrequencyV1,
  ResearchTransformV1,
} from '@jixie/shared';
import {
  faArrowRightToBracket,
  faChartLine,
  faDatabase,
  faMagnifyingGlass,
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
      selected && measureId
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
                    className={`jx-researchDataCatalog-result${
                      selected?.assetType === instrument.assetType &&
                      selected.identifier === instrument.identifier
                        ? ' jx-researchDataCatalog-result--active'
                        : ''
                    }`}
                    data-testid={`research-data-catalog-result-${instrument.identifier}`}
                    onClick={() => chooseInstrument(instrument)}
                  >
                    <span className="jx-researchDataCatalog-resultIcon">
                      <FontAwesomeIcon icon={faChartLine} />
                    </span>
                    <span className="jx-researchDataCatalog-resultText">
                      <strong>{localizedInstrumentName(instrument, i18n.language)}</strong>
                      <code>{instrument.identifier}</code>
                    </span>
                    <Tag>{t(`dataCatalog.assetType.${instrument.assetType}`)}</Tag>
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
