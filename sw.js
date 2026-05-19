/* sw.js — COI headers + MessageChannel streaming download */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* pending download map: token → { port, filename, mime, size } */
const pending = new Map();

self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'STREAM_REGISTER') {
    const { token, filename, mime, size } = e.data;
    const port = e.ports[0];
    const chunks = [];   // buffer chunks that arrive before fetch fires
    let controller = null;
    let done = false;

    port.onmessage = ev => {
      if (ev.data === null) {
        done = true;
        if (controller) { controller.close(); port.close(); }
      } else {
        const chunk = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
        if (controller) {
          controller.enqueue(chunk);
        } else {
          chunks.push(chunk); // buffer until ReadableStream is ready
        }
      }
    };
    port.onmessageerror = () => {
      if (controller) controller.error(new Error('port error'));
      port.close();
    };

    pending.set(token, {
      filename, mime, size,
      getStream() {
        return new ReadableStream({
          start(ctrl) {
            controller = ctrl;
            // flush buffered chunks
            for (const c of chunks) ctrl.enqueue(c);
            chunks.length = 0;
            if (done) { ctrl.close(); port.close(); }
          },
          cancel() { port.close(); }
        });
      }
    });

    // Signal ready immediately — main page can start pumping
    port.postMessage('ready');
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* intercept /~dl/<token> */
  if (url.pathname.startsWith('/~dl/')) {
    const token = url.pathname.slice(5);
    if (pending.has(token)) {
      const entry = pending.get(token);
      pending.delete(token);
      const { filename, mime, size } = entry;

      const stream = entry.getStream();

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
