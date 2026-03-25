'use strict';

const { execSync } = require('child_process');
const config = require('./config');

const ports = [config.directory.port, ...config.nodes.map(n => n.port)];

console.log('\n  Stopping bootstrap network...\n');

for (const port of ports) {
  try {
    // Windows: find process by port and kill it
    const result = execSync(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const lines = result.trim().split('\n');
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
        console.log(`  Killed process ${pid} on port ${port}`);
      } catch {}
    }
  } catch {
    // No process on this port
    console.log(`  Port ${port}: no process found`);
  }
}

console.log('\n  Done.\n');
