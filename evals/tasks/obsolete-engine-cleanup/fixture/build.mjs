import { mkdir, writeFile } from 'node:fs/promises';
import { render } from './src/index.mjs';
await mkdir('dist', { recursive: true });
await writeFile('dist/demo.txt', render(['red', 'blue']));
