import { build } from 'esbuild';
import { createServer } from 'node:https';
import { createServer as createHTTPServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile), dir = '.browser-test', session = `sf-test-${Date.now()}`;
await mkdir(dir, { recursive: true });
await mkdir('test-results', { recursive: true });
await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`, '-days', '1', '-subj', '/CN=localhost']);
await build({ entryPoints: ['tests/browser/mock-gm.ts'], outfile: `${dir}/mock.js`, bundle: true, format: 'iife' });
await build({ entryPoints: ['tests/browser/extract-harness.ts'], outfile: `${dir}/extract-harness.js`, bundle: true, format: 'iife' });
const html = (await readFile('tests/fixtures/article.html', 'utf8')).replace('</body>', '<script src="/mock.js"></script><script src="/semantic-find.user.js"></script><script src="/extract-harness.js"></script></body>');
const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
  const path = new URL(req.url!, 'http://localhost').pathname;
  const files: Record<string, [string, string]> = { '/extract-harness.js': [`${dir}/extract-harness.js`, 'text/javascript'], '/mock.js': [`${dir}/mock.js`, 'text/javascript'], '/semantic-find.user.js': ['dist/semantic-find.user.js', 'text/javascript'], '/fixture.js': ['tests/fixtures/fixture.js', 'text/javascript'], '/fixture.css': ['tests/fixtures/fixture.css', 'text/css'] };
  if (path === '/csp') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'");
  const file = files[path]; res.setHeader('Content-Type', `${file?.[1] ?? 'text/html'}; charset=utf-8`); res.end(file ? await readFile(file[0]) : html);
};
const server = createServer({ key: await readFile(`${dir}/key.pem`), cert: await readFile(`${dir}/cert.pem`) }, handler);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address() as import('node:net').AddressInfo, base = `https://127.0.0.1:${address.port}`;
const httpServer = createHTTPServer(handler); await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
const httpBase = `http://127.0.0.1:${(httpServer.address() as import('node:net').AddressInfo).port}`;
async function browser(...args: string[]): Promise<string> {
  // The installed native CLI resolves CSS only in the light DOM. Accessibility refs cross Shadow DOM.
  if (['click', 'fill'].includes(args[0])) {
    const selector = args[1]; let name: string | undefined;
    if (selector === '#sf-api-key') name = 'TypeSafe API Key';
    else if (selector.startsWith('input[aria-label=')) name = '按意思查找的查询';
    else if (selector.startsWith('button:has-text(')) name = selector.slice(17, -2);
    else if (selector.startsWith('.result button')) name = `匹配 ${Number(/nth=(\d+)/u.exec(selector)?.[1] ?? 0) + 1}`;
    if (name) {
      const data = JSON.parse(await browser('snapshot', '-i', '--json')).data;
      const role = args[0] === 'fill' ? 'textbox' : 'button';
      const ref = Object.entries(data.refs as Record<string, { name: string; role: string }>).find(([, r]) => r.role === role && r.name.includes(name!))?.[0];
      if (!ref) throw new Error(`Missing accessible control ${name}: ${data.snapshot}`);
      args[1] = '@' + ref;
      await browser('scrollintoview', args[1]);
    }
  }
  const { stdout } = await exec('agent-browser', ['--session', session, ...args], { timeout: 40000, maxBuffer: 1024 * 1024 }); return stdout.trim();
}
async function evaluate<T = any>(code: string): Promise<T> { return JSON.parse(await browser('eval', code)); }
const panel = `document.querySelector('[data-semantic-find-owned="panel"]').shadowRoot`;
async function panelText() { return evaluate<string>(`${panel}.textContent`); }
async function waitFor(code: string) {
  for (let i = 0; i < 50; i++) { if (await evaluate<boolean>(code)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${code}`);
}
const checks: string[] = []; const passed = (name: string) => { checks.push(name); console.log(`✓ ${name}`); };
async function open() {
  // Invoke the registered mock Tampermonkey menu; the CLI's multi-modifier press is broken in 0.21.4.
  await evaluate('__sfTest.menus["按意思查找"](); true');
  await waitFor('!!document.querySelector("[data-semantic-find-owned=panel]")');
}
try {
  await browser('--ignore-https-errors', 'open', base + '/article'); await open();
  assert.equal(await evaluate('__sfTest.traversals'), 0); assert.equal(await evaluate('__sfTest.calls.length'), 0); passed('未配置 Key：只打开设置，不遍历、不联网');
  await browser('fill', '#sf-api-key', 'browser-test-placeholder'); await browser('click', 'button:has-text("测试草稿")');
  await waitFor(`${panel}.textContent.includes('连接成功')`);
  assert.equal(await evaluate('__sfTest.traversals'), 0); assert.equal(await evaluate('__sfTest.calls[0].method'), 'GET'); passed('连接测试仅请求 models，不提取正文');
  await evaluate('__sfTest.delay=1000; true');
  await browser('fill', '#sf-api-key', 'draft-one-placeholder'); await browser('click', 'button:has-text("测试草稿")');
  await browser('fill', '#sf-api-key', 'draft-two-placeholder'); await new Promise(r => setTimeout(r, 1100));
  assert.ok(!(await panelText()).includes('连接成功')); passed('测试期间修改草稿，迟到成功不会验证新草稿');
  await browser('click', 'button:has-text("保存 Key")'); assert.equal(await evaluate(`${panel}.querySelector('#sf-api-key').value`), '');
  assert.ok((await panelText()).includes('尚未验证')); await evaluate('__sfTest.delay=80; true');
  await browser('click', 'button:has-text("显示")'); assert.equal(await evaluate(`${panel}.querySelector('#sf-api-key').value`), '');
  passed('保存未测试草稿可离线完成，已保存 Key 不回填或通过显示按钮泄露');
  await browser('click', 'button:has-text("返回搜索")'); await waitFor(`${panel}.textContent.includes('正文已在本地准备好')`);
  assert.equal(await evaluate('__sfTest.calls.filter(c=>c.method==="POST").length'), 0); passed('保存和返回搜索不触发推理');
  await browser('fill', 'input[aria-label="按意思查找的查询"]', '没有把握在哪里');
  // Page-origin synthetic submits must not trigger privileged actions.
  await evaluate(`${panel}.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true})); true`);
  assert.equal(await evaluate('__sfTest.calls.filter(c=>c.method==="POST").length'), 0);
  await browser('press', 'Enter'); await waitFor(`${panel}.textContent.includes('确认发送范围')`);
  assert.equal(await evaluate('__sfTest.calls.filter(c=>c.method==="POST").length'), 0);
  await browser('click', 'button:has-text("确认发送")'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  const calls = await evaluate<any[]>('__sfTest.calls.filter(c=>c.method==="POST")');
  for (const call of calls) { assert.equal(call.url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(call.anonymous, true); assert.equal(call.redirect, 'error'); assert.equal(call.referer, ''); assert.ok(!call.data.includes('SECRET_')); assert.ok(!call.data.includes('browser-test-placeholder')); assert.ok(!call.data.includes(base)); }
  passed('真实 Enter + 发送确认；出站字段和凭据边界通过');
  assert.ok(await evaluate('CSS.highlights.size > 0')); assert.equal(await evaluate('document.querySelectorAll("article mark").length'), 0);
  await browser('click', '.result button >> nth=0'); // first matching result
  assert.ok(await evaluate('Array.from(CSS.highlights.keys()).some(k=>k.endsWith("-current"))')); passed('CSS Highlight 生效且不包装原文节点');
  await browser('screenshot', 'test-results/search-panel.png');
  for (const [index, id] of [[2, 'repeat-a'], [3, 'repeat-b']] as const) {
    await browser('click', `.result button >> nth=${index}`);
    assert.equal(await evaluate('Array.from(CSS.highlights.get(Array.from(CSS.highlights.keys()).find(k=>k.endsWith("-current"))))[0].startContainer.parentElement.id'), id);
  }
  passed('同样原文出现在两处时，各自定位到正确节点');
  await browser('click', '#append'); await waitFor(`${panel}.textContent.includes('旧结果已失效')`); assert.equal(await evaluate('CSS.highlights.size'), 0); assert.equal(await evaluate(`${panel}.querySelectorAll('.result').length`), 0); passed('追加正文立即使列表和高亮失效');
  await browser('click', 'button:has-text("重新提取")'); await waitFor(`${panel}.textContent.includes('正文已在本地准备好')`);
  await evaluate('__sfTest.delay=700; __sfTest.ignoreAbort=true; true');
  await browser('fill', 'input[aria-label="按意思查找的查询"]', 'first'); await browser('press', 'Enter'); await browser('click', 'button:has-text("确认发送")');
  await browser('press', 'Escape'); await new Promise(r => setTimeout(r, 850));
  assert.equal(await evaluate('!!document.querySelector("[data-semantic-find-owned=panel]")'), false); assert.equal(await evaluate('CSS.highlights.size'), 0); passed('关闭后即使 abort 无效，迟到响应也不恢复面板或高亮');
  await open(); await waitFor(`${panel}.textContent.includes('正文已在本地准备好')`); await evaluate('__sfTest.delay=80; __sfTest.ignoreAbort=false; true');
  await browser('fill', 'input[aria-label="按意思查找的查询"]', 'absence'); await browser('press', 'Enter'); await browser('click', 'button:has-text("确认发送")');
  await waitFor(`${panel}.textContent.includes('在本次检索范围内没有找到匹配片段')`); passed('仅完整有效扫描才显示范围内无匹配');
  await browser('fill', 'input[aria-label="按意思查找的查询"]', 'uncertain'); await browser('press', 'Enter'); await browser('click', 'button:has-text("确认发送")');
  await waitFor(`${panel}.textContent.includes('没有确定匹配')`); assert.ok((await panelText()).includes('待确认片段')); passed('灰区独立展示，不宣称部分回答');
  await browser('click', '#route'); await waitFor(`${panel}.textContent.includes('页面已导航')`); assert.equal(await evaluate('CSS.highlights.size'), 0); passed('SPA 导航清除快照和高亮');
  await browser('click', 'button:has-text("重新提取")'); await waitFor(`${panel}.textContent.includes('正文已在本地准备好')`);
  await evaluate('__sfTest.delay=700; __sfTest.ignoreAbort=true; true'); await browser('fill', 'input[aria-label="按意思查找的查询"]', 'remote'); await browser('press', 'Enter'); await browser('click', 'button:has-text("确认发送")');
  await evaluate('__sfTest.setCredential(null); true'); await new Promise(r => setTimeout(r, 850)); assert.equal(await evaluate('CSS.highlights.size'), 0); assert.equal(await evaluate(`${panel}.querySelectorAll('.result').length`), 0); passed('模拟远端标签页清除 Key，旧队列及响应失效');
  await browser('open', base + '/fallback'); await evaluate('__sfTest.setCredential("fixture-record"); true'); await open(); await waitFor(`${panel}.textContent.includes('正文已在本地准备好')`);
  await browser('fill', 'input[aria-label="按意思查找的查询"]', 'find'); await browser('press', 'Enter'); await browser('click', 'button:has-text("确认发送")'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  await browser('click', '.result button >> nth=0'); await waitFor('!!document.querySelector("[data-semantic-find-owned=overlay]")'); passed('不支持 CSS Highlight 时使用当前项覆盖层');
  await browser('open', base + '/csp'); await evaluate('__sfTest.setCredential("fixture-record"); true'); await open(); await waitFor(`${panel}.textContent.includes('正文已在本地准备好')`); passed('限制脚本来源、禁用页面网络的 CSP 夹具可提取（GM 仍为模拟）');
  await browser('open', httpBase + '/article'); await open(); assert.equal(await evaluate(`${panel}.querySelector('#sf-api-key').disabled`), true); passed('HTTP 页面禁止密钥输入');
  const errors = await browser('errors'); assert.ok(!errors.includes('TypeError') && !errors.includes('ReferenceError'), errors);
  await browser('open', base + '/benchmark'); const benchmark = await evaluate('__sfBenchmark()');
  await writeFile('test-results/performance.json', JSON.stringify(benchmark, null, 2));
  passed(`10 万字符 / 2,000 文本节点，10 次提取 p95 = ${benchmark.p95.toFixed(1)} ms，原文与 Range 完整`);
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/browser.json', JSON.stringify({ adapter: 'mock-GM', browser: await evaluate('navigator.userAgent'), passed: checks, liveAPI: false, tampermonkeySandbox: false }, null, 2));
  console.log(`\n${checks.length} browser checks passed. GM transport is simulated; no live API requests.`);
} catch (error) {
  console.error(await browser('snapshot', '-i').catch(() => 'Snapshot unavailable'));
  console.error(await browser('errors').catch(() => 'Errors unavailable'));
  console.error((await panelText().catch(() => 'Panel unavailable')).slice(-1600));
  throw error;
} finally { await browser('close').catch(() => {}); server.close(); httpServer.close(); }
