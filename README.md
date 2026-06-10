# Lumen · 网易云音乐自动化控制台

一个开箱即用的网易云音乐「懒人自动化」面板：官方扫码登录后，后台**全自动**为账号执行**每日签到**与**全天 24 小时不间断听歌打卡（刷听歌量，自动去重不重复）**，所有功能均可一键开关。专为部署到自己的服务器（如**宝塔面板**）长期托管而设计。

> 仅供个人学习与自动化使用。登录态（cookie）仅保存在你自己的服务器本地，不会上传到任何第三方。

## ✨ 功能

- **官方扫码登录**：调用 `music.163.com` 官方接口生成二维码，用网易云 App 扫码即可，无需密码。
- **自动签到**：自动完成 PC 端 + 移动端每日签到（`dailyTask`），开关可控。
- **自动听歌打卡**：通过官方 `weblog` 上报接口刷听歌量，自动从热门榜单取歌、**自动去重不重复**，每次数量可配置（1–500）。
- **全天自动听歌**：开启后全天 24 小时**不间断**循环为所有账号自动听歌打卡（每日自动签到一次，时区 Asia/Shanghai），真正懒人托管。
- **自动云贝任务**：全天定时检测云贝任务中心（`task/todo/query`），自动完成可自动化项（收藏歌曲），并**自动领取**已完成任务的云贝奖励（`task/point/receive`），无需手动查看；开关可控（每日去重，时区 Asia/Shanghai）。
- **多账号管理**：支持同时托管多个账号，每个账号独立开关、独立日志。
- **登录态检测**：一键检测 cookie 是否过期，过期后自动标记提示重新扫码。
- **一键执行**：除了全天自动听歌，还支持一键立即为所有账号执行全部已开启的任务。
- **现代化界面**：深色玻璃拟态 UI，响应式，含进度、状态与运行日志。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 · Vite · TypeScript · Tailwind CSS |
| 后端 | Node.js · Express |
| 加密 | 自实现网易云 weapi / eapi（AES + RSA，纯 Node `crypto`） |
| 存储 | 本地 JSON 文件（零依赖、免编译，适合宝塔） |

前端构建产物会直接输出到 `server/public`，由后端单进程同时托管 API 与页面 —— **一个 Node 进程即可运行整套应用**。

## 📁 目录结构

```
wangyiyun/
├── server/                 # 后端
│   └── src/
│       ├── index.js        # Express 入口（API + 静态托管）
│       ├── netease/        # 网易云加密与接口封装
│       │   ├── crypto.js    #   weapi / eapi 加解密
│       │   └── api.js       #   扫码登录 / 签到 / 听歌等接口
│       ├── store.js        # JSON 存储（账号、设置、日志）
│       ├── tasks.js        # 签到 / 听歌打卡任务逻辑（含去重）
│       ├── scheduler.js    # 全天 24 小时不间断听歌循环
│       └── routes/api.js   # REST API 路由
├── web/                    # 前端（React + Vite）
├── ecosystem.config.cjs    # PM2 进程配置
└── package.json            # 根脚本（build / start / deploy）
```

## 🚀 本地运行

需要 Node.js ≥ 18。

```bash
# 1. 安装依赖
npm run install:all

# 2. 开发模式（两个终端）
npm run dev:server      # 后端 http://localhost:3000
npm run dev:web         # 前端 http://localhost:5173（已代理 /api 到后端）

# 或：生产模式（构建前端 + 启动后端，一个进程）
npm run build
npm start               # http://localhost:3000
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
   或在宝塔 PM2 管理器里「添加项目」，启动文件选择 `server/src/index.js`，运行目录为项目根目录。
5. **反向代理（可选，用于绑定域名 / HTTPS）**：在宝塔新建站点，设置「反向代理」到 `http://127.0.0.1:3000`，再一键申请 SSL 证书即可用域名访问。
6. **访问面板**：打开 `http://服务器IP:3000`（或你的域名）→ 点「添加账号」→ 用网易云 App 扫码 → 打开「自动签到 / 自动听歌打卡」开关 → 开启「全天自动听歌」→ 完成，后台会 24 小时不间断自动运行。

> 端口可通过环境变量 `PORT` 修改；数据目录可通过 `DATA_DIR` 指定（见 `server/.env.example`）。

## 🔌 API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login/qr/key` | 生成扫码登录二维码 |
| GET | `/api/login/qr/check?key=` | 轮询扫码状态（801 等待 / 802 已扫 / 803 成功） |
| GET | `/api/users` | 账号列表（不含 cookie） |
| DELETE | `/api/users/:uid` | 移除账号 |
| POST | `/api/users/:uid/settings` | 更新开关 / 打卡数量 |
| POST | `/api/users/:uid/signin` | 立即签到 |
| POST | `/api/users/:uid/scrobble` | 立即听歌打卡 |
| POST | `/api/users/:uid/refresh` | 刷新等级 / 听歌量 |
| POST | `/api/users/:uid/check` | 检测登录态是否有效 |
| POST | `/api/users/:uid/tasks` | 立即执行云贝任务（自动完成可自动化项 + 自动领奖） |
| GET/POST | `/api/scheduler` | 查看 / 开关全天自动听歌（`enabled`） |
| POST | `/api/run-all` | 立即为所有账号执行全部已开启的任务 |

## ⚠️ 说明与免责

- 本项目调用网易云官方接口，接口行为可能随官方调整而变化。
- 听歌打卡（刷听歌量）属于自动化行为，请自行评估账号风险，合理设置频率与数量。
- 登录 cookie 等敏感数据仅存于 `server/data/`（已在 `.gitignore` 中忽略），请勿公开你的服务器或泄露该目录。
- 本项目仅供学习交流，请勿用于商业牟利或违反网易云用户协议的用途。
