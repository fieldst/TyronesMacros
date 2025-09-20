const { spawn } = require('child_process');
const port = process.env.PORT || '5173';
const isWin = process.platform === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';
const args = ['vite', '--host', '--port', String(port)];
const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code || 0));
