import { describe, expect, it } from 'vitest';
import { HEADER_LAYOUT, headerHeightForRemarkLines, wrapText } from './gridHeader';

/** 每个字符宽 10px，便于精确断言折行位置。 */
const measure = (text: string) => text.length * 10;

describe('grid header remark wrapping', () => {
  it('returns no lines for empty remarks', () => {
    expect(wrapText('', 100, measure)).toEqual([]);
    expect(wrapText('   \n  ', 100, measure)).toEqual([]);
  });

  it('keeps short remarks on one line', () => {
    expect(wrapText('音效编号', 100, measure)).toEqual(['音效编号']);
  });

  it('wraps at spaces and keeps English words intact', () => {
    expect(wrapText('alpha beta gamma', 60, measure)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('splits long words and CJK text by character width', () => {
    expect(wrapText('abcdefghij', 30, measure)).toEqual(['abc', 'def', 'ghi', 'j']);
    expect(wrapText('科研拼图设置', 30, measure)).toEqual(['科研拼', '图设置']);
  });

  it('preserves explicit line breaks, including blank lines', () => {
    expect(wrapText('第一行\n\n第二段内容', 100, measure)).toEqual([
      '第一行',
      '',
      '第二段内容',
    ]);
    expect(wrapText('Windows\r\nline', 100, measure)).toEqual(['Windows', 'line']);
  });

  it('does not drop characters when wrapping', () => {
    const source = '该稳态应用时虫洞入口的默认世界高度，单位：AU；Z 固定为 0。';
    const lines = wrapText(source, 70, measure);
    expect(lines.join('').replace(/\s+/g, '')).toBe(source.replace(/\s+/g, ''));
  });
});

describe('grid header height', () => {
  it('keeps the compact height when there is no remark', () => {
    expect(headerHeightForRemarkLines(0)).toBe(HEADER_LAYOUT.minHeight);
  });

  it('grows by one remark line at a time', () => {
    expect(headerHeightForRemarkLines(1)).toBe(46);
    expect(headerHeightForRemarkLines(3)).toBe(74);
    expect(headerHeightForRemarkLines(10)).toBe(172);
  });
});
