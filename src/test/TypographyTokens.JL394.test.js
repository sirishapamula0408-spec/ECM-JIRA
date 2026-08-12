// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.resolve(__dirname, '..', 'pages');
const variablesCss = fs.readFileSync(
  path.resolve(__dirname, '..', 'styles', 'variables.css'),
  'utf8'
);

// The 13 pages migrated by JL-394.
const PAGES = [
  'ActivityFeedPage',
  'AdvancedRoadmapPage',
  'AutomationPage',
  'CrossProjectBoardPage',
  'GoalsPage',
  'InboundEmailPage',
  'KnowledgeBasePage',
  'PluginsPage',
  'PortfolioPage',
  'ReleasesPage',
  'SharedDashboardsPage',
  'WebhooksPage',
  'WikiPage',
];

const readPageCss = (page) =>
  fs.readFileSync(path.join(pagesDir, page, `${page}.css`), 'utf8');

describe('JL-394: typography tokens on the 13 migrated pages', () => {
  describe.each(PAGES)('%s.css', (page) => {
    const css = readPageCss(page);

    it('has no hardcoded font-size in px or rem', () => {
      const hardcoded = css.match(/font-size:\s*[\d.]+\s*(px|rem)/g) || [];
      expect(hardcoded).toEqual([]);
    });

    it('uses at least one typography token', () => {
      expect(css).toMatch(/var\(--font-size-[a-z]+\)/);
    });
  });

  it('InboundEmailPage uses the shared mono font token, not bare monospace', () => {
    const css = readPageCss('InboundEmailPage');
    expect(css).toMatch(/font-family:\s*var\(--font-family-mono\)/);
    expect(css).not.toMatch(/font-family:\s*monospace/);
  });

  it('every font-size token referenced by the 13 pages exists in variables.css', () => {
    const defined = new Set(
      (variablesCss.match(/--font-size-[a-z]+(?=\s*:)/g) || [])
    );
    expect(defined.size).toBeGreaterThan(0);

    for (const page of PAGES) {
      const css = readPageCss(page);
      const used = css.match(/(?<=var\()--font-size-[a-z]+(?=\))/g) || [];
      for (const token of used) {
        expect(defined, `${page}.css references undefined token ${token}`).toContain(token);
      }
    }
  });
});
