const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'virtual-picker-scroll-'));
try {
  const configPath = path.join(runtime, 'tsconfig.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      extends: path.join(repo, 'tsconfig.json'),
      compilerOptions: {
        noEmit: false,
        outDir: runtime,
        rootDir: path.join(repo, 'src'),
      },
      include: [path.join(repo, 'src/renderer/VirtualPickerGrid.tsx')],
    }),
  );
  execFileSync(
    process.execPath,
    [path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', configPath],
    { cwd: repo, stdio: 'inherit' },
  );
  const compiled =
    fs
      .readFileSync(path.join(runtime, 'renderer/VirtualPickerGrid.js'), 'utf8')
      .replace(
        /import \{([^}]+)\} from "react\/jsx-runtime";/,
        (_match, names) =>
          `const {${names.replace(/ as /g, ': ')}} = require('react/jsx-runtime');`,
      )
      .replace(/import \{([^}]+)\} from 'react';/, "const {$1} = require('react');")
      .replace(/export function /g, 'function ') +
    '\nexports.VirtualPickerGrid = VirtualPickerGrid;';
  for (const size of ['large', 'medium', 'small']) {
    let geometry = { width: 1000, height: 600, top: 0 };
    const updates = [];
    const exports = {};
    vm.runInNewContext(compiled, {
      exports,
      require(id) {
        if (id === 'react') {
          return {
            useState: () => [geometry, (update) => updates.push(update)],
            useRef: (current) => ({ current }),
            useMemo: (compute) => compute(),
            useEffect: () => {},
          };
        }
        if (id === 'react/jsx-runtime') {
          return {
            jsx: (type, props) => ({ type, props }),
            jsxs: (type, props) => ({ type, props }),
          };
        }
        throw new Error(`Unexpected import: ${id}`);
      },
    });
    const items = Array.from({ length: 500 }, (_, index) => ({ path: `image-${index}` }));
    const render = () =>
      exports.VirtualPickerGrid({ items, size, activePath: '', renderItem: (item) => item.path });
    const firstRow = (tree) => tree.props.children.props.children[0].props.style.top;
    const initial = render();
    for (const top of [4000, 8000, 2000, 0]) {
      const event = { currentTarget: { scrollTop: top } };
      render().props.onScroll(event);
      // React clears currentTarget after dispatch; state updaters may run later.
      event.currentTarget = null;
      assert.equal(updates.length, 1);
      const update = updates.shift();
      geometry = typeof update === 'function' ? update(geometry) : update;
      assert.equal(geometry.top, top);
      assert.equal(geometry.width, 1000);
      assert.equal(geometry.height, 600);
      const tree = render();
      assert.ok(tree.props.children.props.children.length > 0, 'image rows remain mounted');
      if (top >= 4000) assert.ok(firstRow(tree) > firstRow(initial), 'visible rows advance');
      if (top === 0) assert.equal(firstRow(tree), firstRow(initial), 'return to initial rows');
    }
  }
  console.log('Virtual picker deferred scroll tests passed (large, medium, small).');
} finally {
  fs.rmSync(runtime, { recursive: true, force: true });
}
