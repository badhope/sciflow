#!/usr/bin/env python3
"""最终验收矩阵（一次性跑完 P0-P5 全部交付面的可观测证据）

覆盖：
  A. 本地门禁：lint / 双端 typecheck / 双端单测 / 双端 build
  B. 服务启动：健康检查 / helmet 头 / pino JSON 日志
  C. 回归：scripts/full_regression.py（全新库 + AI_MOCK=1）
  D. 流水线 e2e：interrupt → confirm → completed + checkpoint + agent trace
  E. MCP：官方 SDK 客户端 HTTP 握手 + callTool
  F. CLI：--help / project list / pipeline status 参数校验
用法：python scripts/final_acceptance.py   （需先 build server）
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error, tempfile, pathlib

import socket, random

ROOT = pathlib.Path(__file__).resolve().parent.parent

def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port

if "ACC_PORT" in os.environ:
    PORT = int(os.environ["ACC_PORT"])
else:
    # 随机独享端口：避免残留服务占用固定端口导致"验收打到旧进程/旧库"的假结果
    PORT = _free_port()
BASE = f"http://127.0.0.1:{PORT}"
DB = os.path.join(tempfile.gettempdir(), f"sciflow-acc-{os.getpid()}-{random.randint(1000,9999)}.db")
RESULTS = []

def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ""))

ANSI = re.compile(r"\[[0-9;]*m")

def run(cmd, env=None, cwd=None, timeout=600):
    e = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0", **(env or {})}
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=e, cwd=cwd or str(ROOT), timeout=timeout)
    return p.returncode, ANSI.sub("", (p.stdout or "") + (p.stderr or ""))

def req(method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw or "null"), dict(resp.headers)
            except ValueError:
                return resp.status, raw, dict(resp.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null"), dict(e.headers)
        except ValueError:
            return e.code, None, {}

print("=" * 64)
print("SciFlow 最终验收矩阵")
print("=" * 64)

# ---------- A. 本地门禁 ----------
print("\n[A] 本地门禁")
code, out = run("node node_modules/eslint/bin/eslint.js .")
# eslint 10 在 0 problem 时静默退出（无输出），因此以退出码为准；有输出时仍要求不含 error 汇总
record("A1 eslint 0 errors", code == 0 and " error " not in f" {out} ", out.strip().splitlines()[-1] if out else "0 problems (silent)")
code, out = run("pnpm --filter @sciflow/server typecheck"); record("A2 server typecheck", code == 0 and "error TS" not in out)
code, out = run("pnpm --filter @sciflow/web typecheck"); record("A3 web typecheck", code == 0 and "error TS" not in out)
code, out = run("pnpm --filter @sciflow/server test")
m = re.search(r"Tests\s+(\d+) passed", out)
record("A4 server 单测", code == 0 and bool(m), f"{m.group(1) if m else '?'} passed")
code, out = run("pnpm --filter @sciflow/web test")
m = re.search(r"Tests\s+(\d+) passed", out)
record("A5 web 单测", code == 0 and bool(m), f"{m.group(1) if m else '?'} passed")
code, out = run("pnpm --filter @sciflow/server build"); record("A6 server build", "error TS" not in out)
code, out = run("pnpm --filter @sciflow/web build"); record("A7 web build", code == 0 and "built in" in out)

# ---------- B. 服务启动 ----------
print("\n[B] 服务启动 / 安全头 / 结构化日志")
logf = open(os.path.join(tempfile.gettempdir(), "sciflow-acc.log"), "w", encoding="utf-8")
srv = subprocess.Popen(
    ["node", "apps/server/dist/apps/server/src/main.js"], cwd=str(ROOT),
    env={**os.environ, "AI_MOCK": "1", "AI_RPM_CAP": "120", "DATABASE_PATH": DB, "PORT": str(PORT)},
    stdout=logf, stderr=subprocess.STDOUT,
)
up = False
for _ in range(40):
    if srv.poll() is not None:
        break  # 进程已退出（如端口占用/启动崩溃），不必再等
    try:
        st, d, _h = req("GET", "/api/health", timeout=5)
        if st == 200:
            up = True
            break
    except Exception:  # aqg: top-level boundary（启动轮询：任何异常都等价于"还没起来"，重试）
        time.sleep(1)
record("B1 健康检查", up, "" if up else f"进程退出码={srv.poll()}，见 sciflow-acc.log")
if not up:
    logf.close()
    srv.terminate()
    print("服务未就绪，验收终止（后续项无法可信执行）")
    sys.exit(2)

st, d, headers = req("GET", "/api/health")
h = {k.lower(): v for k, v in headers.items()}
record("B2 helmet 头", all(k in h for k in ("x-content-type-options", "x-frame-options", "referrer-policy", "strict-transport-security")))
with open(os.path.join(tempfile.gettempdir(), "sciflow-acc.log"), encoding="utf-8") as f:
    logtext = f.read()
record("B3 pino JSON 日志", '"level":30' in logtext and '"msg"' in logtext)

# ---------- C. 回归 ----------
print("\n[C] 全量回归（全新库 + mock）")
code, out = run(f"python scripts/full_regression.py", env={"SCIFLOW_BASE": BASE, "AI_MOCK": "1"})
mm = re.search(r"结果: PASS (\d+) / FAIL (\d+) / KNOWN\(存量缺口\) (\d+)", out)
record("C1 回归 PASS/FAIL/KNOWN", code == 0 and mm and mm.group(2) == "0", mm.group(0) if mm else out.strip().splitlines()[-1][:80])

# ---------- D. 流水线 e2e ----------
print("\n[D] 流水线 e2e（LangGraph interrupt/checkpoint/trace）")
st, proj, _ = req("POST", "/api/projects", {"name": "验收-e2e"})
pid = proj.get("id") if st == 201 else None
st, task, _ = req("POST", "/api/pipeline", {"projectId": pid, "topic": "验收主题：图神经网络"})
tid = task.get("id") if st == 201 else None
interrupted = False
for _ in range(60):
    st, t, _ = req("GET", f"/api/pipeline/{tid}")
    if t.get("status") == "awaiting_confirmation":
        interrupted = True
        break
    time.sleep(0.5)
record("D1 interrupt 挂起", interrupted)
st, _, _h = req("POST", f"/api/pipeline/{tid}/confirm-outline", {})
record("D2 confirm-outline", st in (200, 201))
final = None
for _ in range(240):
    st, t, _ = req("GET", f"/api/pipeline/{tid}")
    if t.get("status") in ("completed", "failed"):
        final = t
        break
    time.sleep(0.5)
record("D3 终态 completed", bool(final) and final.get("status") == "completed", (final or {}).get("lastError", ""))
docid = (final or {}).get("documentId")
record("D4 documentId 回写", bool(docid))
if docid:
    st, doc, _ = req("GET", f"/api/documents/{docid}")
    content = doc.get("content", "") if st == 200 else ""
    record("D5 正文非空且含章节", len(content) > 400 and content.count("##") >= 3, f"len={len(content)}")
st, tr, _ = req("GET", f"/api/agent/executions?projectId={pid}")
runs = tr.get("executions", []) if isinstance(tr, dict) else []
record("D6 agent trace 落库", len(runs) >= 2, f"runs={len(runs)}")

# ---------- E. MCP ----------
print("\n[E] MCP 官方 SDK 握手（HTTP Streamable）")
verify_path = ROOT / "apps" / "server" / "verify-mcp.tmp.mjs"
verify_path.write_text('''import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const c = new Client({ name: 'acc', version: '1.0.0' });
await c.connect(new StreamableHTTPClientTransport(new URL(process.env.ACC_BASE + '/api/mcp/rpc')));
const t = await c.listTools();
const r = await c.callTool({ name: 'literature.search', arguments: { query: 'x', limit: 1 } });
console.log('OK', t.tools.length, Array.isArray(r.content));
await c.close();
''', encoding="utf-8")
code, out = run("node verify-mcp.tmp.mjs", env={"ACC_BASE": BASE}, cwd=str(ROOT / "apps" / "server"))
verify_path.unlink(missing_ok=True)
last = out.strip().splitlines()[-1][:60] if out.strip() else "(no output)"
# 工具总数随能力扩展增长（v1.3 起含 8 个 config.* 工具）：断言握手成功 + 工具数 ≥11 + 内容数组
import re as _re
m_e1 = _re.search(r"OK (\d+) true", out)
record("E1 MCP 握手+调用(HTTP)", code == 0 and bool(m_e1) and int(m_e1.group(1)) >= 11, last)

# ---------- F. CLI ----------
print("\n[F] CLI（commander）")
code, out = run("node apps/server/dist/apps/server/src/cli.js --help", env={"DATABASE_PATH": DB})
record("F1 CLI --help", code == 0 and "Usage:" in out)
code, out = run("node apps/server/dist/apps/server/src/cli.js project list", env={"DATABASE_PATH": DB})
record("F2 project list", code == 0)
code, out = run("node apps/server/dist/apps/server/src/cli.js pipeline status", env={"DATABASE_PATH": DB})
record("F3 缺参报错", code != 0 and "required option" in out)

# ---------- cleanup ----------
def _cleanup():
    srv.terminate()
    try:
        srv.wait(timeout=10)
    except subprocess.TimeoutExpired:
        srv.kill()
    logf.close()
    for suffix in ("", "-wal", "-shm"):
        try: os.remove(DB + suffix)
        except OSError: pass

import atexit
atexit.register(_cleanup)
_cleanup()

# ---------- summary ----------
print("\n" + "=" * 64)
passed = sum(1 for _, ok, _ in RESULTS if ok)
failed = [n for n, ok, _ in RESULTS if not ok]
print(f"验收结果：{passed}/{len(RESULTS)} 通过")
if failed:
    print("未通过：")
    for n in failed:
        print(f"  - {n}")
sys.exit(1 if failed else 0)
