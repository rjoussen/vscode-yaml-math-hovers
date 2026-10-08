// The subset of micromark's tokenizer API used by the delimiter extension below.
type Code = number | null;
type State = (code: Code) => State | undefined;
type MathToken = 'mathText' | 'mathTextSequence' | 'mathTextData' | 'lineEnding';
interface Effects {
  enter(type: MathToken): unknown;
  exit(type: MathToken): unknown;
  consume(code: Code): void;
}

/** The longest TeX of an equation that is rendered. Longer equations remain source. */
export const MAX_TEX_LENGTH = 16 * 1024;

export interface MathSpan {
  start: number;
  end: number;
  tex: string;
  display: boolean;
  /** Continuation prefix for display equations inside lists and blockquotes. */
  prefix: string;
  /** Whether a display equation is shown in a paragraph of its own. */
  block: boolean;
  /** Whether a block equation needs a blank line before it, i.e. it does not start its paragraph or list item. */
  separate: boolean;
}

// The subset of micromark's events read by `findMath` below.
interface Token {
  type: string;
  start: { offset: number };
  end: { offset: number };
}
type Event = ['enter' | 'exit', Token, { sliceSerialize(token: Pick<Token, 'start' | 'end'>): string }];

// Tokens of the blockquote and list markers and indentation that precede a block's content on its line.
const CONTAINER_TOKENS = new Set([
  'blockQuote',
  'blockQuotePrefix',
  'blockQuoteMarker',
  'blockQuotePrefixWhitespace',
  'listOrdered',
  'listUnordered',
  'listItemPrefix',
  'listItemValue',
  'listItemMarker',
  'listItemPrefixWhitespace',
  'listItemIndent',
  'linePrefix',
  'lineEnding',
  'lineEndingBlank',
]);
// Tokens whose text is checked for escaped plain text, as a whole, around the equations in it.
const TEXT_TOKENS = new Set(['paragraph', 'atxHeadingText', 'setextHeadingText', 'tableHeader', 'tableData']);

/** Use CommonMark tokens and their original offsets; never serialize the surrounding Markdown. */
export async function parseMarkdownMath(markdown: string): Promise<{ spans: MathSpan[]; hasHtml: boolean }> {
  const [{ parse, preprocess, postprocess }, { math }, { gfm }] = await Promise.all([
    import(/* webpackMode: "eager", webpackExports: ["parse", "preprocess", "postprocess"] */ 'micromark'),
    import(/* webpackMode: "eager", webpackExports: ["math"] */ 'micromark-extension-math'),
    import(/* webpackMode: "eager", webpackExports: ["gfm"] */ 'micromark-extension-gfm'),
  ]);
  const extension = math();
  // Failed delimiter matches rewind the tokenizer. Bound the total lookahead so repeated
  // unclosed equations cannot make parsing quadratic in the description's length.
  const budget = { remaining: markdown.length * 4 };
  // Retain the library's container-aware display fences, but use Pandoc dollar rules for inline math.
  extension.text = {
    36: { tokenize: (effects: Effects, ok: State, nok: State): State => tokenizeMath(effects, ok, nok, budget) },
  };
  const events: Event[] = postprocess(
    parse({ extensions: [gfm(), extension] })
      .document()
      .write(preprocess()(markdown, undefined, true))
  );
  // micromark drops a leading byte order mark, so its offsets start one character later in `markdown`.
  return findMath(markdown, events, markdown.charCodeAt(0) === 0xfeff ? 1 : 0);
}

