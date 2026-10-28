export const PUBLISH_MANIFEST_FILE = '.configra-publish.json';

export type PublishManifest = {
  version: 1;
  projectKey: string;
  /**
   * 写入该清单的发布方案稳定 id。旧清单没有该字段，按 legacy 处理：
   * 首次用新方案发布到该目录必须显式确认，且不自动清理未知旧文件。
   */
  profileId?: string;
  updatedAt: string;
  files: Record<string, string>;
};

export const publishManifestPath = (directory: string) =>
  `${directory.replace(/[\\/]+$/, '')}/${PUBLISH_MANIFEST_FILE}`;

export const parsePublishManifest = (text: string): PublishManifest | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Partial<PublishManifest>;
  if (value.version !== 1 || typeof value.projectKey !== 'string' || !value.projectKey) {
    return undefined;
  }
  if (typeof value.files !== 'object' || value.files === null || Array.isArray(value.files)) {
    return undefined;
  }
  if (value.profileId !== undefined && (typeof value.profileId !== 'string' || !value.profileId)) {
    return undefined;
  }

  const files: Record<string, string> = {};
  for (const [fileName, hash] of Object.entries(value.files)) {
    if (typeof hash !== 'string') return undefined;
    // 清单只允许目标目录里的普通 .json 文件名，避免 ../ 或盘符路径。
    if (
      !/^[A-Za-z0-9._-]+\.json$/.test(fileName) ||
      fileName === '..' ||
      fileName.startsWith('..')
    ) {
      return undefined;
    }
    files[fileName] = hash;
  }

  return {
    version: 1,
    projectKey: value.projectKey,
    ...(value.profileId ? { profileId: value.profileId } : {}),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    files,
  };
};

/**
 * 浏览器与 Node 都能用的内容哈希。优先 SHA-256；没有 Web Crypto 时退化为
 * FNV-1a，仅用于判断“文件是否仍是上次发布的那一份”，不用于安全签名。
 */
export async function hashText(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
