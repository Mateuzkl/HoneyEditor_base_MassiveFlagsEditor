// dat.flags.js — Módulo de Flags DAT 7.4 → 12.86 (compacto y sin dependencias)
// Público: window.DAT_EDITOR  |  Compatibilidad: LEGACY por defecto (sin 0xFC,0xFD,0x15)

// =============================
// 1) Definiciones y utilidades
// =============================
const $ = (id) => document.getElementById(id);
const clampU8  = v => Math.max(0, Math.min(255,   v|0));
const clampU16 = v => Math.max(0, Math.min(0xFFFF,v|0));
const clampU24 = v => Math.max(0, Math.min(0xFFFFFF, Number(v)|0));

function extendedFlagsAllowed() {
  return !!(window && window.DAT_EXPORT_EXTENDED);
}

// --- ATTR: Mapeo de nombres a bits/códigos ---
// CAMBIO: Usar 'var' para poder extender el objeto desde módulos externos (Custom Flags)
var ATTR = {
  ground:0, groundBorder:1, onBottom:2, onTop:3, container:4, stackable:5, forceUse:6, multiUse:7,
  writable:8, writableOnce:9, fluidContainer:10, splash:11, unpassable:12, unmoveable:13,
  blockMissile:14, blockPathfind:15, pickupable:16, hangable:17, hookVertical:18, hookHorizontal:19,
  rotateable:20,
  // 21 se deja libre/undefined si no se usa
  light:22, dontHide:23, translucent:24, displacement:25, elevation:26,
  lyingObject:27, animateAlways:28, automap:29, lensHelp:30, fullGround:31, ignoreLook:32,
  cloth:33, market:34, defaultAction:35, wrapable:36, unwrapable:37, topEffect:38,
  usable:39, spriteId:40, hasCharges:41, floorChange:42, /* 43 reserved */ isAnimation:44
};

// Catálogo de flags UI
// CAMBIO: Usar 'var' para poder extender el array desde módulos externos (Custom Flags)
var FLAG_DEFS = [
  { key:'ground',        attr:ATTR.ground,        label:'Es Piso',             group:'core',  type:'u16',     ui:'ground' },
  { key:'groundBorder',  attr:ATTR.groundBorder,  label:'Borde de Piso',       group:'core' },
  { key:'onBottom',      attr:ATTR.onBottom,      label:'Abajo',               group:'core' },
  { key:'onTop',         attr:ATTR.onTop,         label:'Arriba',              group:'core' },
  { key:'fullGround',    attr:ATTR.fullGround,    label:'Piso Completo',       group:'core' },
  { key:'elevation',     attr:ATTR.elevation,     label:'Tiene Elevación',     group:'core',  type:'u16',     ui:'elevation' },
  { key:'displacement',  attr:ATTR.displacement,  label:'Desplazamiento',      group:'core',  type:'vec2u16', ui:'offset' },

  { key:'container',     attr:ATTR.container,     label:'Contenedor',          group:'use' },
  { key:'stackable',     attr:ATTR.stackable,     label:'Apilable',            group:'use' },
  { key:'forceUse',      attr:ATTR.forceUse,      label:'Forzar Uso',          group:'use' },
  { key:'multiUse',      attr:ATTR.multiUse,      label:'Multi Uso',           group:'use' },
  { key:'usable',        attr:ATTR.usable,        label:'Usable',              group:'use' },

  { key:'fluidContainer',attr:ATTR.fluidContainer,label:'Contenedor de Fluido',group:'fluid' },
  { key:'splash',        attr:ATTR.splash,        label:'Fluido',              group:'fluid' },

  { key:'unpassable',    attr:ATTR.unpassable,    label:'Intransitable',       group:'phys' },
  { key:'unmoveable',    attr:ATTR.unmoveable,    label:'Inamovible',          group:'phys' },
  { key:'blockMissile',  attr:ATTR.blockMissile,  label:'Bloquea Misiles',     group:'phys' },
  { key:'blockPathfind', attr:ATTR.blockPathfind, label:'Bloquea Pathfinder',  group:'phys' },

  { key:'writable',      attr:ATTR.writable,      label:'Escribible',          group:'write', type:'u16',     ui:'writable' },
  { key:'writableOnce',  attr:ATTR.writableOnce,  label:'Escribible Una Vez',  group:'write', type:'u16',     ui:'writable' },

  { key:'hangable',      attr:ATTR.hangable,      label:'Colgable',            group:'hooks' },
  { key:'hookSouth',     attr:ATTR.hookSouth,     label:'Gancho Horizontal',   group:'hooks' },
  { key:'hookEast',      attr:ATTR.hookEast,      label:'Gancho Vertical',     group:'hooks' },
  { key:'rotateable',    attr:ATTR.rotateable,    label:'Rota ble',            group:'hooks' },

  { key:'light',         attr:ATTR.light,         label:'Tiene Luz',           group:'visual', type:'light',  ui:'light' },
  { key:'translucent',   attr:ATTR.translucent,   label:'Translúcido',         group:'visual' },
  { key:'dontHide',      attr:ATTR.dontHide,      label:'Siempre Visible',     group:'visual' },
  { key:'animateAlways', attr:ATTR.animateAlways, label:'Objeto en Reposo',    group:'visual' },
  { key:'automap',       attr:ATTR.automap,       label:'Automapa',            group:'visual', type:'u16',    ui:'automap' },
  { key:'ignoreLook',    attr:ATTR.ignoreLook,    label:'Ignorar Vista',       group:'visual' },
  { key:'topEffect',     attr:ATTR.topEffect,     label:'Animación Sin Movimiento', group:'visual' },

  { key:'pickupable',    attr:ATTR.pickupable,    label:'Recogible',           group:'meta' },
  { key:'lyingObject',   attr:ATTR.lyingObject,   label:'Lying Object',        group:'meta' },
  { key:'cloth',         attr:ATTR.cloth,         label:'Equipo (cloth slot)', group:'meta',   type:'u8' },
  { key:'wrapable',      attr:ATTR.wrapable,      label:'Wrappable',           group:'meta' },
  { key:'unwrapable',    attr:ATTR.unwrapable,    label:'Unwrappable',         group:'meta' },
  { key:'lensHelp',      attr:ATTR.lensHelp,      label:'Lente de Ayuda',      group:'meta',   type:'u16' },

  { key:'hasCharges',    attr:ATTR.hasCharges,    label:'Tiene Cargas',        group:'meta' },
  { key:'floorChange',   attr:ATTR.floorChange,   label:'Cambio de Piso',      group:'meta' },
  { key:'spriteId',      attr:ATTR.spriteId,      label:'Sprite Id',           group:'meta',   type:'u32' },
  { key:'isAnimation',   attr:ATTR.isAnimation,   label:'Es Animación',        group:'meta' }
];

