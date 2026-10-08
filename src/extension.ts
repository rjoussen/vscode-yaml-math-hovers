import type { CancellationToken, Disposable, ExtensionContext, Hover, Position, ProviderResult, TextDocument } from 'vscode';
import { extensions, window } from 'vscode';
import { renderMathInHover } from './hover';

/** The part of the API of the YAML extension (redhat.vscode-yaml) that this extension uses. */
interface YamlExtensionAPI {
  registerHoverTransformer?(
    transformer: (hover: Hover, document: TextDocument, position: Position, token: CancellationToken) => ProviderResult<Hover>
  ): Disposable;
}

export async function activate(context: ExtensionContext): Promise<void> {
  const yaml = extensions.getExtension<YamlExtensionAPI | undefined>('redhat.vscode-yaml');
  const api = await yaml?.activate();
  if (typeof api?.registerHoverTransformer !== 'function') {
    // Warn once per version of the YAML extension, not in every window.
    const version = String(yaml?.packageJSON.version);
    if (context.globalState.get('warnedYamlVersion') !== version) {
      void context.globalState.update('warnedYamlVersion', version);
      void window.showWarningMessage(
        'YAML Math Hovers needs a version of the YAML extension (redhat.vscode-yaml) that supports hover transformers.'
      );
    }
    return;
  }
  const log = window.createOutputChannel('YAML Math Hovers', { log: true });
  context.subscriptions.push(
    log,
    api.registerHoverTransformer((hover, document, position, token) => renderMathInHover(hover, document, position, token, log))
  );
}
