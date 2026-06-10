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
      },
      max_memory_restart: '300M',
      autorestart: true,
      time: true,
    },
  ],
}
