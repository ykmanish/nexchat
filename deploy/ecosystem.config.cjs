/**
 * PM2 process definitions for NexChat.
 *
 * Ports are 3100/5100 rather than the 3000/5000 defaults because splitta
 * already runs on this server. Change them here, in
 * nginx-chax.nexarrow.eu.conf, and in backend/.env together — nothing
 * discovers them at runtime.
 */
module.exports = {
  apps: [
    {
      name: 'nexchat-backend',
      cwd: '/var/www/nexchat/backend',
      script: 'src/server.js',
      interpreter: 'node',
      instances: 1,
      // Fork, not cluster: Socket.IO keeps per-process connection state, and
      // clustering it without a shared adapter silently breaks realtime
      // delivery for anyone whose socket landed on another worker.
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 5100,
      },
      error_file: '/var/log/nexchat/backend.error.log',
      out_file: '/var/log/nexchat/backend.out.log',
      time: true,
    },
    {
      name: 'nexchat-frontend',
      cwd: '/var/www/nexchat/frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
      error_file: '/var/log/nexchat/frontend.error.log',
      out_file: '/var/log/nexchat/frontend.out.log',
      time: true,
    },
  ],
};
