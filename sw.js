/* Rico's Integrated Home Utilities – offline shell v1.3.0.
   GitHub Pages: upload this file beside index.html (same repository folder).
   Cache Storage is APP CODE ONLY. User records remain in localStorage.
*/
const CACHE_NAME='rico-home-utilities-shell-v1.3.0';
const CACHE_PREFIX='rico-home-utilities-shell-v';
const SCOPE=self.registration.scope;
const SHELL_URL=new URL('./index.html',SCOPE).href;
const OPTIONAL_ASSETS=['./manifest.webmanifest','./apple-touch-icon.png','./home-utilities-icon-192.png','./home-utilities-icon-512.png'];

async function saveAppShell(){
  const cache=await caches.open(CACHE_NAME);
  const response=await fetch(new Request(SHELL_URL,{cache:'reload'}));
  if(!response.ok)throw new Error('Could not download index.html ('+response.status+').');
  await cache.put(SHELL_URL,response.clone());
  // Icons and manifest are optional: a missing icon must never block offline HTML.
  await Promise.allSettled(OPTIONAL_ASSETS.map(async asset=>{
    const url=new URL(asset,SCOPE).href;
    const res=await fetch(new Request(url,{cache:'reload'}));
    if(res.ok)await cache.put(url,res);
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    await saveAppShell(); // Installation succeeds only after offline HTML is cached.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith(CACHE_PREFIX)&&n!==CACHE_NAME).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type!=='PRECACHE_NOW')return;
  event.waitUntil((async()=>{
    try{await saveAppShell();event.ports?.[0]?.postMessage({ok:true})}
    catch(e){event.ports?.[0]?.postMessage({ok:false,error:String(e?.message||e).slice(0,180)})}
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||!url.href.startsWith(SCOPE))return;
  // Update checker and API-style fetches bypass the offline HTML fallback.
  // This ensures "Check Updates" never treats cached HTML as a live release.
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        // Give an online request up to 3.5s. When truly offline return immediately
        // from the installed shell, including Home Screen launches with query strings.
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),3500);
        try{
          const res=await fetch(req,{cache:'no-store',signal:controller.signal});
          if(!res.ok)throw new Error('HTTP '+res.status);
          const cache=await caches.open(CACHE_NAME);
          event.waitUntil(cache.put(SHELL_URL,res.clone()));
          return res;
        }finally{clearTimeout(timeout)}
      }catch(e){
        const cached=await caches.match(SHELL_URL,{ignoreSearch:true});
        if(cached)return cached;
        // If no shell was previously downloaded, a first offline visit cannot work.
        return new Response('App not installed for offline use yet. Open it online once first.',{
          status:503,headers:{'Content-Type':'text/plain; charset=UTF-8'}
        });
      }
    })());
    return;
  }
  // Cache icons/manifest, with network fallback. Other requests stay untouched.
  if(OPTIONAL_ASSETS.some(asset=>url.pathname===new URL(asset,SCOPE).pathname)){
    event.respondWith((async()=>{
      const cached=await caches.match(req,{ignoreSearch:true});
      if(cached)return cached;
      return fetch(req);
    })());
  }
});
