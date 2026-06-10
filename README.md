# Lumen · 网易云音乐自动化控制台

一个可**多用户对外公开**的网易云音乐「懒人自动化」平台：访客自行**注册 / 登录**后，各自官方扫码托管自己的网易云账号，后台**全自动**执行**每日签到**与**全天 24 小时不间断听歌打卡（刷听歌量，自动去重不重复）**，所有功能均可一键开关。**用户之间数据完全隔离**。专为部署到自己的服务器（如**宝塔面板**）长期托管而设计。

> 登录态（cookie）经 **AES-256-GCM 加密**后仅保存在你自己的服务器本地，不会上传到任何第三方。

## ✨ 功能

- **多用户注册 / 登录**：任何访客可注册账号、登录使用；每个用户只能看到与操作自己托管的网易云账号（数据隔离）。
- **账号鉴权与会话**：所有接口需登录，基于 httpOnly 签名会话 Cookie；支持退出登录。
- **官方扫码登录**：调用 `music.163.com` 官方接口生成二维码，用网易云 App 扫码即可，无需密码。
- **自动签到**：自动完成 PC 端 + 移动端每日签到（`dailyTask`），开关可控。
- **自动听歌打卡**：通过官方 `weblog` 上报接口刷听歌量，自动从热门榜单取歌、**自动去重不重复**，每次数量可配置（1–500）。
- **全天自动听歌**：开启后全天 24 小时**不间断**循环为你名下的账号自动听歌打卡（每日自动签到一次，时区 Asia/Shanghai），每个用户独立开关。
- **自动云贝任务**：全天定时检测云贝任务中心（`task/todo/query`），自动完成可自动化项（收藏歌曲），并**自动领取**已完成任务的云贝奖励（`task/point/receive`），无需手动查看；开关可控（每日去重，时区 Asia/Shanghai）。
- **多账号管理**：支持同时托管多个账号，每个账号独立开关、独立日志。
- **登录态检测**：一键检测 cookie 是否过期，过期后自动标记提示重新扫码。
- **一键执行**：除了全天自动听歌，还支持一键立即为所有账号执行全部已开启的任务。
- **音乐合伙人自动评测**：全天自动拉取「音乐合伙人」当日 / 额外评测任务并自动提交评分（每用户可选评分策略），无资格账号当天自动跳过、跨日恢复；开关可控。
- **功能状态总览**：每个账号顶部以状态卡集中展示签到 / 听歌 / 云贝 / 合伙人各功能的开启状态与上次执行结果。
- **修改密码**：已登录用户可自行修改密码（需验证当前密码）。
- **管理员后台**：管理员可查看全站统计、用户列表、封禁/解封用户、删除用户、重置密码、提升/降级角色。第一个注册的账号自动成为管理员。
- **每用户托管账号数限制**：通过 `MAX_NETEASE_PER_USER` 限制每个用户可托管的网易云账号数（默认 5，0 = 不限制）。
- **邮箱验证码注册**：配置 QQ SMTP（`SMTP_USER` / `SMTP_PASS`）后，注册需通过邮箱验证码验证；未配置时自动降级为免验证注册。
- **邮件通知**：托管账号登录态过期时自动邮件通知所属用户（仅在状态首次变为过期时发送一次，避免重复打扰）。
- **现代化界面**：白色浅色主题，丝滑过渡与弹窗动效，全面响应式（移动端 / iOS / 平板 / 桌面 / 跨浏览器适配），含进度、状态与运行日志。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 · Vite · TypeScript · Tailwind CSS |
| 后端 | Node.js ≥ 18 · **TypeScript（strict）** · Express · Helmet · 速率限制 · gzip |
| 校验 | **zod**：环境变量解析 + 请求体 schema 校验 |
| 日志 | **pino · pino-http**：结构化 JSON 访问日志（自动脱敏 Cookie）|
| 测试 | **vitest**：覆盖加密 / 验证码 / 存储 / 配置等安全核心模块 |
| 工具链 | tsc 编译到 `dist/` · tsx 热重载开发 · ESLint（flat config，type-checked）· Prettier |
| 鉴权 | scrypt 密码哈希 · HMAC 签名会话 Cookie（httpOnly）|
| 加密 | 登录态 AES-256-GCM 落盘加密；网易云 weapi / eapi（AES + RSA，纯 Node `crypto`） |
| 存储 | **SQLite（better-sqlite3，WAL）**：事务原子写 + 定时自动备份；旧版 data.json 首次启动自动迁移（零外部数据库，适合宝塔） |

