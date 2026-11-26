import { createHash } from 'node:crypto';
import { INGESTION_SOURCE_REQUESTS } from './request-contract.js';
import type { TushareClient, TushareRow } from './tushare-client.js';

/**
 * 一次业务查询共用固定页长，只有 offset 随页推进。
 *
 * Page one business query with a fixed limit and advancing offset.
 */
export class TusharePaginator {
  constructor(private readonly client: Pick<TushareClient, 'call'>) {}

  async *pages(api: string, params: Record<string, unknown>, fields: string) {
    const contract = INGESTION_SOURCE_REQUESTS[api];
    if (!contract || Object.keys(params).some((key) => !contract.parameters.includes(key))) {
      throw new Error(`${api}: undeclared ingestion request parameter`);
    }

    const limit = contract.pageSize ?? 5000;
    const signatures = new Set<string>();
    for (let offset = 0; ; offset += limit) {
      const rows = await this.client.call(api, { ...params, limit, offset }, fields);
      if (rows.length > limit) {
        throw new Error(`${api} offset=${offset}: response exceeds requested limit ${limit}`);
      }

      if (rows.length === limit) {
        const signature = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
        if (signatures.has(signature)) {
          throw new Error(`${api} offset=${offset}: provider repeated an offset page`);
        }
        signatures.add(signature);
      }

      yield rows;
      if (rows.length < limit) {
        return;
      }
    }
  }

  async all(api: string, params: Record<string, unknown>, fields: string): Promise<TushareRow[]> {
    const rows: TushareRow[] = [];
    for await (const page of this.pages(api, params, fields)) {
      rows.push(...page);
    }

    return rows;
  }
}
