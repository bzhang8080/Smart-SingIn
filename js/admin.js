import { AuthAPI, RosterAPI, SessionAPI, getToken, setToken, clearToken, getUser, setUser, ConfigManager } from './api-config.js';

// --- State ---
let currentSessionId = null;
let currentToken = null;
let qrRefreshInterval = null;
let qrCode = null;
let rosterData = [];
let checkinData = {};
let autoStopTimer = null;
let savedRosters = {};
let previewClassId = null;
let currentUser = null;
let pollingInterval = null;

// --- UI Helpers ---
const showToast = (msg, type = 'info') => {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 5000);
};

const formatTime = (date) => {
  return date.toLocaleTimeString('zh-CN', { hour12: false });
};

// --- Initialization ---
window.onload = async () => {
  // Update clock
  setInterval(() => {
    document.getElementById('currentTime').textContent = formatTime(new Date());
  }, 1000);

  const token = getToken();
  if (token) {
    try {
      // Validate token by trying to load rosters
      await RosterAPI.list();
      currentUser = getUser();
      const userInfoEl = document.getElementById('currentUserInfo');
      if(userInfoEl) userInfoEl.textContent = `当前用户: ${currentUser.email}`;
      enterAdmin();
    } catch (err) {
      clearToken();
      currentUser = null;
      document.getElementById('loginOverlay').classList.add('active');
      document.getElementById('adminMain').classList.add('hidden');
    }
  } else {
    currentUser = null;
    document.getElementById('loginOverlay').classList.add('active');
    document.getElementById('adminMain').classList.add('hidden');
  }
};

const enterAdmin = (goSettings = false) => {
  document.getElementById('loginOverlay').classList.remove('active');
  document.getElementById('adminMain').classList.remove('hidden');
  if (goSettings) switchTab('settings');
  else loadRosters(); // load rosters instead of real-time listener
  // Fill settings form with current config
  setTimeout(() => { if (typeof fillSettingsForm === 'function') fillSettingsForm(); }, 100);
};

