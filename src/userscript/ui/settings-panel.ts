import { button, element } from '../../shared/utils';
import { safeMessage } from '../../shared/errors';
import { Credentials, credentialLabel, readCredential, cleanKey } from '../settings/credentials';
import { preferences, savePreferences, exportPreferences, importPreferences } from '../settings/preferences';
import { MODEL } from '../typesafe/prompts';
import { TypeSafeClient } from '../typesafe/client';
export class SettingsPanel {
  readonly node = element('div');
  private key = element('input'); private state = element('p', '', 'notice'); private message = element('p', '', 'status');
  private testButton: HTMLButtonElement; private showButton: HTMLButtonElement;
  private testing?: AbortController; private version = 0; private verifiedDraft?: string;
  private unsubscribe: () => void;
  constructor(private credentials: Credentials, private client: TypeSafeClient, private back: () => void, private preferencesChanged: () => void) {
    const secure = location.protocol === 'https:';
    const label = element('label', 'TypeSafe API Key'); this.key.id = 'sf-api-key'; label.htmlFor = this.key.id;
    this.key.type = 'password'; this.key.autocomplete = 'off'; this.key.spellcheck = false; this.key.setAttribute('autocapitalize', 'off'); this.key.setAttribute('autocorrect', 'off'); this.key.placeholder = '粘贴 Key；已配置时可输入新 Key 替换'; this.key.disabled = !secure;
    this.key.addEventListener('input', () => { this.invalidateTest(); this.message.textContent = ''; this.refresh(); });
    this.key.addEventListener('keydown', event => { if (event.key === 'Enter') { event.stopPropagation(); if (event.isTrusted && !event.isComposing) { event.preventDefault(); this.save(); } } });
    this.showButton = button('显示', () => { this.key.type = this.key.type === 'password' ? 'text' : 'password'; this.showButton.textContent = this.key.type === 'text' ? '隐藏' : '显示'; });
    this.showButton.disabled = !secure;
    const row = element('div', undefined, 'row'); row.append(this.key, this.showButton);
    this.testButton = button('测试连接', () => void this.test());
    const save = button('保存 Key', () => this.save()); save.disabled = !secure;
    const clear = button('清除密钥', () => {
      if (!confirm('清除这份脚本保存的 API Key？将停止所有标签页的旧检索。在 TypeSafe 中撤销 Key 仍需到控制台操作。')) return;
      this.invalidateTest(); this.credentials.clear(); this.key.value = ''; this.refresh(); this.message.textContent = '已清除本地密钥；已发送的请求无法收回。';
    }); clear.className = 'danger';
    const actions = element('div', undefined, 'row'); actions.append(this.testButton, save, clear);
    const consoleLink = element('a', '前往 TypeSafe 控制台获取 Key'); consoleLink.href = 'https://console.typesafe.ai'; consoleLink.target = '_blank'; consoleLink.rel = 'noopener noreferrer';
    this.message.setAttribute('role', 'status');
    this.node.append(label, row, this.state, actions, this.message,
      element('p', '测试只检查 API 连接，不读取或发送网页正文。测试草稿不会自动保存。', 'muted'),
      element('p', `服务：https://api.typesafe.ai\n模型：${MODEL}\n安全请求要求 Tampermonkey 5.4+。`, 'muted'),
      element('p', 'Key 保存在 Tampermonkey 脚本存储（非加密保险箱）。正文直接发送给 TypeSafe，费用由你的账户承担。密码框和 Shadow DOM 不能阻止恶意网页观察输入；请只在信任的 HTTPS 页面通过油猴菜单配置 Key。', 'notice warning'), consoleLink);
    if (!secure) this.node.prepend(element('p', 'HTTP 页面禁止输入密钥。请在你信任的 HTTPS 页面打开脚本设置。', 'notice warning'));
    this.buildPreferences();
    this.node.append(button('返回搜索（不自动提交）', back));
    this.unsubscribe = credentials.subscribe(() => { this.invalidateTest(); this.key.value = ''; this.refresh(); this.message.textContent = '凭据已变更，旧测试和检索已停止。'; });
    this.refresh();
  }
  private refresh(): void {
    this.state.textContent = `当前状态：${credentialLabel()}`;
    this.testButton.disabled = !!this.testing || (!this.key.value.trim() && !readCredential());
    this.testButton.textContent = this.testing ? '正在测试…' : this.key.value.trim() ? '测试草稿（不保存）' : '测试已保存的 Key';
  }
  private invalidateTest(): void { this.version++; this.testing?.abort(); this.testing = undefined; this.verifiedDraft = undefined; }
  private save(): void {
    if (location.protocol !== 'https:') return;
    try {
      const key = cleanKey(this.key.value), verified = this.verifiedDraft === key;
      this.credentials.save(key, verified); this.key.value = ''; this.key.type = 'password'; this.showButton.textContent = '显示'; this.invalidateTest(); this.refresh();
      this.message.textContent = `已保存${verified ? '，连接已验证' : '，尚未验证'}。保存不会触发搜索。`;
    } catch (error) { this.message.textContent = safeMessage(error); }
  }
  private async test(): Promise<void> {
    if (this.testing) return;
    let draft: string | undefined;
    try { draft = this.key.value ? cleanKey(this.key.value) : undefined; } catch (e) { this.message.textContent = safeMessage(e); return; }
    const record = draft ? undefined : readCredential();
    if (!draft && !record) return;
    const version = ++this.version, abort = new AbortController(); this.testing = abort; this.refresh();
    this.message.textContent = draft ? '正在测试未保存的草稿…' : '正在测试已保存的 Key…';
    try {
      await this.client.testConnection(draft ?? record!.apiKey, abort.signal);
      if (version !== this.version || abort.signal.aborted) return;
      if (draft) this.verifiedDraft = draft; else if (record) this.credentials.verify(record.id);
      this.message.textContent = '连接成功，可读取模型列表。此结果不保证推理额度充足。';
    } catch (error) { if (version === this.version) this.message.textContent = safeMessage(error); }
    finally { if (version === this.version) { this.testing = undefined; this.refresh(); } draft = undefined; }
  }
  private buildPreferences(): void {
    const prefs = preferences(), details = element('details'); details.append(element('summary', '快捷键、站点与普通设置'));
    const shortcut = element('input'); shortcut.value = prefs.shortcut; shortcut.id = 'sf-shortcut';
    const label = element('label', '快捷键（如 Mod+Shift+F，Mod 随系统使用 Ctrl / Cmd）'); label.htmlFor = shortcut.id;
    const takeover = element('input'); takeover.type = 'checkbox'; takeover.checked = prefs.takeoverFind;
    const takeoverLabel = element('label'); takeoverLabel.append(takeover, document.createTextNode(' 主动接管原生 Ctrl / Cmd+F'));
    const margin = element('input'); margin.type = 'number'; margin.min = '0'; margin.max = '400'; margin.value = String(prefs.scrollMargin); margin.id = 'sf-margin';
    const marginLabel = element('label', '固定顶栏预留间距（px）'); marginLabel.htmlFor = margin.id;
    const site = element('select'); site.setAttribute('aria-label', '当前站点发送策略');
    for (const [value, text] of [['ask', '当前站点：每次询问'], ['allow', '当前站点：记住主动检索授权'], ['disabled', '当前站点：永久禁用检索']]) { const option = element('option', text); option.value = value; site.append(option); }
    site.value = prefs.sites[location.origin] ?? 'ask';
    const save = () => {
      try {
        const latest = preferences();
        savePreferences({ ...latest, shortcut: shortcut.value.trim(), takeoverFind: takeover.checked, scrollMargin: Number(margin.value), sites: { ...latest.sites, [location.origin]: site.value as 'ask' | 'allow' | 'disabled' } });
        this.message.textContent = '普通设置已保存，Key 未修改。'; this.preferencesChanged();
      } catch { this.message.textContent = '设置格式不正确。快捷键示例 Mod+Shift+F，间距须为 0–400。'; }
    };
    details.addEventListener('keydown', event => { if (event.key === 'Enter' && event.isTrusted && !event.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); save(); } });
    const json = element('textarea'); json.setAttribute('aria-label', '普通设置 JSON（不含 Key）'); json.placeholder = '普通设置导入 / 导出，不含 Key 或正文';
    const controls = element('div', undefined, 'row'); controls.append(button('保存普通设置', save), button('预览设置导出', () => { json.value = exportPreferences(); }), button('导入普通设置', () => {
      try { importPreferences(json.value); this.preferencesChanged(); this.message.textContent = '设置已导入，Key 未修改；重新打开设置可查看。'; }
      catch { this.message.textContent = '导入失败：只接受普通设置，不接受凭据或未知字段。'; }
    }));
    details.append(label, shortcut, takeoverLabel, marginLabel, margin, site, controls, json); this.node.append(details);
  }
  dispose(): void { this.invalidateTest(); this.key.value = ''; this.key.type = 'password'; this.unsubscribe(); this.node.remove(); }
}
