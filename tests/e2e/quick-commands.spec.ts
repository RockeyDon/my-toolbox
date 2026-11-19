import { expect, test } from '@playwright/test';

function installMock() {
  const browser = window as unknown as {
    isTauri: boolean;
    __TAURI_INTERNALS__: {
      invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
      transformCallback: (callback: (event: { index: number; message?: unknown }) => void) => number;
      unregisterCallback: (id: number) => boolean;
      runCallback: (id: number, event: { index: number; message?: unknown }) => void;
      convertFileSrc: (path: string) => string;
      metadata: () => { currentWindow: { label: string }; currentWebview: { label: string } };
    };
    mockConfig: { version: number; commands: { id: string; name: string; command: string }[]; shells: Record<string, unknown> };
    mockTabs: Map<string, { onmessage: (event: unknown) => void }>;
    mockSerial: number;
  };
  const callbacks = new Map<number, (event: { index: number; message?: unknown }) => void>();
  let callbackId = 0;
  browser.mockConfig = { version: 1, commands: [], shells: {
    selectedId: 'system-default', discovered: [], manual: [], lastScannedAt: null,
  } };
  browser.mockTabs = new Map();
  browser.mockSerial = 0;
  browser.isTauri = true;
  const configuration = () => ({
    config: structuredClone(browser.mockConfig),
    defaultShell: { id: 'system-default', name: 'zsh', path: '/bin/zsh', kind: 'posix' },
    defaultError: null, unavailableIds: [],
  });
  browser.__TAURI_INTERNALS__ = {
    invoke: async (name: string, args: Record<string, unknown> = {}) => {
      if (name === 'qc_load' || name === 'qc_scan') return configuration();
      if (name === 'qc_create_tab') {
        const id = `tab-${++browser.mockSerial}`;
        const channelId = (args.channel as { id: number }).id;
        let messageIndex = 0;
        const tab = { onmessage: (event: unknown) => browser.__TAURI_INTERNALS__.runCallback(channelId, {
          index: messageIndex++, message: event,
        }) };
        browser.mockTabs.set(id, tab);
        setTimeout(() => tab.onmessage({ type: 'state', tabId: id, state: {
          queue: [], current: null, runId: null, interruptSent: false, closing: false, lastResult: null,
        } }), 0);
        return id;
      }
      if (name === 'qc_close_tab') { browser.mockTabs.delete(String(args.tabId)); return null; }
      if (name === 'qc_update') {
        const change = args.change as { type: string; command?: { id: string; name: string; command: string }; ids?: string[] };
        if (change.type === 'saveCommand' && change.command) {
          const index = browser.mockConfig.commands.findIndex((item) => item.id === change.command?.id);
          if (index < 0) browser.mockConfig.commands.push(change.command);
          else browser.mockConfig.commands[index] = change.command;
        }
        if (change.type === 'reorder' && change.ids) {
          browser.mockConfig.commands.sort((a, b) => change.ids!.indexOf(a.id) - change.ids!.indexOf(b.id));
        }
        return configuration();
      }
      if (name === 'qc_submit') {
        const item = browser.mockConfig.commands.find((value) => value.id === args.commandId);
        const tabId = String(args.tabId);
        const runId = `run-${browser.mockSerial}`;
        const channel = browser.mockTabs.get(tabId);
        channel?.onmessage({ type: 'started', tabId, runId,
          item: { ...item!, shell: { id: 'system-default', name: 'zsh', path: '/bin/zsh', kind: 'posix' } },
          startedAt: Date.now(),
        });
        channel?.onmessage({ type: 'output', tabId, runId, text: `模拟输出：${item?.name ?? ''}`, stream: 'stdout' });
        channel?.onmessage({ type: 'finished', tabId, runId, result: '退出码 0 · 0.1 秒' });
        return null;
      }
      if (name === 'qc_delete_queue' || name === 'qc_interrupt') return null;
      throw new Error(`Unimplemented mock Tauri command: ${name}`);
    },
    transformCallback: (callback: (event: { index: number; message?: unknown }) => void) => {
      callbacks.set(++callbackId, callback); return callbackId;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    runCallback: (id: number, event: { index: number; message?: unknown }) => callbacks.get(id)?.(event),
    convertFileSrc: (path: string) => path,
    metadata: () => ({ currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }),
  };
}

test.beforeEach(async ({ page }) => { await page.addInitScript(installMock); });

test('toolbar follows the light workspace and starts with empty configuration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '快捷命令' }).click();
  await expect(page.getByRole('button', { name: '添加命令' })).toBeVisible();
  await expect(page.getByRole('group', { name: '选择执行 Shell' })).toBeVisible();
  await expect(page.locator('.qc-output-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('command editing, keyboard sorting and output tabs fit the minimum window', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });
  await page.goto('/');
  await page.getByRole('button', { name: '快捷命令' }).click();
  await page.getByRole('button', { name: '添加命令' }).click();
  await expect(page.getByRole('dialog', { name: '添加命令' })).toBeVisible();
  await page.getByLabel('名称').fill('检查仓库');
  await page.getByRole('textbox', { name: '命令' }).fill('git status --short');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const command = page.getByRole('button', { name: /检查仓库/ });
  await expect(command).toBeVisible();
  await command.click();
  await expect(page.getByRole('tab', { name: /终端 1/ })).toBeVisible();
  await expect(page.getByLabel('命令输出', { exact: true })).toContainText('模拟输出：检查仓库');
  await page.getByRole('button', { name: '新建输出标签' }).click();
  await expect(page.getByRole('tab', { name: /终端 2/ })).toBeVisible();
  await expect(page.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, document.documentElement.scrollHeight <= innerHeight])).resolves.toEqual([true, true]);
});
