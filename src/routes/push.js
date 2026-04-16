const router = require('express').Router();
const db     = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { VAPID_PUBLIC }   = require('../services/push');

// GET /api/push/vapid-key — clave pública para el cliente
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// POST /api/push/subscribe — guardar suscripción del usuario
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Suscripción inválida' });
    }
    await db.query(
      `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id, endpoint) DO UPDATE
       SET p256dh = $3, auth = $4`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando suscripción' });
  }
});

// DELETE /api/push/unsubscribe
router.delete('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await db.query(
      'DELETE FROM push_subscriptions WHERE usuario_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando suscripción' });
  }
});

module.exports = router;
