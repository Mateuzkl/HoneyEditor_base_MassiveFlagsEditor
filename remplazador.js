import { SprParser } from './sprParser.js';
import { DatParser }  from './datParser.js';

// === Guardado condicional de LOG ===
function __shouldSaveLog(){
  try{
    // 1) Checkbox explícito
    let el = document.getElementById('cmpSaveLog');
    // 2) Buscar por etiqueta "Guardar registro"
    if (!el){
      const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      for (const cb of cbs){
        const by = cb.id ? document.querySelector(`label[for="${cb.id}"]`) : null;
        const lab = by || cb.closest('label');
        const txt = (lab?.textContent || cb.getAttribute('aria-label') || '').toLowerCase();
        if (txt.includes('guardar registro')) { el = cb; break; }
      }
    }
    // 3) Fallback por data-atributo
    const dataEl = document.querySelector('[data-save-log="1"],[data-cmp-save-log="1"]');
    if (dataEl) return true;
    return !!(el && el.checked);
  }catch(_){ return false; }
}



/**
 * Comparador / Reemplazador de Things (.dat) y Sprites (.spr)
 * - Carga un pack RD (derecha) y compara con el base (izquierda).
 * - Permite encolar reemplazos Thing→Thing.
 * - Aplica reemplazos POSICIONALES por thing: reusa IDs del LEFT,
 *   limpia sobrantes y solo crea nuevos cuando el LEFT tenía 0.
 *
 * Cambios clave en esta versión:
 *  - applyThingTakeoverSmart(): lógica estrictamente posicional.
 *    Reusa SIEMPRE el ID del LEFT cuando existe. Si RIGHT=0 limpia.
 *    Si LEFT=0 y RIGHT>0 asigna ID nuevo al final.
 *    Esto ocurre para cada thing del lote, evitando que los
 *    reemplazos siguientes agreguen todo al final del SPR.
 *  - Se mantiene compatibilidad con la UI anterior.
 */

let sprRD = null;     // SPR del pack derecho
let datRD = null;     // DAT del pack derecho

const TILE32 = (typeof window !== 'undefined' && typeof window.TILE === 'number') ? window.TILE : 32;

const cmpState = {
  leftMode: 'things',
  rightMode:'things',
  leftCat:  'item',
  rightCat: 'item',
  leftSel:  null,
  rightSel: null,
  pairs: [],
  mapL2R: new Map(),
  mapR2L: new Map(),
  thingOps: [],
  leftPage: 0, rightPage: 0, pageSize: 120,
  leftFilter: '', rightFilter: '',
  pairsCollapsed: true
};

const _q = (id) => document.getElementById(id);

function getBase(){
  const g = (typeof window !== 'undefined') ? window : globalThis;
  const sprBase = (typeof spr !== 'undefined' ? spr : g.spr) || null;
  const datBase = (typeof dat !== 'undefined' ? dat : g.dat) || null;
  return { spr: sprBase, dat: datBase };
}

/* ================= util dibujo ================ */
const _tileCanvas = document.createElement('canvas');
_tileCanvas.width = _tileCanvas.height = TILE32;
const _tileCtx = _tileCanvas.getContext('2d', { willReadFrequently:true });

function drawGroupCanvasWithSprRef(group, sprites, sprRef) {
  const gw = Math.max(1, group.width|0), gh = Math.max(1, group.height|0);
  const w = gw * TILE32, h = gh * TILE32;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently:true }); g.imageSmoothingEnabled = false;

  for (let y=0;y<gh;y++){
    for (let x=0;x<gw;x++){
      const idx = (gh-1-y)*gw + (gw-1-x); // orden OB
      const sid = sprites[idx]|0; if (sid<1) continue;
      const img = sprRef?.getSprite?.(sid-1); if (!img) continue;
      _tileCtx.putImageData(img, 0, 0);
      g.drawImage(_tileCanvas, x*TILE32, y*TILE32);
    }
  }
  return c;
}

function thingFirstFrameSprites(g) {
  const per = Math.max(1,g.width)*Math.max(1,g.height);
  const base = ((((0*g.patternZ+0)*g.patternY+0)*g.patternX+0)*g.layers+0)*per;
  const slice = g.sprites.slice(base, base+per); while (slice.length<per) slice.push(0); return slice;
}
function makeThumbFromCanvas(canvas, size=92){
  const c = document.createElement('canvas'); c.width=c.height=size;
  const g = c.getContext('2d', { willReadFrequently:true }); g.imageSmoothingEnabled=false;
  const scale = Math.max(1, Math.floor(Math.min(size/canvas.width, size/canvas.height)));
  const dw = canvas.width*scale, dh = canvas.height*scale;
  const dx = ((size-dw)/2)|0, dy=((size-dh)/2)|0; g.clearRect(0,0,size,size); g.drawImage(canvas,dx,dy,dw,dh); return c;
}
function makeThumbFromSprite(imgData, size=92){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const g=c.getContext('2d',{willReadFrequently:true}); g.imageSmoothingEnabled=false;
  _tileCtx.putImageData(imgData,0,0);
  const scale=Math.max(1,Math.floor(size/TILE32)), dw=TILE32*scale, dh=TILE32*scale, dx=((size-dw)/2)|0, dy=((size-dh)/2)|0;
  g.drawImage(_tileCanvas,dx,dy,dw,dh); return c;
}
function getThingById(d,cat,id){ return cat==='item'?d.items[id]:cat==='outfit'?d.outfits[id]:cat==='effect'?d.effects:d.missiles[id]; }
function cmpBuildIdList(count, filter){ const f=String(filter||'').trim().toLowerCase(), ids=[]; for(let i=1;i<=count;i++) if(!f||String(i).includes(f)) ids.push(i); return ids; }

/* ============= helpers SPR ============= */
function writeBlank(baseSpr, id, blank){
  const idx = (id|0)-1; if (idx < 0) return;
  while (baseSpr.sprites.length <= idx) baseSpr.sprites.push(null);
  baseSpr.totalSprites = baseSpr.sprites.length;
  baseSpr.sprites[idx] = blank;
}
function writeCopy(baseSpr, rdSpr, dstId, srcSid){
  const idx = (dstId|0)-1; if (idx < 0) return 0;
  while (baseSpr.sprites.length <= idx) baseSpr.sprites.push(null);
  baseSpr.totalSprites = baseSpr.sprites.length;
  const img = rdSpr.getSprite((srcSid|0)-1); if (!img) return 0;
  baseSpr.sprites[idx] = new ImageData(new Uint8ClampedArray(img.data), 32, 32);
  baseSpr.hasAlpha = !!(baseSpr.hasAlpha || rdSpr.hasAlpha);
  return dstId|0;
}

