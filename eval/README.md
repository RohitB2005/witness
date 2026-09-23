# eval

Evaluation scorer and labels (see `docs/EVALUATION.md`). The matrix runner (`pnpm eval`) arrives in P5.

```
pnpm eval:score runs/<runId>                       # one run
pnpm eval:score runs/<a> runs/<b> --clean          # clean-build runs (counts false alarms)
pnpm eval:score eval/results/<dir> --out eval/results/<dir>   # runs.jsonl: {"runDir": "...", "clean": bool} per line
pnpm eval:score … -v                               # list every finding and why it scored the way it did
```

| File | What it does |
| --- | --- |
| `truth.ts` | Loads `bench/bugs.yaml` and validates it strictly (an unknown rule field is an error) |
| `match.ts` | Matches one finding against the rules, exactly as the header of `bugs.yaml` describes |
| `score-lib.ts` | Recall, precision, clean-build false positives, tier accuracy, stability; `summary.json` |
| `score.ts` | CLI: reads runs, writes `summary.json` + `summary.md` |
| `labels.json` | Human verdicts by finding fingerprint: `"tp:Bxx"`, `"tp_unseeded"` or `"fp"`. A label overrides the automatic match |
| `results/` | Scored result sets (e.g. `p1-gate/`) |