window.adminLogin = async () => {
  const email = document.getElementById('adminEmail').value.trim();
  const pwd = document.getElementById('adminPassword').value.trim();
  const errorMsg = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  
  errorMsg.classList.add('hidden');
  if (!email || !pwd) {
    errorMsg.textContent = '请输入邮箱和密码';
    errorMsg.classList.remove('hidden');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '验证中...';

  try {
    const res = await AuthAPI.login(email, pwd);
    setToken(res.token);
    setUser(res.user);
    currentUser = res.user;
    
    const userInfoEl = document.getElementById('currentUserInfo');
    if(userInfoEl) userInfoEl.textContent = `当前用户: ${currentUser.email}`;
    
    showToast('登录成功', 'success');
    enterAdmin();
  } catch(e) {
    errorMsg.textContent = '登录失败: ' + e.message;
    errorMsg.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '登 录';
  }
};

window.adminRegister = async () => {
  const email = document.getElementById('adminEmail').value.trim();
  const pwd = document.getElementById('adminPassword').value.trim();
  const errorMsg = document.getElementById('loginError');
  const registerBtn = document.getElementById('registerBtn');
  
  errorMsg.classList.add('hidden');
  if (!email || !pwd) {
    errorMsg.textContent = '请输入邮箱和密码';
    errorMsg.classList.remove('hidden');
    return;
  }
  if (pwd.length < 6) {
    errorMsg.textContent = '密码至少需要6位';
    errorMsg.classList.remove('hidden');
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = '注册中...';

  try {
    const res = await AuthAPI.register(email, pwd);
    setToken(res.token);
    setUser(res.user);
    currentUser = res.user;
    
    const userInfoEl = document.getElementById('currentUserInfo');
    if(userInfoEl) userInfoEl.textContent = `当前用户: ${currentUser.email}`;
    
    showToast('注册成功', 'success');
    enterAdmin();
  } catch(e) {
    errorMsg.textContent = '注册失败: ' + e.message;
    errorMsg.classList.remove('hidden');
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = '注 册';
  }
};

window.adminLogout = () => {
  clearToken();
  showToast('已退出登录', 'info');
  setTimeout(() => location.reload(), 500);
};

window.changePassword = async () => {
  const newPwd = document.getElementById('newPassword').value;
  if (newPwd.length < 6) {
    showToast('密码长度至少为6位', 'error');
    return;
  }
  
  if (!currentUser) return;
  
  try {
    await AuthAPI.changePassword(newPwd);
    document.getElementById('newPassword').value = '';
    showToast('密码修改成功，请重新登录', 'success');
    clearToken();
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    showToast('修改失败: ' + e.message, 'error');
  }
};

// --- Tabs ---
window.switchTab = (tabId) => {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(`tab-${tabId}`).classList.add('active');
  
  const titles = {
    session: '签到管理', roster: '名单管理', stats: '签到统计', settings: '系统设置'
  };
  document.getElementById('pageTitle').textContent = titles[tabId];
  
  if (tabId === 'stats') {
    if (typeof window.loadHistory === 'function') {
      window.loadHistory();
    }
  }
};

// --- API Config ---
const fillSettingsForm = () => {
  document.getElementById('apiBaseUrl').value = ConfigManager.getApiBase();
};

window.saveApiConfig = () => {
  const url = document.getElementById('apiBaseUrl').value.trim();
  if (!url) {
    showToast('请填写 API 地址', 'error');
    return;
  }
  
  ConfigManager.setApiBase(url);
  showToast('配置已保存', 'success');
  setTimeout(() => location.reload(), 1000);
};

window.testApiConnection = async () => {
  const statusEl = document.getElementById('apiConfigStatus');
  statusEl.classList.remove('hidden');
  statusEl.textContent = '测试连接中...';
  statusEl.style.color = 'white';
  
  try {
    // try to fetch rosters to test auth + connection
    await RosterAPI.list();
    statusEl.textContent = '连接成功！';
    statusEl.style.color = '#34d399';
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  } catch (err) {
    if (err.message.includes('Unauthorized') || err.message.includes('token')) {
       // if we got an auth error, it means the API is reachable!
       statusEl.textContent = '连接成功，但请重新登录。';
       statusEl.style.color = '#34d399';
    } else {
       statusEl.textContent = '连接失败: ' + err.message;
       statusEl.style.color = '#fca5a5';
    }
  }
};

// --- Roster Management ---
let tempExcelData = null;

window.handleRosterFile = (input) => {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    if (jsonData.length < 2) {
      showToast('Excel文件似乎没有数据', 'error');
      return;
    }

    tempExcelData = jsonData;
    const headers = jsonData[0];
    
    // Setup Column Mapper
    const colStudentId = document.getElementById('colStudentId');
    const colName = document.getElementById('colName');
    colStudentId.innerHTML = '';
    colName.innerHTML = '';
    
    headers.forEach((h, idx) => {
      const opt1 = new Option(h || `列 ${idx+1}`, idx);
      const opt2 = new Option(h || `列 ${idx+1}`, idx);
      
      if ((h+'').includes('学号')) opt1.selected = true;
      if ((h+'').includes('姓名') || (h+'').includes('名字')) opt2.selected = true;
      
      colStudentId.add(opt1);
      colName.add(opt2);
    });

    document.getElementById('columnMapper').classList.remove('hidden');
  };
  reader.readAsArrayBuffer(file);
  input.value = ''; // reset
};

window.confirmColumnMapping = async () => {
  let className = document.getElementById('newClassName').value.trim();
  if (!className) {
    className = '课堂_' + new Date().toLocaleTimeString('zh-CN', {hour12: false});
  }

  const idIdx = document.getElementById('colStudentId').value;
  const nameIdx = document.getElementById('colName').value;

  if (idIdx === nameIdx) {
    showToast('学号和姓名不能选择同一列', 'error');
    return;
  }

  const newRoster = [];
  for (let i = 0; i < tempExcelData.length; i++) {
    const row = tempExcelData[i];
    if (!row || row.length === 0) continue;
    
    const sid = row[idIdx] ? String(row[idIdx]).trim() : '';
    const sname = row[nameIdx] ? String(row[nameIdx]).trim() : '';
    
    if (sid === '学号' || sname === '姓名' || sname === '名字' || sid === '学号/工号') {
      continue;
    }
    
    if (sid && sname) {
      newRoster.push({ id: sid, name: sname });
    }
  }

  document.getElementById('columnMapper').classList.add('hidden');
  tempExcelData = null;
  
  if (newRoster.length === 0) {
    showToast('未能识别到有效数据，请检查列映射', 'error');
    return;
  }

  try {
    await RosterAPI.create(className, newRoster);
    showToast(`成功导入 [${className}]，共 ${newRoster.length} 人`, 'success');
    document.getElementById('newClassName').value = '';
    await loadRosters();
  } catch(e) {
    showToast('保存名单失败: ' + e.message, 'error');
  }
};

const loadRosters = async () => {
  try {
    const res = await RosterAPI.list();
    savedRosters = res.rosters || {};
    renderSavedClasses();
    updateSessionRosterSelect();
    
    if (previewClassId && savedRosters[previewClassId]) {
      rosterData = savedRosters[previewClassId].students || [];
      renderRosterPreview(savedRosters[previewClassId].name);
    } else {
      document.getElementById('rosterPreview').classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load rosters:', err);
  }
};

const renderSavedClasses = () => {
  const container = document.getElementById('savedClassesList');
  const classIds = Object.keys(savedRosters);
  
  if (classIds.length === 0) {
    container.innerHTML = '<div class="feed-empty">暂无课堂名单</div>';
    return;
  }
  
  container.innerHTML = '';
  classIds.forEach(id => {
    const cls = savedRosters[id];
    const count = cls.students ? cls.students.length : 0;
    
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.innerHTML = `
      <div class="feed-item-info">
        <div class="feed-item-avatar" style="background: var(--success-color);">📖</div>
        <div>
          <div style="font-weight: 600;">${cls.name}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">${count} 名学生</div>
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm btn-outline" onclick="previewRoster('${id}')">预览</button>
        <button class="btn btn-sm btn-danger" onclick="deleteRoster('${id}', '${cls.name}')">删除</button>
      </div>
    `;
    container.appendChild(div);
  });
};

const updateSessionRosterSelect = () => {
  const select = document.getElementById('sessionRosterSelect');
  const currentVal = select.value;
  select.innerHTML = '<option value="">请选择名单...</option>';
  
  Object.keys(savedRosters).forEach(id => {
    const opt = new Option(savedRosters[id].name, id);
    select.add(opt);
  });
  
  if (savedRosters[currentVal]) {
    select.value = currentVal;
  }
};

window.previewRoster = (id) => {
  previewClassId = id;
  rosterData = savedRosters[id].students || [];
  renderRosterPreview(savedRosters[id].name);
};

window.deleteRoster = async (id, name) => {
  if (!confirm(`确定要永久删除课堂名单 [${name}] 吗？`)) return;
  try {
    await RosterAPI.delete(id);
    if (previewClassId === id) previewClassId = null;
    showToast('删除成功', 'success');
    await loadRosters();
  } catch(e) {
    showToast('删除失败: ' + e.message, 'error');
  }
};

const renderRosterPreview = (className = '') => {
  const container = document.getElementById('rosterPreview');
  const tbody = document.getElementById('rosterBody');
  const summary = document.getElementById('rosterSummary');

  if (rosterData.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  summary.textContent = `当前预览: ${className} (${rosterData.length} 人)`;
  
  tbody.innerHTML = '';
  const displayData = rosterData.slice(0, 100);
  
  displayData.forEach((student, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${student.id}</td>
      <td>${student.name}</td>
    `;
    tbody.appendChild(tr);
  });
  
  if (rosterData.length > 100) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3" style="text-align:center; color:#cbd5e1;">... 仅预览前100条记录，共 ${rosterData.length} 条 ...</td>`;
    tbody.appendChild(tr);
  }
};

// --- Session Management ---
window.startSession = async () => {
  const sessionName = document.getElementById('sessionName').value.trim() || `签到 - ${new Date().toLocaleDateString()}`;
  const durationMin = parseInt(document.getElementById('sessionDuration').value) || 60;
  
  const selectedClassId = document.getElementById('sessionRosterSelect').value;
  if (!selectedClassId || !savedRosters[selectedClassId]) {
    showToast('请先在签到管理页面选择一个出勤名单', 'warn');
    return;
  }
  
  rosterData = savedRosters[selectedClassId].students || [];

  try {
    const res = await SessionAPI.create(sessionName, durationMin, selectedClassId);
    currentSessionId = res.id;

    // UI Updates
    document.getElementById('startSessionBtn').classList.add('hidden');
    document.getElementById('stopSessionBtn').classList.remove('hidden');
    document.getElementById('sessionStatus').textContent = '签到进行中';
    document.getElementById('sessionStatus').className = 'status-badge active';
    document.getElementById('sessionName').disabled = true;
    document.getElementById('sessionDuration').disabled = true;
    
    document.getElementById('qrPlaceholder').classList.add('hidden');
    document.getElementById('qrContainer').classList.remove('hidden');

    checkinData = {}; 
    updateStatsDisplay();
    startQrRefreshLoop();
    startCheckinPolling();
    
    autoStopTimer = setTimeout(() => {
      window.stopSession(true);
    }, durationMin * 60 * 1000);
    
    showToast('签到已开始', 'success');
  } catch (err) {
    console.error(err);
    showToast('启动签到失败: ' + err.message, 'error');
  }
};

window.stopSession = async (isAuto = false) => {
  if (!currentSessionId) return;

  try {
    if (autoStopTimer) clearTimeout(autoStopTimer);
    
    await SessionAPI.stop(currentSessionId);

    clearInterval(qrRefreshInterval);
    clearInterval(pollingInterval);
    currentSessionId = null;

    document.getElementById('startSessionBtn').classList.remove('hidden');
    document.getElementById('stopSessionBtn').classList.add('hidden');
    document.getElementById('sessionStatus').textContent = '已结束';
    document.getElementById('sessionStatus').className = 'status-badge inactive';
    document.getElementById('sessionName').disabled = false;
    document.getElementById('sessionDuration').disabled = false;
    
    document.getElementById('qrPlaceholder').classList.remove('hidden');
    document.getElementById('qrContainer').classList.add('hidden');
    
    if (isAuto === true) {
      showToast('签到时间到，已自动结束', 'warn');
    } else {
      showToast('签到已手动结束', 'info');
    }
  } catch (err) {
    showToast('结束签到失败: ' + err.message, 'error');
  }
};

// --- QR Code Logic ---
const generateNewToken = async () => {
  if (!currentSessionId) return;
  
  try {
    const res = await SessionAPI.refreshToken(currentSessionId);
    currentToken = res.token;

    // Generate QR Code URL
    const baseUrl = window.location.href.replace('admin.html', 'checkin.html').split('#')[0];
    const qrUrl = `${baseUrl}?u=${currentUser.id}&s=${currentSessionId}&t=${currentToken}`;

    if (!qrCode) {
      qrCode = new QRCode(document.getElementById("qrcode"), {
        text: qrUrl,
        width: 250,
        height: 250,
        colorDark : "#0f172a",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
      });
    } else {
      qrCode.clear();
      qrCode.makeCode(qrUrl);
    }
  } catch (err) {
    console.error("Token update error:", err);
  }
};

const startQrRefreshLoop = () => {
  let countdown = 60;
  const countdownEl = document.getElementById('qrCountdown');
  
  generateNewToken();

  qrRefreshInterval = setInterval(() => {
    countdown--;
    countdownEl.textContent = countdown;
    
    if (countdown <= 0) {
      countdown = 60;
      generateNewToken();
    }
  }, 1000);
};

// --- Real-time Feed & Stats (Polling) ---
const startCheckinPolling = () => {
  if (pollingInterval) clearInterval(pollingInterval);
  
  pollingInterval = setInterval(async () => {
    if (!currentSessionId) return;
    try {
      const res = await SessionAPI.getCheckins(currentSessionId);
      checkinData = res.checkins || {};
      updateStatsDisplay();
      renderFeed();
    } catch (err) {
      console.error('Poll checkins failed', err);
    }
  }, 3000);
};

const updateStatsDisplay = () => {
  const total = rosterData.length;
  const present = Object.keys(checkinData).length;
  const absent = Math.max(0, total - present);
  const rate = total > 0 ? Math.round((present / total) * 100) : 0;

  document.getElementById('totalCount').textContent = total;
  document.getElementById('presentCount').textContent = present;
  document.getElementById('absentCount').textContent = absent;
  document.getElementById('rateDisplay').textContent = `${rate}%`;
  
  renderAbsentList();
};

const renderFeed = () => {
  const feedContainer = document.getElementById('checkinFeed');
  const entries = Object.values(checkinData).sort((a, b) => b.timestamp - a.timestamp);
  
  if (entries.length === 0) {
    feedContainer.innerHTML = '<div class="feed-empty">暂无签到记录</div>';
    return;
  }

  feedContainer.innerHTML = '';
  entries.forEach(entry => {
    const timeStr = new Date(entry.timestamp).toLocaleTimeString('zh-CN', {hour12: false});
    const firstChar = entry.name ? entry.name.charAt(0) : '?';
    
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.innerHTML = `
      <div class="feed-item-info">
        <div class="feed-item-avatar">${firstChar}</div>
        <div>
          <div style="font-weight: 600;">${entry.name}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">${entry.studentId}</div>
        </div>
      </div>
      <div class="feed-item-time">${timeStr}</div>
    `;
    feedContainer.appendChild(div);
  });
};

const renderAbsentList = () => {
  const absentContainer = document.getElementById('absentList');
  
  if (rosterData.length === 0) {
    absentContainer.innerHTML = '<div class="feed-empty">请先导入名单</div>';
    return;
  }

  const absentStudents = rosterData.filter(s => !checkinData[s.id]);
  
  if (absentStudents.length === 0) {
    absentContainer.innerHTML = '<div class="feed-empty" style="color: #34d399">全员到齐！🎉</div>';
    return;
  }

  absentContainer.innerHTML = '';
  absentStudents.forEach(s => {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    div.innerHTML = `
      <div class="feed-item-info">
        <div class="feed-item-avatar" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5;">${s.name.charAt(0)}</div>
        <div>
          <div style="font-weight: 600; color: #fca5a5;">${s.name}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">${s.id}</div>
        </div>
      </div>
      <div class="feed-item-time" style="color: #fca5a5;">缺勤</div>
    `;
    absentContainer.appendChild(div);
  });
};

// --- Exports & History ---
window.loadHistory = async () => {
  const historyList = document.getElementById('historyList');
  historyList.innerHTML = '<div class="loading-spinner" style="margin: 20px auto;"></div>';

  try {
    const res = await SessionAPI.list();
    const sessions = res.sessions || {};
    const sortedSessions = Object.keys(sessions)
      .map(k => ({id: k, ...sessions[k]}))
      .sort((a,b) => b.startTime - a.startTime);
    
    if (sortedSessions.length === 0) {
      historyList.innerHTML = '<div class="feed-empty">暂无历史记录</div>';
      return;
    }
    
    historyList.innerHTML = '';
    
    for (const session of sortedSessions) {
      const dateStr = new Date(session.startTime).toLocaleString('zh-CN');
      const rosterCount = session.roster ? Object.keys(session.roster).length : 0;
      
      const checkinRes = await SessionAPI.getCheckins(session.id);
      const checkinsCount = Object.keys(checkinRes.checkins || {}).length;
      
      const div = document.createElement('div');
      div.className = 'feed-item';
      div.style.flexDirection = 'column';
      div.style.alignItems = 'stretch';
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div class="feed-item-info" style="flex: 1;">
            <div class="feed-item-avatar" style="background: var(--primary-color);">📅</div>
            <div>
              <div style="font-weight: 600;">${session.name} ${session.active ? '<span style="color:#34d399;font-size:0.8rem;">(进行中)</span>' : ''}</div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">${dateStr}</div>
            </div>
          </div>
          <div style="text-align: right; margin-right: 15px;">
            <div style="font-weight: bold; color: ${checkinsCount >= rosterCount && rosterCount > 0 ? '#34d399' : 'white'}">${checkinsCount} / ${rosterCount}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">签到人数</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
          <button class="btn btn-sm btn-outline" onclick="viewHistorySession('${session.id}')">👁️ 查看缺勤</button>
          <button class="btn btn-sm btn-outline" onclick="exportHistorySession('${session.id}', '${session.name}')">📥 导出报表</button>
          <button class="btn btn-sm btn-danger" onclick="deleteHistorySession('${session.id}', '${session.name}')">🗑️ 删除</button>
        </div>
      `;
      historyList.appendChild(div);
    }
  } catch (err) {
    historyList.innerHTML = `<div class="feed-empty" style="color: #fca5a5;">加载失败: ${err.message}</div>`;
  }
};

window.viewHistorySession = async (sessionId) => {
  const absentContainer = document.getElementById('absentList');
  const headerText = document.querySelector('.absent-header h3');
  absentContainer.innerHTML = '<div class="loading-spinner" style="margin: 20px auto;"></div>';
  headerText.innerHTML = '🚨 查询中...';
  
  try {
    const res = await SessionAPI.list();
    const session = res.sessions[sessionId];
    if (!session) return;

    const checkinRes = await SessionAPI.getCheckins(sessionId);
    const checkins = checkinRes.checkins || {};
    const roster = session.roster || {};
    
    headerText.innerHTML = `🚨 [${session.name}] 缺勤名单`;
    
    const rosterKeys = Object.keys(roster);
    if (rosterKeys.length === 0) {
      absentContainer.innerHTML = '<div class="feed-empty">该场次未导入名单数据</div>';
      return;
    }

    const absentStudents = rosterKeys.filter(id => !checkins[id]).map(id => ({id, name: roster[id]}));
    
    if (absentStudents.length === 0) {
      absentContainer.innerHTML = '<div class="feed-empty" style="color: #34d399">全员到齐！🎉</div>';
      return;
    }

    absentContainer.innerHTML = '';
    absentStudents.forEach(s => {
      const div = document.createElement('div');
      div.className = 'feed-item';
      div.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      div.innerHTML = `
        <div class="feed-item-info">
          <div class="feed-item-avatar" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5;">${s.name.charAt(0)}</div>
          <div>
            <div style="font-weight: 600; color: #fca5a5;">${s.name}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">${s.id}</div>
          </div>
        </div>
        <div class="feed-item-time" style="color: #fca5a5;">缺勤</div>
      `;
      absentContainer.appendChild(div);
    });
  } catch(e) {
    absentContainer.innerHTML = `<div class="feed-empty" style="color: #fca5a5;">查询失败: ${e.message}</div>`;
  }
};

window.exportHistorySession = async (sessionId, sessionName) => {
  showToast('正在生成报表...', 'info');
  try {
    const res = await SessionAPI.list();
    const session = res.sessions[sessionId];
    if (!session) return;

    const checkinRes = await SessionAPI.getCheckins(sessionId);
    const checkins = checkinRes.checkins || {};
    const roster = session.roster || {};
    
    const wsData = [['学号', '姓名', '签到状态', '签到时间', '设备IP']];
    const rosterKeys = Object.keys(roster);
    
    if (rosterKeys.length === 0) {
      showToast('该场次没有名单数据', 'warn');
      return;
    }
    
    rosterKeys.forEach(id => {
      const name = roster[id];
      const checkin = checkins[id];
      if (checkin) {
        const timeStr = new Date(checkin.timestamp).toLocaleString('zh-CN');
        wsData.push([id, name, '已签到', timeStr, checkin.ip || '未知']);
      } else {
        wsData.push([id, name, '未签到', '-', '-']);
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "考勤记录");
    
    const dateStr = new Date().toLocaleDateString().replace(/\//g, '-');
    XLSX.writeFile(wb, `${sessionName}_考勤记录_${dateStr}.xlsx`);
    showToast('导出成功', 'success');
  } catch(e) {
    showToast('导出失败: ' + e.message, 'error');
  }
};

window.deleteHistorySession = async (sessionId, sessionName) => {
  if (!confirm(`警告：确定要永久删除场次【${sessionName}】吗？删除后所有签到记录将不可恢复！`)) return;
  
  try {
    await SessionAPI.delete(sessionId);
    showToast('删除成功', 'success');
    loadHistory(); // Reload history
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
};

// Generic exports
window.exportAllList = () => {
  if (rosterData.length === 0) {
    showToast('当前没有签到数据可导出', 'warn');
    return;
  }
  
  const wsData = [['学号', '姓名', '签到状态', '签到时间', '设备IP']];
  rosterData.forEach(s => {
    const checkin = checkinData[s.id];
    if (checkin) {
      const timeStr = new Date(checkin.timestamp).toLocaleTimeString('zh-CN', {hour12: false});
      wsData.push([s.id, s.name, '已签到', timeStr, checkin.ip || '未知']);
    } else {
      wsData.push([s.id, s.name, '未签到', '-', '-']);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "签到总表");
  XLSX.writeFile(wb, `全部签到明细_${formatTime(new Date())}.xlsx`);
};

window.exportAbsentList = () => {
  if (rosterData.length === 0) return;
  const absentStudents = rosterData.filter(s => !checkinData[s.id]);
  
  if (absentStudents.length === 0) {
    showToast('全员到齐，无需导出缺勤表', 'success');
    return;
  }
  
  const wsData = [['学号', '姓名', '状态']];
  absentStudents.forEach(s => {
    wsData.push([s.id, s.name, '缺勤']);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "缺勤名单");
  XLSX.writeFile(wb, `缺勤人员表_${formatTime(new Date())}.xlsx`);
};
