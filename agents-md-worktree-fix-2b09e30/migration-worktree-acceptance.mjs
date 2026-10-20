import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connectAcceptance } from './full-desktop-connection.mjs';
const { page, info, pid } = await connectAcceptance();
const dir = 'C:\\Users\\XD\\AppData\\Local\\Temp\\cindy-agents-md-desktop-7LoO5P\\native';
const stage=process.argv[2] ?? 'inspect';
let activePrompt='';
async function openDraft(dir, vendor = 'cc') {
  if (page.url().includes('#/settings')) {
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor({state:'hidden'});
    await page.waitForURL(url=>!url.href.includes('#/settings'));
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新建', exact: true }).first().click();
  await page.waitForURL(/cc-agent\/new/);
  // Final acceptance selects the registered fixture directory and runtime through
  // the production pickers. No draft store writes or migration/IPC substitutions.
  await page.getByTestId('create-agent-mode-pill').click();
  if (dir.includes('.cindy-worktrees') || path.basename(dir)==='existing-worktree') {
    await page.getByRole('button', { name: '选择其他项目文件夹', exact: true }).click();
    execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File','tmp/select-acceptance-native-directory.ps1','-OwnerProcessId',String(pid),'-Directory',dir], {windowsHide:true,timeout:15000});
  } else {
    await page.getByRole('dialog').getByText(path.basename(dir), { exact: true }).click();
  }
  const modelName = vendor === 'cc' ? '本地验收 Claude' : '本地验收 Codex';
  await page.getByRole('button', { name: /^选择模型/ }).click();
  await page.getByText(modelName, { exact: true }).last().click();
  await page.getByRole('button', { name: new RegExp(`^选择模型.*${modelName}`) }).waitFor();
  await page.getByTestId('create-agent-mode-pill').filter({ hasText: path.basename(dir) }).waitFor();
  const editor = page.locator('[contenteditable="true"]').first();
  activePrompt = `AGENTS acceptance: ${stage} ${Date.now()}. Reply LOCAL_ACCEPTANCE_OK; do not call tools.`;
  await editor.fill(activePrompt);

}

const evidence='artifacts/agents-md-worktree-fix';
const saved=()=>page.evaluate(()=>window.electronAPI.maker.crossAgent.listSuppressedWorkspaces());
const snapshot=async name=>page.screenshot({path:`${evidence}/${name}.png`,animations:'disabled'});
const send=()=>page.getByRole('button',{name:'发送消息',exact:true}).click();
const dialog=()=>page.getByRole('alertdialog');
const created=async()=>{
  await page.waitForURL(/#\/cc-agent\/(?!new)/);
  await page.locator('[data-user-msg-id]').filter({hasText:activePrompt}).waitFor({timeout:30000});
};
const response=()=>page.locator('[data-message-client-id]:visible').getByText('LOCAL_ACCEPTANCE_OK',{exact:true}).first().waitFor({timeout:60000});
const toggle=async enabled=>{
  const chip=page.getByTestId('create-agent-worktree-chip');
  await chip.waitFor();
  if ((await chip.getAttribute('aria-pressed')==='true')!==enabled) await chip.click();
};
const prompt=()=>dialog().getByText('AGENTS.md → CLAUDE.md',{exact:true}).waitFor();
const cancel=async()=>{await dialog().getByRole('button',{name:'不要',exact:true}).click();await created();};
const restore=async target=>{
  await page.getByRole('button',{name:'菜单',exact:true}).click();
  await page.getByRole('menuitem',{name:'设置',exact:true}).click();
  await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
  await page.getByRole('tab',{name:'通用',exact:true}).click();
  const button=page.getByRole('button',{name:`恢复 ${target.toLowerCase()} 的转换提示`,exact:true});
  await button.scrollIntoViewIfNeeded();await button.click();await button.waitFor({state:'detached'});
  assert(!(await saved()).includes(target.toLowerCase()));
};
let detail={};
if(stage==='after-generated'){
  assert((await saved()).includes(dir.toLowerCase()));
  await openDraft(dir);await toggle(true);await send();await prompt();
  assert.equal(await dialog().getByRole('button',{name:'此工作区不再提示',exact:true}).count(),0);
  await snapshot('after-generated-worktree-no-persistent-choice');
  await cancel();
  const sessionId=page.url().split('#/cc-agent/')[1].split('?')[0];
  await page.waitForFunction(async({sessionId,base})=>{
    const s=await window.electronAPI.localDb.sessions.get(sessionId);
    return s.workingDir && s.workingDir.toLowerCase()!==base.toLowerCase();
  },{sessionId,base:dir},{timeout:60000});
  const newDir=path.normalize(await page.evaluate(async id=>(await window.electronAPI.localDb.sessions.get(id)).workingDir,sessionId));
  assert(newDir.toLowerCase().startsWith(dir.toLowerCase()+'\\.cindy-worktrees\\'));
  await response();
  assert.deepEqual(await saved(),[dir.toLowerCase()]);
  await fs.writeFile(`${evidence}/generated-worktree.json`,JSON.stringify({newDir,sessionId}));
  detail={newDir,sessionId,result:'base preference did not hide future worktree prompt; no persistent action; actual worktree created and CLI replied; no extra preference saved'};
}else{
  const {newDir}=JSON.parse(await fs.readFile(`${evidence}/existing-worktree.json`,'utf8'));
  if(stage==='existing-generated'){
    await openDraft(newDir);await send();await prompt();
    await dialog().getByRole('button',{name:'此工作区不再提示',exact:true}).click();await created();await response();
    assert.deepEqual(new Set(await saved()),new Set([dir.toLowerCase(),newDir.toLowerCase()]));
    detail={newDir,result:'selecting the existing user worktree saved only its physical directory alongside independent base preference'};
  }else if(stage==='restore-base'){
    if ((await saved()).includes(dir.toLowerCase())) await restore(dir);
    assert((await saved()).includes(newDir.toLowerCase()));
    await openDraft(dir);await toggle(false);await send();await prompt();
    await snapshot('base-repository-choice-restored');await cancel();
    await openDraft(newDir);await send();await created();await response();
    assert.equal(await dialog().count(),0);
    detail={newDir,result:'restoring base leaves existing worktree suppressed; base ordinary task prompts again and existing worktree still skips'};
  }else if(stage==='restore-generated'){
    await restore(newDir);assert.deepEqual(await saved(),[]);
    await openDraft(newDir);await send();await prompt();
    await snapshot('existing-worktree-choice-restored');await cancel();await response();
    detail={newDir,result:'restoring existing user worktree re-enables its prompt; all fixture preferences cleared'};
  }else throw new Error(`unknown stage ${stage}`);
}
const result={stage,pid,build:info.version,passed:true,...detail};
await fs.appendFile(`${evidence}/after-events.jsonl`,JSON.stringify(result)+'\n');
console.log(JSON.stringify(result));process.exit(0);