后端使用**严格 TypeScript** 编写，`npm run build` 经 `tsc` 编译为 `server/dist/`。前端构建产物输出到 `server/public`，由后端单进程同时托管 API 与页面 —— **一个 Node 进程即可运行整套应用**。

## 📁 目录结构

```
wangyiyun/
├── server/                 # 后端（严格 TypeScript，ESM）
│   ├── src/
│   │   ├── index.ts        # Express 入口（API + 静态托管 + pino-http 日志）
│   │   ├── config.ts       # zod 解析环境变量，导出类型化配置
│   │   ├── logger.ts       # pino 结构化日志实例
│   │   ├── types.ts        # 领域类型集中定义
│   │   ├── express.d.ts    # Express Request 类型增强
│   │   ├── netease/        # 网易云加密与接口封装
│   │   │   ├── crypto.ts    #   weapi / eapi 加解密
│   │   │   └── api.ts       #   扫码登录 / 签到 / 听歌 / 云贝 / 合伙人接口
│   │   ├── security/       # 安全：加密、密码哈希、会话鉴权、验证码
│   │   │   ├── crypto.ts    #   scrypt 哈希 / AES-256-GCM / HMAC 会话令牌
│   │   │   ├── auth.ts      #   会话签发与 requireAuth 中间件
│   │   │   └── captcha.ts   #   自托管 SVG 图形验证码
│   │   ├── db.ts           # SQLite（WAL）连接、schema 与自动备份
│   │   ├── store.ts        # 存储层（平台账号 + 托管账号，cookie 加密落盘）
│   │   ├── tasks.ts        # 签到 / 听歌 / 云贝 / 合伙人任务逻辑
│   │   ├── scheduler.ts    # 全天 24 小时不间断任务循环（按用户开关）
│   │   ├── routes/
│   │   │   ├── auth.ts      #   注册 / 登录 / 退出 / 当前用户（zod 校验）
│   │   │   └── api.ts       #   托管账号相关 REST API（按归属隔离）
│   │   └── **/*.test.ts    # vitest 单元测试
│   ├── tsconfig.json       # 类型检查 / lint 用（含测试）
│   ├── tsconfig.build.json # 构建用（仅 src，排除测试）
│   ├── eslint.config.js    # ESLint flat config（type-checked）
│   ├── vitest.config.ts    # 测试配置
│   └── .prettierrc.json    # Prettier 配置
├── web/                    # 前端（React + Vite）
├── ecosystem.config.cjs    # PM2 进程配置（指向 server/dist/index.js）
└── package.json            # 根脚本（build / start / deploy）
```

## 🚀 本地运行

需要 Node.js ≥ 18。

```bash
# 1. 安装依赖
npm run install:all

# 2. 开发模式（两个终端）
npm run dev:server      # 后端 http://localhost:3000（tsx watch，保存即重启）
npm run dev:web         # 前端 http://localhost:5173（已代理 /api 到后端）

# 或：生产模式（构建前端 + 编译后端 + 启动，一个进程）
npm run build
npm start               # http://localhost:3000
```

后端质量校验（在 `server/` 目录执行）：

```bash
npm run typecheck       # tsc --noEmit，0 类型错误
npm run lint            # ESLint（type-checked 规则）
npm run test            # vitest 单元测试
npm run format:check    # Prettier 风格校验
npm run build           # tsc 编译到 dist/
```

## 🛰️ 宝塔面板部署（推荐）

1. **安装环境**：宝塔「软件商店」安装 **Node.js 版本管理器**（选 Node 18/20）与 **PM2 管理器**。
2. **上传代码**：把项目放到站点目录，例如 `/www/wwwroot/wangyiyun`。
3. **构建与安装**：在该目录打开终端执行：
   ```bash
   npm run install:all
   npm run build
   ```
