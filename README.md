# Adaptive AI Orchestrator

An ML systems project that schedules AI inference across heterogeneous compute while learning from the outcomes of its own decisions.

## Why this is different

Most model-routing work selects a model or compute target from predicted quality, latency, or cost. This project adds a **counterfactual feedback loop**:

1. Make a risk-aware placement using uncertainty bounds, not only point estimates.
2. Run a cheap shadow assignment when its information value justifies the cost.
3. Compare the chosen placement with the observed alternative.
4. Detect prediction drift and recalibrate the scheduling policy.
5. Preserve the decision lineage so every assignment can be explained and replayed.

The research question is: **Can selective counterfactual exploration reduce scheduling regret under shifting AI workloads without violating production SLOs?**

## First milestone

- Typed job, node, prediction, and outcome models
- Risk-aware placement policy
- Shadow-candidate selection for counterfactual feedback
- Latency and quality drift detection
- Interactive decision table for inspecting placements

## Evaluation harness

The deterministic evaluation harness compares four policies against identical seeded workloads:

- `fifo`: first feasible placement
- `least-loaded`: feasible node with the smallest queue
- `predicted-best`: lowest point-estimate latency/quality/cost utility
- `counterfactual`: the current uncertainty-aware risk policy

Each placement is compared with the best feasible observed outcome to calculate scheduling regret. The harness also records success, SLO violations, and realized cost. Synthetic workloads are reproducible by seed so policy changes can be regression-tested against the same cases.

Run the evaluation tests with:

```bash
npm test
```

## Planned evaluation

Compare FIFO, least-loaded, predicted-best, and counterfactual policies using:

- SLO violation rate
- Cost per successful inference
- Scheduling regret
- GPU utilization
- Recovery time after workload drift

## Local development

Requires Node.js 22.13 or newer.

```bash
npm run install:ci
npm run dev
```

The application uses standard Next.js. Run `npm run build` for a production
build and `npm start` to serve it. No external authentication or hosting
integration is required.
