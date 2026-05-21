const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'payflow_secret_change_in_production';
const TOKEN_TTL   = '30d';          // Duración máxima del token
const REFRESH_WIN = 7 * 24 * 3600; // Renovar si quedan menos de 7 días (segundos)

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Renovación silenciosa: si el token vence en menos de REFRESH_WIN segundos,
    // emite uno nuevo y lo incluye en la cabecera de respuesta.
    const now  = Math.floor(Date.now() / 1000);
    const left  = decoded.exp - now;
    if (left < REFRESH_WIN) {
      const { iat, exp, ...payload } = decoded;
      const newToken = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
      res.setHeader('X-New-Token', newToken);
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.categoria)) {
      return res.status(403).json({ error: 'Acceso denegado: rol insuficiente' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole, JWT_SECRET, TOKEN_TTL };
