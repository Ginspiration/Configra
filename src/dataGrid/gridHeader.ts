/** 绘制表头时用于测量文本宽度的回调，单位与 canvas 的 measureText 一致。 */
export type TextMeasure = (text: string) => number;

/**
 * 表头布局常量。标题固定占一行，字段备注从第二行开始，按列宽自动换行。
 * 备注不截断，表头高度由最长备注的行数决定。
 */
export const HEADER_LAYOUT = {
  paddingX: 8,
  paddingTop: 6,
  paddingBottom: 6,
  titleLineHeight: 18,
  remarkGap: 2,
  remarkLineHeight: 14,
  minHeight: 32,
} as const;

/** 根据备注行数计算表头高度；没有备注时保持原来的紧凑高度。 */
export const headerHeightForRemarkLines = (remarkLineCount: number): number =>
  Math.max(
    HEADER_LAYOUT.minHeight,
    HEADER_LAYOUT.paddingTop +
      HEADER_LAYOUT.titleLineHeight +
      (remarkLineCount > 0
        ? HEADER_LAYOUT.remarkGap + remarkLineCount * HEADER_LAYOUT.remarkLineHeight
        : 0) +
      HEADER_LAYOUT.paddingBottom,
  );

/**
 * 将超长单词按字符切分到指定宽度。中文和 URL 这类没有空格的内容都走这里，
 * 保证任何备注都能在列宽内完整显示。
 */
const splitLongToken = (token: string, maxWidth: number, measure: TextMeasure): string[] => {
  if (maxWidth <= 0 || measure(token) <= maxWidth) return [token];

  const parts: string[] = [];
  let rest = token;
  while (rest && measure(rest) > maxWidth) {
    let low = 1;
    let high = rest.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (measure(rest.slice(0, mid)) <= maxWidth) low = mid;
      else high = mid - 1;
    }

    parts.push(rest.slice(0, low));
    rest = rest.slice(low);
  }

  if (rest) parts.push(rest);
  return parts;
};

/**
 * 按像素宽度折行：保留显式换行，优先在空格处断行，超长单词按字符切分。
 * 返回值不包含首尾空白行，内部空行会保留。
 */
export function wrapText(text: string, maxWidth: number, measure: TextMeasure): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const lines: string[] = [];

  for (const paragraph of normalized.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    if (maxWidth <= 0) {
      lines.push(trimmed);
      continue;
    }

    let line = '';
    for (const word of trimmed.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
        line = '';
      }

      const parts = splitLongToken(word, maxWidth, measure);
      lines.push(...parts.slice(0, -1));
      line = parts[parts.length - 1] ?? '';
    }

    if (line) lines.push(line);
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