const BY_KEY  = Object.fromEntries(FLAG_DEFS.map(f => [f.key,  f]));
const BY_ATTR = Object.fromEntries(FLAG_DEFS.map(f => [f.attr, f]));

// --- CODE2KEY: Mapeo inverso ---
// CAMBIO: Usar 'var' para poder extender el array desde módulos externos (Custom Flags)
var CODE2KEY = [];
// fill known indices per your list (sparse array)
CODE2KEY[0]  = 'ground'; CODE2KEY[1]  = 'groundBorder'; CODE2KEY[2]  = 'onBottom'; CODE2KEY[3]  = 'onTop';
CODE2KEY[4]  = 'container'; CODE2KEY[5]  = 'stackable'; CODE2KEY[6]  = 'forceUse'; CODE2KEY[7]  = 'multiUse';
CODE2KEY[8]  = 'writable'; CODE2KEY[9]  = 'writableOnce'; CODE2KEY[10] = 'fluidContainer'; CODE2KEY[11] = 'splash';
CODE2KEY[12] = 'unpassable'; CODE2KEY[13] = 'unmoveable'; CODE2KEY[14] = 'blockMissile'; CODE2KEY[15] = 'blockPathfind';
CODE2KEY[16] = 'pickupable'; CODE2KEY[17] = 'hangable'; CODE2KEY[18] = 'hookVertical'; CODE2KEY[19] = 'hookHorizontal';
CODE2KEY[20] = 'rotateable';
// 21 intentionally left undefined if unknown
CODE2KEY[22] = 'light'; CODE2KEY[23] = 'dontHide'; CODE2KEY[24] = 'translucent'; CODE2KEY[25] = 'displacement';
CODE2KEY[26] = 'elevation'; CODE2KEY[27] = 'lyingObject'; CODE2KEY[28] = 'animateAlways'; CODE2KEY[29] = 'automap';
CODE22KEY[30] = 'lensHelp'; CODE2KEY[31] = 'fullGround'; CODE2KEY[32] = 'ignoreLook'; CODE2KEY[33] = 'cloth';
CODE2KEY[34] = 'market'; CODE2KEY[35] = 'defaultAction'; CODE2KEY[36] = 'wrapable'; CODE2KEY[37] = 'unwrapable';
CODE2KEY[38] = 'topEffect'; CODE2KEY[39] = 'usable'; CODE2KEY[40] = 'spriteId'; CODE2KEY[41] = 'hasCharges';
CODE2KEY[42] = 'floorChange'; // 43 reserved
CODE2KEY[44] = 'isAnimation';

