# Publish a factor version

Publication fixes the current factor code and a matching successful analysis report as an immutable version that strategies reference by a stable key. The report's parameters, sample range and results are retained with it.

## Requirements

- The current definition is an owned draft.
- The selected successful report belongs to the same user and factor.
- Code, analysis kind, language and runtime match the report.
- Inputs meet the current analysis kind's data requirements; controlled commodity research templates remain ineligible for publication.

Positive returns or statistical significance are not required. Publication records a version; it does not certify investment quality.

## Steps

1. Review the source, choose dates and parameters, and run an analysis.
2. Read the report and confirm it represents the current code.
3. Select **Publish version**, check the key and report, and confirm.
4. Reference that exact factor key in a strategy.

Publication fixes the source and report in one action, with no separate sealing step.

## Changes and archive

A published version cannot be edited or overwritten. Copy it to a new draft, change and analyze it, then publish under a new key. A new version does not replace references in existing strategies. Archiving prevents new use without rewriting the saved code and report.

## Related articles

- [Retained reports and outdated results](/docs/help/factors/report-history)
- [Use a factor in a strategy](/docs/help/factors/factor-in-strategy)
