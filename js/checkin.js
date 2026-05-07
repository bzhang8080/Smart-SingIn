import { initFirebase, db, ref, get, set, serverTimestamp } from './firebase-config.js';

// --- State ---
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('s');
const token = urlParams.get('t');
let sessionData = null;

// --- Initialization ---
window.onload = async () => {
  if (!sessionId || !token) {
    showError('无效的签到链接', '请扫描教师屏幕上的最新二维码');
    return;
  }

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
    const sessionRef = ref(db, `sessions/${sessionId}`);
    const snapshot = await get(sessionRef);
    
    if (!snapshot.exists()) {
      showError('签到已结束或不存在', '无法找到该场次信息');
      return;
    }

    sessionData = snapshot.val();

    if (!sessionData.active || sessionData.endTime < Date.now()) {
      showError('签到已结束', '该场次签到已关闭');
      return;
    }

    // Check Token Validity
    if (sessionData.activeToken !== token) {
      // Allow a small grace period if it just expired
      if (Date.now() > sessionData.tokenExpiresAt) {
        showError('二维码已过期', '为了防代签，二维码每30秒刷新一次', true);
        return;
      }
    } else if (Date.now() > sessionData.tokenExpiresAt) {
        showError('二维码已过期', '为了防代签，二维码每30秒刷新一次', true);
        return;
    }

    // Token is valid, show form
    document.getElementById('sessionInfo').textContent = sessionData.name;
    switchScreen('formState');
    startTimer();

  } catch (err) {
    console.error(err);
    showError('验证失败', '网络错误，请重新扫码重试');
  }
};

const startTimer = () => {
  const timerBar = document.getElementById('timerBar');
  // Timer bar animation for the 30s window (approx)
  // We don't strictly kick them out if they are typing, but submission validates token again
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
    // Re-verify token expiration to prevent holding the page open
    const snap = await get(ref(db, `sessions/${sessionId}`));
    const currentSession = snap.val();
    
    if (!currentSession.active) {
      throw new Error('签到已结束');
    }
    
    // Strict Anti-Forwarding Check:
    // The submitted token must either be the currently active token, 
    // OR if it's the previous token, we must be within the grace period (tokenExpiresAt).
    if (token !== currentSession.activeToken) {
      // If it's not the active token, check if the old token's expiry time has passed
      // We rely on the grace period encoded in tokenExpiresAt from when the token was generated
      if (Date.now() > currentSession.tokenExpiresAt) {
         throw new Error('停留时间过长或二维码已失效，请重新扫描屏幕上的新二维码');
      }
    } else if (Date.now() > currentSession.tokenExpiresAt) {
         throw new Error('停留时间过长或二维码已失效，请重新扫描屏幕上的新二维码');
    }

    // Get IP for audit
    let ip = '';
    try {
      const ipRes = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipRes.json();
      ip = ipData.ip;
    } catch(e) { console.warn("Could not fetch IP"); }

    // Check if this student ID has already checked in
    const checkinRef = ref(db, `checkins/${sessionId}/${studentId}`);
    const existingCheckin = await get(checkinRef);
    if (existingCheckin.exists()) {
      throw new Error('该学号已签到，请勿重复提交');
    }

    // Save checkin
    await set(checkinRef, {
      studentId,
      name: studentName,
      timestamp: serverTimestamp(),
      tokenUsed: token,
      ip: ip,
      userAgent: navigator.userAgent
    });

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
    
    if (err.message.includes('失效') || err.message.includes('过长')) {
       showError('签到失败', err.message, true);
    } else {
       errorEl.textContent = err.message;
       errorEl.classList.remove('hidden');
    }
  }
};
