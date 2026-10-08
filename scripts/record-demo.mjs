// Records the hover demo of the README: the same hovers without and with rendered math, frame for frame.
// Screenshots replace a screen recording, so that both runs are identical except for the math.
// Needs the webpack build of this extension, the YAML extension at ../vscode-yaml (or VSCODE_YAML_PATH), and ffmpeg.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import testElectron from '@vscode/test-electron';

const root = path.resolve(import.meta.dirname, '..');
const yamlExtension = path.resolve(root, process.env.VSCODE_YAML_PATH ?? '../vscode-yaml');
const fixture = path.join(root, 'test', 'fixtures', 'math.yaml');
const frames = path.join(root, 'out', 'demo');
const images = path.join(root, 'images');

const KEYS = ['hooke', 'stiffnessMatrix', 'piecewise', 'labels', 'chemistry', 'diagram'];
// The key of the still comparison image.
const COMPARISON_KEY = 'hooke';
const SIZE = { width: 860, height: 540 };
// How long each frame shows, before and while the hover is open.
const CURSOR_SECONDS = 0.5;
const HOVER_SECONDS = 2.2;
// The label colors are the error and success colors of the Dark Modern theme.
const RUNS = [
  { name: 'not-rendered', label: '✗  Without YAML Math Hovers', color: 'f48771', enable: false },
  { name: 'rendered', label: '✓  With YAML Math Hovers', color: '89d185', enable: true },
];

// A clean window: no sidebars, tabs, status bar, AI features, notifications or editor decorations besides the hover.
const SETTINGS = {
  'breadcrumbs.enabled': false,
  'chat.disableAIFeatures': true,
  // The YAML extension shows the schema of the file in a code lens.
  'editor.codeLens': false,
  'editor.cursorBlinking': 'solid',
  'editor.minimap.enabled': false,
  'editor.occurrencesHighlight': 'off',
  // Room above the keys, so that every hover opens above its key in both runs.
  'editor.padding.top': 40,
  'editor.renderLineHighlight': 'none',
  'editor.scrollbar.horizontal': 'hidden',
  'editor.scrollbar.vertical': 'hidden',
  'editor.selectionHighlight': false,
  'git.enabled': false,
  'redhat.telemetry.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'window.menuBarVisibility': 'hidden',
  'workbench.activityBar.location': 'hidden',
  // Newer versions of VS Code default to another theme.
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.editor.showTabs': 'none',
  'workbench.layoutControl.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.startupEditor': 'none',
  'workbench.statusBar.visible': false,
  'workbench.tips.enabled': false,
  'yaml.schemaStore.enable': false,
};

const lines = fs.readFileSync(fixture, 'utf8').split('\n');
const lineOf = (key) => {
  const index = lines.indexOf(`${key}: 1`);
  if (index === -1) throw new Error(`math.yaml has no key ${key}`);
  return index + 1;
};

// Run from VS Code, the environment would start VS Code as Node.js, with the paths of the running VS Code or its snap.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(VSCODE_|ELECTRON_|SNAP|GTK_|GDK_|GIO_)/.test(name))
);
if (process.env.XDG_DATA_DIRS_VSCODE_SNAP_ORIG) env.XDG_DATA_DIRS = process.env.XDG_DATA_DIRS_VSCODE_SNAP_ORIG;
delete env.XDG_DATA_DIRS_VSCODE_SNAP_ORIG;
const executablePath = await testElectron.downloadAndUnzipVSCode({ cachePath: path.join(root, '.vscode-test') });
const boxes = {};
for (const run of RUNS) {
  boxes[run.name] = await record(run);
}
assemble(boxes);

