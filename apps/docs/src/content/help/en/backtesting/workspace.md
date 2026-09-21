# Understand the Strategy workbench

The Strategy workbench is where you write a strategy, choose a historical period, run the backtest, and inspect its result. Learn the page areas before changing a strategy.

## Open the workspace

1. Sign in and select **Strategy** in the top navigation.
2. Select **New** to create a strategy.
3. Describe the rules in the input, or choose to write the code directly.
4. Reopen a saved strategy from **History**.

If you only want to complete the basic workflow first, follow [Run your first backtest](/help/getting-started/first-backtest).

## Page areas

The numbered areas are:

1. **Strategy conversation and history**: check the strategy name, request a change, reopen a saved strategy, or create one.
2. **Strategy code**: the rules that the backtest actually executes. Direct code editing is an advanced operation.
3. **Results**: edit run settings, start a backtest, and inspect metrics, charts, and trades.
4. **Logs**: system progress and any `console` output produced by the strategy.

![Strategy, code, results, and logs in the Strategy workbench](/docs/images/help/en/backtesting/workspace-01.png)

Drag the dividers to resize the areas. On a narrow screen, collapse an area you do not currently need.

## How the description relates to the code

After you describe a strategy on the left, its code appears in the middle. The middle code—not the displayed name—is what the backtest executes. Before running, verify at least:

- The stock or ETF code.
- Buy, sell, and rebalance conditions.
- Quantity, frequency, and date logic.
- Parameters used by the strategy.

If the rules differ from your description, request the required change before running the backtest.

## Open a historical strategy

1. Select **History** on the left.
2. Select the strategy you want.
3. Wait for its name, code, and previous result to load.
4. Check whether the displayed dates and capital still fit the run you intend to make.

After changing code or run settings, run the backtest again. The previous result does not represent changes that have not been run.

## Distinguish the draft, report, and deployment

The editor and top run settings belong to the current strategy draft. The results belong to the run selected in **Backtest report history**. Selecting a historical report updates the result and benchmark curves; **it does not restore that report's code or settings into the editor**. The draft dates at the top may therefore differ from the selected report's dates.

- To calculate the current draft, check its code and settings and select **Run backtest**.
- To inspect an old result, select it in **Backtest report history**. Select **Compare** and a second report to compare results.
- To study a report further, select **Review in Research** to create a document reading that report in a new tab.
- To deploy, select an eligible successful report and choose **Deploy**. A deployment fixes that report; later draft changes do not alter it or automatically pause other deployments.

See [Read backtest results](/docs/help/backtesting/results-overview) and [Deploy a backtest report](/docs/help/signals/deploy-strategy).

## Check data in the conversation

The Agent can write and explain a strategy. You still start a complete backtest explicitly with **Run backtest**. After opening a completed report, select **Use selected report**, or use **Reference data** for additional sources, then ask your question.

Calculations appear as embedded analysis cards. Open **Code, sources and history** to inspect actual inputs and Python, or recover runs from **Analysis history** and **Continue in Research**. These calculations read existing data; they do not execute the strategy again. See [Embedded analysis](/docs/help/research/embedded-analysis).

## Common problems

### The new-strategy page is not visible

The workspace may automatically reopen a recent strategy. Select **New** in the upper-left area to create another one.

### A warning says there are unrun changes

The code or settings have changed but have not been used in a completed backtest. Run the backtest if you want to keep the changes; discard them only when they are not needed.

### The code is unfamiliar

Start by checking the name, security code, direction, quantity, and frequency. You do not need to understand every line for the first run. See the [Strategy SDK](/docs/sdk) when you are ready to edit code directly.

**1** is the current draft configuration, **2** selects a report, **3** compares reports, and **4** opens Research review. This strategy has only one report, so Compare is disabled.

![Current interface and controls](/docs/images/help/en/backtesting/report-controls.png)

## Related articles

- [Set backtest parameters](/help/backtesting/run-settings)
- [Run a backtest and inspect logs](/help/backtesting/run-and-logs)
- [Strategies and backtests](/help/basics/strategy-backtest)

