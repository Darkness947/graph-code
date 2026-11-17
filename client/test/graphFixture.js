/**
 * Builds a `Graph` (spec 6.2) from file paths and `[importer, imported]` pairs. Folder nodes,
 * `fileCount`, `fanIn` and `fanOut` are derived, as the server does. Ids are `f:<path>` for
 * files and `d:<path>` for folders, so tests can name them.
 * @param {string[]} files
 * @param {Array<[string, string]>} imports
 */
export function makeGraph(files, imports = []) {
  const nodes = [];
  const folders = new Map();
  const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

  for (const file of files) {
    let dir = parentOf(file);
    while (dir) {
      folders.set(dir, (folders.get(dir) ?? 0) + 1);
      dir = parentOf(dir);
    }
  }
  for (const [path, fileCount] of folders) {
    nodes.push({
      id: `d:${path}`,
      path,
      name: nameOf(path),
      type: 'folder',
      parentPath: parentOf(path),
      metrics: { fileCount },
    });
  }
  for (const path of files) {
    nodes.push({
      id: `f:${path}`,
      path,
      name: nameOf(path),
      type: 'file',
      parentPath: parentOf(path),
      language: path.endsWith('x') ? 'tsx' : 'ts',
      sizeBytes: 1024,
      metrics: {
        fanIn: imports.filter(([, to]) => to === path).length,
        fanOut: imports.filter(([from]) => from === path).length,
      },
    });
  }
  const edges = imports.map(([from, to], i) => ({
    id: i + 1,
    source: `f:${from}`,
    target: `f:${to}`,
  }));
  return {
    repository: { id: 'repo-1', owner: 'acme', name: 'web', displayName: 'acme/web' },
    nodes,
    edges,
    unresolved: { count: 0, items: [] },
  };
}

/** A small repository with nested folders, used across the graph tests. */
export const SAMPLE = makeGraph(
  [
    'index.ts',
    'src/main.ts',
    'src/lib/utils.ts',
    'src/lib/deep/math.ts',
    'app/page.tsx',
    'app/layout.tsx',
    'app/blog/page.tsx',
  ],
  [
    ['index.ts', 'src/lib/utils.ts'],
    ['index.ts', 'app/page.tsx'],
    ['src/main.ts', 'src/lib/utils.ts'],
    ['src/lib/utils.ts', 'src/lib/deep/math.ts'],
    ['app/page.tsx', 'src/lib/utils.ts'],
    ['app/page.tsx', 'app/blog/page.tsx'],
    ['app/blog/page.tsx', 'src/lib/deep/math.ts'],
  ],
);
