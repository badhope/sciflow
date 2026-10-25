import { useState } from 'react';
import { Badge, Button, Card, Input, Modal, SectionTitle, Textarea, errMsg } from '../../components/ui';
import { Plug, Plus, Wrench } from 'lucide-react';
import { api } from '../../api/client';
import { useSettings } from './settings-context';

export function McpToolList() {
  const { state, addMcpServer, removeMcpServer } = useSettings();
  const [mcpServerForm, setMcpServerForm] = useState({ name: '', url: '' });
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolResult, setToolResult] = useState('');
  const [toolLoading, setToolLoading] = useState(false);
  const [externalTools, setExternalTools] = useState<{ name?: string; description?: string }[]>([]);
  const [externalResult, setExternalResult] = useState('');
  const [externalArgs, setExternalArgs] = useState<Record<string, string>>({});
  const [activeServerId, setActiveServerId] = useState('');
  const [showAddServer, setShowAddServer] = useState(false);

  const mcpInfo = state.mcpInfo;
  const mcpTools = state.mcpTools;

  const submitServer = async () => {
    if (!mcpServerForm.name || !mcpServerForm.url) return;
    await addMcpServer(mcpServerForm);
    setMcpServerForm({ name: '', url: '' });
    setShowAddServer(false);
  };

  return (
    <>
      {/* MCP 工具台 */}
      <Card className="p-5 mt-4">
        <SectionTitle
          extra={
            <Badge tone="teal">
              {mcpInfo ? `${mcpInfo.protocol} v${mcpInfo.version} · ${mcpInfo.tools} 工具` : '…'}
            </Badge>
          }
        >
          <span className="flex items-center gap-2">
            <Wrench size={16} className="text-teal-600" /> MCP 工具台
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          SciFlow 的全部 AI 能力已协议化为标准 MCP 工具（Model Context Protocol 2026-07 规范），可被任意 MCP 兼容客户端动态发现与调用
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {mcpTools.map((t) => (
            <div key={t.name} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-semibold text-teal-700">{t.name}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-2">{t.description}</div>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                  placeholder={Object.keys(t.inputSchema?.properties || {}).join(', ')}
                  value={toolArgs[t.name] || ''}
                  onChange={(e) => setToolArgs((s) => ({ ...s, [t.name]: e.target.value }))}
                />
                <Button
                  variant="outline"
                  className="px-2 py-1 text-xs"
                  disabled={toolLoading}
                  onClick={async () => {
                    setToolLoading(true);
                    setToolResult('');
                    try {
                      const args: Record<string, any> = {};
                      const keys = Object.keys(t.inputSchema?.properties || {});
                      keys.forEach((k, i) => {
                        const raw = (toolArgs[t.name] || '').split(/[,，]/)[i];
                        if (raw !== undefined && raw !== '') args[k] = raw;
                      });
                      const res = await api.mcp.call(t.name, args);
                      setToolResult(JSON.stringify(res.content?.[0]?.text ?? res, null, 2).slice(0, 1200));
                    } catch (e: unknown) {
                      setToolResult('调用失败: ' + errMsg(e));
                    } finally {
                      setToolLoading(false);
                    }
                  }}
                >
                  <Wrench size={11} /> 调用
                </Button>
              </div>
            </div>
          ))}
        </div>
        {toolResult && (
          <Textarea className="mt-3 font-mono text-xs" rows={5} readOnly value={toolResult} />
        )}
      </Card>

      {/* 外部 MCP 服务器 */}
      <Card className="p-5 mt-4">
        <SectionTitle
          extra={
            <Button
              variant="outline"
              onClick={() => setShowAddServer(true)}
            >
              <Plus size={14} /> 添加服务器
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Plug size={16} className="text-teal-600" /> 外部 MCP 服务器
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          接入任意 MCP 兼容服务（本机 SciFlow / 其他 Agent 的 MCP 端点），协议互通：GET /tools 发现工具、POST /call 调用
        </div>
        {state.mcpServers.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">暂无外部 MCP 服务器</div>
        ) : (
          <div className="space-y-1.5">
            {state.mcpServers.map((ms) => (
              <div key={ms.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${ms.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="font-medium text-slate-700 dark:text-slate-200 w-20 sm:w-28 truncate">{ms.name}</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate w-full sm:w-auto">{ms.url}</span>
                <Button
                  variant="outline"
                  className="text-xs px-2 py-1"
                  onClick={async () => {
                    try {
                      const d = await api.mcpExternal.discover(ms.url);
                      setActiveServerId(ms.id);
                      setExternalTools(d.tools);
                      setExternalResult(`「${ms.name}」发现 ${d.tools.length} 个工具`);
                    } catch (e: unknown) {
                      setExternalResult('探测失败: ' + errMsg(e));
                    }
                  }}
                >
                  探测工具
                </Button>
                <Button
                  variant="ghost"
                  className="text-xs px-2 py-1 text-rose-500"
                  onClick={() => removeMcpServer(ms.id)}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
        {externalTools.length > 0 && (
          <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">{externalResult} —— 参数支持 JSON 对象（如 {"{\"query\":\"x\"}"}）或纯文本</div>
            <div className="space-y-1.5">
              {externalTools.map((t) => (
                <div key={t.name} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-teal-700 w-24 sm:w-40 truncate">{t.name}</span>
                  <input
                    className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                    placeholder={(t.description || '').slice(0, 40)}
                    value={externalArgs[t.name || ''] || ''}
                    onChange={(e) => setExternalArgs((s) => ({ ...s, [t.name || '']: e.target.value }))}
                  />
                  <Button
                    variant="outline"
                    className="text-xs px-2 py-1"
                    onClick={async () => {
                      try {
                        const raw = (externalArgs[t.name || ''] || '').trim();
                        let args: Record<string, any> = {};
                        if (raw) {
                          try {
                            const parsed = JSON.parse(raw);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
                            else args = { input: String(parsed) };
                          } catch {
                            args = { input: raw };
                          }
                        }
                        const res = await api.mcpExternal.call(activeServerId, t.name || '', args);
                        setExternalResult(JSON.stringify(res, null, 2).slice(0, 600));
                      } catch (e: unknown) {
                        setExternalResult('调用失败: ' + errMsg(e));
                      }
                    }}
                  >
                    调用
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {externalResult && !externalTools.length && (
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded p-2">{externalResult}</div>
        )}
      </Card>

      {/* Add MCP Server Modal */}
      <Modal open={showAddServer} title="添加外部 MCP 服务器" onClose={() => setShowAddServer(false)}>
        <div className="space-y-2">
          <Input placeholder="名称（如 本地SciFlow）" value={mcpServerForm.name} onChange={(e) => setMcpServerForm(f => ({ ...f, name: e.target.value }))} />
          <Input placeholder="URL（如 http://localhost:3000/api/mcp）" value={mcpServerForm.url} onChange={(e) => setMcpServerForm(f => ({ ...f, url: e.target.value }))} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowAddServer(false)}>取消</Button>
          <Button disabled={!mcpServerForm.name || !mcpServerForm.url} onClick={submitServer}>
            <Plug size={14} /> 添加服务器
          </Button>
        </div>
      </Modal>
    </>
  );
}
