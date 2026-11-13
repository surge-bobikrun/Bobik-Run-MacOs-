const CACHE='bobik-run-v1710-session-2-119-0';
const FILES=['./','./index.html','./manifest.json','./icon-512.png','./icon-192.png','./supabase-config.js'];
const SDK_URLS=[
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0',
  'https://unpkg.com/@supabase/supabase-js@2.119.0'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(SDK_URLS.includes(e.request.url)){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const cached=await c.match(e.request);
      if(cached)return cached;
      const response=await fetch(e.request);
      if(response.ok)c.put(e.request,response.clone()).catch(()=>{});
      return response;
    }));
    return;
  }
  if(u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));
    return r;
  }).catch(()=>caches.match(e.request)));
});
