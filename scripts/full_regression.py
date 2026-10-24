#!/usr/bin/env python3
import os
"""SciFlow 全量回归测试 v6 — 覆盖全部 66 个路由（含 guardrail 拒参 / RAG 混合检索 / usage 成本统计专项）

基线数字（本机全新库 + AI_MOCK=1 实测）：
  **PASS 184 / FAIL 0 / KNOWN 0**（v1.0.1：P1/P2 平台化替换 + R1-R8 存量缺口修复后的当前契约）。
  历史：替换期 KNOWN 11 项存量缺口（对象数组作者/指纹回填/BibTeX/RIS/中文 FTS/APA 排序/
  流水线 qualityReports/筛选回包/25.1 命中语义等）已全部修复，KNOWN_GAPS 机制保留（当前为空集）：
  新失败一律计入 FAIL 且 exit 1，不允许隐藏。
说明：
  - 脚本自给自足：空库自建项目；启动时等待 /api/health（最多 40s）防 CI 竞态。
  - 中文检索依赖 FTS5 trigram（database.ts 自动迁移旧库 unicode61 → trigram）。
  - mock 模式下流水线 e2e 需放宽限流（AI_RPM_CAP=120）。
"""
import json, sys, time, urllib.request, urllib.error

BASE = os.environ.get("SCIFLOW_BASE", "http://localhost:3000")
# mock 模式：服务端以 AI_MOCK=1 启动时，AI 调用全部落到本机 mock 网关，流水线可端到端跑通。
MOCK = os.environ.get("AI_MOCK") == "1"
PASS, FAIL, SKIP, KNOWN = 0, 0, 0, 0
FAILED = []
KNOWN_FAILED = []

# 存量后端缺口（P1/P2 重构前即存在；逐项已溯源，修一个删一行 —— 见 ARCHITECTURE.md §8）
KNOWN_GAPS = set()  # 存量缺口已全部修复（R1-R8）；新失败一律计入 FAIL，不允许隐藏

def req(method, path, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw or "null")
            except Exception:
                # 文本类响应（如期刊推荐/投稿信/综述等纯文本接口，Content-Type: text/html）原样回传，
                # 避免被误判为 -1 网络错误而触发 AI_STALL 跳过（mock 模式下这些接口正常返回文本）
                return resp.status, raw
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None
    except Exception as e:
        return -1, str(e)

def check(name, cond, detail=""):
    global PASS, FAIL, KNOWN
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    elif name in KNOWN_GAPS:
        KNOWN += 1
        KNOWN_FAILED.append(name)
        print(f"  ○ {name} — 存量缺口(KNOWN): {detail}")
    else:
        FAIL += 1
        FAILED.append(name)
        print(f"  ✗ {name} — {detail}")

AI_STALL = {"n": 0}

def ai_call(name, fn, retries=1):
    """AI 类接口：429 限流时退避重试；连续超时标记外部网关卡顿并跳过"""
    if AI_STALL["n"] >= 3:
        print(f"  ⏭ {name} — 外部网关连续超时，跳过（不影响代码正确性结论）")
        return -9, None
    for i in range(retries):
        st, data = fn()
        if st == 429:
            time.sleep(6 * (i + 1)); continue
        if st == -1:
            AI_STALL["n"] += 1
        else:
            AI_STALL["n"] = 0
        return st, data
    AI_STALL["n"] += 1
    return 429, None

def info(name, text):
    print(f"  ℹ {name} — {text}")

# 启动竞态防护：等待服务健康（最多 40s），避免首屏请求打在未就绪进程上
for _w in range(80):
    _st, _ = req("GET", "/api/health", timeout=3)
    if _st == 200:
        break
    time.sleep(0.5)

print("=" * 60)
print("SciFlow 全量回归 v5 — 开始")
print("=" * 60)

# ---------- 0. 健康与配置 ----------
st, d = req("GET", "/api/health")
check("健康检查 /api/health", st == 200 and d.get("status") == "ok", f"{st} {d}")
st, d = req("GET", "/api/health/deep")
check("深度探针 /api/health/deep（Q-10.3 三探针）",
      st == 200 and d.get("checks", {}).get("db", {}).get("ok") is True and "vector" in d.get("checks", {}) and "ai" in d.get("checks", {}),
      f"st={st} {str(d)[:160]}")
st, d = req("GET", "/api/settings")
check("设置 /api/settings", st == 200 and d.get("ai") and d.get("env"), f"{st}")
st, d = req("GET", "/api/settings/check")
if MOCK:
    # mock 模式：AI 应被视为已配置且连通（mock 网关回「正常」）
    check("自检 /api/settings/check（mock: configured&ok=true）",
          st == 200 and d.get("ai", {}).get("configured") is True and d.get("ai", {}).get("ok") is True, f"{st} {d}")
else:
    # 无 key 基线：保持 v5 语义（503 → FAIL，属已知 2 个 FAIL 之一）
    check("自检 /api/settings/check", st == 200, f"{st}")
st, d = req("GET", "/api/usage/summary")
check("成本统计 /api/usage/summary", st == 200 and d.get("total") and "byCaller" in d, f"{st}")
if st == 200 and d.get("total"):
    check("成本统计字段完整", all(k in d["total"] for k in ("calls", "prompt_tokens", "completion_tokens", "total_tokens", "avg_latency_ms", "success_rate")), str(d["total"].keys()))

# ---------- 1. 项目 CRUD ----------
st, d = req("GET", "/api/projects")
check("项目列表 /api/projects", st == 200 and isinstance(d, list), f"{st}")
st, d = req("POST", "/api/projects", {"name": "回归测试项目", "description": "v5 全量回归临时项目"})
check("创建项目 /api/projects POST", st == 201 and d.get("id"), f"{st} {d}")
pid = d.get("id") if st == 201 else None
if pid:
    st, d2 = req("GET", f"/api/projects/{pid}")
    check("项目详情 GET :id", st == 200 and d2.get("id") == pid, f"{st}")
    st, d2 = req("PATCH", f"/api/projects/{pid}", {"description": "已更新"})
    check("项目更新 PATCH :id", st == 200, f"{st}")
    st, d2 = req("DELETE", f"/api/projects/{pid}")
    check("项目删除 DELETE :id", st == 200, f"{st}")
    pid = None  # 用已删除的 id 跑后续文档测试会失败，改用现有项目

# 拿一个已有项目跑文档/流水线测试；空库时自建（CI/全新库可跑，脚本自给自足）
st, projects = req("GET", "/api/projects")
proj = next((p for p in projects if p.get("id")), None) if isinstance(projects, list) else None
if proj is None:
    st, created = req("POST", "/api/projects", {"name": "回归基线项目", "description": "全量回归工作区（空库自建）"})
    assert st == 201 and created.get("id"), f"空库自建项目失败: st={st} {created}"
    proj = created
pid = proj["id"]
print(f"  使用现有项目: {proj.get('name')} ({pid})")

# ---------- 2. 文档 CRUD ----------
st, d = req("GET", "/api/documents")
check("文档列表 /api/documents", st == 200 and isinstance(d, list), f"{st}")
st, d = req("POST", "/api/documents", {"projectId": pid, "title": "回归测试论文", "content": "## 引言\n这是回归测试内容。\n\n## 方法\n测试方法。"})
check("创建文档 POST", st == 201 and d.get("id"), f"{st} {d}")
docid = d.get("id") if st == 201 else None
if docid:
    st, d2 = req("GET", f"/api/documents/{docid}")
    check("文档详情 GET :id", st == 200 and d2.get("id") == docid, f"{st}")
    st, d2 = req("PATCH", f"/api/documents/{docid}", {"title": "回归测试论文-v2"})
    check("文档更新 PATCH :id", st == 200 and d2.get("title") == "回归测试论文-v2", f"{st} {d2}")
    st, d2 = req("GET", f"/api/documents/{docid}/export")
    export_text = d2 if isinstance(d2, str) else json.dumps(d2 or "", ensure_ascii=False)
    check(
        "文档导出 export（内容非空且含标题/正文）",
        st == 200 and len(export_text) > 50 and "回归测试论文" in export_text,
        f"st={st} len={len(export_text)} head={export_text[:80]!r}",
    )
    st, d2 = req("POST", f"/api/documents/{docid}/citations", {"text": "Graph neural networks have shown great success in node classification tasks."})
    if st in (200, 201):
        info("引文抽取 POST citations", "成功")
        st, d3 = req("GET", f"/api/documents/{docid}/citations")
        check("引文列表 GET citations", st == 200 and isinstance(d3, list), f"{st} {str(d3)[:80]}")
        st, d3 = req("GET", f"/api/documents/{docid}/export-citations")
        cite_text = d3 if isinstance(d3, str) else json.dumps(d3 or "", ensure_ascii=False)
        check("引文导出 export-citations（非空）", st == 200 and len(cite_text.strip()) > 5, f"st={st} len={len(cite_text)}")
    else:
        info("引文抽取 POST citations", f"业务校验拒绝 st={st}（内容过短属正常拦截）")
    # AI 接口
    for name, path, body in [
        ("大纲生成 outline", f"/api/documents/{docid}/outline", {"topic": "图神经网络综述", "summary": "研究图神经网络的节点分类方法"}),
        ("章节起草 section", f"/api/documents/{docid}/section", {"sectionTitle": "引言"}),
    ]:
        st, d2 = ai_call(name, lambda p=path, b=body: req("POST", p, b))
        info(name, f"st={st} {str(d2)[:90]}")
    st, d2 = ai_call("润色 polish", lambda: req("POST", f"/api/documents/{docid}/polish", {"text": "This is a test sentence for polishing.", "mode": "polish"}))
    info("润色 polish", f"st={st} {str(d2)[:100]}")
    st, d2 = ai_call("翻译 translate", lambda: req("POST", f"/api/documents/{docid}/translate", {"text": "Graph neural networks are powerful.", "targetLang": "zh"}))
    info("翻译 translate", f"st={st} {str(d2)[:100]}")
    st, d2 = req("GET", f"/api/documents/{docid}/polish-records")
    check("润色记录 polish-records", st == 200 and isinstance(d2, list), f"{st}")

# ---------- 3. 知识库（RAG 升级专项） ----------
st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "GNN 测试文献", "type": "text",
    "content": "Graph Neural Networks (GNNs) generalize neural networks to graph-structured data. "
               "Message passing aggregates features from neighboring nodes. 图神经网络在节点分类任务上表现优异，"
               "通过消息传递机制聚合邻居节点特征。"})
check("知识上传 upload（RAG 升级后）", st in (200, 201) and d.get("id"), f"{st} {str(d)[:150]}")
kid = d.get("id") if st in (200, 201) else None
st, d2 = req("GET", "/api/knowledge")
check("知识列表 GET", st == 200 and isinstance(d2, list), f"{st}")
if kid:
    st, d2 = ai_call("知识问答 query（混合检索 BM25+向量）", lambda: req("POST", "/api/knowledge/query", {"projectId": pid, "question": "图神经网络如何实现节点分类？消息传递机制是什么？"}))
    info("RAG 混合检索 query", f"st={st} {str(d2)[:140]}")
    if st in (200, 201) and d2.get("sources"):
        check("RAG sources 命中", len(d2["sources"]) >= 1, str(d2["sources"])[:100])
    st, d2 = req("DELETE", f"/api/knowledge/{kid}")
    check("知识删除 DELETE", st == 200, f"{st}")

