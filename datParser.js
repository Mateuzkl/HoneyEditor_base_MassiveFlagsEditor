const KNOWN_PAIRS_1097 = [
  ['00004A10','59E48E02'],
  ['00005556','55555556'],
];

const DEFAULT_COUNTS = Object.freeze({
  items: 52369, outfits: 10741, effects: 2800, missiles: 407,
});

const hex32 = n => (n>>>0).toString(16).toUpperCase().padStart(8,'0');
const matchesPair = (d,s) => {
  const dh=hex32(d), sh=hex32(s);
  return KNOWN_PAIRS_1097.some(([a,b]) => a===dh && b===sh);
};

// LUT 7.x (v3)
const V3_FLAGLEN = Object.freeze({
  0x00:2,  // ground speed
  0x07:2,  // writable
  0x08:2,  // writableOnce
  0x09:0,  // pickable
  0x10:4,  // light
  0x15:4,  // light var
  0x18:4,  // offset
  0x19:2,  // elevation
  0x1C:2,  // lens help
  0x1D:2,  // help
  // demás: 0 (boolean)
});

class DatParser {
  constructor(arrayBuffer, options = {}) {
    this.debug   = !!options.debug;
    this.onDebug = typeof options.onDebug === 'function' ? options.onDebug : null;
    this.DOLOG   = this.debug || !!this.onDebug;
    this.debugLog = [];

    this.autoPatch1097  = options.autoPatch1097 !== false;
    this.lock1097Bounds = options.lock1097Bounds !== false;
    this.forceMode1097  = !!options.forceMode1097;
    this.versionsList   = options.versions || null;
    this.detectByDatSignature55 = options.detectByDatSignature55 !== false;

    this._sprSignatureHint = Number.isFinite(options.sprSignatureHint) ? (options.sprSignatureHint>>>0) : undefined;

    this.maxConsecutiveErrors = Number.isFinite(options.maxConsecutiveErrors) ? Math.max(1, options.maxConsecutiveErrors|0) : 10;
    this.maxSpriteCountSanity = Number.isFinite(options.maxSpriteCountSanity) ? (options.maxSpriteCountSanity|0) : 2_000_000;
    this.itemStartId = Number.isFinite(options.itemStartId) ? (options.itemStartId|0) : 100;

    this.FB = Object.freeze({
      items:    options.fallbackCounts?.items    ?? DEFAULT_COUNTS.items,
      outfits:  options.fallbackCounts?.outfits  ?? DEFAULT_COUNTS.outfits,
      effects:  options.fallbackCounts?.effects  ?? DEFAULT_COUNTS.effects,
      missiles: options.fallbackCounts?.missiles ?? DEFAULT_COUNTS.missiles,
    });
    this.C1097 = Object.freeze({
      items:    options.counts1097?.items    ?? this.FB.items,
      outfits:  options.counts1097?.outfits  ?? this.FB.outfits,
      effects:  options.counts1097?.effects  ?? this.FB.effects,
      missiles: options.counts1097?.missiles ?? this.FB.missiles,
    });

    this.view = new DataView(arrayBuffer);
    this._fileLength = this.view.byteLength;
    this.offset = 0;
    this.signature = 0;

    this.itemCount = this.outfitCount = this.effectCount = this.missileCount = 0;
    this.items = this.outfits = this.effects = this.missiles = [];

    this.exportOptions = {
      version:null, extended:false, transparency:false,
      improvedAnimations:false, frameGroups:false, signatureOverride:null
    };

    this.stats = {
      signatureHex:'00000000',
      headerCounts:{items:0,outfits:0,effects:0,missiles:0},
      usedBounds:{items:0,outfits:0,effects:0,missiles:0},
      parsed:{items:0,outfits:0,effects:0,missiles:0},
      errors:{items:0,outfits:0,effects:0,missiles:0},
      consecutiveErrorLimit:this.maxConsecutiveErrors,
      fileLength:this._fileLength, mode1097:false, signatureOverrideHex:null,
      blockOffsets:{itemsStart:0,outfitsStart:0,effectsStart:0,missilesStart:0,endOffset:0},
      detectInfo:{}
    };

    if (this.DOLOG) this._log('init',{fileLength:this._fileLength});

    this.readHeader();

    const sig = this.signature>>>0;
    this.isRetro = false; this.retroMode = 0;
    const retroSigs = {
      0x439D5A33:3,  // 7.60/7.70
      0x439D7A33:3,  // 7.72
      0x46F76E05:4,  // 8.0
      0x4E4F1862:4,  // 8.54
      0x4E3F1061:5,  // 8.60
      0x56E61057:5,  // 9.1
      0x56FF7057:5,  // 9.31
    };
    if (retroSigs[sig]) {
      this.retroMode = retroSigs[sig];
      this.isRetro = true;
      this.exportOptions.extended=false;
      this.exportOptions.transparency=false;
      this.exportOptions.improvedAnimations=false;
      this.exportOptions.frameGroups=false;
      this.maxConsecutiveErrors = Math.max(this.maxConsecutiveErrors, 64);
      this.stats.consecutiveErrorLimit = this.maxConsecutiveErrors;
    }

    let is1097 = this.forceMode1097 || this._detect1097();
    this.stats.mode1097 = !!is1097;
    if (is1097 && this.autoPatch1097) this._applyRavendawnPatch();
    if (is1097 && this.lock1097Bounds && this._validateBoundsObject(this.C1097)) {
      this.itemCount=this.C1097.items; this.outfitCount=this.C1097.outfits;
      this.effectCount=this.C1097.effects; this.missileCount=this.C1097.missiles;
    }

    if (this.itemCount>0)    this.items    = new Array(this.itemCount+1);
    if (this.outfitCount>0)  this.outfits  = new Array(this.outfitCount+1);
    if (this.effectCount>0)  this.effects  = new Array(this.effectCount+1);
    if (this.missileCount>0) this.missiles = new Array(this.missileCount+1);

    this.readThingsSequentially();
    this._reconcileCounts();

    this.stats.blockOffsets.endOffset = this.offset;
    if (this.DOLOG) this._log('done',{
      parsed:this.stats.parsed, errors:this.stats.errors,
      offset:this.offset, remaining:this._fileLength-this.offset,
      headerCounts:this.stats.headerCounts, usedBounds:this.stats.usedBounds
    });
  }

