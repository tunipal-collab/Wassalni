// middleware/auth.js — JWT Authentication & Authorization
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'wassalni-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// ─── توليد JWT Token ──────────────────────────
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
};

// ─── التحقق من الـ Token ──────────────────────
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'لا يوجد token — سجّل دخولك أولاً' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة — سجّل دخولك مجدداً' });
    }
    return res.status(401).json({ success: false, message: 'Token غير صالح' });
  }
};

// ─── تحقق الأدمين فقط ────────────────────────
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'هذا الإجراء للإدارة فقط' });
  }
  next();
};

// ─── تحقق دور محدد ───────────────────────────
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'غير مصرح — سجّل دخولك' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `هذا الإجراء مخصص لـ: ${roles.join(', ')}`,
      });
    }
    next();
  };
};

module.exports = { generateToken, authMiddleware, adminOnly, requireRole };
