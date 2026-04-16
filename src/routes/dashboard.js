const router = require('express').Router();
const db     = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);
router.use(requireRole('autorizador'));

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';
    const { rows } = await db.query(
      `SELECT
         COUNT(*)                                            AS total_solicitudes,
         COUNT(*) FILTER (WHERE aprobado IS NULL)           AS pendientes,
         COUNT(*) FILTER (WHERE aprobado = TRUE)            AS aprobadas,
         COUNT(*) FILTER (WHERE aprobado = FALSE)           AS rechazadas,
         COALESCE(SUM(monto), 0)                            AS monto_total,
         COALESCE(SUM(monto) FILTER (WHERE aprobado = TRUE), 0) AS monto_aprobado
       FROM solicitudes
       ${esCentral ? '' : 'WHERE agencia = $1'}`,
      esCentral ? [] : [req.user.agencia]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/dashboard/resumen
router.get('/resumen', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';
    const { rows } = await db.query(
      `SELECT
         agencia,
         COUNT(*)                                             AS total,
         COUNT(*) FILTER (WHERE aprobado IS NULL)             AS pendientes,
         COUNT(*) FILTER (WHERE aprobado = TRUE)              AS aprobadas,
         COUNT(*) FILTER (WHERE aprobado = FALSE)             AS rechazadas,
         COALESCE(SUM(monto), 0)                              AS monto_total,
         COALESCE(SUM(monto) FILTER (WHERE aprobado = TRUE),  0) AS monto_aprobado,
         COALESCE(SUM(monto) FILTER (WHERE aprobado IS NULL), 0) AS monto_pendiente
       FROM solicitudes
       ${esCentral ? '' : 'WHERE agencia = $1'}
       GROUP BY agencia
       ORDER BY monto_total DESC`,
      esCentral ? [] : [req.user.agencia]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/dashboard/bancos — resumen de montos por banco (Banrural / BAM)
router.get('/bancos', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';
    const { rows } = await db.query(
      `SELECT
         banco,
         COUNT(*)                                                AS total_solicitudes,
         COUNT(*) FILTER (WHERE aprobado IS NULL)                AS pendientes,
         COUNT(*) FILTER (WHERE aprobado = TRUE)                 AS aprobadas,
         COUNT(*) FILTER (WHERE aprobado = FALSE)                AS rechazadas,
         COALESCE(SUM(monto), 0)                                 AS monto_total,
         COALESCE(SUM(monto) FILTER (WHERE aprobado IS NULL), 0) AS monto_pendiente,
         COALESCE(SUM(monto) FILTER (WHERE aprobado = TRUE),  0) AS monto_aprobado,
         COALESCE(SUM(monto) FILTER (WHERE aprobado = FALSE), 0) AS monto_rechazado
       FROM solicitudes
       ${esCentral ? '' : 'WHERE agencia = $1'}
       GROUP BY banco
       ORDER BY monto_total DESC`,
      esCentral ? [] : [req.user.agencia]
    );
    // Garantizar siempre ambos bancos aunque no tengan data
    const bancos = ['Banrural', 'BAM'];
    const resultado = bancos.map(b => {
      const found = rows.find(r => r.banco === b);
      return found || {
        banco: b,
        total_solicitudes: '0', pendientes: '0', aprobadas: '0', rechazadas: '0',
        monto_total: '0', monto_pendiente: '0', monto_aprobado: '0', monto_rechazado: '0',
      };
    });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/dashboard/agencia/:agencia
router.get('/agencia/:agencia', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';
    const agencia   = decodeURIComponent(req.params.agencia);

    if (!esCentral && agencia !== req.user.agencia) {
      return res.status(403).json({ error: 'Solo puedes ver tu agencia' });
    }

    const { rows } = await db.query(
      `SELECT s.*, u.nombre AS creado_por_nombre
       FROM solicitudes s
       LEFT JOIN usuarios u ON u.id = s.creado_por
       WHERE s.agencia = $1
       ORDER BY s.creado_en DESC`,
      [agencia]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