  // ===== Utils =====
  _log(t,d={}){ const evt={t,off:this.offset,...d}; if (this.debug) this.debugLog.push(evt); if (this.onDebug) { try{ this.onDebug(evt);}catch{} } }
  ensureAv(n){ if (this.offset+n > this._fileLength){ if (this.DOLOG) this._log('overflow',{need:n,off:this.offset,len:this._fileLength}); throw new Error('Overflow'); } }
  readU8 (){ this.ensureAv(1); const v=this.view.getUint8 (this.offset); this.offset+=1; return v; }
  readU16(){ this.ensureAv(2); const v=this.view.getUint16(this.offset,true); this.offset+=2; return v; }
  readU32(){ this.ensureAv(4); const v=this.view.getUint32(this.offset,true); this.offset+=4; return v; }

  // ===== Header =====
  readHeader(){
    this.signature   = this.readU32();
    this.itemCount   = this.readU16();
    this.outfitCount = this.readU16();
    this.effectCount = this.readU16();
    this.missileCount= this.readU16();
    this.stats.signatureHex = hex32(this.signature);
    this.stats.headerCounts = { items:this.itemCount,outfits:this.outfitCount,effects:this.effectCount,missiles:this.missileCount };
    if (this.DOLOG) this._log('header',{header:this.stats.headerCounts,signature:this.stats.signatureHex});
  }

