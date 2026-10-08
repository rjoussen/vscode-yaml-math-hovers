import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { renderLatexInMarkdown } from '../../src/latex-markdown';
import { toHoverMarkdown } from '../plain';

// Checks in Chromium, the engine of VS Code, that the images of rendered hovers display. Also writes
// out/images/gallery.html, which shows every hover of test/fixtures for a visual check.
const root = path.join(__dirname, '..', '..', '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'math.schema.json'), 'utf8')) as {
  properties: Record<string, { description?: string; markdownDescription?: string }>;
};

/** Converts hover Markdown to HTML. VS Code renders data URIs and, where the hover enables it, HTML. */
async function toHtml(markdown: string, html: boolean): Promise<string> {
  const [{ micromark }, { gfm, gfmHtml }] = await Promise.all([import('micromark'), import('micromark-extension-gfm')]);
  return micromark(markdown, {
    allowDangerousHtml: html,
    allowDangerousProtocol: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}

/** Returns the alt text of the images in the page that do not display. */
function brokenImages(): Promise<string[]> {
  return page.evaluate(`(async () => {
    const images = [...document.images];
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    return images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.closest('section').id + ': ' + image.alt);
  })()`);
}

// The hover styles of VS Code with the colors of its Dark Modern theme.
const STYLE = `
  body { font: 13px system-ui, sans-serif; background: #1f1f1f; color: #cccccc; margin: 8px; }
  h2 { font-size: 12px; color: #9cdcfe; margin: 12px 0 4px; }
  .hover { background: #202020; border: 1px solid #454545; border-radius: 4px; padding: 4px 8px; max-width: 500px;
    line-height: 1.5em; overflow: hidden; word-wrap: break-word; }
  .hover p, .hover ul, .hover h1, .hover h2, .hover h3, .hover h4 { margin: 8px 0; }
  .hover p:first-child, .hover ul:first-child { margin-top: 0; }
  .hover p:last-child, .hover ul:last-child { margin-bottom: 0; }
  .hover ul, .hover ol { padding-left: 20px; }
  .hover li > p { margin-bottom: 0; }
  .hover code { font-family: monospace; border-radius: 3px; padding: 0 0.4em; background: #ffffff1a; }
  .hover a { color: #4daafc; }
`;

let browser: Browser;
let page: Awaited<ReturnType<Browser['newPage']>>;

describe('Hover images in a browser', function () {
  this.timeout(60_000);

  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 560, height: 400 } });
  });

  after(async () => {
    await browser?.close();
  });

  it('displays every image of the fixture hovers', async () => {
    const sections: string[] = [];
    for (const [key, { description, markdownDescription }] of Object.entries(schema.properties)) {
      const plain = description !== undefined;
      const markdown = plain ? toHoverMarkdown(description) : (markdownDescription ?? '');
      // The colors of the default dark theme.
      const rendered = await renderLatexInMarkdown(markdown, '#cccccc', true);
      sections.push(
        `<section id="${key}"><h2>${key} (${plain ? 'description' : 'markdownDescription'})</h2>` +
          `<div class="hover">${await toHtml(rendered.value, rendered.html)}</div></section>`
      );
    }
    const gallery = `<!DOCTYPE html><style>${STYLE}</style>${sections.join('\n')}`;
    fs.mkdirSync(path.join(root, 'out', 'images'), { recursive: true });
    fs.writeFileSync(path.join(root, 'out', 'images', 'gallery.html'), gallery);
    await page.setContent(gallery);
    const broken = await brokenImages();

    assert.ok(Number(await page.evaluate('document.images.length')) > 50, 'the fixtures render many images');
    assert.deepStrictEqual(broken, []);
  });

  it('detects images that do not display', async () => {
    const image = (svg: string): string =>
      `<img alt="${svg.length}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
    const valid = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const invalid = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" data-latex="a < b"></svg>';
    await page.setContent(`<section id="check">${image(valid)}${image(invalid)}</section>`);
    assert.deepStrictEqual(await brokenImages(), [`check: ${invalid.length}`]);
  });
});