// mapear los códigos extendidos del DAT a claves reconocibles por la UI también
CODE2KEY[0xFC] = 'hasCharges';
CODE2KEY[0xFD] = 'floorChange';
CODE2KEY[0x15] = 'usable'; // Código legado

// =============================
// 2) Modelo por thing (__props)
// =============================
let __lastCopiedProps = null;

function ensureProps(thing){
  if (!thing.__props) thing.__props = { flags:new Set(), values:{} };
  if (!(thing.__props.flags instanceof Set)) {
    const s = new Set(Array.isArray(thing.__props.flags) ? thing.__props.flags : []);
    thing.__props.flags = s;
  }
  if (!thing.__props.values || typeof thing.__props.values!=='object') thing.__props.values = {};
  return thing.__props;
}
function hasFlag(t,k){ return ensureProps(t).flags.has(k); }
function setFlag(t,k,on){ const P=ensureProps(t); on?P.flags.add(k):P.flags.delete(k); t.__rev=(t.__rev|0)+1; return P; }
function setValue(t,k,v){ ensureProps(t).values[k]=v; t.__rev=(t.__rev|0)+1; }
function getValue(t,k,def=0){ const v=ensureProps(t).values[k]; return (v==null)?def:v; }

function syncPropsFromThingFlags(thing){
  const P = ensureProps(thing);
  const arr = flagsToArray(thing.flags);
  P.flags = new Set();
  for (const code of arr){ const key = CODE2KEY[code|0]; if (key) P.flags.add(key); }
  thing.__rev = (thing.__rev|0)+1;
  return P;
}

// =============================
// 3) UI: construcción y binding
// =============================
function buildFlagCheckboxes(){
  const box = $('flagCheckboxes'); if(!box) return;
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  FLAG_DEFS.forEach(def=>{
    // Ignorar definiciones sin un atributo válido (como las flags extendidas no mapeadas)
    if (typeof def.attr !== 'number') return;
    // La clave es el nombre, el atributo es el código. Usamos el nombre como ID.
    const id = `flag_${def.key}`;
    const wrap = document.createElement('label');
    // Si es una flag personalizada, la marcamos
    if (def.group === 'custom') wrap.title = `Flag Custom: 0x${def.attr.toString(16).toUpperCase()}`;
    
    wrap.className='checkline';
    wrap.innerHTML = `<input type="checkbox" id="${id}"> ${def.label}`;
    frag.appendChild(wrap);
    wrap.querySelector('input').addEventListener('change', ()=>{
      const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
      if(!t) return;
      setFlag(t, def.key, wrap.querySelector('input').checked);
      renderExtrasFromThing(t);
    }, {passive:true});
  });
  box.appendChild(frag);
}

function buildFlagSelectors(){
  const sel1 = $('batchFlagSelect'); const sel2 = $('flagFilter');
  const options = FLAG_DEFS.map(d=>`<option value="${d.key}">${d.label}</option>`).join('');
  if(sel1){ sel1.innerHTML = options; }
  if(sel2){ sel2.innerHTML = `<option value="">(todos)</option>` + options; }
}


// =============================
// 3.1) Helpers de color (HSI + 8-bit)
// =============================

// Conversión HSI a RGB (simplificada)
function hsiToRgb(h, s, i) {
  if (s == 0) return [i, i, i];
  h = (h % 240) / 240 * 360; // h en grados (0-360)
  s /= 255; i /= 255;
  let r, g, b;
  if (h < 120) {
    r = i * (1 + s * Math.cos(h * Math.PI / 180) / Math.cos((60 - h) * Math.PI / 180));
    g = i * (1 + s * (1 - Math.cos(h * Math.PI / 180) / Math.cos((60 - h) * Math.PI / 180)));
    b = i * (1 - s);
  } else if (h < 240) {
    h -= 120;
    r = i * (1 - s);
    g = i * (1 + s * Math.cos(h * Math.PI / 180) / Math.cos((60 - h) * Math.PI / 180));
    b = i * (1 + s * (1 - Math.cos(h * Math.PI / 180) / Math.cos((60 - h) * Math.PI / 180)));
  } else {
    h -= 240;
    r = i * (1 + s * (1 - Math.cos(h * Math.PI / 180) / Math.cos((60 - h) * Math.PI / 180)));
    g = i * (1 - s);
    b = i * (1 + s * Math.cos(h * Math.PI / 180) / Math.cos((60 - h) * Math.PI / 180));
  }
  return [clampU8(r * 255), clampU8(g * 255), clampU8(b * 255)];
}

