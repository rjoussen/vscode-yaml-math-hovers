import { assert } from 'chai';
import * as vscode from 'vscode';
import { isSingleSvg } from '../svg';

interface Expectation {
  /** Number of rendered equations, or the range it lies in. */
  images: number | [number, number];
  /** Number of display equations in a centered paragraph of their own. */
  centered?: number;
  /**
   * Text that must remain in the hover, such as the source of equations that are not rendered. The text of plain
   * descriptions is matched as written in the schema, without the escapes of the language server.
   */
  source?: string[];
}

// One entry per key of test/fixtures/math.yaml, whose schema descriptions explain each case. Keys with a
// `markdownDescription` are marked; all others have a plain `description`.
const expectations: Record<string, Expectation> = {
  energy: { images: 3, centered: 1, source: ['`$HOME$`', '[reference](https://example.com/$x$)'] }, // Markdown
  ratio: { images: 1, source: ['(exact) [unitless]'] },
  mode: { images: 0, source: ['Mode (default: fast) [deprecated]'] },
  maxwell: { images: 1, centered: 1 },
  navierStokes: { images: 2, centered: 0 },
  hooke: { images: 2, centered: 1 },
  stiffnessMatrix: { images: 1, centered: 1 },
  piecewise: { images: 1, centered: 1 },
  macros: { images: 2 },
  labels: { images: 2, centered: 1 },
  chemistry: { images: 3 },
  physics: { images: 4 },
  diagram: { images: 1, centered: 1 },
  longInline: { images: 1, centered: 0 },
  padded: { images: 3 },
  vonMises: { images: 1, centered: 1 },
  sets: { images: 3 },
  // The list item's display equation is centered; the one in the link stays inline.
  structure: { images: 3, centered: 1 }, // Markdown
  ownHtml: { images: 1, centered: 0 }, // Markdown
  markdownSet: { images: 2 }, // Markdown
  invalidTex: { images: 1, source: ['$\\notacommand{x}$', '$\\frac{1}{2$'] },
  unbalancedRight: { images: 0, source: ['$f(x) = (a + b x^n\\right)$'] },
  textUnderscore: { images: 0, source: ['$|g| < \\text{DAMP_REG_FAC} \\cdot r$'] },
  unsupportedPackages: { images: 0, source: ['\\begin{tikzpicture}', '\\SI{3}{\\metre}'] },
  duplicateLabel: { images: 1, centered: 1, source: ['$$b = 2 \\label{same}$$'] },
  bracketDelimiters: { images: 0, source: ['\\(x^2\\)', '\\[x^2\\]'] }, // Markdown
  notMath: { images: 0, source: ['$5 and $10', '$HOME and $PATH', '5 $ or 10 $', 'unclosed $x'] },
  notMathMarkdown: { images: 0, source: ['\\$x\\$', '`$x$`', 'https://example.com/$x$'] }, // Markdown
  inlineAcrossLines: { images: 0, source: ['b$ cannot span'] },
  outputBudget: { images: [1, 68], source: ['$x_{69}$'] },
  tooLarge: { images: 0, source: ['\\begin{bmatrix}'] },
};

/** Removes the escapes that the language server adds to plain descriptions, also those of older versions. */
const unescapePlain = (value: string): string => value.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');

// Runs with this extension and a YAML extension that provides the hover transformer API.
describe('Math in YAML hovers', function () {
  this.timeout(30_000);
  let document: vscode.TextDocument;

  before(async () => {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'math.yaml');
    document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.extensions.getExtension('rjoussen.yaml-math-hovers')!.activate();
  });

  afterEach(async () => {
    await vscode.workspace.getConfiguration('yamlMath').update('enable', undefined, vscode.ConfigurationTarget.Workspace);
  });

  async function hover(key: string): Promise<string> {
    const line = document.getText().split('\n').indexOf(`${key}: 1`);
    assert.notStrictEqual(line, -1, `math.yaml has no key ${key}`);
    for (let attempt = 0; attempt < 60; attempt++) {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        new vscode.Position(line, 1)
      );
      const value = hovers
        .flatMap((result) => result.contents.map((content) => (typeof content === 'string' ? content : content.value)))
        .join('\n');
      if (value.trim()) return value;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    assert.fail('Schema hover did not become available');
  }

  const count = (value: string, pattern: RegExp): number => (value.match(pattern) || []).length;

  it('has an expectation for every key of the fixture', () => {
    const keys = document
      .getText()
      .split('\n')
      .filter((line) => /^\w+: 1$/.test(line))
      .map((line) => line.slice(0, -3));
    assert.deepStrictEqual(keys, Object.keys(expectations));
  });

  for (const [key, { images, centered, source = [] }] of Object.entries(expectations)) {
    it(`renders ${key} as expected`, async () => {
      const value = await hover(key);
      const svgs = [...value.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map(([, data]) =>
        new TextDecoder().decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)))
      );
      assert.ok(svgs.every(isSingleSvg), 'every image is one well-formed SVG');
      const rendered = svgs.length;
      if (typeof images === 'number') {
        assert.strictEqual(rendered, images, 'rendered equations');
      } else {
        assert.isAtLeast(rendered, images[0], 'rendered equations');
        assert.isAtMost(rendered, images[1], 'rendered equations');
      }
      if (centered !== undefined) assert.strictEqual(count(value, /<p align="center"><img /g), centered, 'centered equations');
      for (const text of source) {
        assert.ok(value.includes(text) || unescapePlain(value).includes(text), `hover contains ${text}`);
      }
    });
  }

  it('leaves hovers unchanged when disabled', async () => {
    await vscode.workspace.getConfiguration('yamlMath').update('enable', false, vscode.ConfigurationTarget.Workspace);
    const value = await hover('energy');
    assert.strictEqual(count(value, /data:image/g), 0);
    assert.include(value, '$E = mc^2$');
  });
});