  // ===== 1097 detect/patch =====
  _detect1097(){
    const datHex=hex32(this.signature);
    const sprHex=this._sprSignatureHint ? hex32(this._sprSignatureHint) : null;
    if (this.detectByDatSignature55 && datHex==='00005556') return true;
    if (this.versionsList && sprHex){
      const m=this.versionsList.find(v=>v.dat===datHex && v.spr===sprHex);
      if (m && (''+m.value)==='1097') return true;
    }
    if (sprHex && matchesPair(this.signature,this._sprSignatureHint)) return true;
    return false;
  }
  _applyRavendawnPatch(){ const datHex=hex32(this.signature); const override=(datHex==='00005556')?0x00005556:0x00004A10; this.exportOptions.signatureOverride=override>>>0; this.stats.signatureOverrideHex=hex32(override); }
  _validateBoundsObject(b){ return b && Number.isFinite(b.items) && Number.isFinite(b.outfits) && Number.isFinite(b.effects) && Number.isFinite(b.missiles) && b.items>0 && b.outfits>0; }

  // ===== Lectura secuencial con realineador =====
  readThingsSequentially(){
    const head = this.stats.headerCounts;
    const retro = this.isRetro;

    // En 7.x el header es CONTEO
    const lastItemId    = retro ? (this.itemStartId - 1 + (head.items|0))     : (head.items|0);
    const lastOutfitId  = retro ? (head.outfits|0)                             : (head.outfits|0);
    const lastEffectId  = retro ? (head.effects|0)                             : (head.effects|0);
    const lastMissileId = retro ? (head.missiles|0)                            : (head.missiles|0);

    const bounds = {
      itemsStart:   this.itemStartId, itemsEnd:     Math.max(this.itemStartId, lastItemId),
      outfitsStart: 1,                 outfitsEnd:  Math.max(1, lastOutfitId),
      effectsStart: 1,                 effectsEnd:  Math.max(1, lastEffectId),
      missilesStart:1,                 missilesEnd: Math.max(1, lastMissileId),
    };

    const scan = (start,end,cat,arr)=>{
      let id=start,err=0,parsed=0,total=0,limit=this.maxConsecutiveErrors;
      while(id<=end){
        total++;
        const saved=this.offset;
        try{
          const t=this.readThing(id,cat);
          if (t){ arr[id]=t; parsed++; err=0; }
          else { throw new Error('null thing'); }
        }catch(e){
          err++;
          this.offset = saved;
          if (!this._skipThingRetroSafe(cat)) {
            if (this.DOLOG) this._log('cant-resync',{category:cat,id,error:String(e&&e.message||e)});
            if (!retro && err>=limit) break;
          }
        }
        if (!retro && err>=limit) break;
        id++;
      }
      this.stats.parsed[cat+'s']=parsed; this.stats.errors[cat+'s']=total-parsed;
    };

    this.stats.blockOffsets.itemsStart    = this.offset; scan(bounds.itemsStart,    bounds.itemsEnd,    'item',    this.items    = new Array(bounds.itemsEnd+1));
    this.stats.blockOffsets.outfitsStart  = this.offset; scan(bounds.outfitsStart,  bounds.outfitsEnd,  'outfit',  this.outfits  = new Array(bounds.outfitsEnd+1));
    this.stats.blockOffsets.effectsStart  = this.offset; scan(bounds.effectsStart,  bounds.effectsEnd,  'effect',  this.effects  = new Array(bounds.effectsEnd+1));
    this.stats.blockOffsets.missilesStart = this.offset; scan(bounds.missilesStart, bounds.missilesEnd, 'missile', this.missiles = new Array(bounds.missilesEnd+1));
  }

  _skipThingRetroSafe(category){
    if (!this.isRetro) return false;

    const start = this.offset;
    const limit = Math.min(this._fileLength, start + 256);
    let p = start, found = -1;

    while (p < limit){
      if (this.view.getUint8(p) === 0xFF) { found = p+1; break; }
      p++;
    }
    if (found<0) return false;

    const ok = this._validateGroupAt(found);
    if (!ok) {
      for (const s of [2,4,6,8,10,12,14,16]){
        if (this._validateGroupAt(found+s)){ this.offset=found+s; return true; }
        if (found>=s && this._validateGroupAt(found-s)){ this.offset=found-s; return true; }
      }
      return false;
    }
    this.offset = found;
    return true;
  }

