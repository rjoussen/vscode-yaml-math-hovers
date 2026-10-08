import { createMathRenderer } from './math-renderer';
import { parseMarkdownMath, MathSpan, MAX_TEX_LENGTH } from './markdown-math';

// VS Code truncates MarkdownString values at 100,000 characters, even inside image data URIs.
export const MAX_MARKDOWN_LENGTH = 90_000;
const MAX_EQUATIONS = 64;
// MathJax renders synchronously on the extension host, which all extensions share. Bound the time one hover
// takes, and yield between equations once this long has passed without yielding.
const MAX_RENDER_MS = 250;
const YIELD_MS = 10;
const CACHE_CHARACTERS = 1_000_000;
const cache = new Map<string, RenderedMarkdown>();
let cacheCharacters = 0;
// Whether MathJax rendered before, so that its initialization no longer counts against the budget.
let warm = false;

export interface RenderedMarkdown {
  value: string;
  /** Enable HTML only when the transformation inserted an HTML image. */
  html: boolean;
  /** Equations that remain source, for debugging. */
  failures: MathFailure[];
}

/** An equation that remains source, and why. */
export interface MathFailure {
  tex: string;
  display: boolean;
  reason: string;
  /** Whether a limit of this extension left the equation as source, rather than invalid or unsupported TeX. */
  limit: boolean;
}

/** The milliseconds left to render math in one hover, shared by all of its Markdown contents. */
export interface RenderBudget {
  ms: number;
}

export function createRenderBudget(): RenderBudget {
  return { ms: MAX_RENDER_MS };
}

/**
 * Render math without changing surrounding Markdown or losing prose to VS Code's size limit. HTML images are used when
 * `allowHtml` is set and the Markdown has no HTML of its own, or when the Markdown already has HTML enabled.
 */
export async function renderLatexInMarkdown(
  markdown: string,
  color: string,
  allowHtml = false,
  cancelled: () => boolean = () => false,
  htmlEnabled = false,
  budget: RenderBudget = createRenderBudget()
): Promise<RenderedMarkdown> {
  const original = { value: markdown, html: false, failures: [] };
  if (cancelled() || markdown.length > MAX_MARKDOWN_LENGTH || !markdown.includes('$')) return original;
  const key = JSON.stringify([markdown, color, allowHtml, htmlEnabled]);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return { ...cached, failures: [...cached.failures] };
  }
  if (budget.ms <= 0) return original;
  // A later hover may render more within the budget when this one shares it or initializes MathJax. Otherwise
  // equations beyond the budget remain source, also in later hovers, which then cost no rendering time.
  const fullBudget = warm && budget.ms >= MAX_RENDER_MS;
  let started = Date.now();
  const { spans, hasHtml } = await parseMarkdownMath(markdown);
  if (cancelled() || !spans.length) return original;
  const render = createMathRenderer();
  budget.ms -= Date.now() - started;
  const html = htmlEnabled || (allowHtml && !hasHtml);
  // Once the hover enables HTML for the images, math left as source must not read as HTML, as `<T>` in `$List<T>$`.
  const escapeSource = html && !htmlEnabled;
  const sourceOf = (span: MathSpan): string => {
    const source = markdown.slice(span.start, span.end);
    return escapeSource ? source.replace(/(?<!\\)</g, '&lt;') : source;
  };
  const images = new Map<MathSpan, string>();
  const failures: MathFailure[] = [];
  const fail = (span: MathSpan, reason: string, limit: boolean): void => {
    failures.push({ tex: span.tex, display: span.display, reason, limit });
  };
  let size = spans.reduce((total, span) => total + sourceOf(span).length - (span.end - span.start), markdown.length);
  let truncated = false;
  let yielded = Date.now();
  for (const [index, span] of spans.entries()) {
    if (index >= MAX_EQUATIONS) {
      fail(span, `More than ${MAX_EQUATIONS} equations in one description; this and later ones remain source`, true);
      break;
    }
    // Yield to the extension host so other extensions run and cancellation can be observed.
    if (Date.now() - yielded >= YIELD_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      yielded = Date.now();
    }
    if (cancelled()) return original;
    // Equations beyond the time budget remain as source.
    if (budget.ms <= 0) {
      fail(span, `The hover spent its ${MAX_RENDER_MS} ms rendering time; this and later equations remain source`, true);
      truncated = true;
      break;
    }
    if (span.tex.length > MAX_TEX_LENGTH) {
      fail(span, `Longer than ${MAX_TEX_LENGTH} characters`, true);
      continue;
    }
    let image: string;
    started = Date.now();
    try {
      const svg = render(span.tex, span.display).replace(/currentColor/g, color);
      image = svgToImage(svg, span, html);
    } catch (error) {
      // Invalid/unsupported TeX and MathJax's expansion limits leave the source intact.
      // MathJax's TexError is no Error, but has a message.
      const message = (error as { message?: unknown } | undefined)?.message;
      fail(span, typeof message === 'string' ? message : String(error), false);
      continue;
    } finally {
      budget.ms -= Date.now() - started;
      warm = true;
    }
    const nextSize = size + image.length - sourceOf(span).length;
    if (nextSize > MAX_MARKDOWN_LENGTH) {
      fail(span, `The hover would exceed VS Code's limit of ${MAX_MARKDOWN_LENGTH} characters`, true);
      continue;
    }
    images.set(span, image);
    size = nextSize;
  }
  const usedHtml = html && images.size > 0;
  const chunks: string[] = [];
  let offset = 0;
  for (const span of spans) {
    const replacement = images.get(span) ?? (usedHtml ? sourceOf(span) : undefined);
    if (replacement === undefined) continue;
    chunks.push(markdown.slice(offset, span.start), replacement);
    offset = span.end;
  }
  chunks.push(markdown.slice(offset));
  const result = { value: chunks.join(''), html: usedHtml, failures };
  if (truncated && !fullBudget) return result;
  const cost = key.length + result.value.length;
  while (cache.size && cacheCharacters + cost > CACHE_CHARACTERS) {
    const oldest = cache.keys().next().value as string;
    cacheCharacters -= oldest.length + (cache.get(oldest)?.value.length ?? 0);
    cache.delete(oldest);
  }
  const previous = cache.get(key);
  if (previous) cacheCharacters -= key.length + previous.value.length;
  cache.set(key, result);
  cacheCharacters += cost;
  return { ...result, failures: [...failures] };
}

