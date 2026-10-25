import { useEffect, useState } from 'react';
import { api, setToken, getToken } from '../api/client';
import { Button, Input, errMsg } from './ui';
import { BrandMark } from './BrandMark';

/**
 * 全局登录门（企业模式专属）
 *
 * 仅当后端 AUTH_MODE=jwt 时才可能出现登录界面：
 *  - 启动时读 /api/health 的 authMode；none → 永不渲染（本地/桌面零干扰）；
 *  - jwt → 校验本地令牌，失败则展示品牌化登录/注册门；
 *  - 监听 client.ts 的 401 统一事件，会话过期自动唤起登录门。
 */
export function AuthGate() {
  const [mode, setMode] = useState<'checking' | 'ok' | 'login'>('checking');
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        if (h.authMode !== 'jwt') {
          setMode('ok');
          return;
        }
        if (!getToken()) {
          setMode('login');
          return;
        }
        await api.auth.me();
        if (alive) setMode('ok');
      } catch {
        // 健康检查失败/令牌失效：有残留 token 时拦登录，其余放行
        if (getToken()) {
          if (alive) setMode('login');
        } else if (alive) {
          setMode('ok');
        }
      }
    })();
    const onExpired = () => {
      setTab('login');
      setError('登录已过期，请重新登录');
      setMode('login');
    };
    window.addEventListener('sciflow:unauthorized', onExpired);
    return () => {
      alive = false;
      window.removeEventListener('sciflow:unauthorized', onExpired);
    };
     
  }, []);

  if (mode !== 'login') return null;

  const submit = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const res =
        tab === 'login'
          ? await api.auth.login(email.trim(), password)
          : await api.auth.register(email.trim(), password, name.trim());
      setToken(res.token);
      window.location.reload(); // 登录成功后整体刷新，保证全部数据按新会话加载
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm overlay-in">
      {/* 品牌氛围光晕（墨流 2.0） */}
      <div className="auth-glow" aria-hidden="true" />
      <div className="modal-in brand-card-edge w-[380px] max-w-[92vw] rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 p-7">
        {/* 品牌头 */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-xl brand-logo flex items-center justify-center">
            <BrandMark className="w-6 h-6" variant="gradient" />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              Sci<span className="brand-gradient-text">Flow</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">让科研从想法到成文</div>
          </div>
        </div>

        {/* 登录 / 注册切换 */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 mb-4">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              className={`flex-1 py-1.5 rounded-md text-[13px] transition-colors ${
                tab === t ? 'nav-active font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          {tab === 'register' && (
            <Input placeholder="昵称（可选）" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <Input
            placeholder="邮箱"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Input
            placeholder={tab === 'register' ? '密码（至少 8 位）' : '密码'}
            type="password"
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        {error && <div className="mt-3 text-[12px] text-rose-500">{error}</div>}

        <Button className="w-full mt-4 brand-btn py-2" onClick={submit} disabled={busy}>
          {busy ? '请稍候…' : tab === 'login' ? '登录' : '注册并登录'}
        </Button>

        <div className="mt-3 text-center text-[11px] text-slate-400">
          {tab === 'register' ? '首位注册用户将自动成为管理员' : '企业部署模式 · 需要账号登录'}
        </div>
      </div>
    </div>
  );
}
