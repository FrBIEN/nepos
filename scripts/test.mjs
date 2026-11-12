import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'nepos-test-'));
try {
  for (const suite of ['network', 'fls', 'architecture', 'runtime', 'safety']) {
  const outfile = join(dir, `${suite}.mjs`);
  await build({ entryPoints: [`tests/${suite}.test.ts`], outfile, bundle: true, platform: 'node', format: 'esm', loader: { '.svg': 'dataurl' } });
  await import(pathToFileURL(outfile).href);
  }
} finally { await rm(dir, { recursive: true, force: true }); }