4. **启动进程**：用 PM2 启动（已提供 `ecosystem.config.cjs`）：
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save           # 保存进程列表，开机自启
   ```
   或在宝塔 PM2 管理器里「添加项目」，启动文件选择 `server/dist/index.js`（需先 `npm run build`），运行目录为项目根目录。
5. **反向代理 + HTTPS（对外公开务必启用）**：在宝塔新建站点，设置「反向代理」到 `http://127.0.0.1:3000`，再一键申请 SSL 证书用域名 HTTPS 访问。会话 Cookie 默认仅在 HTTPS 下发送（`COOKIE_SECURE=true`）。
6. **配置安全密钥**：编辑 `ecosystem.config.cjs` 或环境变量，设置随机 `SESSION_SECRET`（见下方「安全」）。
7. **访问面板**：打开你的域名 → **注册 / 登录** → 点「添加账号」→ 用网易云 App 扫码 → 打开「自动签到 / 自动听歌打卡」开关 → 开启「全天自动听歌」→ 完成，后台会 24 小时不间断自动运行。

> 端口可通过环境变量 `PORT` 修改；数据目录可通过 `DATA_DIR` 指定（见 `server/.env.example`）。

## 🔐 安全（对外公开部署须知）

面向公开使用时请务必：

- **设置 `SESSION_SECRET`**：用于会话签名与登录态加密。生成方法：
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  未设置时会自动生成并持久化到数据目录；显式设置后更利于多实例 / 迁移（更换该值会使已有会话与已加密登录态失效）。
- **启用 HTTPS**：保持 `COOKIE_SECURE=true`（默认），反代时设 `TRUST_PROXY=1`。
- **按需关闭注册**：如不想对外开放注册，设 `ALLOW_REGISTRATION=false`，或用 `MAX_ACCOUNTS` 限制名额。

内置安全措施：Helmet 安全响应头与 CSP、登录与全局请求**速率限制**、scrypt 密码哈希、httpOnly 签名会话 Cookie、登录态 **AES-256-GCM** 落盘加密、请求体大小限制、所有接口强制鉴权且**按归属隔离**（无法越权访问他人账号）。完整环境变量见 `server/.env.example`。

## 🔌 API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login/qr/key` | 生成扫码登录二维码 |
| GET | `/api/login/qr/check?key=` | 轮询扫码状态（801 等待 / 802 已扫 / 803 成功） |
| GET | `/api/health` | 健康检查（无需登录；返回 uptime / 数据库状态 / 调度器状态 / SMTP 是否启用，数据库异常时返回 503） |
| POST | `/api/auth/register` | 注册并登录 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 当前登录用户 |
| GET | `/api/users` | 当前用户的账号列表（不含 cookie） |
| DELETE | `/api/users/:uid` | 移除账号 |
| POST | `/api/users/:uid/settings` | 更新开关 / 打卡数量 |
| POST | `/api/users/:uid/signin` | 立即签到 |
| POST | `/api/users/:uid/scrobble` | 立即听歌打卡 |
| POST | `/api/users/:uid/refresh` | 刷新等级 / 听歌量 |
| POST | `/api/users/:uid/check` | 检测登录态是否有效 |
| POST | `/api/users/:uid/tasks` | 立即执行云贝任务（自动完成可自动化项 + 自动领奖） |
| POST | `/api/users/:uid/partner` | 立即执行音乐合伙人评测（自动提交评分） |
| GET/POST | `/api/scheduler` | 查看 / 开关当前用户的全天自动听歌（`enabled`） |
| POST | `/api/run-all` | 立即为当前用户的所有账号执行全部已开启的任务 |

> 除 `/api/health` 与 `/api/auth/*` 外，所有接口均需登录；`/api/users/:uid/*` 仅能操作当前登录用户名下的账号。

## ⚠️ 说明与免责

- 本项目调用网易云官方接口，接口行为可能随官方调整而变化。
- 听歌打卡（刷听歌量）属于自动化行为，请自行评估账号风险，合理设置频率与数量。
- 登录 cookie 等敏感数据经 AES-256-GCM 加密后仅存于 `server/data/`（SQLite 数据库 `lumen.db`，已在 `.gitignore` 中忽略），请勿公开你的服务器或泄露该目录与 `SESSION_SECRET`。
- 数据库默认每 6 小时自动备份到 `server/data/backups/`（保留最近 20 份，可经 `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` 调整）。旧版 `data.json` 在升级后首次启动时自动迁移进 SQLite 并改名为 `data.json.migrated` 保留。
- 本项目仅供学习交流，请勿用于商业牟利或违反网易云用户协议的用途。
