import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '@jixie/shared';
import { EngineData } from './data.js';
import { fixturePort } from './fixture-port.js';

describe('historical stock status in BarRow', () => {
  it('exposes the name and risk state effective on each bar date', async () => {
    const dates = ['20240102', '20250102', '20260102'];
    const data = new EngineData(
      dates[0],
      dates[1],
      [],
      () => {},
      DEFAULT_LOCALE,
      fixturePort({
        dates,
        stocks: [
          {
            code: '000001.SZ',
            nameHistory: [
              {
                name: '*ST测试',
                startDate: '20230101',
                endDate: '20241231',
              },
              {
                name: '测试股份',
                startDate: '20250101',
                endDate: '20251231',
              },
              {
                name: '测试退',
                startDate: '20260101',
                endDate: null,
              },
            ],
            bars: dates.map((date) => ({
              date,
              open: 10,
              close: 10,
            })),
          },
        ],
      }),
    );
    await data.load();

    expect((await data.crossSection('20240102')).byCode.get('000001.SZ')).toMatchObject({
      name: '*ST测试',
      riskWarning: true,
      pendingDelisting: false,
    });
    expect((await data.crossSection('20250102')).byCode.get('000001.SZ')).toMatchObject({
      name: '测试股份',
      riskWarning: false,
      pendingDelisting: false,
    });
    expect((await data.crossSection('20260102')).byCode.get('000001.SZ')).toMatchObject({
      name: '测试退',
      riskWarning: false,
      pendingDelisting: true,
    });
  });
});
