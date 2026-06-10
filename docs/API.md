# Lumen API 文档

所有接口均以 JSON 交互，统一返回 `{ ok: boolean, ... }`；失败时附带 `error` 字段（中文提示）。
除注册/登录/验证码/健康检查外，其余接口都需要登录（httpOnly 会话 Cookie）。

通用约定：

- 鉴权：登录后服务端通过 `Set-Cookie` 下发签名会话（SameSite=Lax、httpOnly）。修改/重置密码后旧会话立即失效。
- CSRF：非 GET 请求若携带与站点不一致的 `Origin`/`Referer` 将被 403 拒绝。
- 限流：全局 300 次/分钟；认证类接口 30 次/15 分钟；验证码邮件 10 次/15 分钟。
- 错误码：`400` 参数错误、`401` 未登录/凭证错误、`403` 无权限/被禁用/CSRF、`404` 资源不存在（含越权访问他人资源）、`409` 冲突、`429` 限流、`503` 服务不健康。

## 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 返回 `{ ok, ts, uptime, db: 'up'\|'down', scheduler, smtp }`；数据库异常时返回 503 |

## 认证 `/api/auth`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/captcha` | 获取图形验证码 `{ captchaId, svg }`（一次性、5 分钟有效） |
| GET | `/me` | 当前登录账号 `{ account\|null, allowRegistration, emailVerification }` |
| POST | `/email-code` | 发送注册邮箱验证码。Body: `{ email, captchaId, captcha }` → `{ codeId }`（启用 SMTP 时可用；60 秒重发冷却、10 分钟有效） |
| POST | `/register` | 注册。Body: `{ username, password, captchaId, captcha }`；启用 SMTP 时还需 `{ email, emailCodeId, emailCode }`。首个注册账号自动成为管理员 |
| POST | `/login` | 登录。Body: `{ username, password, captchaId, captcha }` |
| POST | `/change-password` | 修改密码（需登录）。Body: `{ oldPassword, newPassword }`；成功后其他会话全部失效，当前会话自动续签 |
| POST | `/logout` | 退出登录 |

## 托管账号 `/api`（需登录，按归属隔离）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/login/qr/key` | 获取网易云扫码登录二维码 `{ key, qrurl }` |
| GET | `/login/qr/check?key=` | 轮询扫码状态；`code=803` 登录成功并绑定到当前用户（受 `MAX_NETEASE_PER_USER` 配额限制） |
| GET | `/users` | 列出自己托管的网易云账号（不含 cookie 等敏感字段） |
| DELETE | `/users/:uid` | 删除自己托管的账号 |
| POST | `/users/:uid/settings` | 更新任务设置。Body（均可选）: `{ autoSignin, autoScrobble, autoTasks, autoPartner, scrobbleCount(1–500), partnerScore(1–4) }` |
| POST | `/users/:uid/signin` | 立即执行每日签到 |
| POST | `/users/:uid/scrobble` | 立即执行听歌打卡 |
| POST | `/users/:uid/tasks` | 立即执行云贝任务 |
| POST | `/users/:uid/partner` | 立即执行音乐合伙人评测（返回 `eligible`/`evaluated`/`message`） |
| POST | `/users/:uid/refresh` | 刷新昵称/头像等资料 |
| POST | `/users/:uid/check` | 检测登录态是否有效 `{ valid }`；失效时会邮件通知（启用 SMTP 时） |
| GET | `/scheduler` | 获取本账号的 24h 调度开关 |
| POST | `/scheduler` | 设置调度开关。Body: `{ enabled }` |
| POST | `/run-all` | 立即触发本账号全部已启用任务（异步执行） |

## 管理后台 `/api/admin`（需管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/stats` | 全站统计 `{ totalAccounts, activeAccounts, disabledAccounts, totalNeteaseUsers, maxAccounts, maxNeteasePerUser }` |
| GET | `/accounts` | 用户列表（含各自托管账号数 `neteaseCount`） |
| PATCH | `/accounts/:id` | 修改用户。Body（可选）: `{ role: 'admin'\|'user', disabled: boolean }`（不能禁用自己）。禁用后该用户现有会话立即失效 |
| POST | `/accounts/:id/reset-password` | 重置任意用户密码。Body: `{ newPassword }`；该用户旧会话全部失效 |
| GET | `/accounts/:id/netease` | 查看指定用户托管的网易云账号 |
| DELETE | `/accounts/:id` | 删除用户（连带删除其托管账号；不能删除自己） |
