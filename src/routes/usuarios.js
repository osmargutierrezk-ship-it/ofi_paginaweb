const router = require('express').Router();
const db     = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// Solo autorizadores pueden gestionar usuarios
router.use(requireRole('autorizador'));

// GET /api/usuarios — lista de usuarios (Central ve todos, otros solo su agencia)
router.get('/', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';
    const { rows } = await db.query(
      `SELECT id, nombre, correo, categoria, agencia, activo, creado_en
       FROM usuarios
       ${esCentral ? '' : 'WHERE agencia = $1'}
       ORDER BY agencia, categoria, nombre`,
      esCentral ? [] : [req.user.agencia]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/usuarios/:id/activo — activar/desactivar usuario
// Central puede cambiar cualquier usuario; autorizador solo puede cambiar los de su agencia
router.patch('/:id/activo', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const { activo } = req.body;

    if (typeof activo !== 'boolean')
      return res.status(400).json({ error: 'El campo "activo" debe ser true o false' });

    // No puede desactivarse a sí mismo
    if (targetId === req.user.id)
      return res.status(400).json({ error: 'No puedes cambiar tu propio estado activo' });

    // Verificar que el usuario objetivo existe
    const { rows: [target] } = await db.query(
      'SELECT id, nombre, agencia, categoria FROM usuarios WHERE id = $1',
      [targetId]
    );
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si no es Central, solo puede gestionar su agencia
    const esCentral = req.user.agencia === 'Central';
    if (!esCentral && target.agencia !== req.user.agencia)
      return res.status(403).json({ error: 'No puedes gestionar usuarios de otra agencia' });

    const { rows: [updated] } = await db.query(
      `UPDATE usuarios SET activo = $1 WHERE id = $2
       RETURNING id, nombre, correo, categoria, agencia, activo`,
      [activo, targetId]
    );

    res.json({
      message: `Usuario "${updated.nombre}" ${activo ? 'activado' : 'desactivado'} correctamente`,
      usuario: updated,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
