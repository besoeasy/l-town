// PWA offline — cache-first for /three, map, client dist
const CACHE='ltown-v2-2.0.0'
const ASSETS=['/','/index.html','/manifest.json']
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting() })
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url)
  if(url.pathname.startsWith('/three/')||url.pathname.startsWith('/assets/')){
    e.respondWith(caches.match(e.request).then(r=> r||fetch(e.request).then(res=>{caches.open(CACHE).then(c=>c.put(e.request,res.clone())); return res})))
  } else {
    e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))
  }
})
// IndexedDB queue for inputs when offline — flush on online
self.addEventListener('sync',e=>{ if(e.tag==='flush-inputs') e.waitUntil((async()=>{ /* placeholder */ })()) })
