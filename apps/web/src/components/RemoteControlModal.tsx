import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { ToastContext } from '../App';
import { api } from '../api/client';
import type { RemoteAccessStatus } from '../types';
import { Badge, Button, Modal, Spinner, errMsg } from './ui';

type Props = {
  open: boolean;
  onClose: () => void;
};

const STATE_COPY: Record<RemoteAccessStatus['state'], { label: string; tone: 'slate' | 'teal' | 'amber' | 'green' }> = {
  stopped: { label: '未开启', tone: 'slate' },
  waiting: { label: '等待扫码', tone: 'teal' },
  paired: { label: '手机已连接', tone: 'green' },
  expired: { label: '二维码已失效', tone: 'amber' },
};

/**
 * 手机远程控制面板。
 *
 * 交互对齐 ZCode：桌面端生成二维码/链接 → 手机扫码 → 手机接管完整工作台。
 * 关闭本弹窗不会停止远控，必须显式点「停止远程控制」。
 */
export function RemoteControlModal({ open, onClose }: Props) {
  const toast = useContext(ToastContext);
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'start' | 'refresh' | 'stop' | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [stopOpen, setStopOpen] = useState(false);

  const refreshStatus = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await api.remote.status();
      setStatus(next);
      setError('');
    } catch (e) {
      if (!quiet) setError(errMsg(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const kickoff = window.setTimeout(() => void refreshStatus(), 0);
    const timer = window.setInterval(() => void refreshStatus(true), 3000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [open, refreshStatus]);

  const run = async (kind: 'start' | 'refresh' | 'stop') => {
    setBusy(kind);
    setError('');
    try {
      const next =
        kind === 'start'
          ? await api.remote.start()
          : kind === 'refresh'
            ? await api.remote.refresh()
            : await api.remote.stop();
      setStatus(next);
      if (kind === 'start') toast('success', '远程控制已开启，请用手机扫码');
      if (kind === 'refresh') toast('success', '二维码已刷新，旧链接已失效');
      if (kind === 'stop') toast('info', '远程控制已停止，手机已断开');
    } catch (e) {
      setError(errMsg(e));
      toast('error', errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast('success', '已复制到剪贴板');
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      toast('error', '复制失败，请长按链接手动复制');
    }
  };

  const primary = status?.addresses?.[0];
  const otherAddresses = useMemo(
    () => status?.addresses?.slice(1) ?? [],
    [status?.addresses],
  );
  const state = status ? STATE_COPY[status.state] : null;

  return (
    <>
      <Modal open={open} onClose={onClose} title="手机远程控制" width="max-w-xl">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50 to-cyan-50 p-4 dark:border-teal-900/60 dark:from-teal-950/40 dark:to-cyan-950/30">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-600 to-cyan-500 text-white shadow-lg shadow-teal-500/20">
              <Smartphone size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  手机接管桌面端工作台
                </span>
                {state && <Badge tone={state.tone}>{state.label}</Badge>}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                手机只是控制界面，项目、数据库和 Agent 仍在电脑上运行；同一时间只允许一台手机。
              </div>
            </div>
          </div>

          {loading && !status ? (
            <div className="py-10"><Spinner label="读取远程控制状态…" /></div>
          ) : error && !status ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          ) : status && !status.active ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <QrCode size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">开启后生成二维码和链接</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      用手机相机或浏览器扫码，即可打开完整 SciFlow。
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    ['完整工作台', '项目 / 对话 / 写作 / 流水线都能操作'],
                    ['数据不出电脑', '不复制代码，也不新建远程环境'],
                    ['一次性钥匙', '二维码短时效、单设备、可随时停止'],
                  ].map(([title, desc]) => (
                    <div key={title} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                        <CheckCircle2 size={13} className="text-teal-600" aria-hidden="true" />
                        {title}
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{desc}</div>
                    </div>
                  ))}
                </div>
                {status.hint && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {status.hint}
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void run('start')} disabled={busy !== null}>
                  {busy === 'start' ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                  开启远程控制
                </Button>
              </div>
            </div>
          ) : status && status.state === 'waiting' ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <div className="mx-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-white">
                  {status.qrSvg ? (
                    <div
                      className="h-[208px] w-[208px] [&_svg]:h-full [&_svg]:w-full"
                      role="img"
                      aria-label="手机远程控制二维码"
                      dangerouslySetInnerHTML={{ __html: status.qrSvg }}
                    />
                  ) : (
                    <div className="grid h-[208px] w-[208px] place-items-center text-xs text-slate-400">
                      二维码生成中…
                    </div>
                  )}
                </div>
                <div className="min-w-0 space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      <Wifi size={14} className="text-teal-600" aria-hidden="true" />
                      {primary?.label || '访问地址'}
                    </div>
                    <div className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {status.link || primary?.url}
                    </div>
                    {(status.link || primary?.url) && (
                      <Button
                        variant="outline"
                        className="mt-2 h-7 px-2 text-[11px]"
                        onClick={() => void copy(status.link || primary?.url || '', 'link')}
                      >
                        {copied === 'link' ? <Check size={12} /> : <Copy size={12} />}
                        {copied === 'link' ? '已复制' : '复制链接'}
                      </Button>
                    )}
                  </div>
                  <div className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {primary?.kind === 'public'
                      ? '公网入口已启用：手机不必与电脑同一网络，用相机扫码或用浏览器打开链接即可。二维码一次性有效，过期后点「刷新二维码」。'
                      : '手机与电脑连同一个 Wi-Fi，用相机扫码或浏览器打开链接。二维码一次性有效，过期后点「刷新二维码」。'}
                  </div>
                </div>
              </div>

              {otherAddresses.length > 0 && (
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">其他可用入口</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {otherAddresses.map((address) => (
                      <button
                        key={address.url}
                        type="button"
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        onClick={() => void copy(address.link || address.url, address.url)}
                      >
                        {address.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck size={13} aria-hidden="true" /> 关闭本窗口不会停止远控
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void run('refresh')} disabled={busy !== null}>
                    {busy === 'refresh' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    刷新二维码
                  </Button>
                  <Button variant="danger" onClick={() => setStopOpen(true)} disabled={busy !== null}>
                    <Power size={14} /> 停止
                  </Button>
                </div>
              </div>
            </div>
          ) : status && status.state === 'paired' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300">
                    <Smartphone size={22} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">手机已连接</span>
                      <Badge tone={status.connected ? 'green' : 'amber'}>
                        {status.connected ? '在线' : '最近活跃'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                      {status.deviceLabel || '移动设备'}
                      {status.lastSeenAt && ` · 最近请求 ${new Date(status.lastSeenAt).toLocaleTimeString()}`}
                    </div>
                    <div className="mt-3 text-[11px] leading-relaxed text-emerald-700/90 dark:text-emerald-300/90">
                      手机拿到的是完整 SciFlow 工作台：可以切换项目、发起科研对话、写正文、跑流水线、审批交互和查看进度。
                      所有数据仍在桌面端数据库里，桌面端关闭或断网后远程立即不可用。
                    </div>
                    {status.expiresAt && (
                      <div className="mt-2 text-[11px] text-emerald-600/80 dark:text-emerald-400/80">
                        会话有效期至 {new Date(status.expiresAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck size={13} aria-hidden="true" /> 刷新会立即踢掉当前手机
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void run('refresh')} disabled={busy !== null}>
                    {busy === 'refresh' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    刷新二维码
                  </Button>
                  <Button variant="danger" onClick={() => setStopOpen(true)} disabled={busy !== null}>
                    <Power size={14} /> 停止远程控制
                  </Button>
                </div>
              </div>
            </div>
          ) : status ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                <AlertTriangle size={16} aria-hidden="true" />
                二维码已失效
              </div>
              <div className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                链接已过期或已被使用。刷新二维码会同时吊销旧链接和已连接的手机会话。
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void run('refresh')} disabled={busy !== null}>
                  {busy === 'refresh' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  刷新二维码
                </Button>
                <Button variant="outline" onClick={() => void run('stop')} disabled={busy !== null}>
                  <Power size={14} /> 停止
                </Button>
              </div>
            </div>
          ) : null}

          {error && status && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
            <span className="font-medium text-slate-600 dark:text-slate-300">安全边界：</span>
            二维码链接等同于临时钥匙，请勿转发；刷新或停止后旧链接立即作废。桌面端必须保持运行且手机可达。
            公网使用请配置 <span className="font-mono text-[10px]">SCIFLOW_REMOTE_PUBLIC_URL</span> 并走 HTTPS 反代。
          </div>
        </div>
      </Modal>

      <Modal open={stopOpen} onClose={() => setStopOpen(false)} title="停止远程控制" width="max-w-md">
        <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          停止后手机会立即断开，当前二维码与访问会话全部失效。确定要停止吗？
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setStopOpen(false)}>取消</Button>
          <Button
            variant="danger"
            disabled={busy === 'stop'}
            onClick={() => {
              setStopOpen(false);
              void run('stop');
            }}
          >
            {busy === 'stop' ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
            停止远程控制
          </Button>
        </div>
      </Modal>
    </>
  );
}
