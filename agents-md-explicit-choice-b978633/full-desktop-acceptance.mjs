import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connectAcceptance } from './full-desktop-connection.mjs';

const runDir = 'C:\\Users\\XD\\AppData\\Local\\Temp\\cindy-agents-md-desktop-7LoO5P';
const evidence = path.resolve('artifacts/agents-md-explicit-choice');
const stage = process.argv[2] ?? 'native';
let activePrompt = '';
const { page, info, pid } = await connectAcceptance();
assert.equal(info.mode, 'local');
const dirs = Object.fromEntries(['native', 'unknown', 'other', 'mixed', 'reverse', 'failure'].map((name) => [name, path.join(runDir, name)]));
if (stage === 'prepare') {
  await fs.mkdir(evidence, { recursive: true });
  for (const [name, dir] of Object.entries(dirs)) {
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(dir, 'AGENTS.md'), `# ${name} acceptance fixture\nReply LOCAL_ACCEPTANCE_OK. Do not call tools.\n`);
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), '{}');
    for (const file of ['CLAUDE.md', 'AGENTS.fixture-backup', '.mcp.json', '.claude/agents/acceptance.md']) {
      await fs.unlink(path.join(dir, file)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  console.log('PREPARED', runDir); process.exit(0);
}

async function openDraft(dir, vendor = 'cc') {
  if (page.url().includes('#/settings')) await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新建', exact: true }).first().click();
  await page.waitForURL(/cc-agent\/new/);
  // Final acceptance selects the registered fixture directory and runtime through
  // the production pickers. No draft store writes or migration/IPC substitutions.
  await page.getByTestId('create-agent-mode-pill').click();
  await page.getByRole('dialog').getByText(path.basename(dir), { exact: true }).click();
  const modelName = vendor === 'cc' ? '本地验收 Claude' : '本地验收 Codex';
  await page.getByRole('button', { name: /^选择模型/ }).click();
  await page.getByText(modelName, { exact: true }).last().click();
  await page.getByRole('button', { name: new RegExp(`^选择模型.*${modelName}`) }).waitFor();
  await page.getByTestId('create-agent-mode-pill').filter({ hasText: path.basename(dir) }).waitFor();
  const editor = page.locator('[contenteditable="true"]').first();
  activePrompt = `AGENTS acceptance: ${stage} ${Date.now()}. Reply LOCAL_ACCEPTANCE_OK; do not call tools.`;
  await editor.fill(activePrompt);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
const save = async (name) => {
  await page.screenshot({ path: path.join(evidence, `${name}.png`), timeout: 10000, animations: 'disabled' });
};
const record = async (result) => {
  await fs.appendFile(path.join(evidence, 'desktop-acceptance-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), stage, pid, build: info.version, inputSelection: 'production project/model pickers', ...result })+'\n');
  console.log(JSON.stringify(result));
};
const taskCreated = async () => {
  await page.waitForURL((url) => /#\/cc-agent\/(?!new(?:$|[/?]))/.test(url.href), { timeout: 30000 });
  await page.locator('[data-user-msg-id]').filter({ hasText: activePrompt }).waitFor({ timeout: 30000 });
};
const responseReady = () => page.locator('[data-message-client-id]:visible').getByText('LOCAL_ACCEPTANCE_OK', { exact: true }).first().waitFor({ timeout: 60000 });
const preferences = () => page.evaluate(() => window.electronAPI.maker.crossAgent.listSuppressedWorkspaces());
const isSuppressed = async (dir) => (await preferences()).includes(dir.toLowerCase());
const dialog = () => page.getByRole('alertdialog');
const instructionVisible = async () => {
  await dialog().waitFor({ timeout: 15000 });
  await dialog().getByText('AGENTS.md → CLAUDE.md', { exact: true }).waitFor();
};
const cancel = async () => {
  await dialog().getByRole('button', { name: '不要', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await taskCreated();
};
const openSettings = async () => {
  if (!page.url().includes('#/settings')) {
    await page.getByRole('button', { name: '菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  }
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.getByRole('tab', { name: '通用', exact: true }).click();
};
const restoreFromSettings = async (dir, prefix) => {
  await openSettings();
  const button = page.getByRole('button', { name: `恢复 ${dir.toLowerCase()} 的转换提示`, exact: true });
  await button.scrollIntoViewIfNeeded();
  await save(`${prefix}-settings-before`);
  await button.click();
  await button.waitFor({ state: 'detached' });
  assert.equal(await isSuppressed(dir), false);
  await save(`${prefix}-settings-after`);
};

if (stage === 'default') {
  await openDraft(dirs.native);
  await instructionVisible();
  await save('default-file-detection-prompt');
  await cancel();
  await responseReady();
  assert.equal(await isSuppressed(dirs.native), false);
  await record({ passed: true, result: 'original file conditions prompt before any explicit choice; actual Claude CLI receives loopback response after ordinary Cancel' });
} else if (stage === 'cancel') {
  await openDraft(dirs.unknown);
  await instructionVisible();
  await save('ordinary-cancel-prompt');
  await cancel();
  assert.equal(await isSuppressed(dirs.unknown), false);
  await openDraft(dirs.unknown);
  await instructionVisible();
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  await taskCreated();
  assert.equal(await isSuppressed(dirs.unknown), false);
  await record({ passed: true, result: 'original file detection prompted; Cancel and Esc did not persist; next new-task send prompted again' });
} else if (stage === 'suppress') {
  await openDraft(dirs.unknown);
  await instructionVisible();
  await dialog().getByRole('button', { name: '此工作区不再提示', exact: true }).click();
  await taskCreated();
  assert.equal(await isSuppressed(dirs.unknown), true);
  await assert.rejects(fs.stat(path.join(dirs.unknown, 'CLAUDE.md')), { code: 'ENOENT' });
  await record({ passed: true, result: 'workspace suppression saved by real dialog button; no CLAUDE.md created', preferenceCount: (await preferences()).length });
} else if (stage === 'other') {
  await openDraft(dirs.other);
  await instructionVisible();
  await save('other-workspace-still-prompts');
  await cancel();
  assert.equal(await isSuppressed(dirs.other), false);
  assert.equal(await isSuppressed(dirs.unknown), true);
  await record({ passed: true, result: 'another directory still prompts while first directory remains suppressed' });
} else if (stage === 'mixed') {
  await openDraft(dirs.mixed);
  await instructionVisible();
  assert.equal(await dialog().locator('li').count(), 4);
  await save('mixed-items-before-suppression');
  await dialog().getByRole('button', { name: '此工作区不再提示', exact: true }).click();
  await dialog().getByText('AGENTS.md → CLAUDE.md', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await dialog().locator('li').count(), 3);
  const remaining = await dialog().locator('li').allTextContents();
  assert(remaining.some((v) => v.includes('agents')));
  assert(remaining.some((v) => v.includes('hooks')));
  assert(remaining.some((v) => v.includes('.mcp.json')));
  await save('mixed-agents-hooks-mcp-remain');
  await cancel();
  assert.equal(await isSuppressed(dirs.mixed), true);
  await record({ passed: true, result: 'only AGENTS item removed; agents/hooks/MCP remain in same production dialog', remaining });
} else if (stage === 'failure') {
  await openDraft(dirs.failure);
  await instructionVisible();
  await fs.rename(path.join(dirs.failure, 'AGENTS.md'), path.join(dirs.failure, 'AGENTS.fixture-backup'));
  try {
    await dialog().getByRole('button', { name: '转换', exact: true }).click();
    await taskCreated();
    assert.equal(await isSuppressed(dirs.failure), false);
    await assert.rejects(fs.stat(path.join(dirs.failure, 'CLAUDE.md')), { code: 'ENOENT' });
    await save('conversion-failure-does-not-suppress');
    await record({ passed: true, result: 'source removed after detection caused real conversion failure; preference was not saved' });
  } finally {
    await fs.rename(path.join(dirs.failure, 'AGENTS.fixture-backup'), path.join(dirs.failure, 'AGENTS.md'));
  }
} else if (stage === 'after-restart') {
  assert.equal(await isSuppressed(dirs.unknown), true);
  assert.equal(await isSuppressed(dirs.mixed), true);
  await openDraft(dirs.unknown);
  await taskCreated();
  assert.equal(await dialog().count(), 0);
  await responseReady();
  await save('after-process-restart-suppression-persists');
  await record({ passed: true, result: 'after a real Desktop process restart, same directory skips the instruction prompt', preferences: await preferences() });
} else if (stage === 'reverse') {
  await openDraft(dirs.reverse);
  await instructionVisible();
  await dialog().getByRole('button', { name: '此工作区不再提示', exact: true }).click();
  await taskCreated();
  assert.equal(await isSuppressed(dirs.reverse), true);
  await fs.rename(path.join(dirs.reverse, 'AGENTS.md'), path.join(dirs.reverse, 'AGENTS.fixture-backup'));
  await fs.writeFile(path.join(dirs.reverse, 'CLAUDE.md'), '# Reverse acceptance fixture\nReply LOCAL_ACCEPTANCE_OK. Do not call tools.\n');
  await openDraft(dirs.reverse, 'codex');
  await dialog().getByText('CLAUDE.md → AGENTS.md', { exact: true }).waitFor({ timeout: 15000 });
  await save('reverse-conversion-not-suppressed');
  await cancel();
  assert.equal(await isSuppressed(dirs.reverse), true);
  await assert.rejects(fs.stat(path.join(dirs.reverse, 'AGENTS.md')), { code: 'ENOENT' });
  await record({ passed: true, result: 'same directory forward preference does not hide the reverse conversion for Codex' });
} else if (stage === 'restore') {
  await restoreFromSettings(dirs.unknown, 'restore-unknown');
  assert.equal(await isSuppressed(dirs.mixed), true);
  assert.equal(await isSuppressed(dirs.reverse), true);
  await openDraft(dirs.unknown);
  await instructionVisible();
  await save('restored-unknown-new-task-prompts-again');
  await cancel();
  await record({ passed: true, result: 'real application menu → Settings → General → restore selected directory; next New → Send prompts again; other saved directories retained' });
} else if (stage === 'cleanup-preferences') {
  await restoreFromSettings(dirs.mixed, 'restore-mixed');
  await restoreFromSettings(dirs.reverse, 'restore-last');
  assert.deepEqual(await preferences(), []);
  assert.equal(await page.getByRole('heading', { name: 'AGENTS.md 转换提示', exact: true }).count(), 0);
  await record({ passed: true, result: 'restoring last saved directory removes the conditional recovery section and all overrides' });
} else if (stage === 'cleanup-all') {
  for (const dir of await preferences()) {
    assert(dir.startsWith(runDir.toLowerCase() + path.sep));
    await restoreFromSettings(dir, `cleanup-${path.basename(dir)}`);
  }
  assert.deepEqual(await preferences(), []);
  await record({ passed: true, result: 'all remaining fixture preferences restored via actual Settings UI' });
} else if (stage === 'other-conversions') {
  const mcp = path.join(runDir, 'acceptance-mcp.cjs');
  await fs.writeFile(mcp, `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{let r;try{r=JSON.parse(line)}catch{return}if(r.id===undefined)return;let result=r.method==='initialize'?{protocolVersion:r.params.protocolVersion,capabilities:{},serverInfo:{name:'acceptance-only',version:'1.0.0'}}:r.method==='tools/list'?{tools:[]}:r.method==='resources/list'?{resources:[]}:r.method==='prompts/list'?{prompts:[]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n')});`);
  await fs.writeFile(path.join(dirs.mixed, '.claude', 'settings.json'), '{}');
  await fs.writeFile(path.join(dirs.mixed, 'CLAUDE.local.md'), '# Local acceptance instructions\nDo not call tools.\n');
  await fs.writeFile(path.join(dirs.mixed, '.codex', 'hooks.json'), '{"Stop":[]}');
  await fs.writeFile(path.join(dirs.mixed, '.codex', 'config.toml'), `[mcp_servers.acceptance]\ncommand = 'F:\\NodeJS\\node.exe'\nargs = ['${mcp}']\n`);
  await openDraft(dirs.mixed);
  await instructionVisible();
  await dialog().getByRole('button', { name: '此工作区不再提示', exact: true }).click();
  await dialog().getByText('AGENTS.md → CLAUDE.md', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await dialog().locator('li').count(), 3);
  await dialog().getByRole('button', { name: '转换', exact: true }).click();
  await taskCreated();
  await page.getByText('已迁移 3 项', { exact: true }).waitFor({ timeout: 5000 });
  const settings = JSON.parse(await fs.readFile(path.join(dirs.mixed, '.claude', 'settings.json'), 'utf8'));
  const mcpConfig = JSON.parse(await fs.readFile(path.join(dirs.mixed, '.mcp.json'), 'utf8'));
  assert.deepEqual(settings.hooks.Stop, []);
  assert.equal(mcpConfig.mcpServers.acceptance.command, 'F:\\NodeJS\\node.exe');
  assert((await fs.readFile(path.join(dirs.mixed, '.claude', 'agents', 'acceptance.md'), 'utf8')).includes('name: acceptance'));
  await assert.rejects(fs.stat(path.join(dirs.mixed, 'CLAUDE.md')), { code: 'ENOENT' });
  assert.equal(await isSuppressed(dirs.mixed), true);
  await save('other-three-conversions-completed');
  await record({ passed: true, result: 'after suppressing only instructions, real Convert completed agents/hooks/MCP and produced all three target configs, without creating CLAUDE.md' });
} else {
  throw new Error(`Stage not implemented: ${stage}`);
}
process.exit(0);
