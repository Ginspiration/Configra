/** 发布清单用的工程标识；同一路径在 UI、CLI 和 MCP 中必须得到相同值。 */
export const projectKeyForPath = (projectPath?: string) => {
  if (!projectPath) return 'unsaved';
  let hash = 2166136261;
  for (let index = 0; index < projectPath.length; index += 1) {
    hash = Math.imul(hash ^ projectPath.toLowerCase().charCodeAt(index), 16777619);
  }
  return `project-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
