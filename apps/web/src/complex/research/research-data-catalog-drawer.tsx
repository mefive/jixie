import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { ResearchDataCatalogPicker } from '@src/components/research-data-catalog-picker';
import { complex } from './complex';
import { insertResearchPythonSnippet } from './research-python-language';

/**
 * 传递研究数据选择与插入回调，供目录抽屉。
 * Supply research selection and insertion callbacks to the catalog drawer.
 */
interface ResearchDataCatalogDrawerProps {
  open: boolean;
  onClose(): void;
}

/**
 * 在研究工作区打开受控数据目录选择器并传递选中引用。
 * Open the governed data picker and return selected references to the research workspace.
 */
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
