import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Key,
  LogOut,
  Play,
  Plus,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import {
  ApiError,
  api,
  type Account,
  type Scheduler,
  type User,
} from "./lib/api";
import { formatNumber } from "./lib/format";
import { AccountCard } from "./components/AccountCard";
import { AdminPage } from "./components/AdminPage";
import { AuthPage } from "./components/AuthPage";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { QRLogin } from "./components/QRLogin";
import { SchedulerBar } from "./components/SchedulerBar";
import { ToastStack, type ToastItem } from "./components/Toast";

// The admin console lives on a separate entry path, e.g. https://host/admin
const IS_ADMIN_PATH = window.location.pathname.startsWith("/admin");

export default function App() {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [emailVerification, setEmailVerification] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [scheduler, setScheduler] = useState<Scheduler>({ enabled: false });
  const [showLogin, setShowLogin] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, ok = true) => {
    setToasts((t) => [...t, { id: Date.now() + Math.random(), message, ok }]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  // Treat an expired/invalid session (401) as a logout.
  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        setAccount(null);
        return;
      }
      notify((e as Error).message, false);
    },
    [notify],
  );

  // Bootstrap: resolve current session.
  useEffect(() => {
    api
      .me()
      .then(({ account, allowRegistration, emailVerification }) => {
        setAccount(account);
        setAllowRegistration(allowRegistration);
        setEmailVerification(emailVerification);
      })
      .catch(() => setAccount(null))
      .finally(() => setBooting(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ users: u }, { scheduler: s }] = await Promise.all([
        api.listUsers(),
        api.getScheduler(),
      ]);
      setUsers(u);
      setScheduler(s);
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (account && !IS_ADMIN_PATH) load();
  }, [account, load]);

  const upsertUser = (user: User) =>
    setUsers((list) => {
      const idx = list.findIndex((x) => Number(x.uid) === Number(user.uid));
      if (idx === -1) return [...list, user];
      const next = [...list];
      next[idx] = user;
      return next;
    });

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    const uid = pendingDelete.uid;
    setPendingDelete(null);
    setUsers((list) => list.filter((x) => x.uid !== uid));
    try {
      await api.removeUser(uid);
      notify("已移除账号", true);
    } catch (e) {
      handleError(e);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setAccount(null);
    setUsers([]);
  };

  const stats = useMemo(() => {
    const totalListen = users.reduce((s, u) => s + (u.listenSongs ?? 0), 0);
    const active = users.filter(
      (u) =>
        u.settings.autoSignin ||
        u.settings.autoScrobble ||
        u.settings.autoTasks ||
        u.settings.autoPartner,
    ).length;
    return { accounts: users.length, active, totalListen };
  }, [users]);

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesh">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
      </div>
    );
  }

  if (!account) {
    return (
      <>
        <AuthPage
          adminMode={IS_ADMIN_PATH}
          allowRegistration={allowRegistration}
          emailVerification={emailVerification}
          onAuthed={(acc) => {
            setAccount(acc);
            notify(`欢迎回来，${acc.username}`, true);
          }}
        />
        <ToastStack toasts={toasts} dismiss={dismiss} />
      </>
    );
  }

  if (IS_ADMIN_PATH) {
    if (account.role !== "admin") {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-mesh px-4 text-center">
          <Shield className="h-10 w-10 text-slate-300" />
          <p className="text-lg font-bold text-slate-900">当前账号不是管理员</p>
          <p className="text-sm text-slate-500">请使用管理员账号登录管理后台</p>
          <button onClick={logout} className="btn-primary">
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
          <ToastStack toasts={toasts} dismiss={dismiss} />
        </div>
      );
    }
    return (
      <div className="min-h-dvh bg-mesh">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-extrabold text-slate-900">
              <Shield className="mr-2 inline h-6 w-6 text-brand-600" />
              Lumen 管理后台
            </h2>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-soft sm:inline-flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-[11px] font-bold text-white">
                  {account.username.slice(0, 1).toUpperCase()}
                </span>
                {account.username}
              </span>
              <button
                onClick={() => setShowChangePw(true)}
                className="btn-ghost"
                title="修改密码"
              >
                <Key className="h-4 w-4" /> 修改密码
              </button>
              <button onClick={logout} className="btn-ghost" title="退出登录">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <AdminPage currentAccountId={account.id} notify={notify} />
        </div>
        {showChangePw && (
          <ChangePasswordModal
            onClose={() => setShowChangePw(false)}
            notify={notify}
          />
        )}
        <ToastStack toasts={toasts} dismiss={dismiss} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))] sm:px-6 lg:py-12">
        {/* header */}
        <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600">
              <Sparkles className="h-3.5 w-3.5" /> 懒人自动化 · 全自动后台运行
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Lumen
              <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                {" "}
                控制台
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              网易云音乐 · 自动签到 / 自动听歌打卡，一处开关，全程托管。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start">
            <span className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-soft sm:inline-flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-[11px] font-bold text-white">
                {account.username.slice(0, 1).toUpperCase()}
              </span>
              {account.username}
            </span>
            {users.length > 0 && (
              <button
                onClick={async () => {
                  try {
                    const { message } = await api.runAll();
                    notify(message, true);
                    setTimeout(load, 2000);
                  } catch (e) {
                    handleError(e);
                  }
                }}
                className="btn-ghost"
              >
                <Play className="h-4 w-4" /> 立即执行
              </button>
            )}
            <button onClick={() => setShowLogin(true)} className="btn-primary">
              <Plus className="h-4 w-4" /> 添加账号
            </button>
            <button
              onClick={() => setShowChangePw(true)}
              className="btn-ghost"
              title="修改密码"
            >
              <Key className="h-4 w-4" />
            </button>
            <button onClick={logout} className="btn-ghost" title="退出登录">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="托管账号"
            value={stats.accounts}
          />
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label="自动任务启用"
            value={stats.active}
          />
          <StatCard
            icon={<Sparkles className="h-5 w-5" />}
            label="累计听歌量"
            value={formatNumber(stats.totalListen)}
          />
        </div>

        <div className="mb-8">
          <SchedulerBar
            scheduler={scheduler}
            onChange={setScheduler}
            notify={notify}
          />
        </div>

        {/* accounts */}
        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass h-80 p-6">
                <div className="flex items-center gap-4">
                  <div className="skeleton h-14 w-14 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-2/3" />
                    <div className="skeleton h-3 w-1/3" />
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <div className="skeleton h-2 w-full" />
                  <div className="skeleton h-24 w-full" />
                  <div className="skeleton h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <EmptyState onAdd={() => setShowLogin(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {users.map((u, i) => (
              <AccountCard
                key={u.uid}
                user={u}
                index={i}
                onChange={upsertUser}
                onRemove={() => setPendingDelete(u)}
                notify={notify}
              />
            ))}
          </div>
        )}

        <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
          Lumen · 仅供个人学习与自动化使用 ·
          数据按账号隔离，登录态加密存储于服务器
        </footer>
      </div>

      {showChangePw && (
        <ChangePasswordModal
          onClose={() => setShowChangePw(false)}
          notify={notify}
        />
      )}

      {showLogin && (
        <QRLogin
          onClose={() => setShowLogin(false)}
          onSuccess={(user) => {
            upsertUser(user);
            setShowLogin(false);
            notify(`账号「${user.nickname || user.uid}」已添加`, true);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="移除账号"
          message={`确定移除「${pendingDelete.nickname || pendingDelete.uid}」吗？该账号的托管设置与登录态将被删除，可重新扫码再次添加。`}
          confirmLabel="移除"
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <ToastStack toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="glass card-hover flex items-center gap-4 p-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-accent-50 text-brand-600 ring-1 ring-brand-100">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-5 px-6 py-20 text-center">
      <div className="flex h-20 w-20 animate-float items-center justify-center rounded-3xl bg-gradient-to-br from-brand-50 to-accent-50 ring-1 ring-brand-100">
        <Users className="h-9 w-9 text-brand-500" />
      </div>
      <div>
        <h3 className="text-xl font-bold text-slate-900">还没有账号</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">
          扫码登录你的网易云账号，开启自动签到与自动听歌打卡，剩下的交给后台托管。
        </p>
      </div>
      <button onClick={onAdd} className="btn-primary">
        <Plus className="h-4 w-4" /> 扫码添加账号
      </button>
    </div>
  );
}
