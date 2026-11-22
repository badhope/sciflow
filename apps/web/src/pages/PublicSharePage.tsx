import { useEffect, useState } from 'react';
import { Streamdown } from 'streamdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { FileText, Loader2 } from 'lucide-react';
import { shares, type PublicShare } from '../api/shares';

export function PublicSharePage({ token }: { token: string }) {
  const [data, setData] = useState<PublicShare | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    shares.getPublic(token)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-5 py-3 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-white"><FileText size={15} /></span>
          SciFlow · 只读分享
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>
        ) : !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> 正在加载分享内容…</div>
        ) : (
          <article>
            <div className="mb-1 text-xs text-slate-400">{data.projectTitle || '科研项目'} · v{data.version}</div>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{data.title}</h1>
            <div className="markdown-body text-[15px] leading-7">
              <Streamdown mode="static" remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{data.content || '（暂无正文）'}</Streamdown>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
