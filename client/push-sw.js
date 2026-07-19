self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const title = payload.title || 'HaloChat';
  const options = {
    body: payload.body || '',
    icon: '/halo-icon-192.png',
    badge: '/halo-icon-96.png',
    tag: payload.tag || payload.callId || undefined,
    renotify: true,
    requireInteraction: payload.type === 'call:incoming',
    data: {
      url: payload.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existingWindow = windows.find((client) => new URL(client.url).origin === self.location.origin);

    if (existingWindow) {
      await existingWindow.navigate(targetUrl);
      return existingWindow.focus();
    }

    return self.clients.openWindow(targetUrl);
  })());
});
