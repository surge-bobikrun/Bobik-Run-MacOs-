const CACHE="bobik-run-pwa-v1";
const FILES=["./","./index.html","./manifest.json","./supabase-config.js","./icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin===self.location.origin){e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{if(res.ok)caches.open(CACHE).then(cache=>cache.put(r,res.clone()));return res}).catch(()=>caches.match("./index.html"))));return;}if(r.destination==="script"&&(u.hostname==="cdnjs.cloudflare.com"||u.hostname==="cdn.jsdelivr.net")){e.respondWith(fetch(r).then(res=>{if(res.ok||res.type==="opaque")caches.open(CACHE).then(c=>c.put(r,res.clone()));return res}).catch(()=>caches.match(r)));}});
