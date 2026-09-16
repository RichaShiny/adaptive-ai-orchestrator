"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DecisionLineagePanel } from "@/components/decision-lineage-panel";
import { ResilienceBenchmark } from "@/components/resilience-benchmark";
import { runBenchmark } from "@/lib/evaluation";
import { CounterfactualFeedbackLoop } from "@/lib/feedback";
import {
  scheduleJob,
  type AiJob,
  type PlacementPrediction,
} from "@/lib/orchestrator";

const jobs: AiJob[] = [
  { id: "job-1842", modality: "multimodal", modelFamily: "VLM-13B", memoryGb: 18, latencySloMs: 900, minimumQuality: 0.86, maxCostUsd: 0.03 },
  { id: "job-1843", modality: "vision", modelFamily: "ViT-L", memoryGb: 12, latencySloMs: 500, minimumQuality: 0.9, maxCostUsd: 0.018, privacyZone: "private" },
  { id: "job-1844", modality: "text", modelFamily: "LLM-8B", memoryGb: 10, latencySloMs: 650, minimumQuality: 0.82, maxCostUsd: 0.02 },
];

const predictions: PlacementPrediction[] = [
  { nodeId: "gpu-edge-01", gpu: "RTX 4090", availableMemoryGb: 21, queueDepth: 3, zone: "private", latencyMs: 430, latencyUncertaintyMs: 72, quality: 0.87, qualityUncertainty: 0.025, costUsd: 0.009 },
  { nodeId: "gpu-cloud-04", gpu: "A100 80GB", availableMemoryGb: 63, queueDepth: 7, zone: "public", latencyMs: 310, latencyUncertaintyMs: 38, quality: 0.92, qualityUncertainty: 0.012, costUsd: 0.027 },
  { nodeId: "gpu-cloud-09", gpu: "L40S", availableMemoryGb: 39, queueDepth: 1, zone: "public", latencyMs: 365, latencyUncertaintyMs: 96, quality: 0.9, qualityUncertainty: 0.041, costUsd: 0.015 },
  { nodeId: "gpu-edge-03", gpu: "Jetson AGX", availableMemoryGb: 10, queueDepth: 0, zone: "private", latencyMs: 790, latencyUncertaintyMs: 155, quality: 0.81, qualityUncertainty: 0.06, costUsd: 0.003 },
];

function buildFeedbackDemo() {
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 6,
    minSamples: 4,
    latencyErrorThreshold: 0.15,
    qualityErrorThreshold: 0.05,
  });
  const selected = predictions[1];
  const shadow = predictions[2];

  const samples = [
    {
      selected: { nodeId: selected.nodeId, latencyMs: 352, quality: 0.9, costUsd: selected.costUsd },
      shadow: { nodeId: shadow.nodeId, latencyMs: 472, quality: 0.84, costUsd: shadow.costUsd },
    },
    {
      selected: { nodeId: selected.nodeId, latencyMs: 401, quality: 0.87, costUsd: selected.costUsd },
      shadow: { nodeId: shadow.nodeId, latencyMs: 515, quality: 0.82, costUsd: shadow.costUsd },
    },
    {
      selected: { nodeId: selected.nodeId, latencyMs: 438, quality: 0.86, costUsd: selected.costUsd },
      shadow: { nodeId: shadow.nodeId, latencyMs: 548, quality: 0.8, costUsd: shadow.costUsd },
    },
  ];

  let latest = loop.record(1, selected, samples[0].selected, shadow, samples[0].shadow);
  samples.slice(1).forEach((sample, index) => {
    latest = loop.record(index + 2, selected, sample.selected, shadow, sample.shadow);
  });

  return latest;
}