function svgToImage(svg: string, span: MathSpan, html: boolean): string {
  const { tex, display, block, prefix, separate } = span;
  const htmlAlt = tex.replace(/\s+/g, ' ').replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);
  // Inline math, and display math that cannot get a paragraph of its own, sits on the text baseline.
  if (html && !block) {
    return `<img align="middle" alt="${htmlAlt}" src="data:image/svg+xml;base64,${toBase64(centerBaseline(svg))}">`;
  }
  const alt = tex.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]()#+\-.!<>|$]/g, '\\$&');
  const image =
    html && block
      ? `<p align="center"><img alt="${htmlAlt}" src="data:image/svg+xml;base64,${toBase64(svg)}"></p>`
      : `![${alt}](data:image/svg+xml;base64,${toBase64(svg)})`;
  if (!block) return image;
  return `${separate ? `\n${prefix}\n${prefix}` : ''}${image}\n${prefix}\n${prefix}`;
}

/**
 * Pads a MathJax SVG vertically so the math baseline is in its middle. An `<img align="middle">` has its middle on the
 * text baseline, so the baselines line up, also for fractions and other math that reaches far below the baseline.
 */
export function centerBaseline(svg: string): string {
  const viewBox = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  const height = /height="([\d.]+)ex"/.exec(svg);
  if (!viewBox || !height) {
    return svg;
  }
  // MathJax puts the baseline at y = 0, `minY` is minus the height above it
  const [minX, minY, width, boxHeight] = viewBox.slice(1).map(Number);
  const half = Math.max(-minY, boxHeight + minY);
  return svg
    .replace(viewBox[0], `viewBox="${minX} ${-half} ${width} ${2 * half}"`)
    .replace(height[0], `height="${((Number(height[1]) * 2 * half) / boxHeight).toFixed(3)}ex"`);
}

function toBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  // web worker
  let binary = '';
  new TextEncoder().encode(text).forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}
