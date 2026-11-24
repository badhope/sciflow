#!/usr/bin/env python3
"""
研究循环边界验收：R-08 并发 start 幂等 + S-02 语法失败自动修复。

真实进程、真实 SQLite、真实 HTTP、真实 Python 沙箱；不使用单测桩。
- R-08：同一 program 8 个并发 start，只允许 1 个 201，其余 400；最终只落 1 个 cycle。
- S-02：mock 首次实验脚本返回语法错误，execute 必须回灌实验者重写并在第二次成功，
       最终 claims=1 / runs=1，日志出现 attempt 1 失败与 attempt 2 成功。

用法：
  python3 scripts/research_cycle_edge_test.py --port 4412
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def http(method: str, url: str, body: dict | None = None, timeout: float = 30) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429:
                retry_after = e.headers.get("Retry-After") if e.headers else None
                time.sleep(min(30, max(2, int(retry_after or 3))))
                continue
            raise RuntimeError(f"{method} {url} -> {e.code}: {detail[:400]}") from e
        except (ConnectionResetError, urllib.error.URLError):
            if attempt < 3:
                time.sleep(1)
                continue
            raise
    raise RuntimeError(f"{method} {url}: retry exhausted")


def http_status(method: str, url: str, body: dict | None = None, timeout: float = 30) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


class Server:
    def __init__(self, repo: Path, port: int, db: Path, log: Path, extra_env: dict[str, str]):
        self.repo = repo
        self.port = port
        self.db = db
        self.log = log
        self.extra_env = extra_env
        self.proc: subprocess.Popen | None = None

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}/api"

    def start(self) -> None:
        if not port_free(self.port):
            raise RuntimeError(f"端口 {self.port} 已被占用，拒绝复用未知进程")
        entry = self.repo / "apps/server/dist/apps/server/src/main.js"
        if not entry.exists():
            raise RuntimeError(f"缺少构建产物：{entry}")
        self.log.parent.mkdir(parents=True, exist_ok=True)
        self.log.write_text("", encoding="utf-8")
        env = os.environ.copy()
        env.update(
            {
                "AI_MOCK": "1",
                "SCIFLOW_NO_VEC": "1",
                "AUTH_MODE": "none",
                "DATABASE_PATH": str(self.db),
                "PORT": str(self.port),
                "HOST": "127.0.0.1",
                "RESEARCH_CYCLE_WATCHDOG_MINUTES": "10",
                **self.extra_env,
            }
        )
        with self.log.open("ab") as out:
            self.proc = subprocess.Popen(
                ["node", str(entry)], cwd=self.repo, env=env, stdout=out, stderr=subprocess.STDOUT, start_new_session=True
            )
        deadline = time.time() + 90
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"服务提前退出（code={self.proc.returncode}），日志见 {self.log}")
            try:
                health = http("GET", f"{self.base}/health/deep", timeout=10)
                if health.get("status") == "ok":
                    return
            except Exception:  # noqa: BLE001 - 启动期失败正常
                pass
            time.sleep(1)
        raise RuntimeError(f"服务未在 90s 内就绪，日志见 {self.log}")

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


class EdgeCases:
    def __init__(self, server: Server, label: str):
        self.s = server
        self.project_id = http(
            "POST", f"{server.base}/projects", {"name": f"边界验收-{label}-{int(time.time())}", "description": "edge"}
        )["id"]

    def program(self, label: str) -> str:
        return http(
            "POST",
            f"{self.s.base}/programs",
            {
                "projectId": self.project_id,
                "title": label,
                "goal": "验证研究循环的并发启动与失败修复边界",
                "domain": "methodology",
                "autonomyLevel": "L2",
            },
        )["id"]

    def start(self, program_id: str, question: str = "不确定性越高的样本，其预测误差是否越大？") -> dict:
        return http(
            "POST",
            f"{self.s.base}/research-cycles/start",
            {
                "programId": program_id,
                "question": question,
                "approvalMode": "ai",
                "maxIterations": 1,
                "maxTokens": 200000,
            },
        )

    def status(self, cycle_id: str) -> dict:
        return http("GET", f"{self.s.base}/research-cycles/{cycle_id}")

    def wait_terminal(self, cycle_id: str, timeout: float = 120) -> dict:
        deadline = time.time() + timeout
        last: dict = {}
        while time.time() < deadline:
            last = self.status(cycle_id)
            if str(last.get("state") or "") in {"synthesize", "stopped", "blocked"}:
                return last
            time.sleep(2)
        raise TimeoutError(f"cycle {cycle_id} 未在 {timeout}s 内结束，最后 state={last.get('state')}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--port", type=int, default=4412)
    parser.add_argument("--root", default="/tmp/sciflow-edge")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    results: list[tuple[str, bool, str]] = []
    server: Server | None = None

    try:
        # S-02 修复路径
        print("[1/2] S-02 语法失败自动修复")
        db = root / "repair.db"
        if db.exists():
            db.unlink()
            for suffix in ("-wal", "-shm"):
                p = Path(str(db) + suffix)
                if p.exists():
                    p.unlink()
        server = Server(
            repo,
            args.port,
            db,
            root / "repair-server.log",
            {"MOCK_EXPERIMENT_SYNTAX_ERROR_ONCE": "1"},
        )
        server.start()
        cases = EdgeCases(server, "repair")
        program_id = cases.program("语法修复")
        cycle = cases.start(program_id)
        st = cases.wait_terminal(cycle["id"])
        if st.get("state") != "synthesize":
            raise AssertionError(f"修复路径未完成：{st.get('state')} summary={st.get('summary')}")
        if len(st.get("claims") or []) != 1 or len(st.get("runs") or []) != 1:
            raise AssertionError(f"修复路径 claims/runs 应为 1/1，实际 {len(st.get('claims') or [])}/{len(st.get('runs') or [])}")
        log = server.log_text()
        if 'attempt\\":1' not in log or 'ok\\":false' not in log:
            raise AssertionError("日志缺少第一次语法失败记录，无法证明触发过修复轮")
        if 'ok\\":true' not in log:
            raise AssertionError("日志缺少 execute 成功记录")
        print(f"  PASS state=synthesize claims=1 runs=1 attempt=2 tokens={st.get('tokensSpent')}")
        results.append(("S-02 语法失败自动修复", True, "attempt1 fail → attempt2 ok, claims=1/runs=1"))
        server.kill()
        server = None

        # R-08 并发 start
        print("[2/2] R-08 同一 program 并发 start")
        db = root / "concurrent.db"
        if db.exists():
            db.unlink()
            for suffix in ("-wal", "-shm"):
                p = Path(str(db) + suffix)
                if p.exists():
                    p.unlink()
        server = Server(repo, args.port, db, root / "concurrent-server.log", {})
        server.start()
        cases = EdgeCases(server, "concurrent")
        program_id = cases.program("并发启动")
        body = {
            "programId": program_id,
            "question": "不确定性越高的样本，其预测误差是否越大？",
            "approvalMode": "ai",
            "maxIterations": 1,
            "maxTokens": 200000,
        }
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda _: http_status("POST", f"{server.base}/research-cycles/start", body), range(8)))
        ok = [r for r in responses if r[0] == 201]
        rejected = [r for r in responses if r[0] == 400]
        if len(ok) != 1 or len(rejected) != 7:
            raise AssertionError(f"并发 8 次应 1 成功 7 拒绝，实际 201={len(ok)} 400={len(rejected)} 其他={[r[0] for r in responses if r[0] not in (201, 400)]}")
        for code, text in rejected:
            if "已有循环在运行" not in text:
                raise AssertionError(f"400 拒绝理由不明确：{text[:200]}")
        cycle_id = json.loads(ok[0][1])["id"]
        st = cases.wait_terminal(cycle_id)
        if st.get("state") != "synthesize":
            raise AssertionError(f"并发启动的循环未完成：{st.get('state')} summary={st.get('summary')}")
        cycles = http("GET", f"{server.base}/research-cycles?programId={program_id}")
        if len(cycles) != 1:
            raise AssertionError(f"同一 program 并发启动后 cycles 应为 1，实际={len(cycles)}")
        health = http("GET", f"{server.base}/health/deep", timeout=15)
        cyc = health.get("checks", {}).get("researchCycles", {})
        if cyc.get("active") != 0:
            raise AssertionError(f"结束后仍有 active 循环：{cyc}")
        print(f"  PASS 201=1 400=7 cycles=1 active=0 state=synthesize")
        results.append(("R-08 并发启动幂等", True, "8 并发 → 1 成功 7 拒绝 → 1 cycle → active=0"))
    except Exception as e:  # noqa: BLE001 - 验收打印现场
        results.append(("边界验收", False, str(e)))
        print(f"\nFAIL {e}", file=sys.stderr)
        if server and server.log.exists():
            print("\n".join(server.log_text().splitlines()[-40:]), file=sys.stderr)
    finally:
        if server:
            server.kill()

    print("\n=== 边界验收结果 ===")
    for name, ok, detail in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return 0 if results and all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
