// Fails if the built CSS uses colour syntax that old frame WebViews reject.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/client/assets';
let bad = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(join(dir, file), 'utf8');
  const checks = [
    [/#(?:[0-9a-f]{4}|[0-9a-f]{8})\b/gi, '4/8-digit hex colour'],
    [/\b(?:oklch|oklab|color-mix)\(/g, 'modern colour function'],
    [/\b\d+(?:\.\d+)?(?:dvh|svh|lvh)\b/g, 'dynamic viewport unit'],
    [/:has\(/g, ':has()'],
  ];
  for (const [re, label] of checks) {
    const hits = css.match(re);
    if (hits) {
      bad += hits.length;
      console.error(`${file}: ${label}: ${[...new Set(hits)].slice(0, 5).join(', ')}`);
    }
  }
}
if (bad) process.exit(1);
console.log('CSS looks safe for old WebViews.');
