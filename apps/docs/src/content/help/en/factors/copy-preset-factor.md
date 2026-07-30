# Copy a preset factor

Preset factor code is read-only. To change its calculation, first copy it to a custom factor and edit the copy.

## Before you start

- You are signed in.
- **Factor Research** is open.
- You know which preset you want to use as the starting point.

Copying creates editable code. It does not change the original preset.

## Select and copy the preset

1. Select **Factor library** on the left.
2. Under **Preset factors**, select a factor. The example below uses **Earnings yield (1/PE_TTM)**.
3. Confirm that the middle panel identifies the code as a read-only preset.
4. Read the code and confirm that it is the calculation you want to modify.
5. Select **Copy as custom**.

The numbered areas are:

1. Factor library.
2. Selected preset factor.
3. Read-only notice.
4. **Copy as custom**.
5. Preset calculation code.

![Select and copy a read-only preset factor](/docs/images/help/zh/factors/factor-custom-copy-01.png)

## Confirm the copy

The new copy opens automatically. The numbered areas are:

1. Custom-factor label.
2. New entry under Custom factors.
3. Strategy key that has not yet been confirmed.
4. Editable factor code.

![A custom factor immediately after copying a preset](/docs/images/help/zh/factors/factor-custom-copy-02.png)

At this point:

- The copy and the preset are independent. Editing the copy does not change the preset.
- The calculation code is copied, but previous reports are not. Run a separate analysis for the copy.
- The new factor does not yet have a fixed key for strategy code.
- You may change its name and code before running the first analysis.

## Next steps

1. Edit the code in the middle panel.
2. Select **Run analysis** to create a report from the current code.
3. Review the code and report before confirming a strategy key.
4. A locked strategy key is required only when strategy code needs to use this factor.

## Common questions

### Copy as custom is not visible

Confirm that a preset factor is selected. The action is not shown for an existing custom factor.

### Why did the previous report not follow the copy?

A report belongs to the original factor and the code used for that run. The new copy needs its own analysis.

### Can I copy the same preset more than once?

Yes. Each copy is independent. Give each one a name that clearly describes the difference.

## Related articles

- [Create and edit a custom factor](/docs/help/factors/create-custom-factor)
- [Confirm the strategy key](/docs/help/factors/strategy-key)
- [Run your first preset factor analysis](/docs/help/factors/first-preset-analysis)
