// Runs the integration tests in the web extension host, see `npm run test:web`.
import 'mocha/mocha';

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({ ui: 'bdd', reporter: undefined, timeout: 30_000 });
    require('../integration/hover.test');
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} tests failed.`)) : resolve()));
  });
}