/* ============= contador de referencias (opcional) ============= */
function buildSpriteRefCounts(dat){
  const counts = new Map();
  const bump = (sid)=>{ if (sid>0){ counts.set(sid, (counts.get(sid)|0)+1); } };
  const all = [dat.items, dat.outfits, dat.effects, dat.missiles];
  for (const arr of all){
    if (!arr) continue;
    for (const t of arr){
      if (!t?.groups) continue;
      for (const g of t.groups){
        if (!Array.isArray(g?.sprites)) continue;
        for (const sid of g.sprites){ bump(sid|0); }
      }
    }
  }
  return counts;
}

/* =============================================================
 * Reemplazo limpio POSICIONAL por thing
 * -------------------------------------------------------------
 * - Si RIGHT[i]>0 y LEFT[i]>0: copiar R dentro del ID L y mapear a L.
 * - Si RIGHT[i]>0 y LEFT[i]==0: asignar ID nuevo al final y mapear a nuevo.
 * - Si RIGHT[i]==0 y LEFT[i]>0: limpiar ese ID y mapear 0.
 * - Reconstruye grupos del LEFT con la estructura del RIGHT.
 * - Ignora compartición: el objetivo es reutilizar slots del LEFT.
 *   Esto evita que los siguientes reemplazos agreguen todo al final.
 * ============================================================= */

/* =============================================================
 * Reemplazo limpio POSICIONAL por thing  —  v2 (per‑grupo y por frame)
 * -------------------------------------------------------------
 * Problema resuelto: en OUTIFTS con frames/grupos distintos entre LEFT y RIGHT
 * el aplanado global desalineaba índices. Aquí mapeamos por‑grupo y usando
 * baseSlots = W*H*L*PX*PY*PZ; luego recorremos frames f y slot k,
 * con índices: idx = f*baseSlots + k. Así se preserva la geometría.
 * ============================================================= */
function applyThingTakeoverSmart(leftThing, rightThing, baseSpr, rdSpr, refCounts, { copyName = true } = {}) {
  if (!leftThing || !rightThing || !baseSpr || !rdSpr) return false;

  const BLANK = new ImageData(new Uint8ClampedArray(32 * 32 * 4), 32, 32);
  const rc = refCounts || new Map();

  const safeGroup = (g) =>
    (g && typeof g === 'object')
      ? g
      : { width:1, height:1, layers:1, patternX:1, patternY:1, patternZ:1, frames:1, sprites:[0] };

  const baseSlotsOf = (g) =>
    Math.max(1, g.width|0) *
    Math.max(1, g.height|0) *
    Math.max(1, g.layers|0) *
    Math.max(1, g.patternX|0) *
    Math.max(1, g.patternY|0) *
    Math.max(1, g.patternZ|0);

  const allocNewId = () => {
    const id = (baseSpr.sprites.length | 0) + 1;
    while (baseSpr.sprites.length < id) baseSpr.sprites.push(null);
    baseSpr.totalSprites = baseSpr.sprites.length;
    return id;
  };

  const writeBlank = (id) => {
    const idx = (id | 0) - 1;
    if (idx < 0) return;
    while (baseSpr.sprites.length <= idx) baseSpr.sprites.push(null);
    baseSpr.totalSprites = baseSpr.sprites.length;
    baseSpr.sprites[idx] = BLANK;
  };

  const writeCopy = (dstId, srcSid) => {
    const idx = (dstId | 0) - 1;
    if (idx < 0) return 0;
    while (baseSpr.sprites.length <= idx) baseSpr.sprites.push(null);
    baseSpr.totalSprites = baseSpr.sprites.length;
    const img = rdSpr.getSprite((srcSid | 0) - 1);
    if (!img) return 0;
    baseSpr.sprites[idx] = new ImageData(new Uint8ClampedArray(img.data), 32, 32);
    baseSpr.hasAlpha = !!(baseSpr.hasAlpha || rdSpr.hasAlpha);
    return dstId | 0;
  };

  const newGroups = [];
  const rightGroups = Array.isArray(rightThing.groups) ? rightThing.groups : [];
  const leftGroups  = Array.isArray(leftThing.groups)  ? leftThing.groups  : [];

  for (let gi = 0; gi < Math.max(rightGroups.length, 1); gi++) {
    const RG = safeGroup(rightGroups[gi] || null);
    const LG = safeGroup(leftGroups[gi]  || null);

    const slotsR  = baseSlotsOf(RG);
    const slotsL  = baseSlotsOf(LG);
    const framesR = Math.max(1, RG.frames | 0);
    const framesL = Math.max(1, LG.frames | 0);

    const newSprites = new Array(slotsR * framesR).fill(0);
    const oldIds = new Set((Array.isArray(LG.sprites) ? LG.sprites : [])
                            .map(x => x | 0).filter(x => x > 0));

    for (let f = 0; f < framesR; f++) {
      for (let k = 0; k < slotsR; k++) {
        const idxR = f * slotsR + k;
        const R = (RG.sprites[idxR] | 0) || 0;

        const haveLFrame = f < framesL;
        const haveLSlot  = k < slotsL;
        const idxL = (haveLFrame && haveLSlot) ? (f * slotsL + k) : -1;
        const L = (idxL >= 0) ? ((LG.sprites[idxL] | 0) || 0) : 0;

        if (R > 0) {
          if (L > 0) {
            writeCopy(L, R);
            newSprites[idxR] = L;
            oldIds.delete(L);
          } else {
            const id = allocNewId();
            writeCopy(id, R);
            newSprites[idxR] = id;
            rc.set(id, (rc.get(id) | 0) + 1);
          }
        } else {
          if (L > 0) {
            rc.set(L, Math.max(0, (rc.get(L) | 0) - 1));
            if ((rc.get(L) | 0) === 0) writeBlank(L);
            oldIds.delete(L);
          }
          newSprites[idxR] = 0;
        }
      }
    }

    for (const lost of oldIds) {
      rc.set(lost, Math.max(0, (rc.get(lost) | 0) - 1));
      if ((rc.get(lost) | 0) === 0) writeBlank(lost);
    }

    const NG = {
      width: RG.width | 0,
      height: RG.height | 0,
      layers: RG.layers | 0,
      patternX: RG.patternX | 0,
      patternY: RG.patternY | 0,
      patternZ: RG.patternZ | 0,
      frames: framesR | 0,
      sprites: newSprites
    };
    if (RG.anim) NG.anim = JSON.parse(JSON.stringify(RG.anim));
    newGroups.push(NG);
  }

  leftThing.groups = newGroups.length
    ? newGroups
    : [{ width:1, height:1, layers:1, patternX:1, patternY:1, patternZ:1, frames:1, sprites:[0] }];

  if (copyName && rightThing.name) leftThing.name = rightThing.name;
  leftThing.__rev = (leftThing.__rev | 0) + 1;
  return true;
}


