// ==========================================
// Cloudflare Worker API for Smart SignIn
// ==========================================

// --- Crypto Helpers ---

// PBKDF2 Password Hashing
async function hashPassword(password, saltHex = null) {
  const enc = new TextEncoder();
  
  // Generate salt if not provided
  let salt;
  if (saltHex) {
    const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    salt = saltBytes;
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
  }
  
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (!saltHex) {
    const newSaltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${newSaltHex}:${hashHex}`;
  }
  return hashHex;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [saltHex, originalHash] = storedHash.split(':');
  const computedHash = await hashPassword(password, saltHex);
  return computedHash === originalHash;
}

// Simple JWT Implementation
function base64UrlEncode(str) {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

async function signData(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigArray = Array.from(new Uint8Array(signature));
  return base64UrlEncode(String.fromCharCode.apply(null, sigArray));
}

async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await signData(data, secret);
  return `${data}.${signature}`;
}

async function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  const data = `${parts[0]}.${parts[1]}`;
  const validSignature = await signData(data, secret);
  
  if (validSignature !== parts[2]) return null;
  
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// --- HTTP Helpers ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

function generateRandomToken() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// --- Auth Middleware ---
async function withAuth(request, env, handler) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyJWT(token, env.JWT_SECRET || 'default_secret_please_change_in_production');
  
  if (!payload || !payload.sub) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }
  
  const teacher = await env.DB.prepare('SELECT id, email FROM teachers WHERE id = ?').bind(payload.sub).first();
  if (!teacher) {
    return jsonResponse({ error: 'User not found' }, 401);
  }
  
  return handler(request, env, teacher);
}

// ==========================================
// Main Worker Routing
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // --- Public Auth Routes ---
      if (path === '/api/auth/register' && method === 'POST') {
        const { email, password } = await request.json();
        if (!email || !email.includes('@') || !password || password.length < 6) {
          return jsonResponse({ error: 'Invalid email or password' }, 400);
        }
        
        const existing = await env.DB.prepare('SELECT id FROM teachers WHERE email = ?').bind(email).first();
        if (existing) {
          return jsonResponse({ error: 'Email already registered' }, 400);
        }
        
        const id = crypto.randomUUID();
        const hash = await hashPassword(password);
        await env.DB.prepare('INSERT INTO teachers (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
          .bind(id, email, hash, Date.now()).run();
          
        const token = await createJWT({ 
          sub: id, 
          email, 
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
        }, env.JWT_SECRET || 'default_secret_please_change_in_production');
        
        return jsonResponse({ ok: true, token, user: { id, email } });
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const { email, password } = await request.json();
        const teacher = await env.DB.prepare('SELECT id, email, password_hash FROM teachers WHERE email = ?').bind(email).first();
        
        if (!teacher || !(await verifyPassword(password, teacher.password_hash))) {
          return jsonResponse({ error: 'Invalid email or password' }, 401);
        }
        
        const token = await createJWT({ 
          sub: teacher.id, 
          email: teacher.email, 
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
        }, env.JWT_SECRET || 'default_secret_please_change_in_production');
        
        return jsonResponse({ ok: true, token, user: { id: teacher.id, email: teacher.email } });
      }

      // --- Student Public Routes ---
      if (path === '/api/public/session' && method === 'GET') {
        const u = url.searchParams.get('u');
        const s = url.searchParams.get('s');
        const t = url.searchParams.get('t');
        
        if (!u || !s) return jsonResponse({ error: 'Missing parameters' }, 400);
        
        const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ? AND teacher_id = ?').bind(s, u).first();
        
        if (!session) return jsonResponse({ error: 'Session not found' }, 404);
        
        // Return public safe data
        return jsonResponse({
          ok: true,
          session: {
            name: session.name,
            active: session.active,
            activeToken: session.active_token,
            tokenExpiresAt: session.token_expires_at,
            endTime: session.end_time,
            roster: JSON.parse(session.roster)
          }
        });
      }

      if (path === '/api/public/checkin/exists' && method === 'GET') {
        const u = url.searchParams.get('u');
        const s = url.searchParams.get('s');
        const studentId = url.searchParams.get('studentId');
        
        if (!u || !s || !studentId) return jsonResponse({ error: 'Missing parameters' }, 400);
        
        const checkin = await env.DB.prepare('SELECT id FROM checkins WHERE session_id = ? AND student_id = ?').bind(s, studentId).first();
        return jsonResponse({ exists: !!checkin });
      }

      if (path === '/api/public/checkin' && method === 'POST') {
        const data = await request.json();
        const { teacherId, sessionId, token, studentId, name } = data;
        
        if (!teacherId || !sessionId || !studentId || !name || !token) {
          return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ? AND teacher_id = ?').bind(sessionId, teacherId).first();
        if (!session) return jsonResponse({ error: 'Session not found' }, 404);
        
        if (session.active !== 1 || Date.now() > session.end_time) {
          return jsonResponse({ error: '签到已结束' }, 400);
        }

        // Grace period validation (same as frontend: allows slightly expired tokens)
        const isTokenValid = (token === session.active_token) || 
                             (Date.now() < session.token_expires_at + 10000); // 10s grace
        
        if (!isTokenValid) {
          return jsonResponse({ error: '二维码已过期，请重新扫码' }, 400);
        }

        const rosterData = JSON.parse(session.roster);
        if (Object.keys(rosterData).length > 0 && !rosterData[studentId]) {
          return jsonResponse({ error: '您不在该课程名单中' }, 400);
        }
        if (Object.keys(rosterData).length > 0 && rosterData[studentId] !== name) {
          return jsonResponse({ error: '学号与姓名不匹配' }, 400);
        }

        const checkinId = `${sessionId}_${studentId}`;
        const existing = await env.DB.prepare('SELECT id FROM checkins WHERE id = ?').bind(checkinId).first();
        if (existing) {
          return jsonResponse({ error: '您已经签到过了' }, 400);
        }

        const ip = request.headers.get('CF-Connecting-IP') || data.ip || 'unknown';
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const timestamp = Date.now();

        await env.DB.prepare(`
          INSERT INTO checkins (id, session_id, teacher_id, student_id, student_name, timestamp, token_used, ip, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(checkinId, sessionId, teacherId, studentId, name, timestamp, token, ip, userAgent).run();

        return jsonResponse({ ok: true, timestamp });
      }

      // --- Authed Routes (Require JWT) ---
      return withAuth(request, env, async (req, env, teacher) => {
        // Change Password
        if (path === '/api/auth/change-password' && method === 'POST') {
          const { newPassword } = await req.json();
          if (!newPassword || newPassword.length < 6) return jsonResponse({ error: 'Password too short' }, 400);
          
          const hash = await hashPassword(newPassword);
          await env.DB.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').bind(hash, teacher.id).run();
          return jsonResponse({ ok: true });
        }

        // Rosters
        if (path === '/api/rosters' && method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM rosters WHERE teacher_id = ? ORDER BY created_at DESC').bind(teacher.id).all();
          const rosters = {};
          results.forEach(r => {
            rosters[r.id] = { name: r.name, students: JSON.parse(r.students) };
          });
          return jsonResponse({ rosters });
        }

        if (path === '/api/rosters' && method === 'POST') {
          const { name, students } = await req.json();
          if (!name || !Array.isArray(students)) return jsonResponse({ error: 'Invalid data' }, 400);
          
          const id = 'cls_' + Date.now();
          await env.DB.prepare('INSERT INTO rosters (id, teacher_id, name, students, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(id, teacher.id, name, JSON.stringify(students), Date.now()).run();
          return jsonResponse({ ok: true, id });
        }

        if (path.match(/^\/api\/rosters\/cls_\d+$/) && method === 'DELETE') {
          const id = path.split('/').pop();
          await env.DB.prepare('DELETE FROM rosters WHERE id = ? AND teacher_id = ?').bind(id, teacher.id).run();
          return jsonResponse({ ok: true });
        }

        // Sessions
        if (path === '/api/sessions' && method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM sessions WHERE teacher_id = ? ORDER BY created_at DESC').bind(teacher.id).all();
          const sessions = {};
          results.forEach(r => {
            sessions[r.id] = {
              name: r.name,
              active: r.active,
              startTime: r.start_time,
              endTime: r.end_time,
              activeToken: r.active_token,
              tokenExpiresAt: r.token_expires_at,
              roster: JSON.parse(r.roster)
            };
          });
          return jsonResponse({ sessions });
        }

        if (path === '/api/sessions' && method === 'POST') {
          const { name, duration, rosterId } = await req.json();
          if (!name || !duration || !rosterId) return jsonResponse({ error: 'Invalid data' }, 400);
          
          // Build roster map
          let rosterMap = {};
          if (rosterId !== 'none') {
            const rosterDoc = await env.DB.prepare('SELECT students FROM rosters WHERE id = ? AND teacher_id = ?').bind(rosterId, teacher.id).first();
            if (rosterDoc) {
              const students = JSON.parse(rosterDoc.students);
              students.forEach(s => {
                rosterMap[s.id] = s.name;
              });
            }
          }

          const id = 'sess_' + generateRandomToken();
          const now = Date.now();
          const endTime = now + (duration * 60000);
          const activeToken = generateRandomToken();
          const tokenExpiresAt = now + 90000;

          await env.DB.prepare(`
            INSERT INTO sessions (id, teacher_id, name, active, start_time, end_time, active_token, token_expires_at, roster, created_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
          `).bind(id, teacher.id, name, now, endTime, activeToken, tokenExpiresAt, JSON.stringify(rosterMap), now).run();

          return jsonResponse({
            ok: true,
            id,
            session: {
              name, active: 1, startTime: now, endTime, activeToken, tokenExpiresAt, roster: rosterMap
            }
          });
        }

        if (path.match(/^\/api\/sessions\/sess_[a-zA-Z0-9]+\/stop$/) && method === 'POST') {
          const id = path.split('/')[3];
          await env.DB.prepare('UPDATE sessions SET active = 0, end_time = ? WHERE id = ? AND teacher_id = ?')
            .bind(Date.now(), id, teacher.id).run();
          return jsonResponse({ ok: true });
        }

        if (path.match(/^\/api\/sessions\/sess_[a-zA-Z0-9]+\/token$/) && method === 'POST') {
          const id = path.split('/')[3];
          const token = generateRandomToken();
          const expiresAt = Date.now() + 90000; // 90 seconds
          await env.DB.prepare('UPDATE sessions SET active_token = ?, token_expires_at = ? WHERE id = ? AND teacher_id = ?')
            .bind(token, expiresAt, id, teacher.id).run();
          return jsonResponse({ ok: true, token, expiresAt });
        }

        if (path.match(/^\/api\/sessions\/sess_[a-zA-Z0-9]+$/) && method === 'DELETE') {
          const id = path.split('/').pop();
          // Delete checkins first due to FK constraint
          await env.DB.prepare('DELETE FROM checkins WHERE session_id = ? AND teacher_id = ?').bind(id, teacher.id).run();
          await env.DB.prepare('DELETE FROM sessions WHERE id = ? AND teacher_id = ?').bind(id, teacher.id).run();
          return jsonResponse({ ok: true });
        }

        if (path.match(/^\/api\/sessions\/sess_[a-zA-Z0-9]+\/checkins$/) && method === 'GET') {
          const id = path.split('/')[3];
          const { results } = await env.DB.prepare('SELECT * FROM checkins WHERE session_id = ? AND teacher_id = ?').bind(id, teacher.id).all();
          const checkins = {};
          results.forEach(c => {
            checkins[c.student_id] = {
              studentId: c.student_id,
              name: c.student_name,
              timestamp: c.timestamp,
              ip: c.ip,
              userAgent: c.user_agent,
              tokenUsed: c.token_used
            };
          });
          return jsonResponse({ checkins });
        }

        return jsonResponse({ error: 'Route not found' }, 404);
      });

    } catch (err) {
      return jsonResponse({ error: 'Internal server error: ' + err.message }, 500);
    }
  }
};
