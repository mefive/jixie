import type { TushareRow } from '../../providers/tushare/tushare-client.js';

const cash: TushareRow = {
  ts_code: '002326.SZ',
  end_date: '20181231',
  ann_date: '20190720',
  ex_date: null,
  div_proc: '预案',
  cash_div: 0,
  cash_div_tax: 0.15,
  base_date: '20181231',
  base_share: 82009.3827,
  stk_div: 0,
  stk_bo_rate: null,
  stk_co_rate: null,
  record_date: null,
  pay_date: null,
  imp_ann_date: null,
  div_listdate: null,
};
const shares: TushareRow = {
  ...cash,
  cash_div_tax: 0,
  base_share: 51277.8827,
  stk_div: 0.12,
  stk_co_rate: 0.12,
};
const implemented: TushareRow = {
  ...cash,
  ann_date: '20190429',
  div_proc: '实施',
  cash_div: 0.15,
  record_date: '20190819',
  ex_date: '20190820',
  pay_date: '20190820',
  imp_ann_date: '20190814',
};

/**
 * 永太科技 2018 年现金分红与定向转增，保留 Tushare 原始字段和两个实施公告。
 *
 * Yongtai FY2018 cash and targeted capitalization, preserving both source implementation notices.
 */
export const YONGTAI_DIVIDENDS: TushareRow[] = [
  cash,
  shares,
  { ...cash, div_proc: '股东大会通过' },
  { ...shares, div_proc: '股东大会通过' },
  implemented,
  { ...implemented, ann_date: '20190806' },
  {
    ...shares,
    div_proc: '停止实施',
    ann_date: '20190521',
    cash_div: null,
    cash_div_tax: null,
    base_date: null,
  },
];
