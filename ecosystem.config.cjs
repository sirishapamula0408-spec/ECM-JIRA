// PM2 process configuration for the ECM JIRA Clone API (production).
//
// The Express API (server/index.js) also hosts the JL-136 real-time
// WebSocket hub at /ws, so it runs as a SINGLE fork instance — the
// realtime rooms are in-memory and cannot be load-balanced across a
// cluster without a shared broker. The static frontend is built to
// dist/ and served by nginx (see deploy/nginx/jira-lite.conf).
//
//   Start/reload:  pm2 startOrReload ecosystem.config.cjs --update-env
//   Persist:       pm2 save        (after `pm2 startup` — see deploy/README.md)
//
// NOTE: filename ends in .cjs because package.json has "type": "module";
// PM2 config must be CommonJS.

module.exports = {
  apps: [
    {
      name: 'jira-lite-api',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1, // single instance — in-memory realtime rooms (JL-136)
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
