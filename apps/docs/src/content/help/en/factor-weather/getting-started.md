# Get started with Factor Weather

Factor Research tests whether a definition has historical evidence under an explicit sample and method. Factor Weather continuously monitors whether an accepted factor has recently been in a favorable, unfavorable, weakening, or recovering phase. They are separate pages, and Factor Weather does not change an existing research report.

## Open the page

1. Select **Factor Weather** in the top navigation after sign-in.
2. Read the fixed method: month-end rebalancing, industry and size neutralization, equal-weight deciles, and complete months only.
3. Pinned presets and custom factors appear in separate groups.
4. On your first visit, select **Pin factor**.

The numbered areas are:

1. Factor Weather page and fixed method.
2. Preset and custom factor groups.
3. Monthly factor cards.
4. Action for adding a card.

![Factor Weather page and pinned factors](/docs/images/help/zh/factor-weather/factor-weather-overview-01.png)

The fixed method makes cards comparable. You cannot change the decile count, neutralization, or costs on this page after seeing the results and keep only the most attractive version.

## Pin a factor

1. Select **Pin factor** in the upper-right corner.
2. Choose an unpinned preset or a published custom Factor.
3. A preset uses its system-defined direction.
4. For a custom factor, choose **Higher values first** or **Lower values first**.
5. Check the direction, then select **Pin and backfill**.
6. Wait for the monthly history to finish.

![Choose a published Factor and expected direction](/docs/images/help/zh/factor-weather/factor-weather-pin-01.png)

Direction only aligns color and return so that a result matching the expectation is positive. The system retains raw Rank IC and raw group returns and does not change factor code.

## Which factors can be pinned

- A preset can be selected directly and has a product-defined expected direction.
- A custom Factor must first be published with an approved report in Factor Research.
- A custom factor still in draft is disabled.
- Factor composites cannot currently be pinned.
- The same Factor cannot be pinned twice.

Pinning stores another snapshot of the Factor code, name, direction, and method. A published Factor is already immutable and cannot be deleted. To iterate, copy it to an independent draft, then research and publish the copy.

## Wait for the first backfill

After pinning, a background job calculates from the available historical start through the latest complete month. A long-window factor can take several minutes. You may leave the page; the calculation does not depend on the browser staying open.

If a card shows **Calculation failed**, read the error and select **Recalculate**. A card cannot be unpinned while it is calculating, which prevents data still being written from being deleted.

## Unpin a factor

After a calculation completes or fails, choose **Unpin**. Confirmation removes the card and its monthly observations, but it does not delete the factor or any immutable research report.

Unpinning is not a hide action. Pinning it again later regenerates the history under the current method.

## Important limits

- Factor Weather is not a real-time stock screener.
- It shows completed months only and does not display a partial current month.
- A single red or green month cannot replace research logic, holdout evidence, and cost checks.
- Cards use one method, but their factors can still have different economic meanings.

## Related articles

- [Read Factor Weather cards](/docs/help/factor-weather/read-cards)
- [What factor research can answer](/docs/help/factors/what-factor-research)
- [Set a Factor key](/docs/help/factors/strategy-key)
- [Formal holdout and out-of-sample results](/docs/help/factors/holdout-results)
