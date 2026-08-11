# Create and edit a factor composite

A factor composite combines two to five existing factors into one research object. It asks whether several distinct signals behave more consistently together; it does not create a directly tradable strategy.

## Before you start

Read the component reports separately and open the factor correlation matrix. Two persistently highly correlated factors may repeat the same information, so combining them does not necessarily add evidence.

Record the following before creating a composite:

- The economic meaning of every factor.
- Whether larger or smaller values represent the expected direction.
- Each factor's exploratory result and trading cost.
- Whether the components appear redundant.

## Create the composite

1. Open **Factor research** after signing in.
2. Select **Factor library** on the left.
3. Select **New factor composite**.
4. Enter a name and immutable strategy key.
5. Choose Stock cross-sectional or Panel cross-sectional research.
6. Choose Rank or Z-score standardization.
7. Select two to five components from that research method.
8. Set every direction and select **Save**.

The numbered areas show:

1. The factor library and composite list.
2. The name, standardization, and equal-weight rule.
3. Components and their directions.
4. The common-universe and frozen-history notice.
5. The action that runs an analysis with this definition.

![Quality and value factor-composite definition](/docs/images/help/zh/factors/factor-composite-definition-01.png)

## Positive and negative directions

- **Positive**: a larger value contributes a higher composite score.
- **Negative**: a smaller value contributes a higher score. The system reverses that component before averaging.

Choose directions before seeing the composite result. Do not reverse a direction after an unfavorable first result and then treat the same sample as independent evidence.

## Standardization and equal weighting

Raw factors may use unrelated units, so they cannot be added directly. On every comparison date, the system standardizes each component, aligns its direction, and takes an equal-weight average:

$$
C_{i,t}=\frac{1}{K}\sum_{k=1}^{K}s_k z_{i,k,t}
$$

Here $C_{i,t}$ is the composite score, $K$ is the component count, $z_{i,k,t}$ is a standardized exposure, and $s_k$ is $1$ for positive direction or $-1$ for negative direction.

V1 deliberately supports equal weights only. This provides a simple, auditable baseline and avoids repeatedly fitting IC-based weights to the same exploratory sample.

## Common research cross-section

Stock composites keep stocks with every component available on the date. Panel composites keep ETFs with every component available at a common month-end. A missing component excludes that asset for that period.

Adding a component can therefore reduce the sample. Always inspect component coverage and the final common-universe count in the methodology card.

## Edit and delete

- Use the edit action in the definition panel to change the name, standardization, components, or directions.
- Changes affect only future analyses. Existing reports keep their frozen definition and component code.
- Deleting a composite does not delete its historical reports, but it prevents new runs from that definition.

## Important limits

- A stock cross-sectional composite remains research-only and is not a Factor key for strategy code.
- A Panel composite can be published and opened in Strategy Lab after holdout when every component is published. Its definition becomes immutable after publication.
- It still requires a research card, exploratory analysis, holdout discipline, and cost checks.
- More components do not guarantee a better result.
- Low correlation does not prove complementarity, and equal weighting is not portfolio optimization.

## Related articles

- [Factor correlation matrix](/docs/help/factors/correlation-matrix)
- [Read a factor-composite report](/docs/help/factors/read-composite-report)
- [Pre-run research cards and variants](/docs/help/factors/research-card)
- [Run cross-asset Panel research](/docs/help/factors/panel-research)
- [Publish a Factor and use it in a strategy](/docs/help/factors/publish-factor)
