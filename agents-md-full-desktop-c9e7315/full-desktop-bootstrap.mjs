import { connectAcceptance } from './full-desktop-connection.mjs';
const { page, info, pid } = await connectAcceptance();
if (info.mode === 'signed-out') {
  // Test-only profile setup, not login/consent acceptance: no cloud account or agreement record.
  await page.evaluate(() => window.electronAPI.authEnterLocal());
  await page.reload();
  await page.waitForFunction(async () => (await window.electronAPI.authInitialize()).mode === 'local');
}
const config = {
  id: 'agents-md-acceptance', name: 'AGENTS.md 本地验收', auth: { method: 'none' },
  runtimes: {
    'claude-code': { baseUrl: 'http://127.0.0.1:52980', wireProtocol: 'anthropic-messages', models: [{ id: 'claude-sonnet-4-5', name: '本地验收 Claude', contextWindow: 200000, defaultEnabled: true, reasoning: false }] },
    codex: { baseUrl: 'http://127.0.0.1:52980/v1', wireProtocol: 'openai-responses', models: [{ id: 'gpt-5.4', name: '本地验收 Codex', contextWindow: 200000, defaultEnabled: true, reasoning: false }] },
  },
};
console.log(JSON.stringify({ pid, configResult: await page.evaluate((config) => window.electronAPI.maker.createCustomProvider(config, {}), config) }));
await page.reload();
await page.getByRole('button', { name: '新建', exact: true }).first().click();
await page.waitForURL(/cc-agent\/new/);
console.log('NEW_TASK_URL', page.url());
console.log((await page.locator('body').innerText()).slice(0, 7000));
console.log(JSON.stringify(await page.locator('button,input,[contenteditable=true]').evaluateAll((nodes) => nodes.map((n) => ({ tag: n.tagName, text: n.textContent?.slice(0,100), label: n.getAttribute('aria-label'), placeholder: n.getAttribute('placeholder'), testId: n.getAttribute('data-testid') }))), null, 2));
process.exit(0);