// Empaquetar HSI (H: 0-240, S/I: 0-255) en un byte (H[5bits] | S[1bit] | I[2bits]) - simplificado
function packLightColor(h, s, i) {
  h = clampU8(h) / 240 * 31; // 0-31
  s = (clampU8(s) > 127) ? 1 : 0;
  i = clampU8(i) / 255 * 3; // 0-3
  return (h << 3) | (s << 2) | i;
}

// Desempaquetar 8-bit color
function parseLightColor(v) {
  v = clampU8(v);
  const h = (v >> 3) & 0x1F; // 5 bits (0-31) -> 0-240
  const s = (v >> 2) & 0x01; // 1 bit (0 o 1) -> 0 o 255
  const i = v & 0x03;        // 2 bits (0-3) -> 0-255
  return {
    h: (h / 31) * 240, // HSI H (0-240)
    s: s * 255,        // HSI S (0-255)
    i: (i / 3) * 255   // HSI I (0-255)
  };
}

// =============================
// 3.2) Extras visibles y valores
// =============================

function renderExtrasFromThing(thing) {
  const P = ensureProps(thing);
  const keys = ['light','displacement','elevation','writable','automap','cloth','lensHelp'];
  
  keys.forEach(key => {
    const extraBox = $(`extra_${key}`);
    if (!extraBox) return;
    const def = BY_KEY[key];
    const isChecked = hasFlag(thing, key);
    
    // Visibilidad del panel
    extraBox.style.display = isChecked ? 'block' : 'none';
    
    // Actualizar valores de los inputs
    if (isChecked && def?.ui) {
      const v = getValue(thing, key);
      switch(def.ui) {
        case 'ground': 
          $('groundSpeed').value = clampU16(v); break;
        case 'offset':
          $('offsetX').value = clampU16(v?.x || 0); 
          $('offsetY').value = clampU16(v?.y || 0); break;
        case 'elevation':
          $('elevation').value = clampU16(v); break;
        case 'writable':
          $('maxTextLen').value = clampU16(v); break;
        case 'light': {
          const {h, s, i} = parseLightColor(v?.color || 0);
          $('lightIntensity').value = clampU8(v?.intensity || 0);
          $('lightColor').value = clampU8(v?.color || 0);
          const [r, g, b] = hsiToRgb(h, s, i);
          $('lightColorPreview').style.backgroundColor = `rgb(${r},${g},${b})`;
          break;
        }
        case 'automap':
          $('automapColor').value = clampU24(v); break;
        case 'cloth':
          $('clothSlot').value = clampU8(v); break;
        case 'lensHelp':
          $('lensHelp').value = clampU16(v); break;
      }
    }
  });
}

function renderThing(thing, category) {
  window.currentCategory = category;
  window.currentThingId = thing.id;

  // Sincronizar Flags (para el caso de que la fuente sea un array)
  syncPropsFromThingFlags(thing);
  
  // 1. Actualizar Checkboxes
  FLAG_DEFS.forEach(def => {
    const input = $(`flag_${def.key}`);
    if (input) input.checked = hasFlag(thing, def.key);
  });
  
  // 2. Actualizar Valores Extra (incluye visibilidad)
  renderExtrasFromThing(thing);
}

