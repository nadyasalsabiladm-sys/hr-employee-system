import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'www');
const files = [
  'index.html',
  'styles.css',
  'config.js',
  'spv-management.js',
  'app.js',
];

await mkdir(output, { recursive: true });
for (const file of files) {
  await copyFile(resolve(root, file), resolve(output, file));
}
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const execFileAsync = promisify(execFile);
await execFileAsync(process.execPath, ['node_modules/esbuild/bin/esbuild', 'mobile/background-location-entry.js', '--bundle', '--platform=browser', '--format=iife', '--target=es2020', '--outfile=www/mobile-background-location.js']);
console.log(`Prepared ${files.length} HRIS web assets and native-location bridge in ./www`);
