import { ConfigManager, initFirebase, db, ref, set, get, update, onValue, push, serverTimestamp } from './firebase-config.js';

// --- State ---
let currentSessionId = null;
let currentToken = null;
let qrRefreshInterval = null;
let qrCode = null;
let rosterData = [];
let checkinData = {};

// --- UI Helpers ---
const showToast = (msg, type = 'info') => {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
};

const formatTime = (date) => {
  return date.toLocaleTimeString('zh-CN', { hour12: false });
};

// --- Initialization ---
window.onload = () => {
  // Update clock
  setInterval(() => {
    document.getElementById('currentTime').textContent = formatTime(new Date());
  }, 1000);

  // Check login
  const isLogged = sessionStorage.getItem('admin_logged');
  if (isLogged) {
    document.getElementById('loginOverlay').classList.remove('active');
    document.getElementById('adminMain').classList.remove('hidden');
    checkFirebaseInit();
  } else {
    // Ensure default password exists
    if (!localStorage.getItem('admin_pwd')) {
      localStorage.setItem('admin_pwd', '123456');
    }
  }

  // Load roster if exists
  const savedRoster = localStorage.getItem('current_roster');
  if (savedRoster) {
    rosterData = JSON.parse(savedRoster);
    renderRosterPreview();
    updateStatsDisplay();
  }
};

// --- Login & Settings ---
window.adminLogin = () => {
  const pwd = document.getElementById('adminPassword').value;
  const savedPwd = localStorage.getItem('admin_pwd');
  const errorMsg = document.getElementById('loginError');

  if (pwd === savedPwd) {
    sessionStorage.setItem('admin_logged', 'true');
    document.getElementById('loginOverlay').classList.remove('active');
    document.getElementById('adminMain').classList.remove('hidden');
    checkFirebaseInit();
  } else {
    errorMsg.textContent = '密码错误，请重试';
    errorMsg.classList.remove('hidden');
  }
};

window.adminLogout = () => {
  sessionStorage.removeItem('admin_logged');
  location.reload();
};

window.changePassword = () => {
  const newPwd = document.getElementById('newPassword').value;
  if (newPwd.length < 6) {
    showToast('密码长度至少为6位', 'error');
    return;
  }
  localStorage.setItem('admin_pwd', newPwd);
  document.getElementById('newPassword').value = '';
  showToast('密码修改成功', 'success');
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
};

// --- Firebase Config ---
const checkFirebaseInit = () => {
  if (!ConfigManager.hasConfig()) {
    showToast('首次使用请先配置 Firebase', 'warn');
    switchTab('settings');
  } else {
    if (!db) {
       const ok = initFirebase();
       if(!ok) showToast('Firebase 初始化失败，请检查配置', 'error');
    }
  }
  
  // Fill settings form if config exists
  const config = ConfigManager.getConfig();
  if (config) {
    document.getElementById('fbApiKey').value = config.apiKey || '';
    document.getElementById('fbAuthDomain').value = config.authDomain || '';
    document.getElementById('fbDatabaseUrl').value = config.databaseURL || '';
    document.getElementById('fbProjectId').value = config.projectId || '';
  }
};

window.saveFirebaseConfig = () => {
  const config = {
    apiKey: document.getElementById('fbApiKey').value.trim(),
    authDomain: document.getElementById('fbAuthDomain').value.trim(),
    databaseURL: document.getElementById('fbDatabaseUrl').value.trim(),
    projectId: document.getElementById('fbProjectId').value.trim(),
  };
  
  if (!config.apiKey || !config.databaseURL) {
    showToast('请至少填写 API Key 和 Database URL', 'error');
    return;
  }
  
  ConfigManager.saveConfig(config);
  showToast('配置已保存，请刷新页面生效', 'success');
  setTimeout(() => location.reload(), 1500);
};