/** Shows the hover of every key in a fresh VS Code and takes a screenshot before and while it is open. */
async function record({ name, enable }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-math-demo-'));
  fs.mkdirSync(path.join(userData, 'User'));
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({ ...SETTINGS, 'yamlMath.enable': enable }));
  const dir = path.join(frames, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Playwright's Electron support crashes VS Code, so connect to its DevTools port instead.
  const port = await freePort();
  const code = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-extensions',
      '--force-device-scale-factor=1',
      // Keep painting while the window is covered by other windows.
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      `--user-data-dir=${userData}`,
      `--extensions-dir=${path.join(userData, 'extensions')}`,
      `--extensionDevelopmentPath=${root}`,
      `--extensionDevelopmentPath=${yamlExtension}`,
      fixture,
    ],
    { env, stdio: 'ignore' }
  );
  const exited = new Promise((resolve) => code.on('exit', resolve));
  const result = {};
  try {
    const page = await connect(port, exited);
    await page.setViewportSize(SIZE);
    await page.bringToFront();
    await page.locator('.monaco-editor .view-line', { hasText: 'stiffnessMatrix' }).first().waitFor({ timeout: 60_000 });
    await page.addStyleTag({ content: '.notifications-toasts, .notifications-center { display: none !important; }' });
    if (await page.locator('[id="workbench.parts.sidebar"]').isVisible()) await page.keyboard.press('Control+B');
    if (await page.locator('[id="workbench.parts.auxiliarybar"]').isVisible()) await page.keyboard.press('Control+Alt+B');
    await page.locator('.monaco-editor .view-lines').first().click();
    // The screenshots leave out the title bar. A native title bar would crash VS Code under Wayland.
    const titleBar = (await page.locator('[id="workbench.parts.titlebar"]').boundingBox())?.height ?? 0;
    const clip = { x: 0, y: titleBar, width: SIZE.width, height: SIZE.height - titleBar };
    // The language server loads the schema, and MathJax initializes, on the first hover.
    await showHover(page, KEYS[0], enable);
    await page.keyboard.press('Escape');
    for (const [index, key] of KEYS.entries()) {
      const prefix = path.join(dir, String(index).padStart(2, '0'));
      await moveTo(page, key);
      await page.waitForTimeout(200);
      await screenshot(page, `${prefix}-cursor.png`, clip);
      const hover = await showHover(page, key, enable);
      await screenshot(page, `${prefix}-hover.png`, clip);
      // The hover and the line of the key, for the still comparison.
      const boxes = [await hover.boundingBox(), await page.locator('.view-line', { hasText: `${key}: 1` }).boundingBox()];
      result[key] = {
        top: Math.min(...boxes.map((box) => box.y)) - titleBar,
        bottom: Math.max(...boxes.map((box) => box.y + box.height)) - titleBar,
        height: clip.height,
        line: boxes[1].height,
      };
      await page.keyboard.press('Escape');
    }
  } finally {
    code.kill();
    await exited;
    fs.rmSync(userData, { recursive: true, force: true });
  }
  return result;
}

/** Connects to the window of VS Code. Playwright sees only windows that are open when it connects. */
async function connect(port, exited) {
  let done = false;
  exited.then(() => (done = true));
  for (let attempt = 0; attempt < 120 && !done; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    const page = browser?.contexts().flatMap((context) => context.pages())[0];
    if (page) return page;
    await browser?.close();
  }
  throw new Error(done ? 'VS Code exited' : 'VS Code opened no window');
}

async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Takes a screenshot. A window behind other windows may not paint until it is brought to the front. */
async function screenshot(page, file, clip) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot({ path: file, animations: 'disabled', clip, timeout: 5000 });
    } catch (error) {
      if (attempt === 3) throw error;
      await page.bringToFront();
    }
  }
}

