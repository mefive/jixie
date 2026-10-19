// 新版审阅不会先应用 Cell；用隔离流程覆盖旧命令入口。
// New reviews never pre-apply Cells; preserve the command with the isolated acceptance journey.
process.env.JIXIE_CODE_REVIEW_ONLY = 'research';
await import('./agent-code-review.mjs');
