// 本机绝对路径。视频分发把路径交给 Chrome 的 DOM.setFileInputFiles：
// Mac 用 /Users/...，Windows 用 F:\... 或 \\NAS\共享\...。分隔符必须跟系统一致。
// 这个文件不依赖 chrome.*，侧边栏、后台和命令行测试都能用。

export const LOCAL_PATH_ALERT = '请先填 NAS 目录在本机的绝对路径。Windows 例如 F:\\新媒体\\视频\\待发布，网络盘例如 \\\\NAS\\共享\\视频；Mac 例如 /Users/你/Movies/视频导出';

const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ['「', '」'],
  ['『', '』'],
];

function fail() {
  return { ok: false, path: '', style: '', message: LOCAL_PATH_ALERT };
}

function ok(path, style) {
  return { ok: true, path, style, message: '' };
}

// 去掉首尾空白、BOM，以及一整层匹配的引号（资源管理器「复制为路径」会带上引号）
function unwrap(input) {
  let s = String(input ?? '').replace(/^\uFEFF/, '').trim();
  for (;;) {
    const pair = QUOTE_PAIRS.find(([a, b]) => s.length >= a.length + b.length && s.startsWith(a) && s.endsWith(b));
    if (!pair) return s;
    s = s.slice(pair[0].length, s.length - pair[1].length).trim();
  }
}

// 按 / 或 \ 切开，丢掉空段。不解析 . 和 ..，避免改写用户写出的路径。
function segments(body) {
  return String(body).split(/[\\/]+/).filter(s => s !== '');
}

function normalizeDrive(s) {
  const m = /^([A-Za-z]:)(.*)$/.exec(s);
  if (!m || !/^[\\/]/.test(m[2])) return null;
  const segs = segments(m[2]);
  return segs.length ? `${m[1]}\\${segs.join('\\')}` : `${m[1]}\\`;
}

function normalizeUnc(s) {
  if (!s.startsWith('\\\\') && !s.startsWith('//')) return null;
  const segs = segments(s);
  // \\server\share 至少两段；\\server 还不是一个目录
  if (segs.length < 2 || !segs[0] || !segs[1]) return null;
  return `\\\\${segs.join('\\')}`;
}

/**
 * 整理用户填的 NAS 根目录。
 * 接受：POSIX 绝对路径、Windows 盘符（F:\a 或 F:/a）、UNC（\\server\share 或 //server/share）。
 * 返回 { ok, path, style: 'posix'|'win', message }。失败时 message 就是给用户看的提示。
 */
export function normalizeRoot(input) {
  const s = unwrap(input);
  if (!s || /[\r\n\0]/.test(s)) return fail();

  const drive = normalizeDrive(s);
  if (drive) return ok(drive, 'win');

  // \\ 或 // 开头的是 UNC。缺共享名就直接拒绝，不要当成 Mac 路径。
  // 纯斜杠（/、//、///）仍是 POSIX 根目录，和以前一样能过。
  if (s.startsWith('\\\\') || s.startsWith('//')) {
    const unc = normalizeUnc(s);
    if (unc) return ok(unc, 'win');
    if (/^\/+$/.test(s)) return ok('/', 'posix');
    return fail();
  }

  if (s.startsWith('/')) {
    const path = s.replace(/\/+$/, '') || '/';
    return ok(path, 'posix');
  }
  return fail();
}

function isNorm(v) {
  return !!v && typeof v === 'object' && (v.ok === true || v.ok === false) && typeof v.path === 'string' && typeof v.style === 'string';
}

/**
 * 把工程相对路径接到 NAS 根目录后面。
 * project.dir 和 publish.json 里的相对路径用 /；Windows 根目录会改成 \。
 * POSIX 根目录仍只用 /，和原来的字符串拼接一致（空段不再变成 //）。
 */
export function joinUnder(rootInput, ...parts) {
  const root = isNorm(rootInput) ? rootInput : normalizeRoot(rootInput);
  if (!root.ok) {
    const err = new Error(root.message);
    err.code = 'BAD_ROOT';
    throw err;
  }
  const rels = [];
  for (const part of parts) {
    if (part == null || part === '') continue;
    if (root.style === 'posix') {
      for (const c of String(part).split('/')) if (c !== '') rels.push(c);
    } else {
      rels.push(...segments(part));
    }
  }
  if (!rels.length) return root.path;
  if (root.style === 'posix') {
    return root.path === '/' ? `/${rels.join('/')}` : `${root.path}/${rels.join('/')}`;
  }
  if (/^[A-Za-z]:\\$/.test(root.path)) return root.path + rels.join('\\');
  return `${root.path}\\${rels.join('\\')}`;
}

// publish.json 和目录扫描用 /。Windows 的 path.relative 会给出 \。
export function toPosixRel(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

// files 是相对路径集合。精确命中优先，这样 Mac 上本来就能对上的路径不会被改写。
export function hasRel(files, rel) {
  if (!files || rel == null || rel === '') return false;
  if (typeof files.has === 'function' && files.has(rel)) return true;
  const want = toPosixRel(rel);
  if (want !== rel && typeof files.has === 'function' && files.has(want)) return true;
  for (const f of files) if (toPosixRel(f) === want) return true;
  return false;
}
