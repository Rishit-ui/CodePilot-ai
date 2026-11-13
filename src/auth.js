const crypto = require('node:crypto');

// Email format validation (RFC 5321 simplified)
// Local part: letters, digits, dots, underscores, percents, pluses, hyphens
// Domain: valid hostname labels (letters/digits/hyphens) separated by dots, ending with >=2 letters
const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@(?:[a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}$/;

// Password must be >=10 chars, with uppercase, lowercase, digit, special char
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_SPECIAL_CHARS = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false; // RFC 5321 max
  return EMAIL_REGEX.test(trimmed);
}

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') return { valid: false, reason: 'Password is required.' };
  if (password.length < PASSWORD_MIN_LENGTH) return { valid: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain at least one uppercase letter.' };
  if (!/[a-z]/.test(password)) return { valid: false, reason: 'Password must contain at least one lowercase letter.' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain at least one digit.' };
  if (!PASSWORD_SPECIAL_CHARS.test(password)) return { valid: false, reason: 'Password must contain at least one special character.' };
  return { valid: true };
}

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
  hasPermission,
  validateEmail,
  validatePasswordStrength
};
