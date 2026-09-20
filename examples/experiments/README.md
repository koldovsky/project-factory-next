# Experiment example

`synthetic.mjs` generates fictional results with an intentionally enormous improvement. It demonstrates assessment behavior, not measured factory performance or a useful sample-size recommendation.

From the repository root:

```sh
node examples/experiments/synthetic.mjs experiment.json
node bin/factory.mjs improve --experiment experiment.json --out improvement-report.json
```

The generator refuses to overwrite an existing output. The assessor produces a review proposal; it cannot authenticate the fictional evaluator and does not promote a factory version.

In real use, store audit tasks and input evidence in the evaluator's separate protected storage. Export measurements from that evaluator, not from the candidate agent. Read [the improvement workflow](../../docs/self-improvement.md) before using assessment results for a release.
