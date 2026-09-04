import { describe, expect, it, vi } from 'vitest';

import {
  isFinancialCorrectionTitle,
  probeCninfoFinancialCorrections,
  type CninfoProbeFetch,
} from './cninfo-announcement-probe.js';

function response(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

describe('CNInfo financial-correction source probe', () => {
  it('resolves the security identity and returns official correction metadata', async () => {
    const request = vi
      .fn<CninfoProbeFetch>()
      .mockResolvedValueOnce(
        response({
          keyBoardList: [
            { code: '300266', orgId: '9900011848', zwjc: '兴源环境' },
            { code: '300267', orgId: 'other', zwjc: 'irrelevant' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          announcements: [
            {
              secCode: '300266',
              announcementId: '1218790667',
              announcementTitle: '兴源环境：关于<em>前期</em>会计差错更正及追溯调整的公告',
              announcementTime: 1704211200000,
              adjunctUrl: 'finalpage/2024-01-03/1218790667.PDF',
            },
            {
              secCode: '300266',
              announcementId: 'irrelevant',
              announcementTitle: '关于利润分配实施公告的更正公告',
              announcementTime: 1704211200000,
              adjunctUrl: 'finalpage/2024-01-03/irrelevant.PDF',
            },
          ],
        }),
      );

    const result = await probeCninfoFinancialCorrections(
      { tsCode: '300266.SZ', startDate: '20240101', endDate: '20240110' },
      request,
    );

    expect(result).toMatchObject({
      status: 'ok',
      security: { secCode: '300266', orgId: '9900011848', name: '兴源环境' },
      announcements: [
        {
          source: 'cninfo',
          sourceId: '1218790667',
          tsCode: '300266.SZ',
          publishedAt: '2024-01-02T16:00:00.000Z',
          publishedDate: '20240103',
          affectedPeriods: [],
          documentUrl: 'https://static.cninfo.com.cn/finalpage/2024-01-03/1218790667.PDF',
        },
      ],
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain('stock=300266%2C9900011848');
  });

  it('does not mistake an ordinary announcement correction for a financial correction', () => {
    expect(isFinancialCorrectionTitle('关于利润分配实施公告的更正公告')).toBe(false);
    expect(isFinancialCorrectionTitle('关于前期会计差错更正后的财务报表及附注')).toBe(true);
  });

  it('returns a soft request error because CNInfo is corroborating rather than required', async () => {
    const request = vi.fn<CninfoProbeFetch>().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => null,
    });

    await expect(
      probeCninfoFinancialCorrections(
        { tsCode: '300266.SZ', startDate: '20240101', endDate: '20240110' },
        request,
      ),
    ).resolves.toEqual({
      status: 'request_error',
      announcements: [],
      errorMessage: 'CNInfo request failed with HTTP 503',
    });
  });
});
