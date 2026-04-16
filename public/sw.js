/* ═══════════════════════════════════════════════════════════
   PayFlow — Service Worker v2
   Maneja notificaciones push cuando la página está cerrada
   ════════════════════════════════════════════════════════ */

const CACHE_NAME = 'payflow-v2';

// Instalación del SW
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Evento PUSH: llega del servidor cuando la página está cerrada ──
self.addEventListener('push', (event) => {
  let data = { title: 'PayFlow', body: 'Tienes una notificación', url: '/', tag: 'payflow' };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body:    data.body,
    icon:    '/logo.png',
    badge:   '/logo.png',
    tag:     data.tag  || 'payflow',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: [
      { action: 'open',    title: 'Ver' },
      { action: 'dismiss', title: 'Cerrar' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Click en la notificación ──────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una pestaña abierta, enfócala
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return;
        }
      }
      // Si no, abrir nueva pestaña
      return clients.openWindow(self.location.origin + targetUrl);
    })
  );
});
