# Public research and resulting decisions

Reviewed 2026-11-02. These established public projects were consulted for interaction patterns and documented pitfalls. No implementation, artwork or data was copied.

| Public project | Observed pattern | Decision for this small demo |
| --- | --- | --- |
| [Metabase](https://github.com/metabase/metabase) | A focused business-intelligence workflow with dashboard filtering and exploratory tables. | Put the date basis and period next to the metrics; provide a visible ledger and local export. |
| [Apache Superset](https://github.com/apache/superset) | Multiple visualizations share dashboard-level controls. | Derive every card, chart, table and export from the same selected row array. |
| [Evidence](https://github.com/evidence-dev/evidence) | Reporting can be a small, reviewable code artifact with explicit input state. | Keep this static edition dependency-free with reproducible fixtures and pure calculations. |

## Actual issue lessons

- [Superset issue 23773](https://github.com/apache/superset/issues/23773) reported charts claiming a time filter was applied while their query omitted it. The author later could not reproduce it in a release candidate. This historical report motivates our cross-view reconciliation checks; it is not a claim about current Superset behavior.
- [Metabase issue 25533](https://github.com/metabase/metabase/issues/25533), closed and linked to PR 32642, reported empty filter values being confirmed. We provide explicit empty/error states and test no-result searches and reversed ranges.
- [Evidence issue 3312](https://github.com/evidence-dev/evidence/issues/3312), closed and linked to PR 3319, reported a single-date default being ignored. We use fixed declared defaults and verify the actual visible controls after loading and resetting.

These issues inform failure cases rather than prove that this demo solves general BI infrastructure problems. Dates, payments, aging boundaries and CSV formulas are verified independently using small hand-calculated examples.
