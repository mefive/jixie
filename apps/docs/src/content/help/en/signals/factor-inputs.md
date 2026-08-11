# Verify the Factors used by a signal

After a strategy using published Factors generates Today signals, the page shows Factor inputs for this decision. It records the values actually read on the signal date and helps explain the source of orders.

## Open Factor inputs

1. Complete a backtest that uses a Factor.
2. Deploy the current backtest version.
3. Open Today signals and click Generate now.
4. After completion, find Factor inputs for this decision above the instructions.

The numbered areas are the published Factor key, valid and observed assets, mean valid value, and values read for decision assets.

![Factor inputs actually read by Today signals](/docs/images/help/zh/signals/factor-inputs-01.png)

## Columns

- **Factor** is the published key frozen by the deployment.
- **Valid / observed** compares assets with a usable value with all assets watched by the strategy.
- **Mean** is a quick average of valid values, not a portfolio weight.
- **Decision asset values** are the values actually used in ranking or conditions.

A strategy can observe nine assets and trade two. Coverage describes data availability; decision values describe the inputs. Neither means an order has already been placed.

## Report, input, and order are different

A Factor report validates a historical relationship. A Factor input is the prediction snapshot on one signal date. The strategy converts inputs into target weights. Orders are differences between target and current model holdings.

A positive value does not necessarily cause a buy, and the highest value does not imply a 100% position. Thresholds, ranks, holding count, cash, and execution constraints come from the frozen strategy.

## Troubleshooting

For low coverage, inspect the run log and allowed assets. New listings, insufficient history, cutoffs, or missing inputs can create nulls; the system does not replace them with zero.

The panel is absent for strategies that do not read published Factors. Older deployments may lack the lineage snapshot and should be rerun and redeployed.

If a value seems different from a research report, remember that the report shows historical aggregate metrics rather than one day's raw score. Verify the signal date, asset, horizon, and frozen Factor ID and code hash.

## Related articles

- [Deploy a backtested strategy](/docs/help/signals/deploy-strategy)
- [Generate Today signals](/docs/help/signals/generate-signals)
- [Read signal instructions](/docs/help/signals/read-signals)
- [Publish a Factor and use it in a strategy](/docs/help/factors/publish-factor)
