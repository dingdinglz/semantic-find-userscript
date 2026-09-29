# 按意思查找

按自然语言查找当前网页的**原文段落**，不生成回答或摘要。桌面 Chrome / Edge + Tampermonkey，TypeSafe Jev 直连，无后端、运行时 CDN 或共享密钥。

**[直接安装油猴脚本](https://raw.githubusercontent.com/dingdinglz/semantic-find-userscript/main/dist/semantic-find.user.js)** · [查看构建产物](dist/semantic-find.user.js)

当前为首版实现，自动化测试使用模拟 GM / API；真实 Tampermonkey 安装、出站请求头和模型质量尚未验收。不要据此宣称中文检索质量达标。详见 [验收记录](docs/validation.md)。

## 安装与使用

1. 安装 **Tampermonkey 5.4 或更新版本**。在浏览器扩展详情中允许它访问目标网站；若浏览器要求，开启“允许用户脚本”或开发者模式。受限页面、扩展商店和浏览器内置 PDF 不支持。
2. 点击上方“直接安装油猴脚本”，在 Tampermonkey 提示中确认安装。若没有弹出提示，在 Tampermonkey 中新建脚本，用 `dist/semantic-find.user.js` 的**全部内容**替换编辑器内容并保存。
3. 在自己信任的 **HTTPS 页面**，从油猴菜单打开“设置 API Key”，填写自己从 [TypeSafe 控制台](https://console.typesafe.ai) 获取的 Key。可先测试连接；测试只请求模型列表。保存不搜索、不发送网页正文。
4. 油猴菜单选择“按意思查找”，或按 **Ctrl+Shift+F / macOS Cmd+Shift+F**。快捷键冲突时使用菜单；原生 Ctrl / Cmd+F 默认不接管。
5. 检查范围和段落数，输入查询、按 Enter，查看发送预览并确认。没有可靠正文根节点时，主动选择“已加载页面文本”或先选中一段文字再打开面板。
6. 点击片段或上一处 / 下一处回到原文。停止后可以继续未完成部分；关闭面板会取消任务并释放正文、结果和自有高亮。

只检索已加载、可读取的文本，不自动展开、翻页或滚动加载。iframe、Shadow DOM 正文、图片、Canvas 和 PDF 不提取。页面改变后旧结果失效，需要重新提取。选区只使用选区内的文本与上下文。

设置支持快捷键、原生查找接管开关、定位顶栏间距、当前站点每次询问 / 记住主动检索授权 / 禁用。邮箱等疑似敏感环境仍每次确认；自动识别不可能覆盖所有敏感页面。可用菜单恢复已禁用站点。

## 密钥与隐私

- Key 保存在脚本专属 GM 存储，不写进发布文件、网页 localStorage、日志或普通设置导出。保存后不回填输入框，清除 Key 不等于在账户中撤销 Key。
- GM 存储不是加密保险箱，Shadow DOM 和密码框不是安全隔离。恶意网页可能观察输入，恶意脚本更新可能读取已保存 Key。只从可信来源安装和更新，只在信任的页面配置 Key。
- 查询、目标原文、标题和邻文直接发送到固定 `https://api.typesafe.ai/v1/systemone`。没有第三方代理、遥测或维护者后台。Key 仅用于该官方服务的 Authorization 请求头。
- 请求要求匿名模式、拒绝重定向，并显式设置空 Referer。旧版 / 无法识别的脚本管理器会被阻止发送。**真实浏览器的自动请求头及沙箱行为仍需按验收清单验证。**
- 正文和判断只在当前标签页内存缓存，最多 10 组 / 5 MB；关闭、导航、凭据变化后释放。GM 只保存凭据、验证记录 ID、普通设置和站点授权。
- 使用你自己的 TypeSafe 额度。取消、超时、重试可能仍计费；显示的 usage 不是完整账单。TypeSafe 表示不以客户请求训练模型，但不代表所有套餐零留存，见 [官方法律条款](https://docs.typesafe.ai/legal)。

## 开发

只开发机需要 Node.js **22.18+**；脚本使用者不需要 Node.js、环境变量或部署服务。

```sh
npm ci
npm run check          # 类型检查 + 单元测试 + 单文件构建
npm run test:browser   # agent-browser + Chromium + openssl；本地 HTTPS，模拟 GM，无实际 API 调用
npm run evaluate       # 校验评测种子集，不调用模型、不伪造质量指标
```

浏览器测试需要事先安装 `agent-browser` 及其 Chromium（`agent-browser install`）。测试脚本用独立会话、本地自签名证书，不连接你的日常浏览器；截图及结果写入被 Git 忽略的 `test-results/`。当前 CLI 0.21.4 的组合键有缺陷，浏览器测试使用模拟油猴菜单打开面板，快捷键另有单元测试。

```text
src/userscript/extract/     正文范围、TextSlice、切分、Range、变更观察
src/userscript/settings/    独立凭据、版本、跨标签页监听、普通设置
src/userscript/transport/   固定地址 GM 网络、手动超时、取消
src/userscript/typesafe/    固定 Noul 模板、严格响应校验、单层重试
src/userscript/search/      保守预算分批、双并发、生命周期、内存缓存
src/userscript/highlight/   CSS Highlight / 当前项矩形降级
src/userscript/ui/          Shadow DOM 面板、发送预览、结果、设置
src/shared/                类型与安全错误
scripts/                   构建、真实浏览器测试、离线评测
tests/fixtures/             静态文章、列表、表格、动态页面等夹具
tests/evaluation/           待人工复核的种子标注及离线指标
```

模型固定 `jev-1.13.0`，提示版本 `target-noul-1`，阈值为 ≥0.80 匹配、(0.20, 0.80) 待确认。阈值尚未经过真实标注集调优。升级模型 / 提示 / 切分后必须重跑评测，不能沿用旧质量结论。

发布时保持 `@name`、`@namespace` 和 GM 键名不变，以便就地更新保留配置。正式发布前完成 [验收清单](docs/validation.md) 与 [语义评测说明](tests/evaluation/README.md)。