  _validateGroupAt(pos){
    if (pos+2>this._fileLength) return false;
    const w=this.view.getUint8(pos), h=this.view.getUint8(pos+1);
    const tryOnce = (hasExact) => {
      let o=pos;
      const need=hasExact?7:6; if (o+need>this._fileLength) return false;
      const width=this.view.getUint8(o), height=this.view.getUint8(o+1); o+=2;
      let exact=32; if (hasExact){ exact=this.view.getUint8(o); o++; }
      const layers=this.view.getUint8(o); o++;
      const pX=this.view.getUint8(o); o++;
      const pY=this.view.getUint8(o); o++;
      const frames=this.view.getUint8(o); o++;

      const okDims=(width>=1&&width<=8)&&(height>=1&&height<=8)&&(layers>=1&&layers<=4)&&(pX>=1&&pX<=4)&&(pY>=1&&pY<=4)&&(frames>=1&&frames<=64);
      if (!okDims) return false;

      // no leemos sprites; solo comprobamos que hay espacio razonable
      const spc=width*height*layers*pX*pY*1*frames;
      const bytes = (this.retroMode>=4) ? spc*4 : spc*2;
      return (o+bytes) <= this._fileLength;
    };
    return tryOnce(w>1||h>1) || tryOnce(false) || tryOnce(true);
  }

  // ===== Dispatch =====
  readThing(id,category){
    const sig = this.signature>>>0;
    if (sig===0x439D5A33) return this._readThing760(id,category);   // 7.60/7.70
    if (this.retroMode>0)  return this._readThingRetro(id,category);
    return this._readThingModern(id,category);
  }

