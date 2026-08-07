# Set a Factor key

A Factor key is the unique English identifier used by strategy code. It is different from the display name, is chosen when the Factor is created, and cannot be changed afterward.

## Before you start

Complete these checks first:

1. Choose an identifier that can describe the research for a long time.
2. Avoid temporary experiment numbers or mechanically copying the display name.
3. To revise a published Factor, use **Copy** and keep or edit the suggested `_vN` key for the independent draft.

## Enter the key when creating

1. Select **New** on the Factors page.
2. Choose the research method.
3. Enter a display name, which may be Chinese or English.
4. Enter the unique key and confirm creation.

The name may contain lowercase letters, digits, and underscores. It must start with a letter and contain at most 32 characters. For example:

```text
help_book_to_market
```

The complete key displayed after creation is the strategy reference:

```text
help_book_to_market
```

The product does not add a `custom:` or release-version prefix. A key cannot conflict with another Factor owned by the same user or with a built-in key. Creation fails on conflict so the user can choose an explicit alternative.

## Display name and Factor key

| Item | Example | Can it change? |
| --- | --- | --- |
| Factor display name | Book-to-market (custom) | Yes |
| Factor key | `help_book_to_market` | No, after creation |

The display name is for reading in the interface and may contain Chinese text. The Factor key is a stable code reference.

A draft can be edited and analyzed again. After publication, the name, code, and research definition are immutable. Use **Copy** to create an independent draft with a suggested `_v2` or `_v3` key.

## Naming guidance

- Use a name that describes the calculation, such as `book_to_market`.
- Avoid dates, temporary experiment numbers, or labels such as `final`.
- Avoid names such as `factor1` or `test` that will be hard to identify later.
- Check spelling before creation because the value cannot be edited later.

## Common questions

### Create is disabled

Check that the name and key are present, the key uses allowed characters, the first character is a letter, and its length does not exceed 32 characters.

### Can I delete a Factor after creation?

Drafts can be deleted. A published Factor cannot be deleted, only archived. Archived Factors are removed from new-strategy completion, while existing deployments continue using their frozen dependency.

### Does changing the display name affect a strategy?

No. Strategy code uses the Factor key, not the display name.

## Related articles

- [Create and edit a custom factor](/docs/help/factors/create-custom-factor)
- [Use a custom factor in a strategy](/docs/help/factors/factor-in-strategy)
- [Report history and outdated results](/docs/help/factors/report-history)
