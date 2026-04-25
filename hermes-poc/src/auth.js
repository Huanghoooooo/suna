const crypto = require('node:crypto');

const DEFAULT_SECRET = process.env.JWT_SECRET || 'wutong-hermes-poc-secret-change-me';

const USERS = [
  {
    id: 'meta-001',
    name: '平台管理员',
    role: 'Meta',
    department: 'Platform',
    storeGroups: ['US-CA', 'EU-DE', 'UK-LON', 'JP-TYO'],
  },
  {
    id: 'admin-fba',
    name: '运营主管',
    role: 'Admin',
    department: 'FBA',
    storeGroups: ['US-CA', 'EU-DE'],
  },
  {
    id: 'employee-li',
    name: '李运营',
    role: 'Employee',
    department: 'FBA',
    storeGroups: ['US-CA'],
  },
  {
    id: 'employee-chen',
    name: '陈财务',
    role: 'Employee',
    department: 'Finance',
    storeGroups: ['EU-DE'],
  },
];

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function jsonBase64url(value) {
  return base64url(JSON.stringify(value));
}

function sign(input, secret = DEFAULT_SECRET) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function getUser(userId) {
  return USERS.find((user) => user.id === userId) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
    storeGroups: [...user.storeGroups],
  };
}

function signJwt(userId, secret = DEFAULT_SECRET) {
  const user = getUser(userId);
  if (!user) {
    throw new Error(`Unknown user: ${userId}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
    storeGroups: user.storeGroups,
    iat: now,
    exp: now + 60 * 60 * 8,
  };
  const encoded = `${jsonBase64url(header)}.${jsonBase64url(payload)}`;
  return `${encoded}.${sign(encoded, secret)}`;
}

function verifyJwt(token, secret = DEFAULT_SECRET) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing bearer token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token shape');
  }

  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`, secret);
  const actual = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (actual.length !== target.length || !crypto.timingSafeEqual(actual, target)) {
    throw new Error('Invalid token signature');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  const user = getUser(decoded.sub);
  if (!user) {
    throw new Error('Token user no longer exists');
  }
  return publicUser(user);
}

function extractBearer(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function canAccessStoreGroup(user, storeGroup) {
  if (!user || !storeGroup) {
    return false;
  }
  if (user.role === 'Meta') {
    return true;
  }
  return user.storeGroups.includes(storeGroup);
}

function canReadTask(user, task) {
  if (user.role === 'Meta') {
    return true;
  }
  if (task.ownerId === user.id) {
    return true;
  }
  return user.role === 'Admin' && task.department === user.department;
}

function canReadFile(user, file) {
  if (user.role === 'Meta') {
    return true;
  }
  if (file.ownerId === user.id) {
    return true;
  }
  return user.role === 'Admin' && file.department === user.department;
}

function canReadAudit(user, event) {
  if (user.role === 'Meta') {
    return true;
  }
  if (event.actorId === user.id) {
    return true;
  }
  return user.role === 'Admin' && event.department === user.department;
}

function assertStoreAccess(user, storeGroup) {
  if (!canAccessStoreGroup(user, storeGroup)) {
    const message = `${user.name} cannot access store group ${storeGroup}`;
    const error = new Error(message);
    error.statusCode = 403;
    throw error;
  }
}

module.exports = {
  USERS,
  DEFAULT_SECRET,
  getUser,
  publicUser,
  signJwt,
  verifyJwt,
  extractBearer,
  canAccessStoreGroup,
  canReadTask,
  canReadFile,
  canReadAudit,
  assertStoreAccess,
};