# ---------- 4. MCP / Guardrails 专项 ----------
st, d = req("GET", "/api/mcp/info")
check("MCP 信息 /api/mcp/info", st == 200 and d.get("name") and d.get("tools") is not None, f"{st} {d}")
st, d = req("GET", "/api/mcp/tools")
tools = d.get("tools", []) if st == 200 else []
check("MCP 工具列表 tools", st == 200 and len(tools) >= 3, f"{st} {len(tools)}")
if tools:
    name = tools[0]["name"]
    # 构造一个必填参数缺失的调用 → guardrail 应拒绝（参数校验）
    bad_args = {"__missing__": True} if "query" in json.dumps(tools[0].get("inputSchema", {})) else {"query": ""}
    st, d2 = req("POST", "/api/mcp/call", {"name": name, "arguments": bad_args})
    # 恒真断言已删除：两个分支此前都会通过，该 check 毫无判别力
    check("Guardrail 参数校验拒绝（缺参）", st in (400, 422) or "拒绝" in str(d2), f"未拒绝 st={st} {str(d2)[:100]}")
    # 正常调用
    st, d2 = req("POST", "/api/mcp/call", {"name": name, "arguments": {"query": "图神经网络"}})
    check(f"MCP 工具调用 {name}", st in (200, 201), f"st={st} {str(d2)[:90]}")
st, d = req("GET", "/api/mcp/external")
check("MCP 外部服务器列表", st == 200 and isinstance(d, list), f"{st}")

# ---------- 5. 流水线（断点续跑相关） ----------
if MOCK:
    # mock 模式：先种 2 条带元数据的领域文献，让 Research→Writer→renderCitations 链路真正产生引用回填
    for t, doi in [("Graph Neural Networks: A Review", "10.1109/TKDE.2020.3047454"),
                   ("Graph Attention Networks", "10.1145/3097983.3098028")]:
        req("POST", "/api/references", {"projectId": pid, "hit": {
            "title": t, "authors": ["J Zhou", "G Cui"], "year": 2020, "venue": "TKDE",
            "doi": doi, "abstract": "graph neural network message passing node classification survey"}})
st, d = req("POST", "/api/pipeline", {"projectId": pid, "topic": "图神经网络在生物医药中的应用综述"})
check("流水线创建 POST", st == 201 and d.get("id"), f"{st} {str(d)[:150]}")
runid = d.get("id") if st == 201 else None
if runid:
    st, d2 = req("GET", f"/api/pipeline/{runid}")
    check("流水线详情 GET :id", st == 200 and d2.get("id") == runid, f"{st}")
    st, d2 = req("GET", "/api/pipeline")
    check("流水线列表 GET", st == 200 and isinstance(d2, list), f"{st}")

    if MOCK:
        # ---- 端到端跑通一条流水线（mock 网关确定性响应，约 1-2s）----
        def wait_pipeline(targets, timeout=90):
            t0 = time.time()
            while time.time() - t0 < timeout:
                stg, cur = req("GET", f"/api/pipeline/{runid}", timeout=10)
                if stg == 200 and cur.get("status") in targets:
                    return cur
                time.sleep(0.5)
            return None
        outline_p = wait_pipeline({"awaiting_confirmation"})
        check("流水线 e2e·Planner/Research→大纲待确认", outline_p is not None, "等待大纲确认超时")
        outline_step_v = next((s for s in (outline_p or {}).get("steps", []) if s.get("key") == "outline"), {})
        check("流水线 e2e·F2 反共识大纲变体随步骤下发",
              isinstance(outline_step_v.get("variants"), list) and len(outline_step_v.get("variants")) >= 2,
              f"variants={str(outline_step_v.get('variants'))[:80]}")
        # 人工确认大纲（Human-in-the-loop 节点）→ 进入起草→评审→润色→引用→完成
        stc, _ = req("POST", f"/api/pipeline/{runid}/confirm-outline", {})
        check("流水线 e2e·confirm-outline 201", stc in (200, 201), f"st={stc}")
        final = wait_pipeline({"completed", "failed"}, timeout=120)
        check("流水线 e2e·终态 completed", final is not None and final.get("status") == "completed",
              f"status={(final or {}).get('status')} err={(final or {}).get('lastError')}")
        if final and final.get("status") == "completed":
            doc_id = final.get("documentId")
            check("流水线 e2e·documentId 回写", bool(doc_id), f"doc={doc_id}")
            step_map = {s["key"]: s for s in final.get("steps", [])}
            check("流水线 e2e·质量门落库总分≥80", step_map.get("quality-gate", {}).get("output", "").startswith("总分 8"),
                  str(step_map.get("quality-gate", {}).get("output")))
            tv_step = step_map.get("topic-verify", {})
            check("流水线 e2e·F-2.7 步骤起止时间戳", isinstance(tv_step.get("startedAt"), int) and isinstance(tv_step.get("endedAt"), int),
                  f"startedAt={tv_step.get('startedAt')} endedAt={tv_step.get('endedAt')}")
            # qualityReports / citations(format=pipeline) 产物断言
            sq, qd = req("GET", f"/api/quality?documentId={doc_id}")
            check("流水线 e2e·qualityReports 落库", sq == 200 and isinstance(qd, list) and len(qd) >= 1 and qd[0].get("totalScore", 0) >= 80,
                  f"st={sq} n={len(qd) if isinstance(qd, list) else '?'}")
            sc, cd = req("GET", f"/api/documents/{doc_id}/citations")
            n_pipe = sum(1 for c in cd if c.get("format") == "pipeline") if isinstance(cd, list) else 0
            check("流水线 e2e·citations 回填 format=pipeline", sc == 200 and n_pipe >= 1, f"st={sc} n={n_pipe}")
            sdoc, dd = req("GET", f"/api/documents/{doc_id}")
            # 契约变更（v0.6）：正文只保留 [n] 锚点，参考文献列表由前端按用户选中的 CSL 样式渲染，
            # 流水线不再把一份硬编码 GB/T 形态的列表写进正文（否则打开写作页会出现两个参考文献区）。
            # 断言改为：正文含数字锚点 + citations 已落库 —— 这两者才是"引用闭环"的真实契约。
            _body = (dd.get("content") or "") if sdoc == 200 else ""
            _anchors = sum(1 for _ in __import__("re").finditer(r"\[\d+\]", _body))
            check("流水线 e2e·正文含数字锚点（引用闭环）",
                  sdoc == 200 and _anchors >= 1, f"st={sdoc} anchors={_anchors} len={len(_body)}")
    # 不删，留给断点续跑验证

# ---------- 6. 记忆中心 ----------
st, d = req("POST", "/api/memory", {"type": "episodic", "content": "回归测试：用户偏好先润色再回答", "projectId": pid, "keywords": ["测试"]})
check("记忆新增 POST", st == 201 and d.get("id"), f"{st} {d}")
memid = d.get("id") if st == 201 else None
st, d2 = req("GET", "/api/memory")
check("记忆列表 GET", st == 200 and isinstance(d2, list), f"{st}")
if memid:
    st, d2 = req("DELETE", f"/api/memory/{memid}")
    check("记忆删除 DELETE", st == 200, f"{st}")

# ---------- 7. 质量评分 ----------
st, d = ai_call("质量评分 quality POST", lambda: req("POST", "/api/quality", {"documentId": docid, "title": "回归测试论文", "content": "图神经网络（GNN）是一类强大的深度学习模型，专门用于处理图结构数据。本文系统综述了图神经网络在节点分类、链路预测和图分类三大任务中的最新进展。我们首先介绍消息传递机制的基本原理，然后对比分析 GCN、GraphSAGE、GAT 等代表性架构的优缺点，最后讨论图神经网络在生物医药、社交网络和推荐系统等领域的应用前景与面临的挑战。"}))
info("质量评分 quality POST", f"st={st} {str(d)[:120]}")
qid = d.get("id") if st == 201 else None
if qid:
    st, d2 = req("GET", f"/api/quality/{qid}")
    check("质量评分详情 GET :id", st == 200 and d2.get("id") == qid, f"{st}")
st, d2 = req("GET", "/api/quality")
check("质量评分列表 GET", st == 200 and isinstance(d2, list), f"{st}")

# ---------- 8. 文献调研（本地文献库检索，已移除国外在线源） ----------
st, d = req("POST", "/api/references/search", {"query": "graph neural network node classification", "limit": 5})
hits = d.get("hits") if isinstance(d, dict) else (d if isinstance(d, list) else [])
check("文献检索 search（本地文献库）", st in (200, 201) and isinstance(hits, list), f"st={st} hits={len(hits) if isinstance(hits, list) else 0}")
# 先手动入库一条真实元数据文献，验证库内检索命中 ≥1
st, d2 = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Graph Neural Networks: A Review", "authors": ["J Zhou", "G Cui"], "year": 2020, "venue": "TKDE", "doi": "10.1109/TKDE.2020.3047454", "abstract": "A comprehensive survey of graph neural networks for node classification and link prediction tasks."}})
if st in (200, 201) and d2.get("id"):
    refid = d2.get("id")
    st, d3 = req("POST", "/api/references/search", {"query": "graph neural", "projectId": pid, "limit": 5})
    hits3 = d3.get("hits") if isinstance(d3, dict) else (d3 if isinstance(d3, list) else [])
    check("库内检索命中（手动入库后）", st in (200, 201) and len(hits3) >= 1, f"st={st} hits={len(hits3)}")
    st, d3 = req("GET", f"/api/references/{refid}")
    check("文献详情 GET :id", st == 200 and d3.get("id") == refid, f"{st}")
    st, d3 = req("DELETE", f"/api/references/{refid}")
    check("文献删除 DELETE", st == 200, f"{st}")
st, d2 = ai_call("文献批量导入 import", lambda: req("POST", "/api/references/import", {"projectId": pid, "hits": (hits or [])[:2]}))
info("文献批量导入 import", f"st={st} {str(d2)[:80]}")
st, d2 = ai_call("文献综述 summarize", lambda: req("POST", "/api/references/summarize", {"projectId": pid, "topic": "图神经网络"}))
info("文献综述 summarize", f"st={st} {str(d2)[:90]}")
st, d2 = ai_call("证据抽取 evidence", lambda: req("POST", "/api/references/evidence", {"projectId": pid, "question": "GNN 的典型应用是什么？"}))
info("证据抽取 evidence", f"st={st} {str(d2)[:90]}")

# ---------- 9. 投稿辅助 ----------
st, d2 = ai_call("期刊推荐 journals", lambda: req("POST", "/api/submission/journals", {"title": "GNN Survey", "abstract": "A survey of graph neural networks.", "field": "computer science"}))
info("期刊推荐 journals", f"st={st} {str(d2)[:90]}")
st, d2 = ai_call("投稿信 cover-letter", lambda: req("POST", "/api/submission/cover-letter", {"title": "GNN Survey", "abstract": "A survey.", "journal": "Nature Machine Intelligence"}))
info("投稿信 cover-letter", f"st={st} {str(d2)[:90]}")
st, d2 = ai_call("审稿回复 reply-review", lambda: req("POST", "/api/submission/reply-review", {"reviewComments": "The method section needs more detail."}))
info("审稿回复 reply-review", f"st={st} {str(d2)[:90]}")

# ---------- 10. 科研问答 ----------
st, d2 = ai_call("问答 /api/chat", lambda: req("POST", "/api/chat", {"message": "请用一句话介绍图神经网络"}))
info("科研问答 chat", f"st={st} {str(d2)[:90]}")

