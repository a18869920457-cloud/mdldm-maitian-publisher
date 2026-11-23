import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { normalizeRoot, joinUnder, toPosixRel, hasRel, LOCAL_PATH_ALERT } from '../lib/localpath.js';
import { validate } from '../lib/bundle.js';

const ROOT = 'F:\\新媒体\\新媒体\\视频\\待发布';
const DIR = '20261122_T3B长片';
const VIDEO = `${ROOT}\\${DIR}\\成片.mp4`;
const COVER_34 = `${ROOT}\\${DIR}\\封面\\cover-3x4.png`;
const COVER_43 = `${ROOT}\\${DIR}\\封面\\cover-4x3.png`;

function legacyAbs(root, dir, rel) {
  return `${root.replace(/\/$/, '')}/${dir}/${rel}`;
}

// ---------- 用户这条 Windows 路径必须原样交给上传框 ----------
assert.equal(normalizeRoot(ROOT).path, ROOT);
assert.equal(normalizeRoot(ROOT).style, 'win');
assert.equal(joinUnder(ROOT, DIR, '成片.mp4'), VIDEO);
assert.equal(joinUnder(ROOT, DIR, '封面/cover-3x4.png'), COVER_34);
assert.equal(joinUnder(ROOT, DIR, '封面/cover-4x3.png'), COVER_43);

// 正斜杠、引号、首尾空白、末尾分隔符都收成同一条
for (const raw of [
  'F:/新媒体/新媒体/视频/待发布',
  'F:/新媒体/新媒体/视频/待发布/',
  'F:\\新媒体\\新媒体\\视频\\待发布\\',
  '  "F:\\新媒体\\新媒体\\视频\\待发布"  ',
  "'F:/新媒体/新媒体/视频/待发布/'",
  '「F:\\新媒体\\新媒体\\视频\\待发布」',
  '\uFEFFF:\\新媒体\\新媒体\\视频\\待发布',
]) {
  assert.equal(joinUnder(raw, DIR, '成片.mp4'), VIDEO, raw);
  assert.equal(joinUnder(raw, DIR, '封面/cover-3x4.png'), COVER_34, raw);
}

// 盘符大小写保留；中间空格保留
assert.equal(normalizeRoot('f:/New Media/视频').path, 'f:\\New Media\\视频');
assert.equal(joinUnder('F:\\', '成片.mp4'), 'F:\\成片.mp4');
assert.equal(normalizeRoot('F:/').path, 'F:\\');
assert.equal(normalizeRoot('F:\\').path, 'F:\\');

// UNC
assert.equal(normalizeRoot('\\\\NAS\\share\\视频').path, '\\\\NAS\\share\\视频');
assert.equal(normalizeRoot('//NAS/share/视频/').path, '\\\\NAS\\share\\视频');
assert.equal(normalizeRoot('"\\\\NAS\\share\\视频\\\\"').path, '\\\\NAS\\share\\视频');
assert.equal(
  joinUnder('\\\\NAS\\share', DIR, '封面/cover-4x3.png'),
  `\\\\NAS\\share\\${DIR}\\封面\\cover-4x3.png`,
);
assert.equal(
  joinUnder('//NAS/share/视频', DIR, '成片.mp4'),
  `\\\\NAS\\share\\视频\\${DIR}\\成片.mp4`,
);

// 相对路径、缺共享名的 UNC、盘符后面没有分隔符：拒绝，提示里带 Windows 例子
assert.match(LOCAL_PATH_ALERT, /F:\\新媒体\\视频\\待发布/);
assert.match(LOCAL_PATH_ALERT, /\\\\NAS\\共享\\视频/);
for (const bad of ['', '   ', '待发布', '新媒体\\视频', 'F:', 'F:foo', '.\\待发布', './待发布', '\\\\NAS', '//NAS', '\\\\', '"F:"']) {
  const r = normalizeRoot(bad);
  assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
  assert.equal(r.message, LOCAL_PATH_ALERT);
  assert.throws(() => joinUnder(bad, DIR, '成片.mp4'), /绝对路径/);
}

