export interface UserSettings {
  autoSignin: boolean;
  autoScrobble: boolean;
  autoTasks: boolean;
  autoPartner: boolean;
  partnerScore: number;
  scrobbleCount: number;
}

export interface TaskResult {
  at: number;
  message: string;
  count?: number;
}

export interface PartnerResult extends TaskResult {
  eligible?: boolean;
  evaluated?: number;
}

export interface LogEntry {
  at: number;
  type: string;
  message: string;
  ok: boolean;
}

export interface User {
  uid: number;
  nickname?: string;
  avatarUrl?: string;
  level?: number;
  listenSongs?: number;
  settings: UserSettings;
  lastSignin?: TaskResult;
  lastScrobble?: TaskResult;
  lastYunbei?: TaskResult & { claimed?: number; total?: number };
  lastPartner?: PartnerResult;
  logs?: LogEntry[];
  playedCount?: number;
  status?: "active" | "expired" | "unknown";
}

export interface Scheduler {
  enabled: boolean;
}

export interface Account {
  id: string;
  username: string;
  createdAt: number;
  lastLoginAt?: number;
  scheduler?: Scheduler;
  role?: "admin" | "user";
  disabled?: boolean;
}

export interface AdminAccount extends Account {
  neteaseCount: number;
}

export interface AdminStats {
  totalAccounts: number;
  activeAccounts: number;
  disabledAccounts: number;
  totalNeteaseUsers: number;
  maxAccounts: number;
  maxNeteasePerUser: number;
}

/** Thrown for HTTP-level failures; carries the response status for callers. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new ApiError(data.error || `请求失败 (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  // --- auth ---
  me: () =>
    http<{
      account: Account | null;
      allowRegistration: boolean;
      emailVerification: boolean;
    }>("/api/auth/me"),
  captcha: () => http<{ captchaId: string; svg: string }>("/api/auth/captcha"),
  sendEmailCode: (email: string, captchaId: string, captcha: string) =>
    http<{ codeId: string }>("/api/auth/email-code", {
      method: "POST",
      body: JSON.stringify({ email, captchaId, captcha }),
    }),
  register: (
    username: string,
    password: string,
    captchaId: string,
    captcha: string,
    email?: string,
    emailCodeId?: string,
    emailCode?: string,
  ) =>
    http<{ account: Account }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        captchaId,
        captcha,
        email,
        emailCodeId,
        emailCode,
      }),
    }),
  login: (
    username: string,
    password: string,
    captchaId: string,
    captcha: string,
  ) =>
    http<{ account: Account }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, captchaId, captcha }),
    }),
  logout: () => http("/api/auth/logout", { method: "POST" }),
  sendForgotCode: (email: string, captchaId: string, captcha: string) =>
    http<{ codeId: string }>("/api/auth/forgot-code", {
      method: "POST",
      body: JSON.stringify({ email, captchaId, captcha }),
    }),
  resetPassword: (
    email: string,
    emailCodeId: string,
    emailCode: string,
    password: string,
  ) =>
    http<{ username: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, emailCodeId, emailCode, password }),
    }),

  qrKey: () =>
    http<{ key: string; qrurl: string }>("/api/login/qr/key", {
      method: "POST",
    }),
  qrCheck: (key: string) =>
    http<{
      code: number;
      message?: string;
      nickname?: string;
      avatarUrl?: string;
      user?: User;
      error?: string;
    }>(`/api/login/qr/check?key=${encodeURIComponent(key)}`),
  listUsers: () => http<{ users: User[] }>("/api/users"),
  removeUser: (uid: number) => http(`/api/users/${uid}`, { method: "DELETE" }),
  updateSettings: (uid: number, settings: Partial<UserSettings>) =>
    http<{ user: User }>(`/api/users/${uid}/settings`, {
      method: "POST",
      body: JSON.stringify(settings),
    }),
  signin: (uid: number) =>
    http<{ message: string; user: User }>(`/api/users/${uid}/signin`, {
      method: "POST",
    }),
  scrobble: (uid: number) =>
    http<{ message: string; user: User }>(`/api/users/${uid}/scrobble`, {
      method: "POST",
    }),
  refresh: (uid: number) =>
    http<{ user: User }>(`/api/users/${uid}/refresh`, { method: "POST" }),
  check: (uid: number) =>
    http<{ valid: boolean; user: User }>(`/api/users/${uid}/check`, {
      method: "POST",
    }),
  yunbeiTasks: (uid: number) =>
    http<{ message: string; claimed: number; total: number; user: User }>(
      `/api/users/${uid}/tasks`,
      { method: "POST" },
    ),
  partner: (uid: number) =>
    http<{
      message: string;
      eligible?: boolean;
      evaluated?: number;
      user: User;
    }>(`/api/users/${uid}/partner`, { method: "POST" }),
  runAll: () => http<{ message: string }>("/api/run-all", { method: "POST" }),
  getScheduler: () => http<{ scheduler: Scheduler }>("/api/scheduler"),
  setScheduler: (patch: Partial<Scheduler>) =>
    http<{ scheduler: Scheduler }>("/api/scheduler", {
      method: "POST",
      body: JSON.stringify(patch),
    }),

  // --- password ---
  changePassword: (oldPassword: string, newPassword: string) =>
    http<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  // --- admin ---
  adminStats: () => http<{ stats: AdminStats }>("/api/admin/stats"),
  adminAccounts: () =>
    http<{ accounts: AdminAccount[] }>("/api/admin/accounts"),
  adminPatchAccount: (
    id: string,
    patch: { role?: string; disabled?: boolean },
  ) =>
    http<{ account: Account }>(`/api/admin/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  adminDeleteAccount: (id: string) =>
    http(`/api/admin/accounts/${id}`, { method: "DELETE" }),
  adminResetPassword: (id: string, newPassword: string) =>
    http(`/api/admin/accounts/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
};
