module.exports = {
  apps: [
    {
      name: 'equity-bot',
      script: 'src/index.js',
      cwd: __dirname,
      node_args: '--experimental-modules',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Log configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      // Restart policy
      restart_delay: 5000, // 5 seconds between restarts
      max_restarts: 10,    // max 10 restarts in a row
      min_uptime: 10000,   // must run at least 10s to be considered stable
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
  ],
};
