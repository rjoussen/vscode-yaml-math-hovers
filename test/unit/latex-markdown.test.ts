import * as assert from 'assert';
import { createMathRenderer } from '../../src/math-renderer';
import { centerBaseline, createRenderBudget, renderLatexInMarkdown, MAX_MARKDOWN_LENGTH } from '../../src/latex-markdown';
import { unescapePlainTex } from '../../src/markdown-math';
import { isSingleSvg } from '../svg';

describe('LaTeX in Markdown', () => {
  const color = '#123456';
  const image = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g;

  function images(markdown: string): string[] {
    return [...markdown.matchAll(image)].map((match) => Buffer.from(match[1], 'base64').toString('utf8'));
  }

  async function render(markdown: string): Promise<string> {
    return (await renderLatexInMarkdown(markdown, color)).value;
  }

  function viewBox(svg: string): number[] {
    return /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
  }

  it('renders inline math as an SVG image', async () => {
    const result = await render('Energy $E = mc^2$ is conserved');

    assert.match(result, /^Energy !\[E = mc\^2\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\) is conserved$/);
    const [svg] = images(result);
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.ok(svg.includes(color));
    assert.ok(!svg.includes('currentColor'));
  });

  it('renders each equation as a single SVG', async () => {
    const matrix = '$$\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}$$';
    const relations = ['$a < b$', '$\\ce{N2 + 3H2 <=> 2NH3}$', '$x > 0 \\text{ \\& } y$'];
    for (const markdown of ['$E = mc^2$', '$a + b = c + d = e - f$', '$$a = b$$', '$x$', matrix, ...relations]) {
      for (const html of [false, true]) {
        const svgs = images((await renderLatexInMarkdown(markdown, color, html)).value);
        assert.strictEqual(svgs.length, 1, markdown);
        assert.ok(isSingleSvg(svgs[0]), `${markdown} is one SVG`);
      }
    }
    assert.ok(!isSingleSvg('<svg a=""></svg><svg b=""></svg>'), 'two SVGs side by side');
    assert.ok(!isSingleSvg('<svg a="<"></svg>'), '< in an attribute');
  });

  it('gives display math in a paragraph a paragraph of its own', async () => {
    const image = '[A-Za-z0-9+/=]+';
    const markdown = 'Energy $$E = mc^2$$. More';
    assert.match(
      await render(markdown),
      new RegExp(`^Energy \\n\\n!\\[E = mc\\^2\\]\\(data:image/svg\\+xml;base64,${image}\\)\\n\\n\\. More$`)
    );
    const html = await renderLatexInMarkdown(markdown, color, true);
    assert.match(
      html.value,
      new RegExp(
        `^Energy \\n\\n<p align="center"><img alt="E = mc\\^2" src="data:image/svg\\+xml;base64,${image}"></p>\\n\\n\\. More$`
      )
    );
    assert.strictEqual(html.html, true);
    assert.match(await render('- item $$x$$ more'), /^- item \n {2}\n {2}!\[x\]\(data:[^)]+\)\n {2}\n {3}more$/);
    assert.match(await render('> - item $$x$$ more'), /^> - item \n> {3}\n> {3}!\[x\]\(data:[^)]+\)\n> {3}\n> {4}more$/);
    assert.match(await render('- > quote $$x$$ more'), /^- > quote \n {2}> \n {2}> !\[x\]\(data:[^)]+\)\n {2}> \n {2}> {2}more$/);
    for (const inline of ['[link $$x$$](https://example.com)', '*emphasis $$x$$*', '# Heading $$x$$']) {
      assert.ok(!(await render(inline)).includes('\n'), `${inline} keeps its structure`);
    }
  });

  it('starts a list item with display math without a blank line', async () => {
    assert.match(await render('- $$x^2$$ more'), /^- !\[x\^2\]\(data:[^)]+\)\n {2}\n {3}more$/);
    assert.match(await render('1. $$\n   x\n   $$'), /^1\. !\[x\]\(data:[^)]+\)\n {3}\n {3}$/);
    assert.match(await render('-\n  $$x$$ more'), /^-\n {2}!\[x\]\(data:[^)]+\)\n {2}\n {3}more$/);
    assert.match(await render('> - $$x$$ more'), /^> - !\[x\]\(data:[^)]+\)\n> {3}\n> {4}more$/);
    assert.match(await render('$$x$$ more'), /^!\[x\]\(data:[^)]+\)\n\n more$/);
  });

  it('continues the containers of display math rather than its line', async () => {
    assert.match(await render('Text\n    more $$x$$ rest'), /^Text\n {4}more \n\n!\[x\]\(data:[^)]+\)\n\n rest$/);
    assert.match(await render('text\n2) $$x$$ rest'), /^text\n2\) \n\n!\[x\]\(data:[^)]+\)\n\n rest$/);
    assert.match(await render('> a\nb $$x$$ rest'), /^> a\nb \n> \n> !\[x\]\(data:[^)]+\)\n> \n> {2}rest$/);
    assert.match(await render('- a\nb $$x$$ rest'), /^- a\nb \n {2}\n {2}!\[x\]\(data:[^)]+\)\n {2}\n {3}rest$/);
    assert.match(await render('>- item $$x$$ more'), /^>- item \n> {3}\n> {3}!\[x\]\(data:[^)]+\)\n> {3}\n> {4}more$/);
    assert.match(await render('-\titem $$x$$ more'), /^-\titem \n {4}\n {4}!\[x\]\(data:[^)]+\)\n {4}\n {5}more$/);
    assert.match(await render('- a\n  - b $$x$$ c'), /^- a\n {2}- b \n {4}\n {4}!\[x\]\(data:[^)]+\)\n {4}\n {5}c$/);
  });

  it('renders display math in a paragraph of its own', async () => {
    const result = await render('Sum:\n$$\n\\sum_{i=1}^n i\n$$\nDone');

    assert.match(result, /^Sum:\n\n\n!\[\\\\sum\\_\\{i=1\\}\^n i\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)\n\n\nDone$/);
    assert.notStrictEqual(images(result)[0], images(await render('$\\sum_{i=1}^n i$'))[0], 'display style differs from inline');
  });

  it('renders multiple equations', async () => {
    const result = await render('$a$, $b_1$ and $$c^2$$ but not $5 or $10');

    assert.strictEqual(images(result).length, 3);
    assert.ok(result.endsWith(' but not $5 or $10'));
  });

  it('renders inline math padded with spaces only around TeX syntax', async () => {
    for (const markdown of ['$ v_{\\text{in,max}} $', 'tolerance $ \\epsilon_{r} $ used', 'ratio: $ r = 1/2 $)']) {
      assert.strictEqual(images(await render(markdown)).length, 1, markdown);
    }
    for (const markdown of ['costs 5 $ or 10 $', 'Set $AWS_REGION or $AWS_PROFILE', '$ x_1$ and $x_1 $', '$ $']) {
      assert.strictEqual(await render(markdown), markdown);
    }
  });

  it('preserves currency before an equation', async () => {
    for (const prose of ['Costs $5 and $10. Formula ', '$5, $10, and ']) {
      const result = await render(prose + '$x$');
      assert.ok(result.startsWith(prose));
      assert.strictEqual(images(result).length, 1);
    }
  });

  it('supports amsmath and bold symbols', async () => {
    assert.strictEqual(images(await render('$\\boldsymbol{\\sigma} = \\mathbb{C} : \\boldsymbol{\\varepsilon}$')).length, 1);
    assert.strictEqual(images(await render('$$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$')).length, 1);
  });

  it('ignores dollars in inline code', async () => {
    const markdown = 'Use `$HOME` or ``echo `$a$` `` but render $x$';
    const result = await render(markdown);

    assert.ok(result.startsWith('Use `$HOME` or ``echo `$a$` `` but render !['));
    assert.strictEqual(images(result).length, 1);
  });

  it('ignores dollars in fenced code blocks', async () => {
    const markdown = '```sh\necho $a$ $$b$$\n```\n~~~~\n$x$\n```\n$y$\n~~~~\n';

    assert.strictEqual(await render(markdown), markdown);
    assert.strictEqual(images(await render(markdown + '$z$')).length, 1, 'math after the fence is rendered');
    assert.strictEqual(await render('```\n$x$'), '```\n$x$', 'unclosed fence runs to the end');
  });

  it('keeps escaped dollars', async () => {
    assert.strictEqual(await render('costs \\$5 or \\$x\\$'), 'costs \\$5 or \\$x\\$');
    assert.strictEqual(images(await render('$\\$5 + x$')).length, 1, 'escaped dollar inside math');
  });

  it('keeps invalid LaTeX unchanged', async () => {
    const result = await render('bad $\\frac{a$ and $\\notacommand$, good $x$');

    assert.ok(result.startsWith('bad $\\frac{a$ and $\\notacommand$, good !['));
    assert.strictEqual(images(result).length, 1);
  });

  it('renders inline math as HTML aligned on the text baseline', async () => {
    const result = await renderLatexInMarkdown('Ratio $\\frac{a}{b} < 1$ and $$x$$', color, true);

    assert.strictEqual(result.html, true);
    assert.match(
      result.value,
      /^Ratio <img align="middle" alt="\\frac\{a\}\{b\} &#60; 1" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+">/
    );
    assert.match(
      result.value,
      / and \n\n<p align="center"><img alt="x" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"><\/p>\n\n$/,
      'display math gets a centered paragraph'
    );
    const [, minY, , height] = viewBox(images(result.value)[0]);
    assert.strictEqual(height, -2 * minY, 'baseline is in the middle');
  });

  it('centers the baseline of an SVG', async () => {
    const svg = createMathRenderer()('\\frac{a}{b}', false);
    const [minX, minY, width, height] = viewBox(svg);
    const centered = centerBaseline(svg);
    const half = Math.max(-minY, height + minY);

    assert.deepStrictEqual(viewBox(centered), [minX, -half, width, 2 * half]);
    const exHeight = (s: string): number => Number(/height="([\d.]+)ex"/.exec(s)![1]);
    assert.ok(Math.abs(exHeight(centered) - (exHeight(svg) * 2 * half) / height) < 0.001);
  });

  it('keeps Markdown images when the Markdown has HTML of its own', async () => {
    const withHtml = await renderLatexInMarkdown('<b>bold</b> $x$', color, true);
    assert.strictEqual(withHtml.html, false);
    assert.match(withHtml.value, /^<b>bold<\/b> !\[x\]\(data:/);
    const htmlEnabled = await renderLatexInMarkdown('<b>bold</b> $x$', color, true, undefined, true);
    assert.strictEqual(htmlEnabled.html, true, 'the Markdown already has HTML enabled');
    assert.match(htmlEnabled.value, /^<b>bold<\/b> <img align="middle" alt="x" src="data:/);

    for (const markdown of ['<https://example.com> $x$', '`<b>` $x$', '```\n<b>\n```\n$x$', 'a < b $x$']) {
      assert.strictEqual((await renderLatexInMarkdown(markdown, color, true)).html, true, markdown);
    }
    assert.strictEqual((await renderLatexInMarkdown('$\\notacommand$', color, true)).html, false, 'no math rendered');
    const link = await renderLatexInMarkdown('[$$x$$](https://example.com)', color, true);
    assert.match(
      link.value,
      /^\[<img align="middle" alt="x" src="data:[^"]+">\]\(https:\/\/example\.com\)$/,
      'display math in a link'
    );
    assert.strictEqual(link.html, true);
  });

  it('keeps text without math unchanged', async () => {
    for (const markdown of ['', 'plain text', 'a $ b', '$ a$', '$a $', '$$', '$$ $$', '$$a', 'line $a\nb$']) {
      assert.strictEqual(await render(markdown), markdown, JSON.stringify(markdown));
    }
  });

  const equations: Record<string, string> = {
    fractions: '\\frac{1}{1+x^2}',
    aligned: '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}',
    matrix: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
    cases: '\\begin{cases}x^2 & x>0\\\\-x & x\\le0\\end{cases}',
    newcommand: '\\newcommand{\\R}{\\mathbb{R}}\\R',
    def: '\\def\\R{\\mathbb{R}}\\R',
    mathtools: '\\prescript{14}{6}{\\mathrm{C}}',
    empheq: '\\begin{empheq}[left=\\empheqlbrace]{align}a&=b\\\\c&=d\\end{empheq}',
    cancel: '\\cancel{x}+\\bcancel{y}+\\cancelto{0}{z}',
    color: '\\color{red}{x}',
    bbox: '\\bbox[2px,border:1px solid red]{x}',
    enclose: '\\enclose{circle}{x}',
    physics: '\\dv{f}{x}+\\bra{\\psi}H\\ket{\\psi}',
    chemistry: '\\ce{2H2 + O2 -> 2H2O}',
    unicode: '\\unicode{x03B1}+\\upbeta',
    text: '\\text{some \\textbf{bold} text}+\\textdegree',
    arrows: 'a\\xtofrom{f}b',
    diagram: '\\begin{CD}A @>f>> B\\\\@VgVV @VVhV\\\\C @>>k> D\\end{CD}',
    textWithMath: '\\text{let $x$ be positive}',
  };
  for (const [name, equation] of Object.entries(equations)) {
    it(`renders ${name}`, async () => {
      assert.strictEqual(images(await render(`$$${equation}$$`)).length, 1, equation);
    });
  }

  it('leaves parentheses and bracket delimiters as text', async () => {
    for (const markdown of [
      'Inline \\(a_b*c\\), display \\[\\frac{a}{b}\\]',
      '\\[\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n\\]',
    ]) {
      assert.strictEqual(await render(markdown), markdown);
    }
  });

  // Mirrors how newer and older versions of yaml-language-server convert a plain `description` to Markdown.
  const plainEscapes = [/[\\`*_{}[\]#+!]/g, /[\\`*_{}[\]()#+\-.!]/g];
  let escapes = plainEscapes[0];
  function escapePlain(plain: string): string {
    return plain.replace(/([^\n\r])(\r?\n)([^\n\r])/gm, '$1\n\n$3').replace(escapes, '\\$&');
  }
  afterEach(() => {
    escapes = plainEscapes[0];
  });

  it('keeps parentheses and brackets of plain descriptions as text', async () => {
    for (escapes of plainEscapes) {
      for (const markdown of [
        escapePlain('Energy (in J) of the system [deprecated].'),
        '#### ' + escapePlain('Title (v2)'),
        '* `value`: ' + escapePlain('Mode (default) [x].'),
      ]) {
        assert.strictEqual(await render(markdown), markdown);
      }
    }
  });

  it('renders equations in plain descriptions', async () => {
    for (escapes of plainEscapes) {
      for (const [plain, tex] of [
        ['Ratio $\\frac{1}{2}$ (exact).', '\\frac{1}{2}'],
        ['Index $x_{i+1} - x_i$.', 'x_{i+1} - x_i'],
        ['Squared $x^{2}$.', 'x^{2}'],
        ['Milli $10^{-3}$.', '10^{-3}'],
        ['Energy $$E = \\frac{1}{2}mv^2$$ here.', 'E = \\frac{1}{2}mv^2'],
      ]) {
        const result = await render(escapePlain(plain));
        assert.deepStrictEqual(images(result), images(await render(plain.includes('$$') ? `$$${tex}$$` : `$${tex}$`)));
      }
      const fenced = await render(escapePlain('Aligned:\n$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n$$\nDone.'));
      assert.deepStrictEqual(images(fenced), images(await render('$$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$')));
      assert.match(fenced, /\nDone\\?\.$/);
      const result = await render(escapePlain('Energy ($E = mc^2$) in J.'));
      assert.match(result, /^Energy \\?\(!\[E = mc\^2\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)\\?\) in J\\?\.$/);
    }
  });

  it('recovers TeX from escaped plain text only', () => {
    assert.strictEqual(unescapePlainTex('\\\\frac\\{1\\}\\{2\\}'), '\\frac{1}{2}');
    assert.strictEqual(unescapePlainTex('x\\_1&emsp;\\+ y'), 'x_1 + y');
    assert.strictEqual(unescapePlainTex('\\frac{1}{2}'), '\\frac{1}{2}');
    assert.strictEqual(unescapePlainTex('x^\\{2\\}'), 'x^{2}');
    // Markdown TeX whose only backslashes precede punctuation reads like escaped plain text.
    assert.strictEqual(unescapePlainTex('\\{1, 2\\}'), '{1, 2}');
    assert.strictEqual(unescapePlainTex('\\lbrace 1, 2 \\rbrace'), '\\lbrace 1, 2 \\rbrace');
  });

  it('keeps TeX escapes in a paragraph that is not escaped plain text', async () => {
    // The image alt text escapes the TeX for Markdown: `x\_1` becomes `x\\\_1`, `x_1` becomes `x\_1`.
    assert.ok((await render('*Markdown* $x\\_1$')).includes('![x\\\\\\_1]'));
    assert.ok((await render('Markdown $\\alpha$ and $x\\_1$')).includes('![x\\\\\\_1]'));
    assert.ok((await render('Plain $x\\_1$')).includes('![x\\_1]'));
    // The language server puts enum values in code spans next to the escaped description.
    const enumValue = '`value`: ' + escapePlain('Index $x_{i+1}$.');
    assert.deepStrictEqual(images(await render(enumValue)), images(await render('$x_{i+1}$')));
  });

  it('keeps math left as source from reading as HTML when the hover enables HTML', async () => {
    const markdown = 'Rendered $x$ but not $\\notacommand<T>$';
    const html = await renderLatexInMarkdown(markdown, color, true);
    assert.strictEqual(html.html, true);
    assert.match(html.value, /^Rendered <img [^>]+> but not \$\\notacommand&lt;T>\$$/);
    assert.ok((await render(markdown)).endsWith(' but not $\\notacommand<T>$'), 'Markdown images need no escapes');
    const htmlEnabled = await renderLatexInMarkdown(markdown, color, true, undefined, true);
    assert.ok(htmlEnabled.value.endsWith(' but not $\\notacommand<T>$'), 'the Markdown already had HTML enabled');
  });

  it('keeps offsets after a byte order mark', async () => {
    assert.match(await render('﻿$x$ text'), /^﻿!\[x\]\(data:[^)]+\) text$/);
  });

  it('shares one time budget and leaves math as source once it is spent', async () => {
    const markdown = 'spent budget $y^2$';
    assert.strictEqual((await renderLatexInMarkdown(markdown, color, false, undefined, false, { ms: 0 })).value, markdown);
    assert.strictEqual(images(await render(markdown)).length, 1, 'a spent budget does not cache the source');
    const budget = createRenderBudget();
    const first = await renderLatexInMarkdown('cached $y^2$', color, false, undefined, false, budget);
    assert.strictEqual(images(first.value).length, 1);
    budget.ms = 0;
    const cached = await renderLatexInMarkdown('cached $y^2$', color, false, undefined, false, budget);
    assert.strictEqual(images(cached.value).length, 1, 'cached results need no budget');
  });

  it('preserves Markdown contexts and source bytes', async () => {
    const protectedMarkdown = [
      '    echo $HOME$',
      '\t$x$',
      '> ~~~sh\n> echo $HOME$\n> ~~~',
      '- example\n\n      echo $HOME$',
      '[reference](https://example.com/$x$)',
      '[reference]: https://example.com/$x$',
      '[reference](https://example.com "title $x$")',
      '<https://example.com/$x$>',
      'https://example.com/$x$',
      '![$x$](image.png)',
      '<span title="$x$">label</span>',
      '<!-- $x$ -->',
      '<pre>\n$x$\n</pre>',
      '`\\(x\\)`',
      '\\\\(x\\)',
    ];
    for (const markdown of protectedMarkdown) {
      assert.strictEqual(await render(markdown), markdown, markdown);
    }
    const original = '## Title\r\n\r\nBefore **$x$** after.\r\n\r\n[link](https://example.com)';
    const result = await render(original);
    assert.strictEqual(result.replace(/!\[x\]\(data:[^)]+\)/, '$x$'), original);
  });

  it('keeps display math in its list or blockquote', async () => {
    for (const prefix of ['> ', '  ']) {
      const markdown = `${
        prefix === '  ' ? '- Example\n\n' : ''
      }${prefix}$$\n${prefix}x^2\n${prefix}$$\n${prefix}Following text.`;
      const result = await render(markdown);
      assert.strictEqual(images(result).length, 1, markdown);
      assert.ok(result.includes(`\n${prefix}![`));
      assert.ok(result.endsWith(`${prefix}Following text.`));
    }
  });

  it('isolates labels and macros across descriptions, while allowing local definitions', async () => {
    const labeled = '$$x=1\\tag{1}\\label{test}$$';
    // Different prose avoids the transformation cache and exercises fresh MathJax sessions.
    for (const prose of ['first', 'second', 'third']) {
      assert.strictEqual(images(await render(`${prose} ${labeled}`)).length, 1);
    }
    const local = '$\\newcommand{\\local}{x}\\local$ then $\\local$';
    assert.strictEqual(images(await render(local)).length, 2);
    assert.strictEqual(await render('$\\local$'), '$\\local$');
    assert.strictEqual(images(await render('$\\newcommand{\\local}{y}\\local$')).length, 1);
  });

  it('keeps a 7 by 7 matrix and following prose below the hover limit', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => `a_{${i}${j}}`).join('&'));
    const tex = '\\begin{bmatrix}' + rows.join('\\\\') + '\\end{bmatrix}';
    const result = await render(`$$${tex}$$\nFollowing prose.`);
    assert.strictEqual(images(result).length, 1);
    assert.ok(images(result)[0].includes('<defs>'));
    assert.ok(result.length < MAX_MARKDOWN_LENGTH);
    assert.ok(result.endsWith('Following prose.'));
  });

  it('reserves space for all prose when equations exceed the output budget', async () => {
    const markdown = 'intro ' + '$x^2+1$ '.repeat(60) + 'a'.repeat(84_000) + ' trailing prose';
    const result = await render(markdown);
    assert.ok(images(result).length > 0);
    assert.ok(result.includes('$x^2+1$'));
    assert.ok(result.length <= MAX_MARKDOWN_LENGTH);
    assert.ok(result.endsWith('a'.repeat(84_000) + ' trailing prose'));
    const tooLong = '$x$ ' + 'a'.repeat(MAX_MARKDOWN_LENGTH);
    assert.strictEqual(await render(tooLong), tooLong);
  });

  it('falls back for excessive input or macro expansion', async () => {
    for (const markdown of ['$\\def\\loop{\\loop}\\loop$', '$' + 'x'.repeat(17_000) + '$']) {
      assert.strictEqual(await render(markdown), markdown);
    }
  });

  it('bounds repeated lookahead for unclosed delimiters', async function () {
    this.timeout(2000);
    const markdown = '$a{'.repeat(MAX_MARKDOWN_LENGTH / 3);
    assert.strictEqual(await render(markdown), markdown);
  });

  it('cancels without publishing partial transformations', async () => {
    let checks = 0;
    const markdown = 'cancel ' + '$x$ '.repeat(20);
    assert.deepStrictEqual(await renderLatexInMarkdown(markdown, color, true, () => ++checks > 3), {
      value: markdown,
      html: false,
      failures: [],
    });
  });

  it('reports equations that remain source', async () => {
    const { failures } = await renderLatexInMarkdown('Fails $\\notacommand{x}$ and $$A + B\\right)$$ but not $y$', color);
    assert.deepStrictEqual(failures, [
      { tex: '\\notacommand{x}', display: false, reason: 'Undefined control sequence \\notacommand', limit: false },
      { tex: 'A + B\\right)', display: true, reason: 'Missing \\left or extra \\right', limit: false },
    ]);
    const cached = await renderLatexInMarkdown('Fails $\\notacommand{x}$ and $$A + B\\right)$$ but not $y$', color);
    assert.deepStrictEqual(cached.failures, failures, 'cached results keep their failures');
    // Equations that no longer fit the hover also remain source, so check only the last failure.
    const many = await renderLatexInMarkdown('$x$ '.repeat(65), color);
    assert.deepStrictEqual(many.failures.at(-1), {
      tex: 'x',
      display: false,
      reason: 'More than 64 equations in one description; this and later ones remain source',
      limit: true,
    });
  });

  it('caches complete descriptions without sharing mutable results or theme colors', async () => {
    const first = await renderLatexInMarkdown('$x$', '#123456', true);
    const expected = first.value;
    first.value = 'changed';
    assert.strictEqual((await renderLatexInMarkdown('$x$', '#123456', true)).value, expected);
    const light = images((await renderLatexInMarkdown('$x$', '#000000', true)).value)[0];
    assert.ok(light.includes('#000000'));
    assert.ok(!light.includes('#123456'));
    assert.strictEqual((await renderLatexInMarkdown('$x$', '#123456', false)).html, false);
  });

  it('includes chemistry arrow glyphs instead of missing-character text', async () => {
    const [svg] = images(await render('$\\ce{2H2 + O2 -> 2H2O}$'));
    assert.ok(svg.includes('MHC-M'));
    assert.ok(!svg.includes('<text'));
  });

  it('preserves table and link structure around inline equations', async () => {
    const markdown = '| Name | Value |\n| --- | --- |\n| [formula $x$](https://example.com) | $$y^2$$ |';
    const result = await render(markdown);
    assert.strictEqual(images(result).length, 2);
    assert.strictEqual(result.split('\n').length, markdown.split('\n').length);
    assert.ok(result.includes('](https://example.com)'));
  });
});