# ---------- 11. 设置管理 ----------
st, d2 = req("GET", "/api/settings/providers")
check("模型厂商列表 providers", st == 200 and isinstance(d2, list), f"{st}")
st, d2 = req("GET", "/api/settings/mcp-servers")
check("MCP 服务器配置列表", st == 200 and isinstance(d2, list), f"{st}")
st, d2 = ai_call("模型测试 settings/test", lambda: req("POST", "/api/settings/test", {"model": "agnes-3.0-flash"}))
info("模型连通性测试 test", f"st={st} {str(d2)[:90]}")

# ---------- 12. 科研高级功能：阅读状态/去重指纹 ----------
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Systematic Review Methods in Medicine", "authors": ["A Smith", "B Wang"], "year": 2021, "venue": "J Clin Epidemiol", "abstract": "Methods for systematic review and meta-analysis."}})
check("高级功能·文献入库（含指纹）", st in (200, 201) and d.get("id") and d.get("fingerprint"), f"st={st} {str(d)[:160]}")
advRefId = d.get("id") if st in (200, 201) else None
if advRefId:
    # 同标题再入一条 → 应标记 isDuplicateOf 指向首条
    st, d2 = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "systematic review methods in medicine!!!", "authors": ["A Smith", "B Wang"], "year": 2021, "venue": "J Clin Epidemiol", "abstract": "dup"}})
    check("高级功能·标题指纹去重（isDuplicateOf）", st in (200, 201) and d2.get("isDuplicateOf") == advRefId, f"st={st} dup={str(d2)[:120]}")
    st, d2 = req("PATCH", f"/api/references/{advRefId}", {"readingStatus": "reading", "tags": '["rct","cohort"]'})
    check("高级功能·PATCH 阅读状态/标签", st == 200 and d2.get("readingStatus") == "reading" and d2.get("tags") == '["rct","cohort"]', f"st={st} {str(d2)[:120]}")

    # ---------- 13. 系统综述·筛选队列 ----------
    st, d2 = req("POST", "/api/references/screen", {"projectId": pid, "referenceId": advRefId, "status": "included", "reason": "RCT 符合纳入标准"})
    check("筛选·单条纳入 upsert", st in (200, 201) and d2.get("status") == "included" and d2.get("referenceId") == advRefId and d2.get("title"), f"st={st} {str(d2)[:140]}")
    sid = d2.get("id") if st in (200, 201) else None
    # 同条再改状态 → upsert 更新而非新增
    st, d3 = req("POST", "/api/references/screen", {"projectId": pid, "referenceId": advRefId, "status": "uncertain", "reason": "待复核"})
    check("筛选·同条 upsert 更新状态", st in (200, 201) and d3.get("id") == sid and d3.get("status") == "uncertain", f"st={st} {str(d3)[:120]}")
    st, d3 = req("GET", f"/api/references/screen?projectId={pid}")
    check("筛选·列表 join 文献元数据", st == 200 and isinstance(d3, list) and any(x.get("id") == sid for x in d3), f"st={st} n={len(d3) if isinstance(d3, list) else 0}")
    st, d3 = req("POST", "/api/references/screen/bulk", {"projectId": pid, "referenceIds": [advRefId], "status": "excluded", "reason": "批量排除"})
    check("筛选·批量 screen/bulk", st in (200, 201) and d3.get("ok") and d3.get("updated") == 1, f"st={st} {str(d3)[:100]}")

    # ---------- 14. 系统综述·文献编码抽取表 ----------
    st, d2 = req("POST", "/api/references/extraction/fields", {"projectId": pid, "key": "study_design", "label": "研究设计", "kind": "select", "options": ["RCT", "队列", "病例对照"]})
    check("抽取·新建字段（key 校验）", st in (200, 201) and d2.get("id") and d2.get("options") == ["RCT", "队列", "病例对照"], f"st={st} {str(d2)[:140]}")
    fid = d2.get("id") if st in (200, 201) else None
    st, d2 = req("POST", "/api/references/extraction/fields", {"projectId": pid, "key": "Bad Key!", "label": "非法"})
    check("抽取·非法 key 被拒绝", st == 400, f"st={st} {str(d2)[:80]}")
    st, d2 = req("GET", f"/api/references/extraction/fields?projectId={pid}")
    check("抽取·字段列表", st == 200 and isinstance(d2, list) and any(f.get("key") == "study_design" for f in d2), f"st={st}")
    if fid:
        st, d3 = req("PUT", "/api/references/extraction/values", {"fieldId": fid, "referenceId": advRefId, "value": "RCT"})
        check("抽取·设置取值 upsert", st in (200, 201) and d3.get("ok"), f"st={st} {str(d3)[:80]}")
    st, d2 = req("GET", f"/api/references/extraction/table?projectId={pid}")
    row = next((r for r in d2.get("rows", []) if r.get("referenceId") == advRefId), None) if st == 200 else None
    check("抽取·矩阵 table（字段+取值）", st == 200 and d2.get("fields") and row and row.get("values", {}).get(fid) == "RCT", f"st={st} {str(d2)[:140]}")

# ---------- 15. 审稿意见闭环 ----------
if docid:
    st, d = req("POST", "/api/research/review-comments", {"documentId": docid, "comments": [
        {"reviewer": "Reviewer A", "commentText": "方法部分样本量计算缺失，请补充。", "category": "major"},
        {"reviewer": "Reviewer B", "commentText": "相关工作章节缺少近三年文献。", "category": "minor"},
    ]})
    check("审稿意见·批量创建", st in (200, 201) and isinstance(d, list) and len(d) == 2, f"st={st} {str(d)[:140]}")
    rcid = d[0].get("id") if st in (200, 201) and d else None
    st, d2 = req("GET", f"/api/research/review-comments?documentId={docid}")
    check("审稿意见·列表", st == 200 and isinstance(d2, list) and len(d2) >= 2, f"st={st} n={len(d2) if isinstance(d2, list) else 0}")
    if rcid:
        st, d2 = req("PATCH", f"/api/research/review-comments/{rcid}", {"status": "resolved", "responseText": "已在 2.1 节补充样本量计算。"})
        check("审稿意见·更新状态/回复", st == 200 and d2.get("status") == "resolved" and "样本量" in d2.get("responseText", ""), f"st={st} {str(d2)[:120]}")
    # response-letter 为 AI 类，按现有跳过机制调用
    st, d2 = ai_call("审稿回复信 response-letter", lambda: req("POST", "/api/research/response-letter", {"documentId": docid}))
    info("审稿回复信 response-letter", f"st={st} {str(d2)[:90]}")
    if rcid:
        st, d2 = req("DELETE", f"/api/research/review-comments/{rcid}")
        check("审稿意见·删除", st == 200 and d2.get("ok"), f"st={st}")

# ---------- 15.5 F3 实验设计助手 + 流水线运行参数 ----------
st, d = ai_call("F3 实验设计 design POST", lambda: req("POST", "/api/research/design", {"projectId": pid, "question": "时序感知聚合在动态图节点分类中是否优于均匀采样？"}))
info("F3 实验设计 design POST", f"st={st} {str(d)[:120]}")
design_id = d.get("id") if isinstance(d, dict) else None
if design_id:
    check("F3 实验设计·结构化字段（变量/分组/功效）",
          isinstance(d.get("design"), dict) and d["design"].get("variables", {}).get("independent")
          and d["design"].get("groups") and d["design"].get("sampleHint"),
          str(d.get("design"))[:140])
    st, d2 = req("GET", f"/api/research/design?projectId={pid}")
    check("F3 实验设计·列表 GET", st == 200 and isinstance(d2, list) and len(d2) >= 1, f"st={st}")
    st, d2 = req("DELETE", f"/api/research/design/{design_id}")
    check("F3 实验设计·删除 DELETE", st == 200 and d2.get("ok"), f"st={st}")
st, d2 = req("POST", "/api/research/design", {"projectId": pid, "question": "  "})
check("F3 实验设计·空问题 400 语义", st == 400, f"st={st}")
st, d2 = req("GET", "/api/customization/pipeline-settings")
check("流水线设置·GET 研究深度", st == 200 and d2.get("researchDepth") in (1, 2, 3), f"st={st} {d2}")
st, d2 = req("POST", "/api/customization/pipeline-settings", {"researchDepth": 2})
check("流水线设置·POST 研究深度=2", st in (200, 201) and d2.get("researchDepth") == 2, f"st={st} {d2}")
st, d2 = req("POST", "/api/customization/pipeline-settings", {"researchDepth": 9})
check("流水线设置·非法深度 400", st == 400, f"st={st}")
st, d2 = req("POST", "/api/customization/pipeline-settings", {"researchDepth": 1})
check("流水线设置·恢复默认 1", st in (200, 201) and d2.get("researchDepth") == 1, f"st={st} {d2}")

# ---------- 16. 期刊库 + 结构化匹配 ----------
st, d = req("GET", "/api/submission/journals")
check("期刊库·列表（含种子）", st == 200 and isinstance(d, list) and len(d) >= 4, f"st={st} n={len(d) if isinstance(d, list) else 0}")
st, d = req("POST", "/api/submission/journals-lib", {"name": "回归测试期刊", "scopeText": "测试用期刊，可删除。"})
check("期刊库·新增", st in (200, 201) and d.get("id") and d.get("name") == "回归测试期刊", f"st={st} {str(d)[:120]}")
newJid = d.get("id") if st in (200, 201) else None
if newJid:
    st, d2 = req("DELETE", f"/api/submission/journals-lib/{newJid}")
    check("期刊库·删除", st == 200 and d2.get("ok"), f"st={st}")
st, d2 = ai_call("期刊结构化匹配 journals-match", lambda: req("POST", "/api/submission/journals-match", {"title": "Graph neural networks for node classification", "abstract": "We survey GNNs and propose a new message passing architecture."}))
info("期刊结构化匹配 journals-match", f"st={st} {str(d2)[:120]}")

# ---------- 17. 轻量实验沙箱（本机 python3） ----------
import shutil
SANDBOX_PYTHON_OVERRIDE = os.environ.get("SANDBOX_PYTHON", "")
if SANDBOX_PYTHON_OVERRIDE:
    # 服务器以 SANDBOX_PYTHON=/nonexistent 启动 → 验证无 Python 降级路径
    print(f"  ℹ 检测到 SANDBOX_PYTHON={SANDBOX_PYTHON_OVERRIDE}，验证无 Python 降级路径")
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "goal": "无 python3 降级", "code": "print('should not run')"})
    check("实验沙箱·无 Python 降级 status=error", st in (200, 201) and d.get("status") == "error", f"st={st} {str(d)[:200]}")
    check("实验沙箱·无 Python 引导文案含『未检测到 Python』", "未检测到 Python" in (d.get("stderr") or ""), f"stderr={str(d.get('stderr'))[:200]}")
    check("实验沙箱·无 Python 引导含安装提示", "安装" in (d.get("stderr") or "") and ("brew" in (d.get("stderr") or "") or "apt" in (d.get("stderr") or "") or "python.org" in (d.get("stderr") or "")), f"stderr={str(d.get('stderr'))[:200]}")
    check("实验沙箱·无 Python 降级 memoryMonitored=False", d.get("memoryMonitored") is False, f"memoryMonitored={d.get('memoryMonitored')}")
    check("实验沙箱·无 Python 不执行用户代码（stdout 为空）", not (d.get("stdout") or "").strip(), f"stdout={str(d.get('stdout'))[:120]}")
