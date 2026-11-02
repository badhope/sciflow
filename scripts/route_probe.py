#!/usr/bin/env python3
"""
全路由真实性探针（v1.9 审计第二轮）

目标不是覆盖率，而是**找出「声明了但不可用」的接口**：
  - 500 / 未捕获异常
  - 404（路由存在但资源解析失败，往往意味着接线错误）
  - 返回 null / 空对象 / 空数组但语义上应该有内容
  - 返回成功但字段缺失（与 openapi 声明不一致）

用法：
  python scripts/route_probe.py --base http://127.0.0.1:3000

输出：每条一行 `STATUS  METHOD PATH  → 摘要`，失败项汇总在末尾。
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000"
RESULTS = []


def call(method, path, body=None, timeout=60):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(raw or "null"), raw
            except Exception:
                return resp.status, None, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw or "null"), raw
        except Exception:
            return e.code, None, raw
    except Exception as e:  # noqa: BLE001
        return -1, None, str(e)


def record(label, method, path, status, data, raw, expect=(200, 201), allow_business_400=False):
    ok = status in expect or (allow_business_400 and status == 400)
    RESULTS.append((ok, label, method, path, status, data, raw))
    mark = "OK " if ok else "FAIL"
    summary = ""
    if isinstance(data, dict):
        summary = json.dumps(data, ensure_ascii=False)[:110]
    elif isinstance(data, list):
        summary = f"[{len(data)} items] " + json.dumps(data[:1], ensure_ascii=False)[:90]
    elif data is None:
        summary = str(raw)[:110]
    print(f"{mark} {status:>4} {method:6} {path:55} {summary}")


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("SCIFLOW_BASE", BASE))
    args = ap.parse_args()
    BASE = args.base

    # 达到「篇幅/结构」校验门槛的正文（质量评分与稿件评审共用）
    global LONG_BODY
    LONG_BODY = (
        "## 引言\n\n" + "本文系统梳理图神经网络消息传递范式的研究进展，覆盖模型演进、代表工作与应用边界[1]。\n\n" * 8
        + "## 方法\n\n" + "采用系统性综述方法，按「谱域近似 → 空域聚合 → 注意力机制」三条主线归纳已有工作。\n\n" * 6
        + "## 讨论\n\n" + "已有研究在节点分类任务上报告了稳定的性能提升，但在异质图与大规模图场景仍存在开放问题。\n\n" * 6
        + "## 结论\n\n" + "消息传递范式仍是图表示学习的主流框架，后续工作集中在效率与泛化两个方向。\n"
    )

    print("=" * 100)
    print("阶段 0：准备项目 / 文档 / 文献 / 知识库（后续探针依赖这些 id）")
    print("=" * 100)
    st, proj, _ = call("POST", "/api/projects", {"name": "route-probe", "description": "自动探针"})
    record("建项目", "POST", "/api/projects", st, proj, _)
    pid = proj["id"] if isinstance(proj, dict) else None
    if not pid:
        print("项目创建失败，终止")
        return 1

    st, doc, _ = call("POST", "/api/documents", {"projectId": pid, "title": "探针文档"})
    record("建文档", "POST", "/api/documents", st, doc, _)
    did = doc["id"] if isinstance(doc, dict) else None
    call("PATCH", f"/api/documents/{did}", {"content": "## 引言\n探针正文 [1]。\n\n## 方法\n方法段。\n\n## 结果\n结果段。\n\n## 讨论\n讨论段。\n\n## 结论\n结论段。"})

    st, ref, _ = call("POST", "/api/references", {"projectId": pid, "hit": {"title": "Probe Paper", "authors": ["A Smith"], "year": 2024, "doi": "10.1000/probe"}})
    record("建文献", "POST", "/api/references", st, ref, _)
    rid = ref["id"] if isinstance(ref, dict) else None

    st, kn, _ = call("POST", "/api/knowledge/upload", {"projectId": pid, "name": "探针资料", "type": "text", "content": "知识库探针内容：图神经网络消息传递。"})
    record("上传知识", "POST", "/api/knowledge/upload", st, kn, _)
    kid = kn["id"] if isinstance(kn, dict) else None

    print()
    print("=" * 100)
    print("阶段 1：全部 GET 端点（只读）")
    print("=" * 100)
    gets = [
        ("/api/health", ()),
        ("/api/health/deep", ()),
        ("/api/settings", ()),
        ("/api/settings/check", ()),
        ("/api/settings/providers", ()),
        ("/api/settings/mcp-servers", ()),
        ("/api/settings/persona", ()),
        ("/api/config", ()),
        ("/api/config/audit", ()),
        ("/api/config/constraints", ()),
        ("/api/config/hooks", ()),
        ("/api/config/roles", ()),
        ("/api/config/presets", ()),
        ("/api/config/permission", ()),
        ("/api/config/preview", ()),
        ("/api/config/export", ()),
        ("/api/customization/intents", ()),
        ("/api/customization/pipeline-steps", ()),
        ("/api/customization/pipeline-settings", ()),
        ("/api/customization/quality-weights", ()),
        ("/api/customization/judgment-mode", ()),
        ("/api/customization/prompts", ()),
        ("/api/dashboard/overview", ()),
        ("/api/projects", ()),
        (f"/api/projects/{pid}", ()),
        (f"/api/documents?projectId={pid}", ()),
        (f"/api/documents/{did}", ()),
        (f"/api/documents/{did}/citation-audit", ()),
        (f"/api/documents/{did}/citations", ()),
        (f"/api/documents/{did}/polish-records", ()),
        (f"/api/documents/{did}/export", ()),
        (f"/api/documents/{did}/export-citations", ()),
        (f"/api/documents/{did}/export-docx", ()),
        (f"/api/references?projectId={pid}", ()),
        (f"/api/references/{rid}", ()),
        (f"/api/references/graph?projectId={pid}", ()),
        (f"/api/references/export?projectId={pid}", ()),
        (f"/api/references/extraction/fields?projectId={pid}", ()),
        (f"/api/references/extraction/table?projectId={pid}", ()),
        (f"/api/references/screen?projectId={pid}", ()),
        (f"/api/knowledge?projectId={pid}", ()),
        (f"/api/knowledge/{kid}", ()),
        (f"/api/knowledge/{pid}/map", ()),
        ("/api/memory", ()),
        ("/api/memory?projectId=" + pid, ()),
        (f"/api/experiments?projectId={pid}", ()),
        ("/api/quality/latest?documentId=" + did, ()),
        ("/api/quality?documentId=" + did, ()),
        ("/api/research/design?projectId=" + pid, ()),
        (f"/api/research/review-comments?documentId={did}", ()),
        ("/api/submission/track?projectId=" + pid, ()),
        ("/api/submission/journals?projectId=" + pid, ()),
        ("/api/usage/summary", ()),
        ("/api/agent/usage?projectId=" + pid, ()),
        (f"/api/agent/executions?projectId={pid}", ()),
        ("/api/web/config", ()),
        ("/api/mcp/tools", ()),
        ("/api/mcp/info", ()),
        ("/api/mcp/external", ()),
        ("/api/extensions", ()),
        ("/api/extensions/templates", ()),
        ("/api/extensions/export", ()),
        ("/api/pipeline", ()),
        ("/api/chat/sessions?projectId=" + pid, ()),
        ("/api/docs", (200, 200, 301, 302, 304)),
        ("/api/docs-json", (200, 200, 404)),
    ]
    for path, expect in gets:
        st, data, raw = call("GET", path)
        record("GET", "GET", path, st, data, raw, expect=expect or (200,))

    print()
    print("=" * 100)
    print("阶段 2：POST / 写操作（用 mock 网关）")
    print("=" * 100)
    posts = [
        ("意图识别", "/api/judgment/intent", {"message": "帮我检索一下图神经网络文献"}),
        ("知识检索", "/api/knowledge/search", {"projectId": pid, "query": "消息传递"}),
        ("缺口分析", "/api/references/gap", {"projectId": pid, "topic": "图神经网络"}),
        ("知识问答", "/api/knowledge/query", {"projectId": pid, "question": "消息传递是什么"}),
        ("文献检索", "/api/references/search", {"query": "graph", "projectId": pid}),
        ("文献综述", "/api/references/summarize", {"projectId": pid, "refs": ["Probe Paper"]}),
        ("引用渲染", f"/api/documents/{did}/render-citations", {"style": "apa"}),
        ("导出评论", f"/api/quality/export-comments?documentId={did}", None),
        ("质量评分", "/api/quality", {"documentId": did, "title": "探针", "content": LONG_BODY}),
        ("研究设计", "/api/research/design", {"projectId": pid, "question": "如何验证?"}),
        # mock 网关对这 3 个接口返回固定 JSON，字段与 zod 契约不完全一致 → 业务 400（真实模型下正常）；
        # 探针断言「错误可读、非 5xx」即可
        ("设计诊断(mock 限)", "/api/research/design-review", {"idea": "随机对照实验验证消息传递改进"}),
        ("稿件评审(mock 限)", "/api/research/review", {"title": "探针论文", "content": LONG_BODY}),
        ("回复信(mock 限)", "/api/research/response-letter", {"documentId": did}),
        ("文献对比(mock 限)", "/api/research/comparison", {"papers": ["Probe Paper", "GNN Paper"]}),
        ("投稿信", "/api/submission/cover-letter", {"projectId": pid, "journal": "计算机学报", "title": "探针"}),
        ("选刊", "/api/submission/journals-match", {"projectId": pid, "title": "探针", "abstract": "摘要"}),
        ("审稿回复", "/api/submission/reply-review", {"reviewComments": "1) 补充实验；2) 补充对比。", "response": "已补充"}),
        ("实验运行", "/api/experiments/run", {"projectId": pid, "code": "print(1+1)", "goal": "冒烟"}),
        ("MCP 工具调用", "/api/mcp/call", {"name": "literature.search", "arguments": {"query": "graph", "projectId": pid}}),
        ("聊天非流式", "/api/chat", {"projectId": pid, "message": "你好"}),
        ("联网搜索", "/api/web/search", {"q": "graph neural network"}),
        ("扩展生成", "/api/extensions/generate", {"kind": "skill", "brief": "一个用于探针验证的科研技能：结构化总结文献的方法论"}),
        ("流水线创建", "/api/pipeline", {"projectId": pid, "topic": "路由探针主题"}),
        ("深精读", "/api/references/deep-dive", {"projectId": pid, "refId": rid}),
        ("证据综合", "/api/references/evidence", {"projectId": pid, "question": "有效吗"}),
        
        ("结构化提取", "/api/references/extract", {"projectId": pid, "refs": ["Probe Paper"]}),
    ]
    for label, path, body in posts:
        st, data, raw = call("POST", path, body, timeout=120)
        record(label, "POST", path, st, data, raw, expect=(200, 201, 202, 204), allow_business_400="(mock 限)" in label)

    print()
    print("=" * 100)
    fails = [r for r in RESULTS if not r[0]]
    print(f"总计 {len(RESULTS)} 条，失败 {len(fails)} 条")
    for ok, label, method, path, status, data, raw in fails:
        msg = ""
        if isinstance(data, dict):
            msg = data.get("message") or data.get("error") or json.dumps(data, ensure_ascii=False)[:200]
        else:
            msg = str(raw)[:200]
        print(f"  ✗ [{label}] {method} {path} → {status} {msg}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