// ---------- Mac：和原来的「去掉一个末尾 / 再用 / 拼接」一致 ----------
for (const [root, dir, rel] of [
  ['/Users/你/Movies/视频导出', '系列/第1期', '成片.mp4'],
  ['/Users/你/Movies/视频导出/', '系列/第1期', '封面/cover-3x4.png'],
  ['/Volumes/sata11/视频导出', 'Grokbot/day3', '封面/cover-4x3.png'],
  ['/', '系列/期', '成片.mp4'],
]) {
  assert.equal(joinUnder(root, dir, rel), legacyAbs(root, dir, rel), `${root} + ${dir} + ${rel}`);
  assert.equal(normalizeRoot(root).style, 'posix');
}
assert.equal(normalizeRoot('  "/Users/你/Movies/视频导出/"  ').path, '/Users/你/Movies/视频导出');
assert.equal(joinUnder('/Users/你/Movies/视频导出/', '系列/期', '封面/cover-3x4.png'), '/Users/你/Movies/视频导出/系列/期/封面/cover-3x4.png');
assert.equal(normalizeRoot('///').path, '/');
assert.equal(normalizeRoot('//').path, '/');
// 文件名里的反斜杠在 Mac 上是普通字符，不能当成分隔符
assert.equal(joinUnder('/Users/you/a\\b', 'c'), '/Users/you/a\\b/c');
// 工程目录就是所选文件夹时，不再多一个 //
assert.equal(joinUnder('/Volumes/sata/视频导出', '', '成片.mp4'), '/Volumes/sata/视频导出/成片.mp4');

// 整理过的路径再整理一次不变
for (const raw of [ROOT, 'F:/a/b/', '\\\\NAS\\share\\视频\\', '/Users/你/Movies/视频导出/', '/']) {
  const once = normalizeRoot(raw);
  assert.equal(once.ok, true, raw);
  assert.deepEqual(normalizeRoot(once.path), once);
}

// ---------- 校验：Windows 扫描出的 \ 要对得上 publish.json 里的 / ----------
assert.equal(toPosixRel('封面\\cover-3x4.png'), '封面/cover-3x4.png');
assert.equal(toPosixRel('封面/cover-3x4.png'), '封面/cover-3x4.png');
const winRel = win32.relative(
  'F:\\新媒体\\新媒体\\视频\\待发布\\20261122_T3B长片',
  'F:\\新媒体\\新媒体\\视频\\待发布\\20261122_T3B长片\\封面\\cover-3x4.png',
);
assert.equal(winRel, '封面\\cover-3x4.png');
assert.equal(toPosixRel(winRel), '封面/cover-3x4.png');

const bundle = {
  version: 1,
  video: '成片.mp4',
  covers: { '3x4': '封面/cover-3x4.png', '4x3': '封面/cover-4x3.png' },
  platforms: {},
};
const winFiles = new Set(['成片.mp4', '封面\\cover-3x4.png', '封面\\cover-4x3.png', 'publish.json']);
assert.deepEqual(validate(bundle, winFiles).errors, []);
assert.equal(hasRel(winFiles, '封面/cover-3x4.png'), true);
const macFiles = new Set(['成片.mp4', '封面/cover-3x4.png', '封面/cover-4x3.png']);
assert.deepEqual(validate(bundle, macFiles).errors, []);
const missing = validate(bundle, new Set(['成片.mp4', '封面/cover-3x4.png']));
assert.ok(missing.errors.some(e => e.includes('找不到封面 4x3')));
assert.ok(!missing.errors.some(e => e.includes('成片')));

// 界面文案，以及真正走填写的地方要用这套路径，不能再只认 /
const html = readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
assert.match(html, /placeholder="比如 F:\\新媒体\\视频\\待发布 或 \/Users\/你\/Movies\/视频导出"/);
const videoJs = readFileSync(new URL('../video.js', import.meta.url), 'utf8');
assert.match(videoJs, /normalizeRoot\(\$\('nasPath'\)\.value\)/);
assert.doesNotMatch(videoJs, /startsWith\('\/'\)/);
const publishJs = readFileSync(new URL('../lib/publish.js', import.meta.url), 'utf8');
assert.match(publishJs, /joinUnder\(root, project\.dir, rel\)/);
assert.doesNotMatch(publishJs, /rootPath\.replace\(\/\\\/\$/);
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, '0.5.2');

console.log('localpath tests passed');