function findMath(markdown: string, events: Event[], shift: number): { spans: MathSpan[]; hasHtml: boolean } {
  const spans: MathSpan[] = [];
  let hasHtml = false;
  let inImage = 0;
  const open: Token[] = [];
  // Open blockquotes and lists, outermost first, with the indentation of the current list item's content.
  const containers: { quote: boolean; width: number }[] = [];
  // Where the last blockquote or list prefix ended, and whether no content followed the last list item's marker.
  let prefixEnd = 0;
  let itemStart = false;
  const codeSpans = events.filter(([kind, token]) => kind === 'enter' && token.type === 'codeText').map(([, token]) => token);
  const plainText = new Map<Token, boolean>();
  for (let i = 0; i < events.length; i++) {
    const [kind, token, context] = events[i];
    const parent = open[open.length - 1];
    if (kind === 'enter') open.push(token);
    else open.pop();
    if (token.type === 'image') inImage += kind === 'enter' ? 1 : -1;
    if (token.type === 'blockQuote' || token.type === 'listOrdered' || token.type === 'listUnordered') {
      if (kind === 'enter') containers.push({ quote: token.type === 'blockQuote', width: 2 });
      else containers.pop();
    }
    if (kind !== 'enter') {
      if (token.type === 'listItemPrefix' && containers.length) {
        // The content of a list item is indented relative to the content of its parent on the marker's line, which
        // starts after the parent's prefix, and one space after a marker that ends its line.
        const sameLine = !/[\r\n]/.test(markdown.slice(prefixEnd, token.start.offset + shift));
        const blank = /[ \t]$/.test(context.sliceSerialize(token)) ? 0 : 1;
        const width = column(markdown, token.end.offset + shift) - (sameLine ? column(markdown, prefixEnd) : 0) + blank;
        containers[containers.length - 1].width = width;
        itemStart = true;
      }
      if (token.type === 'listItemPrefix' || token.type === 'listItemIndent' || token.type === 'blockQuotePrefix') {
        prefixEnd = token.end.offset + shift;
      }
      continue;
    }
    const firstInItem = itemStart;
    if (!CONTAINER_TOKENS.has(token.type)) itemStart = false;
    if (inImage) continue;
    if (token.type === 'htmlText' || token.type === 'htmlFlow') hasHtml = true;
    if (token.type !== 'mathText' && token.type !== 'mathFlow') continue;
    const start = token.start.offset + shift;
    const end = token.end.offset + shift;
    const source = context.sliceSerialize(token);
    let tex: string;
    let display: boolean;
    if (token.type === 'mathFlow') {
      const values: string[] = [];
      let fences = 0;
      for (let j = i + 1; j < events.length && events[j][1] !== token; j++) {
        const [action, child, childContext] = events[j];
        if (action !== 'enter') continue;
        if (child.type === 'mathFlowFenceSequence') fences++;
        if (child.type === 'mathFlowValue') values.push(childContext.sliceSerialize(child));
      }
      // Unclosed fences and fence metadata are not equations.
      if (fences !== 2 || !/^\${2,}[ \t]*\r?\n/.test(source)) continue;
      tex = values.join('\n');
      display = true;
    } else {
      display = source.startsWith('$$');
      tex = source.slice(display ? 2 : 1, display ? -2 : -1);
    }
    if (!tex.trim()) continue;
    // The language server escapes a plain description as a whole, so the text around the equation must read like
    // escaped plain text too. Code spans are excluded, the language server adds them around enum values.
    const text = [...open].reverse().find((ancestor) => TEXT_TOKENS.has(ancestor.type));
    if (text && !plainText.has(text)) {
      let content = '';
      let offset = text.start.offset;
      for (const code of codeSpans) {
        if (code.start.offset < offset || code.end.offset > text.end.offset) continue;
        content += markdown.slice(offset + shift, code.start.offset + shift);
        offset = code.end.offset;
      }
      plainText.set(text, isEscapedPlainText(content + markdown.slice(offset + shift, text.end.offset + shift)));
    }
    spans.push({
      start,
      end,
      tex: unescapePlainTex(tex.trim(), !text || plainText.get(text)),
      display,
      // Display math directly in a paragraph gets a paragraph of its own, as in LaTeX. In a link, emphasis,
      // heading or table cell, splitting the paragraph would break the surrounding Markdown.
      block: display && (token.type === 'mathFlow' || parent?.type === 'paragraph'),
      prefix: containers.map(({ quote, width }) => (quote ? '> ' : ' '.repeat(width))).join(''),
      // A list item cannot start with a blank line, and nothing precedes math that starts its paragraph or item.
      separate: token.type === 'mathFlow' ? !firstInItem : parent?.start.offset !== token.start.offset,
    });
  }
  return { spans, hasHtml };
}

