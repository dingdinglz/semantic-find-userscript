import { build } from 'esbuild';
import { createServer } from 'node:https';
import { createServer as createHTTPServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile), dir = '.browser-test', session = `sf-test-${Date.now()}`;
await mkdir(dir, { recursive: true }); await mkdir('test-results', { recursive: true });
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
  // CLI 0.21.4 resolves CSS only in light DOM. Accessibility refs cross Shadow DOM.
  if (['click', 'fill', 'select'].includes(args[0])) {
    const selector = args[1]; let name: string | undefined;
    if (selector === '#sf-api-key') name = 'TypeSafe API Key';
    else if (selector === '#sf-scope') name = '默认检索范围';
    else if (selector === '#site-policy') name = '当前站点发送策略';
    else if (selector.startsWith('input[aria-label=')) name = '按意思查找的查询';
    else if (selector.startsWith('button:has-text(')) name = selector.slice(17, -2);
    else if (selector.startsWith('.result button')) name = `匹配 ${Number(/nth=(\d+)/u.exec(selector)?.[1] ?? 0) + 1}`;
    if (name) {
      const data = JSON.parse(await browser('snapshot', '-i', '--json')).data;
      const role = args[0] === 'fill' ? 'textbox' : args[0] === 'select' ? 'combobox' : 'button';
      const ref = Object.entries(data.refs as Record<string, { name: string; role: string }>).find(([, r]) => r.role === role && r.name.includes(name!))?.[0];
      if (!ref) throw new Error(`Missing accessible control ${name}: ${data.snapshot}`);
      args[1] = '@' + ref; await browser('scrollintoview', args[1]);
    }
  }
  const { stdout } = await exec('agent-browser', ['--session', session, ...args], { timeout: 40000, maxBuffer: 1024 * 1024 }); return stdout.trim();
}
async function evaluate<T = any>(code: string): Promise<T> { return JSON.parse(await browser('eval', code)); }
async function typeKeys(text: string): Promise<void> {
  // CLI 0.21.4 mis-sends printable keys; keyboard type inserts text without usable key events.
  // Use its isolated browser's CDP connection for real keydown/keypress/keyup with correct key codes.
  const socket = new WebSocket(await browser('get', 'cdp-url')); let nextId = 0;
  function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const receive = (event: MessageEvent) => {
        const message = JSON.parse(event.data); if (message.id !== id) return;
        clearTimeout(timer); socket.removeEventListener('message', receive);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      socket.addEventListener('message', receive); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    const { targetInfos } = await send('Target.getTargets');
    const target = targetInfos.find((t: { type: string; url: string }) => t.type === 'page' && t.url.startsWith(base));
    assert.ok(target, 'Missing browser fixture target');
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    for (const key of text) {
      const params = { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
      await send('Input.dispatchKeyEvent', { ...params, type: 'keyDown', text: key }, sessionId);
      await send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' }, sessionId);
    }
  } finally { socket.close(); }
}
const panel = `document.querySelector('[data-semantic-find-owned="panel"]').shadowRoot`;
async function panelText() { return evaluate<string>(`${panel}.textContent`); }
async function waitFor(code: string) {
  for (let i = 0; i < 50; i++) { if (await evaluate<boolean>(code)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${code}`);
}
const ready = () => waitFor(`${panel}.textContent.includes('搜索时提取')`);
const posts = () => evaluate<any[]>('__sfTest.calls.filter(c=>c.method==="POST")');
async function submit(query: string) { await browser('fill', 'input[aria-label="按意思查找的查询"]', query); await browser('press', 'Enter'); }
const checks: string[] = []; const passed = (name: string) => { checks.push(name); console.log(`✓ ${name}`); };
async function open() {
  // Invoke the registered mock menu; multi-modifier press is broken in installed CLI 0.21.4.
  await evaluate('__sfTest.menus["按意思查找"](); true');
  await waitFor('!!document.querySelector("[data-semantic-find-owned=panel]")');
}
try {
  await browser('--ignore-https-errors', 'open', base + '/article'); await open();
  assert.equal(await evaluate('__sfTest.traversals'), 0); assert.equal(await evaluate('__sfTest.calls.length'), 0); passed('未配置 Key：只打开设置，不遍历、不联网');
  await browser('fill', '#sf-api-key', ''); await typeKeys('si');
  assert.equal(await evaluate(`${panel}.querySelector('#sf-api-key').value`), 'si');
  assert.deepEqual(await evaluate('__sfTest.pageKeys'), []);
  await browser('press', 'Tab'); assert.equal(await evaluate(`${panel}.activeElement.textContent`), '显示');
  passed('设置中真实输入 s / i 不触发页面快捷键，Tab 仍可切换焦点');
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
  await browser('click', 'button:has-text("返回搜索")'); await ready();
  assert.equal((await posts()).length, 0); assert.equal(await evaluate(`${panel}.querySelectorAll('select').length`), 0);
  assert.equal(await evaluate('__sfTest.traversals'), 0);
  assert.ok(!(await panelText()).includes('重新提取')); passed('默认全页范围；返回搜索不提取、不推理，搜索页没有范围选择和手动提取');
  await browser('fill', 'input[aria-label="按意思查找的查询"]', ''); await typeKeys('si');
  assert.equal(await evaluate(`${panel}.querySelector('input').value`), 'si');
  assert.deepEqual(await evaluate('__sfTest.pageKeys'), []);
  await evaluate('document.querySelector("#append").focus(); true'); await typeKeys('s');
  assert.ok(await evaluate('__sfTest.pageKeys.some(e => e.type === "keydown" && e.key === "s")'));
  passed('搜索框真实输入 s / i 不触发页面快捷键，面板外快捷键保持有效');
  await browser('fill', 'input[aria-label="按意思查找的查询"]', '没有把握在哪里');
  await evaluate(`${panel}.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true})); true`);
  assert.equal((await posts()).length, 0);
  await browser('press', 'Enter'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  const calls = await posts(); assert.ok(calls.length > 1);
  const shared = JSON.parse(calls[0].data).state.document;
  for (const call of calls) {
    assert.equal(call.url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(call.anonymous, true); assert.equal(call.redirect, 'error'); assert.equal(call.referer, '');
    assert.ok(!call.data.includes('SECRET_')); assert.ok(!call.data.includes('browser-test-placeholder')); assert.ok(!call.data.includes(base));
    const body = JSON.parse(call.data); assert.deepEqual(body.state.document, shared);
    assert.deepEqual(Object.keys(body.questions), body.state.candidates.map((id: string) => `match_${id}`));
  }
  assert.ok(Object.values(shared).some((p: any) => p.text === 'Python'));
  assert.ok(!(await panelText()).includes('确认发送范围')); passed('真实 Enter 直接搜索，每批使用全范围共享上下文；出站字段边界通过');
  assert.ok(await evaluate('CSS.highlights.size > 0')); assert.equal(await evaluate('document.querySelectorAll("article mark").length'), 0);
  await browser('click', '.result button >> nth=0');
  assert.ok(await evaluate('Array.from(CSS.highlights.keys()).some(k=>k.endsWith("-current"))')); passed('CSS Highlight 生效且不包装原文节点');
  for (const [index, id] of [[2, 'repeat-a'], [3, 'repeat-b']] as const) {
    await browser('click', `.result button >> nth=${index}`);
    assert.equal(await evaluate('Array.from(CSS.highlights.get(Array.from(CSS.highlights.keys()).find(k=>k.endsWith("-current"))))[0].startContainer.parentElement.id'), id);
  }
  passed('同样原文出现在两处时，各自定位到正确节点');
  const countBeforeRefresh = (await posts()).length, traversalsBeforeRefresh = await evaluate('__sfTest.traversals');
  const resultsBeforeRefresh = await evaluate(`${panel}.querySelectorAll('.result').length`);
  const highlightsBeforeRefresh = await evaluate('CSS.highlights.size');
  await browser('click', '#append'); await new Promise(r => setTimeout(r, 350));
  assert.equal(await evaluate('CSS.highlights.size'), highlightsBeforeRefresh);
  assert.equal(await evaluate(`${panel}.querySelectorAll('.result').length`), resultsBeforeRefresh);
  assert.equal(await evaluate('__sfTest.traversals'), traversalsBeforeRefresh);
  assert.equal((await posts()).length, countBeforeRefresh); passed('追加正文保留旧结果和有效高亮，不自动提取或推理');
  await submit('Python 的用法'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  assert.ok(Object.values(JSON.parse((await posts()).at(-1)!.data).state.document).some((p: any) => p.text.startsWith('追加：')));
  assert.equal(await evaluate('__sfTest.traversals'), traversalsBeforeRefresh + 1); passed('再次主动搜索前刷新快照，新增正文进入本次共享上下文');
  await browser('click', '.result button >> nth=0');
  assert.equal(await evaluate('Array.from(CSS.highlights.get(Array.from(CSS.highlights.keys()).find(k=>k.endsWith("-current"))))[0].startContainer.parentElement.closest("a").id'), 'python-nav');
  assert.equal(await evaluate('location.pathname'), '/article'); passed('Python 用法查询可定位侧边栏 Python 原文，不自动打开链接（模拟语义响应）');
  await evaluate(`const clock=document.createElement('p'); document.querySelector('article').append(clock);
    __sfTest.ticks=0; __sfTest.delay=350; __sfTest.ticker=setInterval(()=>{clock.textContent='Live tick '+(++__sfTest.ticks)},20); true`);
  const dynamicTraversals = await evaluate('__sfTest.traversals'), dynamicAborts = await evaluate('__sfTest.aborts');
  await submit('dynamic'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  const stableResults = await evaluate(`${panel}.querySelector('.results').textContent`);
  await new Promise(r => setTimeout(r, 350));
  assert.equal(await evaluate(`${panel}.querySelector('.results').textContent`), stableResults);
  assert.equal(await evaluate('__sfTest.traversals'), dynamicTraversals + 1);
  assert.equal(await evaluate('__sfTest.aborts'), dynamicAborts);
  assert.ok(await evaluate('__sfTest.ticks > 10'));
  await evaluate('clearInterval(__sfTest.ticker); __sfTest.delay=80; true'); passed('页面持续每 20ms 变化仍能开始、完成搜索，并保留结果');
  const countBeforeReplace = (await posts()).length;
  await browser('click', '#replace'); await browser('click', '.result button >> nth=1');
  assert.ok((await panelText()).includes('搜索结果已保留'));
  assert.equal(await evaluate(`${panel}.querySelector('.results').textContent`), stableResults);
  assert.equal(await evaluate('__sfTest.traversals'), dynamicTraversals + 1);
  assert.equal((await posts()).length, countBeforeReplace);
  await browser('click', '.result button >> nth=2');
  assert.ok((await panelText()).includes('已定位')); passed('原文替换后仅提示无法定位，旧结果仍可阅读，其他片段继续定位');
  await evaluate('__sfTest.status=422; true'); await submit('resume'); await waitFor(`${panel}.textContent.includes('检索未完成')`);
  const resumeContext = JSON.parse((await posts()).at(-1)!.data).state.document, resumeTraversals = await evaluate('__sfTest.traversals');
  await evaluate('__sfTest.status=200; true'); await browser('click', '#append'); await browser('click', 'button:has-text("继续检查未完成部分")');
  await waitFor(`${panel}.textContent.includes('已检查全部')`);
  assert.equal(await evaluate('__sfTest.traversals'), resumeTraversals);
  assert.deepEqual(JSON.parse((await posts()).at(-1)!.data).state.document, resumeContext); passed('继续检查按钮复用原快照，不因页面新增内容重新提取');
  await submit('uncertain'); await waitFor(`${panel}.textContent.includes('没有确定匹配')`);
  const probabilities = await evaluate<number[]>(`Array.from(${panel}.querySelectorAll('.uncertain .probability'),p=>parseFloat(p.textContent.replace('匹配概率 ','')))`);
  assert.ok(probabilities.length > 2); assert.deepEqual(probabilities, [...probabilities].sort((a, b) => b - a));
  await browser('screenshot', 'test-results/search-panel.png'); passed('待确认片段展示概率并按降序排列');
  await browser('click', 'button:has-text("设置")'); await browser('select', '#sf-scope', 'article'); await browser('click', 'button:has-text("保存普通设置")');
  await browser('click', 'button:has-text("返回搜索")'); await ready(); await browser('press', 'Escape'); await open(); await ready();
  assert.ok((await panelText()).includes('范围：仅当前正文'));
  await submit('Python 的用法'); await waitFor(`${panel}.textContent.includes('在本次检索范围内没有找到匹配片段')`);
  assert.ok(!Object.values(JSON.parse((await posts()).at(-1)!.data).state.document).some((p: any) => p.text === 'Python'));
  passed('设置中的范围持久保存，重新打开无需选择，正文模式不发送侧边栏');
  await browser('click', 'button:has-text("设置")'); await browser('select', '#sf-scope', 'selection'); await browser('click', 'button:has-text("保存普通设置")'); await browser('press', 'Escape');
  await evaluate('const r=document.createRange();r.selectNodeContents(document.querySelector("#python-nav"));getSelection().removeAllRanges();getSelection().addRange(r);true');
  await open(); await ready(); await submit('Python 的用法'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  const selected = Object.values(JSON.parse((await posts()).at(-1)!.data).state.document) as { text: string; headingPath: string[] }[];
  assert.deepEqual(selected.map(p => p.text), ['Python']); assert.deepEqual(selected[0].headingPath, []); passed('选区模式只发送选区内容，不泄露全页或邻文');
  await browser('click', 'button:has-text("设置")'); await browser('select', '#sf-scope', 'loaded-page'); await browser('select', '#site-policy', 'disabled'); await browser('click', 'button:has-text("保存普通设置")');
  const disabledTraversals = await evaluate('__sfTest.traversals'), disabledCalls = (await posts()).length;
  await browser('click', 'button:has-text("返回搜索")'); await submit('disabled');
  assert.equal(await evaluate('__sfTest.traversals'), disabledTraversals); assert.equal((await posts()).length, disabledCalls); passed('禁用站点仍禁止提取和发送');
  await browser('click', 'button:has-text("设置")'); await browser('select', '#site-policy', 'allow'); await browser('click', 'button:has-text("保存普通设置")'); await browser('click', 'button:has-text("返回搜索")'); await ready();
  await evaluate('__sfTest.delay=700; __sfTest.ignoreAbort=true; true'); await submit('first');
  await browser('press', 'Escape'); await new Promise(r => setTimeout(r, 850));
  assert.equal(await evaluate('!!document.querySelector("[data-semantic-find-owned=panel]")'), false); assert.equal(await evaluate('CSS.highlights.size'), 0); passed('关闭后即使 abort 无效，迟到响应也不恢复面板或高亮');
  await open(); await ready(); await evaluate('__sfTest.delay=80; __sfTest.ignoreAbort=false; true');
  await submit('absence'); await waitFor(`${panel}.textContent.includes('在本次检索范围内没有找到匹配片段')`); passed('仅完整有效扫描才显示范围内无匹配');
  const beforeRoute = (await posts()).length, traversalsBeforeRoute = await evaluate('__sfTest.traversals');
  await browser('click', '#route'); await ready();
  assert.equal(await evaluate('CSS.highlights.size'), 0); assert.equal((await posts()).length, beforeRoute);
  assert.equal(await evaluate('__sfTest.traversals'), traversalsBeforeRoute);
  await submit('route'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  assert.ok(Object.values(JSON.parse((await posts()).at(-1)!.data).state.document).some((p: any) => p.text === '另一篇文章')); passed('SPA 导航停止旧任务但不自动提取，下一次主动查询读取新页面');
  await evaluate('__sfTest.delay=700; __sfTest.ignoreAbort=true; true'); await submit('remote');
  await evaluate('__sfTest.setCredential(null); true'); await new Promise(r => setTimeout(r, 850));
  assert.equal(await evaluate('CSS.highlights.size'), 0); assert.equal(await evaluate(`${panel}.querySelectorAll('.result').length`), 0); passed('模拟远端标签页清除 Key，旧队列及响应失效');
  await browser('open', base + '/fallback'); await evaluate('__sfTest.setCredential("fixture-record"); true'); await open(); await ready();
  await submit('find'); await waitFor(`${panel}.textContent.includes('已检查全部')`);
  await browser('click', '.result button >> nth=0'); await waitFor('!!document.querySelector("[data-semantic-find-owned=overlay]")'); passed('不支持 CSS Highlight 时使用当前项覆盖层');
  await browser('open', base + '/csp'); await evaluate('__sfTest.setCredential("fixture-record"); true'); await open(); await ready(); await submit('find'); await waitFor(`${panel}.textContent.includes('已检查全部')`); passed('限制脚本来源、禁用页面网络的 CSP 夹具可提取（GM 仍为模拟）');
  await browser('open', httpBase + '/article'); await open(); assert.equal(await evaluate(`${panel}.querySelector('#sf-api-key').disabled`), true); passed('HTTP 页面禁止密钥输入');
  const errors = await browser('errors'); assert.ok(!errors.includes('TypeError') && !errors.includes('ReferenceError'), errors);
  await browser('open', base + '/benchmark'); const benchmark = await evaluate('__sfBenchmark()');
  await writeFile('test-results/performance.json', JSON.stringify(benchmark, null, 2));
  passed(`10 万字符 / 2,000 文本节点，10 次提取 p95 = ${benchmark.p95.toFixed(1)} ms，原文与 Range 完整`);
  await writeFile('test-results/browser.json', JSON.stringify({ adapter: 'mock-GM', browser: await evaluate('navigator.userAgent'), passed: checks, liveAPI: false, tampermonkeySandbox: false }, null, 2));
  console.log(`\n${checks.length} browser checks passed. GM transport is simulated; no live API requests.`);
} catch (error) {
  console.error(await browser('snapshot', '-i').catch(() => 'Snapshot unavailable'));
  console.error(await browser('errors').catch(() => 'Errors unavailable'));
  console.error((await panelText().catch(() => 'Panel unavailable')).slice(-1600)); throw error;
} finally { await browser('close').catch(() => {}); server.close(); httpServer.close(); }
