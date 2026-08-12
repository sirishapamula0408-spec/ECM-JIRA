// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..');

const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

// Build the needle from pieces so this test file itself never contains the
// literal bad reference it is guarding against.
const BAD_REFERENCE = 'var(--font-' + 'mono';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('JL-395: mono surfaces use the shared font token', () => {
  it('AuditLogPage.css uses var(--font-family-mono)', () => {
    const css = read('pages/AuditLogPage/AuditLogPage.css');
    expect(css).toContain('var(--font-family-mono');
    expect(css).not.toContain(BAD_REFERENCE);
  });

  it('FiltersPage.css uses var(--font-family-mono) and no hardcoded SFMono stack', () => {
    const css = read('pages/FiltersPage/FiltersPage.css');
    expect(css).toContain('var(--font-family-mono');
    expect(css).not.toContain('SFMono');
  });

  it('no file under src/ references the non-existent --font-mono name via var()', () => {
    const offenders = walk(srcDir)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(BAD_REFERENCE))
      .map((file) => path.relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it('--font-family-mono is actually defined in src/styles/variables.css', () => {
    const css = read('styles/variables.css');
    expect(css).toMatch(/--font-family-mono\s*:/);
  });
});
