/**
 * PM2 process file for VPS hosting.
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Two processes: the web app and the background worker (runs a scheduler tick every 15 s:
 * campaign dialing, call reconciliation, recordings, retention, housekeeping).
 * Set the same CRON_SECRET for both (or copy it from Admin → System → Scheduler).
 */
// Required: a long random string (the app ignores short or example values).
const CRON_SECRET = process.env.CRON_SECRET || "";
if (!CRON_SECRET) console.warn("[dialzen] Set CRON_SECRET before starting PM2, e.g. CRON_SECRET=$(openssl rand -hex 24) pm2 start ecosystem.config.cjs");

module.exports = {
  apps: [
    {
      name: "dialzen",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        CRON_SECRET,
      },
      max_memory_restart: "512M",
    },
    {
      name: "dialzen-worker",
      script: "scripts/worker.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        CRON_SECRET,
      },
      max_memory_restart: "128M",
    },
  ],
};