  // ===== 7.60/7.70 =====
  _readThing760(id, category){
    const flags=[]; const flagStart=this.offset; let cnt=0;
    while(true){
      if (this.offset >= this._fileLength) throw new Error("EOF flags 760");
      if (++cnt > 512) throw new Error("Flag overflow 760");
      const f=this.readU8(); if (f===0xFF) break;
      flags.push(f);
      const len=V3_FLAGLEN[f]|0; if (len){ this.ensureAv(len); this.offset+=len; }
    }
    const flagEnd=this.offset;
    let raw=[]; try{ raw=Array.from(new Uint8Array(this.view.buffer,flagStart,flagEnd-flagStart)); }catch{}

    const totalSpr = (typeof window!=='undefined' && window.spr && Number.isFinite(window.spr.totalSprites))
      ? (window.spr.totalSprites|0) : 0;

    const tryGroup = (pos, forceExact) => {
      let o=pos; if (o+2>this._fileLength) return null;
      const w0=this.view.getUint8(o), h0=this.view.getUint8(o+1);
      const hasExact = (forceExact!==undefined) ? !!forceExact : (w0>1||h0>1);
      const need = hasExact ? 7 : 6; if (o+need>this._fileLength) return null;

      const save=this.offset; this.offset=o;

      const width  = this.readU8();
      const height = this.readU8();
      let exact    = 32; if (hasExact) exact = this.readU8();
      const layers = this.readU8();
      const pX     = this.readU8();
      const pY     = this.readU8();
      const frames = this.readU8();
      const pZ     = 1;

      const okDims=(width>=1&&width<=8)&&(height>=1&&height<=8)&&(layers>=1&&layers<=4)&&(pX>=1&&pX<=4)&&(pY>=1&&pY<=4)&&(frames>=1&&frames<=64);
      if (!okDims){ this.offset=save; return null; }

      const spc=width*height*layers*pX*pY*pZ*frames;
      if (!Number.isFinite(spc)||spc<=0||spc>this.maxSpriteCountSanity){ this.offset=save; return null; }

      if (this.offset + spc*2 > this._fileLength){ this.offset=save; return null; }
      const sprites=new Array(spc); for(let i=0;i<spc;i++) sprites[i]=this.readU16();

      let outOfRange=0, zeros=0, deltas=[];
      for(let i=0;i<spc;i++){
        const s=sprites[i]>>>0;
        if (s===0) zeros++; else if (totalSpr && s>totalSpr) outOfRange++;
        if (i>0) deltas.push((sprites[i]>>>0)-(sprites[i-1]>>>0));
      }
      let varDelta=0; if (deltas.length){ const avg=deltas.reduce((a,b)=>a+b,0)/deltas.length; varDelta=deltas.reduce((a,b)=>a+Math.abs(b-avg),0)/deltas.length; }
      const score=(outOfRange*100)+(zeros*2)+Math.round(varDelta);

      const out={width,height,exactSize:exact,layers,patternX:pX,patternY:pY,patternZ:pZ,frames,sprites, anim:null};
      const end=this.offset; this.offset=save; return {out,endPos:end,score,hasExact};
    };

    const basePos=this.offset;
    const SHIFTS=[-16,-14,-12,-10,-8,-6,-4,-2,0,2,4,6,8,10,12,14,16];
    let best=null;
    for (const s of SHIFTS){
      for (const mode of [undefined,false,true]){
        const p=basePos+s; if (p<0) continue;
        const c=tryGroup(p, mode);
        if (!c) continue;
        if (!best || c.score<best.score) best={...c,pos:p,shift:s};
        else if (c.score===best.score){
          const a=c.out.width*c.out.height*c.out.layers*c.out.patternX*c.out.patternY*c.out.patternZ*c.out.frames;
          const b=best.out.width*best.out.height*best.out.layers*best.out.patternX*best.out.patternY*best.out.patternZ*best.out.frames;
          if (a<b) best={...c,pos:p,shift:s};
        }
      }
    }
    if (!best) throw new Error("grupo 760 inválido");

    this.offset=best.pos;
    const final=tryGroup(best.pos, best.hasExact);
    this.offset=final.endPos;

    const groups=[{groupType:0, ...final.out}];
    return { id, category, flags, groups, __flagBytes:raw };
  }

