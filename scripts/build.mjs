// Bundles the TV and phone code into docs/ (what GitHub Pages serves).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dev = process.argv.includes('--dev');
export const options = {
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  format: 'iife',
  target: ['es2020', 'safari15'],
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
};
export const entries = [
  { entryPoints: ['src/host/main.js'], outfile: 'docs/tv.js' },
  { entryPoints: ['src/phone/main.js'], outfile: 'docs/phone.js' },
];

export function writeIndex(version) {
  const html = fs.readFileSync('src/index.html', 'utf8').replaceAll('__VERSION__', version);
  fs.writeFileSync('docs/index.html', html);
  // GitHub Pages shows 404.html for unknown paths: send people to the game
  fs.writeFileSync('docs/404.html', '<!doctype html><meta charset="utf-8"><title>Clawstruction</title><script>location.replace(location.pathname.replace(/[^/]*$/, "") + location.search)</script>');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  fs.mkdirSync('docs', { recursive: true });
  for (const e of entries) await esbuild.build({ ...options, ...e });
  const hash = crypto.createHash('sha1');
  for (const e of entries) hash.update(fs.readFileSync(e.outfile));
  writeIndex(hash.digest('hex').slice(0, 10));
  fs.writeFileSync('docs/.nojekyll', '');
  console.log('built docs/');
}
