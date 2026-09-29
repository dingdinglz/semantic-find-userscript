import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const header = `// ==UserScript==
// @name         按意思查找
// @namespace    semantic-find
// @version      ${pkg.version}
// @description  按自然语言查找当前网页中的原文段落
// @match        https://*/*
// @match        http://*/*
// @run-at       document-idle
// @sandbox      DOM
// @noframes
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_addStyle
// @grant        window.onurlchange
// @connect      api.typesafe.ai
// ==/UserScript==`;
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/userscript/entry.ts'], outfile: 'dist/semantic-find.user.js', bundle: true,
  format: 'iife', target: ['chrome105', 'edge105'], charset: 'utf8', legalComments: 'none', banner: { js: header } });
console.log('Built dist/semantic-find.user.js');