// =============================
// 4) Encoder de flags (puente + writer)
// =============================
// Conversión/normalización (restaurado robusto)
function bitmaskToArray(mask){ mask=Number(mask)>>>0; const out=[]; for(let i=0;i<32;i++) if(mask&(1<<i)) out.push(i); return out; }
function arrayToBitmask(arr){ if(!Array.isArray(arr))return 0; let m=0; for(const v of arr){ const n=Number(v)|0; if(!Number.isNaN(n)&&n>=0&&n<32) m|=(1<<n);} return m>>>0; }
function flagsToArray(flags){
  if (flags == null) return [];
  if (flags instanceof Set) flags = Array.from(flags);
  if (Array.isArray(flags)) {
    const out=[]; for(const v of flags){
      if (v==null) continue;
      if (typeof v==='number' && !Number.isNaN(v)) out.push(v|0);
      else if (typeof v==='string'){
        const s=v.trim(); if(!s) continue;
        const def=BY_KEY[s] || BY_KEY[s.toLowerCase()];
        if (def) out.push(def.attr);
        else if (/^0x[0-9a-f]+$/i.test(s)){ const n=parseInt(s,16); out.push(...(n>31?bitmaskToArray(n):[n])); }
        else if (/^\d+$/.test(s)) out.push(parseInt(s,10));
      }
    }
    return Array.from(new Set(out)).filter(n=>Number.isFinite(n)&&n>=0&&n<256);
  }
  if (typeof flags==='number') return bitmaskToArray(flags);
  if (typeof flags==='string'){ const tokens=flags.trim().split(/[,;\s]+/).filter(Boolean); return flagsToArray(tokens); }
  if (typeof flags==='object'){
    const keys=Object.keys(flags); const allNum=keys.length>0 && keys.every(k=>/^\d+$/.test(k)); const out=[];
    if (allNum){ for(const k of keys) if(flags[k]) out.push(Number(k)|0); }
    else { for(const k in flags){ if(!Object.prototype.hasOwnProperty.call(flags,k)) continue; if(!flags[k]) continue; const d=BY_KEY[k]||BY_KEY[k.toLowerCase()]; if(d) out.push(d.attr); } }
    return Array.from(new Set(out)).filter(n=>Number.isFinite(n)&&n>=0&&n<256);
  }
  return [];
}

// Bytes helpers
function writeUint8(bytes,v){ bytes.push(v&0xFF); }
function writeUint16LE(bytes,v){ v=v|0; bytes.push(v&0xFF,(v>>8)&0xFF); }
function writeStringISO88591(bytes,s){ if(!s) return; for(let i=0;i<s.length;i++) bytes.push(s.charCodeAt(i)&0xFF); }

// --- Constantes C ---
const C = {
  GROUND:0x00, GROUND_BORDER:0x01, ON_BOTTOM:0x02, ON_TOP:0x03, CONTAINER:0x04, STACKABLE:0x05, FORCE_USE:0x06, MULTI_USE:0x07,
  WRITABLE:0x08, WRITABLE_ONCE:0x09, FLUID_CONTAINER:0x0A, SPLASH:0x0B, UNPASSABLE:0x0C, UNMOVEABLE:0x0D,
  BLOCK_MISSILE:0x0E, BLOCK_PATHFIND:0x0F, PICKUPABLE:0x10, HANGABLE:0x11, HOOK_VERTICAL:0x12, HOOK_HORIZONTAL:0x13,
  ROTATEABLE:0x14,
  // 0x15: USABLE (Usado en el editor)
  LIGHT:0x16, DONT_HIDE:0x17, TRANSLUCENT:0x18, DISPLACEMENT:0x19, ELEVATION:0x1A,
  LYING_OBJECT:0x1B, ANIMATE_ALWAYS:0x1C, AUTOMAP:0x1D, LENS_HELP:0x1E, FULL_GROUND:0x1F, IGNORE_LOOK:0x20,
  CLOTH:0x21, MARKET:0x22, DEFAULT_ACTION:0x23, WRAPABLE:0x24, UNWRAPABLE:0x25, TOP_EFFECT:0x26,
  // Flags extendidas (fuera del rango 0x00-0x20)
  USABLE:0x15, // Reemplazo por el índice 39
  HAS_CHARGES:0xFC, FLOOR_CHANGE:0xFD,
  LAST_FLAG:0xFF
};

