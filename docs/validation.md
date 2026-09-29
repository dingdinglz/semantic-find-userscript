# 首版实现与验收记录

## 已实现

- 单个 IIFE 油猴产物，无后端或运行时 CDN；固定 TypeSafe origin、GET models、POST systemone、逐目标 Noul、模型与提示版本固定。
- 正文 / 选区 / 主动选择全页已加载文本；隐藏与表单排除、段落 / 引用 / 列表 / 表格 / 代码、UTF-16 切片、长段切分、不按文本内容去重。
- 本地原文预览、按站点授权与禁用；API Key 独立存储、草稿验证、遮罩、不回填、明确清除、跨标签页变更取消。
- ≤16 段且服从 UTF-8 保守预算、双并发、渐进进度、45 秒等待预算、12 秒单次超时、单层有限重试、Retry-After、继续未完成部分。
- CSS Highlight 与当前结果矩形降级、重复文本分别定位、嵌套滚动、减少动态效果、关闭清理与焦点恢复。
- 文本变化即时失效、URL 监听与轮询、旧响应丢弃、内存缓存上限、语义结果 / 待确认 / 不完整分开呈现。

## 自动化验证

运行环境：Node.js 24.14.0、Vitest / jsdom、agent-browser 0.21.4、macOS ARM64、Headless Chrome 147。GM 存储与 API 在浏览器测试中由**测试专用适配器模拟**，从不打包到 `dist/`，没有使用真实 Key。

命令：

```sh
npm run check
npm run test:browser
npm run evaluate
```

- 类型检查及构建通过。
- 61 项单元测试：选区边界、Emoji / 空白 / 隐藏切片、重复锚点、切分覆盖、响应字段、非法概率、预算、取消、并发、重试、凭据、缓存、动态 DOM、高亮、快捷键、离线指标。
- 18 项浏览器检查：真实输入 / 点击 / Enter、发送授权、纯连接测试、草稿变更失效、Key 保存不触发搜索、不回填、重复文本分别定位、跨标签页变更模拟、迟到响应、SPA、灰区 / 无匹配、CSS Highlight 与降级、HTTP Key 禁用；详见本地 `test-results/browser.json`。
- 约 10 万 UTF-16 字符、2,000 个 Text 节点、10 次本地提取，三轮已记录 p95 **139.6–146.8 ms**；每次都核对 2,000 段和全部 Range 原文，未裁剪尾部。机器负载会影响结果，以重跑的 `test-results/performance.json` 为准。
- `npm run evaluate`：18 组种子 / 7 组无答案，状态 **not-evaluated**。尚未人工复核至 120 组，也未测真实 Jev，不能报告准确率达标。

浏览器截图位于 `test-results/search-panel.png`。测试采用真实浏览器 DOM / CSS Highlight，但**不等于 Tampermonkey 沙箱验收**。CLI 的多修饰键发送异常，打开面板用测试适配器注册的菜单回调；真实快捷键冲突和 IME 需人工实装复核。CSP 自动化夹具限制脚本来源和页面网络，但允许内联样式；更严格的 `style-src` 仍待实装测试。

## 发布前必须实测（当前未完成）

在桌面 Chrome、Edge 分别安装 `dist/semantic-find.user.js`，记录浏览器 / Tampermonkey 版本：

- [ ] 新装、未配置、测试但未保存、保存未验证、草稿验证失效、错误 Key、清除后刷新、就地更新后配置保留。
- [ ] 扩展用户脚本开关、网站访问权限、官方 API 的跨域连接授权；受限页面明确不支持。
- [ ] GET models 实际请求不携带正文；POST 只发送预览中的允许字段。
- [ ] 在扩展背景网络面板检查真实自动请求头：无页面 Referer / Cookie，Key 只在固定官方地址的 Authorization 中。不要把含 Key 的 HAR 或截图提交到仓库。
- [ ] 使用**非真实 Key**和受控测试环境验证拒绝重定向；不得为了测试把真实凭据发送给非官方 origin。确认 `anonymous + fetch + redirect:error` 的组合没有兼容回退。
- [ ] 手动超时、GM abort、浏览器断网、429 / 529、Retry-After、已发送请求可能计费的文案。
- [ ] 两个真实标签页：替换 / 清除 Key 中止旧队列和退避，迟到响应不显示，测试草稿不会验证另一记录。
- [ ] 真实 `@sandbox DOM` 下共享 Highlight registry、生效的文档级样式；关闭不删除网页自己的 Highlight。
- [ ] 严格 CSP（不允许内联样式）、图片 / 字体引发布局变化、固定顶栏、嵌套滚动及 CSS Highlight 不可用时的降级。
- [ ] Cmd / Ctrl+Shift+F、修改快捷键、保留原生查找、输入法组合输入、面板外编辑区域、Esc 与焦点恢复。
- [ ] 文章替换、标题变化、无限滚动追加、路由改变，旧结果列表 / 高亮无残留。
- [ ] 120 组人工标注，按文章划分调参集与锁定测试集；≥40 组无答案，中文 / 英文 / 跨语言分别报告；真实网络首批 / 全量耗时、usage 与费用。

在上述隐私与沙箱项通过前，产物仅应作试用 / 验收版，不应标为已完成正式发布验收。

## 与方案的具体实现选择

1. 元数据额外申请只读 `GM_info`，联网前要求 **Tampermonkey ≥5.4**。官方文档注明 `redirect` 自 build 6180 支持，本实现采用更保守的新版本门槛，不对旧版携带真实 Key 试探。
2. 使用空 `Referer` 请求头 + anonymous + 拒绝重定向；`finalUrl` 校验仅作补充，不能代替前置拒绝。实际环境检查仍不可省略。
3. 对相关正文变化保守地使**整个快照**失效，而非增量重算部分判断；不自动上传新增内容。纯布局属性变化若未改变可读取性，不重新推理。
4. 重锚定提供容器内唯一精确匹配 helper；用户定位路径不复活已失效判断，遇替换节点直接要求重新提取。没有模糊跳转。
5. 估算预算超限时在授权前细分快照；服务明确返回长度错误时由客户端进一步拆批。单一目标仍过长则细分原目标做独立判断，以任一子片段匹配为该原段落命中，结果仍引用原文，不生成坐标。只使用已预览正文，并受同一等待预算限制；普通 422 不拆分。
6. 使用“显示更多”分页式 DOM 渲染，每类初始 40 项；不为大列表一次创建所有结果节点。没有专门的虚拟滚动依赖。
7. 不提供正文诊断导出或远程日志。普通设置仅白名单字段可导入 / 导出，凭据字段一律拒绝。

当前正文识别是通用启发式，复杂网站、CSS 伪元素、视觉隐藏技巧和跨章节归属仍可能影响提取或语义判断。自动化成功不能证明任意网页都安全或可完整检索。

## 已核对的实时官方文档

- [TypeSafe API](https://docs.typesafe.ai/api)：请求 / 响应、Noul、usage、错误码。
- [Noul](https://docs.typesafe.ai/primitives/noul)、[Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find)：独立判断与无答案边界。
- [Models](https://docs.typesafe.ai/models)：`jev-1.13.0`、模型列表别名、上下文限制、中文效果须另测。
- [GM_xmlhttpRequest](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_xmlhttpRequest)：redirect、anonymous、fetch 模式超时限制与返回 abort 句柄。
- [sandbox](https://www.tampermonkey.net/documentation.php?locale=en&q=sandbox)、[GM_info](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_info)：DOM 环境回退与运行版本读取。
