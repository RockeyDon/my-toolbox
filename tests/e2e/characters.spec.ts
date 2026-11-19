import { expect, test, type Page } from '@playwright/test';

async function enter(page: Page, label: string, text: string) {
  const editor = page.getByRole('textbox', { name: label });
  await editor.fill(text);
  return editor;
}

test('JSON lifecycle, Unicode, compact mode and manual edit', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '压缩', exact: true })).toBeDisabled();
  const editor = await enter(page, 'JSON 编辑器', "{name: '中文😀', values: [true, null, 1,],}");
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await expect(page.getByText('已解析', { exact: true })).toBeVisible();
  await expect(editor).toContainText('"name": "中文😀"');
  await page.screenshot({ path: testInfo.outputPath('json-editor.png') });
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await expect(editor).toHaveText('{"name":"中文😀","values":[true,null,1]}');
  await page.getByRole('button', { name: '转Unicode', exact: true }).click();
  await expect(editor).toContainText('\\u4e2d\\u6587\\ud83d\\ude00');
  await page.getByRole('button', { name: '转中文', exact: true }).click();
  await expect(editor).toContainText('中文😀');
  await editor.press('End');
  await editor.press('Space');
  await expect(page.getByRole('button', { name: '压缩', exact: true })).toBeDisabled();
  await expect(editor.getByText('"name"', { exact: true })).toHaveCSS('color', 'rgb(65, 76, 114)');
});

test('invalid JSON shows position and keeps transformations disabled', async ({ page }) => {
  await page.goto('/');
  const editor = await enter(page, 'JSON 编辑器', '{a:1,b:@}');
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('第 3 行');
  await expect(editor).toContainText('b: @');
  for (const name of ['压缩', '转Unicode', '转中文']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
});

test('Python dictionaries and lists use multiline JSON across encoding conversions', async ({ page }) => {
  await page.goto('/');
  const editor = await enter(page, 'JSON 编辑器', "[{'name': '中文😀', 'items': [{'enabled': True}, {'value': None}]}, {'enabled': False}]");
  const value = [{ name: '中文😀', items: [{ enabled: true }, { value: null }] }, { enabled: false }];
  const lines = editor.locator('.cm-line');
  const expectPretty = async () => {
    await expect.poll(async () => (await lines.allTextContents()).join('\n')).toBe(JSON.stringify(value, null, 2));
  };
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await expect(page.getByText('已解析', { exact: true })).toBeVisible();
  await expectPretty();
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await expect(lines).toHaveCount(1);
  await expect(editor).toHaveText(JSON.stringify(value));
  await page.getByRole('button', { name: '转Unicode', exact: true }).click();
  await expect(editor).toContainText('\\u4e2d\\u6587');
  const unicode = (await lines.allTextContents()).join('\n');
  expect(JSON.parse(unicode)).toEqual(value);
  expect(unicode).toContain('\n');
  expect(unicode).not.toMatch(/\[\{|\},\{/);
  await page.getByRole('button', { name: '转中文', exact: true }).click();
  await expectPretty();
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await page.getByRole('button', { name: '转中文', exact: true }).click();
  await expectPretty();
});

test('tabs retain content and text conversion reports errors without replacing input', async ({ page }) => {
  await page.goto('/');
  await enter(page, 'JSON 编辑器', 'null');
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await page.getByRole('tab', { name: '长文本转换' }).click();
  const text = '第一行\n"第二行"\\path\t😀';
  const editor = await enter(page, '文本编辑器', text);
  await page.getByRole('button', { name: '转义', exact: true }).click();
  await expect(editor).toHaveText(JSON.stringify(text).slice(1, -1));
  await page.getByRole('button', { name: '展示', exact: true }).click();
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('"第二行"\\path');
  await page.getByRole('tab', { name: 'JSON格式化' }).click();
  await expect(page.getByRole('textbox', { name: 'JSON 编辑器' })).toHaveText('null');
  await expect(page.getByRole('button', { name: '压缩', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '长文本转换' }).click();
  await expect(page.getByRole('textbox', { name: '文本编辑器' })).toContainText('第一行');
  await enter(page, '文本编辑器', String.raw`bad\q`);
  await page.getByRole('button', { name: '展示', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法展示');
  await expect(editor).toHaveText(String.raw`bad\q`);
});

test('workspace fits the minimum supported window', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '格式化', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
