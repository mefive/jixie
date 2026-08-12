import { App, Alert, Button, Card, Empty, Skeleton, Tabs, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LibraryFactor, LibraryStrategy } from '@jixie/shared';
import { complex } from './complex';
import './library.css';

export const Library = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('library');
  const { message } = App.useApp();
  const navigate = useNavigate();
  const library = store.loader.result;

  const run = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      message.success(success);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('operationFailed'));
    }
  };

  if (store.loader.error) {
    return (
      <div className="jx-library">
        <Alert type="error" showIcon message={t('loadFailed')} />
      </div>
    );
  }
  if (!library) {
    return (
      <div className="jx-library">
        <Skeleton active />
      </div>
    );
  }

  const publicContent = (
    <div className="jx-library-sections">
      <AssetSection title={t('strategies')} empty={t('emptyStrategies')}>
        {library.strategies.map((asset) => (
          <AssetCard
            key={asset.id}
            title={asset.name}
            meta={t('byAuthor', { author: asset.author })}
            tag={t('strategy')}
            action={
              asset.owned ? (
                <Button
                  onClick={() =>
                    void run(
                      () => store.setStrategyVisibility(asset.id, 'private'),
                      t('madePrivate'),
                    )
                  }
                >
                  {t('makePrivate')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  onClick={() =>
                    void run(async () => {
                      const copied = await store.copyStrategy(asset.id);
                      navigate(`/lab?id=${encodeURIComponent(copied.id)}`);
                    }, t('copied'))
                  }
                >
                  {t('copy')}
                </Button>
              )
            }
          />
        ))}
      </AssetSection>
      <AssetSection title={t('factors')} empty={t('emptyFactors')}>
        {library.factors.map((asset) => (
          <AssetCard
            key={`${asset.kind}:${asset.id}`}
            title={asset.name}
            meta={`${asset.key} · ${t('byAuthor', { author: asset.author })}`}
            tag={asset.kind === 'composite' ? t('composite') : t('factor')}
            action={
              asset.owned ? (
                <Button
                  onClick={() =>
                    void run(() => store.setFactorVisibility(asset, 'private'), t('madePrivate'))
                  }
                >
                  {t('makePrivate')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  onClick={() =>
                    void run(async () => {
                      const copied = await store.copyFactor(asset);
                      navigate(`/factors?factor=${encodeURIComponent(copied.id)}`);
                    }, t('copied'))
                  }
                >
                  {t('copy')}
                </Button>
              )
            }
          />
        ))}
      </AssetSection>
    </div>
  );

  const mineContent = (
    <div className="jx-library-sections">
      <AssetSection title={t('myStrategies')} empty={t('noOwnedStrategies')}>
        {library.mine.strategies.map((asset) => (
          <OwnedStrategyCard
            key={asset.id}
            asset={asset}
            onToggle={() =>
              run(
                () =>
                  store.setStrategyVisibility(
                    asset.id,
                    asset.visibility === 'public' ? 'private' : 'public',
                  ),
                asset.visibility === 'public' ? t('madePrivate') : t('madePublic'),
              )
            }
          />
        ))}
      </AssetSection>
      <AssetSection title={t('myPublishedFactors')} empty={t('noPublishedFactors')}>
        {library.mine.factors.map((asset) => (
          <OwnedFactorCard
            key={`${asset.kind}:${asset.id}`}
            asset={asset}
            onToggle={() =>
              run(
                () =>
                  store.setFactorVisibility(
                    asset,
                    asset.visibility === 'public' ? 'private' : 'public',
                  ),
                asset.visibility === 'public' ? t('madePrivate') : t('madePublic'),
              )
            }
          />
        ))}
      </AssetSection>
    </div>
  );

  return (
    <div className="jx-library">
      <header className="jx-library-hero">
        <div>
          <div className="jx-library-eyebrow">PUBLIC LIBRARY</div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </header>
      <Tabs
        items={[
          { key: 'public', label: t('publicTab'), children: publicContent },
          { key: 'mine', label: t('mineTab'), children: mineContent },
        ]}
      />
    </div>
  );
}, 'Library');

function AssetSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="jx-library-section">
      <h2>{title}</h2>
      {children.length > 0 ? (
        <div className="jx-library-grid">{children}</div>
      ) : (
        <Empty description={empty} />
      )}
    </section>
  );
}

function AssetCard({
  title,
  meta,
  tag,
  action,
}: {
  title: string;
  meta: string;
  tag: string;
  action: React.ReactNode;
}) {
  return (
    <Card className="jx-library-card" size="small">
      <div className="jx-library-cardHead">
        <strong>{title}</strong>
        <Tag>{tag}</Tag>
      </div>
      <div className="jx-library-meta">{meta}</div>
      <div className="jx-library-actions">{action}</div>
    </Card>
  );
}

function OwnedStrategyCard({ asset, onToggle }: { asset: LibraryStrategy; onToggle: () => void }) {
  const { t } = useTranslation('library');
  return (
    <AssetCard
      title={asset.name}
      meta={asset.visibility === 'public' ? t('public') : t('private')}
      tag={t('strategy')}
      action={
        <Button onClick={onToggle}>
          {asset.visibility === 'public' ? t('makePrivate') : t('share')}
        </Button>
      }
    />
  );
}

function OwnedFactorCard({ asset, onToggle }: { asset: LibraryFactor; onToggle: () => void }) {
  const { t } = useTranslation('library');
  return (
    <AssetCard
      title={asset.name}
      meta={`${asset.key} · ${asset.visibility === 'public' ? t('public') : t('private')}`}
      tag={asset.kind === 'composite' ? t('composite') : t('factor')}
      action={
        <Button onClick={onToggle}>
          {asset.visibility === 'public' ? t('makePrivate') : t('share')}
        </Button>
      }
    />
  );
}