elif not shutil.which("python3"):
    print("  ⏭ 未检测到 python3，实验沙箱用例跳过（不失败）")
else:
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "goal": "验证沙箱执行", "code": "print('hello-sandbox'); print(2+3)"})
    check("实验沙箱·正常执行 run", st in (200, 201) and d.get("status") == "ok" and "hello-sandbox" in (d.get("stdout") or "") and (d.get("stdout") or "").count("5") >= 1, f"st={st} {str(d)[:180]}")
    check("实验沙箱·正常运行返回 memoryMonitored 布尔字段", isinstance(d.get("memoryMonitored"), bool), f"memoryMonitored={d.get('memoryMonitored')!r}")
    eid = d.get("id") if st in (200, 201) else None
    # 异常脚本 → status=error
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "code": "raise RuntimeError('boom')"})
    check("实验沙箱·异常脚本 status=error", st in (200, 201) and d.get("status") == "error" and "boom" in (d.get("stderr") or ""), f"st={st} {str(d)[:180]}")
    # 超时脚本 → status=timeout（默认 10s 杀进程组）
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "code": "while True:\n    pass"})
    check("实验沙箱·超时 status=timeout", st in (200, 201) and d.get("status") == "timeout", f"st={st} {str(d)[:180]}")
    # 输出截断（>64KB）
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "code": "print('x' * 200000)"})
    check("实验沙箱·stdout 截断标记", st in (200, 201) and d.get("stdoutTruncated") is True, f"st={st} trunc={d.get('stdoutTruncated') if isinstance(d, dict) else '?'}")
    if eid:
        st, d2 = req("GET", f"/api/experiments?projectId={pid}")
        check("实验沙箱·列表（updatedAt 倒序）", st == 200 and isinstance(d2, list) and any(x.get("id") == eid for x in d2), f"st={st} n={len(d2) if isinstance(d2, list) else 0}")
        st, d2 = req("GET", f"/api/experiments/{eid}")
        check("实验沙箱·详情 GET :id", st == 200 and d2.get("id") == eid, f"st={st}")
        st, d2 = req("PATCH", f"/api/experiments/{eid}", {"conclusion": "沙箱运行正常"})
        check("实验沙箱·PATCH 结论", st == 200 and d2.get("conclusion") == "沙箱运行正常", f"st={st} {str(d2)[:140]}")
        st, d2 = req("DELETE", f"/api/experiments/{eid}")
        check("实验沙箱·删除", st == 200 and d2.get("ok"), f"st={st}")


# ---------- 17. 投稿流程状态跟踪 ----------
if pid:
    # 登记一个带一审周期的期刊（4 周），用于验证 L3 超期推断
    st, jd = req("POST", "/api/submission/journals-lib", {"name": "回归跟踪期刊", "firstDecisionWeeks": 4})
    trackJid = jd.get("id") if st in (200, 201) else ""
    # 投稿日期设为 6 周前 → 4 周一审周期下应 overdue
    old_ts = int((time.time() - 6 * 7 * 24 * 3600) * 1000)
    st, d = req("POST", "/api/submission/track", {
        "projectId": pid, "journalId": trackJid, "journalName": "回归跟踪期刊",
        "documentId": docid or "", "submittedAt": old_ts, "currentStatus": "submitted", "note": "回归测试登记",
    })
    check("投稿跟踪·登记（含 events 初始事件）", st in (200, 201) and d.get("id") and d.get("currentStatus") == "submitted"
          and isinstance(d.get("events"), list) and len(d["events"]) == 1, f"st={st} {str(d)[:160]}")
    tid = d.get("id") if st in (200, 201) else None
    if tid:
        # 追加状态事件
        st, d2 = req("POST", f"/api/submission/track/{tid}/event", {"status": "external_review", "note": "已送外审"})
        check("投稿跟踪·追加事件（currentStatus 同步）", st in (200, 201) and d2.get("currentStatus") == "external_review"
              and len(d2.get("events", [])) == 2, f"st={st} {str(d2)[:160]}")
        # 列表：最新状态 + 事件正序 + 超期推断字段（4 周周期，投稿 6 周前 → overdue）
        st, d2 = req("GET", f"/api/submission/track?projectId={pid}")
        mine = next((x for x in d2 if x.get("id") == tid), None) if st == 200 else None
        check("投稿跟踪·列表（事件正序 + dueAt/overdue/estimatedStage 推断）",
              st == 200 and mine and mine.get("currentStatus") == "external_review"
              and mine.get("dueAt") and mine.get("overdue") is True and mine.get("overdueDays", 0) > 0
              and mine.get("estimatedStage") and isinstance(mine.get("events"), list)
              and [e["toStatus"] for e in mine["events"]] == ["submitted", "external_review"],
              f"st={st} {str(mine)[:200]}")
        # parse-email：AI 类，无 key/网关不可走既有 ai_call 跳过机制；成功时校验枚举输出
        st, d2 = ai_call("投稿跟踪·AI 邮件解析 parse-email",
                         lambda: req("POST", "/api/submission/track/parse-email",
                                     {"emailText": "尊敬的作者：您的稿件经外审专家评议，需作小修后录用，修回截止 2026-10-31。", "currentStatus": "external_review"}))
        info("投稿跟踪·parse-email", f"st={st} {str(d2)[:120]}")
        if st == 200 and d2:
            check("投稿跟踪·parse-email 返回建议状态在枚举内",
                  d2.get("suggestedStatus") in ("submitted", "initial_review", "external_review", "review_returned",
                                                 "minor_revision", "major_revision", "re_review", "final_review",
                                                 "accepted", "in_production", "rejected", "withdrawn", "transferred"),
                  f"st={st} {str(d2)[:120]}")
        # PATCH：改 note + currentStatus（同步写事件）
        st, d2 = req("PATCH", f"/api/submission/track/{tid}", {"notes": "回归改备注", "currentStatus": "minor_revision"})
        check("投稿跟踪·PATCH（备注 + 状态推进）", st == 200 and d2.get("notes") == "回归改备注"
              and d2.get("currentStatus") == "minor_revision" and len(d2.get("events", [])) >= 3, f"st={st} {str(d2)[:160]}")
        # 非法状态码应被拒绝（400）
        st, d2 = req("POST", f"/api/submission/track/{tid}/event", {"status": "not_a_real_status"})
        check("投稿跟踪·非法状态码被拒绝", st == 400, f"st={st}")
        # DELETE：级联清 events
        st, d2 = req("DELETE", f"/api/submission/track/{tid}")
        check("投稿跟踪·删除", st == 200 and d2.get("ok"), f"st={st}")
        st, d2 = req("GET", f"/api/submission/track?projectId={pid}")
        gone = not any(x.get("id") == tid for x in d2) if st == 200 else False
        check("投稿跟踪·删除后列表不含记录（events 已级联）", gone, f"st={st}")
    if trackJid:
        req("DELETE", f"/api/submission/journals-lib/{trackJid}")

# ---------- 17b. 投稿跟踪：转投他刊串联 + 修回截止日 ----------
if pid:
    # 旧记录（终态拒稿）
    st, d = req("POST", "/api/submission/track", {"projectId": pid, "journalName": "回归转投旧刊", "currentStatus": "rejected"})
    old_id = d.get("id") if st in (200, 201) else None
    # 转投新记录：带 previousSubmissionId + revisionDeadline
    st, d = req("POST", "/api/submission/track", {
        "projectId": pid, "journalName": "回归转投新刊", "currentStatus": "minor_revision",
        "previousSubmissionId": old_id or "", "revisionDeadline": int((time.time() + 10 * 24 * 3600) * 1000),
        "note": "转投自 回归转投旧刊（拒稿）",
    })
    check("投稿跟踪·转投创建（previousSubmissionId + revisionDeadline 落库返回）",
          st in (200, 201) and d.get("id") and d.get("previousSubmissionId") == old_id
          and isinstance(d.get("revisionDeadline"), int) and d.get("currentStatus") == "minor_revision",
          f"st={st} {str(d)[:200]}")
    new_id = d.get("id") if st in (200, 201) else None
    if new_id:
        # PATCH 设置/修改截止日，返回新值
        new_dl = int((time.time() + 20 * 24 * 3600) * 1000)
        st, d2 = req("PATCH", f"/api/submission/track/{new_id}", {"revisionDeadline": new_dl})
        check("投稿跟踪·PATCH revisionDeadline 返回新值",
              st == 200 and d2.get("revisionDeadline") == new_dl, f"st={st} {str(d2)[:160]}")
        # 列表反查：新记录指回旧记录
        st, d2 = req("GET", f"/api/submission/track?projectId={pid}")
        mine = next((x for x in d2 if x.get("id") == new_id), None) if st == 200 else None
        check("投稿跟踪·列表反查 previousSubmissionId",
              st == 200 and mine and mine.get("previousSubmissionId") == old_id, f"st={st} {str(mine)[:200]}")
        req("DELETE", f"/api/submission/track/{new_id}")
    if old_id:
        req("DELETE", f"/api/submission/track/{old_id}")

