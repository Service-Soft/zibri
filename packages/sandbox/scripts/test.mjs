import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// "npm test" runs jest through this file, which finds it wherever npm installed it: inside an npm
// workspace, that is the node_modules of the workspace's root. The templates are ES modules, which
// jest only loads with --experimental-vm-modules, so it runs in a node started with that flag
const require = createRequire(import.meta.url);
const { status } = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', require.resolve('jest/bin/jest'), ...process.argv.slice(2)],
    { stdio: 'inherit' }
);
process.exitCode = status ?? 1;