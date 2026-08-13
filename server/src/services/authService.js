import { randomBytes } from 'node:crypto';
import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { hashPassword, verifyPassword, hashToken } from '../utils/password.js';
import { writeAudit } from './auditService.js';

const SESSION_HOURS = 12;
export const BOOTSTRAP_ADMIN = {
  name: 'Administrador',
  login: 'admin',
  password: 'admin123',
  role: 'administrador',
};

export function ensureBootstrapAdmin() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return null;
  const { salt, hash } = hashPassword(BOOTSTRAP_ADMIN.password);
  const info = db
    .prepare(
      `INSERT INTO users (name, login, password_hash, password_salt, role, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(BOOTSTRAP_ADMIN.name, BOOTSTRAP_ADMIN.login, hash, salt, BOOTSTRAP_ADMIN.role);
  writeAudit({
    action: 'user.bootstrap',
    entityType: 'user',
    entityId: info.lastInsertRowid,
    details: { login: BOOTSTRAP_ADMIN.login },
    userName: 'system',
  });
  return { id: Number(info.lastInsertRowid), login: BOOTSTRAP_ADMIN.login };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
    active: row.active,
    must_change_password: row.must_change_password,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listUsers({ includeInactive = false } = {}) {
  const sql = includeInactive
    ? 'SELECT * FROM users ORDER BY name'
    : 'SELECT * FROM users WHERE active = 1 ORDER BY name';
  return getDb().prepare(sql).all().map(publicUser);
}

export function getUserById(id) {
  return publicUser(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function createUser({ name, login, password, role = 'operador' }) {
  if (!name?.trim() || !login?.trim() || !password) {
    throw new AppError('Nome, login e senha são obrigatórios', { code: 'VALIDATION' });
  }
  if (!['administrador', 'operador'].includes(role)) {
    throw new AppError('Perfil inválido', { code: 'VALIDATION' });
  }
  if (String(password).length < 6) {
    throw new AppError('Senha deve ter ao menos 6 caracteres', { code: 'VALIDATION' });
  }
  const { salt, hash } = hashPassword(password);
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO users (name, login, password_hash, password_salt, role)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(name.trim(), login.trim().toLowerCase(), hash, salt, role);
    const user = getUserById(info.lastInsertRowid);
    writeAudit({
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      details: { login: user.login, role: user.role },
    });
    return user;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw new AppError('Login já existe', { status: 409, code: 'LOGIN_EXISTS' });
    }
    throw err;
  }
}

export function updateUser(id, patch) {
  const current = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) throw new AppError('Usuário não encontrado', { status: 404, code: 'NOT_FOUND' });

  const name = patch.name?.trim() ?? current.name;
  const role = patch.role ?? current.role;
  const active = patch.active == null ? current.active : patch.active ? 1 : 0;
  if (!['administrador', 'operador'].includes(role)) {
    throw new AppError('Perfil inválido', { code: 'VALIDATION' });
  }

  getDb()
    .prepare(
      `UPDATE users SET name = ?, role = ?, active = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(name, role, active, id);

  if (active === 0) {
    getDb()
      .prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`)
      .run(id);
  }

  const user = getUserById(id);
  writeAudit({
    action: active === 0 && current.active === 1 ? 'user.block' : 'user.update',
    entityType: 'user',
    entityId: id,
    details: { login: user.login, role: user.role, active: user.active },
  });
  return user;
}

export function changePassword(userId, { currentPassword, newPassword }, { asAdmin = false } = {}) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) throw new AppError('Usuário não encontrado', { status: 404, code: 'NOT_FOUND' });
  if (!asAdmin) {
    if (!verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
      throw new AppError('Senha atual incorreta', { status: 401, code: 'INVALID_PASSWORD' });
    }
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new AppError('Nova senha deve ter ao menos 6 caracteres', { code: 'VALIDATION' });
  }
  const { salt, hash } = hashPassword(newPassword);
  getDb()
    .prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(hash, salt, userId);
  writeAudit({
    action: 'user.password_change',
    entityType: 'user',
    entityId: userId,
    details: { asAdmin },
    userName: row.login,
  });
  return getUserById(userId);
}

export function login({ login, password }, meta = {}) {
  ensureBootstrapAdmin();
  const row = getDb()
    .prepare('SELECT * FROM users WHERE login = ?')
    .get(String(login || '').trim().toLowerCase());
  if (!row || !row.active) {
    writeAudit({
      action: 'auth.login_failed',
      entityType: 'user',
      details: { login },
      userName: login || 'unknown',
      result: 'fail',
    });
    throw new AppError('Login ou senha inválidos', { status: 401, code: 'AUTH_FAILED' });
  }
  if (!verifyPassword(password, row.password_salt, row.password_hash)) {
    writeAudit({
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: row.id,
      details: { login: row.login },
      userName: row.login,
      result: 'fail',
    });
    throw new AppError('Login ou senha inválidos', { status: 401, code: 'AUTH_FAILED' });
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(row.id, tokenHash, expiresAt, meta.ip || null, meta.userAgent || null);
  getDb()
    .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .run(row.id);

  writeAudit({
    action: 'auth.login',
    entityType: 'user',
    entityId: row.id,
    details: { login: row.login },
    userName: row.name,
    userId: row.id,
  });

  return { token, expires_at: expiresAt, user: publicUser(row) };
}

export function logout(token) {
  if (!token) return { ok: true };
  const tokenHash = hashToken(token);
  const session = getDb()
    .prepare('SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL')
    .get(tokenHash);
  if (session) {
    getDb()
      .prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ?`)
      .run(session.id);
    const user = getUserById(session.user_id);
    writeAudit({
      action: 'auth.logout',
      entityType: 'user',
      entityId: session.user_id,
      userName: user?.name,
      userId: session.user_id,
    });
  }
  return { ok: true };
}

