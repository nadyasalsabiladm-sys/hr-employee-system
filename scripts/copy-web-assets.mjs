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
console.log(`Prepared ${files.length} HRIS web assets in ./www`);
