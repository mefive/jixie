import { expect, it } from 'vitest';
import { confirmedTradingInterruptions } from './trading-interruptions.js';

it.each([
  ['000520.SZ', '20140516', '20151217', '20151218'],
  ['002506.SZ', '20140528', '20150811', '20150812'],
  ['000594.SZ', '20140717', '20150528', '20150529'],
  ['601268.SH', '20140526', '20150521', '20150522'],
])('bounds announced non-trading history for %s', (code, start, end, next) => {
  expect(confirmedTradingInterruptions('20140101').has(code)).toBe(false);
  expect(confirmedTradingInterruptions(start).has(code)).toBe(true);
  expect(confirmedTradingInterruptions(end).has(code)).toBe(true);
  expect(confirmedTradingInterruptions(next).has(code)).toBe(false);
});

it('keeps the post-listing restructuring suspension separate from listing suspension', () => {
  expect(confirmedTradingInterruptions('20150818').has('000520.SZ')).toBe(true);
});
