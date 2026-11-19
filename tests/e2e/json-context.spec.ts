import { expect, test, type Page } from '@playwright/test';

const value = {
  prefix: Array.from({ length: 70 }, (_, index) => index),
  report: { organ_result: [{ conclusions: [{ detail: { values: Array.from({ length: 160 }, (_, index) => `项目 ${index}`) } }] }] },
  suffix: Array.from({ length: 70 }, (_, index) => index),
};
const formatted = JSON.stringify(value, null, 2);

async function format(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'JSON 编辑器' }).fill(JSON.stringify(value));
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await expect(page.getByText('已解析', { exact: true })).toBeVisible();
}

async function scrollTo(page: Page, text: string) {
  const line = formatted.split('\n').findIndex((line) => line.includes(text));
  expect(line).toBeGreaterThan(-1);
  await page.locator('.cm-scroller').evaluate((element, line) => {
    const content = element.querySelector('.cm-content')!;
    const style = getComputedStyle(content);
    element.scrollTop = Number.parseFloat(style.paddingTop) + line * Number.parseFloat(style.lineHeight);
  }, line);
}

function context(page: Page) { return page.getByRole('navigation', { name: 'JSON 父级上下文' }); }

test('scroll context keeps closest ancestors, colors and line numbers, and jumps to the original line', async ({ page }, testInfo) => {
  await format(page);
  await expect(context(page)).toBeHidden();
  await scrollTo(page, '"项目 30"');
  const rows = context(page).getByRole('button');
  await expect(rows).toHaveCount(5);
  await expect(context(page).locator('.json-context-text')).toHaveText([
    '        {', '          "conclusions": [', '            {', '              "detail": {', '                "values": [',
  ]);
  const lineNumber = formatted.split('\n').findIndex((line) => line.includes('"values"')) + 1;
  await expect(rows.last()).toHaveAttribute('data-line', String(lineNumber));
  await expect(rows.last().locator('.json-context-text span').filter({ hasText: '"values"' })).toHaveCSS('color', 'rgb(65, 76, 114)');
  const panelBox = (await context(page).boundingBox())!;
  const editorBox = (await page.locator('.cm-editor').boundingBox())!;
  const scrollerBox = (await page.locator('.cm-scroller').boundingBox())!;
  expect(panelBox.height).toBeLessThanOrEqual(editorBox.height / 4);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(scrollerBox.y + 1);
  await page.screenshot({ path: testInfo.outputPath('json-parent-context.png') });
  await rows.last().click();
  await expect(page.getByRole('textbox', { name: 'JSON 编辑器' })).toBeFocused();
  await expect(rows.last()).toContainText('"detail"');
  const target = page.locator('.cm-content .cm-line').filter({ hasText: '"values": [' });
  await expect(target).toBeInViewport();
  await expect.poll(async () => {
    const rowBox = await target.boundingBox();
    const bodyBox = await page.locator('.cm-scroller').boundingBox();
    return Math.abs(rowBox!.y - bodyBox!.y);
  }).toBeLessThan(6);
  await rows.first().click();
  await expect(context(page).locator('.json-context-text')).toHaveText(['{', '  "report": {']);
  const outer = page.locator('.cm-content .cm-line').filter({ hasText: '"organ_result": [' });
  await expect.poll(async () => {
    const rowBox = await outer.boundingBox();
    const bodyBox = await page.locator('.cm-scroller').boundingBox();
    return Math.abs(rowBox!.y - bodyBox!.y);
  }).toBeLessThan(6);
  await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = 0; });
  await expect(context(page)).toBeHidden();
});

test('keyboard navigation and resize respect context height without changing content', async ({ page }) => {
  await format(page);
  await scrollTo(page, '"项目 30"');
  await expect(context(page).getByRole('button')).toHaveCount(5);
  await page.setViewportSize({ width: 760, height: 540 });
  await expect.poll(async () => {
    const panelBox = (await context(page).boundingBox())!;
    const editorBox = (await page.locator('.cm-editor').boundingBox())!;
    return panelBox.height <= editorBox.height / 4;
  }).toBe(true);
  const target = context(page).getByRole('button').last();
  const originalLabel = await target.getAttribute('aria-label');
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(context(page).getByRole('button', { name: originalLabel!, exact: true })).toHaveCount(0);
  await scrollTo(page, '"项目 40"');
  const spaceTarget = context(page).getByRole('button').last();
  await expect(spaceTarget).toContainText('"values"');
  const spaceLabel = await spaceTarget.getAttribute('aria-label');
  await spaceTarget.focus();
  await page.keyboard.press('Space');
  await expect(context(page).getByRole('button', { name: spaceLabel!, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'JSON 编辑器' })).toHaveText(JSON.stringify(value));
});

test('editing, compact mode and tab changes disable context and successful formatting restores it', async ({ page }) => {
  await format(page);
  await scrollTo(page, '"项目 30"');
  await expect(context(page)).toBeVisible();
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await expect(context(page)).toHaveCount(0);
  await page.getByRole('button', { name: '转Unicode', exact: true }).click();
  await scrollTo(page, '"values"');
  await expect(context(page)).toBeVisible();
  await page.getByRole('button', { name: '转中文', exact: true }).click();
  await scrollTo(page, '"项目 30"');
  await expect(context(page)).toBeVisible();
  await page.getByRole('tab', { name: '长文本转换' }).click();
  await expect(context(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'JSON格式化' }).click();
  await scrollTo(page, '"项目 30"');
  await expect(context(page)).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'JSON 编辑器' });
  await editor.press('Space');
  await expect(context(page)).toHaveCount(0);
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await scrollTo(page, '"项目 30"');
  await expect(context(page)).toBeVisible();
  await editor.fill('{bad:@}');
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(context(page)).toHaveCount(0);
});

test('folding and wrapped lines retain the correct ancestors', async ({ page }) => {
  await format(page);
  await scrollTo(page, '"项目 30"');
  await expect(context(page).getByRole('button')).toHaveCount(5);
  await context(page).getByRole('button').last().click();
  await expect(context(page).getByRole('button').last()).toContainText('"detail"');
  const editor = page.getByRole('textbox', { name: 'JSON 编辑器' });
  const expandedHeight = await page.locator('.cm-scroller').evaluate((element) => element.scrollHeight);
  const line = page.locator('.cm-content .cm-line').filter({ hasText: '"values": [' });
  await expect(line).toBeInViewport();
  const lineBox = (await line.boundingBox())!;
  const markers = page.locator('.cm-foldGutter span[title="Fold line"]');
  const markerIndex = await markers.evaluateAll((elements, target) => {
    const distances = elements.map((element) => Math.abs(element.getBoundingClientRect().y - target));
    return distances.indexOf(Math.min(...distances));
  }, lineBox.y);
  await markers.nth(markerIndex).click();
  await expect(page.locator('.cm-foldPlaceholder')).toBeVisible();
  await expect(context(page).getByRole('button').last()).toContainText('"detail"');
  await page.getByTitle('Unfold line', { exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
  await expect.poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollHeight)).toBeGreaterThanOrEqual(expandedHeight - 1);
  await scrollTo(page, '"项目 50"');
  await expect(context(page).getByRole('button').last()).toContainText('"values"');
  const wrapped = { parent: { message: '很长的文本 [{ },{ '.repeat(120), next: Array.from({ length: 100 }, (_, index) => index) } };
  await editor.fill(JSON.stringify(wrapped));
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = 200; });
  await expect(context(page).locator('.json-context-text')).toHaveText(['{', '  "parent": {']);
});
