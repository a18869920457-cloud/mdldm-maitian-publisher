// 侧边栏「视频分发」页签
import { idbGet, idbSet } from './lib/vault.js';
import { scanProjects, check, ORDER } from './lib/publish.js';
import { PLATFORMS } from './lib/bundle.js';
import { normalizeRoot } from './lib/localpath.js';
import * as ai from './lib/aicopy.js';

const $ = (id) => document.getElementById(id);
const KEY = 'nasRoot', PATH_KEY = 'nasPath';
const DEFAULT_PATH = '';   // 本机路径由用户自己填（只用于把文件交给上传框）

let root = null;        // NAS 目录句柄
let projects = [];
let current = null;     // { project, result }
let running = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- NAS 目录 ----------
async function loadRoot(handle) {
  root = handle;
  $('nasName').textContent = handle.name;
  $('btnNasRegrant').classList.add('hidden');
  $('btnNasRescan').classList.remove('hidden');
  $('projects').innerHTML = '<li class="p">扫描中…</li>';
  projects = await scanProjects(handle);
  renderProjects();
}

function renderProjects() {
  $('projects').innerHTML = '';
  if (!projects.length) { $('projects').innerHTML = '<li class="p">这个目录下没有找到 publish.json，也没有放了成片的子文件夹</li>'; return; }
  for (const pr of projects) {
    const li = el('li');
    if (current && current.project.dir === pr.dir) li.classList.add('active');
    const n = el('div', 'n', pr.data ? pr.data.name : pr.dir);
    if (pr.draft) n.append(el('span', 'tag', '待写文案'));
    li.append(n, el('div', 'p', pr.error || (pr.draft ? `${pr.dir} · ${pr.video}` : pr.dir)));
    li.onclick = () => selectProject(pr);
    $('projects').appendChild(li);
  }
}

// ---------- 工程预览 + 校验 ----------
async function selectProject(pr) {
  if (running) return;
  if (pr.error) { alert(pr.error); return; }
  aiReset(pr);
  if (pr.draft) return selectDraft(pr);
  ['platList'].forEach(id => $(id).classList.remove('hidden'));
  $('projButtons').classList.remove('hidden');
  const result = await check(pr);
  current = { project: pr, result };
  renderProjects();
  const b = pr.data;
  $('projCard').classList.remove('hidden');
  $('projTitle').textContent = b.name;
  const when = b.schedule ? new Date(b.schedule).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  $('projMeta').textContent = `${pr.dir} · 视频 ${b.video} · 封面 ${Object.keys(b.covers || {}).join(' / ')} · ${when ? `定时 ${when}` : '立即发布'}`;

  $('projCheck').innerHTML = '';
  result.errors.forEach(m => $('projCheck').appendChild(el('li', '', `❌ ${m}`)));
  result.warnings.forEach(m => $('projCheck').appendChild(el('li', 'info', `⚠️ ${m}`)));
  if (!result.errors.length) $('projCheck').appendChild(el('li', 'ok', '✅ 校验通过'));

  $('platList').innerHTML = '';
  for (const id of ORDER) {
    const p = b.platforms[id];
    if (!p) continue;
    const li = el('li', p.skip ? 'skip' : '');
    const cb = el('input'); cb.type = 'checkbox'; cb.value = id; cb.checked = !p.skip; cb.disabled = !!p.skip;
    const title = p.title || p.shortTitle || (p.text || '').split('\n')[0];
    const desc = el('div');
    desc.append(el('div', 'pn', PLATFORMS[id].name),
      el('div', 'pd', p.skip ? `跳过：${p.skip}` : `${title}｜封面 ${(p.covers || []).join('+') || '无'}`));
    li.append(cb, desc);
    $('platList').appendChild(li);
  }
  $('btnPublish').disabled = running || !!result.errors.length;
  $('btnCheck').disabled = running;
  $('btnLinks').disabled = running;
}

// ---------- 草稿：只有成片，还没有 publish.json ----------
function selectDraft(pr) {
  current = { project: pr, result: { errors: ['还没有发布文案'], warnings: [] } };
  renderProjects();
  $('projCard').classList.remove('hidden');
  $('projTitle').textContent = pr.dir.split('/').pop();
  $('projMeta').textContent = `${pr.dir} · 视频 ${pr.video} · 还没有 publish.json`;
  $('projCheck').innerHTML = '';
  $('projCheck').appendChild(el('li', 'info', '用下面的「AI 写文案」生成七个平台的文案，会在这个文件夹里新建 publish.json。封面按图片比例自动识别（3:4、4:3、16:9）。'));
  $('platList').classList.add('hidden');
  $('projButtons').classList.add('hidden');
}