export default function Home() {
  const [jobId, setJobId] = useState(jobs[0].id);
  const job = jobs.find((item) => item.id === jobId) ?? jobs[0];
  const feedback = useMemo(() => buildFeedbackDemo(), []);
  const decision = useMemo(
    () => scheduleJob(job, predictions, feedback.snapshot.confidenceWidth),
    [job, feedback.snapshot.confidenceWidth],
  );
  const benchmark = useMemo(() => runBenchmark(42, 100), []);

  return (
    <main className="min-h-screen bg-[#071019] text-slate-100">
      <header className="border-b border-slate-800 bg-[#0a1520]">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-5 py-4 sm:px-8">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-300 font-bold text-slate-950">A</span>
          <div><p className="font-semibold">Adaptive AI Orchestrator</p><p className="text-xs text-slate-500">Counterfactual policy lab</p></div>
          <span className={`ml-auto rounded-full px-3 py-1 text-xs ${feedback.snapshot.drifting ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}>{feedback.snapshot.drifting ? "Drift detected · recalibrating" : "Policy calibrated"}</span>
        </div>
      </header>

      <section className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-cyan-300">Placement decision</p><h1 className="mt-2 text-2xl font-semibold">Choose compute with uncertainty included</h1></div>
          <label className="text-sm text-slate-400">Inspect job <select value={jobId} onChange={(event) => setJobId(event.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100">{jobs.map((item) => <option key={item.id}>{item.id}</option>)}</select></label>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <Fact label="Modality" value={job.modality} />
          <Fact label="Model" value={job.modelFamily} />
          <Fact label="Latency SLO" value={`${job.latencySloMs} ms`} />
          <Fact label="Quality floor" value={`${Math.round(job.minimumQuality * 100)}%`} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0a1520]">
          <Table>
            <TableHeader className="bg-slate-900/70 text-slate-400"><TableRow className="border-slate-800 hover:bg-transparent"><TableHead>Candidate node</TableHead><TableHead>Predicted latency</TableHead><TableHead>Quality bound</TableHead><TableHead>Queue</TableHead><TableHead>Cost</TableHead><TableHead>Risk score</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
            <TableBody>{decision.alternatives.map((candidate) => {
              const selected = decision.selected?.nodeId === candidate.nodeId;
              const shadow = decision.shadowCandidate?.nodeId === candidate.nodeId;
              return <TableRow key={candidate.nodeId} className="border-slate-800 hover:bg-slate-800/40">
                <TableCell><span className="font-medium">{candidate.nodeId}</span><span className="block text-xs text-slate-500">{candidate.gpu} · {candidate.zone}</span></TableCell>
                <TableCell>{candidate.latencyMs} ± {candidate.latencyUncertaintyMs} ms</TableCell>
                <TableCell>{((candidate.quality - feedback.snapshot.confidenceWidth * candidate.qualityUncertainty) * 100).toFixed(1)}%</TableCell>
                <TableCell>{candidate.queueDepth}</TableCell><TableCell>${candidate.costUsd.toFixed(3)}</TableCell><TableCell className="font-mono">{candidate.score.toFixed(3)}</TableCell>
                <TableCell>{selected ? <Tag color="cyan">selected</Tag> : shadow ? <Tag color="violet">shadow run</Tag> : <span className="text-slate-600">—</span>}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[.06] p-5"><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Production assignment</p><p className="mt-3 text-lg font-semibold">{decision.selected?.nodeId ?? "No feasible node"}</p><p className="mt-1 text-sm leading-6 text-slate-400">Chosen from conservative latency and quality bounds, memory constraints, queue pressure, privacy, and cost.</p></article>
          <article className="rounded-2xl border border-violet-400/20 bg-violet-400/[.06] p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Counterfactual probe</p>
            <p className="mt-3 text-lg font-semibold">{decision.shadowCandidate?.nodeId ?? "No probe within budget"}</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">A low-cost shadow run measures the alternative outcome and teaches the next scheduling decision.</p>
            {decision.shadowExplanation ? <div className="mt-4 border-t border-violet-300/10 pt-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <ProbeMetric label="Uncertainty" value={decision.shadowExplanation.uncertaintyScore.toFixed(3)} />
                <ProbeMetric label="Info gain" value={decision.shadowExplanation.informationGainScore.toFixed(3)} />
                <ProbeMetric label="Cost ratio" value={`${(decision.shadowExplanation.probeCostRatio * 100).toFixed(1)}%`} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{decision.shadowExplanation.reasons.map((reason) => <span key={reason} className="rounded-full border border-violet-300/15 bg-violet-300/[.06] px-2.5 py-1 text-xs text-violet-200">{reason.replaceAll("-", " ")}</span>)}</div>
              <p className="mt-3 text-xs text-slate-500">Selection score {decision.shadowExplanation.selectionScore.toFixed(3)} · shadow budget ${decision.shadowExplanation.budgetLimitUsd.toFixed(4)}</p>
            </div> : null}
          </article>
        </div>

        <DecisionLineagePanel
          job={job}
          predictions={predictions}
          decision={decision}
          confidenceWidth={feedback.snapshot.confidenceWidth}
        />

        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">Feedback loop</p><h2 className="mt-2 text-xl font-semibold">Drift and recalibration state</h2></div>
            <p className="text-xs text-slate-500">rolling window · {feedback.snapshot.samplesInWindow} outcomes</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FeedbackMetric label="Calibration state" value={feedback.snapshot.drifting ? "recalibrating" : "stable"} accent={feedback.snapshot.drifting} />
            <FeedbackMetric label="Confidence width" value={`${feedback.snapshot.confidenceWidth.toFixed(2)}σ`} accent={feedback.snapshot.drifting} />
            <FeedbackMetric label="Latency MAPE" value={`${(feedback.snapshot.latencyMape * 100).toFixed(1)}%`} accent={feedback.snapshot.latencyMape > 0.15} />
            <FeedbackMetric label="Quality MAE" value={`${(feedback.snapshot.qualityMae * 100).toFixed(1)} pts`} accent={feedback.snapshot.qualityMae > 0.05} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <FeedbackMetric label="Recalibration version" value={`v${feedback.snapshot.recalibrationVersion}`} />
            <FeedbackMetric label="Drift started" value={feedback.snapshot.driftStartedAt === null ? "none" : `step ${feedback.snapshot.driftStartedAt}`} />
            <FeedbackMetric label="Recovery" value={feedback.snapshot.recoverySteps === null ? "pending" : `${feedback.snapshot.recoverySteps} steps`} />
          </div>
          {feedback.signal ? <div className="mt-4 rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Latest counterfactual signal</p><p className="mt-2 text-sm text-slate-300">{feedback.signal.shadowNodeId} vs {feedback.signal.selectedNodeId}</p></div><Tag color={feedback.signal.shadowBetter ? "violet" : "cyan"}>{feedback.signal.shadowBetter ? "shadow better" : "production better"}</Tag></div>
            <p className="mt-3 text-sm text-slate-500">Shadow advantage <span className="font-mono text-slate-300">{feedback.signal.shadowAdvantage.toFixed(4)}</span>. Positive values mean the shadow placement delivered lower realized utility cost.</p>
          </div> : null}
        </section>

        <ResilienceBenchmark />

        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">Policy benchmark</p><h2 className="mt-2 text-xl font-semibold">Reproducible scheduler comparison</h2></div>
            <p className="text-xs text-slate-500">seed 42 · 100 synthetic jobs</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0a1520]">
            <Table>
              <TableHeader className="bg-slate-900/70 text-slate-400"><TableRow className="border-slate-800 hover:bg-transparent"><TableHead>Policy</TableHead><TableHead>Success rate</TableHead><TableHead>SLO violations</TableHead><TableHead>Mean cost</TableHead><TableHead>Mean regret</TableHead></TableRow></TableHeader>
              <TableBody>{benchmark.map((row) => <TableRow key={row.policy} className="border-slate-800 hover:bg-slate-800/40">
                <TableCell className="font-medium capitalize">{row.policy.replace("-", " ")}{row.policy === "counterfactual" ? <span className="ml-2"><Tag color="violet">risk-aware</Tag></span> : null}</TableCell>
                <TableCell>{(row.successRate * 100).toFixed(1)}%</TableCell>
                <TableCell>{(row.sloViolationRate * 100).toFixed(1)}%</TableCell>
                <TableCell>${row.meanCostUsd.toFixed(4)}</TableCell>
                <TableCell className="font-mono">{row.meanRegret.toFixed(4)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>
          <p className="mt-3 text-sm text-slate-500">Each policy sees the same deterministic workload and realized outcomes, making the comparison directly replayable from the benchmark command.</p>
        </section>
      </section>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800 bg-[#0a1520] p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 capitalize text-slate-200">{value}</p></div>; }
function ProbeMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-slate-200">{value}</p></div>; }
function FeedbackMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`rounded-xl border p-4 ${accent ? "border-amber-400/20 bg-amber-400/[.05]" : "border-slate-800 bg-[#0a1520]"}`}><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 font-mono ${accent ? "text-amber-200" : "text-slate-200"}`}>{value}</p></div>; }
function Tag({ children, color }: { children: React.ReactNode; color: "cyan" | "violet" }) { return <span className={`rounded-full px-2.5 py-1 text-xs ${color === "cyan" ? "bg-cyan-300/10 text-cyan-300" : "bg-violet-300/10 text-violet-300"}`}>{children}</span>; }