  // ===== 7.72–9.x =====
  _readThingRetro(id, category){
    const mode = this.retroMode|0;

    const flags=[]; const flagStart=this.offset; let cnt=0;
    while(true){
      if (this.offset >= this._fileLength) throw new Error("EOF flags retro");
      if (++cnt > 512) throw new Error("Flag overflow retro");
      const f=this.readU8(); if (f===0xFF) break;
      flags.push(f);
      const len=(V3_FLAGLEN[f]|0) || ((f===0x1A||f===0x1E||f===0x20)?2:0);
      if (len){ this.ensureAv(len); this.offset+=len; }
    }
    const flagEnd=this.offset; let raw=[]; try{ raw=Array.from(new Uint8Array(this.view.buffer,flagStart,flagEnd-flagStart)); }catch{}

    const totalSpr=(typeof window!=='undefined' && window.spr && Number.isFinite(window.spr.totalSprites))?(window.spr.totalSprites|0):0;

    const tryGroup = (pos, forceExact) => {
      let o=pos; if (o+2>this._fileLength) return null;
      const w0=this.view.getUint8(o), h0=this.view.getUint8(o+1);
      const hasExact=(forceExact!==undefined)?!!forceExact:(w0>1||h0>1);
      const need=hasExact?7:6; if (o+need>this._fileLength) return null;

      const save=this.offset; this.offset=o;

      const width=this.readU8(), height=this.readU8();
      let exact=32; if (hasExact) exact=this.readU8();
      const layers=this.readU8(), pX=this.readU8(), pY=this.readU8(), frames=this.readU8(), pZ=1;

      const okDims=(width>=1&&width<=8)&&(height>=1&&height<=8)&&(layers>=1&&layers<=4)&&(pX>=1&&pX<=4)&&(pY>=1&&pY<=4)&&(frames>=1&&frames<=64);
      if (!okDims){ this.offset=save; return null; }

      const spc=width*height*layers*pX*pY*pZ*frames; if (!Number.isFinite(spc)||spc<=0||spc>this.maxSpriteCountSanity){ this.offset=save; return null; }

      const sprites=new Array(spc);
      if (mode>=4){ this.ensureAv(spc*4); for (let i=0;i<spc;i++) sprites[i]=this.readU32(); }
      else        { this.ensureAv(spc*2); for (let i=0;i<spc;i++) sprites[i]=this.readU16(); }

      let outOfRange=0, zeros=0, deltas=[]; for (let i=0;i<spc;i++){
        const s=sprites[i]>>>0; if (s===0) zeros++; else if (totalSpr && s>totalSpr) outOfRange++; if (i>0) deltas.push((sprites[i]>>>0)-(sprites[i-1]>>>0));
      }
      let varDelta=0; if (deltas.length){ const avg=deltas.reduce((a,b)=>a+b,0)/deltas.length; varDelta=deltas.reduce((a,b)=>a+Math.abs(b-avg),0)/deltas.length; }
      const score=(outOfRange*100)+(zeros*2)+Math.round(varDelta);

      const out={width,height,exactSize:exact,layers,patternX:pX,patternY:pY,patternZ:pZ,frames,sprites, anim:null};
      const end=this.offset; this.offset=save; return {out,endPos:end,score,hasExact};
    };

    const basePos=this.offset; const SHIFTS=[-16,-14,-12,-10,-8,-6,-4,-2,0,2,4,6,8,10,12,14,16];
    let best=null;
    for (const s of SHIFTS){
      for (const modeX of [undefined,false,true]){
        const p=basePos+s; if (p<0) continue; const c=tryGroup(p, modeX);
        if(!c) continue;
        if(!best || c.score<best.score) best={...c,pos:p,shift:s};
        else if (c.score===best.score){
          const a=c.out.width*c.out.height*c.out.layers*c.out.patternX*c.out.patternY*c.out.patternZ*c.out.frames;
          const b=best.out.width*best.out.height*best.out.layers*best.out.patternX*best.out.patternY*best.out.patternZ*best.out.frames;
          if (a<b) best={...c,pos:p,shift:s};
        }
      }
    }
    if (!best) throw new Error("grupo retro inválido");

    this.offset=best.pos; const final=tryGroup(best.pos, best.hasExact); this.offset=final.endPos;

    const groups=[{groupType:0, ...final.out}];
    return { id, category, flags, groups, __flagBytes:raw };
  }

