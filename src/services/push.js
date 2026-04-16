const webpush = require('web-push');
const db = require('../db');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BHlcufvg_s8LPWYE96T2ZNpsYBv6eE1Asg1U_0OMQOO390EZWOuSNvlG04FT9DR5gUIJ9fwvHhgwZ58Ew6xC37c';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'LlKZCE6u_xkQr1aN3ye2HyPvgZ6qZtOeWnMadoAamiI';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:admin@payflow.com';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

/**
 * Envía notificación push a todos los suscriptores de un usuario.
 */
async function sendToUser(userId, payload) {
  try {
    const { rows } = await db.query(
      'SELECT * FROM push_subscriptions WHERE usuario_id = $1',
      [userId]
    );
    const pushPayload = JSON.stringify(payload);
    const dead = [];

    await Promise.all(rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(subscription, pushPayload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(row.id);
        }
      }
    }));

    if (dead.length) {
      await db.query(`DELETE FROM push_subscriptions WHERE id = ANY($1)`, [dead]);
    }
  } catch (err) {
    console.error('Error enviando push a usuario', userId, err.message);
  }
}

/**
 * Envía notificación a todos los autorizadores ACTIVOS de una agencia.
 * Los autorizadores con activo=FALSE no reciben notificaciones (están de viaje/cubiertos).
 */
async function notifyAutorizadoresByAgencia(agencia, payload) {
  try {
    const { rows: users } = await db.query(
      `SELECT DISTINCT ps.usuario_id
       FROM push_subscriptions ps
       JOIN usuarios u ON u.id = ps.usuario_id
       WHERE u.categoria = 'autorizador'
         AND u.activo = TRUE
         AND (u.agencia = $1 OR u.agencia = 'Central')`,
      [agencia]
    );
    await Promise.all(users.map(u => sendToUser(u.usuario_id, payload)));
  } catch (err) {
    console.error('Error notificando autorizadores:', err.message);
  }
}

module.exports = { sendToUser, notifyAutorizadoresByAgencia, VAPID_PUBLIC };