/* ============= pares ============= */
function setPair(left,right){
  if (cmpState.mapL2R.has(left)) {
    const oldR = cmpState.mapL2R.get(left);
    if (oldR===right) return false;
    const s = cmpState.mapR2L.get(oldR); if (s){ s.delete(left); if(!s.size) cmpState.mapR2L.delete(oldR); }
    const idx = cmpState.pairs.findIndex(p=>p.left===left); if (idx>-1) cmpState.pairs.splice(idx,1);
  }
  cmpState.mapL2R.set(left,right);
  if (!cmpState.mapR2L.has(right)) cmpState.mapR2L.set(right,new Set());
  cmpState.mapR2L.get(right).add(left);
  cmpState.pairs.push({left,right});
  return true;
}
function unsetPairByLeft(left){
  const r = cmpState.mapL2R.get(left); if (r==null) return false;
  cmpState.mapL2R.delete(left);
  const set = cmpState.mapR2L.get(r); if (set){ set.delete(left); if(!set.size) cmpState.mapR2L.delete(r); }
  const i = cmpState.pairs.findIndex(p=>p.left===left); if (i>-1) cmpState.pairs.splice(i,1);
  return true;
}

/* === expansión thing→thing con TODOS los frames/layers/patrones === */
function expandThingAllSprites(L, R){
  const rightMax = sprRD?.totalSprites|0;
  const leftAll  = [...new Set(L.groups.flatMap(g => g.sprites).filter(id => (id|0) > 0))];
  const rightAll =        R.groups.flatMap(g => g.sprites).filter(id => (id|0) > 0 && (id|0) <= rightMax);

  let added = 0;
  const n = Math.min(leftAll.length, rightAll.length);
  for (let i=0;i<n;i++){
    if (setPair(leftAll[i]|0, rightAll[i]|0)) added++;
  }
  for (let i=n;i<leftAll.length;i++){
    if (setPair(leftAll[i]|0, 0)) added++;
  }
  return added;
}

/* ============= paginación / render ============= */
function cmpRenderPager(side, total){
  const pager = _q(side==='left' ? 'cmpLeftPager' : 'cmpRightPager'); if(!pager) return;
  const pages = Math.max(1, Math.ceil(total / cmpState.pageSize));
  const cur   = side==='left' ? cmpState.leftPage : cmpState.rightPage;

  pager.innerHTML = '';

  const mkBtn = (t, dis, fn)=>{ const b=document.createElement('button'); b.textContent=t; b.disabled=!!dis; b.onclick=fn; return b; };
  const setPage = (p)=>{
    const idx = Math.max(0, Math.min(pages-1, (p|0)));
    if (side==='left') cmpState.leftPage = idx; else cmpState.rightPage = idx;
    cmpRenderSide(side);
  };

  // back
  pager.append(mkBtn('⏮', cur<=0, ()=> setPage(cur-1)));

  // info + input
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '6px';
  const info = document.createElement('span');
  info.style.color = '#bcd7ff';
  info.textContent = `Página ${cur+1} de ${pages}`;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = String(pages);
  input.value = String(cur+1);
  input.style.width = '70px';
  input.placeholder = 'Ir a...';
  input.title = 'Ir a página';
  const go = document.createElement('button');
  go.textContent = 'Ir';

  const tryGo = ()=>{
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    setPage(Math.max(1, Math.min(pages, n)) - 1);
  };
  input.addEventListener('keydown', e=>{ if (e.key==='Enter') tryGo(); });
  go.addEventListener('click', tryGo);

  wrap.append(info, input, go);
  pager.append(wrap);

  // forward
  pager.append(mkBtn('⏭', cur>=pages-1, ()=> setPage(cur+1)));
}

