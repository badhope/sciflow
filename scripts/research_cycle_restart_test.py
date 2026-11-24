#!/usr/bin/env python3
"""
研究循环真实进程重启验收（R-06 / R-07）。

不是单测替身：本脚本自己拉起 `node apps/server/dist/.../main.js`，用真实 SQLite、
真实 HTTP、真实 Python 沙箱和真实 LangGraph，然后 kill -9 整个进程组再重启。

覆盖：
  1. 人工审批挂起 → kill → 重启 → 仍 awaiting_approval → resume 完成；
  2. 自动执行中（execute）→ kill → 重启 → 自动从 checkpoint 续跑并 synthesize；
  3. 计划阶段（protocol）→ kill → 重启自动续跑；
  4. 评审阶段（analyze）→ kill → 重启自动续跑，且 claim/证据不重复；
  5. 修订回边（revise→plan）→ kill → 重启自动续跑，两轮 claim/run 各 2 条。

用法：
  python3 scripts/research_cycle_restart_test.py
  python3 scripts/research_cycle_restart_test.py --port 4406 --delay-ms 12000
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def http(method: str, url: str, body: dict | None = None, timeout: float = 30) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429 and attempt < 5:
                retry_after = e.headers.get("Retry-After") if e.headers else None
                delay = min(60, max(2, int(retry_after or 2 * (attempt + 1))))
                time.sleep(delay)
                continue
            raise RuntimeError(f"{method} {url} -> {e.code}: {detail[:500]}") from e
        except (ConnectionResetError, urllib.error.URLError):
            if attempt < 5:
                time.sleep(1)
                continue
            raise
    raise RuntimeError(f"{method} {url}: retry exhausted")


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


class Server:
    def __init__(self, repo: Path, port: int, db: Path, log: Path, delay_ms: int, plan_delay_ms: int, critic_delay_ms: int):
        self.repo = repo
        self.port = port
        self.db = db
        self.log = log
        self.delay_ms = delay_ms
        self.plan_delay_ms = plan_delay_ms
        self.critic_delay_ms = critic_delay_ms
        self.proc: subprocess.Popen | None = None

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}/api"

    def env(self) -> dict:
        env = os.environ.copy()
        env.update(
            {
                "AI_MOCK": "1",
                "SCIFLOW_NO_VEC": "1",
                "AUTH_MODE": "none",
                "DATABASE_PATH": str(self.db),
                "PORT": str(self.port),
                "HOST": "127.0.0.1",
                "MOCK_EXPERIMENT_DELAY_MS": str(self.delay_ms),
                "MOCK_PLAN_DELAY_MS": str(self.plan_delay_ms),
                "MOCK_CRITIC_DELAY_MS": str(self.critic_delay_ms),
                "RESEARCH_CYCLE_WATCHDOG_MINUTES": "10",
            }
        )
        return env

    def start(self) -> None:
        if not port_free(self.port):
            raise RuntimeError(f"端口 {self.port} 已被占用，拒绝复用未知进程")
        entry = self.repo / "apps/server/dist/apps/server/src/main.js"
        if not entry.exists():
            raise RuntimeError(f"缺少构建产物：{entry}，先跑 pnpm --filter @sciflow/server build")
        self.log.parent.mkdir(parents=True, exist_ok=True)
        self.log.write_text("", encoding="utf-8")
        with self.log.open("ab") as out:
            self.proc = subprocess.Popen(
                ["node", str(entry)],
                cwd=self.repo,
                env=self.env(),
                stdout=out,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.wait_health()

    def wait_health(self, timeout: float = 90) -> dict:
        deadline = time.time() + timeout
        last_error = ""
        while time.time() < deadline:
            if self.proc and self.proc.poll() is not None:
                raise RuntimeError(f"服务提前退出（code={self.proc.returncode}），日志见 {self.log}")
            try:
                health = http("GET", f"{self.base}/health/deep", timeout=10)
                if health.get("status") == "ok":
                    return health
                last_error = json.dumps(health)[:500]
            except Exception as e:  # noqa: BLE001 - 启动期连接失败是正常的
                last_error = str(e)
            time.sleep(1)
        raise RuntimeError(f"服务未在 {timeout}s 内就绪：{last_error}，日志见 {self.log}")

    def kill(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        self.proc = None

    def log_text(self) -> str:
        return self.log.read_text(encoding="utf-8", errors="replace") if self.log.exists() else ""


class Cases:
    def __init__(self, server: Server):
        self.s = server
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        project = http("POST", f"{server.base}/projects", {"name": f"重启验收-{ts}", "description": "restart"})
        self.project_id = project["id"]
        self.counter = 0

    def new_program(self, label: str) -> str:
        self.counter += 1
        p = http(
            "POST",
            f"{self.s.base}/programs",
            {
                "projectId": self.project_id,
                "title": f"{label}-{self.counter}",
                "goal": "验证真实进程重启后的研究循环恢复能力",
                "domain": "methodology",
                "autonomyLevel": "L2",
            },
        )
        return p["id"]

    def start_cycle(self, label: str, mode: str, max_iterations: int = 1, question: str = "不确定性越高的样本，其预测误差是否越大？") -> tuple[str, str]:
        program_id = self.new_program(label)
        cycle = http(
            "POST",
            f"{self.s.base}/research-cycles/start",
            {
                "programId": program_id,
                "question": question,
                "approvalMode": mode,
                "maxIterations": max_iterations,
                "maxTokens": 200000,
            },
        )
        return program_id, cycle["id"]

    def status(self, cycle_id: str) -> dict:
        return http("GET", f"{self.s.base}/research-cycles/{cycle_id}")

    def wait_state(self, cycle_id: str, wanted: set[str], timeout: float = 90, poll: float = 3) -> dict:
        deadline = time.time() + timeout
        last: dict = {}
        while time.time() < deadline:
            last = self.status(cycle_id)
            state = str(last.get("state") or "")
            if state in wanted:
                return last
            time.sleep(poll)
        raise TimeoutError(f"cycle {cycle_id} 未在 {timeout}s 内到达 {wanted}，最后 state={last.get('state')}")

    def checkpoint_exists(self, cycle_id: str) -> bool:
        con = sqlite3.connect(self.s.db)
        try:
            row = con.execute("SELECT 1 FROM checkpoints WHERE thread_id=? LIMIT 1", (cycle_id,)).fetchone()
            return row is not None
        finally:
            con.close()

    def assert_checkpoint(self, cycle_id: str, label: str) -> None:
        if not self.checkpoint_exists(cycle_id):
            raise AssertionError(f"{label}: 断点不存在，后续恢复测试无意义")


def wait_log(s: Server, needle: str, timeout: float = 30) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if needle in s.log_text():
            return True
        time.sleep(0.5)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--port", type=int, default=4406)
    parser.add_argument("--db", default="/tmp/sciflow-restart/sciflow.db")
    parser.add_argument("--log", default="/tmp/sciflow-restart/server.log")
    parser.add_argument("--delay-ms", type=int, default=12000, help="mock 实验人为延迟，默认 12s")
    parser.add_argument("--plan-delay-ms", type=int, default=8000, help="mock 计划阶段人为延迟，默认 8s")
    parser.add_argument("--critic-delay-ms", type=int, default=8000, help="mock 评审阶段人为延迟，默认 8s")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    db = Path(args.db).resolve()
    log = Path(args.log).resolve()
    db.parent.mkdir(parents=True, exist_ok=True)
    if db.exists():
        db.unlink()
        for suffix in ("-wal", "-shm"):
            p = Path(str(db) + suffix)
            if p.exists():
                p.unlink()

    server = Server(repo, args.port, db, log, args.delay_ms, args.plan_delay_ms, args.critic_delay_ms)
    results: list[tuple[str, bool, str]] = []
    cases: Cases | None = None

    try:
        print(f"启动服务 port={args.port} db={db} delay={args.delay_ms}ms plan={args.plan_delay_ms}ms critic={args.critic_delay_ms}ms")
        server.start()
        cases = Cases(server)

        # Case 1: 人工审批挂起 → kill → 重启 → 仍 awaiting → resume
        print("\n[1/5] 人工审批挂起重启")
        _, human_cycle = cases.start_cycle("人工审批重启", "human")
        st = cases.wait_state(human_cycle, {"awaiting_approval", "blocked", "stopped"}, timeout=90)
        if st.get("state") != "awaiting_approval":
            raise AssertionError(f"未进入 awaiting_approval，实际={st.get('state')} summary={st.get('summary')}")
        cases.assert_checkpoint(human_cycle, "人工审批")
        print(f"  挂起成功 cycle={human_cycle[:8]} checkpoint=yes")
        server.kill()
        server.start()
        st = cases.status(human_cycle)
        if st.get("state") != "awaiting_approval":
            raise AssertionError(f"重启后状态被改写：{st.get('state')} summary={st.get('summary')}")
        if not wait_log(server, "启动恢复完成", timeout=20):
            raise AssertionError("重启日志缺少启动恢复记录")
        print("  重启后仍 awaiting_approval，断点保留")
        http("POST", f"{server.base}/research-cycles/{human_cycle}/resume", {"approved": True})
        st = cases.wait_state(human_cycle, {"synthesize", "stopped", "blocked"}, timeout=120)
        if st.get("state") != "synthesize":
            raise AssertionError(f"resume 未完成：{st.get('state')} summary={st.get('summary')}")
        if not st.get("claims") or not st.get("runs"):
            raise AssertionError("resume 完成但 claims/runs 为空")
        print(f"  resume 完成 state=synthesize claims={len(st['claims'])} runs={len(st['runs'])} tokens={st.get('tokensSpent')}")
        results.append(("人工审批挂起重启", True, "awaiting → kill → awaiting → synthesize"))

        # Case 2: 自动执行中 kill → 重启自动续跑
        print("\n[2/5] 自动执行中重启")
        _, auto_cycle = cases.start_cycle("自动执行重启", "ai", max_iterations=1)
        st = cases.wait_state(auto_cycle, {"execute", "synthesize", "stopped", "blocked"}, timeout=90, poll=2)
        if st.get("state") != "execute":
            raise AssertionError(f"未能捕获 execute 状态，实际={st.get('state')} summary={st.get('summary')}")
        cases.assert_checkpoint(auto_cycle, "自动执行")
        print(f"  捕获 execute cycle={auto_cycle[:8]}，等待 1s 后 kill")
        time.sleep(1)
        server.kill()
        server.start()
        st = cases.wait_state(auto_cycle, {"synthesize", "stopped", "blocked"}, timeout=120, poll=1)
        if st.get("state") != "synthesize":
            raise AssertionError(f"重启未自动续跑完成：{st.get('state')} summary={st.get('summary')}")
        if "从 checkpoint 自动续跑" not in server.log_text():
            raise AssertionError("重启日志缺少自动续跑记录")
        if not st.get("claims") or not st.get("runs"):
            raise AssertionError("自动续跑完成但 claims/runs 为空")
        print(f"  自动续跑完成 state=synthesize claims={len(st['claims'])} runs={len(st['runs'])} tokens={st.get('tokensSpent')}")
        results.append(("自动执行中重启", True, "execute → kill → auto resume → synthesize"))

        # Case 3: 计划阶段 kill → 重启自动续跑
        print("\n[3/5] 计划阶段重启")
        _, plan_cycle = cases.start_cycle("计划阶段重启", "ai", max_iterations=1)
        st = cases.wait_state(plan_cycle, {"protocol"}, timeout=30, poll=2)
        cases.assert_checkpoint(plan_cycle, "计划阶段")
        print(f"  捕获 protocol cycle={plan_cycle[:8]}，等待 1s 后 kill")
        time.sleep(1)
        server.kill()
        server.start()
        st = cases.wait_state(plan_cycle, {"synthesize", "stopped", "blocked"}, timeout=120, poll=1)
        if st.get("state") != "synthesize":
            raise AssertionError(f"计划阶段重启未完成：{st.get('state')} summary={st.get('summary')}")
        if not st.get("claims") or len(st.get("claims") or []) != 1:
            raise AssertionError(f"计划阶段重启后 claims 应恰好 1 条，实际={st.get('claims')}")
        if len(st.get("runs") or []) != 1:
            raise AssertionError(f"计划阶段重启后 runs 应恰好 1 条，实际={st.get('runs')}")
        print(f"  计划阶段续跑完成 state=synthesize claims={len(st['claims'])} runs={len(st['runs'])} tokens={st.get('tokensSpent')}")
        results.append(("计划阶段重启", True, "protocol → kill → auto resume → synthesize"))

        # Case 4: 评审阶段 kill → 重启自动续跑，claim/证据不得重复
        print("\n[4/5] 评审阶段重启")
        _, eval_cycle = cases.start_cycle("评审阶段重启", "ai", max_iterations=1)
        st = cases.wait_state(eval_cycle, {"analyze"}, timeout=60, poll=2)
        cases.assert_checkpoint(eval_cycle, "评审阶段")
        print(f"  捕获 analyze cycle={eval_cycle[:8]}，等待 1s 后 kill")
        time.sleep(1)
        server.kill()
        server.start()
        st = cases.wait_state(eval_cycle, {"synthesize", "stopped", "blocked"}, timeout=120, poll=1)
        if st.get("state") != "synthesize":
            raise AssertionError(f"评审阶段重启未完成：{st.get('state')} summary={st.get('summary')}")
        if len(st.get("claims") or []) != 1:
            raise AssertionError(f"评审阶段重启后 claims 应恰好 1 条，实际={st.get('claims')}")
        if len(st.get("runs") or []) != 1:
            raise AssertionError(f"评审阶段重启后 runs 应恰好 1 条，实际={st.get('runs')}")
        claim_id = st["claims"][0]["id"] if isinstance(st["claims"][0], dict) else st["claims"][0]
        claim = http("GET", f"{server.base}/programs/claims/{claim_id}", timeout=15)
        if len(claim.get("evidence") or []) < 1:
            raise AssertionError("评审阶段重启后证据丢失")
        print(f"  评审阶段续跑完成 state=synthesize claims={len(st['claims'])} runs={len(st['runs'])} evidence={len(claim['evidence'])} tokens={st.get('tokensSpent')}")
        results.append(("评审阶段重启", True, "analyze → kill → auto resume → synthesize"))

        # Case 5: 修订回边（revise→plan）kill → 重启自动续跑
        print("\n[5/5] 修订阶段重启")
        _, revise_cycle = cases.start_cycle(
            "修订阶段重启",
            "ai",
            max_iterations=2,
            question="【单轮拒证】不确定性越高的样本，其预测误差是否越大？",
        )
        st = cases.wait_state(revise_cycle, {"analyze"}, timeout=60, poll=2)
        st = cases.wait_state(revise_cycle, {"protocol"}, timeout=60, poll=2)
        cases.assert_checkpoint(revise_cycle, "修订阶段")
        print(f"  捕获第二轮 protocol cycle={revise_cycle[:8]}，等待 1s 后 kill")
        time.sleep(1)
        server.kill()
        server.start()
        st = cases.wait_state(revise_cycle, {"synthesize", "stopped", "blocked"}, timeout=120, poll=2)
        if st.get("state") != "synthesize":
            raise AssertionError(f"修订阶段重启未完成：{st.get('state')} summary={st.get('summary')}")
        if len(st.get("claims") or []) != 2:
            raise AssertionError(f"修订阶段重启后 claims 应为 2 条（refuted + supported），实际={st.get('claims')}")
        if len(st.get("runs") or []) != 2:
            raise AssertionError(f"修订阶段重启后 runs 应为 2 条，实际={st.get('runs')}")
        print(f"  修订阶段续跑完成 state=synthesize claims={len(st['claims'])} runs={len(st['runs'])} tokens={st.get('tokensSpent')}")
        results.append(("修订阶段重启", True, "analyze → refute → protocol(revise) → kill → auto resume"))

        health = http("GET", f"{server.base}/health/deep", timeout=15)
        print(f"\nhealth.deep cycles={health.get('checks', {}).get('researchCycles')}")
    except Exception as e:  # noqa: BLE001 - 验收脚本要打印现场
        results.append(("重启验收", False, str(e)))
        print(f"\nFAIL {e}", file=sys.stderr)
        if server.log.exists():
            print(f"服务日志尾部（{server.log}）：", file=sys.stderr)
            print("\n".join(server.log_text().splitlines()[-40:]), file=sys.stderr)
    finally:
        server.kill()

    print("\n=== 重启验收结果 ===")
    for name, ok, detail in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return 0 if results and all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
