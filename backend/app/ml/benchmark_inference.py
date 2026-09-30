import argparse
import json
import statistics
import time
from pathlib import Path

from ..core.config import settings
from ..services.simulation import simulation_service


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure scheduler decision inference latency.")
    parser.add_argument("--calls", type=int, default=100)
    parser.add_argument("--output", type=Path, default=Path("data/reports/inference_latency.md"))
    args = parser.parse_args()
    original_mode = simulation_service.policy_mode
    simulation_service.policy_mode = type(original_mode)("TRAINED")
    latencies: list[float] = []
    for _ in range(args.calls):
        started = time.perf_counter()
        simulation_service.get_decision()
        latencies.append((time.perf_counter() - started) * 1000)
    simulation_service.policy_mode = original_mode
    values = sorted(latencies)
    percentile = lambda fraction: values[min(len(values) - 1, int(len(values) * fraction))]
    report = "\n".join([
        "# Scheduler Inference Latency", "", f"- Policy checkpoint: `{settings.policy_checkpoint}`", f"- Calls: {args.calls}",
        "", "| Metric | Milliseconds |", "|---|---:|", f"| p50 | {percentile(.50):.4f} |", f"| p95 | {percentile(.95):.4f} |", f"| p99 | {percentile(.99):.4f} |", f"| mean | {statistics.mean(values):.4f} |", "",
        "Measurements include the backend service decision path and policy distribution lookup.",
    ]) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report)
    print(json.dumps({"p50": percentile(.50), "p95": percentile(.95), "p99": percentile(.99), "mean": statistics.mean(values)}))


if __name__ == "__main__":
    main()