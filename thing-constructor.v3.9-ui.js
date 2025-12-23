(function(){
  'use strict';

  /* ========= UTIL ========= */
  const TILE=32;
  const $=id=>document.getElementById(id);
  const ce=(t,c,h)=>{const e=document.createElement(t); if(c) e.className=c; if(h!=null) e.innerHTML=h; return e;};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v|0));
  const ready=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();

  const getDAT=()=>window.dat||window.DAT||null;
  const getSPR=()=>window.spr||window.SPR||null;
  const selectThing = id => { try { if (typeof window.selectThing === 'function') window.selectThing(id); } catch (_) {} };
  const getCurrentThingId = () => { try { return (typeof window.getCurrentThingId === 'function' ? window.getCurrentThingId() : 0) | 0; } catch (_) { return 0; } };

  function nextFreeId(cat){
    const dat=getDAT(); if(!dat) return 0;
    const coll = cat==='item'? dat.items : cat==='outfit'? dat.outfits : cat==='effect'? dat.effects : dat.missiles;
    let id = cat==='item'?100:1; while(coll[id]) id++; return id;
  }
  function addThing(cat,thing){
    const dat=getDAT(); if(!dat) return;
    const id=thing.id|0;
    if(cat==='item'){ dat.items[id]=thing; dat.itemCount=Math.max(dat.itemCount|0,id); }
    else if(cat==='outfit'){ dat.outfits[id]=thing; dat.outfitCount=Math.max(dat.outfitCount|0,id); }
    else if(cat==='effect'){ dat.effects[id]=thing; dat.effectCount=Math.max(dat.effectCount|0,id); }
    else { dat.missiles[id]=thing; dat.missileCount=Math.max(dat.missileCount|0,id); }
  }

  /* ========= STATE ========= */
  const S = {
    type:'outfit',
    group:0,
    shape:{width:1,height:1,layers:1,patternX:4,patternY:1,patternZ:1,frames:1},
    frames:[[],[]],
    durations:[[],[]],
    framesCount:[1,1],
    slot:0,
    zoom:3,            // preview derecha
    sheetZoom:1,       // zoom del spritesheet (centro)
    place:'grid',
    omitTransparent:false, alphaTol:0,
    sheets:[],   // [{id,name,img,tw,th,src,selected:Set,order:[],lastIndex,meta:{role,dir,addon,mount,layerMask}}]
    si:-1,
    showGrid:true,
    cursor:{},
    _offX:0, _offY:0   // offset de centrado del preview (para hover coords)
  };
  const dirPX={N:0,E:1,S:2,W:3};

  /* ========= DIM / INDEX ========= */
  const dimsFromShape=s=>({W:s.width|0,H:s.height|0,L:s.layers|0,PX:s.patternX|0,PY:s.patternY|0,PZ:s.patternZ|0,F:s.frames|0});
  const dimsFor=(g)=>{ const s=S.shape; return {W:s.width|0,H:s.height|0,L:s.layers|0,PX:s.patternX|0,PY:s.patternY|0,PZ:s.patternZ|0,F:(S.framesCount[g]|0)||1}; };
  const perGroupBaseSlots=()=>{ const D=dimsFor(S.group); return D.L*D.PX*D.PY*D.PZ*D.F; };
  const idxBase=(t,D)=>((((t.F*D.PZ + t.PZ)*D.PY + t.PY)*D.PX + t.PX)*D.L + t.L);
  function ensureLayerArrays(){
    const L=S.shape.layers|0;
    for(let g=0;g<2;g++){
      if(!S.frames[g]) S.frames[g]=[];
      for(let l=0;l<L;l++) if(!S.frames[g][l]) S.frames[g][l]=new Map();
      S.frames[g].length=L;
    }
  }
  function hasAnyAssignment(){ const L=S.shape.layers|0; for(let g=0;g<2;g++) for(let l=0;l<L;l++) if(S.frames[g] && S.frames[g][l] && S.frames[g][l].size) return true; return false; }

  /* ========= STYLES ========= */
  function injectStyles(){
    if($('tc36Styles')) return;
    const st = ce('style'); st.id = 'tc36Styles';
    st.textContent = [
      ':root{',
      '  --bg:#0c111b; --card:#0a0f18; --hover:#121a28; --b:#273145; --b2:#344864;',
      '  --tx:#eaf0ff; --mut:#a9bed7; --pri:#2b63ff; --pri2:#3a6bff; --dang:#8b1d1d; --dang2:#b32626;',
      '  --shadow:0 10px 28px rgba(0,0,0,.45); --rad:12px; --rad2:8px; --gap:12px;',
      '  --font: 11.5px/1.45 ui-sans-serif, system-ui, Segoe UI, Roboto, Arial;',
      '}',
      '*{box-sizing:border-box}',
      '.tc36-modal{position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:flex-start;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);z-index:99999;opacity:0;pointer-events:none;transition:.2s}',
      '.tc36-modal.active{opacity:1;pointer-events:all}',
      '.tc36-win{width:min(1440px,98vw);height:min(860px,96vh);background:var(--bg);color:var(--tx);border:1px solid var(--b);border-radius:var(--rad);display:flex;flex-direction:column;box-shadow:var(--shadow);overflow:hidden;transform:scale(.985);opacity:.98;transition:.2s;font:var(--font)}',
      '.tc36-modal.active .tc36-win{transform:scale(1);opacity:1}',
      '.tc36-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--b);background:var(--card)}',
      '.tc36-title{font-weight:800;font-size:13px;letter-spacing:-.2px}',
      '.tc36-body{flex:1;min-height:0;display:grid;grid-template-columns:360px 1fr 380px;gap:var(--gap);padding:var(--gap);overflow:hidden}',
      '@media (max-width:1200px){.tc36-body{grid-template-columns:1fr}}',
      '.tc36-col{display:flex;flex-direction:column;min-height:0;overflow:hidden;gap:var(--gap)}',
      '.tc36-card{background:var(--card);border:1px solid var(--b);border-radius:var(--rad);padding:10px;min-height:0;display:flex;flex-direction:column;gap:8px}',
      '.tc36-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;min-width:0}',
      '.tc36-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.tc36-grid > label{display:flex;align-items:center;gap:6px;min-width:0}',
      '.tc36-btn{background:#1b283c;border:1px solid var(--b2);color:var(--tx);border-radius:var(--rad2);padding:8px 12px;cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;min-height:30px}',
      '.tc36-btn:hover{background:#223046}',
      '.tc36-primary{background:var(--pri);border-color:var(--pri2)}',
      '.tc36-primary:hover{background:var(--pri2)}',
      '.tc36-danger{background:var(--dang);border-color:var(--dang2)}',
      '.tc36-danger:hover{background:var(--dang2)}',
      '.tc36-tag{font-size:11px;background:#142033;border:1px solid #24344d;border-radius:4px;padding:2px 8px;display:inline-block}',
      '.tc36-sheetWrap,.tc36-gridWrap{position:relative;border:1px solid var(--b);border-radius:var(--rad);background:#0b0f15;min-height:280px;flex:1;display:flex;align-items:flex-start;justify-content:flex-start;overflow:auto}',
      '.tc36-sheetInner{position:absolute;left:0;top:0;transform-origin:top left}',
      '.tc36-sheetCanvas,.tc36-overlay{image-rendering:pixelated;display:block}',
      '.tc36-overlay{position:absolute;left:0;top:0;pointer-events:none}',
      '.tc36-tiny{font-size:11px;color:var(--mut)}',
      'input,select{background:#0f1522;border:1px solid var(--b);color:var(--tx);border-radius:6px;padding:6px 8px;font-size:12px;min-height:28px}',
      'input[type=number]{width:64px;text-align:center}',
      '.tc36-tabs{display:flex;gap:8px;overflow:auto;padding:6px;border:1px solid #1f2a3b;border-radius:8px;background:#0f1726}',
      '.tc36-tab{white-space:nowrap;border:1px solid #33455f;background:#122038;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px}',
      '.tc36-tab.on{background:var(--pri);border-color:var(--pri2);color:#fff}',
      '.tc36-timeline{display:flex;flex-wrap:wrap;gap:6px;max-height:140px;overflow:auto;border:1px solid #223046;border-radius:8px;background:#0b0f15;padding:6px}',
      '.tc36-timeline .chip{cursor:pointer;opacity:.75}',
      '.tc36-timeline .chip.on{opacity:1}',
      '.tc36-footerRow{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.tc36-modal { align-items: center !important; justify-content: center !important; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ========= UI ========= */
  function buildModal(){
    if($('thingConstructor36')) return;

    const modal = ce('div','tc36-modal',[
      '<div class="tc36-win" role="dialog" aria-modal="true" aria-labelledby="tc36Title">',
      '  <div class="tc36-head">',
      '    <div class="tc36-title" id="tc36Title">Thing Constructor 3.6</div>',
      '    <div class="tc36-row">',
      '        <div class="tc36-row">',
      '          <button id="tc36Create" class="tc36-btn tc36-primary">🚀 Crear Thing</button>',
      '          <button id="tc36Replace" class="tc36-btn">🔄 Reemplazar</button>',
      '        </div>',
      '      <button id="tc36Reset" class="tc36-btn tc36-danger">↻ Reiniciar</button>',
      '      <button id="tc36CloseTop" class="tc36-btn">✕ Cerrar</button>',
      '    </div>',
      '  </div>',
      '  <div class="tc36-body">',
      '    <!-- IZQUIERDA -->',
      '    <div class="tc36-col">',
      '      <div class="tc36-card">',
      '        <div class="tc36-grid">',
      '          <label>Tipo',
      '            <select id="tc36Type">',
      '              <option value="outfit" selected>Outfit</option>',
      '              <option value="effect">Effect</option>',
      '              <option value="missile">Missile</option>',
      '              <option value="item">Item</option>',
      '            </select>',
      '          </label>',
      '          <label>Grupo',
      '            <select id="tc36Group"><option value="0">Idle</option><option value="1">Walking</option></select>',
      '          </label>',
      '        </div>',
      '        <div class="tc36-row"><strong>Forma del Sprite</strong></div>',
      '        <div class="tc36-grid">',
      '          <label>W <input id="tc36W" type="number" min="1" max="64" value="1"></label>',
      '          <label>H <input id="tc36H" type="number" min="1" max="64" value="1"></label>',
      '          <label>L <input id="tc36L" type="number" min="1" max="8" value="1" disabled></label>',
      '          <label>PX <input id="tc36PX" type="number" value="4" disabled></label>',
      '          <label>PY <input id="tc36PY" type="number" min="1" max="8" value="1"></label>',
      '          <label>PZ <input id="tc36PZ" type="number" min="1" max="8" value="1"></label>',
      '          <label>F <input id="tc36F" type="number" min="1" max="128" value="1"></label>',
      '        </div>',
      '        <div class="tc36-grid">',
      '          <label>Modo',
      '            <select id="tc36Place">',
      '              <option value="grid">No escalar</option>',
      '              <option value="fit">Ajustar al bloque</option>',
      '            </select>',
      '          </label>',
      '          <label><input id="tc36Omit" type="checkbox"> Omitir tiles vacíos</label>',
      '          <label>Umbral α <input id="tc36Alpha" type="number" min="0" max="255" value="0"></label>',
      '          <label>Duración (ms) <input id="tc36Dur" type="number" min="1" value="100"></label>',
      '        </div>',
      '      </div>',
      '      <div class="tc36-card">',
      '        <div class="tc36-footerRow">',
      '          <strong>Biblioteca de Sheets</strong>',
      '          <div class="tc36-row">',
      '            <label class="tc36-btn">',
      '              📤 Añadir',
      '              <input id="tc36SheetFiles" type="file" accept="image/png" multiple style="display:none">',
      '            </label>',
      '            <button id="tc36RemoveSheet" class="tc36-btn">🗑️ Eliminar</button>',
      '            <button id="tc36ApplyAll" class="tc36-btn tc36-primary">✨ Aplicar TODO</button>',
      '          </div>',
      '        </div>',
      '        <div class="tc36-grid">',
      '          <label>Etiqueta',
      '            <select id="tc36Role">',
      '              <option value="outfit-base">Outfit Base</option>',
      '              <option value="layer-l1">Layer L1</option>',
      '              <option value="layer-l2">Layer L2</option>',
      '              <option value="layer-l3">Layer L3</option>',
      '              <option value="addon-1">Addon 1 (PY=1)</option>',
      '              <option value="addon-2">Addon 2 (PY=2)</option>',
      '              <option value="addon-12">Addon 1+2 (PY=3)</option>',
      '              <option value="effect">Effect</option>',
      '              <option value="missile">Missile</option>',
      '            </select>',
      '          </label>',
      '          <label>Dir',
      '            <select id="tc36Dir"><option>N</option><option>E</option><option selected>S</option><option>W</option></select>',
      '          </label>',
      '          <label>Addon PY <input id="tc36PYd" type="number" min="0" max="7" value="0"></label>',
      '          <label>Mount PZ <input id="tc36PZd" type="number" min="0" max="7" value="0"></label>',
      '        </div>',
      '        <div class="tc36-row">',
      '          <span>Capas hoja:</span>',
      '          <label><input id="tc36LM0" type="checkbox" checked> L0</label>',
      '          <label><input id="tc36LM1" type="checkbox"> L1</label>',
      '          <label><input id="tc36LM2" type="checkbox"> L2</label>',
      '          <label><input id="tc36LM3" type="checkbox"> L3</label>',
      '        </div>',
      '        <div class="tc36-footerRow">',
      '          <div class="tc36-row">',
      '            <button id="tc36SelAll" class="tc36-btn">✓ Todo</button>',
      '            <button id="tc36SelInvert" class="tc36-btn">⇆ Invertir</button>',
      '            <button id="tc36SelClear" class="tc36-btn">✗ Limpiar</button>',
      '          </div>',
      '          <div class="tc36-row">',
      '            <label><input id="tc36ShowGrid" type="checkbox" checked> Grid</label>',
      '            <button id="tc36SelToFrames" class="tc36-btn tc36-primary">→ Aplicar</button>',
      '          </div>',
      '        </div>',
      '        <div class="tc36-footerRow">',
      '          <div class="tc36-row">',
      '            <button id="tc36Prev" class="tc36-btn">◀</button>',
      '            <span id="tc36SlotInfo" class="tc36-tag">BaseSlot 0</span>',
      '            <button id="tc36Next" class="tc36-btn">▶</button>',
      '            <button id="tc36ClearSlot" class="tc36-btn">🗑️ Limpiar</button>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <!-- CENTRO -->',
      '    <div class="tc36-col">',
      '      <div class="tc36-card" style="min-height:0">',
      '        <div class="tc36-footerRow">',
      '          <strong>Spritesheet Activo</strong>',
      '          <span id="tc36SheetInfo" class="tc36-tag">Ninguna hoja</span>',
      '        </div>',
      '        <div class="tc36-footerRow">',
      '          <div class="tc36-row">',
      '            <label>Sheet Zoom',
      '              <input id="tc36SheetZoom" type="range" min="0.5" max="3" step="0.25" value="1" style="width:140px">',
      '              <span id="tc36SheetZoomVal" class="tc36-tag">1×</span>',
      '            </label>',
      '          </div>',
      '          <div class="tc36-tiny">Arrastra PNG aquí para cargar</div>',
      '        </div>',
      '        <div class="tc36-sheetWrap" id="tc36SheetWrap">',
      '          <div id="tc36SheetInner" class="tc36-sheetInner">',
      '            <canvas id="tc36Sheet" class="tc36-sheetCanvas" aria-label="Spritesheet"></canvas>',
      '            <canvas id="tc36SheetOverlay" class="tc36-overlay"></canvas>',
      '          </div>',
      '        </div>',
      '        <div class="tc36-tiny">',
      '          • Clic: esquina superior izquierda del bloque W×H · Shift+Clic: rango · Orden preservado.',
      '        </div>',
      '      </div>',
      '        <div id="tc36Tabs" class="tc36-tabs"></div>',
      '        <div><strong>Timeline de Frames</strong></div>',
      '        <div id="tc36Timeline" class="tc36-timeline"></div>',
      '    </div>',
      '    <!-- DERECHA -->',
      '    <div class="tc36-col">',
      '      <div class="tc36-card">',
      '        <div><strong>Guía</strong></div>',
      '        <div class="tc36-tiny">',
      '          • Carga PNGs, etiqueta y aplica a grupos/frames.<br>',
      '          • Grid conmutado. Zoom real en sheet y preview.<br>',
      '          • Diseño compacto sin solapes. Responsive.',
      '        </div>',
      '      </div>',
      '      <div class="tc36-card">',
      '        <div><strong>Validación</strong></div>',
      '        <div id="tc36Validate" class="tc36-tiny">Esperando…</div>',
      '      </div>',
      '      <div class="tc36-card">',
      '        <div><strong>Acciones</strong></div>',
      '        <div class="tc36-row" style="justify-content:flex-end">',
      '          <button id="tc36CloseBottom" class="tc36-btn">✕ Cerrar</button>',
      '        </div>',
      '      </div>',
      '      <div class="tc36-row">',
      '        <label>Preview Zoom',
      '          <input id="tc36Zoom" type="range" min="1" max="8" value="3" style="width:120px">',
      '          <span id="tc36ZoomVal" class="tc36-tag">3×</span>',
      '        </label>',
      '      </div>',  
      '      <div class="tc36-gridWrap">',
      '        <canvas id="tc36Canvas" class="tc36-sheetCanvas" aria-label="Preview"></canvas>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join(''));

    modal.id='thingConstructor36';
    document.body.appendChild(modal);
    // Importante: NO activar automáticamente. Se abre con window.tc36Open().

    const closeAll=()=>{ modal.classList.remove('active'); setTimeout(()=>modal.remove(),250); };
    modal.addEventListener('click',e=>{ if(e.target===modal) closeAll(); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&modal.classList.contains('active')) closeAll(); });

    $('tc36CloseTop').onclick=closeAll;
    $('tc36CloseBottom').onclick=closeAll;
    $('tc36Reset').onclick=resetAll;

    // Tipo / shape
    $('tc36Type').onchange=e=>{ S.type=e.target.value; enforceTypeConstraints(); draw(); };
    $('tc36Group').onchange=e=>{ S.group=+e.target.value|0; $('tc36F').value = (S.framesCount[S.group]|0)||1; S.shape.frames = (S.framesCount[S.group]|0)||1; writeShapeInputs(); updateSlotInfo(); draw(); };
    ['tc36W','tc36H','tc36PX','tc36PY','tc36PZ','tc36F'].forEach(id=>{
      $(id).onchange=()=>{ readShapeInputs(true); draw(); };
    });

    // Render flags
    $('tc36Place').onchange=e=>{ S.place=e.target.value; draw(); };
    $('tc36Omit').onchange=e=>{ S.omitTransparent=e.target.checked; };
    $('tc36Alpha').onchange=e=>{ S.alphaTol=clamp(+e.target.value,0,255); };

    // Navegación
    $('tc36Prev').onclick=()=>{ if(S.slot>0) S.slot--; updateSlotInfo(); draw(); };
    $('tc36Next').onclick=()=>{ const max=perGroupBaseSlots()-1; if(S.slot<max) S.slot++; updateSlotInfo(); draw(); };
    $('tc36ClearSlot').onclick=clearCurrentSlot;

    // Zoom preview
    $('tc36Zoom').oninput=e=>{
      S.zoom=clamp(+e.target.value,1,8);
      $('tc36ZoomVal').textContent=S.zoom+'×';
      drawPreview();
    };

    // Zoom sheet
    $('tc36SheetZoom').oninput=e=>{
      S.sheetZoom=+e.target.value;
      $('tc36SheetZoomVal').textContent=S.sheetZoom+'×';
      paintSheetToCanvas();
      drawSheetOverlay();
    };

    // Biblioteca
    $('tc36SheetFiles').addEventListener('change',async e=>{
      const files=[...(e.target.files||[])].filter(f=>f.type==='image/png');
      if(files.length) await addSheetsFromFiles(files);
      e.target.value='';
    });
    $('tc36RemoveSheet').onclick=removeCurrentSheet;
    $('tc36ApplyAll').onclick=applyAllSheets;

    // Metadatos hoja (Fijado el error de sintaxis)
    $('tc36Role').onchange = ()=>{ const sh=curSheet(); if(!sh) return; sh.meta.role=$('tc36Role').value; updateSheetBadges(); };
    $('tc36Dir').onchange  = ()=>{ const sh=curSheet(); if(!sh) return; sh.meta.dir=$('tc36Dir').value; updateSheetBadges(); };
    $('tc36PYd').onchange  = ()=>{ const sh=curSheet(); if(!sh) return; sh.meta.addon=clamp(+$('tc36PYd').value,0,7); updateSheetBadges(); };
    $('tc36PZd').onchange  = ()=>{ const sh=curSheet(); if(!sh) return; sh.meta.mount=clamp(+$('tc36PZd').value,0,7); updateSheetBadges(); };
    ['tc36LM0','tc36LM1','tc36LM2','tc36LM3'].forEach((id,i)=>{
      $(id).onchange=()=>{
        const sh=curSheet(); if(!sh) return;
        if($(id).checked) sh.meta.layerMask|=(1<<i); else sh.meta.layerMask&=~(1<<i);
        updateSheetBadges();
      };
    });

    // Selección
    $('tc36SelAll').onclick=selectAllBlocks;
    $('tc36SelInvert').onclick=invertSelection;
    $('tc36SelClear').onclick=()=>{ const sh=curSheet(); if(!sh) return; sh.selected.clear(); sh.order.length=0; drawSheetOverlay(); rebuildTabs(); };
    $('tc36ShowGrid').onchange=e=>{ S.showGrid=e.target.checked; drawSheetOverlay(); };
    $('tc36SelToFrames').onclick=applyCurrentSheet;

    bindSheetPicking();

    // Acciones
    $('tc36Create').onclick=()=>buildThing('create');
    $('tc36Replace').onclick=()=>buildThing('replace');

    // HUD preview coords (usa offset de centrado)
    $('tc36Canvas').addEventListener('mousemove',e=>{
      const c=$('tc36Canvas'); const r=c.getBoundingClientRect();
      const x=((e.clientX-r.left-S._offX)/S.zoom)|0; const y=((e.clientY-r.top-S._offY)/S.zoom)|0;
      const D=dimsFor(S.group);
      $('tc36SheetInfo').textContent='x:'+x+' y:'+y+' · W'+D.W+'×H'+D.H+' · L'+D.L+' · PX'+D.PX+' PY:'+D.PY+' PZ:'+D.PZ+' · F:'+D.F;
    });

    // DnD sheet
    const wrap=$('tc36SheetWrap');
    wrap.addEventListener('dragover',e=>{ e.preventDefault(); });
    wrap.addEventListener('drop', async e => {
      e.preventDefault();
      const filesList = (e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : [];
      const files = Array.prototype.filter.call(filesList, f => f.type === 'image/png');
      if (files.length) await addSheetsFromFiles(files);
    });

    // Resize adaptativo
    const wrapEl = $('tc36SheetWrap');
    if (wrapEl) {
      const ro = new ResizeObserver(()=>{ paintSheetToCanvas(); drawSheetOverlay(); });
      ro.observe(wrapEl);
    }

    // API
    window.tc36Open=()=>{
      enforceTypeConstraints();
      ensureLayerArrays();
      writeShapeInputs();
      updateSlotInfo();
      paintSheetToCanvas();
      draw();
      modal.classList.add('active');
    };
  }

  /* ========= HELPERS UI ========= */
  function enforceTypeConstraints(){
    const isOutfit=S.type==='outfit';
    $('tc36Group').disabled=!isOutfit;
    if(isOutfit){ S.shape.patternX=4; $('tc36PX').value=4; $('tc36PX').disabled=true; }
    else { $('tc36PX').disabled=false; }
    writeShapeInputs();
  }
  function readShapeInputs(lock){
    const s={
      width:clamp(+$('tc36W').value,1,64),
      height:clamp(+$('tc36H').value,1,64),
      layers:S.shape.layers|0,
      patternX:$('tc36PX').disabled?4:clamp(+$('tc36PX').value,1,8),
      patternY:clamp(+$('tc36PY').value,1,8),
      patternZ:clamp(+$('tc36PZ').value,1,8),
      frames:clamp(+$('tc36F').value,1,128),
    };
    if(lock && hasAnyAssignment()){ writeShapeInputs(); return; }
    S.shape=s; S.framesCount[S.group]=s.frames; S.shape.frames = s.frames; ensureLayerArrays(); updateSlotInfo();
  }
  function writeShapeInputs(){
    $('tc36W').value=S.shape.width; $('tc36H').value=S.shape.height;
    $('tc36PX').value=S.shape.patternX; $('tc36PY').value=S.shape.patternY; $('tc36PZ').value=S.shape.patternZ;
    $('tc36F').value=(S.framesCount[S.group]|0)||S.shape.frames; $('tc36L').value=S.shape.layers;
  }
  function updateSlotInfo(){
    const D=dimsFor(S.group);
    const f=Math.floor(S.slot/(D.PZ*D.PY*D.PX*D.L));
    const rem=S.slot%(D.PZ*D.PY*D.PX*D.L);
    const pz=Math.floor(rem/(D.PY*D.PX*D.L));
    const rem2=rem%(D.PY*D.PX*D.L);
    const py=Math.floor(rem2/(D.PX*D.L));
    const rem3=rem2%(D.PX*D.L);
    const px=Math.floor(rem3/D.L);
    const l=rem3%D.L;
    $('tc36SlotInfo').textContent='BaseSlot '+S.slot+' · L='+l+' PX='+px+' PY='+py+' PZ='+pz+' F='+f;
    renderTimeline();
  }
  function renderTimeline(){
    const root=$('tc36Timeline'); root.innerHTML='';
    const per=perGroupBaseSlots();
    for(let i=0;i<per;i++){
      const used = S.frames[S.group] && S.frames[S.group].some(m => (m && typeof m.get === 'function') ? !!m.get(i) : false);
      const chip=ce('span','tc36-tag chip'+(used?' on':''),String(i));
      chip.onclick=()=>{ S.slot=i; updateSlotInfo(); draw(); };
      root.appendChild(chip);
    }
  }

  /* ========= SHEETS ========= */
  function rebuildTabs(){
    const tabs=$('tc36Tabs'); tabs.innerHTML='';
    S.sheets.forEach((sh,i)=>{
      const btn=ce('button','tc36-tab'+(i===S.si?' on':''),(i+1)+'. '+sh.name+' <span class="tc36-tiny">('+sh.selected.size+')</span>');
      btn.onclick=()=>setCurrentSheet(i);
      tabs.appendChild(btn);
    });
    if(S.si<0) $('tc36SheetInfo').textContent='—';
  }
  function updateSheetBadges(){
    const sh=curSheet(); if(!sh) return;
    $('tc36Role').value=sh.meta.role;
    $('tc36Dir').value=sh.meta.dir;
    $('tc36PYd').value=sh.meta.addon|0;
    $('tc36PZd').value=sh.meta.mount|0;
    ['tc36LM0','tc36LM1','tc36LM2','tc36LM3'].forEach((id,i)=>$(id).checked=!!(sh.meta.layerMask&(1<<i)));
    $('tc36SheetInfo').textContent='Sheet: '+sh.name+' · '+sh.tw+'×'+sh.th+' tiles · etiqueta:'+sh.meta.role+' · PX:'+ (dirPX[sh.meta.dir]) +' PY:'+sh.meta.addon+' PZ:'+sh.meta.mount;
  }
  function curSheet(){ return S.sheets[S.si]||null; }
  async function addSheetsFromFiles(files){
    for(const f of files){
      const url=URL.createObjectURL(f);
      const img=new Image(); img.src=url; await img.decode(); URL.revokeObjectURL(url);
      const tw=(img.naturalWidth/TILE)|0, th=(img.naturalHeight/TILE)|0;
      const src=document.createElement('canvas'); src.width=img.naturalWidth; src.height=img.naturalHeight;
      const sctx=src.getContext('2d',{willReadFrequently:true}); sctx.imageSmoothingEnabled=false; sctx.drawImage(img,0,0);
      const sh={
        id:Date.now()+Math.random(),
        name:(f.name||'sheet').replace(/\.(png)$/i,''),
        img, tw, th, src,
        selected:new Set(), order:[], lastIndex:-1,
        meta:{ role:'outfit-base', dir:'S', addon:0, mount:0, layerMask:1 }
      };
      S.sheets.push(sh); S.si=S.sheets.length-1;
      paintSheetToCanvas(); drawSheetOverlay();
    }
    rebuildTabs(); updateSheetBadges();
  }
  function setCurrentSheet(i){
    if(i<0||i>=S.sheets.length) return;
    S.si=i; rebuildTabs(); paintSheetToCanvas(); drawSheetOverlay(); updateSheetBadges();
  }
  function removeCurrentSheet(){
    if(S.si<0) return;
    S.sheets.splice(S.si,1);
    S.si=Math.min(S.si,S.sheets.length-1);
    rebuildTabs(); paintSheetToCanvas(); drawSheetOverlay(); updateSheetBadges();
  }
  function paintSheetToCanvas(){
    const c=$('tc36Sheet'), o=$('tc36SheetOverlay'), inner=$('tc36SheetInner'), wrap=$('tc36SheetWrap');
    if(!c || !o || !inner || !wrap) return; // <-- evita error getContext en nulos
    const sh=curSheet(); const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.clearRect(0,0,c.width,c.height);
    if(!sh){ c.width=o.width=1; c.height=o.height=1; inner.style.transform='scale(1)'; return; }

    // tamaño base = imagen original 1:1
    c.width=sh.img.naturalWidth; c.height=sh.img.naturalHeight;
    o.width=c.width; o.height=c.height;
    ctx.imageSmoothingEnabled=false; ctx.drawImage(sh.img,0,0);

    // ajusta a ancho disponible * zoom del usuario
    const availW=Math.max(1, wrap.clientWidth-20);
    const availH=Math.max(1, wrap.clientHeight-20);
    const fit=Math.min(availW/c.width, availH/c.height);
    const scale=Math.max(0.25, fit*S.sheetZoom);
    inner.style.transform=`scale(${scale})`;
    inner.style.left='0px'; inner.style.top='0px';
    try{ wrap.scrollTop=0; wrap.scrollLeft=0; }catch(_){}
    // Asegurar anclaje al topleft del wrap
    try{ wrap.scrollTop=0; wrap.scrollLeft=0; }catch(_){}
  }
  function drawSheetOverlay(){
    const c=$('tc36Sheet'), o=$('tc36SheetOverlay');
    if(!c || !o) return;
    const sh=curSheet(); const ctx=o.getContext('2d');
    ctx.clearRect(0,0,o.width,o.height);
    if(!sh) return;

    const cw=c.width/sh.tw, ch=c.height/sh.th;

    if(S.showGrid){
      ctx.strokeStyle='rgba(200,220,255,.18)'; ctx.lineWidth=1;
      for(let x=0;x<=sh.tw;x++){ const xx=Math.floor(x*cw)+.5; ctx.beginPath(); ctx.moveTo(xx,0); ctx.lineTo(xx,c.height); ctx.stroke(); }
      for(let y=0;y<=sh.th;y++){ const yy=Math.floor(y*ch)+.5; ctx.beginPath(); ctx.moveTo(0,yy); ctx.lineTo(c.width,yy); ctx.stroke(); }
    }

    ctx.strokeStyle='rgba(98,190,255,.9)'; ctx.lineWidth=2; ctx.fillStyle='#fff'; ctx.font='10px monospace';
    sh.selected.forEach(idx=>{ const tx=idx%sh.tw, ty=(idx/sh.tw|0); ctx.strokeRect(tx*cw+1, ty*ch+1, cw-2, ch-2); });
    sh.order.forEach((idx,i)=>{ const tx=idx%sh.tw, ty=(idx/sh.tw|0); ctx.fillText(String(i+1), tx*cw+4, ty*ch+12); });
  }
  function currentScaleOf(el){
    const tr=getComputedStyle(el).transform;
    if(!tr || tr==='none') return 1;
    const m = tr.match(/-?\d+(\.\d+)?/g);
    const nums = m ? m.map(Number) : [1];
    return nums[0]||1; // m11
  }
  function bindSheetPicking(){
    const inner=$('tc36SheetInner');
    inner.addEventListener('click',e=>sheetClick(e,false));
    inner.addEventListener('mousedown',e=>{ if(e.shiftKey){ sheetClick(e,true); e.preventDefault(); } });
  }
  function sheetClick(e,isRange){
    const sh=curSheet(); if(!sh) return;
    const inner=$('tc36SheetInner'); const c=$('tc36Sheet');
    const crect=c.getBoundingClientRect();
    const wrap=document.getElementById('tc36SheetWrap');
    const sx=wrap?wrap.scrollLeft:0; const sy=wrap?wrap.scrollTop:0;
    const scaleX = Math.max(0.0001, crect.width / c.width);
    const scaleY = Math.max(0.0001, crect.height / c.height);
    const x = ((e.clientX - crect.left + sx) / scaleX) | 0;
    const y = ((e.clientY - crect.top  + sy) / scaleY) | 0;

    const tx=Math.floor(x/(c.width/sh.tw));
    const ty=Math.floor(y/(c.height/sh.th));
    const idx=ty*sh.tw+tx;
    if(tx<0||ty<0||tx>=sh.tw||ty>=sh.th) return;

    if(isRange && sh.lastIndex>=0){
      const a=Math.min(sh.lastIndex,idx), b=Math.max(sh.lastIndex,idx);
      for(let i=a;i<=b;i++) if(!sh.selected.has(i)){ sh.selected.add(i); sh.order.push(i); }
    }else{
      if(sh.selected.has(idx)){ sh.selected.delete(idx); const k=sh.order.indexOf(idx); if(k!==-1) sh.order.splice(k,1); }
      else { sh.selected.add(idx); sh.order.push(idx); }
      sh.lastIndex=idx;
    }
    drawSheetOverlay(); rebuildTabs();
  }
  function selectAllBlocks(){
    const sh=curSheet(); if(!sh) return;
    const D=dimsFor(S.group);
    sh.selected.clear(); sh.order.length=0;
    for(let ty=0; ty<=sh.th-D.H; ty++){
      for(let tx=0; tx<=sh.tw-D.W; tx++){
        const idx=ty*sh.tw+tx; sh.selected.add(idx); sh.order.push(idx);
      }
    }
    drawSheetOverlay(); rebuildTabs();
  }
  function invertSelection(){
    const sh=curSheet(); if(!sh) return;
    const total=sh.tw*sh.th; const cur=new Set(sh.selected);
    sh.selected.clear(); sh.order.length=0;
    for(let i=0;i<total;i++){ if(!cur.has(i)){ sh.selected.add(i); sh.order.push(i); } }
    drawSheetOverlay(); rebuildTabs();
  }

  /* ========= ASIGNACIÓN ========= */
  function cursorKey(g,px,py,pz){ return g+'|'+px+'|'+py+'|'+pz; }
  function nextFrameFor(px,py,pz){
    const D=dimsFor(S.group);
    const k=cursorKey(S.group,px,py,pz);
    const f=(S.cursor[k]|0); S.cursor[k]=Math.min(D.F,f+1);
    return Math.min(f,D.F-1);
  }
  function pushTiles(tiles, px,py,pz, layerMask){
    const D=dimsFor(S.group);
    const f=nextFrameFor(px,py,pz);
    const highest=[3,2,1,0].find(i=>layerMask&(1<<i));
    if(highest!=null && S.shape.layers<=highest){ S.shape.layers=highest+1; $('tc36L').value=S.shape.layers; ensureLayerArrays(); }
    [0,1,2,3].forEach(l=>{
      if(!(layerMask&(1<<l))) return;
      const baseSlot=idxBase({F:f,PZ:pz,PY:py,PX:px,L:l},D);
      S.frames[S.group][l].set(baseSlot,tiles);
      const dur=+$('tc36Dur').value|0; if(dur>0) S.durations[S.group][baseSlot]=dur;
      S.slot=baseSlot;
    });
  }
  function getTilesFromSheetTopLeft(sh, topLeft){
    const D=dimsFor(S.group);
    const sx0=(topLeft%sh.tw), sy0=(topLeft/sh.tw|0);
    if(sx0+D.W>sh.tw || sy0+D.H>sh.th) return null;
    const tiles=new Array(D.W*D.H).fill(null);
    const sctx=sh.src.getContext('2d',{willReadFrequently:true});
    for(let y=0;y<D.H;y++) for(let x=0;x<D.W;x++){
      const sx=(sx0+x)*TILE, sy=(sy0+y)*TILE;
      const im=sctx.getImageData(sx,sy,TILE,TILE);
      if(S.omitTransparent||S.alphaTol>0){
        let maxA=0; const d=im.data; for(let i=3;i<d.length;i+=4) if(d[i]>maxA) maxA=d[i];
        if(maxA<=S.alphaTol){ tiles[y*D.W+x]=null; continue; }
      }
      tiles[y*D.W+x]=im;
    }
    return tiles;
  }
  function applyOneSheet(sh){
    if(sh.selected.size===0) return 0;

    const order=sh.order.length?sh.order.slice():[...sh.selected].sort((a,b)=>a-b);

    const prevType=S.type;
    if(sh.meta.role==='effect') S.type='effect';
    else if(sh.meta.role==='missile') S.type='missile';
    enforceTypeConstraints();

    let px=0,py=0,pz=0;
    if(S.type==='outfit'){
      px = (sh && sh.meta && typeof dirPX[sh.meta.dir] !== 'undefined') ? dirPX[sh.meta.dir] : 2;
      if(sh.meta.role==='addon-1') py=1;
      else if(sh.meta.role==='addon-2') py=2;
      else if(sh.meta.role==='addon-12') py=3;
      else py=sh.meta.addon|0;
      pz=sh.meta.mount|0;
      if(S.shape.patternY<=py){ S.shape.patternY=py+1; $('tc36PY').value=S.shape.patternY; }
      if(S.shape.patternZ<=pz){ S.shape.patternZ=pz+1; $('tc36PZ').value=S.shape.patternZ; }
    }

    let layerMask=sh.meta.layerMask;
    if(sh.meta.role==='outfit-base') layerMask|=1<<0;
    if(sh.meta.role==='layer-l1') layerMask|=1<<1;
    if(sh.meta.role==='layer-l2') layerMask|=1<<2;
    if(sh.meta.role==='layer-l3') layerMask|=1<<3;

    let count=0;
    for(const topLeft of order){
      const tiles=getTilesFromSheetTopLeft(sh,topLeft);
      if(!tiles) continue;
      pushTiles(tiles,px,py,pz,layerMask);
      count++;
    }

    S.type=prevType; enforceTypeConstraints();
    updateSlotInfo(); draw();
    return count;
  }
  function applyCurrentSheet(){
    const sh=curSheet(); if(!sh) return;
    const n=applyOneSheet(sh);
    if(!n) alert('Nada que aplicar: selección vacía.');
  }
  function applyAllSheets(){
    let total=0; for(const sh of S.sheets){ total+=applyOneSheet(sh); }
    alert('Aplicadas '+total+' asignaciones desde '+S.sheets.length+' hoja(s).');
  }

  /* ========= DRAW ========= */
  // Cache para convertir ImageData -> canvas y permitir escalado con drawImage
  const _tileCache = new WeakMap();
  function _getTileCanvas(im){
    let c=_tileCache.get(im);
    if(!c){
      c=document.createElement('canvas'); c.width=im.width; c.height=im.height;
      c.getContext('2d').putImageData(im,0,0);
      _tileCache.set(im,c);
    }
    return c;
  }

  function draw(){ drawPreview(); validateNow(); drawSheetOverlay(); rebuildTabs(); }
  function drawPreview(){
    const c=$('tc36Canvas'); if(!c) return;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    const D=dimsFor(S.group);
    const w=D.W*TILE, h=D.H*TILE;

    // Tamaño del canvas = tamaño del contenedor (para centrar siempre)
    const wrap=c.parentElement;
    const CW=Math.max(1, wrap.clientWidth);
    const CH=Math.max(1, wrap.clientHeight);
    c.width=CW; c.height=CH;

    // Calcular offset para centrar el contenido escalado
    const scaledW=w*S.zoom, scaledH=h*S.zoom;
    const offX=((CW - scaledW) / 2) | 0;
    const offY=((CH - scaledH) / 2) | 0;
    S._offX=offX; S._offY=offY;

    // Fondo
    ctx.clearRect(0,0,CW,CH);
    ctx.fillStyle='#0b0f15'; ctx.fillRect(0,0,CW,CH);

    // Dibujar contenido centrado y con zoom REAL
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(S.zoom, S.zoom);

    // Fondo del área de sprite
    ctx.fillStyle='#0b0f15';
    ctx.fillRect(0,0,w,h);

    // Grid preview (afectado por zoom)
    ctx.strokeStyle='rgba(132,206,255,.22)';
    for(let x=TILE;x<w;x+=TILE){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for(let y=TILE;y<h;y+=TILE){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

    // tiles (usar drawImage con canvas cache para respetar transformaciones)
    for(let l=0;l<D.L;l++){
      const tiles = (S.frames[S.group] && S.frames[S.group][l] && typeof S.frames[S.group][l].get === 'function') ? S.frames[S.group][l].get(S.slot) : null;
      if(!tiles) continue;
      for(let yy=0;yy<D.H;yy++) for(let xx=0;xx<D.W;xx++){
        const im=tiles[yy*D.W+xx];
        if(im){
          const tc=_getTileCanvas(im);
          ctx.drawImage(tc, xx*TILE, yy*TILE);
        }
      }
    }
    ctx.restore();
  }
  function clearCurrentSlot(){
    const D=dimsFor(S.group);
    for(let l=0;l<D.L;l++){ if(S.frames[S.group] && S.frames[S.group][l] && typeof S.frames[S.group][l].delete === 'function') S.frames[S.group][l].delete(S.slot); }
    delete S.durations[S.group][S.slot];
    draw(); renderTimeline();
  }
  function validateNow(){
    const D=dimsFromShape(S.shape), per=perGroupBaseSlots();
    let filled=0; for(let l=0;l<D.L;l++){ const m=S.frames[S.group][l]; if(!m) continue; m.forEach(a=>{ if(a && a.some(x=>x)) filled++; }); }
    $('tc36Validate').textContent='Slots llenos (grupo '+S.group+'): '+filled+'/'+per;
  }

  /* ========= COMPILACIÓN ========= */
  function makeEmptyGroup(shape){
    const n=(shape.width|0)*(shape.height|0)*(shape.layers|0)*(shape.patternX|0)*(shape.patternY|0)*(shape.patternZ|0)*(shape.frames|0);
    return { width:shape.width|0, height:shape.height|0, layers:shape.layers|0, patternX:shape.patternX|0, patternY:shape.patternY|0, patternZ:shape.patternZ|0, frames:shape.frames|0, sprites:new Array(n).fill(0) };
  }
  function pushSPR(im){
    const spr=getSPR(); if(!spr||!im) return 0;
    if(!Array.isArray(spr.sprites)) spr.sprites=[];
    spr.sprites.push(im);
    const n=spr.sprites.length;
    spr.totalSprites=n; if(typeof spr.spriteCount==='number') spr.spriteCount=n;
    return n; // 1-based
  }
  function buildThing(mode){
    const dat=getDAT(), spr=getSPR(); if(!dat||!spr){ alert('DAT/SPR no disponibles'); return; }

    const id = mode==='create' ? nextFreeId(S.type) : (getCurrentThingId() || nextFreeId(S.type));
    const groups=[];
    const groupCount=(S.type==='outfit')?2:1;

    for(let g=0; g<groupCount; g++){
      const D=dimsFor(S.group);
      const grp=makeEmptyGroup(S.shape);
      const area=D.W*D.H;

      for(let f=0; f<D.F; f++)
      for(let pz=0; pz<D.PZ; pz++)
      for(let py=0; py<D.PY; py++)
      for(let px=0; px<D.PX; px++)
      for(let l=0; l<D.L; l++)
      for(let w=0; w<D.W; w++)
      for(let h=0; h<D.H; h++){
        const baseSlot=idxBase({F:f,PZ:pz,PY:py,PX:px,L:l},D);
        const tilesArr = (S.frames[g] && S.frames[g][l] && typeof S.frames[g][l].get === 'function') ? S.frames[g][l].get(baseSlot) : null;
        const tile=tilesArr ? tilesArr[w+h*D.W] : null;

        let spriteId=0;
        if(tile){
          if(S.omitTransparent||S.alphaTol>0){
            let maxA=0; const d=tile.data; for(let i=3;i<d.length;i+=4) if(d[i]>maxA) maxA=d[i];
            if(maxA>S.alphaTol) spriteId=pushSPR(tile);
          } else spriteId=pushSPR(tile);
        }
        const withinRev=(D.H-1-h)*D.W + (D.W-1-w);
        grp.sprites[baseSlot*area + withinRev]=spriteId;
      }
      groups.push(grp);
    }

    const thing={ id, category:S.type, flags:[], groups };
    addThing(S.type, thing);
    selectThing(id);
    alert(S.type+' #'+id+' '+(mode==='create'?'creado':'reemplazado')+' · W:'+S.shape.width+' H:'+S.shape.height+' · L:'+S.shape.layers+' · PX:'+S.shape.patternX+' PY:'+S.shape.patternY+' PZ:'+S.shape.patternZ+' · F:'+S.shape.frames);
  }

  /* ========= RESET ========= */
  function resetAll(){
    S.type='outfit'; S.group=0;
    S.shape={width:1,height:1,layers:1,patternX:4,patternY:1,patternZ:1,frames:1};
    S.frames=[[],[]]; S.durations=[[],[]]; S.framesCount=[1,1];
    S.slot=0; S.zoom=3; S.sheetZoom=1; S.place='grid';
    S.omitTransparent=false; S.alphaTol=0;
    S.sheets=[]; S.si=-1; S.showGrid=true; S.cursor={};

    $('tc36Type').value='outfit';
    $('tc36Group').value='0';
    $('tc36Place').value='grid';
    $('tc36Omit').checked=false;
    $('tc36Alpha').value='0';
    $('tc36Dur').value='100';
    $('tc36Zoom').value='3'; $('tc36ZoomVal').textContent='3×';
    $('tc36SheetZoom').value='1'; $('tc36SheetZoomVal').textContent='1×';

    writeShapeInputs(); ensureLayerArrays(); updateSlotInfo();
    const c=$('tc36Sheet'), o=$('tc36SheetOverlay'); if(c&&o){ c.width=o.width=1; c.height=o.height=1; }
    rebuildTabs();
    if($('tc36Role')) $('tc36Role').value='outfit-base';
    if($('tc36Dir')) $('tc36Dir').value='S';
    if($('tc36PYd')) $('tc36PYd').value='0';
    if($('tc36PZd')) $('tc36PZd').value='0';
    ['tc36LM0','tc36LM1','tc36LM2','tc36LM3'].forEach((id,i)=>{ const el=$(id); if(el) el.checked=(i===0); });
    paintSheetToCanvas(); draw();
  }

  /* ========= BOOT ========= */
  // No botón flotante. Se expone una función global para abrir desde el botón al lado del Slicer.
  ready(()=>{
    window.openThingConstructorFromUI = function(){
      if(!$('thingConstructor36')){ injectStyles(); buildModal(); }
      if(typeof window.tc36Open === 'function') window.tc36Open();
    };
  });

})();
