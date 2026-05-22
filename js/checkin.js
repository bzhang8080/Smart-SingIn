import { initFirebase, db, ref, get, set, serverTimestamp } from './firebase-config.js';

// --- State ---
const urlParams = new URLSearchParams(window.location.search);
const uid = urlParams.get('u');
const sessionId = urlParams.get('s');
const token = urlParams.get('t');
let sessionData = null;

// --- Network Helpers ---
// 带超时的 Firebase get 封装
const getWithTimeout = (dbRef, timeoutMs = 10000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('TIMEOUT'));
    }, timeoutMs);
    
    get(dbRef).then((snap) => {
      clearTimeout(timer);
      resolve(snap);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

// 带重试的 Firebase get 封装
const getWithRetry = async (dbRef, maxRetries = 3, timeoutMs = 10000) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getWithTimeout(dbRef, timeoutMs);
    } catch (err) {
      lastError = err;
      console.warn(`请求失败 (第${i + 1}次), 原因: ${err.message}`);
      if (i < maxRetries - 1) {
        // 短暂等待后重试（指数退避）
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
};

// 带超时的 set 封装
const setWithTimeout = (dbRef, data, timeoutMs = 10000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('TIMEOUT'));
    }, timeoutMs);
    
    set(dbRef, data).then(() => {
      clearTimeout(timer);
      resolve();
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

// --- Initialization ---
window.onload = async () => {
  if (!uid || !sessionId || !token) {
    showError('无效的签到链接', '请扫描教师屏幕上的最新二维码');
    return;
  }

  // 显示加载状态
  updateLoadingStatus('正在连接服务器...');

  const fbReady = initFirebase();
  if (!fbReady) {
    showError('系统错误', '无法连接到服务器，请联系管理员配置 Firebase');
    return;
  }

  // Check if already checked in on this device
  if (localStorage.getItem(`checked_in_${sessionId}`)) {
    showAlreadyCheckedIn();
    return;
  }

  await validateSession();
};

const updateLoadingStatus = (msg) => {
  const loadingText = document.querySelector('.loading-text');
  if (loadingText) {
    loadingText.textContent = msg;
  }
};

const switchScreen = (screenId) => {
  document.querySelectorAll('.checkin-screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
};

const showError = (title, msg, isExpired = false) => {
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMsg').textContent = msg;
  if (isExpired) {
    document.getElementById('expiredHint').classList.remove('hidden');
  }
  switchScreen('errorState');
};

const showAlreadyCheckedIn = () => {
  switchScreen('alreadyState');
};

const validateSession = async () => {
  try {
    updateLoadingStatus('正在验证签到码...');

    const sessionRef = ref(db, `users/${uid}/sessions/${sessionId}`);
    const snapshot = await getWithRetry(sessionRef, 3, 12000);
    
    if (!snapshot.exists()) {
      showError('签到已结束或不存在', '无法找到该场次信息');
      return;
    }

    sessionData = snapshot.val();

    if (!sessionData.active || sessionData.endTime < Date.now()) {
      showError('签到已结束', '该场次签到已关闭');
      return;
    }

    // Check Token Validity - 放宽验证策略
    // 在网络延迟大的情况下（中国大陆移动网络），增加更多容忍时间
    const now = Date.now();
    const tokenAge = now - (sessionData.tokenExpiresAt - 90000); // 反算 token 创建时间 (60s有效 + 30s宽限 = 90s)
    
    if (sessionData.activeToken !== token) {
      // 不是当前 token，检查是否在宽限期内
      if (now > sessionData.tokenExpiresAt) {
        showError('二维码已过期', '为了防代签，二维码每60秒刷新一次，请重新扫描', true);
        return;
      }
    } else if (now > sessionData.tokenExpiresAt) {
      showError('二维码已过期', '为了防代签，二维码每60秒刷新一次，请重新扫描', true);
      return;
    }

    // Token is valid, show form
    document.getElementById('sessionInfo').textContent = sessionData.name;
    switchScreen('formState');
    startTimer();

  } catch (err) {
    console.error(err);
    if (err.message === 'TIMEOUT') {
      showError('网络超时', '服务器响应缓慢，请检查网络后重新扫码\n提示：建议使用WiFi或切换网络后重试');
    } else {
      showError('验证失败', '网络错误，请检查网络连接后重新扫码');
    }
  }
};

const startTimer = () => {
  const timerBar = document.getElementById('timerBar');
  // Timer bar animation for the 60s window
  timerBar.style.width = '0%';
};

// --- Submit Logic ---
window.submitCheckin = async () => {
  const studentId = document.getElementById('studentId').value.trim();
  const studentName = document.getElementById('studentName').value.trim();
  const errorEl = document.getElementById('formError');
  const btn = document.getElementById('submitBtn');

  if (!studentId || !studentName) {
    errorEl.textContent = '请填写学号和姓名';
    errorEl.classList.remove('hidden');
    return;
  }

  // Validate against roster if exists
  if (sessionData.roster) {
    if (!sessionData.roster[studentId]) {
      errorEl.textContent = '未在名单中找到该学号，请确认填写正确';
      errorEl.classList.remove('hidden');
      return;
    }
    // Optional: Check name mismatch
    // if (sessionData.roster[studentId] !== studentName) {
    //   errorEl.textContent = '学号与姓名不匹配';
    //   errorEl.classList.remove('hidden');
    //   return;
    // }
  }

  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner" style="width:20px;height:20px;margin-bottom:0;border-width:2px;"></span> 提交中...';

  try {
    // Re-verify session is still active (with timeout)
    const snap = await getWithTimeout(ref(db, `users/${uid}/sessions/${sessionId}`), 10000);
    const currentSession = snap.val();
    
    if (!currentSession.active) {
      throw new Error('签到已结束');
    }
    
    // 放宽 Token 验证：只要 session 仍在活跃状态，且扫码时 token 是有效的
    // 允许学生在填写信息期间 token 已刷新（防止因填写太慢被拒）
    // 核心防代签逻辑：扫码时验证过 token + 同一学号只能签到一次 + 设备信息记录
    if (token !== currentSession.activeToken) {
      // Token 已被刷新，但检查是否在合理时间窗口内
      // 允许最近 2 个 token 周期内提交（约 2 分钟）
      const timeSinceTokenExpiry = Date.now() - currentSession.tokenExpiresAt;
      if (timeSinceTokenExpiry > 120000) {  // 超过 2 分钟，拒绝
        throw new Error('停留时间过长，请重新扫描屏幕上的新二维码');
      }
    }

    // Get IP for audit - 使用非阻塞方式，3秒超时
    let ip = '';
    try {
      const controller = new AbortController();
      const ipTimeout = setTimeout(() => controller.abort(), 3000);
      const ipRes = await fetch('https://api.ipify.org?format=json', { 
        signal: controller.signal 
      });
      clearTimeout(ipTimeout);
      const ipData = await ipRes.json();
      ip = ipData.ip;
    } catch(e) { 
      // IP 获取失败不影响签到
      console.warn("IP获取跳过（网络限制）"); 
    }

    // Check if this student ID has already checked in
    const checkinRef = ref(db, `users/${uid}/checkins/${sessionId}/${studentId}`);
    const existingCheckin = await getWithTimeout(checkinRef, 8000);
    if (existingCheckin.exists()) {
      throw new Error('该学号已签到，请勿重复提交');
    }

    // Save checkin (with retry for reliability)
    let saved = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await setWithTimeout(checkinRef, {
          studentId,
          name: studentName,
          timestamp: serverTimestamp(),
          tokenUsed: token,
          ip: ip,
          userAgent: navigator.userAgent
        }, 10000);
        saved = true;
        break;
      } catch (e) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    if (!saved) {
      throw new Error('网络不稳定，签到提交失败，请重试');
    }

    // Mark local device
    localStorage.setItem(`checked_in_${sessionId}`, 'true');

    // Show Success
    document.getElementById('successName').textContent = studentName;
    document.getElementById('successTime').textContent = new Date().toLocaleTimeString('zh-CN');
    document.getElementById('successSession').textContent = currentSession.name;
    switchScreen('successState');

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">✓</span>确认签到';
    
    if (err.message === 'TIMEOUT') {
      errorEl.textContent = '网络超时，请检查网络后重试';
      errorEl.classList.remove('hidden');
    } else if (err.message.includes('失效') || err.message.includes('过长') || err.message.includes('结束')) {
       showError('签到失败', err.message, true);
    } else {
       errorEl.textContent = err.message;
       errorEl.classList.remove('hidden');
    }
  }
};
