import { prisma } from '../lib/prisma.js';
import { MARKET_STATE_INDEX_CODES } from '../store/index-presets.js';
import { log } from '../util/log.js';

interface DateSlice {
  start: string;
  end: string;
}

const DATE_PATTERN = /^\d{8}$/;
const INDEX_CODES_SQL = MARKET_STATE_INDEX_CODES.map((code) => `'${code}'`).join(', ');

/**
 * Precompute whole-market, point-in-time index-universe, and Shenwan level-1 industry state. The
 * raw panel is built one calendar year at a time so a full-history backfill does not materialize the
 * entire market in one temp table. SQLite window functions are intentional here: computing rolling
 * prices through Prisma row objects was measured to require millions of allocations and repeated
 * per-day queries.
 */
export async function syncMarketIndicators(start: string, end: string): Promise<void> {
  validateRange(start, end);

  for (const slice of yearlySlices(start, end)) {
    const panelStart = await paddedStart(slice.start, 60);
    await syncSlice(panelStart, slice);
  }
}

async function syncSlice(panelStart: string, slice: DateSlice): Promise<void> {
  log(`syncMarketIndicators ${slice.start}~${slice.end} (panel from ${panelStart})`);

  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe('DROP TABLE IF EXISTS market_state_panel');
      await transaction.$executeRawUnsafe('DROP TABLE IF EXISTS market_state_market_ranked');
      await transaction.$executeRawUnsafe('DROP TABLE IF EXISTS market_state_index_members');
      await transaction.$executeRawUnsafe('DROP TABLE IF EXISTS market_state_index_close');
      await transaction.$executeRawUnsafe('DROP TABLE IF EXISTS market_state_index_ranked');
      await transaction.$executeRawUnsafe('DROP TABLE IF EXISTS market_state_ranked');

      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE market_state_panel AS
        WITH base AS (
          SELECT
            d."tsCode" AS "tsCode",
            d."tradeDate" AS "tradeDate",
            d."close" AS "rawClose",
            d."close" * a."adjFactor" AS "adjustedClose",
            d."pctChg" AS "pctChg",
            d."amount" AS "amount",
            db."circMv" AS "circMv",
            db."turnoverRate" AS "turnoverRate",
            sl."upLimit" AS "upLimit",
            sl."downLimit" AS "downLimit",
            COUNT(d."close" * a."adjFactor") OVER (
              PARTITION BY d."tsCode"
              ORDER BY d."tradeDate"
              ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
            ) AS "observations20",
            AVG(d."close" * a."adjFactor") OVER (
              PARTITION BY d."tsCode"
              ORDER BY d."tradeDate"
              ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
            ) AS "ma20",
            COUNT(d."close" * a."adjFactor") OVER (
              PARTITION BY d."tsCode"
              ORDER BY d."tradeDate"
              ROWS BETWEEN 59 PRECEDING AND CURRENT ROW
            ) AS "observations60",
            AVG(d."close" * a."adjFactor") OVER (
              PARTITION BY d."tsCode"
              ORDER BY d."tradeDate"
              ROWS BETWEEN 59 PRECEDING AND CURRENT ROW
            ) AS "ma60",
            LAG(d."close" * a."adjFactor", 20) OVER (
              PARTITION BY d."tsCode"
              ORDER BY d."tradeDate"
            ) AS "adjustedClose20"
          FROM "Daily" d
          JOIN "AdjFactor" a
            ON a."tsCode" = d."tsCode"
            AND a."tradeDate" = d."tradeDate"
          LEFT JOIN "DailyBasic" db
            ON db."tsCode" = d."tsCode"
            AND db."tradeDate" = d."tradeDate"
          LEFT JOIN "StkLimit" sl
            ON sl."tsCode" = d."tsCode"
            AND sl."tradeDate" = d."tradeDate"
          WHERE d."tradeDate" BETWEEN '${panelStart}' AND '${slice.end}'
            AND d."close" IS NOT NULL
        )
        SELECT
          *,
          CASE
            WHEN "adjustedClose20" > 0 THEN "adjustedClose" / "adjustedClose20" - 1
            ELSE NULL
          END AS "return20"
        FROM base
        WHERE "tradeDate" BETWEEN '${slice.start}' AND '${slice.end}'
      `);

      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE market_state_market_ranked AS
        SELECT
          panel.*,
          ROW_NUMBER() OVER (
            PARTITION BY panel."tradeDate"
            ORDER BY COALESCE(panel."amount", 0) DESC
          ) AS "marketAmountRank",
          COUNT(*) OVER (
            PARTITION BY panel."tradeDate"
          ) AS "marketRowCount"
        FROM market_state_panel panel
      `);

      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE market_state_index_members AS
        WITH snapshot_dates AS (
          SELECT
            "indexCode",
            "tradeDate",
            LEAD("tradeDate") OVER (
              PARTITION BY "indexCode"
              ORDER BY "tradeDate"
            ) AS "nextTradeDate"
          FROM (
            SELECT DISTINCT "indexCode", "tradeDate"
            FROM "IndexWeight"
            WHERE "indexCode" IN (${INDEX_CODES_SQL})
          )
        )
        SELECT
          weight."indexCode",
          weight."conCode",
          weight."tradeDate" AS "membershipDate",
          snapshot."nextTradeDate"
        FROM "IndexWeight" weight
        JOIN snapshot_dates snapshot
          ON snapshot."indexCode" = weight."indexCode"
          AND snapshot."tradeDate" = weight."tradeDate"
      `);

      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE market_state_index_close AS
        WITH close_window AS (
          SELECT
            "tsCode" AS "indexCode",
            "tradeDate",
            "close",
            LAG("close", 20) OVER (
              PARTITION BY "tsCode"
              ORDER BY "tradeDate"
            ) AS "close20"
          FROM "IndexDaily"
          WHERE "tsCode" IN (${INDEX_CODES_SQL})
            AND "tradeDate" BETWEEN '${panelStart}' AND '${slice.end}'
        )
        SELECT
          "indexCode",
          "tradeDate",
          CASE
            WHEN "close20" > 0 THEN "close" / "close20" - 1
            ELSE NULL
          END AS "return20"
        FROM close_window
        WHERE "tradeDate" BETWEEN '${slice.start}' AND '${slice.end}'
      `);

      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE market_state_index_ranked AS
        SELECT
          panel.*,
          member."indexCode",
          member."membershipDate",
          ROW_NUMBER() OVER (
            PARTITION BY member."indexCode", panel."tradeDate"
            ORDER BY COALESCE(panel."amount", 0) DESC
          ) AS "indexAmountRank",
          COUNT(*) OVER (
            PARTITION BY member."indexCode", panel."tradeDate"
          ) AS "indexRowCount"
        FROM market_state_panel panel
        JOIN market_state_index_members member
          ON member."conCode" = panel."tsCode"
          AND member."membershipDate" <= panel."tradeDate"
          AND (
            member."nextTradeDate" IS NULL
            OR panel."tradeDate" < member."nextTradeDate"
          )
      `);

      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE market_state_ranked AS
        SELECT
          panel.*,
          member."l1Code" AS "l1Code",
          member."l1Name" AS "l1Name",
          ROW_NUMBER() OVER (
            PARTITION BY panel."tradeDate", member."l1Code"
            ORDER BY COALESCE(panel."amount", 0) DESC
          ) AS "industryAmountRank"
        FROM market_state_panel panel
        LEFT JOIN "SwIndustryMember" member
          ON member.rowid = (
            SELECT candidate.rowid
            FROM "SwIndustryMember" candidate
            WHERE candidate."tsCode" = panel."tsCode"
              AND candidate."inDate" <= panel."tradeDate"
              AND (
                candidate."outDate" IS NULL
                OR panel."tradeDate" < candidate."outDate"
              )
            ORDER BY candidate."inDate" DESC, candidate."l1Code" DESC
            LIMIT 1
          )
      `);

      await transaction.marketIndicator.deleteMany({
        where: { tradeDate: { gte: slice.start, lte: slice.end } },
      });
      await transaction.indexIndicator.deleteMany({
        where: { tradeDate: { gte: slice.start, lte: slice.end } },
      });
      await transaction.industryIndicator.deleteMany({
        where: { tradeDate: { gte: slice.start, lte: slice.end } },
      });

      await transaction.$executeRawUnsafe(`
        INSERT INTO "MarketIndicator" (
          "tradeDate",
          "tradedCount",
          "return20",
          "advanceRatio",
          "aboveMa20Ratio",
          "aboveMa60Ratio",
          "totalAmount",
          "floatWeightedTurnoverRate",
          "topFivePercentAmountShare",
          "extremeMoveRatio",
          "limitUpCount",
          "limitDownCount"
        )
        SELECT
          "tradeDate",
          COUNT(*) AS "tradedCount",
          AVG("return20") AS "return20",
          AVG(CASE WHEN "pctChg" IS NOT NULL THEN "pctChg" > 0 END) AS "advanceRatio",
          AVG(
            CASE
              WHEN "observations20" = 20 THEN "adjustedClose" > "ma20"
              ELSE NULL
            END
          ) AS "aboveMa20Ratio",
          AVG(
            CASE
              WHEN "observations60" = 60 THEN "adjustedClose" > "ma60"
              ELSE NULL
            END
          ) AS "aboveMa60Ratio",
          SUM(COALESCE("amount", 0)) AS "totalAmount",
          CASE
            WHEN SUM(CASE WHEN "turnoverRate" IS NOT NULL THEN "circMv" ELSE 0 END) > 0
              THEN SUM("turnoverRate" * "circMv")
                / SUM(CASE WHEN "turnoverRate" IS NOT NULL THEN "circMv" ELSE 0 END)
            ELSE NULL
          END AS "floatWeightedTurnoverRate",
          CASE
            WHEN SUM(COALESCE("amount", 0)) > 0
              THEN SUM(
                CASE
                  WHEN "marketAmountRank" <= ("marketRowCount" + 19) / 20
                    THEN COALESCE("amount", 0)
                  ELSE 0
                END
              ) / SUM(COALESCE("amount", 0))
            ELSE NULL
          END AS "topFivePercentAmountShare",
          AVG(CASE WHEN "pctChg" IS NOT NULL THEN ABS("pctChg") >= 5 END) AS "extremeMoveRatio",
          SUM(
            CASE
              WHEN "upLimit" IS NOT NULL AND "rawClose" >= "upLimit" - 0.0001 THEN 1
              ELSE 0
            END
          ) AS "limitUpCount",
          SUM(
            CASE
              WHEN "downLimit" IS NOT NULL AND "rawClose" <= "downLimit" + 0.0001 THEN 1
              ELSE 0
            END
          ) AS "limitDownCount"
        FROM market_state_market_ranked
        GROUP BY "tradeDate"
      `);

      await transaction.$executeRawUnsafe(`
        INSERT INTO "IndexIndicator" (
          "indexCode",
          "tradeDate",
          "membershipDate",
          "tradedCount",
          "return20",
          "advanceRatio",
          "aboveMa20Ratio",
          "aboveMa60Ratio",
          "totalAmount",
          "floatWeightedTurnoverRate",
          "topFivePercentAmountShare",
          "extremeMoveRatio",
          "limitUpCount",
          "limitDownCount"
        )
        SELECT
          ranked."indexCode",
          ranked."tradeDate",
          MAX(ranked."membershipDate") AS "membershipDate",
          COUNT(*) AS "tradedCount",
          close."return20",
          AVG(CASE WHEN ranked."pctChg" IS NOT NULL THEN ranked."pctChg" > 0 END)
            AS "advanceRatio",
          AVG(
            CASE
              WHEN ranked."observations20" = 20
                THEN ranked."adjustedClose" > ranked."ma20"
              ELSE NULL
            END
          ) AS "aboveMa20Ratio",
          AVG(
            CASE
              WHEN ranked."observations60" = 60
                THEN ranked."adjustedClose" > ranked."ma60"
              ELSE NULL
            END
          ) AS "aboveMa60Ratio",
          SUM(COALESCE(ranked."amount", 0)) AS "totalAmount",
          CASE
            WHEN SUM(
              CASE WHEN ranked."turnoverRate" IS NOT NULL THEN ranked."circMv" ELSE 0 END
            ) > 0
              THEN SUM(ranked."turnoverRate" * ranked."circMv")
                / SUM(
                  CASE WHEN ranked."turnoverRate" IS NOT NULL THEN ranked."circMv" ELSE 0 END
                )
            ELSE NULL
          END AS "floatWeightedTurnoverRate",
          CASE
            WHEN SUM(COALESCE(ranked."amount", 0)) > 0
              THEN SUM(
                CASE
                  WHEN ranked."indexAmountRank" <= (ranked."indexRowCount" + 19) / 20
                    THEN COALESCE(ranked."amount", 0)
                  ELSE 0
                END
              ) / SUM(COALESCE(ranked."amount", 0))
            ELSE NULL
          END AS "topFivePercentAmountShare",
          AVG(
            CASE WHEN ranked."pctChg" IS NOT NULL THEN ABS(ranked."pctChg") >= 5 END
          ) AS "extremeMoveRatio",
          SUM(
            CASE
              WHEN ranked."upLimit" IS NOT NULL
                AND ranked."rawClose" >= ranked."upLimit" - 0.0001
                THEN 1
              ELSE 0
            END
          ) AS "limitUpCount",
          SUM(
            CASE
              WHEN ranked."downLimit" IS NOT NULL
                AND ranked."rawClose" <= ranked."downLimit" + 0.0001
                THEN 1
              ELSE 0
            END
          ) AS "limitDownCount"
        FROM market_state_index_ranked ranked
        JOIN market_state_index_close close
          ON close."indexCode" = ranked."indexCode"
          AND close."tradeDate" = ranked."tradeDate"
        GROUP BY ranked."indexCode", ranked."tradeDate"
      `);

      await transaction.$executeRawUnsafe(`
        INSERT INTO "IndustryIndicator" (
          "l1Code",
          "l1Name",
          "tradeDate",
          "tradedCount",
          "return20",
          "excessReturn20",
          "positiveReturn20Ratio",
          "aboveMa20Ratio",
          "aboveMa60Ratio",
          "floatWeightedTurnoverRate",
          "amountShare",
          "topFiveAmountShare"
        )
        SELECT
          ranked."l1Code",
          MAX(ranked."l1Name") AS "l1Name",
          ranked."tradeDate",
          COUNT(*) AS "tradedCount",
          AVG(ranked."return20") AS "return20",
          AVG(ranked."return20") - market."return20" AS "excessReturn20",
          AVG(CASE WHEN ranked."return20" IS NOT NULL THEN ranked."return20" > 0 END)
            AS "positiveReturn20Ratio",
          AVG(
            CASE
              WHEN ranked."observations20" = 20
                THEN ranked."adjustedClose" > ranked."ma20"
              ELSE NULL
            END
          ) AS "aboveMa20Ratio",
          AVG(
            CASE
              WHEN ranked."observations60" = 60
                THEN ranked."adjustedClose" > ranked."ma60"
              ELSE NULL
            END
          ) AS "aboveMa60Ratio",
          CASE
            WHEN SUM(
              CASE WHEN ranked."turnoverRate" IS NOT NULL THEN ranked."circMv" ELSE 0 END
            ) > 0
              THEN SUM(ranked."turnoverRate" * ranked."circMv")
                / SUM(
                  CASE WHEN ranked."turnoverRate" IS NOT NULL THEN ranked."circMv" ELSE 0 END
                )
            ELSE NULL
          END AS "floatWeightedTurnoverRate",
          CASE
            WHEN market."totalAmount" > 0
              THEN SUM(COALESCE(ranked."amount", 0)) / market."totalAmount"
            ELSE NULL
          END AS "amountShare",
          CASE
            WHEN SUM(COALESCE(ranked."amount", 0)) > 0
              THEN SUM(
                CASE
                  WHEN ranked."industryAmountRank" <= 5 THEN COALESCE(ranked."amount", 0)
                  ELSE 0
                END
              ) / SUM(COALESCE(ranked."amount", 0))
            ELSE NULL
          END AS "topFiveAmountShare"
        FROM market_state_ranked ranked
        JOIN "MarketIndicator" market
          ON market."tradeDate" = ranked."tradeDate"
        WHERE ranked."l1Code" IS NOT NULL
        GROUP BY ranked."l1Code", ranked."tradeDate"
      `);

      await transaction.$executeRawUnsafe('DROP TABLE market_state_ranked');
      await transaction.$executeRawUnsafe('DROP TABLE market_state_index_ranked');
      await transaction.$executeRawUnsafe('DROP TABLE market_state_index_close');
      await transaction.$executeRawUnsafe('DROP TABLE market_state_index_members');
      await transaction.$executeRawUnsafe('DROP TABLE market_state_market_ranked');
      await transaction.$executeRawUnsafe('DROP TABLE market_state_panel');
    },
    { maxWait: 30_000, timeout: 30 * 60_000 },
  );

  const [marketRows, indexRows, industryRows] = await Promise.all([
    prisma.marketIndicator.count({
      where: { tradeDate: { gte: slice.start, lte: slice.end } },
    }),
    prisma.indexIndicator.count({
      where: { tradeDate: { gte: slice.start, lte: slice.end } },
    }),
    prisma.industryIndicator.count({
      where: { tradeDate: { gte: slice.start, lte: slice.end } },
    }),
  ]);
  log(
    `  stored ${marketRows} market days / ${indexRows} index days / ${industryRows} industry days`,
  );
}

async function paddedStart(start: string, observations: number): Promise<string> {
  const previousDates = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lt: start } },
    orderBy: { calDate: 'desc' },
    take: observations,
    select: { calDate: true },
  });
  return previousDates.at(-1)?.calDate ?? start;
}

function yearlySlices(start: string, end: string): DateSlice[] {
  const slices: DateSlice[] = [];
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));

  for (let year = startYear; year <= endYear; year++) {
    slices.push({
      start: year === startYear ? start : `${year}0101`,
      end: year === endYear ? end : `${year}1231`,
    });
  }

  return slices;
}

function validateRange(start: string, end: string): void {
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end) || start > end) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
}
