/* otbEditor.js — OTB Editor para Items, lista virtualizada + previews
   Requisitos: DAT/SPR ya cargados en Honey Editor (no recarga archivos). */

   'use strict';

   /* ===================== Constantes OTB ===================== */
   const OTB = {
     NodeStart: 0xFE, NodeEnd: 0xFF, Escape: 0xFD,
     RootAttr: { Version: 0x01 },
     Attr: {
       ServerID:0x10, ClientID:0x11, Name:0x12, Description:0x13, GroundSpeed:0x14,
       SpriteHash:0x20, MinimapColor:0x21, MaxReadWriteChars:0x22, MaxReadChars:0x23,
       Light:0x2A, StackOrder:0x2B, TradeAs:0x2D, Article:0x2F
     },
     Group: { None:0, Ground:1, Container:2, Fluid:3, Splash:4, Deprecated:5, Podium:6 },
     Flag: {
       Unpassable:1<<0, BlockMissiles:1<<1, BlockPathfinder:1<<2, HasElevation:1<<3,
       MultiUse:1<<4, Pickupable:1<<5, Movable:1<<6, Stackable:1<<7,
       StackOrder:1<<13, Readable:1<<14, Rotatable:1<<15, Hangable:1<<16,
       HookEast:1<<17, HookSouth:1<<18, ClientCharges:1<<22, IgnoreLook:1<<23,
       IsAnimation:1<<24, FullGround:1<<25, ForceUse:1<<26
     }
   };
   
   /* ===================== Binario pequeño ===================== */
   function bw_start(size=1024){ const buf=new Uint8Array(size); return {buf, dv:new DataView(buf.buffer), o:0}; }
   function bw_need(w,n){ if(w.o+n<=w.buf.length) return; const b=new Uint8Array(Math.max(w.buf.length*2,w.o+n)); b.set(w.buf); w.buf=b; w.dv=new DataView(b.buffer); }
   function bw_u8(w,v){ bw_need(w,1); w.buf[w.o++]=v&255; }
   function bw_u16(w,v){ bw_need(w,2); w.dv.setUint16(w.o,v,true); w.o+=2; }
   function bw_u32(w,v){ bw_need(w,4); w.dv.setUint32(w.o,v,true); w.o+=4; }
   function bw_bytes(w,arr){ bw_need(w,arr.length); w.buf.set(arr,w.o); w.o+=arr.length; }
   function bw_slice(w){ return w.buf.slice(0,w.o); }
   
   function br_wrap(u8){ return {buf:u8, dv:new DataView(u8.buffer,u8.byteOffset,u8.byteLength), o:0, len:u8.length}; }
   function br_u8(r){ return r.buf[r.o++]; }
   function br_u16(r){ const v=r.dv.getUint16(r.o,true); r.o+=2; return v; }
   function br_u32(r){ const v=r.dv.getUint32(r.o,true); r.o+=4; return v; }
   function br_bytes(r,n){ const s=r.buf.slice(r.o,r.o+n); r.o+=n; return s; }
   
   function writeNodeStart(w,t){ bw_u8(w,OTB.NodeStart); bw_u8(w,t); bw_u32(w,0); }
   function writeNodeEnd(w){ bw_u8(w,OTB.NodeEnd); }
   function writeProp(w,a,p){ bw_u8(w,a); bw_u16(w,p.length); bw_bytes(w,p); }
   
   /* ===================== Accesos Honey ===================== */
   const $ = (id)=>document.getElementById(id);
   
   function getDAT(){
     // compat con distintos inicializadores del Honey
     return window.__DAT || window.DAT || window.dat || window.data?.dat || window.Editor?.dat || null;
   }
   function getSPR(){
     return window.__SPR || window.SPR || window.spr || window.data?.spr || window.Editor?.spr || null;
   }
   function getAppearItems(){ // sólo categoría items
     const dat=getDAT(); if(!dat?.items) return [];
     const out=[];
     for(let cid=1; cid<dat.items.length; cid++){
       const t=dat.items[cid];
       if(!t) continue;
       out.push({clientId:cid, thing:t});
     }
     return out;
   }
   
   /* ===================== Mapeo de banderas (DAT -> OTB) ===================== */
   function inferGroupFromThing(t){
     if (t.flags?.bank?.waypoints) return OTB.Group.Ground;
     if (t.flags?.container) return OTB.Group.Container;
     if (t.flags?.liquidcontainer) return OTB.Group.Fluid;
     if (t.flags?.liquidpool) return OTB.Group.Splash;
     return OTB.Group.None;
   }
   function flagsFromThing(t){
     // Intenta cubrir nombres comunes del Honey (unpass, unsight, avoid, rotate, etc.)
     const F=OTB.Flag, fl=t.flags||{}; let f=0;
     if (fl.unpass || fl.blocking) f|=F.Unpassable;
     if (fl.unsight || fl.blockprojectile || fl.blockMissile) f|=F.BlockMissiles;
     if (fl.avoid || fl.blockpath) f|=F.BlockPathfinder;
     if ((fl.hasHeight||0)>0 || fl.height) f|=F.HasElevation;
     if (fl.multiuse || fl.multiUse) f|=F.MultiUse;
     if (fl.pickupable || fl.take) f|=F.Pickupable;
     if (!fl.unmove && fl.moveable!==false) f|=F.Movable; // por defecto movible si no hay unmove
     if (fl.cumulative || fl.stackable) f|=F.Stackable;
     if (fl.rotate || fl.rotatable) f|=F.Rotatable;
     if (fl.hang || fl.hangable) f|=F.Hangable;
     if (fl.hookEast) f|=F.HookEast;
     if (fl.hookSouth) f|=F.HookSouth;
     if (fl.ignoreLook) f|=F.IgnoreLook;
     if (fl.animateAlways) f|=F.IsAnimation;
     if (fl.fullbank || fl.fullGround) f|=F.FullGround;
     if (fl.forceuse || fl.forceUse) f|=F.ForceUse;
     if (fl.charges || fl.clientCharges) f|=F.ClientCharges;
     if (fl.write || fl.writeOnce || fl.lenshelp) f|=F.Readable;
     if (fl.clip || fl.bottom || fl.top) f|=F.StackOrder;
     return f;
   }
   
   /* ===================== Writer/Reader OTB ===================== */
   function generateOTBFromDAT(major=3, minor=55, build=0, csd="OTB"){
     const items=getAppearItems();
     const w=bw_start(1<<20);
     bw_u32(w,0);                    // version fixed 0
     writeNodeStart(w,0);            // root
   
     // root.version
     {
       const p=bw_start(128+12);
       bw_u32(p,major); bw_u32(p,minor); bw_u32(p,build);
       const id=new TextEncoder().encode(csd);
       const fixed=new Uint8Array(128); fixed.set(id.slice(0,128));
       bw_bytes(p,fixed);
       writeProp(w, OTB.RootAttr.Version, bw_slice(p));
     }
   
     for(const it of items){
       const t=it.thing, cid=it.clientId;
       writeNodeStart(w, inferGroupFromThing(t));
       bw_u32(w, flagsFromThing(t)); // flags
       // atributos principales
       { const p=bw_start(2); bw_u16(p,cid); writeProp(w, OTB.Attr.ServerID, bw_slice(p)); }
       { const p=bw_start(2); bw_u16(p,cid); writeProp(w, OTB.Attr.ClientID, bw_slice(p)); }
   
       if (t.flags?.automap?.color){ const p=bw_start(2); bw_u16(p,t.flags.automap.color|0); writeProp(w,OTB.Attr.MinimapColor,bw_slice(p)); }
       if (t.flags?.writeOnce?.maxTextLengthOnce){ const p=bw_start(2); bw_u16(p,t.flags.writeOnce.maxTextLengthOnce|0); writeProp(w,OTB.Attr.MaxReadWriteChars,bw_slice(p)); }
       if (t.flags?.write?.maxTextLength){ const p=bw_start(2); bw_u16(p,t.flags.write.maxTextLength|0); writeProp(w,OTB.Attr.MaxReadChars,bw_slice(p)); }
       if (t.flags?.light){ const p=bw_start(4); bw_u16(p,t.flags.light.brightness|0); bw_u16(p,t.flags.light.color|0); writeProp(w,OTB.Attr.Light,bw_slice(p)); }
       if (t.flags?.bank?.waypoints){ const p=bw_start(2); bw_u16(p,t.flags.bank.waypoints|0); writeProp(w,OTB.Attr.GroundSpeed,bw_slice(p)); }
       if (t.flags?.clip || t.flags?.bottom || t.flags?.top){ const p=bw_start(1); let v=0; if(t.flags.clip)v=1; else if(t.flags.bottom)v=2; else if(t.flags.top)v=3; bw_u8(p,v); writeProp(w, OTB.Attr.StackOrder, bw_slice(p)); }
       if (t.flags?.market?.tradeAsObjectId){ const p=bw_start(2); bw_u16(p,t.flags.market.tradeAsObjectId|0); writeProp(w, OTB.Attr.TradeAs, bw_slice(p)); }
       if (t.name){ writeProp(w, OTB.Attr.Name, new TextEncoder().encode(t.name)); }
       if (t.article){ writeProp(w, OTB.Attr.Article, new TextEncoder().encode(t.article)); }
       if (t.description){ writeProp(w, OTB.Attr.Description, new TextEncoder().encode(t.description)); }
       writeNodeEnd(w);
     }
     writeNodeEnd(w);
     return bw_slice(w);
   }
   
   async function parseOTB(u8){
     const r=br_wrap(u8);
     const version=br_u32(r);
     if (br_u8(r)!==OTB.NodeStart) throw new Error('OTB root inválido');
     const rootType=br_u8(r); br_u32(r); // flags root ignorados
   
     // props root
     while(r.buf[r.o]!==OTB.NodeEnd){ const attr=br_u8(r); const len=br_u16(r); r.o+=len; }
     br_u8(r); // NodeEnd
   
     const items=[];
     while(r.o<r.len){
       const b=br_u8(r); if(b===OTB.NodeEnd) break;
       if(b!==OTB.NodeStart) throw new Error('Nodo inesperado');
       const type=br_u8(r); const flags=br_u32(r);
       const it={type,flags};
       while(r.buf[r.o]!==OTB.NodeEnd){
         const a=br_u8(r), l=br_u16(r), d=br_bytes(r,l), dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
         switch(a){
           case OTB.Attr.ServerID: it.serverId=dv.getUint16(0,true); break;
           case OTB.Attr.ClientID: it.clientId=dv.getUint16(0,true); break;
           case OTB.Attr.MinimapColor: it.minimapColor=dv.getUint16(0,true); break;
           case OTB.Attr.MaxReadWriteChars: it.maxReadWriteChars=dv.getUint16(0,true); break;
           case OTB.Attr.MaxReadChars: it.maxReadChars=dv.getUint16(0,true); break;
           case OTB.Attr.Light: it.lightLevel=dv.getUint16(0,true); it.lightColor=dv.getUint16(2,true); break;
           case OTB.Attr.GroundSpeed: it.groundSpeed=dv.getUint16(0,true); break;
           case OTB.Attr.StackOrder: it.stackOrder=d[0]|0; break;
           case OTB.Attr.TradeAs: it.tradeAs=dv.getUint16(0,true); break;
           case OTB.Attr.Name: it.name=new TextDecoder().decode(d); break;
           case OTB.Attr.Article: it.article=new TextDecoder().decode(d); break;
           case OTB.Attr.Description: it.description=new TextDecoder().decode(d); break;
           default: /* skip */ ;
         }
       }
       br_u8(r);
       items.push(it);
     }
     return {version, items};
   }
   
   /* ===================== Previews rápidos con caché ===================== */
   const _previewCache = new Map(); // key = clientId -> dataURL
   
   function findPreviewProvider(){
     // Intenta usar renderizadores existentes del Honey si están expuestos.
     const dat=getDAT(), spr=getSPR();
     const cand = window.HoneyPreview || window.ThingPreview || window.Editor?.preview || null;
   
     if (cand && typeof cand.render === 'function') {
       return (cid, size)=>Promise.resolve(cand.render(cid, size, dat, spr));
     }
     if (typeof window.drawGroupCanvasWithSprRef === 'function') {
       return (cid, size)=>{
         try{
           const thing = dat?.items?.[cid];
           if(!thing) return Promise.resolve(null);
           const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
           // Firma flexible: (thing, spr, canvas, size) o similar; si falla, devolvemos null.
           try { window.drawGroupCanvasWithSprRef(thing, spr, cvs, size); }
           catch { return Promise.resolve(null); }
           return Promise.resolve(cvs);
         }catch{ return Promise.resolve(null); }
       };
     }
     return ()=>Promise.resolve(null); // sin proveedor
   }
   
   const _getPreview = (()=> {
     const provider = findPreviewProvider();
     const queue = [];
     let busy = false;
   
     async function work(){
       if (busy) return;
       busy = true;
       while(queue.length){
         const job = queue.shift();
         try{
           const canvasOrNull = await provider(job.cid, 36);
           let url;
           if (canvasOrNull && canvasOrNull.toDataURL) url = canvasOrNull.toDataURL();
           else url = makePlaceholder(job.cid);
           _previewCache.set(job.cid, url);
           if (job.img) job.img.src = url;
         }catch{
           const url = makePlaceholder(job.cid);
           _previewCache.set(job.cid, url);
           if (job.img) job.img.src = url;
         }
         // cede al main thread
         await new Promise(r => (window.requestIdleCallback? requestIdleCallback(r, {timeout:50}) : setTimeout(r,0)));
       }
       busy = false;
     }
   
     function makePlaceholder(cid){
       const c=document.createElement('canvas'); c.width=c.height=36;
       const g=c.getContext('2d');
       g.fillStyle='#0a1320'; g.fillRect(0,0,36,36);
       g.fillStyle='#20344f'; g.fillRect(1,1,34,34);
       g.fillStyle='#8aa3c7'; g.font='10px monospace'; g.textAlign='center'; g.textBaseline='middle';
       g.fillText(cid|0, 18, 18);
       return c.toDataURL();
     }
   
     return function get(cid, imgEl){
       const key=cid|0;
       const cached=_previewCache.get(key);
       if (cached){ if(imgEl) imgEl.src=cached; return cached; }
       if (imgEl) { queue.push({cid:key, img:imgEl}); work(); }
       return null;
     };
   })();
   
   /* ===================== Lista virtualizada ===================== */
   class VirtualList {
     constructor(container, rowHeight, renderRow){
       this.c=container; this.rh=rowHeight; this.r=renderRow; this.items=[]; this.top=0;
       this.viewport=document.createElement('div'); this.viewport.className='otb-vp';
       this.phantom=document.createElement('div'); this.phantom.className='otb-phantom';
       this.c.innerHTML=''; this.c.appendChild(this.viewport); this.c.appendChild(this.phantom);
       this.onScroll=this.onScroll.bind(this);
       this.c.addEventListener('scroll', this.onScroll, {passive:true});
       this.buffer=8;
     }
     setItems(items){ this.items=items||[]; this.phantom.style.height=(this.items.length*this.rh)+'px'; this.onScroll(); }
     onScroll(){
       const ch=this.c.clientHeight; const st=this.c.scrollTop;
       const start=Math.max(0, Math.floor(st/this.rh)-this.buffer);
       const end=Math.min(this.items.length, Math.ceil((st+ch)/this.rh)+this.buffer);
       if (start===this._start && end===this._end) return;
       this._start=start; this._end=end;
       const frag=document.createDocumentFragment();
       this.viewport.innerHTML='';
       for(let i=start;i<end;i++){
         const y=i*this.rh;
         const row=this.r(this.items[i], i);
         row.classList.add('otb-row');
         row.style.transform=`translateY(${y}px)`;
         row.style.height=this.rh+'px';
         frag.appendChild(row);
       }
       this.viewport.appendChild(frag);
     }
   }
   
   /* ===================== UI (modal) ===================== */
   function ensurePanel(){
     if ($('otbEditorPanel')) return;
     const div=document.createElement('div');
     div.id='otbEditorPanel'; div.className='modal hidden';
     div.innerHTML=`
     <div class="modal-content">
       <div class="bar">
         <strong>OTB Editor</strong>
         <button id="otbClose">Cerrar</button>
         <button id="otbLoadBtn" title="Cargar items.otb">Cargar OTB</button>
         <button id="otbBuildBtn" title="Construir desde DAT/SPR cargados">Generar desde DAT</button>
         <button id="otbSaveBtn"  title="Guardar items.otb">Guardar .otb</button>
         <span id="otbStatus" class="muted"></span>
         <span class="flex"></span>
         <input id="otbSearch" placeholder="Buscar SID/CID/Nombre…" />
       </div>
       <div class="grid2">
         <div class="left">
           <div id="otbList" class="otb-list"></div>
         </div>
         <div class="right">
           <table class="grid">
             <tr><th style="width:160px">Prop</th><th>Valor</th></tr>
             <tr><td>ServerId</td><td><input id="fServerId" type="number" min="0"/></td></tr>
             <tr><td>ClientId</td><td><input id="fClientId" type="number" min="0"/></td></tr>
             <tr><td>Name</td><td><input id="fName" type="text"/></td></tr>
             <tr><td>GroundSpeed</td><td><input id="fGround" type="number" min="0"/></td></tr>
             <tr><td>MinimapColor</td><td><input id="fMini" type="number" min="0"/></td></tr>
             <tr><td>Light (lvl,color)</td><td><input id="fLightLvl" type="number" min="0" style="width:49%"/><input id="fLightCol" type="number" min="0" style="width:49%"/></td></tr>
             <tr><td>MaxRW / MaxR</td><td><input id="fMRW" type="number" min="0" style="width:49%"/><input id="fMR" type="number" min="0" style="width:49%"/></td></tr>
             <tr><td>TradeAs</td><td><input id="fTradeAs" type="number" min="0"/></td></tr>
             <tr><td>StackOrder</td><td><input id="fStack" type="number" min="0" max="3"/></td></tr>
             <tr><td>Flags</td><td class="flags">
               <label><input type="checkbox" id="flUnpass">Unpassable</label>
               <label><input type="checkbox" id="flBlockMis">BlockMissiles</label>
               <label><input type="checkbox" id="flBlockPath">BlockPath</label>
               <label><input type="checkbox" id="flElev">HasElevation</label>
               <label><input type="checkbox" id="flMulti">MultiUse</label>
               <label><input type="checkbox" id="flPick">Pickupable</label>
               <label><input type="checkbox" id="flMov">Movable</label>
               <label><input type="checkbox" id="flStackable">Stackable</label>
               <label><input type="checkbox" id="flReadable">Readable</label>
               <label><input type="checkbox" id="flRot">Rotatable</label>
               <label><input type="checkbox" id="flHang">Hangable</label>
               <label><input type="checkbox" id="flHookE">HookEast</label>
               <label><input type="checkbox" id="flHookS">HookSouth</label>
               <label><input type="checkbox" id="flIgnL">IgnoreLook</label>
               <label><input type="checkbox" id="flAnim">IsAnimation</label>
               <label><input type="checkbox" id="flFull">FullGround</label>
               <label><input type="checkbox" id="flForce">ForceUse</label>
               <label><input type="checkbox" id="flCharges">ClientCharges</label>
             </td></tr>
           </table>
         </div>
       </div>
     </div>`;
     document.body.appendChild(div);
   
     $('otbClose').onclick = ()=>div.classList.add('hidden');
     $('otbLoadBtn').onclick = () => {
       const inp=document.createElement('input'); inp.type='file'; inp.accept='.otb';
       inp.onchange = async ()=>{
         const u8=new Uint8Array(await inp.files[0].arrayBuffer());
         window.__OTB = await parseOTB(u8);
         $('otbStatus').textContent = `OTB: ${window.__OTB.items.length} items`;
         renderList();
       };
       inp.click();
     };
     $('otbBuildBtn').onclick = async ()=>{
       // construcción incremental para no bloquear UI
       const base = getAppearItems();
       const items=[]; const chunk=500;
       for(let i=0;i<base.length;i+=chunk){
         const slice=base.slice(i, i+chunk);
         for (const x of slice){
           const t=x.thing;
           items.push({
             serverId:x.clientId, clientId:x.clientId, name:t.name||'',
             groundSpeed:(t.flags?.bank?.waypoints|0)||0,
             minimapColor:(t.flags?.automap?.color|0)||0,
             lightLevel:(t.flags?.light?.brightness|0)||0,
             lightColor:(t.flags?.light?.color|0)||0,
             maxReadWriteChars:(t.flags?.writeOnce?.maxTextLengthOnce|0)||0,
             maxReadChars:(t.flags?.write?.maxTextLength|0)||0,
             stackOrder:(t.flags?.clip?1:(t.flags?.bottom?2:(t.flags?.top?3:0))),
             tradeAs:(t.flags?.market?.tradeAsObjectId|0)||0,
             flags: flagsFromThing(t)
           });
         }
         $('otbStatus').textContent = `Generando… ${Math.min(items.length, base.length)}/${base.length}`;
         await new Promise(r => setTimeout(r,0));
       }
       window.__OTB = {version:0, items};
       $('otbStatus').textContent = `Generado: ${items.length} items`;
       renderList();
     };
     $('otbSaveBtn').onclick = ()=>{
       if(!window.__OTB){ $('otbStatus').textContent='Nada que guardar'; return; }
       const bin = generateOTBFromDAT(); // puede cambiarse a writer(window.__OTB) si usas edición profunda
       const a=document.createElement('a');
       a.href=URL.createObjectURL(new Blob([bin],{type:'application/octet-stream'}));
       a.download='items.otb'; a.click(); URL.revokeObjectURL(a.href);
     };
     $('otbSearch').oninput = ()=>renderList();
   }
   
   /* ===================== Render de lista + edición ===================== */
   let _vlist=null, _current=null;
   
   function renderList(){
     ensurePanel();
     const box = $('otbList');
     if(!_vlist){ _vlist = new VirtualList(box, 48, renderRow); }
     const q = ($('otbSearch').value||'').toLowerCase();
     const items=(window.__OTB?.items||[]).filter(it=>{
       if (!q) return true;
       return String(it.serverId).includes(q) || String(it.clientId).includes(q) || (it.name||'').toLowerCase().includes(q);
     });
     _vlist.setItems(items);
   }
   
   function renderRow(it){
     const d=document.createElement('div'); d.className='row';
     const img=document.createElement('img'); img.className='thumb'; img.alt='';
     const title=document.createElement('div'); title.className='title';
     const meta=document.createElement('div'); meta.className='meta';
   
     title.textContent = (it.name && it.name.trim()) ? it.name : '(sin nombre)';
     meta.textContent = `SID ${it.serverId} • CID ${it.clientId}`;
   
     // preview lazy + cache
     const cached=_getPreview(it.clientId, img);
     if (cached) img.src=cached;
   
     d.appendChild(img); d.appendChild(title); d.appendChild(meta);
     d.onclick=()=>loadToForm(it);
     if (_current===it) d.classList.add('sel');
     return d;
   }
   
   function loadToForm(it){
     _current=it;
     $('fServerId').value=it.serverId||0;
     $('fClientId').value=it.clientId||0;
     $('fName').value=it.name||'';
     $('fGround').value=it.groundSpeed||0;
     $('fMini').value=it.minimapColor||0;
     $('fLightLvl').value=it.lightLevel||0;
     $('fLightCol').value=it.lightColor||0;
     $('fMRW').value=it.maxReadWriteChars||0;
     $('fMR').value=it.maxReadChars||0;
     $('fTradeAs').value=it.tradeAs||0;
     $('fStack').value=it.stackOrder||0;
   
     const F=OTB.Flag, f=it.flags|0;
     $('flUnpass').checked=!!(f&F.Unpassable);
     $('flBlockMis').checked=!!(f&F.BlockMissiles);
     $('flBlockPath').checked=!!(f&F.BlockPathfinder);
     $('flElev').checked=!!(f&F.HasElevation);
     $('flMulti').checked=!!(f&F.MultiUse);
     $('flPick').checked=!!(f&F.Pickupable);
     $('flMov').checked=!!(f&F.Movable);
     $('flStackable').checked=!!(f&F.Stackable);
     $('flReadable').checked=!!(f&F.Readable);
     $('flRot').checked=!!(f&F.Rotatable);
     $('flHang').checked=!!(f&F.Hangable);
     $('flHookE').checked=!!(f&F.HookEast);
     $('flHookS').checked=!!(f&F.HookSouth);
     $('flIgnL').checked=!!(f&F.IgnoreLook);
     $('flAnim').checked=!!(f&F.IsAnimation);
     $('flFull').checked=!!(f&F.FullGround);
     $('flForce').checked=!!(f&F.ForceUse);
     $('flCharges').checked=!!(f&F.ClientCharges);
   
     const commit=()=>{
       it.serverId = $('fServerId').value|0;
       it.clientId = $('fClientId').value|0;
       it.name = $('fName').value||'';
       it.groundSpeed=$('fGround').value|0;
       it.minimapColor=$('fMini').value|0;
       it.lightLevel=$('fLightLvl').value|0;
       it.lightColor=$('fLightCol').value|0;
       it.maxReadWriteChars=$('fMRW').value|0;
       it.maxReadChars=$('fMR').value|0;
       it.tradeAs=$('fTradeAs').value|0;
       it.stackOrder=$('fStack').value|0;
   
       let nf=0, F=OTB.Flag;
       if ($('flUnpass').checked) nf|=F.Unpassable;
       if ($('flBlockMis').checked) nf|=F.BlockMissiles;
       if ($('flBlockPath').checked) nf|=F.BlockPathfinder;
       if ($('flElev').checked) nf|=F.HasElevation;
       if ($('flMulti').checked) nf|=F.MultiUse;
       if ($('flPick').checked) nf|=F.Pickupable;
       if ($('flMov').checked) nf|=F.Movable;
       if ($('flStackable').checked) nf|=F.Stackable;
       if ($('flReadable').checked) nf|=F.Readable;
       if ($('flRot').checked) nf|=F.Rotatable;
       if ($('flHang').checked) nf|=F.Hangable;
       if ($('flHookE').checked) nf|=F.HookEast;
       if ($('flHookS').checked) nf|=F.HookSouth;
       if ($('flIgnL').checked) nf|=F.IgnoreLook;
       if ($('flAnim').checked) nf|=F.IsAnimation;
       if ($('flFull').checked) nf|=F.FullGround;
       if ($('flForce').checked) nf|=F.ForceUse;
       if ($('flCharges').checked) nf|=F.ClientCharges;
       it.flags=nf;
   
       renderList(); // actualiza fila seleccionada
     };
   
     // attach una sola vez por campo (idempotente)
     for (const id of ['fServerId','fClientId','fName','fGround','fMini','fLightLvl','fLightCol','fMRW','fMR','fTradeAs','fStack'])
       $(id).onchange=commit;
     for (const id of ['flUnpass','flBlockMis','flBlockPath','flElev','flMulti','flPick','flMov','flStackable','flReadable','flRot','flHang','flHookE','flHookS','flIgnL','flAnim','flFull','flForce','flCharges'])
       $(id).onchange=commit;
   }
   
   /* ===================== API pública ===================== */
   window.OTBEditor = {
     open(){
       ensurePanel();
       $('otbEditorPanel').classList.remove('hidden');
       renderList();
     }
   };
   