// --- UPDATE: hasFlagFromThing para nuevos códigos (mínimos) ---
function hasFlagFromThing(thing, flagCode, flagsSet){
  // Legacy flag check
  switch(flagCode){
    case C.GROUND: return !!thing.ground;
    case C.GROUND_BORDER: return !!thing.groundBorder;
    case C.ON_BOTTOM: return !!thing.onBottom;
    case C.ON_TOP: return !!thing.onTop;
    case C.CONTAINER: return !!thing.container;
    case C.STACKABLE: return !!thing.stackable;
    case C.FORCE_USE: return !!thing.forceUse;
    case C.MULTI_USE: return !!thing.multiUse;
    case C.WRITABLE: return !!thing.writable;
    case C.WRITABLE_ONCE: return !!thing.writableOnce;
    case C.FLUID_CONTAINER: return !!thing.fluidContainer;
    case C.SPLASH: return !!thing.splash;
    case C.UNPASSABLE: return !!thing.unpassable;
    case C.UNMOVEABLE: return !!thing.unmoveable;
    case C.BLOCK_MISSILE: return !!thing.blockMissile;
    case C.BLOCK_PATHFIND: return !!thing.blockPathfind;
    case C.PICKUPABLE: return !!thing.pickupable;
    case C.HANGABLE: return !!thing.hangable;
    case C.HOOK_VERTICAL: return !!thing.hookVertical;
    case C.HOOK_HORIZONTAL: return !!thing.hookHorizontal;
    case C.ROTATEABLE: return !!thing.rotateable;
    case C.LIGHT: return !!thing.light;
    case C.DONT_HIDE: return !!thing.dontHide;
    case C.TRANSLUCENT: return !!thing.translucent;
    case C.DISPLACEMENT: return !!thing.displacement;
    case C.ELEVATION: return !!thing.elevation;
    case C.LYING_OBJECT: return !!thing.lyingObject;
    case C.ANIMATE_ALWAYS: return !!thing.animateAlways;
    case C.AUTOMAP: return !!thing.automap;
    case C.LENS_HELP: return !!thing.lensHelp;
    case C.FULL_GROUND: return !!thing.fullGround;
    case C.IGNORE_LOOK: return !!thing.ignoreLook;
    case C.CLOTH: return !!thing.cloth;
    case C.MARKET: return !!thing.market;
    case C.DEFAULT_ACTION: return !!thing.defaultAction;
    case C.WRAPABLE: return !!thing.wrapable;
    case C.UNWRAPABLE: return !!thing.unwrapable;
    case C.TOP_EFFECT: return !!thing.topEffect;
    // EXTENDED/CUSTOM FLAGS
    case C.HAS_CHARGES: return !!thing.hasCharges;
    case C.FLOOR_CHANGE: return !!thing.floorChange;
    case C.USABLE: return !!thing.usable;
    default: return flagsSet.has(flagCode); // NUEVO: Si no está en la lista hardcodeada, verificamos en el Set
  }
}

// Writer binario (LEGACY-safe)
function encodeFlagsInternal(thing){
  const P = ensureProps(thing);
  const flagsSet = new Set();
  P.flags.forEach(k => { const d = BY_KEY[k]; if(d) flagsSet.add(d.attr); });

  const bytes = [];
  const allowExt = extendedFlagsAllowed();
  
  // 1. Escribir flags binarias (0x00 a 0x20)
  let binFlags = 0;
  for(let i=0; i<=32; i++){
    if(flagsSet.has(i) || hasFlagFromThing(thing, i, flagsSet)) {
      if(i <= 31) binFlags |= (1 << i);
    }
  }
  writeUint32LE(bytes, binFlags);

  // 2. Escribir valores extra (Ground, Offset, Elevation, Writable, Light, Automap, Cloth, LensHelp)
  // [GroundSpeed]
  if(hasFlagFromThing(thing, C.GROUND, flagsSet)) writeUint16LE(bytes, getValue(thing, 'groundSpeed'));
  // [Displacement]
  if(hasFlagFromThing(thing, C.DISPLACEMENT, flagsSet)){
    const v=getValue(thing, 'displacement',{x:0,y:0}); writeUint16LE(bytes, v.x); writeUint16LE(bytes, v.y);
  }
  // [Elevation]
  if(hasFlagFromThing(thing, C.ELEVATION, flagsSet)) writeUint16LE(bytes, getValue(thing, 'elevation'));
  // [Writable]
  if(hasFlagFromThing(thing, C.WRITABLE, flagsSet) || hasFlagFromThing(thing, C.WRITABLE_ONCE, flagsSet)) writeUint16LE(bytes, getValue(thing, 'maxTextLen'));
  // [Light]
  if(hasFlagFromThing(thing, C.LIGHT, flagsSet)){
    const v = getValue(thing, 'light'); writeUint8(bytes, v.intensity|0); writeUint8(bytes, v.color|0);
  }
  // [Automap]
  if(hasFlagFromThing(thing, C.AUTOMAP, flagsSet)) writeUint24LE(bytes, getValue(thing, 'automapColor'));
  // [Cloth]
  if(hasFlagFromThing(thing, C.CLOTH, flagsSet)) writeUint8(bytes, getValue(thing, 'clothSlot'));
  // [LensHelp]
  if(hasFlagFromThing(thing, C.LENS_HELP, flagsSet)) writeUint16LE(bytes, getValue(thing, 'lensHelp'));
  
  // 3. Escribir Flags Extendidas/Custom
  // ---- Flags EXTENDIDAS (solo si allowExt = true) ----
  if (allowExt) {
    if (hasFlagFromThing(thing, C.HAS_CHARGES, flagsSet)) writeUint8(bytes, C.HAS_CHARGES);
    if (hasFlagFromThing(thing, C.FLOOR_CHANGE, flagsSet)) writeUint8(bytes, C.FLOOR_CHANGE);
    if (hasFlagFromThing(thing, C.USABLE, flagsSet)) writeUint8(bytes, C.USABLE);

    // NUEVO: Escribir cualquier otra flag custom no mapeada
    const writtenCodes = new Set(bytes);
    flagsSet.forEach(code => {
        // Asume que los códigos >= 0x27 (40) hasta 0xFF deben escribirse como byte, si no fueron escritos ya.
        if (!writtenCodes.has(code) && code >= 0x27 && code <= 0xFF) {
            writeUint8(bytes, code);
        }
    });
  }
  // ----------------------------------------------------

  writeUint8(bytes, C.LAST_FLAG);
  return bytes;
}