  // ===== Moderno =====
  _readThingModern(id, category){
    const flags=[]; const flagStart=this.offset; let f=0,cnt=0; const is1097=this.stats.mode1097;
    while(true){
      if (this.offset >= this._fileLength) throw new Error("EOF flags modern");
      if (++cnt > 512) throw new Error("Flag overflow modern");
      f=this.readU8(); if (f===0xFF) break;
      flags.push(f);
      if (is1097) continue;
      switch(f){
        case 0x00: case 0x08: case 0x09: case 0x1A:
        case 0x1D: case 0x1E: case 0x21: case 0x23:
          this.ensureAv(2); this.offset+=2; break;
        case 0x16: case 0x19:
          this.ensureAv(4); this.offset+=4; break;
        case 0x22: {
          this.ensureAv(6); this.offset+=6;
          const len=this.readU16(); this.ensureAv(len+4); this.offset += (len+4);
          break;
        }
        default: break;
      }
    }
    const flagEnd=this.offset; let raw=[]; try{ raw=Array.from(new Uint8Array(this.view.buffer,flagStart,flagEnd-flagStart)); }catch{}

    const groups=[]; const groupCount=(category==='outfit')?this.readU8():1;
    for(let g=0; g<groupCount; g++){
      let groupType=null; if (category==='outfit') groupType=this.readU8();
      const width=this.readU8(), height=this.readU8();
      let exact=0; if (width>1 || height>1) exact=this.readU8();
      const layers=this.readU8();
      const pX=this.readU8(), pY=this.readU8(), pZ=this.readU8();
      const frames=this.readU8();

      let anim=null;
      if (frames>1){
        this.ensureAv(6 + frames*8);
        const min=this.readU16(), max=this.readU16(), u1=this.readU8(), u2=this.readU8();
        const pfMin=new Array(frames), pfMax=new Array(frames);
        for(let i=0;i<frames;i++){ pfMin[i]=this.readU32(); pfMax[i]=this.readU32(); }
        anim={min,max,unk1:u1,unk2:u2,perFrameMin:pfMin,perFrameMax:pfMax};
      }

      const spc=(width|0)*(height|0)*(layers|0)*(pX|0)*(pY|0)*(pZ|0)*(frames|0);
      if (!Number.isFinite(spc) || spc<0 || spc>this.maxSpriteCountSanity) throw new Error("spriteCount modern");

      this.ensureAv(spc*4);
      const sprites=new Array(spc); for(let i=0;i<spc;i++) sprites[i]=this.readU32();

      groups.push({groupType,width,height,exactSize:exact,layers,patternX:pX,patternY:pY,patternZ:pZ,frames,sprites,anim});
    }
    return { id, category, flags, groups, __flagBytes:raw };
  }

  // ===== Normalización / Export =====
  normalizeGroups(maxTotalSprites=2000000, safeCap=4096){
    const fix=(t)=>{ if(!t||!t.groups) return;
      for(const g of t.groups||[]){ if(!g) continue;
        const w=g.width|0, h=g.height|0, l=g.layers|0, px=g.patternX|0, py=g.patternY|0, pz=g.patternZ|0, fr=g.frames|0;
        const expected=w*h*l*px*py*pz*fr;
        if(!Number.isFinite(expected)||expected<=0){ g.width=g.height=1; g.layers=1; g.patternX=g.patternY=g.patternZ=1; g.frames=1; g.sprites=[0]; continue; }
        if(expected>maxTotalSprites){ const scale=Math.ceil(expected/safeCap); g.frames=Math.max(1, Math.floor(fr/scale)); }
        const exp=g.width*g.height*g.layers*g.patternX*g.patternY*g.patternZ*g.frames;
        const sp=Array.isArray(g.sprites)?g.sprites:[]; if(sp.length<exp){ for(let i=sp.length;i<exp;i++) sp.push(0); } else if(sp.length>exp){ sp.length=exp; }
        g.sprites=sp;
      }
    };
    for(let i=this.itemStartId;i<this.items.length;i++) fix(this.items[i]);
    for(let i=1;i<this.outfits.length;i++) fix(this.outfits[i]);
    for(let i=1;i<this.effects.length;i++) fix(this.effects[i]);
    for(let i=1;i<this.missiles.length;i++) fix(this.missiles[i]);
  }