function cmpRenderSide(side){
  const isLeft=side==='left', mode=isLeft?cmpState.leftMode:cmpState.rightMode, listEl=_q(isLeft?'cmpLeftList':'cmpRightList'); listEl.innerHTML='';
  const base=getBase(); const d=isLeft?base.dat:datRD, s=isLeft?base.spr:sprRD;
  const catWrap = _q(isLeft?'cmpLeftCatWrap':'cmpRightCatWrap'); if (catWrap) catWrap.style.display = (mode==='things'?'':'none');

  if ((mode==='sprites'&&!s) || (mode==='things'&&(!s||!d))){
    const msg=document.createElement('div'); msg.style.color='#9fb3c8'; msg.textContent=(isLeft?'Base no disponible.':'Carga RD.dat y RD.spr.')+(mode==='sprites'?' (SPR requerido).':' (DAT+SPR requeridos).'); listEl.appendChild(msg); cmpRenderPager(side,0); return;
  }

  const filter=isLeft?cmpState.leftFilter:cmpState.rightFilter, page=isLeft?cmpState.leftPage:cmpState.rightPage, start=page*cmpState.pageSize;

  if (mode==='sprites'){
    const ids=cmpBuildIdList(s.totalSprites|0,filter), slice=ids.slice(start,start+cmpState.pageSize), frag=document.createDocumentFragment();
    for (const id of slice){
      const div=document.createElement('div'); div.className='cmp-item'; div.dataset.id=id;
      const img=s.getSprite(id-1); const th=img?makeThumbFromSprite(img,92):(()=>{const c=document.createElement('canvas'); c.width=c.height=92; return c;})(); th.className='cmp-thumb'; div.appendChild(th);
      const badge=document.createElement('span'); badge.className='cmp-badge'; badge.textContent=`#${id}`; div.appendChild(badge);
      const mapped = isLeft ? cmpState.mapL2R.get(id) : (cmpState.mapR2L.get(id)?.size||0);
      if (mapped){
        div.classList.add('mapped');
        const ov=document.createElement('div'); ov.className='cmp-map';
        if (isLeft){
          const tgt = sprRD?.getSprite((mapped|0)-1);
          if (tgt){ const prev = makeThumbFromSprite(tgt, 28); prev.className='cmp-mini'; ov.appendChild(prev); }
          const tag=document.createElement('span'); tag.textContent = mapped ? `→ #${mapped}` : '→ vacío';
          const x=document.createElement('button'); x.className='cmp-x'; x.title='Quitar mapeo'; x.textContent='✕';
          x.onclick=(ev)=>{ ev.stopPropagation(); unsetPairByLeft(id); cmpRenderSide('left'); cmpRenderPairs(); }; ov.appendChild(tag); ov.appendChild(x);
        } else {
          const n = (cmpState.mapR2L.get(id)?.size||0);
          const tag=document.createElement('span'); tag.textContent=`← ${n}`; ov.appendChild(tag);
        }
        if (!isLeft && (cmpState.mapR2L.get(id)?.size||0) > 1) div.classList.add('cmp-conflict');
        listEl.appendChild(div); div.appendChild(ov);
      }
      div.onclick = () => cmpSelect(isLeft ? 'left' : 'right', { type:'sprite', id });
      const sel = isLeft ? cmpState.leftSel : cmpState.rightSel;
      if (sel?.type === 'sprite' && sel.id === id) {
        div.classList.add('selected', isLeft ? 'sel-left' : 'sel-right');
      }
      const lab=document.createElement('div'); lab.className='cmp-label'; lab.textContent='sprite'; div.appendChild(lab);
      frag.appendChild(div);
    }
    listEl.appendChild(frag); cmpRenderPager(side, ids.length);
  } else {
    const cat=isLeft?cmpState.leftCat:cmpState.rightCat;
    const arr=cat==='item'?d.items:cat==='outfit'?d.outfits:cat==='effect'?d.effects:d.missiles;
    const ids=[], f=String(filter||'').toLowerCase();
    for (let i=0;i<arr.length;i++){ const t=arr[i]; if(!t) continue; const nameOk=t.name?String(t.name).toLowerCase().includes(f):false; if(!f||String(i).includes(f)||nameOk) ids.push(i); }
    const slice=ids.slice(start,start+cmpState.pageSize), frag=document.createDocumentFragment();
    for (const id of slice){
      const t=arr[id]; if(!t||!t.groups?.length) continue;
      const g0=t.groups[0], sprites=thingFirstFrameSprites(g0), canvas=drawGroupCanvasWithSprRef(g0,sprites,s), th=makeThumbFromCanvas(canvas,92);
      const div=document.createElement('div'); div.className='cmp-item'; div.dataset.id=id;
      th.className='cmp-thumb'; div.appendChild(th);
      const badge=document.createElement('span'); badge.className='cmp-badge'; badge.textContent=`#${id}`; div.appendChild(badge);
      const label=document.createElement('div'); label.className='cmp-label'; label.textContent=t.name||cat; div.appendChild(label);
      const used = t.groups.flatMap(g=>g.sprites).filter(sid=>sid>0 && cmpState.mapL2R.has(sid)).length;
      if (used){ const ov=document.createElement('div'); ov.className='cmp-map'; ov.textContent=`${used} mapeado(s)`; div.classList.add('mapped'); div.appendChild(ov); }
      div.onclick = () => cmpSelect(isLeft ? 'left' : 'right', { type:'thing', category:cat, id });
      const sel = isLeft ? cmpState.leftSel : cmpState.rightSel;
      if (sel?.type === 'thing' && sel.category === cat && sel.id === id) {
        div.classList.add('selected', isLeft ? 'sel-left' : 'sel-right');
      }
      if (isLeft) {
        const op = cmpState.thingOps.find(op => op.left.cat === cat && (op.left.id|0) === (id|0));
        if (op) {
          div.classList.add('queued-left');
          const tag = document.createElement('div');
          tag.className = 'cmp-queued';
          tag.textContent = `← #${op.right.id}`;
          div.appendChild(tag);
        }
      } else {
        const op = cmpState.thingOps.find(op => op.right.cat === cat && (op.right.id|0) === (id|0));
        if (op) {
          div.classList.add('queued-right');
          const tag = document.createElement('div');
          tag.className = 'cmp-queued';
          tag.textContent = `→ #${op.left.id}`;
          div.appendChild(tag);
        }
      }
      frag.appendChild(div);
    }
    listEl.appendChild(frag); cmpRenderPager(side, ids.length);
  }
}

/* ============= side list (colapsable) ============= */
function cmpRenderPairs(){
  const side  = _q('cmpSidePane');
  const body  = _q('cmpSideBody');
  const title = _q('cmpSideTitle');
  if (!side || !body || !title) return;

  const totalThingOps = cmpState.thingOps.length;
  title.innerHTML = `Reemplazos de <b>Thing</b>: ${totalThingOps}`;
  side.classList.toggle('collapsed', cmpState.pairsCollapsed);
  const tgl = _q('cmpSideToggle'); if (tgl) tgl.textContent = cmpState.pairsCollapsed ? '⮞' : '⮜';

  body.innerHTML = '';

  const secT = document.createElement('div');
  secT.className = 'cmp-section';
  secT.textContent = `Reemplazos de Thing (${totalThingOps})`;
  body.appendChild(secT);

  if (!totalThingOps){
    const r = document.createElement('div');
    r.className = 'cmp-row muted';
    r.textContent = '— vacío —';
    body.appendChild(r);
    return;
  }

  cmpState.thingOps.forEach((op, i) => {
    const row = document.createElement('div');
    row.className = 'cmp-row';
    row.innerHTML = `[${i+1}] ${op.left.cat} #${op.left.id}  ←  ${op.right.cat} #${op.right.id}`;

    const del = document.createElement('button');
    del.className = 'danger';
    del.title = 'Quitar este reemplazo';
    del.textContent = '✕';
    del.onclick = () => window.cmpRemoveThingOp(i);

    row.appendChild(del);
    body.appendChild(row);
  });
}

window.cmpRemoveThingOp = function(idx){
  if (idx < 0 || idx >= cmpState.thingOps.length) return;
  cmpState.thingOps.splice(idx, 1);
  cmpRenderPairs();
  cmpRenderSide('left');
  cmpRenderSide('right');
};

