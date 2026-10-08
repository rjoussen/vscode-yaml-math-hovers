import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js';
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js';
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import { MAX_TEX_LENGTH } from './markdown-math';

const PACKAGES = [
  'base',
  'ams',
  'amscd',
  'boldsymbol',
  'newcommand',
  'configmacros',
  'mathtools',
  'cases',
  'empheq',
  'cancel',
  'color',
  'bbox',
  'enclose',
  'extpfeil',
  'unicode',
  'upgreek',
  'textmacros',
  'textcomp',
  'gensymb',
  'physics',
  'mhchem',
];

MathJaxTexFont.addExtension(MathJaxMhchemFontExtension);

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/** A session belongs to one description: labels and user macros never cross hover boundaries. */
export function createMathRenderer(): (tex: string, display: boolean) => string {
  const document = mathjax.document('', {
    InputJax: new TeX({
      // An explicit, offline package set. Autoload and require need MathJax's component loader.
      packages: PACKAGES,
      maxMacros: 1000,
      maxBuffer: MAX_TEX_LENGTH,
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    }),
    OutputJax: new SVG({
      fontData: MathJaxTexFont,
      // Each SVG contains its own glyph definitions, including those reused by <use> elements.
      fontCache: 'local',
      localID: 'hover',
      // An image holds a single SVG, so inline math must not be broken into several.
      linebreaks: { inline: false },
    }),
  });
  // An image must be well-formed XML, but the HTML serialization keeps the `<` of TeX like `a < b` in attributes
  // such as `data-latex`. The data attributes are not needed to draw the math.
  return (tex, display) => adaptor.innerHTML(document.convert(tex, { display })).replace(/ data-[\w-]+="[^"]*"/g, '');
}