// Puente expuesto (ÚNICO)
function encodeFlags(thing, datSignature /*unused*/){
  const P = ensureProps(thing);
  // Transformar de __props.flags (Set<string>) a thing.flags (Array<number>)
  thing.flags = flagsToArray(P.flags);
  // Las propiedades de valor ya están en thing.__props.values
  
  // Asumir DAT_EXPORT_EXTENDED es una variable global o una propiedad del editor.
  if (window.DAT_EXPORT_EXTENDED) {
    // Si se permite la exportación extendida, usamos el codificador moderno
    return encodeFlagsInternal(thing);
  } else {
    // Si no, forzamos compatibilidad legacy (solo bitmask 32)
    const mask = arrayToBitmask(thing.flags);
    // Simulación de escritura binaria para Legacy:
    const bytes = [];
    writeUint32LE(bytes, mask);
    writeUint8(bytes, C.LAST_FLAG);
    return bytes;
  }
}

// =============================
// 5) Render y acciones (UI)
// =============================

function copyFlags(){
  const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
  if (!t) return;
  __lastCopiedProps = JSON.parse(JSON.stringify(ensureProps(t)));
}

function pasteFlags(){
  const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
  if (!t || !__lastCopiedProps) return;

  const P = ensureProps(t);
  P.flags = new Set(__lastCopiedProps.flags);
  P.values = JSON.parse(JSON.stringify(__lastCopiedProps.values));
  
  renderThing(t, window.currentCategory);
}

function clearFlags(){
  const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
  if (!t) return;
  const P = ensureProps(t);
  P.flags.clear();
  P.values = {};
  renderThing(t, window.currentCategory);
}

function resetAllFlags(){
  // [Omitido por ser idéntico a clearFlags en la práctica si no hay datos persistentes]
  clearFlags(); 
}

function applyFlagsFromText(){
  // Obtener el thing actual
  const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
  if (!t) return;
  
  // 1. Obtener los valores de los inputs extra
  const P = ensureProps(t);
  
  // Ground Speed
  setValue(t, 'groundSpeed', parseInt($('groundSpeed')?.value || 0, 10));
  // Displacement (Offset)
  setValue(t, 'displacement', { 
    x: parseInt($('offsetX')?.value || 0, 10), 
    y: parseInt($('offsetY')?.value || 0, 10) 
  });
  // Elevation
  setValue(t, 'elevation', parseInt($('elevation')?.value || 0, 10));
  // Max Text Len (Writable)
  setValue(t, 'maxTextLen', parseInt($('maxTextLen')?.value || 0, 10));
  // Light
  setValue(t, 'light', {
    intensity: parseInt($('lightIntensity')?.value || 0, 10),
    color: parseInt($('lightColor')?.value || 0, 10)
  });
  // Automap Color
  setValue(t, 'automapColor', parseInt($('automapColor')?.value || 0, 10));
  // Cloth Slot
  setValue(t, 'clothSlot', parseInt($('clothSlot')?.value || 0, 10));
  // Lens Help
  setValue(t, 'lensHelp', parseInt($('lensHelp')?.value || 0, 10));
  
  // 2. Renderizar extras para actualizar la vista (especialmente la luz)
  renderExtrasFromThing(t);
  
  // 3. Notificar al editor principal para que actualice la vista (si existe)
  if (window.DAT_EDITOR && typeof window.DAT_EDITOR._updateCurrentThing === 'function') {
      window.DAT_EDITOR._updateCurrentThing();
  }
}

function addFlagManual(){
  // Simplemente muestra un prompt básico (sustituido por el modal en el Bulk Editor)
  const flagCode = prompt("Ingresa el código de la flag (ej: 0x22, 34):");
  if (!flagCode) return;
  
  let code = 0;
  if (flagCode.toLowerCase().startsWith('0x')) code = parseInt(flagCode, 16);
  else code = parseInt(flagCode, 10);
  
  const key = CODE2KEY[code];
  if (!key) {
    alert(`Flag 0x${code.toString(16).toUpperCase()} no reconocida.`);
    return;
  }
  
  const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
  if (!t) return;
  setFlag(t, key, true);
  renderThing(t, window.currentCategory);
}

