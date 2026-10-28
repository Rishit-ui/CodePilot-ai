const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

// Role hierarchy: owner > admin > editor > viewer
const ROLE_PERMISSIONS = {
  owner: new Set(['read', 'write', 'delete', 'admin', 'deploy']),
  admin: new Set(['read', 'write', 'admin', 'deploy']),
  editor: new Set(['read', 'write']),
  viewer: new Set(['read'])
};

function hasPermission(userRole, requiredPermission) {
  const perms = ROLE_PERMISSIONS[userRole];
  return perms ? perms.has(requiredPermission) : false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  sanitizeUser,
  hasPermission
};