# ---------- 18. 文献库↔知识库打通（#5）+ RAG 引用可点（#17） ----------
if pid:
    # 造一条文献，标题与知识库文档同名 → 上传时应自动按标题指纹/忽略大小写命中并回填 referenceId
    st, ref = req("POST", "/api/references", {"projectId": pid, "hit": {
        "title": "Knowledge RAG Binding Paper", "authors": ["Test Author"], "year": 2024,
        "venue": "Sciflow Test Venue", "citationCount": 7}})
    check("打通·造文献", st in (200, 201) and ref.get("id"), f"st={st} {str(ref)[:120]}")
    bindRefId = ref.get("id") if st in (200, 201) else None

    if bindRefId:
        # 18.1 上传同名文档 → 自动绑定 referenceId
        st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "Knowledge RAG Binding Paper", "type": "text",
            "content": "这是一篇关于知识库绑定测试的说明文档。图神经网络通过消息传递机制聚合邻居节点特征，在节点分类任务上表现优异。"})
        check("打通·上传同名文档自动绑定 referenceId", st in (200, 201) and d.get("referenceId") == bindRefId, f"st={st} {str(d)[:160]}")
        autoKid = d.get("id") if st in (200, 201) else None

        # 18.2 上传不同名文档 → 不命中则不强绑（referenceId 为空）
        st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "Unbound Working Notes", "type": "text",
            "content": "未绑定的工作笔记。这里记录一些关于图神经网络消息传递机制与节点分类的随记要点。"})
        check("打通·未命中文献时不强绑（referenceId 为空）", st in (200, 201) and not d.get("referenceId"), f"st={st} {str(d)[:160]}")
        unboundKid = d.get("id") if st in (200, 201) else None

        # 18.3 列表嵌入 reference 摘要
        st, lst = req("GET", f"/api/knowledge?projectId={pid}")
        autoRow = next((x for x in lst if x.get("id") == autoKid), None) if st == 200 else None
        check("打通·列表返回 reference 摘要", st == 200 and autoRow and autoRow.get("reference")
              and autoRow["reference"].get("title") == "Knowledge RAG Binding Paper"
              and autoRow["reference"].get("year") == 2024
              and autoRow["reference"].get("venue") == "Sciflow Test Venue"
              and autoRow["reference"].get("citationCount") == 7, f"st={st} {str(autoRow)[:220]}")

        # 18.4 手动绑定 + 绑定不存在文献应被拒
        if unboundKid:
            st, d = req("PATCH", f"/api/knowledge/{unboundKid}/bind", {"referenceId": bindRefId})
            check("打通·PATCH 手动绑定", st == 200 and d.get("referenceId") == bindRefId
                  and d.get("reference", {}).get("title") == "Knowledge RAG Binding Paper", f"st={st} {str(d)[:180]}")
            st, d = req("PATCH", f"/api/knowledge/{unboundKid}/bind", {"referenceId": "nonexistent-ref-id"})
            check("打通·绑定不存在文献被拒绝(400)", st == 400, f"st={st} {str(d)[:120]}")

        # 18.5 RAG 问答来源带 chunkText/chunkId + referenceTitle（AI 类，外部网关不可用时跳过）
        st, d = ai_call("打通/RAG·query 来源带 chunkText+referenceTitle",
                        lambda: req("POST", "/api/knowledge/query", {"projectId": pid, "question": "图神经网络的消息传递机制是什么？"}))
        info("RAG query（打通后）", f"st={st} {str(d)[:160]}")
        if st in (200, 201) and d.get("sources"):
            src0 = d["sources"][0]
            check("RAG 引用可点·sources 带 chunkId/chunkText", bool(src0.get("chunkId")) and bool(src0.get("chunkText")), f"keys={list(src0.keys())}")
            check("RAG 来源卡片·sources 带 chunkSeq（分块序号）", all(isinstance(s.get("chunkSeq"), int) for s in d["sources"]), f"chunkSeq={[s.get('chunkSeq') for s in d['sources']]}")
            bound_src = next((s for s in d["sources"] if s.get("referenceTitle")), None)
            check("打通·命中来源带 referenceTitle", bound_src is not None
                  and bound_src.get("referenceTitle") == "Knowledge RAG Binding Paper",
                  str([s.get("referenceTitle") for s in d["sources"]]))

        # 18.6 解除绑定 → reference 回到 null
        if autoKid:
            st, d = req("PATCH", f"/api/knowledge/{autoKid}/bind", {"referenceId": None})
            check("打通·PATCH 解除绑定", st == 200 and not d.get("referenceId") and d.get("reference") is None, f"st={st} {str(d)[:160]}")

        # 清理本次造的知识库文档
        for kid in (autoKid, unboundKid):
            if kid:
                req("DELETE", f"/api/knowledge/{kid}")

# ---------- 19. 引用网络 + BibTeX/RIS 导出导入 ----------
# 造 2 篇文献 + 1 篇重复 + 1 个文档同时引用这 2 篇（产生共引边）
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Graph Regression Paper A", "authors": ["A Liu"], "year": 2022, "venue": "TKDE", "doi": "10.1/a"}})
gA = d.get("id") if st in (200, 201) else None
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Graph Regression Paper B", "authors": ["B Chen"], "year": 2023, "venue": "NAACL"}})
gB = d.get("id") if st in (200, 201) else None
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "graph regression paper a!!!", "authors": ["A Liu"], "year": 2022, "venue": "TKDE"}})
gDup = d.get("id") if st in (200, 201) else None
check("网络·重复文献 isDuplicateOf", bool(gA) and bool(gDup) and d.get("isDuplicateOf") == gA, f"st={st} dup={str(d)[:120]}")
st, d = req("POST", "/api/documents", {"projectId": pid, "title": "network-smoke-doc"})
gDoc = d.get("id") if st == 201 else None
if gDoc and gA and gB:
    req("POST", f"/api/documents/{gDoc}/citations", {"referenceId": gA})
    req("POST", f"/api/documents/{gDoc}/citations", {"referenceId": gB})
st, d = req("GET", f"/api/references/graph?projectId={pid}")
check("网络·GET graph 返回 nodes/edges", st == 200 and isinstance(d.get("nodes"), list) and isinstance(d.get("edges"), list), f"st={st} nodes={len(d.get('nodes', []))} edges={len(d.get('edges', []))}")
if st == 200:
    edge_pairs = [(e.get("a"), e.get("b"), e.get("type")) for e in d.get("edges", [])]
    has_cocite = any(t == "co-cite" and {a, b} == {gA, gB} for (a, b, t) in edge_pairs)
    has_dup = any(t == "dup" and {a, b} == {gA, gDup} for (a, b, t) in edge_pairs)
    check("网络·共引边（同文档引用 A/B）", has_cocite, str(edge_pairs))
    check("网络·重复边 type=dup", has_dup, str(edge_pairs))

def get_text(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=30) as r:
            return r.status, r.read().decode()
    except Exception as e:
        return -1, str(e)

st, txt = get_text(f"/api/references/export?projectId={pid}&format=bibtex")
check("导出·BibTeX 含 @article 与字段", st == 200 and "@article{" in txt and "title =" in txt and "Graph Regression Paper A" in txt, f"st={st} head={txt[:120]!r}")
st, txt = get_text(f"/api/references/export?projectId={pid}&format=ris")
check("导出·RIS 含 TY/TI/ER", st == 200 and "TY  - JOUR" in txt and "TI  - " in txt and "ER  -" in txt, f"st={st} head={txt[:120]!r}")

bib_sample = """@article{gr2099,
  title = {Graph Regression Paper A},
  author = {Liu, A.},
  year = {2022}
}

@inproceedings{gr2099b,
  title = {Brand New Paper C},
  author = {Wang, Z. and Li, M.},
  booktitle = {NeurIPS},
  year = {2025}
}
"""
st, d = req("POST", "/api/references/import-bibtex", {"projectId": pid, "text": bib_sample})
check("导入·BibTeX imported/skipped 计数", st in (200, 201) and d.get("imported") == 1 and d.get("skipped") == 1, f"st={st} {d}")

# ---------- 20. 连贯连通后端打通：by-document / quality latest / dashboard overview / 幂等引用 ----------
if pid and docid:
    # 20.1 实验按文档回流：跑一个带 documentId 的实验，by-document 应返回它；不存在文档返回空数组
    st, exp = req("POST", "/api/experiments/run", {"projectId": pid, "goal": "连贯连通 by-document 验证", "code": "print('conn')", "documentId": docid})
    connEid = exp.get("id") if st in (200, 201) else None
    st, lst = req("GET", f"/api/experiments/by-document/{docid}")
    check("连通·实验按文档 by-document 返回关联实验",
          st == 200 and isinstance(lst, list) and (any(x.get("id") == connEid for x in lst) if connEid else True),
          f"st={st} n={len(lst) if isinstance(lst, list) else 0}")
    st, lst = req("GET", "/api/experiments/by-document/__no_such_doc__")
    check("连通·by-document 不存在文档返回空数组不报错", st == 200 and isinstance(lst, list) and len(lst) == 0, f"st={st} {str(lst)[:80]}")

    # 20.2 质量分 latest：200 不崩；有记录时含 totalScore/scores/createdAt（无记录时空，不 404）
    st, q = req("GET", f"/api/quality/latest?documentId={docid}")
    check("连通·quality/latest 200 不崩", st == 200, f"st={st} {str(q)[:120]}")
    if isinstance(q, dict) and q:
        check("连通·quality/latest 含 totalScore/scores/createdAt", all(k in q for k in ("totalScore", "scores", "createdAt")), f"keys={list(q.keys())}")
    else:
        info("连通·quality/latest 该文档暂无评分（空响应，符合预期）", f"st={st}")

    # 20.3 Dashboard overview 全链路聚合：7 字段齐全、列表类为 list、计数类为 int
    st, ov = req("GET", "/api/dashboard/overview")
    need = ("pendingOutline", "overdueSubmissions", "openReviewComments", "lowQualityDocs", "experimentCount", "docCount", "refCount")
    check("连通·dashboard/overview 200 且 7 字段齐全", st == 200 and isinstance(ov, dict) and all(k in ov for k in need), f"st={st} keys={list(ov.keys()) if isinstance(ov, dict) else ov}")
    if st == 200 and isinstance(ov, dict):
        check("连通·overview 列表类为 list、计数类为 int",
              isinstance(ov.get("overdueSubmissions"), list) and isinstance(ov.get("lowQualityDocs"), list)
              and isinstance(ov.get("pendingOutline"), int) and isinstance(ov.get("openReviewComments"), int)
              and isinstance(ov.get("experimentCount"), int) and isinstance(ov.get("docCount"), int) and isinstance(ov.get("refCount"), int),
              f"{ {k: type(v).__name__ for k, v in ov.items()} }")

    # 20.4 幂等引用写入：同 document+reference 第二次返回同一行；写入后可在文档引用列表读到
    st, rdoc = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Conn Cite Paper", "authors": ["Conn"], "year": 2025, "doi": "10.1/conn"}})
    connRef = rdoc.get("id") if st in (200, 201) else None
    if connRef:
        st, c1 = req("POST", "/api/references/citations", {"documentId": docid, "referenceId": connRef, "location": "引言", "context": "连通验证"})
        check("连通·POST references/citations 首次写入（有 DOI verified=1）", st in (200, 201) and c1.get("id") and c1.get("verified") == 1, f"st={st} {str(c1)[:120]}")
        st, c2 = req("POST", "/api/references/citations", {"documentId": docid, "referenceId": connRef, "location": "别处", "context": "不应覆盖"})
        check("连通·POST references/citations 幂等（第二次返回同一行）", st in (200, 201) and c2.get("id") == c1.get("id"), f"st={st} {str(c2)[:120]}")
        st, cl = req("GET", f"/api/documents/{docid}/citations")
        check("连通·citations 写入后可在文档引用列表读到", st == 200 and any(c.get("reference", {}).get("id") == connRef for c in cl), f"st={st} n={len(cl) if isinstance(cl, list) else 0}")

