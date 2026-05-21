const router  = require('express').Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { authMiddleware, JWT_SECRET, TOKEN_TTL } = require('../middleware/auth');

const sha256 = (str) =>
  crypto.createHash('sha256').update(str).digest('hex');

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Auto-registro solo para "contador". Los autorizadores son creados por administración.
router.post('/register', async (req, res) => {
  try {
    const { nombre, correo, contrasena, agencia } = req.body;

    if (!nombre || !correo || !contrasena || !agencia) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    if (contrasena.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hash = sha256(contrasena);

    const { rows } = await db.query(
      `INSERT INTO usuarios (nombre, correo, contrasena, categoria, agencia, activo)
       VALUES ($1, $2, $3, 'contador', $4, TRUE)
       RETURNING id, nombre, correo, categoria, agencia, activo, creado_en`,
      [nombre.trim(), correo.toLowerCase().trim(), hash, agencia.trim()]
    );

    res.status(201).json({ message: 'Usuario creado exitosamente', usuario: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }

    const { rows } = await db.query(
      'SELECT * FROM usuarios WHERE correo = $1',
      [correo.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const user = rows[0];
    if (sha256(contrasena) !== user.contrasena) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const payload = {
      id:        user.id,
      nombre:    user.nombre,
      correo:    user.correo,
      categoria: user.categoria,
      agencia:   user.agencia,
      activo:    user.activo,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

    res.json({
      token,
      usuario: payload,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
// Renueva el token activo sin pedir contraseña.
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    // Revalidar que el usuario sigue existiendo y activo en BD
    const { rows } = await db.query(
      'SELECT id, nombre, correo, categoria, agencia, activo FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = rows[0];
    const { iat, exp, ...rest } = req.user;
    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, correo: user.correo,
        categoria: user.categoria, agencia: user.agencia, activo: user.activo },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    res.json({ token, usuario: user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nombre, correo, categoria, agencia, activo, creado_en FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
