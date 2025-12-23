// Honey Editor — Navegación + Hotkeys (WASD, 1–5, Esc, Tab wrap) + Numpad view ctrl
(function () {
  const q  = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const isTyping = el => el && (el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable);

  // list helpers
  const LIST = '#spriteList';
  const ROW  = '.thingRow';
  const SELQ = '.thingRow.selected,[aria-selected="true"]';
  const colsOf = el => {
    const g = el && getComputedStyle(el).gridTemplateColumns;
    return g ? g.split(' ').filter(Boolean).length || 1 : 1;
  };
  const rows = ()=> qa(`${LIST} ${ROW}`);
  const curIndex = (arr)=>{
    let sel = q(SELQ);
    if (!sel && arr.length) sel = arr[0];
    return Math.max(0, arr.indexOf(sel));
  };
  const pick = (arr,i)=>{
    i = Math.max(0, Math.min(arr.length-1, i));
    const el = arr[i]; if (!el) return i;
    el.scrollIntoView({block:'nearest', inline:'nearest'});
    el.click?.();
    requestAnimationFrame(()=>{
      arr.forEach(r=>r.classList?.remove('selected'));
      el.classList?.add('selected');
      el.setAttribute('aria-selected','true');
    });
    return i;
  };
  const move = (dx,dy)=>{
    const list = q(LIST); if (!list) return;
    const r = rows(); if (!r.length) return;
    const c = Math.max(1, colsOf(list));
    const i = curIndex(r);
    let n = i + dy*c + dx;
    if (dy===0 && dx!==0){
      const y = Math.floor(i/c);
      if (Math.floor(n/c)!==y) n = i;
    }
    pick(r,n);
  };

  // WASD repeat
  const WATCH = new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyZ','KeyX']);
  const held = new Set(), timers = new Map();
  const FIRST = 260, EVERY = 120;
  const step = code=>{
    switch(code){
      case 'KeyW': return {dx:0,dy:-1}; case 'KeyS': return {dx:0,dy:1};
      case 'KeyA': return {dx:-1,dy:0}; case 'KeyD': return {dx:1,dy:0};
      case 'KeyQ': return {dx:-1,dy:-1}; case 'KeyE': return {dx:1,dy:-1};
      case 'KeyZ': return {dx:-1,dy:1}; case 'KeyX': return {dx:1,dy:1};
      default: return {dx:0,dy:0};
    }
  };
  const runOnce = code=>{ const {dx,dy}=step(code); if (dx||dy) move(dx,dy); };

  // categories
  const getCatSelect = ()=> q('#thingCategory') || q('#typeSelect') || q('#sidebar select') || q('label:has(select) select') || null;
  const cycleCat = dir=>{
    const sel = getCatSelect(); if (!sel) return;
    const n = sel.options.length; if (!n) return;
    sel.selectedIndex = (sel.selectedIndex + dir + n) % n;
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  };

  // modals close
  function getVisibleModals(){
    const all = qa('[role="dialog"], .modal, #flagsAuditPanel, #otbEditorPanel, #reemplazadorPanel, #remplazadorPanel, #thingConstructorPanel');
    return all.filter(m => m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none' && m.offsetParent !== null);
  }
  function closeTopModal(){
    const list = getVisibleModals();
    if (!list.length) return false;
    const m = list[list.length-1];
    const closeBtn = m.querySelector('[data-close], .btn-close, .close, [aria-label="Close"], button[title="Close"], button[title="Cerrar"], #miniExportCancelBtn');
    if (closeBtn){ closeBtn.click(); return true; }
    m.classList.add('hidden');
    return true;
  }

  // module open
  function callWindowFn(name){
    try{
      const parts = String(name).split('.');
      let ctx = window;
      for(const p of parts){
        if (!ctx) return false;
        ctx = ctx[p];
      }
      if (typeof ctx === 'function'){ ctx(); return true; }
    }catch(e){}
    return false;
  }
  const openFns = {
    '1':['openThingConstructorFromUI','openThingConstructor'],
    '2':['openFlagsAudit','showFlagsAudit'],
    '3':['openOtbEditor','showOtbEditor','OTBEditor.open'],
    '4':['openReemplazador','openComparator','openRemplazador','Reemplazador.open'],
    '5':['openExportSpritesheet','openExportFull','exportRenderedThingFullSpritesheet']
  };
  const btnIds = {
    '1':['constructorBtn'],
    '2':['flagAuditBtn'],
    '3':['otbEditorBtn'],
    '4':['reemplazadorBtn','remplazadorBtn'],
    '5':['exportFullSpritesheetBtn','exportFullBtn']
  };
  const btnText = {
    '1':['Constructor'],
    '2':['Flag Audit','Auditor'],
    '3':['OTB Editor','OTB'],
    '4':['Reemplazador','Remplazador','Comparator','Replacer'],
    '5':['Exportar FULL Spritesheet','Export FULL']
  };
  const clickIds  = ids=>{ for(const id of ids||[]){ const el=document.getElementById(id); if(el){ el.click(); return true; } } return false; };
  const clickText = list=>{
    const btns = qa('button,a');
    for(const t of list||[]){ const el = btns.find(b => (b.textContent||'').toLowerCase().includes(t.toLowerCase())); if(el){ el.click(); return true; } }
    return false;
  };
  function openModule(d){
    for(const fn of (openFns[d]||[])){
      if (callWindowFn(fn)) return;
    }
    if (clickIds(btnIds[d]) || clickText(btnText[d])) return;
    window.dispatchEvent(new CustomEvent('honey:open', { detail: d }));
  }

  // saved state for toggles
  const _saved = {};
  function saveOnce(key, value){ if (_saved[key] === undefined) _saved[key] = value; }
  function restoreIfSaved(key, setter){
    if (_saved[key] !== undefined){ setter(_saved[key]); delete _saved[key]; return true; }
    return false;
  }
  function toggleOrSetRestore(key, target, getter, setter){
    const cur = String(getter());
    if (cur === String(target)){
      restoreIfSaved(key, setter) || setter('0');
    } else {
      saveOnce(key, cur);
      setter(String(target));
    }
  }

  // controls
  const getMountEl  = ()=> q('#mount')  || q('#mountToggle,[name="mount"]');
  const getAddonsEl = ()=> q('#addons') || q('#addonsSelect,[name="addons"]');
  const getLayerEl  = ()=> q('#layer')  || q('#layerSelect,[name="layer"]');
  const dispatch = el => el && el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  const setVal = (el,v)=>{ if(!el) return; el.value = String(v); dispatch(el); };
  const getVal = el => el ? (el.value||'0') : '0';

  function toggleMount(){ const el = getMountEl(); if(!el) return; toggleOrSetRestore('mount', '1', ()=>getVal(el), v=>setVal(el,v)); }
  function toggleAddon(target){ const el = getAddonsEl(); if(!el) return; toggleOrSetRestore('addons#'+target, String(target), ()=>getVal(el), v=>setVal(el,v)); }
  function toggleLayer01(){ const el = getLayerEl(); if(!el) return; const cur = Number(getVal(el)||0); const target = cur?0:1; toggleOrSetRestore('layer01', String(target), ()=>getVal(el), v=>setVal(el,v)); }


  // ---- Zoom controls ----
  const getZoomEl = ()=> q('#zoom') || q('#zoomRange,[name="zoom"]');
  function adjustThingZoom(dir){
    const el = getZoomEl(); if (!el) return;
    const step = Number(el.step) || 1;
    const min = (el.min!==''?Number(el.min):1);
    const max = (el.max!==''?Number(el.max):20);
    let v = Number(el.value||0) + dir*step;
    v = Math.max(min, Math.min(max, v));
    el.value = String(v);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  }

  // App-level zoom (ctrl + / -). Does not change layout directly.
  let __honey_app_zoom = Number(document.documentElement.getAttribute('data-app-zoom') || 1.0);
  function adjustAppZoom(dir){
    __honey_app_zoom = Math.round(Math.max(0.5, Math.min(2.0, __honey_app_zoom + dir*0.1))*100)/100;
    document.documentElement.setAttribute('data-app-zoom', String(__honey_app_zoom));
    // Emit event. App can listen and apply transform if desired.
    window.dispatchEvent(new CustomEvent('honey:app-zoom-changed',{detail:__honey_app_zoom}));
  }


  // key handling
  const isTopRowDigit = e => /^Digit[1-5]$/.test(e.code) && e.location === 0;

  addEventListener('keydown', e=>{
    if (isTyping(e.target)) return;

    // WASD
    if (WATCH.has(e.code)){
      e.preventDefault();
      if (held.has(e.code)) return;
      held.add(e.code);
      runOnce(e.code);
      const t1 = setTimeout(()=>{ const t2 = setInterval(()=> runOnce(e.code), EVERY); timers.set(e.code, {t1:null, t2}); }, FIRST);
      timers.set(e.code, {t1, t2:null});
      return;
    }

    // top-row digits open modules
    if (isTopRowDigit(e) && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat){
      e.preventDefault();
      openModule(e.code.slice(-1));
      return;
    }

    if (e.key==='Tab'){ e.preventDefault(); cycleCat(e.shiftKey?-1:+1); return; }
    if (e.key==='Escape'){ e.preventDefault(); closeTopModal(); return; }

    // Numpad mapping requested
    if (e.code==='Numpad7'){ e.preventDefault(); toggleMount(); return; } // toggle mount 0<->1
    if (e.code==='Numpad0'){ e.preventDefault(); toggleAddon(0); return; } // addons 0 toggle
    if (e.code==='Numpad8'){ e.preventDefault(); toggleAddon(1); return; } // addons 1 toggle
    if (e.code==='Numpad9'){ e.preventDefault(); toggleAddon(2); return; } // addons 2 toggle
    if (e.code==='Numpad5'){ e.preventDefault(); toggleAddon(3); return; } // addons 3 toggle (full)
    if (e.code==='Numpad6'){ e.preventDefault(); toggleLayer01(); return; } // layer 0<->1 toggle
    // Numpad1/2/3 do nothing
    // otros
    if (e.code==='Space'){ e.preventDefault(); const btn=qa('button').find(b=>(b.textContent||'').toLowerCase().includes('animar frames')); btn?.click(); return; }
    if (e.key==='g' || e.key==='G'){ e.preventDefault(); const btn=qa('button').find(b=>(b.textContent||'').toLowerCase().includes('mostrar/ocultar grid')); btn?.click(); return; }
    if (e.key==='b' || e.key==='B'){ e.preventDefault(); const s = q('#searchInput') || q('#sidebar input[type="search"]') || q('#sidebar input[type="text"]'); if (s){ s.focus(); s.select?.(); } return; }
    if (e.key==='+' || e.key==='=' || e.code==='NumpadAdd'){ e.preventDefault(); zoomAdjust(+1); return; }
    if (e.key==='-' || e.code==='NumpadSubtract'){ e.preventDefault(); zoomAdjust(-1); return; }
    if (e.ctrlKey && e.code==='ArrowLeft'){ e.preventDefault(); const b=qa('#sidebar button').find(x=>(x.textContent||'').toLowerCase().includes('anterior')); b?.click(); return; }
    if (e.ctrlKey && e.code==='ArrowRight'){ e.preventDefault(); const b=qa('#sidebar button').find(x=>(x.textContent||'').toLowerCase().includes('siguiente')); b?.click(); return; }
  }, {passive:false});

  addEventListener('keyup', e=>{
    if (!WATCH.has(e.code)) return;
    e.preventDefault();
    held.delete(e.code);
    const tm = timers.get(e.code);
    if (tm){ if (tm.t1) clearTimeout(tm.t1); if (tm.t2) clearInterval(tm.t2); timers.delete(e.code); }
  }, {passive:false});

  document.addEventListener('DOMContentLoaded', ()=>{
    const r = rows();
    if (r.length && !q(SELQ)) pick(r,0);
  });
})();