/* ============= selección (re-render selectivo) ============= */
function cmpSelect(side, payload) {
  const prevL = cmpState.leftSel, prevR = cmpState.rightSel;
  if (side === 'left') cmpState.leftSel = payload; else cmpState.rightSel = payload;

  let formedPair = false;
  if (cmpState.leftSel && cmpState.rightSel && cmpState.leftSel.type === cmpState.rightSel.type) {
    if (payload.type === 'sprite') {
      setPair(cmpState.leftSel.id | 0, cmpState.rightSel.id | 0);
    } else {
      cmpState.thingOps.push({
        left:  { cat: cmpState.leftSel.category,  id: cmpState.leftSel.id  | 0 },
        right: { cat: cmpState.rightSel.category, id: cmpState.rightSel.id | 0 }
      });
    }
    cmpState.leftSel = cmpState.rightSel = null;
    formedPair = true;
  }

  if (formedPair) {
    cmpRenderSide('left'); 
    cmpRenderSide('right');
    cmpRenderPairs();
  } else {
    cmpRenderSide(side);
  }
}

/* ============= API pública ============= */
window.openSprComparator = function(){
  ensureCmpHighlightStyles();
  ensureCmpSidePanelStyles();
  ensureCmpSidePanel();

  const modal=_q('sprCompareModal'); if(!modal) return alert('Modal no encontrado');
  const base=getBase(); if(!base.spr||!base.dat) return alert('Primero carga tu .dat/.spr base en el editor.');
  modal.classList.remove('hidden');

  const wire=(id,fn)=>{ const el=_q(id); if(el&&!el.__wired){ el.__wired=true; el.onchange=fn; } };
  wire('cmpSprFile', async ()=>{
    const f=_q('cmpSprFile').files?.[0]; if(!f) return;
    try{
      sprRD = new SprParser(await f.arrayBuffer());
      cmpState.rightPage=0; cmpRenderSide('right');
    }catch(e){ console.error(e); alert('❌ Error SPR RD: '+e.message); }
  });
  wire('cmpDatFile', async ()=>{
    const f=_q('cmpDatFile').files?.[0]; if(!f) return;
    try{
      datRD = new DatParser(await f.arrayBuffer(), {
        sprSignatureHint: sprRD?.signature,
        versions: (window.versionManager?.versions)||undefined
      });
      datRD.resetEmptyThings?.();
      datRD.normalizeGroups?.(sprRD?.totalSprites||999999);
      cmpState.rightPage=0; cmpRenderSide('right');
    }catch(e){ console.error(e); alert('❌ Error DAT RD: '+e.message); }
  });

  // debounce input
  const debounce = (fn, ms=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
  const bind=(id,fn)=>{ const el=_q(id); if(el&&!el.__wired){ el.__wired=true; el.oninput=fn; } };
  bind('cmpLeftMode',  e=>{ cmpState.leftMode=e.target.value;  cmpRenderSide('left'); });
  bind('cmpRightMode', e=>{ cmpState.rightMode=e.target.value; cmpRenderSide('right'); });
  bind('cmpLeftCat',   e=>{ cmpState.leftCat=e.target.value;   cmpState.leftPage=0;  cmpRenderSide('left'); });
  bind('cmpRightCat',  e=>{ cmpState.rightCat=e.target.value;  cmpState.rightPage=0; cmpRenderSide('right'); });

  const ls=_q('cmpLeftSearch'), rs=_q('cmpRightSearch');
  if (ls && !ls.__wired){ ls.__wired=true; ls.addEventListener('input', debounce(e=>{ cmpState.leftFilter=e.target.value;  cmpState.leftPage=0;  cmpRenderSide('left'); },150)); }
  if (rs && !rs.__wired){ rs.__wired=true; rs.addEventListener('input', debounce(e=>{ cmpState.rightFilter=e.target.value; cmpState.rightPage=0; cmpRenderSide('right'); },150)); }

  cmpState.leftSel=cmpState.rightSel=null; cmpState.leftPage=cmpState.rightPage=0; cmpState.leftFilter=cmpState.rightFilter='';
  cmpRenderSide('left'); cmpRenderSide('right'); cmpRenderPairs();
};

(function(){
  const wrap = _q('cmpConsoleWrap');
  const dest = _q('cmpSidePane') || document.querySelector('#cmpRight .cmp-sidepane');
  if (wrap && dest && wrap.parentNode !== dest) dest.appendChild(wrap);
})();

/* ============= estilos / sidepanel ============= */
function ensureCmpSidePanelStyles(){
  if (document.getElementById('cmpSidePanelStyles')) return;
  const css = `
  :root{ --cmp-sidepane-w: 320px; --cmp-sidepane-collapsed: 44px; }
  #cmpPairs{ display:none !important; }
  #cmpSidePane{
    position:absolute; top:12px; right:12px; bottom:12px;
    width:var(--cmp-sidepane-w);
    background:#0b1322; color:#d9e8ff;
    border:1px solid #243b59; border-radius:12px;
    box-shadow:0 10px 26px rgba(0,0,0,.45);
    display:flex; flex-direction:column; overflow:hidden; z-index:10;
  }
  #cmpSidePane.collapsed{ width:var(--cmp-sidepane-collapsed); }
  #cmpSidePane .cmp-sidehead{
    display:flex; align-items:center; justify-content:space-between;
    gap:8px; padding:8px 8px; border-bottom:1px solid rgba(255,255,255,.08);
  }
  #cmpSidePane.collapsed .cmp-sidehead .title{ display:none; }
  #cmpSidePane .toggle{
    background:#1f2c44; border:1px solid #314a2a; color:#e6f1ff;
    border-radius:8px; padding:.2rem .5rem; cursor:pointer;
  }
  #cmpSidePane .cmp-sidebody{
    overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:6px;
  }
  .cmp-row button.danger{
    background:#3a1a1a;
    border:1px solid #6b2a2a;
    color:#ffd9d9;
    border-radius:8px;
    padding:.15rem .45rem;
    cursor:pointer;
  }
  .cmp-row{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    background:#0e1627; border:1px solid #243b59; border-radius:10px;
    padding:6px 8px; font-size:12px;
  }
  .cmp-row .muted{ opacity:.75; }
  .cmp-row button{
    background:#40243e; border:1px solid #6a3e66; color:#ffdff2;
    border-radius:8px; padding:.15rem .45rem; cursor:pointer;
  }
  .cmp-section{ margin:8px 0 4px; color:#9ec5ff; font-weight:600; font-size:12px; }
  `;
  const style = document.createElement('style');
  style.id = 'cmpSidePanelStyles';
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureCmpSidePanel(){
  if (document.getElementById('cmpSidePane')) return;
  const modal = _q('sprCompareModal'); if(!modal) return;
  const pane = document.createElement('div');
  pane.id = 'cmpSidePane';
  pane.className = 'cmp-sidepane' + (cmpState.pairsCollapsed ? ' collapsed' : '');
  pane.innerHTML = `
    <div class="cmp-sidehead">
      <span id="cmpSideTitle" class="title"></span>
      <button id="cmpSideToggle" class="toggle" title="Mostrar/Ocultar">⮜</button>
    </div>
    <div id="cmpSideBody" class="cmp-sidebody"></div>
  `;
  modal.appendChild(pane);
  _q('cmpSideToggle').onclick = () => {
    cmpState.pairsCollapsed = !cmpState.pairsCollapsed;
    pane.classList.toggle('collapsed', cmpState.pairsCollapsed);
    _q('cmpSideToggle').textContent = cmpState.pairsCollapsed ? '⮞' : '⮜';
  };
}

function ensureCmpHighlightStyles(){
  if (document.getElementById('cmpHighlightStyles')) return;
  const css = `
  :root{
    --cmp-left:rgb(65, 255, 90);
    --cmp-right:rgb(224, 2, 2);
    --cmp-map:#82f39d;
  }
  .cmp-item{ position:relative; border-radius:12px; }
  .cmp-item .cmp-thumb{ border-radius:10px; }
  .cmp-item.selected.sel-left  { box-shadow:0 0 0 2px color-mix(in srgb,var(--cmp-left) 70%, transparent) inset, 0 0 16px color-mix(in srgb,var(--cmp-left) 40%, transparent); animation:cmpPulseLeft 1.2s ease-in-out infinite; }
  .cmp-item.selected.sel-right { box-shadow:0 0 0 2px color-mix(in srgb,var(--cmp-right)70%, transparent) inset, 0 0 16px color-mix(in srgb,var(--cmp-right)40%, transparent); animation:cmpPulseRight 1.2s ease-in-out infinite; }
  .cmp-item.queued-left  { box-shadow:0 0 0 2px color-mix(in srgb,var(--cmp-left) 80%, transparent) inset, 0 0 14px color-mix(in srgb,var(--cmp-left) 45%, transparent) inset; }
  .cmp-item.queued-right { box-shadow:0 0 0 2px color-mix(in srgb,var(--cmp-right)80%, transparent) inset, 0 0 14px color-mix(in srgb,var(--cmp-right)45%, transparent) inset; }
  .cmp-item.mapped { box-shadow:0 0 0 2px color-mix(in srgb,var(--cmp-map)80%, transparent) inset, 0 0 14px color-mix(in srgb,var(--cmp-map)45%, transparent) inset; }
  .cmp-item .cmp-queued {
    position:absolute; left:8px; bottom:8px;
    font-size:11px; line-height:1; padding:4px 7px;
    color:#eaf6ff; background:rgba(10,18,32,.85);
    border:1px solid rgba(140,180,255,.35);
    border-radius:8px; pointer-events:none;
  }
  .cmp-item.queued-left  .cmp-queued{ border-color: color-mix(in srgb,var(--cmp-left) 50%, transparent); }
  .cmp-item.queued-right .cmp-queued{ border-color: color-mix(in srgb,var(--cmp-right)50%, transparent); }
  @keyframes cmpPulseLeft  { 0%,100%{ filter:none } 50%{ filter: drop-shadow(0 0 8px var(--cmp-left)); } }
  @keyframes cmpPulseRight { 0%,100%{ filter:none } 50%{ filter: drop-shadow(0 0 8px var(--cmp-right)); } }
  `;
  const style = document.createElement('style');
  style.id = 'cmpHighlightStyles';
  style.textContent = css;
  document.head.appendChild(style);
}

window.closeSprComparator = function(){ const modal=_q('sprCompareModal'); if(modal) modal.classList.add('hidden'); };

window.cmpClearPairs = function(){
  cmpState.pairs.length = 0;
  cmpState.mapL2R.clear();
  cmpState.mapR2L.clear();
  cmpState.thingOps.length = 0;
  cmpRenderPairs();
  cmpRenderSide('left');
  cmpRenderSide('right');
};

/* ============= Aplicar reemplazos ============= */
window.cmpApplyPairs = function(){
  const base = getBase();
  if (!base.spr || !base.dat) return alert('❌ Falta SPR/DAT base');
  if (!sprRD || !datRD)       return alert('❌ Carga SPR/DAT RD primero');

  // refCounts no es crítico con la lógica posicional. Se mantiene para métricas.
  const refCounts = buildSpriteRefCounts(base.dat);

  let replacedThings = 0;
  const touchedIds = new Set();

  for (const op of cmpState.thingOps) {
    const L = getThingById(base.dat, op.left.cat,  op.left.id);
    const R = getThingById(datRD,    op.right.cat, op.right.id);
    if (!L || !R) continue;

    const ok = applyThingTakeoverSmart(L, R, base.spr, sprRD, refCounts, { copyName: true });
    if (ok){ replacedThings++; touchedIds.add(op.left.id|0); }
  }
  cmpState.thingOps.length = 0;

  // pares manuales (sprite→sprite)
  const BLANK = new ImageData(new Uint8ClampedArray(TILE32*TILE32*4), TILE32, TILE32);
  let applied=0, skipped=0;
  for (const {left,right} of cmpState.pairs){
    const l = left | 0, r = right | 0;
    if (l < 1 || l > (base.spr.totalSprites|0)) { skipped++; continue; }
    if (!r) { base.spr.sprites[l-1] = BLANK; applied++; continue; }
    const src = sprRD.getSprite(r-1); if (!src) { skipped++; continue; }
    base.spr.sprites[l-1] = new ImageData(new Uint8ClampedArray(src.data), TILE32, TILE32);
    applied++;
  }
  cmpState.pairs.length = 0; cmpState.mapL2R.clear(); cmpState.mapR2L.clear();

  alert(`✅ Things reemplazados: ${replacedThings}` + (applied ? ` · Sprites aplicados: ${applied}` : '') + (skipped ? ` · Omitidos: ${skipped}` : ''));
  if (_q('cmpLivePreview')?.checked) { try { selectThing?.(window.currentThingId); } catch(_){} }

  try { refreshMainListThumbs?.(touchedIds); if ((applied|0) > 0) refreshMainListThumbs?.(); } catch(_){}

  cmpRenderSide('left'); cmpRenderSide('right'); cmpRenderPairs();

  try{ if(__shouldSaveLog() && (__cmpConsole?._buf?.length>0)) { __cmpConsole.save(); } }catch(_){}
};

/* ============= CMP PATCH: hover optimizado y debounce ya incluido arriba ============= */
(() => {
  const _q = (id) => document.getElementById(id);

  function thingSpritesAt(g, {x=0,y=0,z=0,frame=0,layer=0}={}){
    const per = Math.max(1,g.width|0)*Math.max(1,g.height|0);
    const base = ((((frame|0)*(g.patternZ|0)+(z|0))*(g.patternY|0)+(y|0))*(g.patternX|0)+(x|0))*(g.layers|0)+(layer|0);
    const start = (base|0)*per;
    const slice = g.sprites.slice(start, start+per);
    while (slice.length<per) slice.push(0);
    return slice;
  }
  function isThingEmpty(t){
    if (!t?.groups?.length) return true;
    for (const g of t.groups){
      if (!Array.isArray(g.sprites)) continue;
      for (let i=0;i<g.sprites.length;i++) if ((g.sprites[i]|0) > 0) return false;
    }
    return true;
  }

  const __cmpConsole = {
    _el: null, _buf: [], _wired:false,
    ensure(){
      if (this._wired) return;
      this._el = _q('cmpConsoleLog');
      const btnC = _q('cmpConsoleClear'), btnS = _q('cmpConsoleSave');
      if (btnC && !btnC.__wired){ btnC.__wired=true; btnC.addEventListener('click',()=>this.clear());}
      if (btnS && !btnS.__wired){ btnS.__wired=true; btnS.addEventListener('click',()=>this.save());}
      this._wired = true;
    },
    log(line){
      const ts = new Date().toISOString().replace('T',' ').replace(/\..+$/,'');
      const msg = `[${ts}] ${line}`;
      this._buf.push(msg);
      if (this._el){
        this._el.textContent = this._buf.join('\n');
        this._el.scrollTop = this._el.scrollHeight;
      }
    },
    clear(){ this._buf.length=0; if (this._el) this._el.textContent=''; },
    text(){ return (this._buf.join('\n')+'\n'); },
    save(){
      try{
        const blob = new Blob([this.text()], {type:'text/plain;charset=utf-8'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'comparador-log.txt';
        document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      }catch(e){ console.error('save txt failed', e); }
    }
  };

  (function wrapThingOpsPush(){
    try{
      if (!cmpState || !cmpState.thingOps || cmpState.thingOps.__wrappedPush) return;
      const orig = cmpState.thingOps.push.bind(cmpState.thingOps);
      cmpState.thingOps.push = function(op){
        const r = orig(op);
        if (op?.left && op?.right){
          __cmpConsole.log(`1/1 thing: ${op.left.cat} #${op.left.id}  →  ${op.right.cat} #${op.right.id}`);
        }
        return r;
      };
      cmpState.thingOps.__wrappedPush = true;
    }catch(_){}
  })();

  (function wrapApply(){
    try{
      if (!window.cmpApplyPairs || window.cmpApplyPairs.__wrapped) return;
      const orig = window.cmpApplyPairs;
      window.cmpApplyPairs = function(){
        const out = orig.apply(this, arguments);
        try{ if(__shouldSaveLog() && (__cmpConsole?._buf?.length>0)) { __cmpConsole.save(); } }catch(_){}
        return out;
      };
      window.cmpApplyPairs.__wrapped = true;
    }catch(_){}
  })();

  const __cmpHoverMgr = {
    _el:null, _cv:null, _ctx:null, _raf:0,
    ensure(){
      if (this._el) return;
      const d = document.createElement('div');
      d.id = 'cmpHoverTip';
      d.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:9999;background:#0b1625;border:1px solid #274364;border-radius:8px;box-shadow:0 12px 24px rgba(0,0,0,.5);padding:6px';
      const c = document.createElement('canvas'); c.width=140; c.height=140; d.appendChild(c);
      document.body.appendChild(d);
      this._el=d; this._cv=c; this._ctx=c.getContext('2d',{willReadFrequently:true}); this._ctx.imageSmoothingEnabled=false;
    },
    hide(){
      if (this._raf){ cancelAnimationFrame(this._raf); this._raf=0; }
      if (this._el) this._el.style.display='none';
    },
    showFor(side, cat, id, anchorEl){
      this.ensure();
      const base = getBase();
      const d = side==='left' ? base.dat : datRD;
      const s = side==='left' ? base.spr : sprRD;
      const arr = cat==='item'?d?.items:cat==='outfit'?d?.outfits:cat==='effect'?d?.effects:d?.missiles;
      const t = arr?.[id|0]; if (!t) return this.hide();
      const gIdle = t.groups?.[0], gWalk = t.groups?.[1];
      let g = gIdle||gWalk||t.groups?.[0]; if (!g) return this.hide();
      let frames = g.frames|0;
      if ((cat==='outfit') && gWalk && (gWalk.frames|0)>1){ g = gWalk; frames = g.frames|0; }
      else if ((cat==='outfit') && gIdle && (gIdle.frames|0)>1){ g = gIdle; frames = g.frames|0; }
      const rect = anchorEl.getBoundingClientRect();
      const x = Math.min(window.innerWidth-160, rect.right+8);
      const y = Math.max(8, rect.top-8);
      this._el.style.left = x+'px'; this._el.style.top = y+'px'; this._el.style.display='block';

      const faceX = (cat==='outfit') ? Math.min(2, (g.patternX|0)-1>=2 ? 2 : ((g.patternX|0)>2?2:0)) : 0;
      const targetFps = 12;
      const delay = Math.max(80, 1000/targetFps);
      let fi = 0, lastTs = 0;

      const loop = (ts)=>{
        if (!this._el || this._el.style.display==='none') return;
        if (document.hidden || !document.getElementById('sprCompareModal') || 
            document.getElementById('sprCompareModal').classList.contains('hidden')) {
          this.hide(); return;
        }
        if (!lastTs) lastTs = ts;
        if ((ts - lastTs) >= delay){
          lastTs = ts;
          fi = (fi+1) % Math.max(1, frames|0);
          const sprites = thingSpritesAt(g, {x:faceX, y:0, z:0, frame:fi, layer:0});
          const canvas = drawGroupCanvasWithSprRef(g, sprites, s);
          const scale = Math.max(1, Math.floor(Math.min(this._cv.width/canvas.width, this._cv.height/canvas.height)));
          const dw = canvas.width*scale, dh = canvas.height*scale;
          const dx = ((this._cv.width-dw)/2)|0, dy=((this._cv.height-dh)/2)|0;
          this._ctx.clearRect(0,0,this._cv.width,this._cv.height);
          this._ctx.drawImage(canvas, dx, dy, dw, dh);
        }
        this._raf = requestAnimationFrame(loop);
      };
      this.hide();
      this._el.style.display='block';
      lastTs = 0; fi = 0;
      this._raf = requestAnimationFrame(loop);
    }
  };

  function postProcessList(side){
    const isLeft = side==='left';
    const mode = isLeft ? cmpState.leftMode : cmpState.rightMode;
    if (mode !== 'things') return;
    const base = getBase();
    const d = isLeft ? base.dat : datRD;
    const s = isLeft ? base.spr : sprRD;
    const cat = isLeft ? cmpState.leftCat : cmpState.rightCat;
    const root = _q(isLeft ? 'cmpLeftList' : 'cmpRightList');
    const hideEmpty = isLeft ? !!_q('cmpLeftHideEmpty')?.checked : !!_q('cmpRightHideEmpty')?.checked;

    root?.querySelectorAll('.cmp-item').forEach(div => {
      const id = div.dataset.id|0;
      const arr = cat==='item'?d?.items:cat==='outfit'?d?.outfits:cat==='effect'?d?.effects:d?.missiles;
      const t = arr?.[id|0]; if (!t) return;
      if (hideEmpty && isThingEmpty(t)){ div.style.display='none'; return; } else { div.style.display=''; }
      if (cat==='outfit'){
        const g0 = t.groups?.[0]; if (!g0) return;
        const xSouth = (g0.patternX|0) > 2 ? 2 : Math.min(2, (g0.patternX|0)-1);
        const sprites = thingSpritesAt(g0, {x:xSouth, frame:0});
        const cv = drawGroupCanvasWithSprRef(g0, sprites, s);
        const th = div.querySelector('canvas.cmp-thumb');
        if (th){
          const ctx = th.getContext('2d', { willReadFrequently:true });
          ctx.imageSmoothingEnabled=false;
          ctx.clearRect(0,0,th.width,th.height);
          const scale = Math.max(1, Math.floor(Math.min(th.width/cv.width, th.height/cv.height)));
          const dw = cv.width*scale, dh = cv.height*scale;
          const dx = ((th.width-dw)/2)|0, dy=((th.height-dh)/2)|0;
          ctx.drawImage(cv, dx, dy, dw, dh);
        }
      }
      div.dataset.cat = cat;
      div.dataset.side = isLeft ? 'left' : 'right';
    });
  }

  function ensureObserversAndHover(){
    const leftRoot = _q('cmpLeftList'), rightRoot = _q('cmpRightList');
    if (leftRoot && !leftRoot.__obs) {
      const obs = new MutationObserver(()=>postProcessList('left'));
      obs.observe(leftRoot, {childList:true, subtree:true});
      leftRoot.__obs = obs;
      leftRoot.addEventListener('mouseover', (e)=>{
        const el = e.target.closest('.cmp-item'); if (!el) return;
        if ((cmpState.leftMode!=='things')) return;
        __cmpHoverMgr.showFor('left', (el.dataset.cat|| (cmpState.leftCat)), el.dataset.id||el.getAttribute('data-id'), el);
      });
      leftRoot.addEventListener('mouseout', ()=>__cmpHoverMgr.hide());
    }
    if (rightRoot && !rightRoot.__obs) {
      const obs = new MutationObserver(()=>postProcessList('right'));
      obs.observe(rightRoot, {childList:true, subtree:true});
      rightRoot.__obs = obs;
      rightRoot.addEventListener('mouseover', (e)=>{
        const el = e.target.closest('.cmp-item'); if (!el) return;
        if ((cmpState.rightMode!=='things')) return;
        __cmpHoverMgr.showFor('right', (el.dataset.cat|| (cmpState.rightCat)), el.dataset.id||el.getAttribute('data-id'), el);
      });
      rightRoot.addEventListener('mouseout', ()=>__cmpHoverMgr.hide());
    }
  }

  if (!window.openSprComparator.__patched){
    const origOpen = window.openSprComparator;
    window.openSprComparator = function(){
      origOpen.apply(this, arguments);
      const lh = _q('cmpLeftHideEmpty'), rh = _q('cmpRightHideEmpty');
      if (lh && !lh.__wired){ lh.__wired=true; lh.addEventListener('change', ()=>postProcessList('left')); }
      if (rh && !rh.__wired){ rh.__wired=true; rh.addEventListener('change', ()=>postProcessList('right')); }
      __cmpConsole.ensure();
      ensureObserversAndHover();
      setTimeout(()=>{ postProcessList('left'); postProcessList('right'); }, 0);
    };
    window.openSprComparator.__patched = true;
  }

  document.addEventListener('visibilitychange', ()=>{ 
    if (document.hidden) {
      const tip = document.getElementById('cmpHoverTip');
      if (tip) tip.style.display='none';
    }
  });
})();

/* ===== Shim público para el botón del HTML ===== */
if (!window.Reemplazador) window.Reemplazador = {};
window.Reemplazador.open   = () => window.openSprComparator?.();
window.Reemplazador.close  = () => window.closeSprComparator?.();
window.Reemplazador.apply  = () => window.cmpApplyPairs?.();
window.Reemplazador.clear  = () => window.cmpClearPairs?.();

// DnD sheet
const wrap = _q('tc36SheetWrap');
if (wrap) { // Ensure the element exists before adding event listeners
  wrap.addEventListener('dragover', e => {
    e.preventDefault();
  });
  wrap.addEventListener('drop', async e => {
    e.preventDefault();
    const filesList = (e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : [];
    const files = Array.prototype.filter.call(filesList, f => f.type === 'image/png');
    if (files.length) {
      await addSheetsFromFiles(files);
    }
  });
}
