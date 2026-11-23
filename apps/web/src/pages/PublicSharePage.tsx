import { useEffect, useState } from 'react';
import { Streamdown } from 'streamdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { FileText, Loader2, MessageSquare, Send } from 'lucide-react';
import { shares, type PublicShare } from '../api/shares';

export function PublicSharePage({ token }: { token: string }) {
  const [data, setData] = useState<PublicShare | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let alive = true;
    shares.getPublic(token)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [token]);

  const submit = async () => {
    if (!comment.trim() || sending) return;
    setSending(true);
    try {
      const created = await shares.addComment(token, { authorName: name.trim(), content: comment.trim() });
      setData((d) => d ? { ...d, comments: [...d.comments, created] } : d);
      setComment('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-5 py-3 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-white"><FileText size={15} /></span>
          SciFlow · 只读分享
          <span className="ml-auto text-[11px] font-normal text-slate-400">{data?.targetType === 'conversation' ? '对话快照' : '文档快照'}</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">
        {error && !data ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>
        ) : !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> 正在加载分享内容…</div>
        ) : (
          <article>
            <div className="mb-1 text-xs text-slate-400">{data.projectTitle || '科研项目'} · v{data.version}</div>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{data.title}</h1>
            {data.targetType === 'conversation' ? (
              <div className="space-y-4">
                {data.messages.length === 0 ? <div className="text-sm text-slate-400">（空会话）</div> : data.messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-7 ${m.role === 'user' ? 'rounded-br-sm bg-teal-600 text-white' : 'rounded-bl-sm border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
                      {m.role === 'assistant' ? (
                        <div className="markdown-body"><Streamdown mode="static" remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{m.content}</Streamdown></div>
                      ) : m.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="markdown-body text-[15px] leading-7">
                <Streamdown mode="static" remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{data.content || '（暂无正文）'}</Streamdown>
              </div>
            )}

            {data.allowComments && (
              <section className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
                <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare size={14} /> 读者评论 · {data.comments.length}</h2>
                <div className="space-y-2">
                  {data.comments.map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-0.5 text-[11px] text-slate-400">{c.authorName} · {new Date(c.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
                      <div className="whitespace-pre-wrap break-words">{c.content}</div>
                    </div>
                  ))}
                  {data.comments.length === 0 && <div className="text-xs text-slate-400">还没有评论。</div>}
                </div>
                <div className="mt-3 space-y-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="称呼（可留空）" maxLength={40} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900" />
                  <div className="flex gap-2">
                    <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="写下你的意见…" maxLength={1000} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900" />
                    <button type="button" onClick={() => void submit()} disabled={sending || comment.trim().length < 2} className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Send size={13} /> {sending ? '发送中' : '提交'}</button>
                  </div>
                  {error && <div className="text-xs text-rose-600">{error}</div>}
                </div>
              </section>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
