const blankPlan = () => ({records: [], journals: {}, reviews: {}, active: null});
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergePlan(base, local, remote, resolve) {
  function pick(key, before, here, there) {
    if (equal(here, before)) return there;
    if (equal(there, before) || equal(here, there)) return here;
    return resolve(key, here, there);
  }
  function mergeItems(label, before, here, there) {
    const result = Object.create(null);
    for (const key of new Set([...Object.keys(here), ...Object.keys(there)])) {
      const value = pick(label + ' ' + key, before[key], here[key], there[key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  const records = p => Object.assign(Object.create(null), Object.fromEntries(p.records.map(r => [r.id, r])));
  return {
    records: Object.values(mergeItems('活动', records(base), records(local), records(remote))).sort((a,b) => b.end-a.end),
    journals: mergeItems('心得', base.journals, local.journals, remote.journals),
    reviews: mergeItems('周复盘', base.reviews, local.reviews, remote.reviews),
    active: pick('当前计时', base.active, local.active, remote.active)
  };
}

function setupSync(app) {
  const field = id => document.getElementById(id);
  const repo = field('syncRepo'), token = field('syncToken');
  const status = message => { field('syncStatus').textContent = message; };
  const legacyPrefix = 'evening-life-sync:' + location.pathname + ':';
  const prefix = 'evening-life-sync:' + location.pathname.replace(/\/index\.html$/, '/') + ':';
  const remember = field('syncRemember');
  const tokenKey = prefix + 'token';
  const priorRepo = localStorage.getItem(legacyPrefix + 'repo');
  if (priorRepo && prefix !== legacyPrefix) {
    for (const key of ['repo', priorRepo]) {
      const value = localStorage.getItem(legacyPrefix + key);
      if (value && !localStorage.getItem(prefix + key)) localStorage.setItem(prefix + key, value);
    }
  }
  repo.value = localStorage.getItem(prefix + 'repo') || 'Adson321/evening-life-data';
  const savedToken = localStorage.getItem(tokenKey);
  remember.checked = Boolean(savedToken);
  token.value = savedToken || sessionStorage.getItem(tokenKey) || sessionStorage.getItem(legacyPrefix + 'token') || '';
  function forgetToken() {
    localStorage.removeItem(tokenKey);
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(legacyPrefix + 'token');
  }
  let busy = false, timer;
  let connected = Boolean(token.value && repo.value);
  status(connected ? '等待同步' : '当前仅保存在本机');
  function schedule(delay = 1000) {
    clearTimeout(timer);
    timer = setTimeout(() => run(false), delay);
  }
  async function run(manual) {
    if (busy || (!manual && (!connected || document.hidden || app.editing()))) return;
    const target = repo.value.trim().toLowerCase(), secret = token.value.trim();
    if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(target) || !secret) {
      if (manual) status('请输入私有仓库和令牌');
      return;
    }
    busy = true;
    for (const id of ['syncNow','syncOff','syncRepo','syncToken','syncRemember']) field(id).disabled = true;
    status('正在同步…');
    const api = 'https://api.github.com/repos/' + target;
    const headers = {Authorization: 'Bearer ' + secret, Accept: 'application/vnd.github+json'};
    const request = (url, options = {}) => fetch(url, {cache:'no-store', redirect:'error', headers, ...options});
    const check = res => { if (!res.ok) throw Error('GitHub 返回 ' + res.status + '，请检查网络、仓库和令牌权限'); };
    try {
      const meta = await request(api);
      check(meta);
      if ((await meta.json()).private !== true) throw Error('请选择私有仓库');
      const key = prefix + target, url = api + '/contents/evening-life.json';
      const base = JSON.parse(localStorage.getItem(key) || 'null') || blankPlan();
      const res = await request(url);
      let remote = blankPlan(), sha;
      if (res.status !== 404) {
        check(res);
        const file = await res.json();
        if (!file.content) throw Error('云端数据超过读取限制或文件为空');
        remote = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content), c => c.charCodeAt(0))));
        if (!Array.isArray(remote.records) || !remote.journals || !remote.reviews || !('active' in remote)) throw Error('云端文件格式不匹配');
        sha = file.sha;
      } else if (localStorage.getItem(key)) throw Error('找不到先前同步的云端文件，请检查仓库历史');
      const local = app.read();
      const merged = mergePlan(base, local, remote, (name, here, there) => {
        if (!manual) throw Error(name + ' 有冲突，请点「连接并同步」选择版本');
        return confirm(name + ' 在两端均有修改。确定保留本机，取消采用云端。\n本机：' + JSON.stringify(here ?? '已删除') + '\n云端：' + JSON.stringify(there ?? '已删除')) ? here : there;
      });
      if (!sha || !equal(merged, remote)) {
        const bytes = new TextEncoder().encode(JSON.stringify(merged));
        if (bytes.length > 950000) throw Error('同步文件过大，请先导出备份');
        const content = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
        const write = await request(url, {method:'PUT', body:JSON.stringify({message:'更新下班生活记录', content, sha})});
        if ([409,422].includes(write.status)) throw Error('另一台设备可能刚刚保存，请重新同步');
        check(write);
      }
      // Preserve any changes made locally while the network write was in flight.
      const latest = app.read();
      const next = mergePlan(local, latest, merged, (_, here) => here);
      if (app.editing() && !equal(next, latest)) {
        throw Error('请保存并离开编辑页，再同步云端修改');
      }
      if (!equal(next, latest)) app.apply(next);
      localStorage.setItem(key, JSON.stringify(merged));
      localStorage.setItem(prefix + 'repo', target);
      forgetToken();
      (remember.checked ? localStorage : sessionStorage).setItem(tokenKey, secret);
      connected = true;
      status('已同步 · ' + new Date().toLocaleTimeString());
      if (!equal(latest, local)) schedule();
    } catch (err) {
      status('同步未完成 · ' + err.message);
    } finally {
      busy = false;
      for (const id of ['syncNow','syncOff','syncRepo','syncToken','syncRemember']) field(id).disabled = false;
    }
  }
  repo.oninput = token.oninput = () => { connected = false; forgetToken(); };
  remember.onchange = () => {
    if (!remember.checked) {
      forgetToken();
      if (connected) sessionStorage.setItem(tokenKey, token.value.trim());
    }
  };
  field('syncNow').onclick = () => run(true);
  field('syncOff').onclick = () => {
    connected = false;
    forgetToken();
    remember.checked = false;
    token.value = '';
    status('已断开，记录保存在本机');
  };
  window.addEventListener('planner-save', () => schedule());
  window.addEventListener('online', () => schedule());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => schedule()));
  setInterval(() => run(false), 60000);
  if (connected) schedule();
}
