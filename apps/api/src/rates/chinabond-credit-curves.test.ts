import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ChinaBondPublicCurveClient,
  parseChinaBondCurveWorkbook,
} from './chinabond-credit-curves.js';

describe('ChinaBond public credit curves', () => {
  it('parses exact published terms from the official workbook without interpolation', () => {
    const workbook = workbookFixture([
      ['中债国债收益率曲线', '2026-07-31', '', '', '', '', '1.55', '', '1.71', ''],
      ['中债商业银行普通债收益率曲线(AAA)', '2026-07-31', '', '', '', '', '1.82', '', '1.99', ''],
      ['中债中短期票据收益率曲线(AAA)', '2026-07-31', '', '', '', '', '1.93', '', '2.11', ''],
    ]);

    const points = parseChinaBondCurveWorkbook(workbook, '20260701', '20260731');

    expect(points).toHaveLength(6);
    expect(points.find((point) => point.curveCode === 'chinabond_cp_note_aaa_ytm')).toEqual({
      curveCode: 'chinabond_cp_note_aaa_ytm',
      curveName: '中债中短期票据收益率曲线(AAA)',
      tradeDate: '20260731',
      termYears: 5,
      yieldPct: 1.93,
    });
    expect(points.some((point) => point.termYears === 3)).toBe(false);
  });

  it('rejects duplicate source points', () => {
    const duplicate = ['中债国债收益率曲线', '2026-07-31', '', '', '', '', '1.55', '', '', ''];
    expect(() =>
      parseChinaBondCurveWorkbook(workbookFixture([duplicate, duplicate]), '20260731', '20260731'),
    ).toThrow(/duplicate point/);
  });

  it('rejects a partial modern workbook instead of deleting one required curve', () => {
    expect(() =>
      parseChinaBondCurveWorkbook(
        workbookFixture([['中债国债收益率曲线', '2026-07-31', '', '', '', '', '1.55', '', '', '']]),
        '20260731',
        '20260731',
      ),
    ).toThrow(/omitted required curves/);
  });

  it('fails closed when the source workbook schema changes', () => {
    expect(() =>
      parseChinaBondCurveWorkbook(
        workbookFixture(
          [],
          ['产品', '日期', '3月', '6月', '1年', '3年', '5年', '7年', '10年', '30年'],
        ),
        '20260731',
        '20260731',
      ),
    ).toThrow(/unknown header/);
  });

  it('retries network and transient HTTP failures while preserving the underlying cause', async () => {
    const workbook = workbookFixture([
      ['中债国债收益率曲线', '2026-07-31', '', '', '', '', '1.55', '', '', ''],
      ['中债商业银行普通债收益率曲线(AAA)', '2026-07-31', '', '', '', '', '1.82', '', '', ''],
      ['中债中短期票据收益率曲线(AAA)', '2026-07-31', '', '', '', '', '1.93', '', '', ''],
    ]);
    const requests: string[] = [];
    let attempt = 0;
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(String(input));
      attempt += 1;
      if (attempt === 1) {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('Connect Timeout Error'), {
            code: 'UND_ERR_CONNECT_TIMEOUT',
          }),
        });
      }
      if (attempt === 2) {
        return new Response('temporary upstream error', { status: 503 });
      }
      return new Response(workbook);
    };
    const delays: number[] = [];
    const logs: string[] = [];
    const client = new ChinaBondPublicCurveClient(
      60_000,
      fetchImpl,
      (line) => logs.push(line),
      async (milliseconds) => {
        delays.push(milliseconds);
      },
    );

    await expect(client.fetchRange('20260731', '20260731')).resolves.toHaveLength(3);

    expect(requests).toHaveLength(3);
    expect(requests[0]).toContain('startDate=2026-07-31&endDate=2026-07-31');
    expect(delays).toEqual([1_000, 3_000]);
    expect(logs).toEqual([
      'ChinaBond public curve attempt 1/3 failed (ChinaBond public curve request failed: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error)); retrying in 1000ms',
      'ChinaBond public curve attempt 2/3 failed (ChinaBond public curve source returned HTTP 503: temporary upstream error); retrying in 3000ms',
    ]);
  });

  it('does not retry a non-transient HTTP rejection', async () => {
    let requests = 0;
    const client = new ChinaBondPublicCurveClient(
      60_000,
      async () => {
        requests += 1;
        return new Response('Access Denied', { status: 403 });
      },
      () => {},
      async () => {},
    );

    await expect(client.fetchRange('20260731', '20260731')).rejects.toThrow(
      'ChinaBond public curve source returned HTTP 403: Access Denied',
    );
    expect(requests).toBe(1);
  });
});

function workbookFixture(
  rows: string[][],
  header = ['曲线名称', '日期', '3月', '6月', '1年', '3年', '5年', '7年', '10年', '30年'],
) {
  const allRows = [header, ...rows];
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${allRows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`;
  return zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) });
}

function columnName(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
