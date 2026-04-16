const router = require('express').Router();
const db     = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { sendToUser } = require('../services/push');

router.use(authMiddleware);
router.use(requireRole('autorizador'));

// GET /api/aprobaciones — historial de acciones sobre lotes
router.get('/', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';
    const { rows } = await db.query(
      `SELECT a.*, u.nombre AS usuario_nombre,
              l.agencia, l.descripcion AS lote_descripcion,
              l.id AS lote_id_ref,
              l.monto_aprobado AS lote_monto_aprobado
       FROM aprobaciones a
       JOIN usuarios u ON u.id = a.usuario_id
       LEFT JOIN lotes l ON l.id = a.lote_id
       ${esCentral ? '' : 'WHERE l.agencia = $1'}
       ORDER BY a.fecha_hora DESC LIMIT 500`,
      esCentral ? [] : [req.user.agencia]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/aprobaciones — aprobar o rechazar un LOTE (con monto ajustable)
router.post('/', async (req, res) => {
  try {
    const { lote_id, accion, detalle, monto_aprobado } = req.body;

    if (!lote_id || !accion)
      return res.status(400).json({ error: 'lote_id y accion son obligatorios' });
    if (!['aprobado', 'rechazado'].includes(accion))
      return res.status(400).json({ error: 'Acción inválida' });

    // Verificar que el lote existe, está pendiente y pertenece a la agencia del autorizador
    const { rows: [lote] } = await db.query(
      `SELECT l.*, COALESCE(SUM(s.monto), 0) AS monto_total
       FROM lotes l
       LEFT JOIN solicitudes s ON s.lote_id = l.id
       WHERE l.id = $1
       GROUP BY l.id`,
      [lote_id]
    );
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
    if (lote.aprobado !== null) return res.status(400).json({ error: 'Este lote ya fue procesado' });

    const esCentral = req.user.agencia === 'Central';
    if (!esCentral && lote.agencia !== req.user.agencia)
      return res.status(403).json({ error: 'No autorizado para esta agencia' });

    // Validar monto_aprobado si se proporcionó
    let montoAprobadoFinal = null;
    const montoTotal = parseFloat(lote.monto_total);

    if (accion === 'aprobado' && monto_aprobado != null && monto_aprobado !== '') {
      const montoAdj = parseFloat(monto_aprobado);
      if (isNaN(montoAdj) || montoAdj < 0)
        return res.status(400).json({ error: 'Monto aprobado inválido' });
      if (montoAdj > montoTotal)
        return res.status(400).json({ error: `El monto aprobado (${fmt(montoAdj)}) no puede superar el total del lote (${fmt(montoTotal)})` });
      montoAprobadoFinal = montoAdj;
    } else if (accion === 'aprobado') {
      // Si no se especifica, se aprueba el total
      montoAprobadoFinal = montoTotal;
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null;
    const aprobadoBool = accion === 'aprobado';

    await db.query('BEGIN');
    try {
      await db.query(
        'UPDATE lotes SET aprobado = $1, monto_aprobado = $2 WHERE id = $3',
        [aprobadoBool, montoAprobadoFinal, lote_id]
      );
      await db.query('UPDATE solicitudes SET aprobado = $1 WHERE lote_id = $2', [aprobadoBool, lote_id]);

      const { rows: [log] } = await db.query(
        `INSERT INTO aprobaciones (lote_id, usuario_id, ip, accion, monto_aprobado, detalle)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [lote_id, req.user.id, ip, accion, montoAprobadoFinal, detalle || null]
      );

      await db.query('COMMIT');

      // Notificar al contador con el monto aprobado
      if (lote.creado_por) {
        const emoji = aprobadoBool ? '✅' : '❌';
        let cuerpo = `Tu lote #${lote_id} fue ${accion}`;
        if (aprobadoBool && montoAprobadoFinal !== null) {
          const esParecial = montoAprobadoFinal < montoTotal;
          if (esParecial) {
            cuerpo = `Tu lote #${lote_id} fue aprobado PARCIALMENTE por ${fmt(montoAprobadoFinal)} de ${fmt(montoTotal)} solicitados`;
          } else {
            cuerpo = `Tu lote #${lote_id} fue aprobado por ${fmt(montoAprobadoFinal)}`;
          }
        }
        if (detalle) cuerpo += `\n"${detalle}"`;

        sendToUser(lote.creado_por, {
          title: `${emoji} Lote ${accion} — ${lote.agencia}`,
          body: cuerpo,
          url: '/solicitudes', tag: `apr-lote-${lote_id}`,
        });
      }

      res.status(201).json({
        message: `Lote ${accion} correctamente`,
        aprobacion: log,
        monto_total: montoTotal,
        monto_aprobado: montoAprobadoFinal,
      });
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

const fmt = n => new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ'}).format(n);
module.exports = router;
