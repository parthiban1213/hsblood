// ══════════════════════════════════════════════════════════════
// HSBlood — js/api.js
// API fetch wrapper with auth headers and progress bar
// ══════════════════════════════════════════════════════════════

// ── AUTH HEADER ────────────────────────────────────
function authHeaders(){
  return {'Content-Type':'application/json','Authorization':'Bearer '+authToken};
}

// ── APP LOADER ─────────────────────────────────────
(function initLoader(){
  // Hide the launch loader once fonts + DOM are ready
  function hideLoader(){
    const el = document.getElementById('app-loader');
    if(!el) return;
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 500);
  }
  if(document.readyState === 'complete') { setTimeout(hideLoader, 600); }
  else { window.addEventListener('load', () => setTimeout(hideLoader, 600)); }
})();

// ── API PROGRESS BAR ───────────────────────────────
let _barRequests = 0;
let _barTimer    = null;

function barStart(){
  _barRequests++;
  const bar = document.getElementById('api-bar');
  if(!bar) return;
  clearTimeout(_barTimer);
  bar.style.transition = 'width .25s ease, opacity .15s ease';
  bar.style.opacity = '1';
  bar.style.width   = '30%';
  _barTimer = setTimeout(() => { bar.style.width = '70%'; }, 300);
}

function barDone(){
  _barRequests = Math.max(0, _barRequests - 1);
  if(_barRequests > 0) return;
  const bar = document.getElementById('api-bar');
  if(!bar) return;
  clearTimeout(_barTimer);
  bar.style.transition = 'width .2s ease, opacity .4s ease .2s';
  bar.style.width   = '100%';
  _barTimer = setTimeout(() => {
    bar.style.opacity = '0';
    setTimeout(() => { bar.style.width = '0%'; }, 450);
  }, 200);
}

async function apiFetch(url, opts={}, retries=2){
  barStart();
  for(let attempt=0; attempt<=retries; attempt++){
    const controller = new AbortController();
    const timeoutId  = setTimeout(()=>controller.abort(), 10000); // 10 s timeout
    try{
      const res  = await fetch(API+url, {headers:authHeaders(), signal:controller.signal, ...opts});
      clearTimeout(timeoutId);
      const data = await res.json();
      if(res.status===401){ barDone(); doLogout(); showToast('Session expired. Please log in again.','error'); return {success:false}; }
      barDone();
      return { ...data, status: res.status };
    }catch(e){
      clearTimeout(timeoutId);
      const isLastAttempt = attempt === retries;
      // Don't retry on non-GET requests (POST/PUT/DELETE) to avoid duplicate writes
      const method = (opts.method||'GET').toUpperCase();
      if(!isLastAttempt && method==='GET'){
        await new Promise(r=>setTimeout(r, 800*(attempt+1))); // 800ms, 1600ms backoff
        continue;
      }
      barDone();
      return{success:false, error: e.name==='AbortError' ? 'Request timed out. Is the backend running?' : 'Cannot connect to server.'};
    }
  }
}