// ---------- AI 写文案 ----------
let aiBusy = false, aiConnecting = false;
async function aiRefresh() {
  const acc = await ai.account();
  $('btnAiAccount').textContent = acc ? '断开' : '连接知识站账号';
  if (!acc) { $('aiQuota').textContent = '连接知识站账号后可用：新用户免费 3 次，会员每月 100 次。插件拿不到你的 AI Key。'; return; }
  const q = await ai.quota().catch(() => null);
  if (!q) { $('aiQuota').textContent = (await ai.account()) ? `已连接 ${acc.name}（额度暂时查不到）` : '连接已失效，重新连接一下'; $('btnAiAccount').textContent = (await ai.account()) ? '断开' : '连接知识站账号'; return; }
  const left = q.vip ? `会员本月还剩 ${q.vip_left} 次` : `免费还剩 ${q.free_left} 次`;
  $('aiQuota').textContent = `已连接 ${q.account_name} · ${left}${!q.vip && !q.free_left ? (q.pay_with_balance ? ' · 之后按次扣 AI 余额' : '') : ''}`;
  $('btnAiVip').classList.toggle('hidden', q.vip || q.free_left > 0);
  if (q.vip_url) $('btnAiVip').dataset.url = q.vip_url;
}
async function aiReset(pr) {
  $('aiMsg').innerHTML = '';
  $('aiTitle').value = pr.data ? pr.data.name || '' : '';
  $('aiBrief').value = '';
  try { $('aiBrief').value = await ai.readBrief(pr.handle); } catch { /* 没有可读的素材 */ }
}
function aiNote(text, cls = '') { $('aiMsg').appendChild(el('li', cls, text)); }
async function aiAccount() {
  if (await ai.account()) { await ai.disconnect(); return aiRefresh(); }
  if (aiConnecting) return;
  aiConnecting = true; $('aiMsg').innerHTML = '';
  try {
    await ai.connect({ onCode: (code) => aiNote(`已在新标签页打开知识站：登录后核对授权码 ${code}，点「授权并连接」`, 'info') });
    $('aiMsg').innerHTML = ''; aiNote('✅ 已连接', 'ok');
  } catch (e) { aiNote(`❌ ${e.message}`); }
  finally { aiConnecting = false; aiRefresh(); }
}
async function aiGenerate() {
  if (aiBusy || running || !current) return;
  const brief = $('aiBrief').value.trim();
  if ([...brief].length < 20) { $('aiMsg').innerHTML = ''; aiNote('❌ 先写几句这期视频讲了什么（至少 20 字）'); return; }
  if (!(await ai.account())) return aiAccount();
  if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') { aiNote('❌ 需要允许写入这个文件夹，才能保存 publish.json'); return; }
  aiBusy = true; $('btnAiGen').disabled = true; $('btnAiGen').textContent = 'AI 正在写…（约 10 秒）'; $('aiMsg').innerHTML = '';
  try {
    const pr = current.project;
    const r = await ai.generate({ brief, title: $('aiTitle').value.trim() });
    await ai.writeProject(pr.handle, pr.data || null, r.platforms, { title: $('aiTitle').value.trim() });
    aiNote(`✅ 已写进 ${pr.dir}/publish.json${pr.data ? '（旧文件留在 publish.json.bak）' : ''}，下面可以检查、改字、再一键填写`, 'ok');
    (r.problems || []).forEach(p => aiNote(`⚠️ ${p}，填写前改一下`, 'info'));
    const dir = pr.dir; await loadRoot(root);
    const again = projects.find(p => p.dir === dir); if (again) { const msgs = $('aiMsg').innerHTML; await selectProject(again); $('aiMsg').innerHTML = msgs; }
  } catch (e) {
    aiNote(`❌ ${e.message}`);
    if (e.vipUrl) { $('btnAiVip').dataset.url = e.vipUrl; $('btnAiVip').classList.remove('hidden'); }
  } finally {
    aiBusy = false; $('btnAiGen').disabled = false; $('btnAiGen').textContent = 'AI 写七个平台文案'; aiRefresh();
  }
}

// ---------- 状态卡 ----------
const cards = {};
function renderState(st) {
  let card = cards[st.id];
  if (!card) {
    card = cards[st.id] = el('section', 'card st');
    const row = el('div', 'row');
    const left = el('div'); left.append(el('span', 'name', st.name), document.createTextNode(' '));
    const pill = el('span', 'pill'); left.appendChild(pill);
    const go = el('button', 'ghost', '切到页面');
    go.onclick = () => st.tabId && chrome.tabs.update(st.tabId, { active: true });
    row.append(left, go);
    card.append(row, el('ol'));
    card._pill = pill; card._ol = card.querySelector('ol'); card._go = go;
    $('statusList').appendChild(card);
  }
  card._pill.textContent = st.status;
  card._pill.className = 'pill ' + ({ 待你发布: 'ok', 已填写: 'ok', 已登录: 'ok', 已发布: 'ok', 已上线: 'ok', 异常: 'err', 上传超时: 'err', 未登录: 'err', 未找到: 'err', 出错: 'err', 填写中: 'run', 上传中: 'run', 检查登录: 'run', 定时: 'run', 审核中: 'run', 转码中: 'run' }[st.status] || (/^上传中/.test(st.status) ? 'run' : ''));
  card._go.classList.toggle('hidden', !st.tabId);
  card._ol.innerHTML = '';
  st.logs.forEach(l => card._ol.appendChild(el('li', l.kind, l.msg)));
}

