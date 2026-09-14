import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { ResearchDataCatalogPicker } from '@src/components/research-data-catalog-picker';
import { complex } from './complex';
import { insertResearchPythonSnippet } from './research-python-language';

interface ResearchDataCatalogDrawerProps {
  open: boolean;
  onClose(): void;
}

export const ResearchDataCatalogDrawer = complex.component(
  ({ open, onClose }: ResearchDataCatalogDrawerProps) => {
    const store = complex.useStore();
    const { message } = App.useApp();
    const { t } = useTranslation('research');
    return (
      <ResearchDataCatalogPicker
        open={open}
        onClose={onClose}
        model={store}
        onSelect={({ snippet }) => {
          const documentId = store.documentId;
          if (!documentId) {
            return;
          }
          window.setTimeout(async () => {
            if (insertResearchPythonSnippet(documentId, snippet)) {
              await store.flushPendingChanges();
              void message.success(t('dataCatalog.inserted'));
            } else {
              void message.warning(t('dataCatalog.noPythonCell'));
            }
          }, 120);
        }}
      />
    );
  },
  'ResearchDataCatalogDrawer',
);
