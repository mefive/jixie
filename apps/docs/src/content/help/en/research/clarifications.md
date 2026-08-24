# Answer a research-definition clarification

When an instrument, currency, tenor, or data form in the question does not exactly match available platform data, Research Agent shows a **Needs confirmation** card instead of silently substituting similar data. The Agent continues changing Cells only after you make an explicit choice.

## Why a clarification is required

USD spot gold, a continuous SHFE gold future, and a gold ETF all relate to gold, but their markets, quote currencies, costs, and tracking behavior differ. Quietly treating one as another changes the research question.

The card states the original issue, the executable choices, and how each choice differs from the original definition. It is not a recommendation list, and the first option is not automatically better.

## Answer the card

1. Read the card title and question. Identify whether the decision concerns an instrument, tenor, market, or another definition.
2. Read the description under every option, including currency, instrument form, tenor, and proxy limitations.
3. Select an executable definition when it matches the research purpose.
4. Select **Do not substitute** when you do not want to change the original definition. The research keeps the data gap explicit.
5. When available, use **Or enter your specific choice…** to provide a more precise requirement.
6. Select **Confirm choices** in the lower-right corner of the card.

![A pending research-definition clarification](/docs/images/help/zh/research/clarifications-01.png)

## What happens after confirmation

- The status changes from **Needs confirmation** to **Confirmed**, and the answer remains in the research record.
- Research Agent starts the next step from that choice. Any Cell change still enters review.
- The confirmed card remains visible after a refresh or after reopening the document.
- Confirmation fixes this study's definition. It does not make a proxy equivalent to the original object and does not run a Cell.

![A persisted confirmed research definition](/docs/images/help/zh/research/clarifications-02.png)

## Why ordinary input pauses

While a clarification needs confirmation, the right-side composer says **Answer the research clarification above to continue** and is disabled. This prevents contradictory definitions and Cell proposals from being created in the same turn. Answer the current card before adding another request.

## Common questions

### None of the options is suitable

Select **Do not substitute**, or provide the exact requirement when a custom answer is available. Do not choose an unsuitable proxy merely to continue.

### Can I overwrite a mistaken answer?

A confirmed card remains part of the research record and is not silently rewritten. Tell the Agent that the definition must change. If the new instruction is still ambiguous, another clarification may be required.

### Why is there still no result after confirmation?

Confirmation only lets the Agent prepare the next change. You must still review the Cell diff, accept the source, and explicitly run the affected Cells.

## Related articles

- [Collaborate with Research Agent](/docs/help/research/agent-collaboration)
- [Use the research data catalog](/docs/help/research/data-catalog)
- [Run, stop, and reset research](/docs/help/research/run-control)
