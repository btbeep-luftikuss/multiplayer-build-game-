// Development server: rebuilds on every change and serves docs/ at http://localhost:8080
// Open http://localhost:8080/?local for the TV and http://localhost:8080/?join=CODE&local in other
// tabs for phones (the "local" mode connects tabs on one computer without the internet).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { options, entries, writeIndex } from './build.mjs';

const port = Number(process.env.PORT || 8080);
fs.mkdirSync('docs', { recursive: true });
writeIndex('dev');
const ctxs = await Promise.all(entries.map((e) => esbuild.context({ ...options, ...e, minify: false, sourcemap: 'inline' })));
await Promise.all(ctxs.map((c) => c.watch()));
const { hosts } = await ctxs[0].serve({ servedir: 'docs', port });
console.log(`serving http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}/`);
