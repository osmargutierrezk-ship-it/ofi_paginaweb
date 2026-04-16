const router = require('express').Router();
const db     = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { notifyAutorizadoresByAgencia } = require('../services/push');

router.use(authMiddleware);

const BANCOS_PERMITIDOS = ['Banrural', 'BAM'];

// GET /api/solicitudes — lista plana (para el contador)
router.get('/', async (req, res) => {
  try {
    let q, params;
    if (req.user.categoria === 'autorizador') {
      const esCentral = req.user.agencia === 'Central';
      q = `SELECT s.*, u.nombre AS creado_por_nombre
           FROM solicitudes s
           LEFT JOIN usuarios u ON u.id = s.creado_por
           ${esCentral ? '' : 'WHERE s.agencia = $1'}
           ORDER BY s.creado_en DESC`;
      params = esCentral ? [] : [req.user.agencia];
    } else {
      q = `SELECT s.*, u.nombre AS creado_por_nombre
           FROM solicitudes s
           LEFT JOIN usuarios u ON u.id = s.creado_por
           WHERE s.creado_por = $1
           ORDER BY s.creado_en DESC`;
      params = [req.user.id];
    }
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/solicitudes/lotes — lotes con sus solicitudes anidadas
router.get('/lotes', async (req, res) => {
  try {
    const esCentral = req.user.agencia === 'Central';

    const { rows: lotes } = await db.query(
      `SELECT l.*, u.nombre AS creado_por_nombre,
              COUNT(s.id)                          AS total_solicitudes,
              COALESCE(SUM(s.monto), 0)            AS monto_total,
              COUNT(s.id) FILTER (WHERE s.cafe_recibido) AS con_cafe
       FROM lotes l
       LEFT JOIN usuarios u  ON u.id  = l.creado_por
       LEFT JOIN solicitudes s ON s.lote_id = l.id
       ${esCentral ? '' : 'WHERE l.agencia = $1'}
       GROUP BY l.id, u.nombre
       ORDER BY l.creado_en DESC`,
      esCentral ? [] : [req.user.agencia]
    );

    if (!lotes.length) return res.json([]);

    const loteIds = lotes.map(l => l.id);
    const { rows: solis } = await db.query(
      `SELECT * FROM solicitudes WHERE lote_id = ANY($1) ORDER BY id`,
      [loteIds]
    );

    const mapaLotes = {};
    lotes.forEach(l => { mapaLotes[l.id] = { ...l, solicitudes: [] }; });
    solis.forEach(s => { if (mapaLotes[s.lote_id]) mapaLotes[s.lote_id].solicitudes.push(s); });

    res.json(Object.values(mapaLotes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/solicitudes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, u.nombre AS creado_por_nombre
       FROM solicitudes s LEFT JOIN usuarios u ON u.id = s.creado_por
       WHERE s.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rows[0];
    if (req.user.categoria === 'contador' && sol.creado_por !== req.user.id)
      return res.status(403).json({ error: 'Acceso denegado' });
    res.json(sol);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/solicitudes — solicitud individual (crea lote de 1)
router.post('/', requireRole('contador'), async (req, res) => {
  try {
    const { lba, descripcion, cafe_recibido, banco, monto } = req.body;
    const agencia = req.user.agencia;

    if (!lba || !descripcion || !banco || monto == null)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (!BANCOS_PERMITIDOS.includes(banco))
      return res.status(400).json({ error: `Banco inválido. Solo se permiten: ${BANCOS_PERMITIDOS.join(', ')}` });
    if (isNaN(parseFloat(monto)) || parseFloat(monto) < 0)
      return res.status(400).json({ error: 'Monto inválido' });

    const { rows: [lote] } = await db.query(
      `INSERT INTO lotes (agencia, creado_por, descripcion)
       VALUES ($1, $2, $3) RETURNING *`,
      [agencia, req.user.id, `Solicitud individual — ${lba}`]
    );

    const { rows: [sol] } = await db.query(
      `INSERT INTO solicitudes (agencia,lba,descripcion,cafe_recibido,banco,monto,creado_por,lote_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [agencia, lba.trim(), descripcion.trim(), Boolean(cafe_recibido), banco, parseFloat(monto), req.user.id, lote.id]
    );

    notifyAutorizadoresByAgencia(agencia, {
      title: `📋 Nueva solicitud — ${agencia}`,
      body: `${req.user.nombre} ingresó una solicitud de ${fmt(monto)} (${lba}) — ${banco}`,
      url: '/aprobaciones', tag: `lote-${lote.id}`,
    });

    res.status(201).json({ lote, solicitudes: [sol] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/solicitudes/bulk — lote de hasta 200 solicitudes
router.post('/bulk', requireRole('contador'), async (req, res) => {
  try {
    const { solicitudes } = req.body;
    const agencia = req.user.agencia;

    if (!Array.isArray(solicitudes) || !solicitudes.length)
      return res.status(400).json({ error: 'Lista vacía' });
    if (solicitudes.length > 200)
      return res.status(400).json({ error: 'Máximo 200 por lote' });

    const errors = [], valid = [];
    solicitudes.forEach((s, i) => {
      if (!s.lba || !s.descripcion || !s.banco || s.monto == null) {
        errors.push(`Fila ${i+1}: campos faltantes`); return;
      }
      const bancoNorm = String(s.banco).trim();
      if (!BANCOS_PERMITIDOS.includes(bancoNorm)) {
        errors.push(`Fila ${i+1}: banco inválido "${bancoNorm}". Solo se permiten: ${BANCOS_PERMITIDOS.join(', ')}`); return;
      }
      const monto = parseFloat(String(s.monto).replace(/,/g, ''));
      if (isNaN(monto) || monto < 0) {
        errors.push(`Fila ${i+1}: monto inválido`); return;
      }
      valid.push({ agencia, lba: String(s.lba).trim(), descripcion: String(s.descripcion).trim(),
        cafe_recibido: Boolean(s.cafe_recibido), banco: bancoNorm, monto, creado_por: req.user.id });
    });

    if (!valid.length) return res.status(400).json({ error: 'Sin filas válidas', detalles: errors });

    const montoTotal = valid.reduce((a, s) => a + s.monto, 0);

    const { rows: [lote] } = await db.query(
      `INSERT INTO lotes (agencia, creado_por, descripcion)
       VALUES ($1, $2, $3) RETURNING *`,
      [agencia, req.user.id, `Lote ${valid.length} solicitudes — ${fmt(montoTotal)}`]
    );

    const vals   = valid.map((_,i) => `($${i*8+1},$${i*8+2},$${i*8+3},$${i*8+4},$${i*8+5},$${i*8+6},$${i*8+7},$${i*8+8})`).join(',');
    const params = valid.flatMap(s => [s.agencia,s.lba,s.descripcion,s.cafe_recibido,s.banco,s.monto,s.creado_por,lote.id]);

    const { rows } = await db.query(
      `INSERT INTO solicitudes (agencia,lba,descripcion,cafe_recibido,banco,monto,creado_por,lote_id)
       VALUES ${vals} RETURNING *`, params
    );

    notifyAutorizadoresByAgencia(agencia, {
      title: `📦 Lote de ${valid.length} solicitudes — ${agencia}`,
      body: `${req.user.nombre} ingresó ${valid.length} solicitudes por ${fmt(montoTotal)}`,
      url: '/aprobaciones', tag: `lote-${lote.id}`,
    });

    res.status(201).json({ lote, insertados: rows.length, errores: errors, solicitudes: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

const fmt = n => new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ'}).format(n);
module.exports = router;
