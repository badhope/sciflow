#!/usr/bin/env python3
"""
研究循环专项压测（AI_MOCK=1 下跑真实 HTTP + 真实 Python 沙箱 + 真实 LangGraph）。

覆盖：
  1. 全自动模式并发 N 轮：每个 cycle 独立 program，AI 专家审批 → 实验 → Critic → synthesize；
  2. 人工审批放行：awaiting_approval → resume(true) → synthesize；
  3. 人工驳回：awaiting_approval → resume(false) → stopped / approval_rejected；
  4. AI 专家驳回：question 含「拒批」→ stopped / approval_rejected；
  5. 预算耗尽：maxTokens=1 → stopped / budget_exceeded；
  6. 连续反驳触发停滞：question 含「拒证」→ stopped / stagnation。

失败一律非零退出；所有断言基于真实 API 返回，不用 sleep 猜结果。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone


def http(method: str, url: str, body: dict | None = None, timeout: float = 30) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429 and attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {url} -> {e.code}: {detail[:500]}") from e
    raise RuntimeError(f"{method} {url}: retry exhausted")


@dataclass
class CaseResult:
    name: str
    cycle_id: str
    final_state: str
    summary: str
    elapsed_s: float
    claims: int
    runs: int
    tokens: int
    ok: bool


class Stress:
    def __init__(self, base: str, timeout: float):
        self.base = base.rstrip("/")
        self.timeout = timeout
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        self.project = http("POST", f"{self.base}/projects", {"name": f"研究循环压测-{ts}", "description": "stress"})
        self.project_id = self.project["id"]

    def new_program(self, title: str) -> str:
        p = http(
            "POST",
            f"{self.base}/programs",
            {
                "projectId": self.project_id,
                "title": title,
                "goal": "验证端到端全自动科研循环的可靠性与终止边界",
                "domain": "methodology",
                "autonomyLevel": "L2",
            },
        )
        return p["id"]

    def status(self, cycle_id: str) -> dict:
        return http("GET", f"{self.base}/research-cycles/{cycle_id}")

    def wait(self, cycle_id: str, wanted: set[str], timeout: float | None = None) -> dict:
        deadline = time.time() + (timeout or self.timeout)
        last = {}
        while time.time() < deadline:
            last = self.status(cycle_id)
            state = str(last.get("state") or "")
            if state in wanted:
                return last
            if state in {"blocked"} and "synthesize" not in wanted:
                return last
            time.sleep(2)
        raise TimeoutError(f"cycle {cycle_id} 未在 {timeout or self.timeout}s 内到达 {wanted}，最后状态={last.get('state')}")

    def run_case(self, name: str, question: str, approval_mode: str, max_tokens: int = 200000, max_iterations: int = 1, approve: bool | None = None) -> CaseResult:
        started = time.time()
        program_id = self.new_program(name)
        cycle = http(
            "POST",
            f"{self.base}/research-cycles/start",
            {
                "programId": program_id,
                "question": question,
                "approvalMode": approval_mode,
                "maxIterations": max_iterations,
                "maxTokens": max_tokens,
            },
        )
        cycle_id = cycle["id"]
        if approval_mode == "human":
            st = self.wait(cycle_id, {"awaiting_approval"})
            if approve is not None:
                http("POST", f"{self.base}/research-cycles/{cycle_id}/resume", {"approved": approve})
        st = self.wait(cycle_id, {"synthesize", "stopped", "blocked"})
        elapsed = round(time.time() - started, 2)
        summary = str(st.get("summary") or "")
        state = str(st.get("state") or "")
        expected_reason = {
            "人工审批放行": "completed",
            "人工驳回": "approval_rejected",
            "AI 专家驳回": "approval_rejected",
            "预算耗尽": "budget_exceeded",
            "连续反驳停滞": "stagnation",
        }.get(name)
        if name.startswith("全自动"):
            ok = state == "synthesize"
        elif expected_reason == "completed":
            ok = state == "synthesize"
        else:
            ok = state == "stopped" and expected_reason in summary
        return CaseResult(
            name=name,
            cycle_id=cycle_id,
            final_state=state,
            summary=summary[:240],
            elapsed_s=elapsed,
            claims=len(st.get("claims") or []),
            runs=len(st.get("runs") or []),
            tokens=int(st.get("tokensSpent") or 0),
            ok=ok,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:4404/api")
    parser.add_argument("--cycles", type=int, default=6, help="全自动并发轮数")
    parser.add_argument("--parallel", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=240)
    args = parser.parse_args()

    stress = Stress(args.base, args.timeout)
    print(f"project={stress.project_id} base={args.base}")

    # 先做健康探针，向量/DB 任一挂掉都不算压测通过
    health = http("GET", f"{args.base}/health/deep")
    if health.get("status") != "ok":
        print(f"FAIL health/deep={health}", file=sys.stderr)
        return 1
    print(f"health.deep.ok cycles={health.get('checks', {}).get('researchCycles')}")

    results: list[CaseResult] = []
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futures = {
            pool.submit(
                stress.run_case,
                f"全自动-{i + 1}",
                "不确定性越高的样本，其预测误差是否越大？",
                "ai",
            ): f"auto-{i + 1}"
            for i in range(args.cycles)
        }
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as e:  # noqa: BLE001 - 压测要收集所有失败而不是首个即退出
                failures.append(f"{futures[fut]}: {e}")

    single_cases = [
        ("人工审批放行", "不确定性排序能否识别高误差样本？", "human", True, 200000, 1),
        ("人工驳回", "请验证一个会被驳回的方案", "human", False, 200000, 1),
        ("AI 专家驳回", "这个方案需要拒批：缺少真实任务对照", "ai", None, 200000, 1),
        ("预算耗尽", "预算耗尽场景下循环是否安全终止？", "ai", None, 1, 1),
        ("连续反驳停滞", "拒证场景：验证结论会被连续反驳", "ai", None, 200000, 10),
    ]
    for name, q, mode, approve, max_tokens, max_iter in single_cases:
        try:
            results.append(stress.run_case(name, q, mode, max_tokens=max_tokens, max_iterations=max_iter, approve=approve))
        except Exception as e:  # noqa: BLE001
            failures.append(f"{name}: {e}")

    print("\n=== 研究循环压测结果 ===")
    for r in results:
        flag = "PASS" if r.ok else "FAIL"
        print(
            f"[{flag}] {r.name:12s} state={r.final_state:11s} {r.elapsed_s:6.2f}s "
            f"claims={r.claims} runs={r.runs} tokens={r.tokens} | {r.summary}"
        )
    failed = [r for r in results if not r.ok]
    req = urllib.request.Request(f"{args.base}/metrics")
    with urllib.request.urlopen(req, timeout=30) as resp:
        metrics = resp.read().decode()
    print("\n关键指标：")
    for line in metrics.splitlines():
        if "research_cycles" in line and not line.startswith("#"):
            print(line)
    for f in failures:
        print(f"FAIL {f}", file=sys.stderr)
    if failed or failures:
        print(f"\nFAILED results={len(failed)}/{len(results)} exceptions={len(failures)}", file=sys.stderr)
        return 1
    print(f"\nPASS {len(results)}/{len(results)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
