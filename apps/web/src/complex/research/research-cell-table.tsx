import { Table, Tooltip } from 'antd';
import type { ResearchTableOutputV1 } from '@jixie/shared';
import { faTable, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useTranslation } from 'react-i18next';

const DEFAULT_PAGE_SIZE = 50;

export function ResearchCellTable({ output }: { output: ResearchTableOutputV1 }) {
  const { t } = useTranslation('research');
  const shownRows = output.rows.length;
  const shownColumns = output.columns.length;
  const columnCount = output.columnCount ?? shownColumns;
  const bounded =
    output.truncated || output.truncatedColumns || output.truncatedCells || output.truncatedBytes;
  const virtual = shownRows > DEFAULT_PAGE_SIZE;
  const limitDescription = output.limits
    ? output.limits.bytes
      ? t('workbench.tableLimitsWithBytes', {
          rows: output.limits.rows,
          columns: output.limits.columns,
          characters: output.limits.cellCharacters,
          kibibytes: Math.round(output.limits.bytes / 1024),
        })
      : t('workbench.tableLimits', {
          rows: output.limits.rows,
          columns: output.limits.columns,
          characters: output.limits.cellCharacters,
        })
    : t('workbench.tableBoundedPreview');

  return (
    <section className="jx-research-tableOutput" data-testid="research-table-output">
      <div className="jx-research-outputMeta">
        <FontAwesomeIcon icon={faTable} />
        <span>
          {shownRows === output.rowCount
            ? t('workbench.tableRowsExact', { count: output.rowCount })
            : t('workbench.tableRowsPreview', { shown: shownRows, count: output.rowCount })}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {shownColumns === columnCount
            ? t('workbench.tableColumnsExact', { count: columnCount })
            : t('workbench.tableColumnsPreview', {
                shown: shownColumns,
                count: columnCount,
              })}
        </span>
        {output.truncatedCells && (
          <span className="jx-research-outputMetaWarning">
            {t('workbench.tableCellsTruncated')}
          </span>
        )}
        {output.truncatedBytes && (
          <span className="jx-research-outputMetaWarning">
            {t('workbench.tableBytesTruncated')}
          </span>
        )}
        {bounded && (
          <Tooltip title={limitDescription}>
            <span
              className="jx-research-outputLimit"
              aria-label={t('workbench.tableBoundedPreview')}
            >
              <FontAwesomeIcon icon={faTriangleExclamation} />
            </span>
          </Tooltip>
        )}
      </div>
      <Table
        size="small"
        virtual={virtual}
        pagination={
          shownRows > DEFAULT_PAGE_SIZE
            ? {
                defaultPageSize: DEFAULT_PAGE_SIZE,
                pageSizeOptions: [25, 50, 100],
                showSizeChanger: true,
                showTotal: (total, range) =>
                  t('workbench.tablePageRange', {
                    from: range[0],
                    to: range[1],
                    total,
                  }),
              }
            : false
        }
        scroll={{
          x: Math.max(720, shownColumns * 140),
          ...(virtual ? { y: 320 } : {}),
        }}
        rowKey={(_row, index) => String(index)}
        dataSource={output.rows}
        columns={output.columns.map((column) => ({
          title: column,
          dataIndex: column,
          key: column,
          width: 140,
          ellipsis: { showTitle: true },
          render: (value: unknown) => formatTableValue(value),
        }))}
      />
    </section>
  );
}

function formatTableValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  const text = String(value ?? '—');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}
