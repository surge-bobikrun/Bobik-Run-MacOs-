const CACHE='bobik-run-v195-build40-award-retry-keybinds-20261118';
const FILES=['./','./index.html','./manifest.json','./icon-512.png','./icon-192.png','./supabase-config.js'];
const SDK_URLS=[
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0',
  'https://unpkg.com/@supabase/supabase-js@2.119.0'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await cache.addAll(FILES);
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(SDK_URLS.includes(event.request.url)){
  event.respondWith(caches.open(CACHE).then(async cache=>{
   const cached=await cache.match(event.request);if(cached)return cached;
   const response=await fetch(event.request);if(response.ok)cache.put(event.request,response.clone()).catch(()=>{});return response;
  }));return;
 }
 if(url.origin!==location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
  return response;
 }).catch(()=>caches.match(event.request)));
});
