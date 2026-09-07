import {
  RESEARCH_FINANCIAL_FIELDS_V1,
  RESEARCH_FINANCIAL_PERIODS_V1,
  type ResearchFinancialPeriodV1,
} from '@jixie/shared';
import type { PrismaClient } from '@prisma/client';

import { normalizeCumulativeFlows } from '../fundamentals/normalize.js';
import {
  resolveFinancialStates,
  type ResolvedFinancialStatement,
} from '../fundamentals/resolver.js';
import { canonicalStockCode } from '../market/stock-identity.js';
import { prisma } from '../lib/prisma.js';
import { normalizeFinancialFields, validateFinancialReportRange } from './financial-dataset.js';

export interface ResearchFinancialValuesRequestV1 {
  identifiers: string | string[];
  as_of: string;
  fields: string | string[];
  report_start: string;
  report_end: string;
  period?: ResearchFinancialPeriodV1;
}

/** Read bounded, explicitly selected fields without applying industrial valuation formulas. */
export async function loadResearchFinancialValues(
  request: ResearchFinancialValuesRequestV1,
  database: PrismaClient = prisma,
) {
  const identifiers =
    typeof request.identifiers === 'string' ? [request.identifiers] : request.identifiers;
  if (identifiers.length < 1 || identifiers.length > 100) {
    throw new Error('Select 1-100 unique A-share identifiers.');
  }
  const codes = identifiers.map(canonicalStockCode);
  if (new Set(codes).size !== codes.length) {
    throw new Error('Financial identifiers must be unique after canonicalization.');
  }
  const selected = normalizeFinancialFields(request.fields);
  if (!selected || !request.report_start || !request.report_end) {
    throw new Error('fields, report_start, and report_end are required.');
  }
  validateFinancialReportRange(request.as_of);
  validateFinancialReportRange(request.report_start, request.report_end);
  const firstYear = Number(request.report_start.slice(0, 4));
  const lastYear = Number(request.report_end.slice(0, 4));
  if (lastYear - firstYear >= 20) {
    throw new Error('Select at most 20 reporting calendar years.');
  }
  const period = request.period ?? 'reported';
  if (!RESEARCH_FINANCIAL_PERIODS_V1.includes(period)) {
    throw new Error('Unsupported financial period basis.');
  }
  const definitions = RESEARCH_FINANCIAL_FIELDS_V1.filter((field) => selected.has(field.key));
  const expectedPeriods: string[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (const suffix of period === 'annual' ? ['1231'] : ['0331', '0630', '0930', '1231']) {
      const date = `${year}${suffix}`;
      if (date >= request.report_start && date <= request.report_end) {
        expectedPeriods.push(date);
      }
    }
  }
  if (expectedPeriods.length * codes.length * definitions.length > 100_000) {
    throw new Error('Financial values exceed the 100000-row budget; narrow the request.');
  }

  // Load prerequisite quarters before applying the requested output window.
  const states = await resolveFinancialStates(
    {
      tsCodes: codes,
      asOfDate: request.as_of,
      purpose: 'statements',
      reportStart: `${firstYear - 2}0101`,
      reportEnd: request.report_end,
    },
    database,
  );
  const result = states.flatMap((state) => {
    const statements: ResolvedFinancialStatement[] = state.periods.flatMap((entry) =>
      [entry.income, entry.balanceSheet, entry.cashFlow].filter(
        (statement): statement is ResolvedFinancialStatement => statement != null,
      ),
    );
    const byFingerprint = new Map(
      statements.map((statement) => [statement.sourceRowFingerprint, statement]),
    );
    return definitions.flatMap((definition) => {
      const sources = statements.filter(
        (statement) => statement.statementKind === definition.statementKind,
      );
      const byPeriod = new Map(sources.map((statement) => [statement.endDate, statement]));
      const converted =
        definition.semantics === 'flow_ytd' && (period === 'quarterly' || period === 'ttm')
          ? normalizeCumulativeFlows<string>(
              sources.map((statement) => ({
                statementKind: definition.statementKind as 'income' | 'cash_flow',
                endDate: statement.endDate,
                sourceRowFingerprint: statement.sourceRowFingerprint,
                values: statement.values as Record<string, number | null>,
              })),
              [definition.field],
            )
          : undefined;
      const convertedByPeriod = new Map(
        (period === 'ttm' ? converted?.trailingTwelveMonths : converted?.quarterly)?.map(
          (entry) => [entry.endDate, entry.values[definition.field]],
        ) ?? [],
      );
      const dates = [
        ...new Set([
          ...expectedPeriods,
          ...sources
            .map((statement) => statement.endDate)
            .filter(
              (date) =>
                date >= request.report_start &&
                date <= request.report_end &&
                (period !== 'annual' || date.endsWith('1231')),
            ),
        ]),
      ].sort();
      return dates.map((date) => {
        const statement = byPeriod.get(date);
        const raw = statement
          ? ((statement.values as Record<string, number | null>)[definition.field] ?? null)
          : null;
        const standardized = convertedByPeriod.get(date);
        const value = converted ? (standardized?.value ?? null) : raw;
        const sourceVersions = statement ? [statement.sourceRowFingerprint] : [];
        const inputVersions = converted
          ? (standardized?.inputVersions ?? sourceVersions)
          : sourceVersions;
        const ambiguity = state.diagnostics.find(
          (diagnostic) =>
            diagnostic.endDate === date &&
            diagnostic.statementKind === definition.statementKind &&
            ['ambiguous_latest_statement_version', 'reconstructed_only_period'].includes(
              diagnostic.code,
            ),
        );
        const missingReason =
          value != null
            ? null
            : (standardized?.missingReason ??
              ambiguity?.code ??
              (!statement
                ? state.applicability === 'unsupported_financial' && statements.length === 0
                  ? 'financial_sector_source_not_integrated'
                  : 'no_statement_available_as_of'
                : converted
                  ? 'non_standard_report_period'
                  : 'missing_source_field'));
        const basis = definition.semantics === 'stock' ? 'point_in_time' : period;
        const formula =
          basis === 'quarterly'
            ? 'Q1 = YTD; Qn = YTD(n) - YTD(n-1)'
            : basis === 'ttm'
              ? 'Q4 = annual YTD; other quarters = sum of four continuous single quarters'
              : 'Selected source value; no valuation-model adjustment';
        const availableDates = inputVersions
          .map((fingerprint) => byFingerprint.get(fingerprint)?.availableDate)
          .filter((date): date is string => date != null)
          .sort();
        return {
          as_of_date: request.as_of,
          code: state.tsCode,
          industry: state.industry?.l1Name ?? null,
          applicability: state.applicability,
          report_period: date,
          statement_kind: definition.statementKind,
          field: definition.field,
          value,
          unit: definition.unit,
          available_date: availableDates.at(-1) ?? null,
          period_basis: basis,
          status: value == null ? 'missing' : 'ok',
          missing_reason: missingReason,
          formula,
          formula_version: 'financial-values-v1',
          input_versions_json: JSON.stringify(inputVersions),
        };
      });
    });
  });
  if (result.length > 100_000) {
    throw new Error('Financial values exceed the 100000-row budget.');
  }
  return result;
}
