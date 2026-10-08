import type { CancellationToken, Hover, LogOutputChannel, Position, TextDocument } from 'vscode';
import { ColorThemeKind, MarkdownString, window, workspace } from 'vscode';
import type { MathFailure, RenderedMarkdown } from './latex-markdown.js';

/**
 * Renders LaTeX math in the Markdown contents of a YAML hover. The contents are changed in place. Equations that remain
 * source are logged to `log`.
 */
export async function renderMathInHover(
  hover: Hover,
  document: TextDocument,
  position: Position,
  token: CancellationToken,
  log?: LogOutputChannel
): Promise<undefined> {
  if (!workspace.getConfiguration('yamlMath', document.uri).get<boolean>('enable', true)) {
    return;
  }
  const contents = hover.contents.filter(
    (content): content is MarkdownString => content instanceof MarkdownString && content.value.includes('$')
  );
  if (!contents.length) {
    return;
  }
  // Evaluated on the first hover with math, so that activation does not initialize MathJax.
  const { createRenderBudget, renderLatexInMarkdown } = await import(/* webpackMode: "eager" */ './latex-markdown.js');
  const color = getEquationColor(window.activeColorTheme.kind);
  const cancelled = (): boolean => token.isCancellationRequested;
  const budget = createRenderBudget();
  const rendered: RenderedMarkdown[] = [];
  for (const content of contents) {
    rendered.push(await renderLatexInMarkdown(content.value, color, true, cancelled, content.supportHtml === true, budget));
  }
  if (token.isCancellationRequested) return;
  if (log) {
    const location = `${workspace.asRelativePath(document.uri)}:${position.line + 1}`;
    for (const failure of rendered.flatMap((result) => result.failures)) {
      const message = `${location}: ${failure.reason}: ${formatTex(failure)}`;
      if (failure.limit) log.info(message);
      else log.warn(message);
    }
  }
  contents.forEach((content, index) => {
    content.value = rendered[index].value;
    if (rendered[index].html) content.supportHtml = true;
  });
}

function formatTex({ tex, display }: MathFailure): string {
  const delimiter = display ? '$$' : '$';
  return delimiter + tex.replace(/\s+/g, ' ').trim() + delimiter;
}

/** Extensions cannot read theme colors, so approximate the hover foreground per theme kind. */
function getEquationColor(kind: ColorThemeKind): string {
  switch (kind) {
    case ColorThemeKind.Light:
      return '#333333';
    case ColorThemeKind.HighContrastLight:
      return '#000000';
    case ColorThemeKind.HighContrast:
      return '#ffffff';
    default:
      return '#cccccc';
  }
}
