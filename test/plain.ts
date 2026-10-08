/** Converts a plain `description` to Markdown the way yaml-language-server does for hovers. */
export function toHoverMarkdown(plain: string): string {
  return plain.replace(/([^\n\r])(\r?\n)([^\n\r])/gm, '$1\n\n$3').replace(/[\\`*_{}[\]#+!]/g, '\\$&');
}
