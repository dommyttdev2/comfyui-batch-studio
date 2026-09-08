const fs = require('fs');
const path = require('path');
fs.mkdirSync('dist-electron/preload', { recursive: true });
fs.copyFileSync('src/preload/index.cjs', 'dist-electron/preload/index.cjs');
fs.rmSync('dist-electron/templates', { recursive: true, force: true });
fs.cpSync('templates', 'dist-electron/templates', { recursive: true });
