export function escapeText(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

export function displayText(text: string): string {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    throw new Error('无法展示：请输入不含外围双引号的 JSON 字符串内容，检查非法转义、未转义的双引号或实际换行。');
  }
}