window.testFirebaseConnection = async () => {
  const statusEl = document.getElementById('fbConfigStatus');
  statusEl.classList.remove('hidden');
  statusEl.textContent = '测试连接中...';
  statusEl.style.color = 'white';
  
  if (!db) {
    if(!initFirebase()) {
      statusEl.textContent = '初始化失败，请检查配置格式';
      statusEl.style.color = '#fca5a5';
      return;
    }
  }

  try {
    const testRef = ref(db, '.info/connected');
    statusEl.textContent = '连接成功！';
    statusEl.style.color = '#34d399';
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  } catch (err) {
    statusEl.textContent = '连接失败: ' + err.message;
    statusEl.style.color = '#fca5a5';
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

window.confirmColumnMapping = () => {
  const idIdx = document.getElementById('colStudentId').value;
  const nameIdx = document.getElementById('colName').value;

  if (idIdx === nameIdx) {
    showToast('学号和姓名不能选择同一列', 'error');
    return;
  }

  rosterData = [];
  // Start from row 0 to catch everything, and dynamically ignore the header row
  for (let i = 0; i < tempExcelData.length; i++) {
    const row = tempExcelData[i];
    if (!row || row.length === 0) continue;
    
    const sid = row[idIdx] ? String(row[idIdx]).trim() : '';
    const sname = row[nameIdx] ? String(row[nameIdx]).trim() : '';
    
    // Ignore header row if it is caught in the loop
    if (sid === '学号' || sname === '姓名' || sname === '名字' || sid === '学号/工号') {
      continue;
    }
    
    if (sid && sname) {
      rosterData.push({ id: sid, name: sname });
    }
  }

  localStorage.setItem('current_roster', JSON.stringify(rosterData));
  document.getElementById('columnMapper').classList.add('hidden');
  tempExcelData = null;
  
  showToast(`成功导入 ${rosterData.length} 人名单`, 'success');
  renderRosterPreview();
  updateStatsDisplay();
};

window.clearRoster = () => {
  if (confirm('确定要清空当前名单吗？')) {
    rosterData = [];
    localStorage.removeItem('current_roster');
    renderRosterPreview();
    updateStatsDisplay();
  }
};

const renderRosterPreview = () => {
  const container = document.getElementById('rosterPreview');
  const tbody = document.getElementById('rosterBody');
  const summary = document.getElementById('rosterSummary');

  if (rosterData.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  summary.textContent = `当前已导入 ${rosterData.length} 人`;
  
  tbody.innerHTML = '';
  // Show max 100 for preview performance
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
  if (!db) {
    showToast('请先配置并初始化 Firebase', 'error');
    switchTab('settings');
    return;
  }

  const sessionName = document.getElementById('sessionName').value.trim() || `签到 - ${new Date().toLocaleDateString()}`;
  const durationMin = parseInt(document.getElementById('sessionDuration').value) || 60;

  try {
    const sessionsRef = ref(db, 'sessions');
    const newSessionRef = push(sessionsRef);
    currentSessionId = newSessionRef.key;
    
    // Save roster to Firebase for validation
    const rosterMap = {};
    rosterData.forEach(s => { rosterMap[s.id] = s.name; });

    await set(newSessionRef, {
      name: sessionName,
      startTime: serverTimestamp(),
      endTime: Date.now() + durationMin * 60 * 1000,
      active: true,
      roster: rosterMap
    });

    // UI Updates
    document.getElementById('startSessionBtn').classList.add('hidden');
    document.getElementById('stopSessionBtn').classList.remove('hidden');
    document.getElementById('sessionStatus').textContent = '签到进行中';
    document.getElementById('sessionStatus').className = 'status-badge active';
    document.getElementById('sessionName').disabled = true;
    document.getElementById('sessionDuration').disabled = true;
    
    document.getElementById('qrPlaceholder').classList.add('hidden');
    document.getElementById('qrContainer').classList.remove('hidden');

    checkinData = {}; // Clear local checkins
    updateStatsDisplay();
    startQrRefreshLoop();
    listenToCheckins();
    
    showToast('签到已开始', 'success');
  } catch (err) {
    console.error(err);
    showToast('启动签到失败: ' + err.message, 'error');
  }
};

window.stopSession = async () => {
  if (!currentSessionId || !db) return;

  try {
    await update(ref(db, `sessions/${currentSessionId}`), {
      active: false,
      endTime: serverTimestamp()
    });

    clearInterval(qrRefreshInterval);
    currentSessionId = null;

    document.getElementById('startSessionBtn').classList.remove('hidden');
    document.getElementById('stopSessionBtn').classList.add('hidden');
    document.getElementById('sessionStatus').textContent = '已结束';
    document.getElementById('sessionStatus').className = 'status-badge inactive';
    document.getElementById('sessionName').disabled = false;
    document.getElementById('sessionDuration').disabled = false;
    
    document.getElementById('qrPlaceholder').classList.remove('hidden');
    document.getElementById('qrContainer').classList.add('hidden');
    
    showToast('签到已结束', 'info');
  } catch (err) {
    showToast('结束签到失败: ' + err.message, 'error');
  }
};

// --- QR Code Logic ---
const generateNewToken = async () => {
  if (!currentSessionId || !db) return;
  
  // Create a random token
  currentToken = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  const expiryTime = Date.now() + 45000; // 30s display + 15s grace period

  try {
    // Update active token in session
    await update(ref(db, `sessions/${currentSessionId}`), {
      activeToken: currentToken,
      tokenExpiresAt: expiryTime
    });

    // Generate QR Code URL
    const baseUrl = window.location.href.replace('admin.html', 'checkin.html');
    const qrUrl = `${baseUrl}?s=${currentSessionId}&t=${currentToken}`;

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
  let countdown = 30;
  const countdownEl = document.getElementById('qrCountdown');
  
  generateNewToken(); // Initial token

  qrRefreshInterval = setInterval(() => {
    countdown--;
    countdownEl.textContent = countdown;
    
    if (countdown <= 0) {
      countdown = 30;
      generateNewToken();
    }
  }, 1000);
};

// --- Real-time Feed & Stats ---
const listenToCheckins = () => {
  if (!currentSessionId || !db) return;

  const checkinsRef = ref(db, `checkins/${currentSessionId}`);
  onValue(checkinsRef, (snapshot) => {
    if (snapshot.exists()) {
      checkinData = snapshot.val();
      updateStatsDisplay();
      renderFeed();
    }
  });
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

// --- Exports ---
window.exportAbsentList = () => {
  if (rosterData.length === 0) {
    showToast('暂无名单数据', 'error');
    return;
  }

  const absentStudents = rosterData.filter(s => !checkinData[s.id]);
  
  const wsData = [
    ['学号', '姓名', '状态']
  ];
  
  absentStudents.forEach(s => {
    wsData.push([s.id, s.name, '未签到']);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "缺勤名单");
  
  const dateStr = new Date().toLocaleDateString().replace(/\//g, '-');
  XLSX.writeFile(wb, `缺勤名单_${dateStr}.xlsx`);
};

window.exportAllList = () => {
  if (rosterData.length === 0) {
    showToast('暂无名单数据', 'error');
    return;
  }
  
  const wsData = [
    ['学号', '姓名', '签到状态', '签到时间', '设备IP']
  ];
  
  rosterData.forEach(s => {
    const checkin = checkinData[s.id];
    if (checkin) {
      const timeStr = new Date(checkin.timestamp).toLocaleString('zh-CN');
      wsData.push([s.id, s.name, '已签到', timeStr, checkin.ip || '未知']);
    } else {
      wsData.push([s.id, s.name, '未签到', '-', '-']);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "完整考勤记录");
  
  const dateStr = new Date().toLocaleDateString().replace(/\//g, '-');
  XLSX.writeFile(wb, `完整考勤记录_${dateStr}.xlsx`);
};
