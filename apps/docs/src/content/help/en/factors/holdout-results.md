# Formal holdout and out-of-sample results

A formal holdout is a recent period reserved in advance and excluded from inspection and adjustment. The page labels these records `Holdout`.

It asks:

> Does the relationship remain when the frozen explore code, settings, and criterion are applied to data that was not used for tuning?

## Explore range and holdout

The platform normally reserves about the latest 18 calendar months before the newest available trading day:

- An explore report ends before the holdout.
- The formal holdout report uses the later period.
- The server's latest market date and trading calendar determine the actual boundary, not the date on your computer.

Dates in the screenshots change as data is updated and do not need to match your page.

## Which explore reports are eligible

**Validate holdout** appears only when the explore report meets the rules. The main requirements are:

1. The report finished successfully.
2. Its research card used hypothesis mode with a clear direction and primary criterion.
3. The explore end date did not enter the holdout.
4. The holdout contains enough monthly or weekly observations.
5. The explore report has no completed or running formal holdout.
6. The same factor-code snapshot has not already observed this period in the current account.

When a report is ineligible, the research bar explains why, such as a missing hypothesis card or an explore range that crosses into the holdout.

These rules can only constrain research history inside the platform. If you already inspected the same dates elsewhere, the platform cannot make them unobserved again.

## Start formal holdout validation

1. Open an eligible explore report.
2. Select **Validate holdout**.
3. Verify the dates.
4. Verify the frozen code fingerprint, expected direction, and primary criterion.
5. Confirm the run.

The numbered areas below are:

1. The formal holdout confirmation.
2. The holdout date range.
3. The frozen code fingerprint and pre-registered criterion.
4. Confirm the run.

![Confirming the frozen code and criterion for a formal holdout](/docs/images/help/zh/factors/factor-holdout-confirm-01.png)

The holdout uses the explore report's saved code and non-date settings. If the editor changed later, validation still uses the old report's code snapshot.

## Why the completed result is hidden

After computation, the formal holdout stays sealed. The page does not show metrics, charts, or result numbers in logs before reveal.

The numbered areas below are:

1. The actual holdout date range.
2. Computation is complete while the result remains sealed.
3. **Reveal result**.

![A completed formal holdout with its result still sealed](/docs/images/help/zh/factors/factor-holdout-sealed-01.png)

Explore and holdout reports remain separate records in history:

![Explore and sealed holdout reports in report history](/docs/images/help/zh/factors/factor-holdout-history-01.png)

Sealing prevents you from seeing a number first and then deciding whether to call it a formal validation.

## Reveal the result

When ready:

1. Select **Reveal result**.
2. Read the irreversible-action notice.
3. Confirm **Reveal result** again.

The numbered areas below are:

1. Reveal confirmation.
2. The notice that this period will no longer be unobserved.
3. Final confirmation.

![Irreversible confirmation before revealing a holdout](/docs/images/help/zh/factors/factor-reveal-confirm-01.png)

The first reveal time is written permanently. You can reopen the report later, but you cannot describe the same period as never observed again.

## Read the revealed report

The full report appears after reveal and compares the result with the pre-registered primary criterion.

The numbered areas below are:

1. Whether the primary criterion was met and the first reveal time.
2. Holdout sample range and direction.
3. Holdout D1–D10 group results.

![A revealed formal holdout and primary-criterion result](/docs/images/help/zh/factors/factor-holdout-revealed-01.png)

The page judges only the selected primary criterion. If the card recorded `Mean Rank IC > 0`, the message uses that rule alone.

### If the primary criterion was met

Do not conclude that the factor is automatically valid. Continue checking:

- Whether a few months produced most of the Rank IC.
- Whether D1–D10 are reasonably ordered.
- ICIR and positive-rate consistency.
- Net-of-cost performance, turnover, and maximum drawdown.
- Size and industry neutralization.
- Correlation with existing factors.

### If the primary criterion was not met

Do not immediately change code or threshold and call another test on the same dates “formal out-of-sample.” The period has already been observed.

Record it as contrary evidence, investigate possible reasons, and formulate a later study using newly accumulated data or another independent source. A failed holdout is still useful evidence.

## A holdout is not the future

A formal holdout is stricter than an in-sample report, but it is still historical data. It cannot eliminate:

- Changes in market rules or participant behavior.
- Data-quality problems.
- Underestimated trading costs or capacity.
- Chance.
- Further decay after the result is revealed.

It is one part of an evidence chain, not automatic factor approval or permission to trade.

## Related articles

- [Pre-run research cards and variants](/help/factors/research-card)
- [Report history and outdated results](/help/factors/report-history)
- [Turnover, trading costs, and net returns](/help/factors/turnover-costs)
- [Factor correlation matrix](/help/factors/correlation-matrix)
