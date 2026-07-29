# Edit conditions and sorting

After a result appears, edit the conditions at the top directly. You do not need to rewrite the original request. Each edit runs the screen again.

## Edit a condition

![Condition chip, Add condition button, and sort control](/help/zh/screening/edit-sort-01.png)

A condition is marked **1**. From left to right it contains:

1. Field, such as PE(TTM).
2. Operator, such as `<`.
3. Value, such as `15`.
4. Unit, when the field has one.
5. Remove button `×`.

### Change the operator

1. Select the current operator.
2. Choose `>`, `≥`, `<`, or `≤`.
3. Wait for the table to update.

### Change the value

1. Select the value.
2. Enter the new number.
3. Press Enter or select outside the input.
4. Wait for the snapshot summary and table to update.

Do not type the unit again. For dividend yield, enter `3`; the `%` is already displayed.

### Remove a condition

Select `×` at the right of the condition. The remaining conditions run immediately.

## Add a condition

Add condition is marked **2**:

1. Select Add condition.
2. Select a field.
3. The page inserts a default operator and value.
4. Adjust both as needed.
5. Wait for the result and check the match count.

A field already in use is not listed again.

## Change sorting

The sort control is marked **3**:

1. Select the current field, such as Total market cap.
2. Select another field or No sort.
3. Use the direction button to switch between high-to-low and low-to-high.
4. Compare the first rows to confirm the order.

Sorting changes row order, not which stocks satisfy the conditions.

## Save changes explicitly

Editing a screen does not silently overwrite a previously saved screen. To keep the new rules:

1. Enter a recognizable name at the top.
2. Select Save screen.
3. Confirm the new item under Saved screens.

## Common problems

### The table briefly becomes muted

The page is running the updated screen. Wait for it to finish before making another edit.

### No stocks remain after adding a condition

The combination may be too strict. Remove the new condition, confirm that results return, and try a less restrictive value.

### The sort direction is unclear

Check the button tooltip and compare the values in the first two rows.

## Related articles

- [Screen by criteria and inspect results](/help/screening/filter-results)
- [Save and rerun a screen](/help/screening/save-reuse)
