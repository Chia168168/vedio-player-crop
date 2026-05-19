/* coi-serviceworker (原有 COOP/COEP 功能保留) + streaming download */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* ── streaming download channel ── */
const streams = new Map(); // token → ReadableStream
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'STREAM_REGISTER') {
    const { token, stream } = e.data;
    streams.set(token, stream);
  }
});

self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  /* intercept /~dl/<token> → stream download */
  if (url.pathname.startsWith('/~dl/')) {
    const token = url.pathname.slice(5);
    if (streams.has(token)) {
      const stream = streams.get(token);
      streams.delete(token);
      const params = new URLSearchParams(url.search);
      const filename = params.get('filename') || 'clip.mp4';
      const mime = params.get('mime') || 'video/mp4';
      const size = params.get('size') || '';
      const headers = {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${filename}"`,
      };
      if (size) headers['Content-Length'] = size;
      event.respondWith(new Response(stream, { headers }));
      return;
    }
  }

  /* original COI headers passthrough */
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response.status === 0) return response;
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
      newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }).catch(e => { console.error(e); return fetch(event.request); })
  );
});
