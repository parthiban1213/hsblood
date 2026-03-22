// ══════════════════════════════════════════════════════════════
// HSBlood — js/animation.js
// Blood drop loading animation
// ══════════════════════════════════════════════════════════════

// ── BLOOD DROP ANIMATION ───────────────────────────
(function initBloodDropAnimation(){
  function setupBloodDrop(){
    const loginLeft = document.querySelector('.login-left');
    const scene     = document.getElementById('drop-scene');
    const icon      = document.getElementById('drop-icon');
    const drop      = document.getElementById('blood-drop');
    const bloodText = document.getElementById('blood-text');
    const splatterC = document.getElementById('splatter-container');
    if(!loginLeft || !scene || !icon || !drop || !bloodText) return;

    let animTimer  = null;
    let fillRaf    = null;
    let fillPct    = 0;
    let hasPlayed  = false; // once red, stays red forever

    function getLayout(){
      const sceneRect = scene.getBoundingClientRect();
      const iconRect  = icon.getBoundingClientRect();
      const textRect  = bloodText.getBoundingClientRect();

      const startX = iconRect.left + iconRect.width  / 2 - sceneRect.left;
      const startY = iconRect.top  + iconRect.height     - sceneRect.top;
      const endY   = textRect.top  - sceneRect.top + 4;
      const dist   = endY - startY;

      const splashX = textRect.left + textRect.width  / 2 - sceneRect.left;
      const splashY = textRect.top  + textRect.height / 2 - sceneRect.top;

      return { startX, startY, dist, splashX, splashY };
    }

    function clearSplatters(){
      if(splatterC) splatterC.innerHTML = '';
    }

    function spawnSplatters(splashX, splashY){
      if(!splatterC) return;
      clearSplatters();
      [0,35,75,120,155,200,245,300,335].forEach(angle => {
        const rad = (angle * Math.PI) / 180;
        const d   = 14 + Math.random() * 18;
        const dot = document.createElement('div');
        dot.className = 'blood-splatter';
        dot.style.cssText = `left:${splashX}px;top:${splashY}px;` +
          `--sx:${Math.round(Math.cos(rad)*d)}px;` +
          `--sy:${Math.round(Math.sin(rad)*d)}px;` +
          `width:${2+Math.random()*3}px;height:${2+Math.random()*3}px;`;
        splatterC.appendChild(dot);
        void dot.offsetWidth;
        dot.classList.add('flying');
        setTimeout(() => dot.remove(), 420);
      });
    }

    function animateFill(from, to, duration){
      cancelAnimationFrame(fillRaf);
      const start = performance.now();
      fillPct = from;

      function step(now){
        const t    = Math.min((now - start) / duration, 1);
        const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
        fillPct = from + (to - from) * ease;

        bloodText.style.setProperty('--fill-left',  (50 - fillPct * 0.5).toFixed(2) + '%');
        bloodText.style.setProperty('--fill-right', (50 + fillPct * 0.5).toFixed(2) + '%');

        if(t < 1) fillRaf = requestAnimationFrame(step);
        else fillPct = to;
      }
      fillRaf = requestAnimationFrame(step);
    }

    function runDrop(){
      if(hasPlayed) return; // text is already red — never re-trigger
      hasPlayed = true;

      // Remove the listener so it never fires again this session
      loginLeft.removeEventListener('mouseenter', runDrop);

      const { startX, startY, dist, splashX, splashY } = getLayout();

      drop.style.left       = startX + 'px';
      drop.style.top        = startY + 'px';
      drop.style.marginLeft = '0';
      drop.style.transform  = 'translateX(-50%)';
      drop.style.setProperty('--drop-distance', dist + 'px');

      drop.classList.remove('falling');
      bloodText.style.setProperty('--fill-left',  '50%');
      bloodText.style.setProperty('--fill-right', '50%');
      fillPct = 0;
      clearSplatters();
      void drop.offsetWidth;

      drop.classList.add('falling');

      animTimer = setTimeout(() => {
        spawnSplatters(splashX, splashY);
        // Fill to full red — stays permanently
        animateFill(0, 100, 800);
      }, 490);
    }

    // Trigger when mouse enters the entire left panel
    loginLeft.addEventListener('mouseenter', runDrop);
  }

  if(document.readyState !== 'loading') setupBloodDrop();
  else document.addEventListener('DOMContentLoaded', setupBloodDrop);
})();

// ── SESSION RESTORE ────────────────────────────────
// Uses localStorage so session persists across tabs and browser restarts.
// Auto-logout after 24 hours from login time.
(function restoreSession(){
  const t  = localStorage.getItem('bl_token');
  const u  = localStorage.getItem('bl_user');
  const exp = parseInt(localStorage.getItem('bl_expires_at') || '0', 10);

  if (!t || !u) return; // Nothing stored

  if (Date.now() > exp) {
    // Token has expired — clear everything and show login
    localStorage.removeItem('bl_token');
    localStorage.removeItem('bl_user');
    localStorage.removeItem('bl_expires_at');
    return;
  }

  // Valid session — restore
  authToken   = t;
  currentUser = JSON.parse(u);
  launchApp();

  // Schedule auto-logout exactly when the 24h expires
  const msUntilExpiry = exp - Date.now();
  setTimeout(() => {
    doLogout();
    showToast('Your session has expired. Please log in again.', 'error');
  }, msUntilExpiry);
})();

// ── INITIAL LOGIN FORM STATE ───────────────────────
// Show OTP form on load since HS Employee tab is active by default
(function initLoginForms(){
  const adminForm = document.getElementById('admin-login-form');
  const otpForm   = document.getElementById('user-otp-form');
  if (adminForm) adminForm.style.display = 'none';
  if (otpForm)   otpForm.style.display   = '';
})();
