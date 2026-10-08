import { defineConfig } from 'vite';import react from '@vitejs/plugin-react';import { execFileSync } from 'node:child_process';
export default defineConfig({root:'web',plugins:[react()],base:'/',define:{__WEB_BUILD_ID__:JSON.stringify(execFileSync(process.execPath,['scripts/web-source-id.cjs'],{encoding:'utf8'}))},build:{outDir:'../dist-web',emptyOutDir:true}});