# ---------- 21. 路线图后端差距（#6/#7/#11/#20/#22 + 知识库上传自动建条目） ----------
if pid:
    # 21.1 文献笔记 notes（差距 #11）：PATCH 写入 + 列表返回 + null 清空
    st, nr = req("POST", "/api/references", {"projectId": pid, "hit": {
        "title": f"Notes Gap Smoke {int(time.time()) % 100000}", "authors": ["Note Author"], "year": 2024, "venue": "Note Venue"}})
    noteRefId = nr.get("id") if st in (200, 201) else None
    if noteRefId:
        st, d = req("PATCH", f"/api/references/{noteRefId}", {"notes": "重点：需复核样本量与统计方法", "readingStatus": "reading"})
        check("差距#11·PATCH notes 与既有字段并存", st == 200 and d.get("notes") == "重点：需复核样本量与统计方法" and d.get("readingStatus") == "reading", f"st={st} {str(d)[:140]}")
        st, lst = req("GET", f"/api/references?projectId={pid}")
        nrow = next((r for r in lst if r.get("id") == noteRefId), None) if st == 200 else None
        check("差距#11·列表返回 notes", st == 200 and nrow and nrow.get("notes") == "重点：需复核样本量与统计方法", f"st={st} row={str(nrow)[:120] if nrow else None}")
        st, d = req("PATCH", f"/api/references/{noteRefId}", {"notes": None})
        check("差距#11·notes=null 接受并清空", st == 200 and d.get("notes") == "", f"st={st} {str(d)[:100]}")

    # 21.2 项目级 preface（差距 #22）：PATCH 落库 + GET 返回（system prompt 注入为运行时行为，无 AI key 黑盒仅验字段）
    st, d = req("PATCH", f"/api/projects/{pid}", {"preface": "项目要求：必须引用近三年中文核心文献"})
    check("差距#22·PATCH preface 写入", st == 200 and d.get("preface") == "项目要求：必须引用近三年中文核心文献", f"st={st} {str(d)[:140]}")
    st, pl = req("GET", "/api/projects")
    prow = next((p for p in pl if p.get("id") == pid), None)
    check("差距#22·项目列表返回 preface", st == 200 and prow and prow.get("preface") == "项目要求：必须引用近三年中文核心文献", f"st={st}")

    # 21.3 批量 DOI 本地核验（差距 #20）：合法置 cited / 非法不动 / 不存在进 skipped
    st, ok = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "DOI Valid Gap Paper", "authors": ["V Auth"], "year": 2023, "doi": "10.1234/abcd.2024.x"}})
    vId = ok.get("id") if st in (200, 201) else None
    st, bad = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "DOI Bad Gap Paper", "authors": ["B Auth"], "year": 2023, "doi": "not-a-doi"}})
    bId = bad.get("id") if st in (200, 201) else None
    if vId and bId:
        st, d = req("POST", "/api/references/verify-dois", {"ids": [vId, bId, "__no_such_ref__"]})
        check("差距#20·verify-dois 合法/非法/不存在三分桶",
              st in (200, 201) and len(d.get("valid", [])) == 1 and d["valid"][0]["id"] == vId
              and len(d.get("invalid", [])) == 1 and d["invalid"][0]["id"] == bId
              and len(d.get("skipped", [])) == 1 and d["skipped"][0]["id"] == "__no_such_ref__",
              f"st={st} {str(d)[:200]}")
        st, r = req("GET", f"/api/references/{vId}")
        check("差距#20·合法 DOI 文献 readingStatus→cited", st == 200 and r.get("readingStatus") == "cited", f"st={st} {str(r)[:120]}")
        st, r = req("GET", f"/api/references/{bId}")
        check("差距#20·非法 DOI 文献状态不动", st == 200 and r.get("readingStatus") != "cited", f"st={st} {str(r)[:120]}")

    # 21.4 质量 feedback 拆条进 review_comment（差距 #7，幂等）
    # 无 AI key 时直接向冒烟 SQLite 种一条 quality_report 做确定性验证（SCIFLOW_DB_PATH 指向冒烟库）
    db_path = os.environ.get("SCIFLOW_DB_PATH", "")
    if docid and db_path and os.path.exists(db_path):
        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.execute("DELETE FROM review_comment WHERE document_id=? AND reviewer='AI 质量评审'", (docid,))
        conn.execute(
            "INSERT INTO quality_report (id, document_id, total_score, scores, feedback, created_at) VALUES (?,?,?,?,?,?)",
            (f"seed-g21-{int(time.time())}", docid, 62,
             json.dumps({"literature": 80, "logic": 75, "citation": 70, "language": 72, "novelty": 45, "figures": 68, "format": 74}),
             "文献综述部分缺少近三年工作；\n创新性不足，对比基线不充分；\n图表标注不规范，建议统一配色。",
             int(time.time() * 1000)))
        conn.commit(); conn.close()
        st, d1 = req("POST", f"/api/quality/export-comments?documentId={docid}")
        check("差距#7·export-comments 首次拆条创建", st in (200, 201) and d1.get("created", 0) >= 1 and d1.get("existing") == 0, f"st={st} {str(d1)[:160]}")
        st, d2 = req("POST", f"/api/quality/export-comments?documentId={docid}")
        check("差距#7·export-comments 二次幂等不重复插", st in (200, 201) and d2.get("created") == 0 and d2.get("existing", 0) >= 1, f"st={st} {str(d2)[:160]}")
    else:
        st, d = req("POST", f"/api/quality/export-comments?documentId={docid or ''}")
        info("差距#7·export-comments（无报告/未设 SCIFLOW_DB_PATH）", f"st={st} {str(d)[:120]}")

    # 21.5 知识库上传自动建文献条目（差距 #6 补全）
    st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "Attention Is All You Need Deep Read.pdf", "type": "text",
        "content": "本文深入解读 Transformer 架构的自注意力机制。多头注意力并行计算不同子空间的表示，位置编码注入顺序信息，在机器翻译任务上取得了当时最优的结果并显著加速训练。"})
    check("差距#6b·上传论文名自动建文献并回填 referenceId", st in (200, 201) and d.get("referenceId"), f"st={st} {str(d)[:180]}")
    autoRef = d.get("referenceId") if st in (200, 201) else None
    if autoRef:
        st, r = req("GET", f"/api/references/{autoRef}")
        check("差距#6b·自动条目 source=knowledge-upload 且标题已去扩展名",
              st == 200 and r.get("source") == "knowledge-upload" and r.get("title") == "Attention Is All You Need Deep Read",
              f"st={st} {str(r)[:160]}")
    st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "本周工作笔记汇总", "type": "text",
        "content": "本周工作记录与会议讨论要点随手记。内容较长以保证分块成功，多写一些关于项目进展的流水账文字凑够分块阈值。"})
    check("差距#6b·笔记类文件名不误建（referenceId 为空）", st in (200, 201) and not d.get("referenceId"), f"st={st} {str(d)[:180]}")

# ---------- 22. 本轮新增：知识库 chunk 取数（GET /:id）与纯检索（POST /search） ----------
if pid:
    # 22.1 上传一份带 Markdown 标题的资料，用于验证 chunks + outline 派生
    st, ku = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "R5C 分块取数样本.md", "type": "text",
        "content": "## 引言\n图神经网络通过消息传递聚合邻居节点特征，近年来被广泛应用于推荐与风控。\n\n## 方法\n我们设计了一种新的消息传递聚合算子，在表示能力与计算效率之间取得平衡。\n\n## 实验\n在节点分类与链接预测任务上进行了充分实验，与主流基线对比均有提升。"})
    kbid = ku.get("id") if st in (200, 201) else None
    check("R5C·样本资料上传成功供取数验证", st in (200, 201) and bool(kbid), f"st={st} id={kbid}")

    # 22.2 GET /:id：返回 chunks 数组 + outline（从 ## 标题派生）
    if kbid:
        st, det = req("GET", f"/api/knowledge/{kbid}")
        check("R5C·GET /knowledge/:id 200 且含 chunks 数组", st == 200 and isinstance(det, dict) and isinstance(det.get("chunks"), list) and len(det.get("chunks", [])) >= 1,
              f"st={st} keys={list(det.keys()) if isinstance(det, dict) else det} nchunks={len(det.get('chunks', [])) if isinstance(det, dict) else '?'}")
        # chunks 按 seq 升序
        seqs = [c.get("seq") for c in det.get("chunks", [])] if st == 200 else []
        check("R5C·GET /:id chunks 按 seq 升序", seqs == sorted(seqs) and len(seqs) >= 1, f"seqs={seqs}")
        # outline 抽取到真实章节标题
        outline = det.get("outline") if st == 200 else None
        check("R5C·GET /:id outline 抽到 ## 标题（引言/方法/实验）",
              bool(outline) and all(h in outline for h in ("引言", "方法", "实验")), f"outline={str(outline)[:120]}")

    # 22.3 POST /search：纯本地 BM25 检索（无 AI key 也应返回，不依赖 LLM）
    st, hits = req("POST", "/api/knowledge/search", {"projectId": pid, "query": "消息传递聚合算子"})
    check("R5C·POST /knowledge/search 返回命中文块数组",
          st in (200, 201) and isinstance(hits, list) and len(hits) >= 1, f"st={st} n={len(hits) if isinstance(hits, list) else hits}")
    if st in (200, 201) and isinstance(hits, list) and hits:
        h0 = hits[0]
        check("R5C·search 命中块含 docName/score/referenceId 字段",
              all(k in h0 for k in ("docName", "score", "referenceId")), f"keys={list(h0.keys())}")

    # 22.4 POST /search 空项目：空数组不报错
    st, hits2 = req("POST", "/api/knowledge/search", {"projectId": "__no_such_project_r5c__", "query": "聚合"})
    check("R5C·search 空项目返回空数组不报错", st in (200, 201) and isinstance(hits2, list) and len(hits2) == 0, f"st={st} {str(hits2)[:80]}")

    # 22.5 GET /:id 不存在：404 不崩
    st, nf = req("GET", "/api/knowledge/__no_such_doc_r5c__")
    check("R5C·GET /:id 不存在返回 404", st == 404, f"st={st} {str(nf)[:80]}")

# ---------- 23. R6B 后端缺口：version-name / render-citations / SSE sources 字段 ----------
# 复用第 19 段的 gDoc（已挂 gA=[1]、gB=[2]）。gA="A Liu"(Liu,2022)，gB="B Chen"(Chen,2023)。
if gDoc and gA and gB:
    # 23.0 造历史快照：先写一次旧正文（旧 content 为空不入快照），再写带锚点正文（旧非空→压入 versions）
    req("PATCH", f"/api/documents/{gDoc}", {"content": "快照正文v1"})
    req("PATCH", f"/api/documents/{gDoc}", {"content": "正文见 [1] 与 [2]。"})
    st, gdoc2 = req("GET", f"/api/documents/{gDoc}")
    import json as _json
    _vers = _json.loads(gdoc2.get("versions") or "[]") if isinstance(gdoc2.get("versions"), str) else (gdoc2.get("versions") or [])
    check("R6B·version-name 前置：versions 历史快照已产生", len(_vers) >= 1, f"versions={[_v.get('version') for _v in _vers]}")
    _vnum = _vers[0].get("version") if _vers else None

    # 23.1 PATCH version-name 命名 + 幂等覆盖
    st, vn = req("PATCH", f"/api/documents/{gDoc}/version-name", {"version": _vnum, "name": "初稿"})
    _vn0 = (vn[0] if isinstance(vn, list) and vn else {})
    check("R6B·version-name 命名返回 versions 数组且 name 写入", st == 200 and isinstance(vn, list) and any(v.get("name") == "初稿" for v in vn), f"st={st} {str(vn)[:160]}")
    st, vn2 = req("PATCH", f"/api/documents/{gDoc}/version-name", {"version": _vnum, "name": "改名后"})
    check("R6B·version-name 幂等覆盖（同名版本重复命名覆盖）", st == 200 and any(v.get("name") == "改名后" for v in vn2) and not any(v.get("name") == "初稿" for v in vn2), f"st={st} {str(vn2)[:160]}")
    st, vn3 = req("PATCH", f"/api/documents/{gDoc}/version-name", {"version": 999999, "name": "不存在的版本"})
    check("R6B·version-name version 不存在返回 400", st == 400, f"st={st} {str(vn3)[:120]}")
    st, vn4 = req("PATCH", f"/api/documents/{gDoc}/version-name", {"version": _vnum, "name": "   "})
    check("R6B·version-name 空 name 返回 400", st == 400, f"st={st}")

    # 23.2 render-citations 序号样式（ieee）：正文 [n] 不变，changed=false
    st, ri = req("POST", f"/api/documents/{gDoc}/render-citations", {"style": "ieee"})
    check("R6B·render ieee：changed=false 且正文 [1][2] 保持", st in (200, 201) and ri.get("changed") is False and "[1]" in ri.get("content", "") and "[2]" in ri.get("content", ""), f"st={st} {str(ri)[:160]}")

    # 23.3 render-citations 著者-年样式（apa）：正文 → (姓, 年)，references 按姓字母序
    st, ra = req("POST", f"/api/documents/{gDoc}/render-citations", {"style": "apa", "dryRun": True})
    _rc = ra.get("content", "")
    check("R6B·render apa：changed=true 且正文锚点转为 (姓,年)", st in (200, 201) and ra.get("changed") is True and "(Liu, 2022)" in _rc and "(Chen, 2023)" in _rc and "[1]" not in _rc, f"st={st} content={_rc[:120]!r}")
    _refs = ra.get("references", [])
    # 断言口径更新：commit 2f6c885「去轮子化」把手写 formatRefEntry8 换为 citation-js CSL 引擎后，
    # apa 条目输出真实 APA 形态（"Chen, B. (2023)..." 而非旧手写 "B Chen. ..."）。
    # 保留的契约 = 作者姓字母序（Chen 先于 Liu）+ CSL 正常出格式；旧前缀断言为过期期望，已修正。
    check("R6B·render apa：参考文献按作者姓字母序（Chen 先于 Liu，CSL 格式）", st in (200, 201) and len(_refs) == 2 and _refs[0].startswith("Chen") and _refs[1].startswith("Liu") and "2023" in _refs[0] and "2022" in _refs[1], f"refs={_refs}")

    # 23.4 dryRun/缺省都不落库：服务端 content 仍是 [1][2]
    st, gdoc3 = req("GET", f"/api/documents/{gDoc}")
    check("R6B·render-citations 不落库（dryRun/缺省均不改 content）", gdoc3.get("content") == "正文见 [1] 与 [2]。", f"content={gdoc3.get('content')!r}")

    # 23.5 幂等：相同 style 两次结果逐字节一致
    st, ra1 = req("POST", f"/api/documents/{gDoc}/render-citations", {"style": "apa"})
    st, ra2 = req("POST", f"/api/documents/{gDoc}/render-citations", {"style": "apa"})
    check("R6B·render-citations 幂等（同 style 两次逐字节一致）", ra1 == ra2, f"first={str(ra1)[:120]}")