/** The column at which `offset` lies in its line, with tabs expanded to tab stops of 4, as in CommonMark. */
function column(markdown: string, offset: number): number {
  let result = 0;
  for (let i = markdown.lastIndexOf('\n', offset - 1) + 1; i < offset; i++) {
    if (markdown[i] !== '﻿') result = markdown[i] === '\t' ? result + 4 - (result % 4) : result + 1;
  }
  return result;
}

// The YAML language server escapes these characters when it converts a plain `description` to Markdown.
// Older versions also escape the characters of `OLDER_PLAIN_ESCAPES`.
const PLAIN_ESCAPES = '\\`*_{}[]#+!';
const OLDER_PLAIN_ESCAPES = '()-.';

/** Whether the text could have been produced by escaping plain text, i.e. its Markdown punctuation is escaped. */
export function isEscapedPlainText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      const escaped = text[++i] ?? 'x';
      if (!PLAIN_ESCAPES.includes(escaped) && !OLDER_PLAIN_ESCAPES.includes(escaped)) return false;
    } else if (PLAIN_ESCAPES.includes(text[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Recovers the TeX of an equation in a plain `description`, which the language server escaped. The hover does not
 * tell plain from Markdown descriptions, so TeX that reads exactly like escaped plain text is unescaped, unless the
 * text around it shows that it is Markdown (`plainContext` is false).
 */
export function unescapePlainTex(tex: string, plainContext = true): string {
  const unescaped = tex.replace(/&emsp;/g, ' ');
  return plainContext && isEscapedPlainText(unescaped) ? unescaped.replace(/\\(.)/g, '$1') : unescaped;
}

/** Consume TeX before Markdown can interpret its underscores, brackets, or asterisks. */
function tokenizeMath(effects: Effects, ok: State, nok: State, budget: { remaining: number }): State {
  let display = false;
  let escaped = false;
  let braces = 0;
  let length = 0;
  let last: Code;
  let inData = false;
  // Whether inline math is padded like `$ x $`, and whether its content contains TeX syntax.
  let padded = false;
  let texLike = false;
  return start;

  function endData(): void {
    if (inData) effects.exit('mathTextData');
    inData = false;
  }
  function start(code: Code): State | undefined {
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    return opening;
  }
  function opening(code: Code): State | undefined {
    if (code !== 36) {
      if (code === null || code < -2) return nok(code);
      padded = space(code);
      effects.exit('mathTextSequence');
      return content(code);
    }
    display = true;
    effects.consume(code);
    effects.exit('mathTextSequence');
    return content;
  }
  function content(code: Code): State | undefined {
    if (--budget.remaining < 0 || code === null || (!display && code < -2) || ++length > MAX_TEX_LENGTH) return nok(code);
    if (code < -2) {
      endData();
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      last = code;
      return content;
    }
    if (!escaped) {
      if (code === 36 && braces === 0) {
        // A dollar after whitespace cannot close inline math, so that `$5 or $10` stays text. Padding on both
        // sides is accepted around TeX syntax, as in `$ \\alpha_1 $`. Otherwise retry the dollar as an opener.
        if (!display && (space(last) !== padded || (padded && !texLike))) return nok(code);
        endData();
        effects.enter('mathTextSequence');
        effects.consume(code);
        return display ? closingDollar : after;
      }
      if (code === 123) braces++;
      if (code === 125) braces = Math.max(0, braces - 1);
    }
    texLike ||= (last === 92 && /[a-zA-Z]/.test(String.fromCharCode(code))) || [61, 94, 95, 123, 125].includes(code);
    escaped = !escaped && code === 92;
    last = code;
    if (!inData) effects.enter('mathTextData');
    inData = true;
    effects.consume(code);
    return content;
  }
  function closingDollar(code: Code): State | undefined {
    if (code !== 36) {
      effects.exit('mathTextSequence');
      return content(code);
    }
    effects.consume(code);
    return after;
  }
  function after(code: Code): State | undefined {
    if (!display && code !== null && code >= 48 && code <= 57) return nok(code);
    effects.exit('mathTextSequence');
    effects.exit('mathText');
    return ok(code);
  }
}

function space(code: Code): boolean {
  return code === null || code < 0 || code === 32;
}
