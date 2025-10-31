#!/usr/bin/env node
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const indexHtmlPath = path.join(rootDir, 'index.html');
const versionFilePath = path.join(rootDir, 'src', 'version.js');

async function main() {
  const packageJsonRaw = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonRaw);
  const version = packageJson.version;

  await writeFile(versionFilePath, `export const APP_VERSION = '${version}';\n`);

  const htmlRaw = await readFile(indexHtmlPath, 'utf8');
  const updatedHtml = htmlRaw
    .replace(/(href="src\/styles\.css)(\?v=[^"]*)?(\")/, `$1?v=${version}$3`)
    .replace(/(src="src\/app\.js)(\?v=[^"]*)?(\")/, `$1?v=${version}$3`);

  if (updatedHtml !== htmlRaw) {
    await writeFile(indexHtmlPath, updatedHtml);
  }
}

main().catch((err) => {
  console.error('sync-version failed:', err);
  process.exitCode = 1;
});