/** Puts the cursor into a key. Arrow keys keep the editor from scrolling, unlike Go to Line. */
async function moveTo(page, key) {
  await page.keyboard.press('Control+Home');
  for (let line = 1; line < lineOf(key); line++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
}

/** Opens the hover at the cursor and waits until its content and images are shown. */
async function showHover(page, key, rendered) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await moveTo(page, key);
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    const hover = page.locator('.monaco-hover', { hasText: 'math.schema.json' }).filter({ visible: true }).first();
    try {
      await hover.waitFor({ timeout: 3000 });
    } catch {
      await page.keyboard.press('Escape');
      continue;
    }
    const count = await hover.evaluate((element) =>
      Promise.all([...element.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined))).then(
        (decoded) => decoded.length
      )
    );
    if (rendered !== count > 0)
      throw new Error(`The hover of ${key} has ${count} images, expected ${rendered ? 'some' : 'none'}`);
    // The hover fades in.
    await page.waitForTimeout(400);
    return hover;
  }
  throw new Error(`No hover for ${key}`);
}

/** Writes a GIF with both runs one above the other, which keeps them in sync, and a still comparison of one key. */
function assemble(boxes) {
  fs.mkdirSync(images, { recursive: true });
  const lists = RUNS.map(({ name }) => {
    const list = path.join(frames, `${name}.txt`);
    const entries = KEYS.flatMap((_, index) => {
      const prefix = path.join(frames, name, String(index).padStart(2, '0'));
      return [
        `file '${prefix}-cursor.png'`,
        `duration ${CURSOR_SECONDS}`,
        `file '${prefix}-hover.png'`,
        `duration ${HOVER_SECONDS}`,
      ];
    });
    // The concat demuxer ignores the duration of the last file unless the file is repeated.
    fs.writeFileSync(list, [...entries, entries[entries.length - 2]].join('\n') + '\n');
    return list;
  });
  const gif =
    'split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  const font = spawnSync('fc-match', ['-f', '%{file}', 'DejaVu Sans:bold'], { encoding: 'utf8' }).stdout.trim();
  // A bar above each run with its label, and a stripe in its color that also separates the runs.
  const label = ({ label: text, color }) =>
    `pad=iw:ih+44:0:44:color=0x2b2b2b,drawbox=x=0:y=0:w=iw:h=4:color=0x${color}:t=fill` +
    (font ? `,drawtext=fontfile='${font}':text='${text}':x=14:y=14:fontsize=19:fontcolor=0x${color}` : '');
  const concat = (list) => ['-f', 'concat', '-safe', '0', '-i', list];
  // Crops to the hovers and the lines of their keys, and some lines below, which leaves out space that no hover reaches.
  const cropTo = (hovers, linesBelow = 0) => {
    const top = Math.max(0, Math.floor(Math.min(...hovers.map((box) => box.top))) - 6);
    const below = Math.max(...hovers.map((box) => box.bottom + linesBelow * box.line));
    const bottom = Math.min(...hovers.map((box) => box.height), Math.ceil(below) + 2);
    return `crop=iw:${bottom - top}:0:${top}`;
  };
  const gifCrop = cropTo(RUNS.flatMap(({ name }) => KEYS.map((key) => boxes[name][key])));

  ffmpeg([
    ...lists.flatMap(concat),
    '-filter_complex',
    `[0]fps=10,${gifCrop},${label(RUNS[0])}[top];[1]fps=10,${gifCrop},${label(RUNS[1])}[bottom];[top][bottom]vstack,${gif}`,
    '-loop',
    '0',
    path.join(images, 'math-comparison.gif'),
  ]);

  // The still comparison shows only the hovers of one key, and the line after it.
  const index = String(KEYS.indexOf(COMPARISON_KEY)).padStart(2, '0');
  const crop = cropTo(
    RUNS.map(({ name }) => boxes[name][COMPARISON_KEY]),
    1
  );
  ffmpeg([
    ...RUNS.flatMap(({ name }) => ['-i', path.join(frames, name, `${index}-hover.png`)]),
    '-filter_complex',
    `[0]${crop},${label(RUNS[0])}[top];[1]${crop},${label(RUNS[1])}[bottom];[top][bottom]vstack`,
    '-frames:v',
    '1',
    path.join(images, `${COMPARISON_KEY}-comparison.png`),
  ]);
}

function ffmpeg(args) {
  const { status } = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (status !== 0) throw new Error(`ffmpeg failed with status ${status}`);
}
