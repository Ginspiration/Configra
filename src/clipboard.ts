/**
 * 把文本写入系统剪贴板。
 *
 * WebView2 下异步 Clipboard API 可能因为没有剪贴板权限而失败，而表格里的复制动作
 * 都发生在明确的点击手势中，因此先用隐藏 textarea + execCommand 的同步方案，
 * 失败后再退回异步 Clipboard API。
 */
export async function copyText(text: string): Promise<boolean> {
  if (copyTextWithSelection(text)) return true;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略权限或焦点错误，交给调用方决定是否提示。
  }

  return false;
}

function copyTextWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }

  const activeElement = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (activeElement instanceof HTMLElement && activeElement.isConnected) {
      activeElement.focus();
    }
  }
}
