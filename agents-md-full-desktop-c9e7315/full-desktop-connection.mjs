import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
export async function connectAcceptance() {
  const start = fs.readFileSync('tmp/migration-prompt-acceptance-start.log', 'utf8').replaceAll('\0', '');
  if (!start.includes('sandbox=agents-md-acceptance')) throw new Error('Wrong sandbox launch');
  const expectedPid = Number(start.match(/^pid=(\d+)/m)?.[1]);
  const actualPid = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 9433 -State Listen).OwningProcess'], { encoding: 'utf8', windowsHide: true }).trim());
  if (!expectedPid || actualPid !== expectedPid) throw new Error('CDP owner does not match isolated Desktop');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9433');
  for (const page of browser.contexts()[0].pages()) {
    if (!/^http:\/\/localhost:/.test(page.url())) continue;
    if (!await page.evaluate(() => Boolean(window.electronAPI?.maker?.crossAgent))) continue;
    const info = await page.evaluate(async () => { const a = await window.electronAPI.authInitialize(); return { mode: a.mode, version: window.electronAPI.appDisplayVersionDetail }; });
    if (info.mode === 'cloud' || !info.version.includes('c9e7315')) throw new Error('Unexpected authenticated profile/build');
    await page.waitForFunction(async () => {
      try { await window.electronAPI.maker.crossAgent.listSuppressedWorkspaces(); return true; }
      catch { return false; }
    }, undefined, { timeout: 60000, polling: 500 });
    return { browser, page, info, pid: actualPid };
  }
  throw new Error('Isolated main window unavailable');
}