  toBinary(options={}){
    const prefs={...this.exportOptions,...options};
    try{ this.normalizeGroups(this.maxSpriteCountSanity||2000000,4096); }catch{}

    const out=[]; const w8=v=>out.push(v&0xFF); const w16=v=>{ out.push(v&0xFF,(v>>8)&0xFF); }; const w32=v=>{ out.push(v&0xFF,(v>>8)&0xFF,(v>>16)&0xFF,(v>>24)&0xFF); };
    const signature=(prefs.signatureOverride ?? this.signature)>>>0;

    w32(signature); w16(this.itemCount|0); w16(this.outfitCount|0); w16(this.effectCount|0); w16(this.missileCount|0);

    const writeGroup=(g,isOutfit,index)=>{
      g=g||{}; const width=(g.width|0)||1, height=(g.height|0)||1, layers=(g.layers|0)||1;
      const pX=(g.patternX|0)||1, pY=(g.patternY|0)||1, pZ=(g.patternZ|0)||1, frames=(g.frames|0)||1;
      const sprites=Array.isArray(g.sprites)?g.sprites:[]; const exact=(g.exactSize|0)&0xFF;

      if(isOutfit){ const gt=(typeof g.groupType==='number'?g.groupType:index)|0; w8(gt&0xFF); }
      w8(width); w8(height); if (width>1 || height>1) w8(exact);
      w8(layers); w8(pX); w8(pY); w8(pZ); w8(frames);

      if(frames>1 && g.anim){ const a=g.anim; w16(a.min|0); w16(a.max|0); w8(a.unk1|0); w8(a.unk2|0);
        const pfMin=Array.isArray(a.perFrameMin)?a.perFrameMin:new Array(frames).fill(0);
        const pfMax=Array.isArray(a.perFrameMax)?a.perFrameMax:new Array(frames).fill(0);
        for(let i=0;i<frames;i++){ w32(pfMin[i]|0); w32(pfMax[i]|0); }
      }

      const spc=width*height*layers*pX*pY*pZ*frames;
      for(let i=sprites.length;i<spc;i++) sprites[i]=0;
      for(let i=0;i<spc;i++) w32((sprites[i]>>>0));
    };

    const writeThing=(thing)=>{
      if(!thing) return;
      const raw=Array.isArray(thing.__flagBytes)?thing.__flagBytes:null;
      if(raw&&raw.length){ for(const b of raw) w8(b&0xFF); if((raw[raw.length-1]&0xFF)!==0xFF) w8(0xFF); }
      else { const fs=(Array.isArray(thing.flags)?thing.flags.slice():(thing.flags instanceof Set)?[...thing.flags]:[])
              .filter(n=>Number.isFinite(n)&&n>=0&&n<=0xFE).sort((a,b)=>a-b); for(const f of fs) w8(f&0xFF); w8(0xFF); }
      const isOutfit=thing.category==='outfit';
      const groups=(Array.isArray(thing.groups)&&thing.groups.length)?thing.groups:[{width:1,height:1,layers:1,patternX:1,patternY:1,patternZ:1,frames:1,sprites:[0]}];
      if(isOutfit) w8(groups.length);
      for(let i=0;i<groups.length;i++) writeGroup(groups[i],isOutfit,i);
    };

    for(let id=this.itemStartId; id<this.items.length; id++) writeThing(this.items[id]);
    for(let id=1; id<this.outfits.length; id++) writeThing(this.outfits[id]);
    for(let id=1; id<this.effects.length; id++) writeThing(this.effects[id]);
    for(let id=1; id<this.missiles.length; id++) writeThing(this.missiles[id]);

    return new Uint8Array(out);
  }

  _reconcileCounts(){
    this.stats.usedBounds = { ...this.stats.headerCounts };
    const grow=(arr,need)=>{ if(!arr||arr.length<need+1){ const n=new Array(need+1); if(arr) for(let i=0;i<arr.length;i++) n[i]=arr[i]; return n; } return arr; };
    this.items    = grow(this.items,    (this.isRetro ? (this.itemStartId-1+this.itemCount) : this.itemCount));
    this.outfits  = grow(this.outfits,  this.outfitCount);
    this.effects  = grow(this.effects,  this.effectCount);
    this.missiles = grow(this.missiles, this.missileCount);

    const countFrom=(arr,start)=>{ if(!arr||!arr.length) return 0; let c=0; for(let i=start;i<arr.length;i++) if(arr[i]) c++; return c; };
    this.stats.parsed = {
      items:   countFrom(this.items, this.itemStartId),
      outfits: countFrom(this.outfits, 1),
      effects: countFrom(this.effects, 1),
      missiles:countFrom(this.missiles, 1)
    };
  }

  getThing(cat,id){
    const list = (cat==='outfit')?this.outfits:(cat==='effect')?this.effects:(cat==='missile')?this.missiles:this.items;
    id=id|0; return (list && id>=0 && id<list.length) ? list[id] : null;
  }
}

export { DatParser };
