# Confirm the strategy key

A strategy key is the fixed name that strategy code uses to reference a custom factor. It is different from the display name and cannot be changed after confirmation.

## Before you start

Complete these checks first:

1. Review the factor name and code.
2. Complete at least one analysis successfully.
3. Confirm that the factor needs to be used in a strategy.

You do not need to confirm a key immediately if the factor is only being researched.

## Enter the key

1. Open the custom factor.
2. Find **Strategy key** above the code.
3. Enter a recognizable name that can remain in use.
4. Select **Confirm and lock**.
5. Read the irreversible-change notice and confirm.

The name may contain lowercase letters, digits, and underscores. It must start with a letter and contain at most 32 characters. For example:

```text
help_book_to_market
```

The numbered areas are:

1. Strategy key label.
2. Key input.
3. **Confirm and lock**.
4. Naming rules and lock notice.

![Enter a strategy key before locking it](/docs/images/help/zh/factors/factor-strategy-key-01.png)

## Use the finalized value

After confirmation, the page shows the complete key:

```text
custom:help_book_to_market
```

The numbered areas are:

1. Strategy-key area.
2. Complete fixed key.
3. Locked status.

![A locked strategy key for a custom factor](/docs/images/help/zh/factors/factor-strategy-key-locked-01.png)

The product adds `custom:` to distinguish custom factors. Copy the complete value shown on the page into strategy code.

If the requested name is already in use, the finalized key may include an automatically added suffix. Do not infer the value from the text you entered; use the value displayed after locking.

## Display name and strategy key

| Item | Example | Can it change? |
| --- | --- | --- |
| Factor display name | Book-to-market (custom) | Yes |
| Strategy key | `custom:help_book_to_market` | No, after locking |

The display name is for reading in the interface and may contain Chinese text. The strategy key is a stable code reference.

You can still edit factor code after locking the key, but the key does not change with the code. After a code change, rerun the factor analysis and every affected backtest. An older result still belongs to the older code.

## Naming guidance

- Use a name that describes the calculation, such as `book_to_market`.
- Avoid dates, temporary experiment numbers, or labels such as `final`.
- Avoid names such as `factor1` or `test` that will be hard to identify later.
- Check spelling before locking because the value cannot be edited later.

## Common questions

### Confirm and lock is disabled

Check the allowed characters, confirm that the first character is a letter, and keep the name within 32 characters.

### Can I delete a factor after locking its key?

Before deletion, check which strategies still reference the key. Those strategies cannot read the custom factor after it is deleted.

### Does changing the display name affect a strategy?

No. Strategy code uses the complete locked key, not the display name.

## Related articles

- [Create and edit a custom factor](/docs/help/factors/create-custom-factor)
- [Use a custom factor in a strategy](/docs/help/factors/factor-in-strategy)
- [Report history and outdated results](/docs/help/factors/report-history)