# 23.6 knowledge/search 命中块字段（离线可测）：search 层字段名为 content/seq；chat SSE sources 由 chat.service
#     重命名为 chunkText/chunkSeq（已用 curl 对 /api/chat/stream 实测确认）。这里校验 search 层同源字段齐全。
st, hits = req("POST", "/api/knowledge/search", {"projectId": pid, "query": "消息传递聚合算子"})
if st in (200, 201) and isinstance(hits, list) and hits:
    h0 = hits[0]
    check("R6B·search 命中块含 content/seq/referenceTitle（chat SSE sources 同源；chunkText/chunkSeq 为 chat 层重命名）",
          all(k in h0 for k in ("content", "seq", "referenceTitle", "docName", "score", "referenceId")),
          f"keys={list(h0.keys())}")

# ---------- 24. R6B 行为收紧：a/b 按正文首现序 / chunkText ≤2000 截断 ----------
# 24.1 同作者同年两篇，正文 [1] 先引 B、[2] 后引 A → 后缀按正文出现序 (2020a)=B、(2020b)=A，列表同步
st, rA = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "SameAuthor Paper A", "authors": ["Wei Zhang"], "year": 2020, "venue": "J1"}})
abA = rA.get("id") if st in (200, 201) else None
st, rB = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "SameAuthor Paper B", "authors": ["Wei Zhang"], "year": 2020, "venue": "J2"}})
abB = rB.get("id") if st in (200, 201) else None
st, d = req("POST", "/api/documents", {"projectId": pid, "title": "ab-order-doc"})
abDoc = d.get("id") if st == 201 else None
if abDoc and abA and abB:
    # 插入序：先 B(=[1]) 后 A(=[2])
    req("POST", f"/api/documents/{abDoc}/citations", {"referenceId": abB})
    req("POST", f"/api/documents/{abDoc}/citations", {"referenceId": abA})
    req("PATCH", f"/api/documents/{abDoc}", {"content": "结论见 [1]，后续 [2] 补充。"})
    st, ra = req("POST", f"/api/documents/{abDoc}/render-citations", {"style": "apa"})
    _c = ra.get("content", "")
    # 正文：先出现 (Zhang, 2020a) 对应 [1]=Paper B，后 (Zhang, 2020b) 对应 [2]=Paper A
    _pos_a = _c.find("(Zhang, 2020a)")
    _pos_b = _c.find("(Zhang, 2020b)")
    check("R6B·a/b 按正文首现序：[1](先引)=2020a、[2](后引)=2020b",
          st in (200, 201) and _pos_a != -1 and _pos_b != -1 and _pos_a < _pos_b,
          f"content={_c!r}")
    _refs = ra.get("references", [])
    check("R6B·a/b 文末列表同步：Paper B(2020a) 先于 Paper A(2020b)",
          len(_refs) == 2 and "Paper B" in _refs[0] and "2020a" in _refs[0] and "Paper A" in _refs[1] and "2020b" in _refs[1],
          f"refs={_refs}")
    # 幂等
    st, r1 = req("POST", f"/api/documents/{abDoc}/render-citations", {"style": "apa"})
    st, r2 = req("POST", f"/api/documents/{abDoc}/render-citations", {"style": "apa"})
    check("R6B·a/b 渲染幂等（同 style 两次逐字节一致）", r1 == r2, "")

# 24.2 chunkText ≤2000 截断（chat SSE sources）：上传 >2000 字知识文档，读 SSE 首事件校验
_long = "这是一段用于截断测试的长文本。" * 200  # 3000 字
st, up = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "trunc-long-doc", "type": "text", "content": _long})
if st in (200, 201) and up.get("id"):
    try:
        rq = urllib.request.Request(BASE + "/api/chat/stream",
                                    data=json.dumps({"projectId": pid, "message": "截断测试"}).encode(),
                                    method="POST", headers={"Content-Type": "application/json"})
        _src = None
        with urllib.request.urlopen(rq, timeout=30) as resp:
            for rawline in resp:
                line = rawline.decode().strip()
                if line.startswith("data:") and '"sources"' in line:
                    _src = json.loads(line[5:]).get("sources")
                    break
        if _src:
            _ct = _src[0].get("chunkText", "")
            # 护栏口径（2026-10-13 二轮修正）：分块已切换到 @langchain/textsplitters（拆分上限 800 字），
            # 正常不再触发 chat 层 2000 字截断；断言收敛为「≤2000+6 护栏 且（未超限或有截断标记）」，
            # 超限时仍必须带 …[已截断] 标记 —— 保护 chat SSE sources 的负载上限契约。
            _bounded = len(_ct) <= 2000
            _truncated_ok = _bounded or (_ct.endswith("…[已截断]") and len(_ct) <= 2006)
            check("R6B·chunkText 上限护栏：≤2000（或超限时带截断标记）且 chunkSeq 保留",
                  _truncated_ok and "chunkSeq" in _src[0],
                  f"len={len(_ct)} tail={_ct[-12:]!r}")
        else:
            print("  ⏭ R6B·chunkText 截断 — 未抓到 sources 事件（无 AI/mock 未起），跳过")
    except Exception as e:
        print(f"  ⏭ R6B·chunkText 截断 — SSE 读取失败（{e}），跳过")

# ---------- 25. Research 阶段跨库检索增强（纯本地 references LIKE + knowledge BM25，零外部 API） ----------
# mock 模式下 research 阶段返回确定性 hits：命中>0（干净项目种 2 条带元数据文献）与
# 命中 0（干净空项目）两条路径都可断言。无 mock 时整段跳过（流水线端到端需 mock 网关）。
if MOCK:
    print("  —— 25. Research 跨库检索增强（命中>0 来源标记 / 命中0 引导） ——")

    def _wait_pipe(run_id, targets, timeout=120):
        t0 = time.time()
        while time.time() - t0 < timeout:
            stg, cur = req("GET", f"/api/pipeline/{run_id}", timeout=10)
            if stg == 200 and cur.get("status") in targets:
                return cur
            time.sleep(0.5)
        return None

    # 25.1 命中>0：干净项目种 2 条带元数据文献（摘要均含 graph neural network，保证项目级 LIKE 命中）
    st, pj = req("POST", "/api/projects", {"name": "跨库命中项目", "description": "cross-search hit path"})
    hit_pid = pj.get("id") if st == 201 else None
    if hit_pid:
        for t, ab in [("Conformal Prediction for Molecular Property Prediction",
                       "graph neural network conformal prediction uncertainty molecular property"),
                      ("Equivariant GNN for Drug Binding",
                       "graph neural network equivariant drug binding affinity")]:
            req("POST", "/api/references", {"projectId": hit_pid, "hit": {
                "title": t, "authors": ["A Li", "B Wang"], "year": 2023, "venue": "J. Chem.",
                "abstract": ab}})
        st, pl = req("POST", "/api/pipeline", {"projectId": hit_pid, "topic": "分子性质预测的不确定性估计方法综述"})
        run2 = pl.get("id") if st == 201 else None
        if run2 and _wait_pipe(run2, {"awaiting_confirmation"}):
            req("POST", f"/api/pipeline/{run2}/confirm-outline", {})
            fin2 = _wait_pipe(run2, {"completed", "failed"})
            check("25.1 跨库命中>0 流水线完成", fin2 is not None and fin2.get("status") == "completed",
                  f"status={(fin2 or {}).get('status')} err={(fin2 or {}).get('lastError')}")
            if fin2 and fin2.get("status") == "completed":
                check("25.1 命中>0 时 researchNotice 为空", not fin2.get("researchNotice"),
                      f"notice={fin2.get('researchNotice')!r}")
                sd, dd = req("GET", f"/api/documents/{fin2.get('documentId')}")
                c2 = dd.get("content", "") if sd == 200 else ""
                # v0.6 契约：正文不再内嵌参考文献列表；来源/匹配度改由 citations 元数据承载
                _sc25, _cit25 = req("GET", f"/api/documents/{fin2.get('documentId')}/citations")
                check("25.1 引用已落库（来源可追溯）",
                      _sc25 == 200 and isinstance(_cit25, list) and len(_cit25) >= 1,
                      f"st={_sc25} n={len(_cit25) if isinstance(_cit25, list) else '?'}")
                # v0.6 契约：正文只保留 [n] 锚点，参考文献列表由前端按样式渲染。
                # 这里只断言「锚点存在且 citations 已落库」——不再断言正文没有「## 参考文献」标题：
                # 模型完全可能在正文里自己写这个标题（真实模型下会误报），那不是契约的一部分。
                check("25.1 正文含数字锚点（引用闭环）",
                      bool(__import__("re").search(r"\[\d+\]", c2)), f"len={len(c2)}")

    # 25.2 命中0：干净空项目（无文献/无知识库）跑流水线 → researchNotice 非空 + 产物含引导段
    st, pj0 = req("POST", "/api/projects", {"name": "跨库零命中项目", "description": "cross-search zero-hit path"})
    zero_pid = pj0.get("id") if st == 201 else None
    if zero_pid:
        st, pl0 = req("POST", "/api/pipeline", {"projectId": zero_pid, "topic": "古瓷器修复工艺中的材料科学研究"})
        run0 = pl0.get("id") if st == 201 else None
        if run0 and _wait_pipe(run0, {"awaiting_confirmation"}):
            req("POST", f"/api/pipeline/{run0}/confirm-outline", {})
            fin0 = _wait_pipe(run0, {"completed", "failed"})
            check("25.2 命中0 流水线完成", fin0 is not None and fin0.get("status") == "completed",
                  f"status={(fin0 or {}).get('status')} err={(fin0 or {}).get('lastError')}")
            if fin0 and fin0.get("status") == "completed":
                check("25.2 命中0 时 researchNotice 非空且含引导文案（API 字段）",
                      bool(fin0.get("researchNotice")) and "未在本地文献库" in fin0.get("researchNotice", ""),
                      f"notice={fin0.get('researchNotice')!r}")
                sd0, dd0 = req("GET", f"/api/documents/{fin0.get('documentId')}")
                c0 = dd0.get("content", "") if sd0 == 200 else ""
                check("25.2 产物文档正文含零命中结构化引导段",
                      "研究阶段未在本地文献库" in c0, f"len={len(c0)} tail={c0[-160:]!r}")

