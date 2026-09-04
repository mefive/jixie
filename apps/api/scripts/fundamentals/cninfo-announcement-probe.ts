import { createHash } from 'node:crypto';

import type { FinancialCorrectionEvidence } from '../../src/fundamentals/source-contract.js';

const CNINFO_BASE_URL = 'https://www.cninfo.com.cn';
const CNINFO_DOCUMENT_BASE_URL = 'https://static.cninfo.com.cn/';

export interface CninfoCorrectionProbeOptions {
  tsCode: string;
  startDate: string;
  endDate: string;
}

export interface CninfoCorrectionProbeResult {
  status: 'ok' | 'empty' | 'request_error';
  security?: { secCode: string; orgId: string; name: string };
  announcements: FinancialCorrectionEvidence[];
  errorMessage?: string;
}

interface CninfoSecurityRow {
  code?: unknown;
  orgId?: unknown;
  zwjc?: unknown;
}

interface CninfoAnnouncementRow {
  secCode?: unknown;
  announcementId?: unknown;
  announcementTitle?: unknown;
  announcementTime?: unknown;
  adjunctUrl?: unknown;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type CninfoProbeFetch = (input: string, init?: RequestInit) => Promise<JsonResponse>;

/**
 * Read-only feasibility probe for the JSON endpoints used by CNInfo's own public search page.
 * These endpoints are undocumented, so this must remain corroborating evidence rather than a hard
 * dependency of Tushare financial synchronization.
 */
export async function probeCninfoFinancialCorrections(
  options: CninfoCorrectionProbeOptions,
  request: CninfoProbeFetch = fetch,
): Promise<CninfoCorrectionProbeResult> {
  try {
    const secCode = normalizeSecurityCode(options.tsCode);
    const securityPayload = await postForm(
      request,
      `${CNINFO_BASE_URL}/new/information/topSearch/detailOfQuery`,
      {
        keyWord: secCode,
        maxSecNum: '10',
        maxListNum: '5',
      },
    );
    const security = selectSecurity(securityPayload, secCode);
    if (!security) {
      return { status: 'empty', announcements: [] };
    }
    const announcementsPayload = await postForm(
      request,
      `${CNINFO_BASE_URL}/new/hisAnnouncement/query`,
      {
        stock: `${security.secCode},${security.orgId}`,
        pageSize: '30',
        pageNum: '1',
        searchkey: '更正',
        seDate: `${toIsoDate(options.startDate)}~${toIsoDate(options.endDate)}`,
        sortName: 'time',
        sortType: 'desc',
      },
    );
    const announcements = announcementRows(announcementsPayload)
      .filter((row) => isFinancialCorrectionTitle(String(row.announcementTitle ?? '')))
      .map((row) => normalizeAnnouncement(row, options.tsCode));
    return {
      status: announcements.length > 0 ? 'ok' : 'empty',
      security,
      announcements,
    };
  } catch (error) {
    return {
      status: 'request_error',
      announcements: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isFinancialCorrectionTitle(title: string): boolean {
  const plain = stripMarkup(title);
  return /前期会计差错更正|财务信息.{0,8}更正|定期报告.{0,8}更正|更正后.{0,8}财务报表|财务报表.{0,8}更正|追溯调整/.test(
    plain,
  );
}

function normalizeAnnouncement(
  row: CninfoAnnouncementRow,
  tsCode: string,
): FinancialCorrectionEvidence {
  const sourceId = requiredString(row.announcementId, 'announcementId');
  const timestamp = requiredNumber(row.announcementTime, 'announcementTime');
  const title = stripMarkup(requiredString(row.announcementTitle, 'announcementTitle'));
  const adjunctUrl = requiredString(row.adjunctUrl, 'adjunctUrl').replace(/^\/+/, '');
  const publishedAt = new Date(timestamp).toISOString();
  const documentUrl = new URL(adjunctUrl, CNINFO_DOCUMENT_BASE_URL).toString();
  return {
    source: 'cninfo',
    sourceId,
    tsCode,
    publishedAt,
    publishedDate: shanghaiDate(timestamp),
    title,
    documentUrl,
    // The search result proves the announcement date, but affected periods require PDF evidence.
    affectedPeriods: [],
    sourceFingerprint: createHash('sha256')
      .update(JSON.stringify([sourceId, tsCode, publishedAt, title, documentUrl]))
      .digest('hex'),
  };
}

async function postForm(
  request: CninfoProbeFetch,
  url: string,
  values: Record<string, string>,
): Promise<unknown> {
  const response = await request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      referer: `${CNINFO_BASE_URL}/new/fulltextSearch`,
      'user-agent': 'jixie-fundamental-source-probe/1.0',
    },
    body: new URLSearchParams(values).toString(),
  });
  if (!response.ok) {
    throw new Error(`CNInfo request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function selectSecurity(
  payload: unknown,
  secCode: string,
): { secCode: string; orgId: string; name: string } | undefined {
  const rows = objectRows(payload, 'keyBoardList') as CninfoSecurityRow[];
  const row = rows.find((candidate) => String(candidate.code ?? '') === secCode);
  if (!row) {
    return undefined;
  }
  return {
    secCode,
    orgId: requiredString(row.orgId, 'orgId'),
    name: requiredString(row.zwjc, 'zwjc'),
  };
}

function announcementRows(payload: unknown): CninfoAnnouncementRow[] {
  return objectRows(payload, 'announcements') as CninfoAnnouncementRow[];
}

function objectRows(payload: unknown, field: string): unknown[] {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('CNInfo returned a non-object response');
  }
  const value = (payload as Record<string, unknown>)[field];
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`CNInfo returned invalid ${field}`);
  }
  return value;
}

function normalizeSecurityCode(tsCode: string): string {
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(tsCode)) {
    throw new Error(`Invalid A-share code: ${tsCode}`);
  }
  return tsCode.slice(0, 6);
}

function toIsoDate(date: string): string {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Invalid date: ${date}`);
  }
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function shanghaiDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(timestamp))
    .replaceAll('-', '');
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

function requiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (!normalized) {
    throw new Error(`CNInfo response omitted ${field}`);
  }
  return normalized;
}

function requiredNumber(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`CNInfo response omitted ${field}`);
  }
  return normalized;
}