/**
 * Após restaurar um .db, a tabela auth_sessions muda e o token da UI deixa de valer.
 * Reanexa o mesmo Bearer no banco restaurado para a interface continuar carregando dados.
 */
export function reattachSessionAfterRestore(plainToken, { userId = null, login = null } = {}) {
  if (!plainToken) return null;
  const db = getDb();
  let user = null;
  if (userId) {
    user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(userId));
  }
  if (!user && login) {
    user = db
      .prepare('SELECT * FROM users WHERE lower(login) = lower(?) AND active = 1')
      .get(String(login));
  }
  if (!user) {
    user = db
      .prepare(
        `SELECT * FROM users WHERE role = 'administrador' AND active = 1 ORDER BY id ASC LIMIT 1`
      )
      .get();
  }
  if (!user) {
    ensureBootstrapAdmin();
    user = db.prepare(`SELECT * FROM users WHERE login = 'admin' LIMIT 1`).get();
  }
  if (!user) return null;

  const tokenHash = hashToken(plainToken);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
  db.prepare(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES (?, ?, ?, NULL, 'post-restore')`
  ).run(user.id, tokenHash, expiresAt);

  return { token: plainToken, expires_at: expiresAt, user: publicUser(user) };
}

export function resolveSession(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = getDb()
    .prepare(
      `SELECT s.*, u.name, u.login, u.role, u.active, u.must_change_password
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')`
    )
    .get(tokenHash);
  if (!row || !row.active) return null;
  return {
    sessionId: row.id,
    user: {
      id: row.user_id,
      name: row.name,
      login: row.login,
      role: row.role,
      active: row.active,
      must_change_password: row.must_change_password,
    },
  };
}

export function userCan(user, permission) {
  if (!user) return false;
  if (user.role === 'administrador') return true;
  const operador = new Set([
    'sales',
    'cash',
    'products.read',
    'stock.read',
    'customers.read',
    'customers.write',
    'suppliers.read',
    'credit.read',
    'credit.pay',
    'returns.write',
    'deliveries.write',
    'reports.read',
    'receipt.pdf',
    'whatsapp',
  ]);
  return operador.has(permission);
}
