# Read and rerun a Universe result

A Universe is a set of objects that satisfies explicit eligibility and measure conditions at a historical point in time. It is neither a fixed report nor model-generated SQL.

The card header shows source, as-of policy, missing-value rule, row limit, and predicates. Eligibility freezes minimum listing age, suspension handling, and risk-warning handling. After execution, the card also shows:

- the trading date actually used;
- counts after source, listing, tradability, risk-warning, and predicate stages;
- total matches, displayed rows, and data revision;
- each measure's name, stable id, version, and unit.

**Rerun** uses the same saved UniverseSpec against current local data. A provider revision may change the data revision. To
retain one complete study result, run the full document cleanly and create an immutable `ResearchExecution`. A later data
revision requires another complete snapshot; review the two records independently because the product does not automatically
attribute their differences.

Names come from the historical name spell where available, and industry prefers point-in-time SW Level-1 membership. Select an object name to open unified object detail.