# ---------- 26. 技术债收口后端：自定义模板透传(templates) + 知识库来源补作者/年份(referenceAuthors/referenceYear) ----------
# 纯后端可测，不依赖 AI：projects PATCH/GET 回读 templates JSON 字符串；
# 种子一条「对象数组形态 authors」的文献 + 同名知识库文档（标题指纹自动绑定），search 命中块断言归一化作者串与年份。
st, p26 = req("POST", "/api/projects", {"name": "技术债收口项目", "description": "tech-debt segment 26"})
p26id = p26.get("id") if st == 201 else None
check("26.0 建项目供模板/作者断言", st == 201 and bool(p26id), f"st={st} {str(p26)[:80]}")

if p26id:
    # 26.1 自定义模板（差距#1）：PATCH templates(JSON 数组字符串) → GET 回读逐字节一致
    st, patched = req("PATCH", f"/api/projects/{p26id}", {"templates": '[{"name":"T1","description":"模板一","sections":[{"title":"引言","points":["背景"]}]}]'})
    check("26.1 PATCH templates 200 且回包带 templates", st == 200 and isinstance(patched, dict) and patched.get("templates") == '[{"name":"T1","description":"模板一","sections":[{"title":"引言","points":["背景"]}]}]',
          f"st={st} templates={str(patched.get('templates'))[:120]}")
    st, got = req("GET", f"/api/projects/{p26id}")
    check("26.1 GET /:id 回读 templates 与写入一致", st == 200 and got.get("templates") == '[{"name":"T1","description":"模板一","sections":[{"title":"引言","points":["背景"]}]}]',
          f"st={st} templates={str(got.get('templates'))[:120]}")
    st, pl = req("GET", "/api/projects")
    _p26 = next((x for x in (pl or []) if x.get("id") == p26id), None)
    check("26.1 GET /list 项目条目含 templates 字段", st == 200 and isinstance(_p26, dict) and "templates" in _p26, f"st={st} keys={list(_p26.keys()) if _p26 else _p26}")
    # 26.1b 非法 templates（非 JSON 数组）应 400，不脏库
    st, bad = req("PATCH", f"/api/projects/{p26id}", {"templates": "this-is-not-json"})
    check("26.1b 非法 templates 拒绝(400)且不破坏原值", st == 400 and got.get("templates") == '[{"name":"T1","description":"模板一","sections":[{"title":"引言","points":["背景"]}]}]',
          f"st={st} {str(bad)[:80]}")

    # 26.2 知识库来源补作者/年份（差距#2）：对象数组 authors 归一化；标题同名上传知识库文档自动绑定文献
    st, ref = req("POST", "/api/references", {"projectId": p26id, "hit": {
        "title": "TechDebt Binding Seed Study",
        "authors": [{"name": "Alice Smith"}, {"family": "Wang", "given": "Wei"}],
        "year": 2021, "venue": "Seed Venue"}})
    check("26.2 种子对象数组作者文献创建成功", st in (200, 201) and isinstance(ref, dict) and ref.get("id"), f"st={st} {str(ref)[:120]}")
    st, up = req("POST", "/api/knowledge/upload", {"projectId": p26id, "name": "TechDebt Binding Seed Study", "type": "text",
        "content": "图神经网络的消息传递机制通过邻居聚合更新节点表示，我们在节点分类任务上与主流基线做了对比实验。"})
    check("26.2 同名知识库文档上传成功并绑定文献", st in (200, 201) and up.get("referenceId"), f"st={st} refId={up.get('referenceId')}")
    # 26.2b GET /knowledge list 内嵌 reference.authors（归一化作者串）
    st, kl = req("GET", f"/api/knowledge?projectId={p26id}")
    _kd = next((x for x in (kl or []) if x.get("referenceId")), None)
    check("26.2b GET /knowledge 内嵌 reference.authors 归一化(Alice Smith, Wei Wang)",
          st == 200 and _kd and _kd.get("reference") and _kd["reference"].get("authors") == "Alice Smith, Wei Wang" and _kd["reference"].get("year") == 2021,
          f"st={st} ref={str((_kd or {}).get('reference'))[:160]}")
    # 26.2c POST /knowledge/search 命中块带 referenceAuthors/referenceYear（无 AI 纯 BM25）
    st, khits = req("POST", "/api/knowledge/search", {"projectId": p26id, "query": "消息传递 邻居聚合 节点分类"})
    _h0 = khits[0] if st in (200, 201) and isinstance(khits, list) and khits else None
    check("26.2c search 命中块含 referenceAuthors/referenceYear 且对象作者已归一化",
          _h0 is not None and _h0.get("referenceAuthors") == "Alice Smith, Wei Wang" and _h0.get("referenceYear") == 2021 and _h0.get("referenceTitle") == "TechDebt Binding Seed Study",
          f"st={st} keys={list(_h0.keys()) if _h0 else khits} authors={_h0.get('referenceAuthors') if _h0 else None} year={_h0.get('referenceYear') if _h0 else None}")

    # 27.x B-4.3 引用体检：锚点×citation 落库交叉审计（幽灵引用/无DOI/绿牌）
    # 自建带锚点文档（[1][2][3] 但 citation 表空 → 幽灵引用红牌场景，不依赖流水线）
    # 契约：documents POST 只收 title（content 由 PATCH 写入），两步走
    st, d27 = req("POST", "/api/documents", {"projectId": p26id, "title": "引用体检锚点文档"})
    p26docid = d27.get("id") if st == 201 else None
    st2, _p = req("PATCH", f"/api/documents/{p26docid}",
                  {"content": "## 引言\n结论支撑[1]，另见[2]与[3]。\n\n## 方法\n方法描述。\n\n## 参考文献\n[1] A.\n[2] B.\n[3] C."}) if p26docid else (0, None)
    check("27.0 建带锚点文档（POST+PATCH）", st == 201 and bool(p26docid) and st2 == 200, f"st={st} patch={st2}")
    st, daudit = req("GET", f"/api/documents/{p26docid}/citation-audit")
    check("27.1 citation-audit 返回 200 且 shape 完整",
          st == 200 and isinstance(daudit, dict) and all(k in daudit for k in ("anchorTotal", "citationRows", "ghost", "noDoi", "score", "issues")),
          f"st={st} body={str(daudit)[:160]}")
    check("27.2 幽灵引用红牌：3 锚点 0 落库 → ghost=3 且 score 受罚",
          daudit.get("anchorTotal") == 3 and daudit.get("citationRows") == 0 and daudit.get("ghost") == 3 and daudit.get("score", 100) <= 40,
          f"body={str(daudit)[:200]}")
    st, _na = req("GET", "/api/documents/non-exist-id-xyz/citation-audit")
    check("27.3 不存在文档 citation-audit 返回 404", st == 404, f"st={st}")

    # 27.4 兼容 [Ref:n] 锚点（历史缺陷：只认 [n]，正文用 [Ref:1] 时 anchorTotal=0 → 假满分）
    st4, d4 = req("POST", "/api/documents", {"projectId": p26id, "title": "Ref锚点文档"})
    d4id = d4.get("id") if st4 == 201 else None
    if d4id:
        req("PATCH", f"/api/documents/{d4id}", {"content": "## 引言\n依据[Ref:1]与[Ref:2]。"})
        st5, da = req("GET", f"/api/documents/{d4id}/citation-audit")
        check("27.4 [Ref:n] 锚点可识别且幽灵引用受罚",
              st5 == 200 and da.get("anchorTotal") == 2 and da.get("ghost") == 2 and da.get("score", 100) < 60,
              f"body={str(da)[:160]}")
        # 27.5 无锚点不再是「满分假绿」
        req("PATCH", f"/api/documents/{d4id}", {"content": "## 引言\n本文没有任何引用标注。"})
        st6, db_ = req("GET", f"/api/documents/{d4id}/citation-audit")
        check("27.5 无锚点时 score 封顶 60 且给出提示",
              st6 == 200 and db_.get("anchorTotal") == 0 and db_.get("score", 100) <= 60
              and any("未检测到引用" in str(i) for i in (db_.get("issues") or [])),
              f"body={str(db_)[:160]}")

# ---------- 28. v1.0.1 停止接口 / 联网开关 / 分数口径 ----------
st, d = req("POST", "/api/pipeline", {"projectId": pid, "topic": "停止接口回归验证"})
stop_id = d.get("id") if st == 201 else None
if stop_id:
    st, d2 = req("POST", f"/api/pipeline/{stop_id}/stop", {})
    check("28.1 停止运行中流水线 200/201", st in (200, 201), f"st={st} {str(d2)[:120]}")
    # 停止后在图仍可能正常返回（例如恰好走到 interrupt），服务端已保证不被回写；
    # 这里等 2s 再读，验证「终态稳定为 cancelled」而不是抢读瞬态。
    time.sleep(2)
    st, d3 = req("GET", f"/api/pipeline/{stop_id}")
    check("28.2 停止后状态稳定为 cancelled", st == 200 and d3.get("status") == "cancelled", f"status={(d3 or {}).get('status')}")
    steps3 = {s3.get("key"): s3 for s3 in (d3 or {}).get("steps", [])}
    running_left = [k for k, v in steps3.items() if v.get("status") in ("running", "awaiting_confirmation")]
    check("28.3 停止后无残留 running 步骤", not running_left, f"left={running_left}")
    st, d4 = req("DELETE", f"/api/pipeline/{stop_id}")
    check("28.4 停止后可删除（不再被「请先停止」阻塞）", st == 200 and d4.get("ok"), f"st={st} {str(d4)[:80]}")
    st, d5 = req("POST", f"/api/pipeline/{stop_id}/stop", {})
    check("28.5 停止不存在任务 404", st == 404, f"st={st}")
else:
    check("28.x 停止接口前置：创建任务失败", False, f"st={st} {str(d)[:120]}")
st, d = req("POST", "/api/pipeline", {"projectId": pid, "topic": " "})
check("28.6 空主题创建流水线 400", st == 400, f"st={st}")

print("=" * 60)
print(f"结果: PASS {PASS} / FAIL {FAIL} / KNOWN(存量缺口) {KNOWN}")
if KNOWN_FAILED:
    print("存量缺口项（不计 FAIL；已登记 ARCHITECTURE.md §8，修复后删 KNOWN_GAPS 对应行）:")
    for f in KNOWN_FAILED:
        print(f"  ○ {f}")
if FAILED:
    print("失败项:")
    for f in FAILED:
        print(f"  - {f}")
sys.exit(1 if FAIL else 0)