// 后台推来的任务状态 → 状态卡
function renderJob(job) {
  running = !!(job && job.running);
  $('btnPubStop').classList.toggle('hidden', !running);
  if (current) $('btnPublish').disabled = running || !!current.result.errors.length;
  $('statusList').innerHTML = ''; for (const k in cards) delete cards[k];
  if (!job) return;
  const head = el('div', 'label', running ? `正在填写：${job.name}` : `上一轮：${job.name}`);
  const hint = el('div', 'hint', running ? '可以关掉面板或切到别的页面，填完会弹通知' : (job.interrupted ? '浏览器中途重启过插件后台，这一轮没有跑完' : '检查各平台页面后自己点发布'));
  const box = el('div', 'job-head'); box.append(head, hint);
  $('statusList').appendChild(box);
  job.states.forEach(renderState);
}

// 只检查各平台登录状态，不填写；查完关掉页面
async function checkLogins() {
  if (!current || running) return;
  const platforms = [...$('platList').querySelectorAll('input:checked')].map(i => i.value);
  if (!platforms.length) return;
  $('btnCheck').disabled = true; $('btnCheck').textContent = '检查中…';
  try {
    const win = await chrome.windows.getCurrent();
    const r = await chrome.runtime.sendMessage({ type: 'publish:check', platforms, windowId: win.id });
    if (!r || !r.ok) { alert(`检查失败：${r ? r.error : '插件后台没有响应'}`); return; }
    $('statusList').innerHTML = ''; for (const k in cards) delete cards[k];
    const bad = Object.entries(r.result).filter(([, v]) => !v.ok);
    const head = el('div', 'job-head'); head.append(el('div', 'label', bad.length ? `${bad.length} 个平台需要先登录` : '全部已登录，可以一键填写'));
    $('statusList').appendChild(head);
    for (const [id, v] of Object.entries(r.result)) {
      renderState({ id, name: PLATFORMS[id].name, status: v.ok ? '已登录' : '未登录', logs: v.ok ? [] : [{ kind: 'err', msg: v.reason }], tabId: null });
    }
  } finally {
    $('btnCheck').disabled = false; $('btnCheck').textContent = '检查登录';
  }
}

// 发布后回传链接：查各平台作品管理页，结果写进 NAS 工程目录的 发布记录.json
async function backfillLinks() {
  if (!current || running) return;
  const platforms = Object.keys(current.project.data.platforms).filter(id => !current.project.data.platforms[id].skip);
  // 写文件要读写权限：在这次点击里申请（浏览器只允许在用户点击时弹授权）
  const canWrite = (await root.requestPermission({ mode: 'readwrite' })) === 'granted';
  $('btnLinks').disabled = true; $('btnLinks').textContent = '回填中…';
  try {
    const win = await chrome.windows.getCurrent();
    const r = await chrome.runtime.sendMessage({ type: 'publish:links', platforms, windowId: win.id,
      project: { dir: current.project.dir, data: current.project.data } });
    if (!r || !r.ok) { alert(`回填失败：${r ? r.error : '插件后台没有响应'}`); return; }
    $('statusList').innerHTML = ''; for (const k in cards) delete cards[k];
    const head = el('div', 'job-head');
    let saved = '';
    if (canWrite) {
      const fh = await current.project.handle.getFileHandle('发布记录.json', { create: true });
      let old = {};
      try { old = JSON.parse(await (await fh.getFile()).text() || '{}'); } catch { /* 新文件 */ }
      const rec = { updatedAt: new Date().toISOString(), platforms: { ...(old.platforms || {}) } };
      for (const [id, v] of Object.entries(r.result)) if (v.url || !(rec.platforms[id] && rec.platforms[id].url)) rec.platforms[id] = { name: PLATFORMS[id].name, ...v };
      const w = await fh.createWritable(); await w.write(JSON.stringify(rec, null, 2) + '\n'); await w.close();
      saved = '已写入 NAS：发布记录.json';
    } else saved = '没有写入权限，结果只显示在这里';
    head.append(el('div', 'label', '发布链接'), el('div', 'hint', saved));
    $('statusList').appendChild(head);
    for (const [id, v] of Object.entries(r.result)) {
      const logs = [];
      if (v.url) logs.push({ kind: 'ok', msg: v.url });
      if (v.time) logs.push({ kind: 'info', msg: typeof v.time === 'number' ? new Date(v.time).toLocaleString('zh-CN') : String(v.time) });
      if (v.note) logs.push({ kind: 'info', msg: v.note });
      renderState({ id, name: PLATFORMS[id].name, status: v.status, logs, tabId: null });
    }
  } finally {
    $('btnLinks').disabled = false; $('btnLinks').textContent = '回填链接';
  }
}

