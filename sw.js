/* sw.js — COI headers + MessageChannel streaming download */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* pending download map: token → { port, filename, mime, size } */
const pending = new Map();

self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'STREAM_REGISTER') {
    const { token, filename, mime, size } = e.data;
    // e.ports[0] is the MessagePort we'll pull data from
    pending.set(token, { port: e.ports[0], filename, mime, size });
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* intercept /~dl/<token> */
  if (url.pathname.startsWith('/~dl/')) {
    const token = url.pathname.slice(5);
    if (pending.has(token)) {
      const { port, filename, mime, size } = pending.get(token);
      pending.delete(token);

      /* Build a ReadableStream driven by messages from the main page */
      const stream = new ReadableStream({
        start(controller) {
          port.onmessage = e => {
            if (e.data === null) {
              // null = done
              controller.close();
              port.close();
            } else if (e.data instanceof Uint8Array || e.data instanceof ArrayBuffer) {
              controller.enqueue(
                e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data)
              );
            }
          };
          port.onmessageerror = () => {
            controller.error(new Error('port error'));
            port.close();
          };
          // Tell main page we're ready to receive
          port.postMessage('ready');
        },
        cancel() { port.close(); }
      });

      const headers = { 'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${filename}"` };
      if (size) headers['Content-Length'] = size;
      event.respondWith(new Response(stream, { headers }));
      return;
    }
  }

  /* COI passthrough */
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.status === 0) return res;
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch(e => { console.error(e); return fetch(event.request); })
  );
});
