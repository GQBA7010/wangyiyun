// PM2 process file for BaoTa / production deployment.
// Usage: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'wangyiyun',
      cwd: __dirname,
      script: 'server/src/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 生产环境务必设置一个随机长字符串（用于会话签名 + 登录态加密）：
        //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
        // SESSION_SECRET: '请替换为你的随机密钥',
        // 宝塔/Nginx 反向代理时建议保留；若启用 HTTPS 则 COOKIE_SECURE 用默认 true。
        TRUST_PROXY: '1',
      },
      max_memory_restart: '300M',
      autorestart: true,
      time: true,
    },
  ],
}
