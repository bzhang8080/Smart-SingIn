-- 教师账号表
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 班级名单表
CREATE TABLE IF NOT EXISTS rosters (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  name TEXT NOT NULL,
  students TEXT NOT NULL, -- JSON array of {id, name}
  created_at INTEGER NOT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);

-- 签到场次表
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, -- 1: active, 0: stopped
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  active_token TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  roster TEXT NOT NULL, -- JSON object mapping studentId -> name
  created_at INTEGER NOT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);

-- 签到记录表
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY, -- format: sessionId_studentId
  session_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  token_used TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);
