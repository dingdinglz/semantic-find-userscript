# 语义评测

`cases.json` 是 **18 组种子标注草稿，尚需人工复核**，其中 7 组无答案。它不是方案要求的 120 组已验收标注集，也不能用来宣称达到 90% 精确率 / 85% 召回率。

覆盖中文、英文、中英跨语言、多个匹配、否定答案与属性检索的区别、作者 / 引用归属、取消前 / 后混淆、操作步骤、无答案和网页恶意指令。`articleId` 的调参集 / 测试集分组由校验器检查，同篇文章不能跨集合。

后续流程：

1. 人工复核每个 `expected`，为歧义或上下文不足的问题设置 `ambiguous: true`。
2. 扩充到至少 120 组（至少 40 组无答案），在调参前锁定按文章分组的测试集。
3. 使用与脚本相同的 `buildRequest(query, candidates, context)`、完整范围共享文本 / 超限分窗策略，对每个本地片段记录原始 Noul 值。补充导航入口、远距离上下文、窗口边界与选区案例。先用正文夹具检查提取与定位，再测模型，不能把提取遗漏计为模型完全检查后的无答案。
4. 记录实际返回的模型与提示版本。不要提交 API Key、Authorization、真实私密网页或账户信息。
5. 把判断写成如下数组；文件建议命名为 `predictions.local.json`（已被 Git 忽略）。下面仅是格式示意，数值不是实测结果：

```json
[
  {
    "caseId": "zh-research-1",
    "model": "jev-1.13.0",
    "promptVersion": "document-candidates-noul-2",
    "status": "complete",
    "values": { "b00001": 0.9, "b00002": 0.1, "b00003": 0.9 }
  }
]
```

```sh
npm run evaluate -- --predictions predictions.local.json --out report.local.json
# 使用人工扩充的集：
npm run evaluate -- --cases reviewed-cases.json --predictions predictions.local.json
```

该命令只离线统计，不读取 Key、不联网。缺失预测按未完成统计；`complete` 必须涵盖所有候选，非法概率 / 额外段落 ID / 重复 case 会拒绝。没有预测时只输出 `not-evaluated`，不把种子标签或模拟响应当成模型评测结果。

报告包含原始 TP / FP / 无答案误报 / 错误无匹配个数、精确率、召回率、待确认率、未完成比例和覆盖率，并按语言、页面类型、调参 / 测试集合分开统计。分母为零时使用 `null`，不伪造 100%。目前按查询统计失败 / 未完成，批次层故障率需真实调用日志另行汇总。

当前片段种子是纯文本最小案例，不能替代 DOM 提取测试、远距离章节推理评测或真实网页多样性测试。加入上下文案例时，应保存实际发送的完整 `document`、`candidates` 和问题模板用于复核；不能让另一模型成为唯一标注来源。