function filterFlags(){
  const q = ($('flagSearch')?.value||'').trim().toLowerCase();
  document.querySelectorAll('#flagCheckboxes label.checkline').forEach(el=>{
    const txt=el.textContent.toLowerCase();
    el.style.display=(!q||txt.includes(q))?'':'none';
  });
}

function applyBatchFlag(){
  const key = $('batchFlagSelect')?.value;
  const action = $('batchFlagAction')?.value;
  if (!key || !action) return;
  
  const t = window.dat?.getThing?.(window.currentCategory||'item', window.currentThingId|0);
  if (!t) return;
  
  if (action === 'add') setFlag(t, key, true);
  if (action === 'remove') setFlag(t, key, false);
  
  renderThing(t, window.currentCategory);
}

// =============================
// 6) API pública (ÚNICA) + auto-init
// =============================

// NUEVO: Función para que módulos externos puedan registrar flags en la UI de DAT.
function registerCustomFlag(opcode, name, label, group='custom'){
  const code = Number(opcode) | 0;
  if (code < 0 || code > 255) return false;
  
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalizar nombre a una clave
  if (!key) return false;

  // 1. Añadir/Sobrescribir en ATTR (Map: name -> bit)
  ATTR[key] = code;

  // 2. Añadir/Sobrescribir en CODE2KEY (Map: bit -> name)
  CODE2KEY[code] = key;

  // 3. Añadir/Sobrescribir en FLAG_DEFS (UI definition)
  const existingDefIndex = FLAG_DEFS.findIndex(d => d.key === key || d.attr === code);
  const newDef = {
    key: key, 
    attr: code, 
    label: label, 
    group: group, 
    type: null, 
    ui: null 
  };
  
  if (existingDefIndex !== -1) {
      FLAG_DEFS[existingDefIndex] = newDef;
  } else {
      FLAG_DEFS.push(newDef);
  }
  
  // 4. Regenerar UI
  buildFlagCheckboxes();
  buildFlagSelectors();

  // 5. Reconstruir lookups (BY_KEY y BY_ATTR)
  Object.assign(BY_KEY, Object.fromEntries(FLAG_DEFS.map(f => [f.key,  f])));
  Object.assign(BY_ATTR, Object.fromEntries(FLAG_DEFS.map(f => [f.attr, f])));

  return true;
}


const __DAT_EDITOR_API__ = {
  init(){
    buildFlagCheckboxes();
    buildFlagSelectors();
    // Bind acciones
    window.copyFlags = copyFlags;
    window.pasteFlags = pasteFlags;
    window.clearFlags = clearFlags;
    window.resetAllFlags = resetAllFlags;
    window.applyFlagsFromText = applyFlagsFromText;
    window.addFlagManual = addFlagManual;
    window.filterFlags = filterFlags;
    window.applyBatchFlag = applyBatchFlag;
    // Hook inputs de valores
    const hook = id => $(id)?.addEventListener('input', ()=>applyFlagsFromText(), {passive:true});
    ['groundSpeed','offsetX','offsetY','elevation','maxTextLen',
     'lightIntensity','lightColor','automapColor','clothSlot','lensHelp'].forEach(hook);
  },
  render: renderThing,
  hasFlag,
  encodeFlags,
  _renderDynamicExtras: renderExtrasFromThing,
  syncPropsFromThingFlags,
  // EXPORTACIONES PARA EL BULK EDITOR
  bitmaskToArray,
  arrayToBitmask,
  flagsToArray,
  // NUEVO: Función de registro de flags custom
  registerCustomFlag
};

// Helper: Escribir 32-bit (faltaba en la definición anterior)
function writeUint32LE(bytes,v){ v=v|0; bytes.push(v&0xFF,(v>>8)&0xFF,(v>>16)&0xFF,(v>>24)&0xFF); }
// Helper: Escribir 24-bit (faltaba en la definición anterior)
function writeUint24LE(bytes,v){ v=v|0; bytes.push(v&0xFF,(v>>8)&0xFF,(v>>16)&0xFF); }

(function(){
  if (typeof window === 'undefined') return;
  window.DAT_EDITOR = Object.assign(window.DAT_EDITOR || {}, __DAT_EDITOR_API__);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>window.DAT_EDITOR.init(), {once:true});
  } else {
    window.DAT_EDITOR.init();
  }
})();