async function publish() {
  if (!current || running) return;
  const platforms = [...$('platList').querySelectorAll('input:checked')].map(i => i.value);
  if (!platforms.length) return;
  const norm = normalizeRoot($('nasPath').value);
  if (!norm.ok) { alert(norm.message); return; }
  $('nasPath').value = norm.path;
  try { localStorage.setItem(PATH_KEY, norm.path); } catch { /* 无痕模式 */ }
  const win = await chrome.windows.getCurrent();
  // 文件夹句柄不能跨进程传，只传相对路径和 publish.json 内容；流程在插件后台跑
  const r = await chrome.runtime.sendMessage({
    type: 'publish:start', rootPath: norm.path, platforms, windowId: win.id,
    project: { dir: current.project.dir, data: current.project.data },
  });
  if (!r || !r.ok) alert(`没能开始：${r ? r.error : '插件后台没有响应'}`);
}

// ---------- 初始化 ----------
export async function initVideo() {
  let path = DEFAULT_PATH;
  try { path = localStorage.getItem(PATH_KEY) || DEFAULT_PATH; } catch { /* 无痕模式 */ }
  const saved = normalizeRoot(path);
  $('nasPath').value = saved.ok ? saved.path : path;

  $('btnNasPick').onclick = async () => {
    try {
      const h = await window.showDirectoryPicker({ id: 'nas-root', mode: 'readwrite' });
      await idbSet(KEY, h);
      loadRoot(h);
    } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
  };
  $('btnNasRegrant').onclick = async () => {
    const h = await idbGet(KEY);
    if (h && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') loadRoot(h);
  };
  $('btnNasRescan').onclick = () => root && loadRoot(root);
  $('btnPublish').onclick = publish;
  $('btnCheck').onclick = checkLogins;
  $('btnLinks').onclick = backfillLinks;
  $('btnAiAccount').onclick = aiAccount;
  $('btnAiGen').onclick = aiGenerate;
  $('btnAiVip').onclick = () => chrome.tabs.create({ url: $('btnAiVip').dataset.url || ai.SITE, active: true });
  aiRefresh();
  $('btnPubStop').onclick = () => chrome.runtime.sendMessage({ type: 'publish:stop' });
  chrome.runtime.onMessage.addListener((msg) => { if (msg.type === 'job') renderJob(msg.job); });
  renderJob(await chrome.runtime.sendMessage({ type: 'publish:get' }));

  const h = await idbGet(KEY);
  if (h) {
    $('nasName').textContent = h.name;
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') await loadRoot(h);
    else { $('btnNasRegrant').classList.remove('hidden'); $('projects').innerHTML = '<li class="p">点「授权」继续读取这个目录</li>'; }
  } else {
    $('projects').innerHTML = '<li class="p">点「选择」，选中 NAS 上的「视频导出」文件夹</li>';
  }

  // 开发接口（仅供本机开发桥接调用）
  window.__dev = {
    projects: () => projects.map(p => ({ dir: p.dir, name: p.data && p.data.name, error: p.error })),
    check: async (dir) => { const pr = projects.find(p => p.dir === dir); await selectProject(pr); return current.result; },
    // 按工程目录发起一轮；platforms 不传就用勾选的
    start: async (dir, platforms) => {
      const pr = projects.find(p => p.dir === dir); await selectProject(pr);
      if (platforms) $('platList').querySelectorAll('input').forEach(i => { i.checked = platforms.includes(i.value); });
      await publish(); return true;
    },
    // 不经过文件夹授权，直接用传入的 publish.json 内容发起（开发验证用）
    startRaw: async (project, platforms, rootPath) => {
      const win = await chrome.windows.getCurrent();
      return chrome.runtime.sendMessage({ type: 'publish:start', project, platforms, rootPath, windowId: win.id });
    },
    job: () => chrome.runtime.sendMessage({ type: 'publish:get' }),
    links: async (project, platforms) => chrome.runtime.sendMessage({ type: 'publish:links', project, platforms, windowId: (await chrome.windows.getCurrent()).id }),
    checkLogin: async (platforms) => chrome.runtime.sendMessage({ type: 'publish:check', platforms, windowId: (await chrome.windows.getCurrent()).id }),
    state: () => ({ running, statuses: Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, { status: c._pill.textContent, logs: [...c._ol.children].map(li => li.textContent) }])) }),
  };
}
