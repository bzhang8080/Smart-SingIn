import { PublicAPI, ConfigManager } from './api-config.js';

let uid = null;
let sessionId = null;
let token = null;

const init = async () => {
  const urlParams = new URLSearchParams(window.location.search);
  uid = urlParams.get('u');
  sessionId = urlParams.get('s');
  token = urlParams.get('t');

  if (!uid || !sessionId || !token) {
    showError('二维码无效或参数缺失');
    return;
  }

  // Set timeout context for fetching config (though it's local now)
  if (!ConfigManager.hasConfig()) {
    showError('系统未配置 API 地址');
    return;
  }

  // Pre-fill last student ID if exists
  const lastId = localStorage.getItem('lastStudentId');
  if (lastId) document.getElementById('studentId').value = lastId;

  await validateSession();
};

const validateSession = async () => {
  try {
    const res = await PublicAPI.getSession(uid, sessionId, token);
    const session = res.session;

    if (!session.active) {
      showError('签到已结束');
      return;
    }

    if (Date.now() > session.endTime) {
      showError('签到时间已到，自动结束');
      return;
    }

    // Is token valid? 10s grace period for slow network
    const isTokenValid = (token === session.activeToken) || 
                         (Date.now() < session.tokenExpiresAt + 10000);
    
    if (!isTokenValid) {
      showError('二维码已过期，请重新扫码');
      return;
    }

    switchScreen('loading', 'form');
    document.getElementById('sessionName').textContent = session.name;
    document.getElementById('teacherName').textContent = '授课教师: ' + (session.teacherName || uid.substring(0,6));

    // Optional: Validate if already checked in from this device
    const lastId = localStorage.getItem('lastStudentId');
    if (lastId) {
      const existsRes = await PublicAPI.checkExists(uid, sessionId, lastId);
      if (existsRes.exists) {
        showAlreadyCheckedIn();
      }
    }
  } catch (err) {
    if (err.message.includes('超时')) {
      showError('网络连接超时，请重试');
    } else if (err.message.includes('not found')) {
      showError('签到场次不存在');
    } else {
      showError('验证失败: ' + err.message);
    }
  }
};

const getClientIP = async () => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(id);
    const data = await res.json();
    return data.ip;
  } catch (e) {
    return 'unknown';
  }
};

window.submitCheckin = async () => {
  const studentId = document.getElementById('studentId').value.trim();
  const name = document.getElementById('studentName').value.trim();
  const errorMsg = document.getElementById('errorMsg');
  const btn = document.getElementById('submitBtn');

  if (!studentId || !name) {
    errorMsg.textContent = '请填写学号和姓名';
    errorMsg.classList.add('show');
    return;
  }
  
  errorMsg.classList.remove('show');
  updateLoadingStatus(btn, true);

  try {
    // Check local duplicate quickly
    const existsRes = await PublicAPI.checkExists(uid, sessionId, studentId);
    if (existsRes.exists) {
      showAlreadyCheckedIn();
      return;
    }

    const ip = await getClientIP();
    
    await PublicAPI.checkin({
      teacherId: uid,
      sessionId: sessionId,
      token: token,
      studentId: studentId,
      name: name,
      ip: ip
    });

    localStorage.setItem('lastStudentId', studentId);
    switchScreen('form', 'success');
    startTimer();

  } catch (err) {
    let msg = err.message;
    if (msg.includes('超时')) msg = '网络连接超时，请检查网络重试';
    else if (msg.includes('不在该课程名单中')) msg = '您不在该出勤名单中';
    else if (msg.includes('学号与姓名不匹配')) msg = '学号与姓名不匹配';
    else if (msg.includes('过期')) msg = '二维码已过期，请重新扫码';
    else if (msg.includes('已经签到')) {
      showAlreadyCheckedIn();
      return;
    }
    
    errorMsg.textContent = msg;
    errorMsg.classList.add('show');
  } finally {
    updateLoadingStatus(btn, false);
  }
};

// UI Helpers
const switchScreen = (hideId, showId) => {
  document.getElementById(hideId + 'Screen').classList.remove('active');
  document.getElementById(showId + 'Screen').classList.add('active');
};

const showError = (msg) => {
  document.getElementById('loadingSpinner').style.display = 'none';
  document.getElementById('loadingText').textContent = '⚠️ ' + msg;
  document.getElementById('loadingText').style.color = '#ef4444';
};

const showAlreadyCheckedIn = () => {
  switchScreen('form', 'success');
  switchScreen('loading', 'success');
  document.querySelector('.success-icon').textContent = 'ℹ️';
  document.querySelector('.success-icon').style.color = '#3b82f6';
  document.querySelector('.success-icon').style.background = 'rgba(59, 130, 246, 0.1)';
  document.querySelector('#successScreen h2').textContent = '您已签到过了';
  document.querySelector('#successScreen p').textContent = '请勿重复提交';
  startTimer();
};

const updateLoadingStatus = (btn, isLoading) => {
  if (isLoading) {
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '提交中...';
  } else {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = '立即签到';
  }
};

const startTimer = () => {
  let timeLeft = 3;
  const timeEl = document.getElementById('closeTime');
  const timer = setInterval(() => {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(timer);
      try { window.close(); } catch(e){}
    }
  }, 1000);
};

// Start
window.onload = init;
