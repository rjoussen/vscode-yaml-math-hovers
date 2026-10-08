/** Whether the text is one well-formed SVG element. MathJax nests SVG elements, for example for matrices and tags. */
export function isSingleSvg(svg: string): boolean {
  if (!svg.startsWith('<svg ')) return false;
  // XML does not allow `<` in attribute values or a `&` that does not start an entity.
  if (/="[^"]*</.test(svg) || /&(?!(?:[a-z]+|#\d+|#x[\da-f]+);)/i.test(svg)) return false;
  let depth = 0;
  for (const match of svg.matchAll(/<\/?svg\b/g)) {
    depth += match[0] === '</svg' ? -1 : 1;
    if (depth === 0) return match.index + '</svg>'.length === svg.length && svg.endsWith('</svg>');
  }
  return false;
}
