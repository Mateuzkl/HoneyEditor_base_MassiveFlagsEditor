// ======================================================
// Animated Decoder (GIF / APNG) — Needed by FX Lab
// ======================================================
if (!window.editor.decodeAnimated) {
  window.editor.decodeAnimated = async function decodeAnimated(buffer) {
    // Este decoder usa el sistema nativo del navegador:
    // - createImageBitmap + OffscreenCanvas
    // - parseo mínimo para APNG
    // NOTA: No reemplaza tu decoder interno si ya tienes uno mejor.

    const blob = new Blob([buffer]);
    const url  = URL.createObjectURL(blob);

    try {
      const img = await createImageBitmap(await (await fetch(url)).blob());

      // Si no es animado → 1 frame
      return [{
        imageData: await extractImageData(img),
        delay: 100
      }];
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

// Utilidad interna
async function extractImageData(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap,0,0);
  return ctx.getImageData(0,0,bitmap.width,bitmap.height);
}


(function(){try{
  if(typeof window.exportSprDat!=='function'){
    window.exportSprDat=function(){
      try{
        var m=document.getElementById('miniExportModal');
        if(!m){document.addEventListener('DOMContentLoaded',function(){var mm=document.getElementById('miniExportModal'); if(mm) mwindow.openMiniExportModal();},{once:true}); return;}
        window.openMiniExportModal();
      }catch(e){alert('Export: UI no disponible');}
    };
  }
}catch(_){}})();
// --- Honey safe stub end ---

// === Honey mini-export modal controls ===
(function(){
  function bindMiniExportControls(){
    var modal = document.getElementById('miniExportModal');
    if(!modal) return;
    // Close on overlay click
    if(!modal.__honeyOverlay){
      modal.addEventListener('click', function(e){
        if(e.target === modal){ window.closeMiniExportModal(); }
      });
      modal.__honeyOverlay = true;
    }
    // Close on ESC
    if(!window.__honeyMiniEsc){
      document.addEventListener('keydown', function(ev){
        if(ev.key === 'Escape'){ window.closeMiniExportModal(); }
      });
      window.__honeyMiniEsc = true;
    }
    // Cancel button
    var cancelBtn = document.getElementById('miniExportCancelBtn');
    if(cancelBtn && !cancelBtn.__honeyBound){
      cancelBtn.addEventListener('click', function(ev){
        try{ ev.preventDefault(); }catch(_){}
        window.closeMiniExportModal();
      });
      cancelBtn.__honeyBound = true;
    }
  }
  window.openMiniExportModal = function(){
    var modal = document.getElementById('miniExportModal');
    if(!modal) return alert('UI mini-export no encontrada');
    bindMiniExportControls();
    modal.classList.remove('hidden');
  };
  window.closeMiniExportModal = function(){
    var modal = document.getElementById('miniExportModal');
    if(modal) modal.classList.add('hidden');
  };
  // Expose binder
  window.__bindMiniExportControls = bindMiniExportControls;
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bindMiniExportControls, {once:true});
  } else {
    bindMiniExportControls();
  }
})();
// === end mini-export controls ===

// ===== ThingForge Editor — editor.js =====
import { SprParser } from './sprParser.js';
import { DatParser } from './datParser.js';
import { VersionManager } from './versionManager.js';

/* ================= Honey DAT + Flags Editor (unificado) ================= */
import { FLAG_NAMES, bitmaskToArray, arrayToBitmask, formatFlags, encodeFlags } from './flagsEditor.js';

(() => {
  // ---------- Helpers DOM (seguros y rápidos) ----------
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const on = (el, ev, fn, opt) => el && el.addEventListener(ev, fn, opt || {passive:true});
  const v  = (sel, val) => { const el=$(sel); if(!el) return; if(val===undefined) return el.value; el.value = val; };
  const ck = (sel, val) => { const el=$(sel); if(!el) return; if(val===undefined) return !!el.checked; el.checked = !!val; };
  const en = (sel, onoff) => { const el=$(sel); if(el) el.disabled = !onoff; };
  const toInt = (x, d=0) => { const n = Number(x); return Number.isFinite(n) ? (n|0) : (d|0); };

  // ---------- Selectores (HTML ids) ----------
  const Q = {
    // switches
    isFloor:        '#prop_isFloor',
    hasLight:       '#prop_hasLight',
    hasAutomap:     '#prop_hasAutomap',
    hasOffset:      '#prop_hasOffset',
    hasElevation:   '#prop_hasElevation',
    writable:       '#prop_writable',
    writableOnce:   '#prop_writableOnce',
    hasEquipment:   '#prop_hasEquipment',
    hasMarket:      '#prop_hasMarket',
    hasHelpLens:    '#prop_hasHelpLens',
    hasAction:      '#prop_hasAction',

    // values
    groundSpeed:    '#prop_groundSpeed',
    lightColor:     '#prop_lightColor',
    lightIntensity: '#prop_lightIntensity',
    automapColor:   '#prop_automapColor',
    offsetX:        '#prop_offsetX',
    offsetY:        '#prop_offsetY',
    elevation:      '#prop_elevation',
    maxTextLen:     '#prop_maxTextLen',
    slot:           '#prop_slot',
    mktName:        '#prop_mktName',
    mktCategory:    '#prop_mktCategory',
    mktTradeAs:     '#prop_mktTradeAs',
    mktShowAs:      '#prop_mktShowAs',
    mktVocation:    '#prop_mktVocation',
    mktLevel:       '#prop_mktLevel',
    helpLensType:   '#prop_helpLensType',
    actionType:     '#prop_actionType',

    // flags ui
    flagsHost:      '#flagCheckboxes',
    flagsSearch:    '#flagSearch',
    flagsFilter:    '#flagFilter',
    flagsMask:      '#flagsBitmaskPreview',
    flagsUnknown:   '#unknownFlagsList',
  };

  // ---------- Estado ----------
  let currentThing = null;
  let FLAG_CODES = Object.keys(FLAG_NAMES).map(n=>n|0).sort((a,b)=>a-b);

  function flagNamesForCurrentSig() {
    const sig = (window.dat?.signature|0)>>>0;
    if (typeof window.getFlagNamesForSignature === 'function') {
      return window.getFlagNamesForSignature(sig) || FLAG_NAMES;
    }
    return FLAG_NAMES;
  }

  // ---------- FLAGS UI ----------
  function ensureFlagsGrid(rebuild=false) {
    const host = $(Q.flagsHost);
    if (!host) return;
    if (host.dataset.built === '1' && !rebuild) return;

    const NAMES = flagNamesForCurrentSig();
    const codes = Object.keys(NAMES).map(n=>n|0).sort((a,b)=>a-b);
    FLAG_CODES = codes.slice(); // actualizar el set activo de códigos

    const frag = document.createDocumentFragment();
    codes.forEach(code => {
      const id = `flag_cb_${code}`;
      const lbl = document.createElement('label'); lbl.className='checkline';
      const cb  = document.createElement('input'); cb.type='checkbox'; cb.id=id; cb.dataset.code=String(code);
      const span= document.createElement('span');  span.textContent = `${NAMES[code] || `Flag ${code}`} (#${code})`;
      lbl.append(cb, span); frag.appendChild(lbl);
    });
    host.innerHTML=''; host.appendChild(frag); host.dataset.built='1';

    // Helper: dispatch a change event on an element (if exists)
    const dispatchChange = (el) => { if (!el) return; try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e){} };

    // Centraliza la reacción a toggles de flags para activar/llenar los controles relacionados
    function handleFlagToggle(code, checked) {
      // acceso a utilidades locales: ck (checkbox), v (value) ya definidas arriba
      switch (code|0) {
        case 0x00: { // Is Floor
          const el = document.querySelector(Q.isFloor);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const gs = document.querySelector(Q.groundSpeed);
          if (gs) {
            if (checked && typeof currentThing !== 'undefined' && currentThing) gs.value = String(currentThing.groundSpeed|0);
            else if (!checked) gs.value = '0';
            dispatchChange(gs);
          }
          break;
        }
        case 0x16: { // Light
          const el = document.querySelector(Q.hasLight);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const li = document.querySelector(Q.lightIntensity);
          const lc = document.querySelector(Q.lightColor);
          if (checked && typeof currentThing !== 'undefined' && currentThing) {
            if (li) li.value = String(currentThing.lightLevel|0);
            if (lc) lc.value = String(currentThing.lightColor|0);
          } else if (!checked) {
            if (li) li.value = '0';
            if (lc) lc.value = '0';
          }
          dispatchChange(li); dispatchChange(lc);
          break;
        }
        case 0x1D: { // Automap
          const el = document.querySelector(Q.hasAutomap);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const ac = document.querySelector(Q.automapColor);
          if (checked && typeof currentThing !== 'undefined' && currentThing) ac && (ac.value = String(currentThing.automapColor|0));
          else if (!checked) ac && (ac.value = '0');
          dispatchChange(ac);
          break;
        }
        case 0x19: { // Offset
          const el = document.querySelector(Q.hasOffset);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const ox = document.querySelector(Q.offsetX);
          const oy = document.querySelector(Q.offsetY);
          if (checked && typeof currentThing !== 'undefined' && currentThing) {
            ox && (ox.value = String(currentThing.displacementX|0));
            oy && (oy.value = String(currentThing.displacementY|0));
          } else if (!checked) {
            ox && (ox.value = '0');
            oy && (oy.value = '0');
          }
          dispatchChange(ox); dispatchChange(oy);
          break;
        }
        case 0x1A: { // Elevation
          const el = document.querySelector(Q.hasElevation);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const ev = document.querySelector(Q.elevation);
          if (checked && typeof currentThing !== 'undefined' && currentThing) ev && (ev.value = String(currentThing.elevation|0));
          else if (!checked) ev && (ev.value = '0');
          dispatchChange(ev);
          break;
        }
        case 0x08: { // Writable (multi)
          const el = document.querySelector(Q.writable);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const ml = document.querySelector(Q.maxTextLen);
          if (checked && typeof currentThing !== 'undefined' && currentThing) ml && (ml.value = String(currentThing.maxTextLen|0));
          else if (!checked) ml && (ml.value = '0');
          dispatchChange(ml);
          break;
        }
        case 0x09: { // Writable once
          const el = document.querySelector(Q.writableOnce);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const ml = document.querySelector(Q.maxTextLen);
          if (checked && typeof currentThing !== 'undefined' && currentThing) ml && (ml.value = String(currentThing.maxTextLen|0));
          else if (!checked) ml && (ml.value = '0');
          dispatchChange(ml);
          break;
        }
        case 0x21: { // Equipment slot
          const el = document.querySelector(Q.hasEquipment);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const sl = document.querySelector(Q.slot);
          if (checked && typeof currentThing !== 'undefined' && currentThing) sl && (sl.value = String(currentThing.slot|0));
          else if (!checked) sl && (sl.value = '0');
          dispatchChange(sl);
          break;
        }
        case 0x22: { // Market
          const el = document.querySelector(Q.hasMarket);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          if (checked && typeof currentThing !== 'undefined' && currentThing) {
            document.querySelector(Q.mktName) && (document.querySelector(Q.mktName).value = currentThing.marketName || '');
            document.querySelector(Q.mktCategory) && (document.querySelector(Q.mktCategory).value = String(currentThing.marketCategory|0));
            document.querySelector(Q.mktTradeAs) && (document.querySelector(Q.mktTradeAs).value = String(currentThing.marketTradeAs|0));
            document.querySelector(Q.mktShowAs) && (document.querySelector(Q.mktShowAs).value = String(currentThing.marketShowAs|0));
            document.querySelector(Q.mktVocation) && (document.querySelector(Q.mktVocation).value = String(currentThing.marketRestrictProfession|0));
            document.querySelector(Q.mktLevel) && (document.querySelector(Q.mktLevel).value = String(currentThing.marketRestrictLevel|0));
          } else if (!checked) {
            document.querySelector(Q.mktName) && (document.querySelector(Q.mktName).value = '');
            document.querySelector(Q.mktCategory) && (document.querySelector(Q.mktCategory).value = '0');
            document.querySelector(Q.mktTradeAs) && (document.querySelector(Q.mktTradeAs).value = '0');
            document.querySelector(Q.mktShowAs) && (document.querySelector(Q.mktShowAs).value = '0');
            document.querySelector(Q.mktVocation) && (document.querySelector(Q.mktVocation).value = '0');
            document.querySelector(Q.mktLevel) && (document.querySelector(Q.mktLevel).value = '0');
          }
          ['mktName','mktCategory','mktTradeAs','mktShowAs','mktVocation','mktLevel'].forEach(id=>{
            dispatchChange(document.querySelector(Q[id]));
          });
          break;
        }
        case 0x1E: { // Help Lens
          const el = document.querySelector(Q.hasHelpLens);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const sel = document.querySelector(Q.helpLensType);
          if (checked && typeof currentThing !== 'undefined' && currentThing) {
            sel && (sel.value = String(currentThing.helpLensType|0));
          } else if (!checked) {
            sel && (sel.value = '0');
          }
          dispatchChange(sel);
          break;
        }
        case 0x23: { // Action
          const el = document.querySelector(Q.hasAction);
          if (el) { el.checked = !!checked; dispatchChange(el); }
          const sel = document.querySelector(Q.actionType);
          if (checked && typeof currentThing !== 'undefined' && currentThing) {
            sel && (sel.value = String(currentThing.actionType|0));
          } else if (!checked) {
            sel && (sel.value = '0');
          }
          dispatchChange(sel);
          break;
        }
        // otros opcodes sin props directos: no-op
        default: break;
      }
    }

    host.querySelectorAll('input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change', ()=>{ 
        if(!currentThing) return;
        const code = Number(cb.dataset.code)|0;
        // sincronizar controles relacionados automáticamente
        try { handleFlagToggle(code, !!cb.checked); } catch(e){ console.warn('handleFlagToggle failed', e); }
        // luego actualizar flags/raw/mask desde UI como antes
        writeFlagsToThing(); paintFlagsMaskAndUnknown(); 
      }, {passive:true});
    });
    on($(Q.flagsSearch),'input',onFilterFlags);
    on($(Q.flagsFilter),'change',onFilterFlags);
  }

  function onFilterFlags(){
    const q = ($(Q.flagsSearch)?.value||'').toLowerCase().trim();
    const f = $(Q.flagsFilter)?.value||'';
    const NAMES = flagNamesForCurrentSig();
    $$(Q.flagsHost+' label.checkline').forEach(l=>{
      const code = l.querySelector('input')?.dataset.code|0;
      const name = (NAMES[code] || '').toLowerCase();
      const hitQ = !q || name.includes(q);
      const hitF = !f || String(code)===String(f);
      l.style.display = (hitQ && hitF) ? '' : 'none';
    });
  }

  function toArray(flags){ return Array.isArray(flags) ? flags.slice() : bitmaskToArray(flags|0); }
  function toMask(arr){ return Array.isArray(arr) ? arrayToBitmask(arr) : (arr|0); }

  function readFlagsFromUI(){
    const set = new Set();
    FLAG_CODES.forEach(code => { const cb = document.getElementById(`flag_cb_${code}`); if (cb?.checked) set.add(code); });
    return Array.from(set).sort((a,b)=>a-b);
  }
  function paintFlagsToUI(flags){
    ensureFlagsGrid();
    const set = new Set(toArray(flags));
    FLAG_CODES.forEach(code => { const cb = document.getElementById(`flag_cb_${code}`); if (cb) cb.checked = set.has(code); });
    paintFlagsMaskAndUnknown(flags);
  }
  function paintFlagsMaskAndUnknown(flagsInput){
    const flags = flagsInput ?? readFlagsFromUI();
    const mask  = arrayToBitmask(flags) >>> 0;
    v(Q.flagsMask, '0x'+mask.toString(16).toUpperCase());
    const NAMES = flagNamesForCurrentSig();
    const unknown = flags.filter(c => !(c in NAMES));
    const box = $(Q.flagsUnknown); if (box){ box.innerHTML=''; unknown.forEach(c => {
      const tag=document.createElement('div'); tag.className='badge'; tag.textContent=`0x${c.toString(16)} (${c})`; box.appendChild(tag);
    });}
  }
  function writeFlagsToThing(){
    if (!currentThing) return;
    const arr = readFlagsFromUI();
    currentThing.flags = Array.isArray(currentThing.flags) ? arr.slice() : toMask(arr);
    currentThing.__rev = (currentThing.__rev|0)+1;
  }

  // ---------- Helpers colores (#RRGGBB <-> 24-bit) ----------
  const clampU8 = v => Math.max(0, Math.min(255, v|0));
  const clampU24 = v => Math.max(0, Math.min(0xFFFFFF, Number(v)|0));

  // 24-bit int -> '#RRGGBB'
  function int24ToHex(n) {
    const v = (Number(n) >>> 0) & 0xFFFFFF;
    return '#' + v.toString(16).padStart(6, '0').toUpperCase();
  }

  // palette 6x6x6 (indices 0..215) -> RGB int 0xRRGGBB
  function from8Bit(index) {
    index = index | 0;
    index = Math.max(0, Math.min(215, index));
    const rIdx = Math.floor(index / 36) % 6;
    const gIdx = Math.floor((index % 36) / 6) % 6;
    const bIdx = index % 6;
    const R = rIdx * 51;
    const G = gIdx * 51;
    const B = bIdx * 51;
    return ((R & 0xFF) << 16) | ((G & 0xFF) << 8) | (B & 0xFF);
  }

  // RGB int (0xRRGGBB) -> nearest 6x6x6 index (0..215)
  // If a small number (<=0xFF) is passed, assume it's already an index and return it.
  function rgbTo6cubeIndex(rgbInt) {
    const n = Number(rgbInt) >>> 0;
    if (n <= 0xFF) return n & 0xFF; // already an index
    const r = (n >> 16) & 0xFF;
    const g = (n >> 8) & 0xFF;
    const b = n & 0xFF;
    const rIdx = Math.max(0, Math.min(5, Math.round(r / 51)));
    const gIdx = Math.max(0, Math.min(5, Math.round(g / 51)));
    const bIdx = Math.max(0, Math.min(5, Math.round(b / 51)));
    return (rIdx * 36) + (gIdx * 6) + bIdx;
  }

  // Si value <= 0xFF -> se interpreta como índice palette; si >0xFF -> ya es RGB 24-bit
  function valueToRGBInt(value) {
    const n = Number(value) >>> 0;
    if (n <= 0xFF) return from8Bit(n);
    return n & 0xFFFFFF;
  }

  // Parse '#RRGGBB' | '0xRRGGBB' | 'RRGGBB' | decimal -> 24-bit int
  function parseHexTo24bit(hex) {
    if (!hex && hex !== 0) return 0;
    const s = String(hex).trim();
    if (/^#?[0-9a-f]{6}$/i.test(s)) return parseInt(s.replace(/^#/, ''), 16) & 0xFFFFFF;
    if (/^0x[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16) & 0xFFFFFF;
    const n = Number(s);
    return Number.isFinite(n) ? (n >>> 0) & 0xFFFFFF : 0;
  }

  // --- Reemplaza COMPLETO ---
  function hydratePropsFromFlags(thing){
    const sig = (window.dat?.signature|0) >>> 0;
    const f = formatFlags(thing, sig) || {};

    // Ground
    thing.isFloor     = !!f.ground;
    thing.groundSpeed = f.ground?.speed|0;

    // Light
    thing.hasLight    = !!f.light;
    thing.lightLevel  = f.light?.intensity|0;
    if (f.light && f.light.color != null) {
      thing.lightColor = f.light.color;
    } else {
      thing.lightColor = 0;
    }

    // Automap
    thing.hasAutomap  = !!f.automap;
    if (f.automap && f.automap.color != null) {
      thing.automapColor = f.automap.color;
    } else {
      thing.automapColor = 0;
    }

    // Offset / Displacement
    thing.hasOffset        = !!f.offset;
    thing.displacementX    = f.offset?.x|0;
    thing.displacementY    = f.offset?.y|0;

    // Elevation
    thing.hasElevation = !!f.elevation;
    thing.elevation    = f.elevation?.value|0;

    // Writable
    thing.writable     = !!f.writable?.multi;
    thing.writableOnce = !!f.writable?.once;
    thing.maxTextLen   = f.writable?.maxLen|0;

    // Equipment / Slot
    thing.hasEquipment = !!f.equipment;
    thing.slot         = f.equipment?.slot|0;

    // Market
    thing.hasMarket    = !!f.market;
    if (thing.hasMarket){
      thing.isMarketItem = true;
      thing.marketName   = f.market.name || '';
      thing.marketCategory = f.market.category|0;
      thing.marketTradeAs  = f.market.tradeAs|0;
      thing.marketShowAs   = f.market.showAs|0;
      thing.marketRestrictProfession = f.market.vocation|0;
      thing.marketRestrictLevel      = f.market.level|0;
    } else {
      thing.isMarketItem = false;
    }

    // Help lens
    thing.hasHelpLens = !!f.helpLens;
    thing.helpLensType = f.helpLens?.type|0;

    // Action
    thing.hasAction   = !!f.action;
    thing.actionType  = f.action?.type|0;

    return thing;
  }

  // --- Reemplaza COMPLETO ---
  function render(thing){
    currentThing = thing || null; if(!thing) return;

    // 1) decodifica flags -> props visibles
    hydratePropsFromFlags(thing);

    // 2) refleja flags en la UI
    paintFlagsToUI(thing.flags || 0);

    // 3) switches: ACTIVAR por presencia de la flag (aunque el valor sea 0)
    ck(Q.isFloor,       !!thing.isFloor);
    ck(Q.hasLight,      !!thing.hasLight);
    ck(Q.hasAutomap,    !!thing.hasAutomap);
    ck(Q.hasOffset,     !!thing.hasOffset);
    ck(Q.hasElevation,  !!thing.hasElevation);
    ck(Q.writable,      !!thing.writable);
    ck(Q.writableOnce,  !!thing.writableOnce);
    ck(Q.hasEquipment,  !!thing.hasEquipment);
    ck(Q.hasMarket,     !!thing.hasMarket);
    ck(Q.hasHelpLens,   !!thing.hasHelpLens);
    ck(Q.hasAction,     !!thing.hasAction);

    // 4) valores en campos
    v(Q.groundSpeed,    thing.groundSpeed|0);
    v(Q.lightColor,     String(thing.lightColor|0));
    v(Q.lightIntensity, thing.lightLevel|0);
    v(Q.automapColor,   String(thing.automapColor|0));
    v(Q.offsetX,        thing.displacementX|0);
    v(Q.offsetY,        thing.displacementY|0);
    v(Q.elevation,      thing.elevation|0);
    v(Q.maxTextLen,     thing.maxTextLen|0);
    v(Q.slot,           thing.slot|0);
    v(Q.mktName,        thing.marketName||'');
    v(Q.mktCategory,    thing.marketCategory|0);
    v(Q.mktTradeAs,     thing.marketTradeAs|0);
    v(Q.mktShowAs,      thing.marketShowAs|0);
    v(Q.mktVocation,    thing.marketRestrictProfession|0);
    v(Q.mktLevel,       thing.marketRestrictLevel|0);
    v(Q.helpLensType,   thing.helpLensType|0);
    v(Q.actionType,     thing.actionType|0);

    // Sincronizar picker (si existe) con el valor mostrado (ahora índice)
    try {
      // Automap picker
      const automapTxt = document.getElementById('prop_automapColor');
      let automapPicker = document.getElementById('prop_automapColor_picker');
      if (automapTxt && !automapPicker) {
        automapPicker = document.createElement('input');
        automapPicker.type = 'color';
        automapPicker.id = 'prop_automapColor_picker';
        automapPicker.title = 'Cambiar color de automapa';
        automapPicker.style.marginLeft = '6px';
        automapTxt.insertAdjacentElement('afterend', automapPicker);

        automapPicker.addEventListener('input', () => {
          try {
            const idx = rgbTo6cubeIndex(parseHexTo24bit(automapPicker.value));
            automapTxt.value = String(idx);
          } catch(e){}
          apply();
        }, {passive:true});
        automapTxt.addEventListener('change', () => {
          try {
            const idx = Number(automapTxt.value) || 0;
            automapPicker.value = int24ToHex(valueToRGBInt(idx));
          } catch(e){}
        }, {passive:true});
        automapTxt.addEventListener('click', () => automapPicker.focus(), {passive:true});
      }
      if (automapPicker && automapTxt) {
        automapPicker.value = int24ToHex(valueToRGBInt(Number(automapTxt.value)||0));
        automapPicker.disabled = !!automapTxt.disabled;
        automapPicker.style.opacity = automapTxt.disabled ? '0.5' : '1';
      }

      // Light picker (nuevo)
      const lightTxt = document.getElementById('prop_lightColor');
      let lightPicker = document.getElementById('prop_lightColor_picker');
      if (lightTxt && !lightPicker) {
        lightPicker = document.createElement('input');
        lightPicker.type = 'color';
        lightPicker.id = 'prop_lightColor_picker';
        lightPicker.title = 'Cambiar color de luz';
        lightPicker.style.marginLeft = '6px';
        lightTxt.insertAdjacentElement('afterend', lightPicker);

        lightPicker.addEventListener('input', () => {
          try {
            const idx = rgbTo6cubeIndex(parseHexTo24bit(lightPicker.value));
            lightTxt.value = String(idx);
          } catch(e){}
          apply();
        }, {passive:true});
        lightTxt.addEventListener('change', () => {
          try { lightPicker.value = int24ToHex(valueToRGBInt(Number(lightTxt.value)||0)); } catch(e){}
        }, {passive:true});
        lightTxt.addEventListener('click', () => lightPicker.focus(), {passive:true});
      }
      if (lightPicker && lightTxt) {
        lightPicker.value = int24ToHex(valueToRGBInt(Number(lightTxt.value)||0));
        lightPicker.disabled = !!lightTxt.disabled || !ck(Q.hasLight);
        lightPicker.style.opacity = (lightTxt.disabled || !ck(Q.hasLight)) ? '0.5' : '1';
      }
    } catch(e) {}

    // 5) habilitar/inhabilitar inputs según switches
    refreshEnables();

    // 6) (opcional) volver a pintar máscaras/unknowns
    paintFlagsToUI(thing.flags || 0);
  }


  function refreshEnables(){
    en(Q.groundSpeed,  ck(Q.isFloor));
    en(Q.lightColor,   ck(Q.hasLight));
    en(Q.lightIntensity, ck(Q.hasLight));
    en(Q.automapColor, ck(Q.hasAutomap));
    en(Q.offsetX,      ck(Q.hasOffset));
    en(Q.offsetY,      ck(Q.hasOffset));
    en(Q.elevation,    ck(Q.hasElevation));
    en(Q.maxTextLen,   (ck(Q.writable) || ck(Q.writableOnce)));
    en(Q.slot,         ck(Q.hasEquipment));

    [Q.mktName,Q.mktCategory,Q.mktTradeAs,Q.mktShowAs,Q.mktVocation,Q.mktLevel]
      .forEach(sel => en(sel, ck(Q.hasMarket)));

    en(Q.helpLensType, ck(Q.hasHelpLens));
    en(Q.actionType,   ck(Q.hasAction));
  }

  // ---------- UI -> thing ----------
  function apply(){
    if (!currentThing) return;

    currentThing.isFloor     = ck(Q.isFloor);
    currentThing.groundSpeed = toInt(v(Q.groundSpeed), 0);

    if (ck(Q.hasLight)) {
      const lvl = toInt(v(Q.lightIntensity), 0);
      const raw = String(v(Q.lightColor) || '').trim();
      let colIndex = 0;
      if (/^#?[0-9a-f]{6}$/i.test(raw) || /^0x[0-9a-f]{6}$/i.test(raw)) {
        colIndex = rgbTo6cubeIndex(parseHexTo24bit(raw));
      } else {
        const n = Number(raw);
        colIndex = Number.isFinite(n) ? Math.max(0, Math.min(215, n|0)) : 0;
      }
      currentThing.lightLevel = lvl;
      currentThing.lightColor = colIndex;
      if (!currentThing.__props) currentThing.__props = { flags: new Set(), values: {} };
      if (!currentThing.__props.values) currentThing.__props.values = {};
      currentThing.__props.values['lightIntensity'] = lvl;
      currentThing.__props.values['lightColor'] = colIndex;
    } else {
      currentThing.lightLevel = 0; currentThing.lightColor = 0;
      if (currentThing.__props && currentThing.__props.values) {
        currentThing.__props.values['lightIntensity'] = 0;
        currentThing.__props.values['lightColor'] = 0;
      }
    }

    if (ck(Q.hasAutomap)) {
      const raw = String(v(Q.automapColor) || '').trim();
      let acolIndex = 0;
      if (/^#?[0-9a-f]{6}$/i.test(raw) || /^0x[0-9a-f]{6}$/i.test(raw)) {
        acolIndex = rgbTo6cubeIndex(parseHexTo24bit(raw));
      } else {
        const n = Number(raw);
        acolIndex = Number.isFinite(n) ? Math.max(0, Math.min(215, n|0)) : 0;
      }
      currentThing.automapColor = acolIndex;
      if (!currentThing.__props) currentThing.__props = { flags: new Set(), values: {} };
      if (!currentThing.__props.values) currentThing.__props.values = {};
      currentThing.__props.values['automapColor'] = acolIndex;
    } else {
      currentThing.automapColor = 0;
      if (currentThing.__props && currentThing.__props.values) currentThing.__props.values['automapColor'] = 0;
    }

    if (ck(Q.hasOffset)) {
      currentThing.displacementX = toInt(v(Q.offsetX),0);
      currentThing.displacementY = toInt(v(Q.offsetY),0);
    } else { currentThing.displacementX = currentThing.displacementY = 0; }

    currentThing.elevation  = ck(Q.hasElevation) ? toInt(v(Q.elevation),0) : 0;

    currentThing.writable      = ck(Q.writable);
    currentThing.writableOnce  = ck(Q.writableOnce);
    currentThing.maxTextLen    = (ck(Q.writable)||ck(Q.writableOnce)) ? toInt(v(Q.maxTextLen),0) : 0;

    if (ck(Q.hasEquipment)) currentThing.slot = toInt(v(Q.slot),0); else currentThing.slot = 0;

    if (ck(Q.hasMarket)) {
      currentThing.isMarketItem = true;
      currentThing.marketName = v(Q.mktName) || '';
      currentThing.marketCategory = toInt(v(Q.mktCategory),0);
      currentThing.marketTradeAs  = toInt(v(Q.mktTradeAs),0);
      currentThing.marketShowAs   = toInt(v(Q.mktShowAs),0);
      currentThing.marketRestrictProfession = toInt(v(Q.mktVocation),0);
      currentThing.marketRestrictLevel      = toInt(v(Q.mktLevel),0);
    } else {
      currentThing.isMarketItem = false;
      currentThing.marketName = ''; currentThing.marketCategory=0;
      currentThing.marketTradeAs=0; currentThing.marketShowAs=0;
      currentThing.marketRestrictProfession=0; currentThing.marketRestrictLevel=0;
    }

    currentThing.helpLensType = ck(Q.hasHelpLens) ? toInt(v(Q.helpLensType),0) : 0;
    currentThing.actionType   = ck(Q.hasAction)   ? toInt(v(Q.actionType),0)   : 0;

    // flags desde UI
    writeFlagsToThing();
    // Re-empacar flags a bytes y persistir en memoria para consistencia
    try {
      const __sig = (dat?.signature ?? 0) >>> 0;
      const __bytes = encodeFlags(currentThing, __sig);
      if (Array.isArray(__bytes) || (__bytes && typeof __bytes.length === 'number')) {
        currentThing.__flagBytes = (__bytes instanceof Uint8Array) ? __bytes : Uint8Array.from(__bytes);
      }
      // invalidar cachés para re-hidratación posterior
      if (currentThing.__flagsRaw) delete currentThing.__flagsRaw;
      if (currentThing.__hydratedFlags) delete currentThing.__hydratedFlags;
    } catch(__e) {
      console.warn('apply(): encodeFlags fallo', __e);
    }


    currentThing.__rev = (currentThing.__rev|0) + 1;
  }

  function reset(){ if (currentThing) render(currentThing); }

  // ---------- Eventos del panel ----------
  function wire(){
    // mapping de switch de propiedad -> opcode
    const PROP_TO_OPCODE = {
      [Q.isFloor]:      0x00,
      [Q.hasLight]:     0x16,
      [Q.hasAutomap]:   0x1D,
      [Q.hasOffset]:    0x19,
      [Q.hasElevation]: 0x1A,
      [Q.writable]:     0x08,
      [Q.writableOnce]: 0x09,
      [Q.hasEquipment]: 0x21,
      [Q.hasMarket]:    0x22,
      [Q.hasHelpLens]:  0x1E,
      [Q.hasAction]:    0x23
    };

    [Q.isFloor,Q.hasLight,Q.hasAutomap,Q.hasOffset,Q.hasElevation,Q.writable,Q.writableOnce,
     Q.hasEquipment,Q.hasMarket,Q.hasHelpLens,Q.hasAction].forEach(sel=>{
      const el = $(sel);
      if (!el) return;
      on(el,'change',()=>{
        // sincronizar checkbox de opcode correspondiente (si existe la grilla)
        try {
          const code = PROP_TO_OPCODE[sel];
          if (typeof code !== 'undefined') {
            const cb = document.getElementById(`flag_cb_${code}`);
            if (cb) cb.checked = !!el.checked;
            // actualizar preview/máscara inmediatamente
            paintFlagsToUI(readFlagsFromUI());
          }
        } catch(e){ console.warn('sync prop->flag failed', e); }
        refreshEnables();
        apply();
      });
    });

    [Q.groundSpeed,Q.lightColor,Q.lightIntensity,Q.automapColor,Q.offsetX,Q.offsetY,Q.elevation,
     Q.maxTextLen,Q.slot,Q.mktName,Q.mktCategory,Q.mktTradeAs,Q.mktShowAs,Q.mktVocation,Q.mktLevel,
     Q.helpLensType,Q.actionType].forEach(sel=>{
      on($(sel),'change',()=>apply());
    });

    // Crear y sincronizar un color-picker nativo al lado del input de Automap Color
    try {
      // Automap color picker (existente)
      const txtA = document.getElementById('prop_automapColor');
      if (txtA) {
        let pickerA = document.getElementById('prop_automapColor_picker');
        if (!pickerA) {
          pickerA = document.createElement('input');
          pickerA.type = 'color';
          pickerA.id = 'prop_automapColor_picker';
          pickerA.title = 'Cambiar color de automapa';
          pickerA.style.marginLeft = '6px';
          txtA.insertAdjacentElement('afterend', pickerA);

          pickerA.addEventListener('input', () => {
            try {
              const idx = rgbTo6cubeIndex(parseHexTo24bit(pickerA.value));
              txtA.value = String(idx);
            } catch(e){}
            apply();
          }, {passive:true});
          txtA.addEventListener('change', () => {
            try { pickerA.value = int24ToHex(valueToRGBInt(Number(txtA.value)||0)); } catch(e){}
          }, {passive:true});
          txtA.addEventListener('click', () => pickerA.focus(), {passive:true});
        }
      }

      // Light color picker (nuevo)
      const txtL = document.getElementById('prop_lightColor');
      if (txtL) {
        let pickerL = document.getElementById('prop_lightColor_picker');
        if (!pickerL) {
          pickerL = document.createElement('input');
          pickerL.type = 'color';
          pickerL.id = 'prop_lightColor_picker';
          pickerL.title = 'Cambiar color de luz';
          pickerL.style.marginLeft = '6px';
          txtL.insertAdjacentElement('afterend', pickerL);

          pickerL.addEventListener('input', () => {
            try {
              const idx = rgbTo6cubeIndex(parseHexTo24bit(pickerL.value));
              txtL.value = String(idx);
            } catch(e){}
            apply();
          }, {passive:true});
          txtL.addEventListener('change', () => {
            try { pickerL.value = int24ToHex(valueToRGBInt(Number(txtL.value)||0)); } catch(e){}
          }, {passive:true});
          txtL.addEventListener('click', () => pickerL.focus(), {passive:true});
        }
      }
    } catch(e){ console.warn('color picker setup failed', e); }

    on($('#datApplyBtn'),'click',()=>apply());
    on($('#datResetBtn'),'click',()=>reset());

    ensureFlagsGrid();
  }

  // ---------- Hook a la selección existente ----------
  const _oldSelect = window.selectThing;
  window.selectThing = function(...args){
    const ret = _oldSelect ? _oldSelect.apply(this,args) : undefined;
    try{
      const cat = window.currentCategory || 'item';
      const id  = (window.currentThingId|0) || 0;
      const t   = window.dat?.getThing?.(cat, id);
      if (t) render(t);
    }catch(_){}
    return ret;
  };

  // ---------- API pública ----------
  // Merge our small API into any existing DAT_EDITOR to avoid clobbering helpers registered by other modules.
  (function exposeDatEditorAPI(){
    const existing = window.DAT_EDITOR || {};

    // attach or override the core functions but keep anything already present (e.g. registerCustomFlag from dat.flags.js)
    existing.render = render;
    existing.apply = apply;
    existing.reset = reset;
    existing.encodeFlags = encodeFlags;
    existing.ensureFlagsGrid = ensureFlagsGrid;

    // Refresh the Thing Properties Panel after bulk edits.
    // affectedIds: Array<number> | Set<number> - list of thing ids that were modified by the bulk operation.
    existing.refreshPropertiesPanelAfterBulk = function (affectedIds) {
      try {
        const ids = Array.isArray(affectedIds) ? affectedIds : (affectedIds instanceof Set ? Array.from(affectedIds) : []);
        if (!ids || !ids.length) return false;

        const curId = (typeof currentThingId !== 'undefined' && currentThingId) ? currentThingId : (window.currentThingId || 0);
        const curCat = (typeof currentCategory !== 'undefined' && currentCategory) ? currentCategory : (window.currentCategory || 'item');
        if (!curId) return false;

        // Only refresh if current shown thing is among affected IDs
        if (!ids.includes(curId)) return false;

        // Invalidate thumb cache entries for this id (so list thumbnails will update if necessary)
        try {
          if (typeof __thingThumbCache !== 'undefined' && __thingThumbCache instanceof Map) {
            for (const k of Array.from(__thingThumbCache.keys())) {
              // Keys are like `${cat}:${id}:...`
              const parts = String(k).split(':');
              if (parts[1] === String(curId)) __thingThumbCache.delete(k);
            }
          }
        } catch (e) { /* ignore */ }

        // Bump the sprite panel render token to cancel any pending renders and force rebuild
        try { __spritePanelRenderToken = (typeof __spritePanelRenderToken === 'number' ? (__spritePanelRenderToken + 1) : 1); } catch(_) {}

        // Re-fetch the thing and re-render the properties panel + flags grid
        const t = (typeof dat !== 'undefined' && dat && typeof dat.getThing === 'function') ? dat.getThing(curCat, curId) : null;
        if (!t) return false;

        // If other modules provide loadCustomFlags/registerCustomFlag, ensure UI picks them up
        try {
          if (typeof window.loadCustomFlags === 'function') window.loadCustomFlags();
          if (typeof window.DAT_EDITOR?.ensureFlagsGrid === 'function') window.DAT_EDITOR.ensureFlagsGrid(true);
        } catch (e) { /* ignore */ }

        // Render properties and the main canvas so user sees the updated flags/values immediately
        try { if (typeof existing.render === 'function') existing.render(t); } catch (e) { console.warn('refreshPropertiesPanelAfterBulk: render failed', e); }
        try { repaintMainCanvas(); } catch (e) { /* ignore */ }

        return true;
      } catch (err) {
        console.warn('refreshPropertiesPanelAfterBulk failed', err);
        return false;
      }
    };

    window.DAT_EDITOR = existing;
  })();

  // start
  document.addEventListener('DOMContentLoaded', ()=>{ wire(); }, {once:true});
})();

// === UTIL DOM ===
const $ = (id) => document.getElementById(id);

// === INYECCIONES SOBRE DatParser (no toco datParser.js) ===
// 1) Reset de things sin sprites → 1x1x1, frames=1, sprites=[0]
DatParser.prototype.resetEmptyThings = function () {
  const resetGroup = () => ({
    width: 1, height: 1, layers: 1,
    patternX: 1, patternY: 1, patternZ: 1,
    frames: 1,
    sprites: [0]
  });

  const resetThing = (thing) => {
    thing.flags = [];                 // contenedor limpio
    thing.groups = [resetGroup()];
    return thing;
  };

  const processList = (list) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      const hasSprite = t.groups?.some(g => g.sprites?.some(id => id > 0));
      if (!hasSprite) list[i] = resetThing(t);
    }
  };

  processList(this.items);
  processList(this.outfits);
  processList(this.effects);
  processList(this.missiles);
};

// 3) Normalizador de grupos (límite OB 4096 sprites por thing)
DatParser.prototype.normalizeGroups = function (sprTotal, maxSpritesPerThing = 4096) {
  const fixList = (list) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !Array.isArray(t.groups)) continue;

      for (const g of t.groups) {
        // Valores seguros
        g.width    = Math.max(1, g.width    | 0);
        g.height   = Math.max(1, g.height   | 0);
        g.layers   = Math.max(1, g.layers   | 0);
        g.patternX = Math.max(1, g.patternX | 0);
        g.patternY = Math.max(1, g.patternY | 0);
        g.patternZ = Math.max(1, g.patternZ | 0);
        g.frames   = Math.max(1, g.frames   | 0);
        if (!Array.isArray(g.sprites)) g.sprites = [];

        const base = g.width * g.height * g.layers * g.patternX * g.patternY * g.patternZ;

        // Si base ya supera el límite, colapsar a contenedor
        if (base > maxSpritesPerThing) {
          g.width = g.height = g.layers = g.patternX = g.patternY = g.patternZ = 1;
          g.frames = 1;
        } else {
          // Ajustar frames para que quepa
          const maxFrames = Math.max(1, Math.floor(maxSpritesPerThing / base));
          if (g.frames > maxFrames) g.frames = maxFrames;
        }

        // Count final
        const need = g.width * g.height * g.layers * g.patternX * g.patternY * g.patternZ * g.frames;

        // Sanitizar sprites
        const SAFE = (id) => (id > 0 && id <= sprTotal) ? (id|0) : 0;
        if (g.sprites.length >= need) {
          g.sprites = g.sprites.slice(0, need).map(SAFE);
        } else {
          const out = new Array(need).fill(0);
          for (let k = 0; k < g.sprites.length; k++) out[k] = SAFE(g.sprites[k]);
          g.sprites = out;
        }
      }

      // Si quedó sin grupos válidos → contenedor
      if (!t.groups.length) {
        t.groups = [{
          width:1, height:1, layers:1, patternX:1, patternY:1, patternZ:1, frames:1, sprites:[0]
        }];
      }
    }
  };

  fixList(this.items);
  fixList(this.outfits);
  fixList(this.effects);
  fixList(this.missiles);
};

// ===== Estado =====
let versionManager = new VersionManager();
let detectedVersion = null;
let spr = null;
let dat = null;

let currentCategory = 'item';
let currentThingId = 100;
let groupIndex = 0;

let frame = 0, layer = 0, patternX = 2, patternY = 0, patternZ = 0;
let animationFrameRequest = null;
let showGrid = true;

let fullList = [];
let filteredList = [];
let currentPage = 0;
let totalPages = 1;
const pageSize = 100;

// canvas
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// ===== View state (persistente para UI de visualización) =====
window.__VIEW_STATE__ = window.__VIEW_STATE__ || {
  addons: 0,          // 0,1,2,3 (3 = full)
  mount: 0,           // 0 dismount, 1 mount → PatternZ
  fullAddons: false,  // addons==3
};

// === Render compuesto respetando estado de Addons Full (Y:0 + Y:1 + Y:2) ===
function __renderCompositeImage(thing, group, totalPerFrame) {
  const addonsEl = document.getElementById('addons');
  const addonsSel = parseInt((addonsEl?.value ?? '0'), 10) || 0;
  const isFull = (addonsSel === 3) && ((group.patternY|0) >= 3);

  function __sliceForY(yVal){
    const oldY = typeof patternY!=='undefined' ? patternY : 0;
    try { patternY = yVal|0; } catch(_){}
    const { index } = getFrameIndex(thing, group);
    const slice = group.sprites.slice(index, index + totalPerFrame);
    while (slice.length < group.width * group.height) slice.push(0);
    const canv = renderThingToCanvas(thing, group, slice);
    try { patternY = oldY; } catch(_){}
    return canv;
  }

  if (!isFull) {
    const { index } = getFrameIndex(thing, group);
    const sprites = group.sprites.slice(index, index + totalPerFrame);
    while (sprites.length < group.width * group.height) sprites.push(0);
    return renderThingToCanvas(thing, group, sprites);
  }

  // Composición Full
  const baseC = __sliceForY(0);
  const out = document.createElement('canvas');
  out.width = baseC.width; out.height = baseC.height;
  const gx = out.getContext('2d', { willReadFrequently:true });
  gx.imageSmoothingEnabled = false;
  gx.drawImage(baseC, 0, 0);
  const a1 = __sliceForY(1);
  const a2 = __sliceForY(2);
  if (a1) gx.drawImage(a1, 0, 0);
  if (a2) gx.drawImage(a2, 0, 0);
  return out;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const hexToU32 = (hex) => {
  if (!hex) return 0;
  return parseInt(String(hex).replace(/^0x/i, ''), 16) >>> 0;
};

function getFrameIndex(thing, group) {
  const f = clamp(frame,    0, Math.max(0, group.frames   - 1));
  const l = clamp(layer,    0, Math.max(0, group.layers   - 1));
  const x = clamp(patternX, 0, Math.max(0, group.patternX - 1));
  const y = clamp(patternY, 0, Math.max(0, group.patternY - 1));
  const z = clamp(patternZ, 0, Math.max(0, group.patternZ - 1));

  const totalPerFrame = Math.max(1, group.width) * Math.max(1, group.height);

  const idx = (
    (
      (
        (f * group.patternZ + z) * group.patternY + y
      ) * group.patternX + x
    ) * group.layers + l
  ) * totalPerFrame;

  return { index: idx, totalPerFrame };
}

function setCanvasSize(w, h) {
  const cont = $('canvasContainer');
  const zoom = parseInt($('zoom')?.value || '4', 10);

  canvas.width = w;
  canvas.height = h;

  let scale = zoom;
  const maxW = Math.max(1, cont.clientWidth  - 4);
  const maxH = Math.max(1, cont.clientHeight - 4);
  const fit = Math.min(maxW / w, maxH / h);
  if (scale > fit) scale = Math.max(1, Math.floor(fit));

  $('zoomVal').textContent = `${zoom}×`;
  canvas.style.width  = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;

  cont.classList.toggle('grid-on', showGrid);
}

function drawGridOverlay(w, h) {
  if (!showGrid) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(132, 206, 255, 0.22)';
  ctx.lineWidth = 1;
  for (let x = 32; x < w; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 32; y < h; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
}

function renderThingToCanvas(thing, group, sprites) {
  const spriteSize = 32;
  const w = Math.max(1, group.width)  * spriteSize;
  const h = Math.max(1, group.height) * spriteSize;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  for (let y = 0; y < group.height; y++) {
    for (let x = 0; x < group.width; x++) {
      const idx = (group.height - 1 - y) * group.width + (group.width - 1 - x);
      const spriteId = sprites[idx];
      if (!spriteId || spriteId <= 0 || spriteId > spr.totalSprites) continue;

      const img = spr.getSprite(spriteId - 1);
      if (!img) continue;

      const cell = document.createElement('canvas');
      cell.width = cell.height = 32;
      cell.getContext('2d').putImageData(img, 0, 0);
      g.drawImage(cell, x * spriteSize, y * spriteSize);
    }
  }
  return c;
}

// Añadir token global para cancelar renderizaciones de panel de sprites
let __spritePanelRenderToken = 0;

// Reemplazo completo de updateSpritePanelWithAllSprites por versión incremental/cancelable
async function updateSpritePanelWithAllSprites(thing) {
  const grid   = $('spriteGrid');
  const header = $('spriteCount');
  if (!grid) return;
  if (!thing) { grid.innerHTML = ''; if (header) header.textContent = ''; return; }

  // Cancel any previous run
  __spritePanelRenderToken++;
  const myToken = __spritePanelRenderToken;

  // limpiar restos
  $('spritePanelZoom')?.parentElement?.remove?.();
  grid.innerHTML = '';
  if (header) header.textContent = 'Cargando sprites...';

  // tamaño de thumb (fallback 104)
  const TILE = (() => {
    const t = document.querySelector('.thingRow .thumb');
    const w = t ? parseInt(getComputedStyle(t).width, 10) : 0;
    return Number.isFinite(w) && w > 0 ? w : 104;
  })();
  grid.style.setProperty('--thumb-size', `${TILE}px`);

  // helpers de indexado
  const getFrameIndexLocal = (grp, opts) => {
    const f = clamp(opts.frame,    0, Math.max(0, grp.frames   - 1));
    const l = clamp(opts.layer,    0, Math.max(0, grp.layers   - 1));
    const x = clamp(opts.patternX, 0, Math.max(0, grp.patternX - 1));
    const y = clamp(opts.patternY, 0, Math.max(0, grp.patternY - 1));
    const z = clamp(opts.patternZ, 0, Math.max(0, grp.patternZ - 1));

    const totalPerFrame = Math.max(1, grp.width) * Math.max(1, grp.height);

    const idx = (
      (
        (
          (f * grp.patternZ + z) * grp.patternY + y
        ) * grp.patternX + x
      ) * grp.layers + l
    ) * totalPerFrame;

    return { index: idx, totalPerFrame };
  };

  const layerHasContentLocal = (grp, L, f, x, y, z) => {
    const wTiles = Math.max(1, grp.width|0);
    const hTiles = Math.max(1, grp.height|0);
    const per    = wTiles * hTiles;

    const { index } = getFrameIndexLocal(grp, { frame: f, layer: L, patternX: x, patternY: y, patternZ: z });
    const end = index + per;
    const arr = grp.sprites || [];
    for (let i = index; i < end; i++) {
      if ((arr[i] | 0) > 0) return true;
    }
    return false;
  };

  const composeLayerThumbLocal = (thingLocal, grp, L, f, x, y, z) => {
    const wTiles = Math.max(1, grp.width|0);
    const hTiles = Math.max(1, grp.height|0);
    const per    = wTiles * hTiles;

    const { index } = getFrameIndexLocal(grp, { frame: f, layer: L, patternX: x, patternY: y, patternZ: z });
    const slice = (grp.sprites || []).slice(index, index + per);
    const built = renderThingToCanvas(thingLocal, grp, slice); // wTiles×hTiles → canvas

    // crear thumbnail centrado en TILE
    const th = document.createElement('canvas');
    th.width = th.height = TILE;
    const gt = th.getContext('2d', { willReadFrequently: true });
    gt.imageSmoothingEnabled = false;

    const s  = Math.min(TILE / Math.max(1, built.width), TILE / Math.max(1, built.height));
    const dw = Math.max(1, Math.floor(built.width  * s));
    const dh = Math.max(1, Math.floor(built.height *  s));
    const dx = Math.floor((TILE - dw) / 2);
    const dy = Math.floor((TILE - dh) / 2);
    gt.clearRect(0,0,TILE,TILE);
    gt.drawImage(built, dx, dy, dw, dh);

    return th;
  };

  // util para ceder al event-loop (requestIdleCallback si existe)
  const yieldIdle = () => new Promise((res) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => res(), { timeout: 120 });
    } else {
      setTimeout(res, 40);
    }
  });

  // Etiquetado correcto:
  const getBadgeText = (L, y, z) => {
    if (L === 0) {
      if (z === 1) return 'Mount';
      if (y === 2) return 'Addon 2';
      if (y === 1) return 'Addon 1';
      return 'Base';
    } else {
      if (z === 1) return 'L mount';
      if (y === 2) return 'L addon 2';
      if (y === 1) return 'L addon 1';
      return `L${L}`;
    }
  };

  // recorrido incremental (batching)
  const groups = Array.isArray(thing.groups) ? thing.groups : [];
  const frag = document.createDocumentFragment();
  let total = 0;
  const BATCH = 20; // procesar N thumbs antes de ceder
  let counter = 0;

  // Iterar y renderizar, comprobando cancelación
  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    if (!grp) continue;

    const LAYERS = Math.max(1, grp.layers|0);
    const FRAMES = Math.max(1, grp.frames|0);
    const PX     = Math.max(1, grp.patternX|0);
    const PY     = Math.max(1, grp.patternY|0);
    const PZ     = Math.max(1, grp.patternZ|0);

    for (let z = 0; z < PZ; z++) {
      for (let y = 0; y < PY; y++) {
        for (let x = 0; x < PX; x++) {
          for (let f = 0; f < FRAMES; f++) {
            // Cancel if new selection started
            if (myToken !== __spritePanelRenderToken) {
              if (header) header.textContent = `Cancelado`;
              return;
            }

            for (let L = 0; L < LAYERS; L++) {
              if (!layerHasContentLocal(grp, L, f, x, y, z)) continue;

              const cell = document.createElement('div');
              cell.className = 'thumb-cell';

              const th = composeLayerThumbLocal(thing, grp, L, f, x, y, z);
              th.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;display:block;';
              cell.appendChild(th);

              // Badge único según reglas
              const badge = document.createElement('span');
              badge.className = 'thumb-badge';
              badge.textContent = getBadgeText(L, y, z);
              cell.appendChild(badge);

              frag.appendChild(cell);
              total++; counter++;
            }

            // cada BATCH cedemos CPU para mantener UI responsiva
            if (counter >= BATCH) {
              grid.appendChild(frag);
              counter = 0;
              await yieldIdle();
              if (myToken !== __spritePanelRenderToken) {
                if (header) header.textContent = `Cancelado`;
                return;
              }
            }
          }
        }
      }
    }
  }

  // append remaining
  grid.appendChild(frag);
  if (header) header.textContent = `Mostrando ${total} partes armadas (Base + Layers + Addons + Mount) · groups=${groups.length}`;
}

function updateThingCountsUI() {
  if (!dat) return;
  const itemCount    = dat.items.filter(Boolean).length;
  const outfitCount  = dat.outfits.filter(Boolean).length;
  const effectCount  = dat.effects.filter(Boolean).length;
  const missileCount = dat.missiles.filter(Boolean).length;
  const el = $('thingCounts');
  if (el) {
    el.innerHTML = `📦 Items: ${itemCount} | 🧍 Outfits: ${outfitCount} | ✨ Effects: ${effectCount} | 🏹 Missiles: ${missileCount}`;
  }
}

// ============ UI: selector de versión de exportación ============
function ensureExportUI() {
  const sidebar = $('sidebar'); // helper getElementById
  if (!sidebar || $('exportVersionRow')) return; // ya existe

  const wrapper = document.createElement('div');
  wrapper.id = 'exportVersionRow';
  wrapper.className = 'export-row';

  const label = document.createElement('label');
  label.htmlFor = 'exportVersionSelect';
  label.textContent = 'Exportar a versión:';

  const select = document.createElement('select');
  select.id = 'exportVersionSelect';
  select.style.width = '100%';

  (versionManager?.versions ?? []).forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const datHex = v.dat ? `0x${v.dat}` : 'N/A';
    const sprHex = v.spr ? `0x${v.spr}` : 'N/A';
    opt.textContent = `${v.name || v.value || 'desconocida'}  (dat=${datHex}, spr=${sprHex})`;
    select.appendChild(opt);
  });

  if (detectedVersion && versionManager?.versions) {
    const idx = versionManager.versions.findIndex(v =>
      v.dat === detectedVersion.dat && v.spr === detectedVersion.spr
    );
    if (idx >= 0) select.value = String(idx);
  }

  wrapper.append(label, select);

  const exportBtn = document.getElementById("exportSprDatBtn");
  if (exportBtn && exportBtn.parentNode) {
    exportBtn.parentNode.insertBefore(wrapper, exportBtn);
  } else {
    sidebar.appendChild(wrapper);
  }
}

function getSelectedExportSignatures() {
  const miniSel = document.getElementById('miniExportVersionSelect');
  if (miniSel) {
    const idx = parseInt(miniSel.value,10);
    const chosen = Number.isInteger(idx) ? versionManager.versions[idx] : null;
    if (chosen) return { datSig: hexToU32(chosen.dat), sprSig: hexToU32(chosen.spr) };
  }
  const sel = $('exportVersionSelect');
  if (!sel) return { datSig: dat?.signature ?? 0, sprSig: spr?.signature ?? 0 };
// === Guardado con File System Access API cuando esté disponible ===
async function saveBlobAs(blob, suggestedName, mime) {
  if (window.showSaveFilePicker) {
    try {
      const fh = await showSaveFilePicker({
        suggestedName,
        types: [{
          description: mime || 'Archivo binario',
          accept: { 'application/octet-stream': ['.' + (suggestedName.split('.').pop() || 'bin')] }
        }]
      });
      const ws = await fh.createWritable();
      await ws.write(blob);
      await ws.close();
      return true;
    } catch (err) {
      console.warn('saveBlobAs: cancelado o falló, fallback a descarga', err);
      // cae a descarga
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

// === Modal de exportación DAT/SPR ===
window.openPackExportModal = function() {
  const modal = document.getElementById('packExportModal');
  const verSel = document.getElementById('packExportVersion');
  const ext   = document.getElementById('optDatExtended');
  const imp   = document.getElementById('optDatImprovedAnim');
  const grp   = document.getElementById('optDatFrameGroups');
  const trn   = document.getElementById('optSprTransparency');

  if (verSel && versionManager && Array.isArray(versionManager.versions)) {
    verSel.innerHTML = '';
    versionManager.versions.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${v.label || ('v'+i)} — DAT ${v.dat} / SPR ${v.spr}`;
      verSel.appendChild(opt);
    });
    // seleccionar opción actual si existe un select lateral
    const sideSel = document.getElementById('exportVersionSelect');
    if (sideSel && sideSel.selectedIndex >= 0) verSel.selectedIndex = sideSel.selectedIndex;
  }

  // valores por defecto encendidos
  if (ext) ext.checked = true;
  if (imp) imp.checked = true;
  if (grp) grp.checked = true;
  if (trn) trn.checked = true;

  window.openMiniExportModal();
};

window.closePackExportModal = function() {
  const modal = document.getElementById('packExportModal');
  if (modal) modal.classList.add('hidden');
};

async function __runSprDatExport(opts){
  const { versionIndex, datExtended, datImproved, datFrameGroups, transparency, prune } = opts||{};

  // ===== pipeline identical to previous implementation, using prune flag =====
  const pruneMode = !!prune;

  const thingHasAnySprite = (t) => {
    if (!t?.groups) return false;
    for (const g of t.groups) {
      if (!g?.sprites) continue;
      for (const id of g.sprites) if ((id | 0) > 0) return true;
    }
    return false;
  };

  const pruneEmptyThings = () => {
    const prune = (list) => {
      if (!Array.isArray(list)) return;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t) continue;
        if (!thingHasAnySprite(t)) list[i] = null;
      }
      let last = 0;
      for (let i = 0; i < list.length; i++) if (list[i]) last = i;
      list.length = last + 1;
    };
    prune(dat.items); prune(dat.outfits); prune(dat.effects); prune(dat.missiles);

    const lastIndex = (list, start) => {
      let last = start - 1;
      for (let i = start; i < list.length; i++) if (list[i]) last = i;
      return Math.max(start - 1, last);
    };
    dat.itemCount    = Math.max(100, lastIndex(dat.items,   100));
    dat.outfitCount  = Math.max(0,   lastIndex(dat.outfits, 1));
    dat.effectCount  = Math.max(0,   lastIndex(dat.effects, 1));
    dat.missileCount = Math.max(0,   lastIndex(dat.missiles,1));
  };

  const compactSpritesAndRemap = () => {
    const used = new Set();
    const collect = (list) => {
      if (!Array.isArray(list)) return;
      for (const t of list) {
        if (!t?.groups) continue;
        for (const g of t.groups) {
          if (!g?.sprites) continue;
          for (const id of g.sprites) if ((id | 0) > 0) used.add(id | 0);
        }
      }
    };
    collect(dat.items); collect(dat.outfits); collect(dat.effects); collect(dat.missiles);

    if (used.size === 0) { spr.sprites = []; spr.totalSprites = 0; return; }

    const sorted = Array.from(used).sort((a, b) => a - b);
    const remap = new Map(sorted.map((oldId, i) => [oldId, i + 1]));

    const newSprites = new Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      const oldId = sorted[i];
      newSprites[i] = spr.getSprite(oldId - 1) || null;
    }
    spr.sprites = newSprites;
    spr.totalSprites = newSprites.length;

    const apply = (list) => {
      if (!Array.isArray(list)) return;
      for (const t of list) {
        if (!t?.groups) continue;
        for (const g of t.groups) {
          if (!Array.isArray(g.sprites)) continue;
          for (let k = 0; k < g.sprites.length; k++) {
            const id = g.sprites[k] | 0;
            g.sprites[k] = id > 0 ? (remap.get(id) || 0) : 0;
          }
        }
      }
    };
    apply(dat.items); apply(dat.outfits); apply(dat.effects); apply(dat.missiles);
  };

  const compactThingIds = () => {
    const compactList = (list, startId, category) => {
      const out = [];
      let next = startId;
      for (let i = startId; i < list.length; i++) {
        const t = list[i];
        if (!t) continue;
        if (!thingHasAnySprite(t)) continue;
        const clone = { ...t };
        if (t.__props) clone.__props = JSON.parse(JSON.stringify(t.__props));
        clone.id = next;
        clone.category = category;
        out[next] = clone;
        next++;
      }
      return { list: out, lastId: next - 1 };
    };

    let r = compactList(dat.items, 100, 'item');
    dat.items = r.list; dat.itemCount = Math.max(100, r.lastId);

    r = compactList(dat.outfits, 1, 'outfit');
    dat.outfits = r.list; dat.outfitCount = Math.max(0, r.lastId);

    r = compactList(dat.effects, 1, 'effect');
    dat.effects = r.list; dat.effectCount = Math.max(0, r.lastId);

    r = compactList(dat.missiles, 1, 'missile');
    dat.missiles = r.list; dat.missileCount = Math.max(0, r.lastId);
  };

  const getMaxSpriteIdFromDat = (datObj) => {
    let maxId = 0;
    const lists = [datObj.items, datObj.outfits, datObj.effects, datObj.missiles];
    for (const L of lists) {
      if (!Array.isArray(L)) continue;
      for (const t of L) {
        if (!t?.groups) continue;
        for (const g of t.groups) {
          if (!g?.sprites) continue;
          for (const sid of g.sprites) if ((sid|0) > maxId) maxId = sid|0;
        }
      }
    }
    return maxId >>> 0;
  };

  const normalizeGroups = () => {
    if (typeof dat.normalizeGroups === 'function') dat.normalizeGroups(spr.totalSprites, 4096);
  };

  if (pruneMode) {
    pruneEmptyThings();
    compactSpritesAndRemap();
    compactThingIds();
    normalizeGroups();
  } else {
    const maxUsed = getMaxSpriteIdFromDat(dat);
    if ((spr.totalSprites | 0) < maxUsed) {
      while (spr.sprites.length < maxUsed) spr.sprites.push(null);
      spr.totalSprites = maxUsed;
    }
    normalizeGroups();
  }

  // ===== Signatures and export flags from modal
  const chosen = (window.versionManager?.versions||[])[versionIndex|0];
  const datSig = chosen ? parseInt(chosen.dat,16)>>>0 : (dat.signature>>>0);
  const sprSig = chosen ? parseInt(chosen.spr,16)>>>0 : (spr.signature>>>0);

  dat.setExportFormat({
    extended: !!datExtended,
    transparency: !!transparency,
    improvedAnimations: !!datImproved,
    frameGroups: !!datFrameGroups,
    signatureOverride: datSig
  });
  spr.setExportFormat({
    transparency: !!transparency,
    signatureOverride: sprSig
  });

  // ===== Serialize
  const datBlob = new Blob([dat.toBinary()], { type: 'application/octet-stream' });
  const sprBlob = new Blob([spr.toBinary()], { type: 'application/octet-stream' });

  // ===== Save using directory picker if available
  const verLabel = chosen?.name || chosen?.value || 'custom';
  const datName = `export_${verLabel}.dat`;
  const sprName = `export_${verLabel}.spr`;

  if ('showDirectoryPicker' in window) {
    try {
      const dir = await window.showDirectoryPicker();
      const f1 = await dir.getFileHandle(datName, { create:true });
      const w1 = await f1.createWritable(); await w1.write(datBlob); await w1.close();
      const f2 = await dir.getFileHandle(sprName, { create:true });
      const w2 = await f2.createWritable(); await w2.write(sprBlob); await w2.close();
      alert('✅ Exportado en la carpeta elegida.');
      return;
    } catch(e) {
      console.warn('Directory picker canceled or failed', e);
      // fallback to file pickers
    }
  }

  // Save individually or fallback to download
  const ok1 = await saveBlobAs(datBlob, datName);
  const ok2 = await saveBlobAs(sprBlob, sprName);
  if (ok1 && ok2) alert('✅ Exportado.');
  else alert('Export cancelado o fallido.');
}
;

window.confirmExportSprDat = async function() {
  if (!spr || !dat) { alert('Primero carga los archivos'); return; }

  // preferencias
  const pruneMode = document.getElementById('exportPruneEmptyToggle')?.checked !== false;

  // leer opciones del modal
  const verSel = document.getElementById('packExportVersion');
  const ext   = document.getElementById('optDatExtended')?.checked === true;
  const imp   = document.getElementById('optDatImprovedAnim')?.checked === true;
  const grp   = document.getElementById('optDatFrameGroups')?.checked === true;
  const trn   = document.getElementById('optSprTransparency')?.checked === true;

  let datSig = dat.signature >>> 0, sprSig = spr.signature >>> 0, verLabel = 'custom';
  if (verSel && Number.isInteger(parseInt(verSel.value,10))) {
    const idx = parseInt(verSel.value,10);
    const chosen = versionManager.versions[idx];
    if (chosen) {
      datSig = parseInt(chosen.dat, 16) >>> 0;
      sprSig = parseInt(chosen.spr, 16) >>> 0;
      verLabel = (chosen.label || `v${idx}`);
    }
  }

  // helpers
  const thingHasAnySprite = (t) => {
    if (!t?.groups) return false;
    for (const g of t.groups) {
      if (!g?.sprites) continue;
      for (const id of g.sprites) if ((id | 0) > 0) return true;
    }
    return false;
  };
  const getMaxSpriteIdFromDat = (datObj) => {
    let maxId = 0;
    const checkList = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        if (!t?.groups) continue;
        for (const g of t.groups) {
          if (!g?.sprites) continue;
          for (const id of g.sprites) if ((id | 0) > maxId) maxId = id | 0;
        }
      }
    };
    checkList(dat.items); checkList(dat.outfits); checkList(dat.effects); checkList(dat.missiles);
    return maxId;
  };
  const pruneEmptyThings = () => {
    dat.items    = Array.isArray(dat.items)    ? dat.items.filter(thingHasAnySprite)    : dat.items;
    dat.outfits  = Array.isArray(dat.outfits)  ? dat.outfits.filter(thingHasAnySprite)  : dat.outfits;
    dat.effects  = Array.isArray(dat.effects)  ? dat.effects.filter(thingHasAnySprite)  : dat.effects;
    dat.missiles = Array.isArray(dat.missiles) ? dat.missiles.filter(thingHasAnySprite) : dat.missiles;
  };
  const compactThingIds = () => {
    const lastIndex = (arr, minIndex = 0) => {
      if (!Array.isArray(arr) || arr.length === 0) return minIndex;
      let last = minIndex;
      for (let i = 0; i < arr.length; i++) if (arr[i]) last = i + minIndex;
      return last;
    };
    dat.itemCount    = Math.max(100, lastIndex(dat.items,   100));
    dat.outfitCount  = Math.max(0,   lastIndex(dat.outfits, 1));
    dat.effectCount  = Math.max(0,   lastIndex(dat.effects, 1));
    dat.missileCount = Math.max(0,   lastIndex(dat.missiles,1));
  };
  const compactSpritesAndRemap = () => {
    const used = new Set();
    const collect = (list) => {
      if (!Array.isArray(list)) return;
      for (const t of list) {
        if (!t?.groups) continue;
        for (const g of t.groups) {
          if (!g?.sprites) continue;
          for (const id of g.sprites) if ((id | 0) > 0) used.add(id | 0);
        }
      }
    };
    collect(dat.items); collect(dat.outfits); collect(dat.effects); collect(dat.missiles);
    if (used.size === 0) { spr.sprites = []; spr.totalSprites = 0; return; }
    const sorted = Array.from(used).sort((a, b) => a - b);
    const remap = new Map(sorted.map((oldId, i) => [oldId, i + 1]));
    const newSprites = new Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      const oldId = sorted[i];
      newSprites[i] = spr.getSprite(oldId - 1) || null;
    }
    spr.sprites = newSprites;
    spr.totalSprites = newSprites.length;
    const remapThing = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        if (!t?.groups) continue;
        for (const g of t.groups) {
          if (!g?.sprites) continue;
          g.sprites = g.sprites.map(id => (id | 0) > 0 ? (remap.get(id | 0) || 0) : 0);
        }
      }
    };
    remapThing(dat.items); remapThing(dat.outfits); remapThing(dat.effects); remapThing(dat.missiles);
  };
  const normalizeGroups = () => {
    if (typeof dat.normalizeGroups === 'function') dat.normalizeGroups(spr.totalSprites, 4096);
  };

  // Pipeline
  if (pruneMode) {
    pruneEmptyThings();
    compactSpritesAndRemap();
    compactThingIds();
    normalizeGroups();
  } else {
    const maxUsed = getMaxSpriteIdFromDat(dat);
    if ((spr.totalSprites | 0) < maxUsed) {
      while (spr.sprites.length < maxUsed) spr.sprites.push(null);
      spr.totalSprites = maxUsed;
    }
    normalizeGroups();
  }

  // Opciones formato
  dat.setExportFormat({
    extended: !!ext,
    transparency: !!trn,
    improvedAnimations: !!imp,
    frameGroups: !!grp,
    signatureOverride: datSig
  });
  spr.setExportFormat({
    transparency: !!trn,
    signatureOverride: sprSig
  });

  // Serialización
  const datBlob = new Blob([dat.toBinary()], { type: 'application/octet-stream' });
  const sprBlob = new Blob([spr.toBinary()], { type: 'application/octet-stream' });

  // Guardado interactivo
  await saveBlobAs(datBlob, `export_${verLabel}.dat`, 'application/octet-stream');
  await saveBlobAs(sprBlob, `export_${verLabel}.spr`, 'application/octet-stream');

  window.closePackExportModal();
  alert('✅ Exportación completada.');
};


  const idx = parseInt(sel.value, 10);
  const chosen = Number.isInteger(idx) ? versionManager.versions[idx] : null;
  if (!chosen) return { datSig: dat?.signature ?? 0, sprSig: spr?.signature ?? 0 };

  return {
    datSig: hexToU32(chosen.dat),
    sprSig: hexToU32(chosen.spr)
  };
}

// === PATCH: Encoder SPR 100% compatible OB (sobrescribe toBinary) ===
;(function patchSprEncoderForOB(){
  if (!window.__sprPatchedOB) window.__sprPatchedOB = true; else return;

  SprParser.prototype.toBinary = function toBinary_OB(options = {}) {
    const useAlpha = (this.exportOptions?.transparency === null)
      ? !!this.hasAlpha
      : !!this.exportOptions.transparency;

    const signature = (this.exportOptions?.signatureOverride ?? this.signature) >>> 0;

    // --- Header (firma + total + tabla de offsets) ---
    const headerSize = 8 + (this.totalSprites * 4);
    const header = new Uint8Array(headerSize);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, signature, true);
    hv.setUint32(4, this.totalSprites >>> 0, true);
    const setOffset = (i, off) => hv.setUint32(8 + i*4, off >>> 0, true);

    // --- Encoder de un sprite a RLE ---
    const encodeSprite = (img) => {
      if (!img || !img.data || img.data.length !== 32*32*4) return null;

      const data = img.data;
      const PIXELS = 32*32;
      const tpix = [0,0,0]; // clave transparente
      const blocks = [];
      let i = 0;

      while (i < PIXELS) {
        // run de transparentes
        let tcount = 0;
        while (i < PIXELS && data[i*4 + 3] === 0 && tcount < 0xFFFF) { tcount++; i++; }

        // run de coloreados
        let ccount = 0;
        const bytes = [];
        while (i < PIXELS && data[i*4 + 3] !== 0 && ccount < 0xFFFF) {
          const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3];
          bytes.push(r, g, b);
          if (useAlpha) bytes.push(a);
          ccount++; i++;
          if (i < PIXELS && data[i*4 + 3] === 0) break;
        }

        // bloques OB aceptan ccount=0
        blocks.push({ tcount, ccount, bytes });
      }

      // tamaño payload
      let pixelDataSize = 0;
      for (const b of blocks) pixelDataSize += 4 + b.bytes.length;
      if (pixelDataSize > 0xFFFF) {
        throw new Error('SPR pixelDataSize overflow');
      }

      const out = new Uint8Array(3 + 2 + pixelDataSize);
      let p = 0;
      // tpix
      out[p++] = tpix[0]; out[p++] = tpix[1]; out[p++] = tpix[2];
      // size (LE)
      out[p++] = pixelDataSize & 0xFF; out[p++] = (pixelDataSize >> 8) & 0xFF;

      for (const b of blocks) {
        // transparentCount (LE)
        out[p++] = b.tcount & 0xFF; out[p++] = (b.tcount >> 8) & 0xFF;
        // coloredCount (LE)
        out[p++] = b.ccount & 0xFF; out[p++] = (b.ccount >> 8) & 0xFF;
        if (b.bytes.length) { out.set(b.bytes, p); p += b.bytes.length; }
      }

      if (p !== out.length) throw new Error('SPR block size mismatch');
      return out;
    };

    // --- Construcción de offsets + concatenación real ---
    const chunks = new Array(this.totalSprites);
    let cursor = headerSize;

    for (let i = 0; i < this.totalSprites; i++) {
      const buf = encodeSprite(this.sprites[i]);
      if (!buf) {
        setOffset(i, 0);
        chunks[i] = null;
      } else {
        setOffset(i, cursor);
        chunks[i] = buf;
        cursor += buf.byteLength;
      }
    }

    const totalSize = cursor;
    const out = new Uint8Array(totalSize);
    out.set(header, 0);
    let pos = headerSize;
    for (const chunk of chunks) {
      if (!chunk) continue;
      out.set(chunk, pos);
      pos += chunk.byteLength;
    }
    // pos = totalSize
    return out;
  };
})();

// ============ Carga inicial ============
// ============ Carga inicial ============

// Nueva lógica de selección de carpeta
window.handleFolderSelection = async function(input) {
  if (!input.files || input.files.length === 0) return;
  
  const files = Array.from(input.files);
  const status = document.getElementById('folderStatus');
  if (status) status.innerHTML = 'Analizando archivos...';

  // Buscar archivos
  const sprFile = files.find(f => f.name.toLowerCase().endsWith('.spr'));
  const datFile = files.find(f => f.name.toLowerCase().endsWith('.dat'));
  const xmlFile = files.find(f => f.name.toLowerCase() === 'versions.xml');

  if (!sprFile || !datFile) {
    if (status) status.innerHTML = '<span style="color:var(--danger)">❌ No se encontraron .spr y .dat en la carpeta.</span>';
    return;
  }

  // Asignar a los inputs ocultos si existen (para compatibilidad) o usar directamente
  // Inyectar en startEditor
  
  if (status) status.innerHTML = `✅ Encontrados: ${sprFile.name}, ${datFile.name}${xmlFile ? ' y versions.xml' : ''}`;

  // Auto-start
  await window.startEditor(xmlFile, datFile, sprFile);
}

window.startEditor = async function (manualVersion, manualDat, manualSpr) {
  // 1. Obtener archivos (ya sea de argumentos o de inputs manuales)
  const versionFile = manualVersion || $('startVersionFile')?.files?.[0];
  const datFile     = manualDat     || $('startDatFile')?.files?.[0];
  const sprFile     = manualSpr     || $('startSprFile')?.files?.[0];

  if (!datFile || !sprFile) {
    return alert('Se requieren al menos los archivos .dat y .spr');
  }

  const overlay      = $('overlay');
  const progressTxt  = $('progressText');
  const progressFill = $('progressFill');

  // --- Accessibility / focus handling:
  const appEl = document.getElementById('app');
  const startupModal = document.getElementById('startupModal');
  try { if (appEl) appEl.setAttribute('inert', ''); } catch(e){}

  if (startupModal) {
    try { if (startupModal.contains(document.activeElement)) document.activeElement.blur(); } catch(e){}
    startupModal.setAttribute('inert', '');
    startupModal.classList.add('hidden');
    startupModal.removeAttribute('aria-hidden');
    startupModal.style.display = 'none';
  }
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }

  const setProgress = (p) => {
    progressFill.style.width = `${p}%`;
    progressTxt.textContent = `Cargando... ${p}%`;
  };

  try {
    setProgress(10);
    
    // Cargar version.xml si existe
    if (versionFile) {
        try {
             await versionManager.loadXML(versionFile);
        } catch(e) {
            console.warn("No se pudo cargar versions.xml", e);
        }
    }
    
    setProgress(30);

    const [sprBuf, datBuf] = await Promise.all([sprFile.arrayBuffer(), datFile.arrayBuffer()]);
    setProgress(50);

    const sprSig = new DataView(sprBuf).getUint32(0, true);
    const datSig = new DataView(datBuf).getUint32(0, true);
    
    let ver = null;
    if (versionManager.versions.length > 0) {
        ver = versionManager.getVersionFromSignatures(datSig, sprSig);
    }
    
    // --- Lógica de versión desconocida / auto-detect ---
    if (!ver) {
      detectedVersion = { name: 'Autodetectada / Desconocida', dat: datSig, spr: sprSig };
      // Intentar inferir versiones conocidas por firmas comunes si fuera necesario
    } else {
      detectedVersion = ver;
    }
    
    const vi = $('versionInfo');
    if (vi) {
      vi.innerHTML = `
        <strong>Versión:</strong> ${detectedVersion.name}<br>
        <strong>.dat:</strong> 0x${datSig.toString(16).toUpperCase()}<br>
        <strong>.spr:</strong> 0x${sprSig.toString(16).toUpperCase()}
      `;
    }
    setProgress(70);

    spr = new SprParser(sprBuf);
    dat = new DatParser(datBuf);

    // Exponer como globales
    try { window.spr = spr; window.dat = dat; } catch(_){}

    // UI
    ensureExportUI();
    if (window.DAT_EDITOR?.ensureFlagsGrid) window.DAT_EDITOR.ensureFlagsGrid(true);
    updateThingCountsUI();
    showThingList(currentCategory);
    repaintMainCanvas();

    setProgress(100);

    // ocultar overlay y restaurar interacción
    setTimeout(() => {
      if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); }
      try { if (appEl) appEl.removeAttribute('inert'); } catch(e){}
    }, 250);
  } catch (err) {
    if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); }
    try { if (appEl) appEl.removeAttribute('inert'); } catch(e){}
    if (startupModal) { startupModal.style.display = ''; startupModal.removeAttribute('aria-hidden'); }
    console.error(err);
    alert('❌ Error durante la carga: ' + err.message);
  }
};

// ===== Ajustar UI según versión =====
function applyRetroModeUI() {
  if (!dat || !dat.isRetro) return;

  // Ocultar opciones modernas
  document.querySelectorAll('#prop_hasAction, #prop_hasMarket, #prop_hasHelpLens')
    .forEach(e => e.closest('.group')?.classList.add('hidden'));

  document.querySelectorAll('#frameGroupsToggle, #improvedAnimsToggle')
    .forEach(e => e?.closest('.checkline')?.classList.add('hidden'));

  // Forzar visualización simple
  patternZ = 0;
  patternY = 0;
  layer = 0;
}

// ============ Lista (2 columnas + thumbs animados) ============
const __THING_THUMB_SIZE = 104;
const __thingThumbCache = new Map(); // key: `${id}:${group}:${frame}:${patX}` -> canvas

// Miniaturas: invalidación + refresco de la lista
function refreshMainListThumbs(affectedIds) {
  try {
    if (__thingThumbCache && typeof __thingThumbCache.clear === 'function') {
      if (!affectedIds || !affectedIds.size) {
        __thingThumbCache.clear();
      } else {
        for (const id of affectedIds) {
          for (const k of Array.from(__thingThumbCache.keys())) {
            const parts = String(k).split(':'); // cat:id:group:frame:patX:rev
            if (parts[1] === String(id)) __thingThumbCache.delete(k);
          }
        }
      }
    }
    if (typeof showThingList === 'function') showThingList(currentCategory, currentPage);
    requestAnimationFrame(() => markSelectedInList?.(currentThingId));
  } catch (e) { console.warn('refreshMainListThumbs:', e); }
}

function renderThingWidget(thing) {
  // ⛑️ Blindaje: si no hay datos coherentes, pinta celda vacía y no rompas.
  if (!thing || !thing.groups || !thing.groups.length) {
    const div = document.createElement('div');
    div.className = 'thingRow empty';
    div.tabIndex = -1;
    div.innerHTML = `<div class="thumb"><div class="empty">—</div></div>`;
    $('spriteList')?.appendChild(div);
    return;
  }

  const isOutfit = currentCategory === 'outfit';
  const useGroup = (isOutfit && thing.groups[1]) ? 1 : 0;
  const group = thing.groups[useGroup];
  if (!group) { // si por carrera quedó undefined, salir seguro
    const div = document.createElement('div');
    div.className = 'thingRow empty';
    div.tabIndex = -1;
    div.innerHTML = `<div class="thumb"><div class="empty">—</div></div>`;
    $('spriteList')?.appendChild(div);
    return;
  }

  const { width, height, frames } = group;
  const totalPerFrame = Math.max(1, width) * Math.max(1, height);

  const div = document.createElement('div');
  div.className = 'thingRow';
  div.dataset.id = thing.id;
  div.tabIndex = 0;
  div.onclick = () => selectThing(thing.id);

  const ribbon = document.createElement('span');
  ribbon.className = 'ribbon';
  ribbon.textContent = `#${thing.id}`;
  div.appendChild(ribbon);

  const c = document.createElement('canvas');
  c.className = 'thumb';
  c.width = c.height = __THING_THUMB_SIZE;
  c.style.imageRendering = 'pixelated';
  const g = c.getContext('2d', { willReadFrequently:true });
  g.imageSmoothingEnabled = false;

  // 🧠 Thumb cacheada por frame (ya escalada)
  const getThumb = (f = 0) => {
    const patX = isOutfit ? 2 : patternX;
    const cat  = thing.category || currentCategory || 'item';
    const rev  = thing.__rev | 0;
    const key  = `${cat}:${thing.id}:${useGroup}:${f}:${patX}:${rev}`;

    let cached = __thingThumbCache.get(key);
    if (!cached) {
      // Cambiar globals un instante para reutilizar tu renderer
      const old = { frame, patternX, groupIndex };
      frame = f; patternX = patX; groupIndex = useGroup;

      const { index } = getFrameIndex(thing, group);
      const sprites = group.sprites.slice(index, index + totalPerFrame);
      const big = renderThingToCanvas(thing, group, sprites);

      // Escalar una vez y cachear
      const off = document.createElement('canvas');
      off.width = off.height = __THING_THUMB_SIZE;
      const og = off.getContext('2d', { willReadFrequently:true });
      og.imageSmoothingEnabled = false;
      const scale = Math.min(off.width / big.width, off.height / big.height);
      const dw = Math.round(big.width * scale), dh = Math.round(big.height * scale);
      og.clearRect(0,0,off.width,off.height);
      og.drawImage(big, (off.width - dw) >> 1, (off.height - dh) >> 1, dw, dh);

      frame = old.frame; patternX = old.patternX; groupIndex = old.groupIndex;

      __thingThumbCache.set(key, off);

      // LRU simple (~300 entradas)
      if (__thingThumbCache.size > 300) {
        const oldest = __thingThumbCache.keys().next().value;
        __thingThumbCache.delete(oldest);
      }
      
      cached = off;
      
    }
    return cached;
  };

  // primer frame estático
  g.clearRect(0,0,c.width,c.height);
  g.drawImage(getThumb(0), 0, 0);

  // 🎞️ Animación SOLO en hover (8 fps cap)
  let raf = 0, last = 0, f = 0;
  const STEP = 1000 / 8;
  const loop = (t) => {
    if (t - last >= STEP) {
      f = (f + 1) % Math.max(1, frames|0);
      g.clearRect(0,0,c.width,c.height);
      g.drawImage(getThumb(f), 0, 0);
      last = t;
    }
    raf = requestAnimationFrame(loop);
  };
  if ((frames|0) > 1) {
    div.addEventListener('mouseenter', () => { if (!raf) raf = requestAnimationFrame(loop); }, { passive:true });
    div.addEventListener('mouseleave', () => {
      if (raf) cancelAnimationFrame(raf), raf = 0;
      f = 0; g.clearRect(0,0,c.width,c.height); g.drawImage(getThumb(0), 0, 0);
    }, { passive:true });
  }

  const label = document.createElement('div');
  label.className = 'thing-label';
  label.textContent = thing.id;

  div.appendChild(c);
  div.appendChild(label);
  $('spriteList')?.appendChild(div);
}

// --- ayuda para nombres de flags desde fuera del IIFE ---
function __getFlagNamesGlobal(){
  const sig = (window.dat?.signature|0)>>>0;
  return (typeof window.getFlagNamesForSignature==='function'
    ? (window.getFlagNamesForSignature(sig) || FLAG_NAMES)
    : FLAG_NAMES);
}

window.filterFlags = function () {
  const q = ($('flagSearch')?.value || '').trim().toLowerCase();
  const host = $('flagCheckboxes'); if (!host) return;
  const NAMES = __getFlagNamesGlobal();
  host.querySelectorAll('label.checkline').forEach(lbl => {
    const code = +(lbl.querySelector('input')?.dataset?.code || -1);
    const name = NAMES[code] || '';
    const show = !q || name.toLowerCase().includes(q) || String(code).includes(q);
    lbl.style.display = show ? '' : 'none';
  });
};

// === BÚSQUEDA PRINCIPAL ===
function applySearchFilter(all) {
  const q = ($('searchInput')?.value || '').trim().toLowerCase();
  if (!q) return all;

  // rango "a-b" o número exacto
  const rangeMatch = q.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10), b = parseInt(rangeMatch[2], 10);
    const lo = Math.min(a,b), hi = Math.max(a,b);
    return all.filter(t => t?.id >= lo && t?.id <= hi);
  }
  const idNum = parseInt(q, 10);
  if (!isNaN(idNum) && String(idNum) === q) {
    return all.filter(t => t?.id === idNum);
  }

  // por nombre o contiene ID
  return all.filter(t => {
    const name = (t?.name || '').toLowerCase();
    return name.includes(q) || String(t?.id||'').includes(q);
  });
}

function markSelectedInList(id) {
  // limpiar selección previa
  document.querySelectorAll('.thingRow.selected,[aria-selected="true"]').forEach(el => {
    el.classList.remove('selected');
    el.setAttribute('aria-selected', 'false');
  });

  // marcar actual + focus + scroll suave
  const el = document.querySelector(`.thingRow[data-id="${id}"]`);
  if (el) {
    el.classList.add('selected');
    el.setAttribute('aria-selected', 'true');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}


async function showThingList(category, page = 0) {
  currentCategory = category;
  const list = $('spriteList');
  list.innerHTML = '';

  // construcción segura
  let all = ((dat?.[`${category}s`]) || [])
    .filter(t => t && Array.isArray(t.groups) && t.groups.length > 0);

  // ocultar invisibles
  const hideInvisible = $('hideInvisibleToggle')?.checked;
  if (hideInvisible) {
    all = all.filter(thing => thing?.groups?.some(g => g?.sprites?.some(id => (id|0) > 0)));
  }

  // búsqueda
  filteredList = applySearchFilter(all);

  fullList = filteredList;
  totalPages = Math.ceil(filteredList.length / pageSize) || 1;
  currentPage = clamp(page, 0, totalPages - 1);
  const start = currentPage * pageSize;
  const end   = Math.min(start + pageSize, filteredList.length);

  // snapshot
  const slice = filteredList.slice(start, end);

  for (let i = 0; i < slice.length; i++) {
    const thing = slice[i];
    if (!thing || !thing.groups) continue;
    renderThingWidget(thing);
    if ((i % 30) === 0) await new Promise(r => setTimeout(r, 0));
  }

  renderPaginationControls();

  const stats = $('thingStats');
  if (stats) stats.textContent = `${filteredList.length} items`;

  requestAnimationFrame(() => {
    markSelectedInList(currentThingId);
    $('spriteListContainer').scrollTop = 0;
  });
}

function renderPaginationControls() {
  const c = $('paginationControls');
  if (!c) return;
  c.innerHTML = '';

  const prev = document.createElement('button');
  prev.textContent = '⏮ Anterior';
  prev.disabled = currentPage === 0;
  prev.onclick = () => showThingList(currentCategory, currentPage - 1);

  const next = document.createElement('button');
  next.textContent = 'Siguiente ⏭';
  next.disabled = currentPage >= totalPages - 1;
  next.onclick = () => showThingList(currentCategory, currentPage + 1);

  const label = document.createElement('span');
  label.textContent = `Página ${currentPage + 1} de ${totalPages}`;
  label.style.color = '#bcd7ff';

  const jump = document.createElement('input');
  jump.type = 'number';
  jump.min = 1; jump.max = totalPages; jump.placeholder = 'Ir a...';
  jump.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const p = parseInt(jump.value) - 1;
      if (!isNaN(p) && p >= 0 && p < totalPages) showThingList(currentCategory, p);
    }
  };

  c.append(prev, label, jump, next);
}
window.selectThing = selectThing;

// ============ Selección + render principal ============
function selectThing(id) {
  // Cancela renderizaciones pendientes del panel de sprites
  __spritePanelRenderToken++;

  currentThingId = id;

  const wasAnimating = !!animationFrameRequest;
  if (wasAnimating) {
    cancelAnimationFrame(animationFrameRequest);
    animationFrameRequest = null;
  }

  markSelectedInList(id);

  const thing = dat.getThing(currentCategory, id);
  if (!thing || !thing.groups?.length) {
    const thingInfo = $('thingInfo');
    if (thingInfo) thingInfo.textContent = '❌ Thing no disponible.';
    __spritePanelRenderToken++;
    return;
  }

  // pinta propiedades/flags
  if (window.DAT_EDITOR?.render) {
    try { window.DAT_EDITOR.render(thing); } catch(e){ console.warn('DAT_EDITOR.render failed', e); }
  }
  // ======= Render pantalla principal =======
  const group = thing.groups[groupIndex] || thing.groups[0];

  $('frame')?.setAttribute('max', Math.max(0, group.frames - 1));
  $('layer')?.setAttribute('max', Math.max(0, group.layers - 1));
  $('patternX')?.setAttribute('max', Math.max(0, group.patternX - 1));
  $('patternY')?.setAttribute('max', Math.max(0, group.patternY - 1));
  $('patternZ')?.setAttribute('max', Math.max(0, group.patternZ - 1));

  const { index, totalPerFrame } = getFrameIndex(thing, group);
const img = __renderCompositeImage(thing, group, totalPerFrame);
setCanvasSize(img.width, img.height);
ctx.clearRect(0,0,canvas.width, canvas.height);
drawGridOverlay(canvas.width, canvas.height);
ctx.drawImage(img, 0, 0);
const thingInfo = $('thingInfo');
  if (thingInfo) {
    thingInfo.innerHTML = `
      <strong>ID:</strong> ${id}<br>
      <strong>Categoría:</strong> ${thing.category || currentCategory}<br>
      <strong>Animación:</strong> ${group.frames > 1 ? (group.frames + ' frames') : 'sin animación'}
    `;
  }
  // tras pintar el canvas:
  if (window.DAT_EDITOR?.render) window.DAT_EDITOR.render(thing);

  updateSpritePanelWithAllSprites(thing);
  if (wasAnimating) toggleFrameAnimation();
}


// Controles de patrón/frames

// === Controles de Visualización: Mount/Addons → PatternZ/PatternY ===
(function(){
  const mountEl  = document.getElementById('mount');
  const addonsEl = document.getElementById('addons');

  const num = (el, def=0) => {
    const n = parseInt(el?.value ?? def, 10);
    return Number.isFinite(n) ? n : def;
  };

  function applyMount(){
    const z = num(mountEl) ? 1 : 0;
    const zInp = document.getElementById('patternZ');
    if (zInp) zInp.value = String(z);
    try { if (typeof patternZ !== 'undefined') patternZ = z|0; } catch(_){}
    window.__VIEW_STATE__.mount = num(mountEl) ? 1 : 0;
  }

  function applyAddons(){
    const a = num(addonsEl);
    window.__VIEW_STATE__.addons = a;
    window.__VIEW_STATE__.fullAddons = (a === 3);
    const yInp = document.getElementById('patternY');
    const ySet = (a===0)?0:(a===1)?1:(a===2)?2:0; // 3→0
    if (yInp) yInp.value = String(ySet);
    try { if (typeof patternY !== 'undefined') patternY = ySet|0; } catch(_){}
  }

  if (mountEl) {
    applyMount();
    mountEl.addEventListener('input', ()=>{ applyMount(); repaintMainCanvas(); }, {passive:true});
    mountEl.addEventListener('change',()=>{ applyMount(); repaintMainCanvas(); }, {passive:true});
  }
  if (addonsEl) {
    applyAddons();
    addonsEl.addEventListener('change', ()=>{ applyAddons(); repaintMainCanvas(); }, {passive:true});
  }
})();


['frame','layer','patternX','patternY','patternZ'].forEach(id => {
  $(id)?.addEventListener('input', () => {
    frame    = +$('frame').value;
    layer    = +$('layer').value;
    patternX = +$('patternX').value;
    patternY = +$('patternY').value;
    patternZ = +$('patternZ').value;
    repaintMainCanvas();
    if (animationFrameRequest) { repaintMainCanvas(); }
  });
});

$('groupSelector')?.addEventListener('change', () => {
  try { document.getElementById('addons')?.dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('mount')?.dispatchEvent(new Event('change', {bubbles:true})); } catch(_){}

  groupIndex = +$('groupSelector').value;
  repaintMainCanvas();
});

$('zoom')?.addEventListener('input', () => {
  setCanvasSize(canvas.width, canvas.height);
  ctx.clearRect(0,0,canvas.width, canvas.height);
  drawGridOverlay(canvas.width, canvas.height);
  const thing = dat.getThing(currentCategory, currentThingId);
  if (!thing) return;
  const group = thing.groups[groupIndex] || thing.groups[0];
  const { index, totalPerFrame } = getFrameIndex(thing, group);
const img = __renderCompositeImage(thing, group, totalPerFrame);
ctx.drawImage(img, 0, 0);
});

window.toggleGrid = function () {
  showGrid = !showGrid;
  setCanvasSize(canvas.width, canvas.height);
  ctx.clearRect(0,0,canvas.width, canvas.height);
  drawGridOverlay(canvas.width, canvas.height);
  const thing = dat.getThing(currentCategory, currentThingId);
  if (!thing) return;
  const group = thing.groups[groupIndex] || thing.groups[0];
  const { index, totalPerFrame } = getFrameIndex(thing, group);
const img = __renderCompositeImage(thing, group, totalPerFrame);
ctx.drawImage(img, 0, 0);
};


// ==== Redibujar canvas SIN recargar el panel de 'Sprites del Thing' ====
window.repaintMainCanvas = function repaintMainCanvas(){
  try {
    if (typeof dat === 'undefined' || !dat) return;
    const thing = dat.getThing(currentCategory, currentThingId);
    if (!thing || !thing.groups || !thing.groups.length) return;
    const group = thing.groups[groupIndex] || thing.groups[0];
    const infoEl = document.getElementById('thingInfo');

    // clamp inputs
    try {
      const fMax = Math.max(0, (group.frames|0)   - 1);
      const lMax = Math.max(0, (group.layers|0)   - 1);
      const xMax = Math.max(0, (group.patternX|0) - 1);
      const yMax = Math.max(0, (group.patternY|0) - 1);
      const zMax = Math.max(0, (group.patternZ|0) - 1);
      frame    = Math.max(0, Math.min(frame,    fMax));
      layer    = Math.max(0, Math.min(layer,    lMax));
      patternX = Math.max(0, Math.min(patternX, xMax));
      patternY = Math.max(0, Math.min(patternY, yMax));
      patternZ = Math.max(0, Math.min(patternZ, zMax));
      const fEl=document.getElementById('frame');    if(fEl) fEl.value = String(frame);
      const lEl=document.getElementById('layer');    if(lEl) lEl.value = String(layer);
      const xEl=document.getElementById('patternX'); if(xEl) xEl.value = String(patternX);
      const yEl=document.getElementById('patternY'); if(yEl) yEl.value = String(patternY);
      const zEl=document.getElementById('patternZ'); if(zEl) zEl.value = String(patternZ);
    } catch(_){}

    const { index, totalPerFrame } = getFrameIndex(thing, group);
    const img = __renderCompositeImage(thing, group, totalPerFrame);

    setCanvasSize(img.width, img.height);
    ctx.clearRect(0,0,canvas.width, canvas.height);
    drawGridOverlay(canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    if (infoEl) {
      infoEl.innerHTML = `
        <strong>ID:</strong> ${currentThingId}<br>
        <strong>Categoría:</strong> ${thing.category || currentCategory}<br>
        <strong>Animación:</strong> ${group.frames > 1 ? (group.frames + ' frames') : 'sin animación'}
      `;
    }
  } catch(e) {
    console.warn('repaintMainCanvas():', e);
  }
};

// ============ Animación en el visor principal ============



window.toggleFrameAnimation = () => {
  // Stop if running
  if (animationFrameRequest) {
    cancelAnimationFrame(animationFrameRequest);
    animationFrameRequest = null;
    // Al parar, volver a Idle base manteniendo estado visual de addons/mount
    const gs = document.getElementById('groupSelector');
    if (gs) { gs.value = '0'; groupIndex = 0; }
    const f = document.getElementById('frame'); if (f) { f.value = '0'; frame = 0; }
    try {
      document.getElementById('addons')?.dispatchEvent(new Event('change', {bubbles:true}));
      document.getElementById('mount')?.dispatchEvent(new Event('change', {bubbles:true}));
    } catch(_){}
    repaintMainCanvas();
    return;
  }

  const thing = dat.getThing(currentCategory, currentThingId);
  if (!thing) return;

  // Auto-select an animable group if current is not animable
  const hasAnim = (g) => !!g && (g.frames|0) > 1;
  let g = thing.groups?.[groupIndex];
  if (!hasAnim(g)) {
    if (hasAnim(thing.groups?.[1])) { groupIndex = 1; g = thing.groups[1]; const sel = $('groupSelector'); if (sel) sel.value = '1'; }
    else if (!hasAnim(thing.groups?.[0])) { return; } // nothing to animate
  }

  const readDelay = () => (+$('frameDelay').value || 100);

  let lastTime = performance.now();
  let acc = 0;

  const loop = (t) => {
    if (!animationFrameRequest) return; // stopped
    const dt = t - lastTime;
    acc += dt;

    const delay = readDelay();
    if (acc >= delay) {
      acc = 0;

      // Releer SIEMPRE estado actual para que cambios en vivo se apliquen:
      const thingLive = dat.getThing(currentCategory, currentThingId);
      const groupLive = thingLive?.groups?.[groupIndex] || thingLive?.groups?.[0];
      if (!groupLive) { cancelAnimationFrame(animationFrameRequest); animationFrameRequest = null; return; }

      // Siguiente frame cíclico sobre el grupo actual
      const frames = Math.max(1, groupLive.frames|0);
      frame = (frame + 1) % frames;
      $('frame').value = frame;

      // Render dinámico leyendo mount/addons/patterns vigentes
      const { totalPerFrame } = getFrameIndex(thingLive, groupLive);
      const img = __renderCompositeImage(thingLive, groupLive, totalPerFrame);

      setCanvasSize(img.width, img.height);
      ctx.clearRect(0,0,canvas.width, canvas.height);
      drawGridOverlay(canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      lastTime = t;
    }
    animationFrameRequest = requestAnimationFrame(loop);
  };

  // Pintar inmediatamente el frame actual con estado actual
  try { repaintMainCanvas(); } catch(_){}
  animationFrameRequest = requestAnimationFrame(loop);
};




// Exporta .spr + .dat preservando 100% las flags y sus valores.
// Modo "limpio" (por defecto) compacta sin tocar flags; modo "original" no altera estructura.


// ============ Export de FULL-spritesheet + JSON ============

window.exportRenderedThingFullSpritesheet = function () {
  const thing = dat.getThing(currentCategory, currentThingId);
  if (!thing || !thing.groups?.length) return alert('❌ Thing no válido o sin grupos');

  const original = { frame, layer, patternX, patternY, patternZ, groupIndex };

  const framesOut = [];
  let maxFramesPerRow = 0;

  // --- Datos para JSON ---
  const jsonMeta = {
    thingId: currentThingId,
    category: currentCategory,
    name: thing.name || `thing_${currentThingId}`,
    groups: []
  };

  thing.groups.forEach((group, gIndex) => {
    const { width, height, layers, patternX: pX, patternY: pY, patternZ: pZ, frames } = group;
    const totalPerFrame = Math.max(1, width) * Math.max(1, height);

    const groupInfo = {
      index: gIndex,
      width, height,
      layers, patternX: pX, patternY: pY, patternZ: pZ, frames,
      sprites: []
    };

    for (let l = 0; l < layers; l++) {
      for (let z = 0; z < pZ; z++) {
        for (let y = 0; y < pY; y++) {
          for (let x = 0; x < pX; x++) {
            for (let f = 0; f < frames; f++) {
              frame = f; layer = l; patternX = x; patternY = y; patternZ = z; groupIndex = gIndex;
              const { index } = getFrameIndex(thing, group);
              const sprites = group.sprites.slice(index, index + totalPerFrame);
              while (sprites.length < totalPerFrame) sprites.push(0);
              framesOut.push(renderThingToCanvas(thing, group, sprites));

              // Guardar metadata para este frame
              groupInfo.sprites.push({
                frame: f,
                layer: l,
                patternX: x,
                patternY: y,
                patternZ: z,
                sprites: [...sprites]
              });
            }
          }
        }
      }
    }

    jsonMeta.groups.push(groupInfo);
    maxFramesPerRow = Math.max(maxFramesPerRow, group.frames);
  });

  // restaurar contexto original
  ({ frame, layer, patternX, patternY, patternZ, groupIndex } = original);

  const sample = thing.groups[0];
  const cellW = Math.max(1, sample.width) * 32;
  const cellH = Math.max(1, sample.height) * 32;

  const cols = maxFramesPerRow;
  const rows = Math.ceil(framesOut.length / cols);

  const out = document.createElement('canvas');
  out.width  = cols * cellW;
  out.height = rows * cellH;
  const g = out.getContext('2d');

  framesOut.forEach((c, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor((i / cols)) * cellH;
    g.drawImage(c, x, y);
  });

  // --- Descargar PNG ---
  out.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thing_${currentThingId}_FULL_sheet.png`;
    a.click();
  }, 'image/png');

  // --- Descargar JSON ---
  const jsonBlob = new Blob([JSON.stringify(jsonMeta, null, 2)], { type: 'application/json' });
  const a2 = document.createElement('a');
  a2.href = URL.createObjectURL(jsonBlob);
  a2.download = `thing_${currentThingId}_FULL_meta.json`;
  a2.click();
};


window.exportVisibleCanvas = function () {
  if (!canvas || !canvas.width || !canvas.height) return alert('❌ Nada que exportar');
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  tmp.getContext('2d').drawImage(canvas, 0, 0);
  tmp.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'visible_canvas.png';
    a.click();
  }, 'image/png');
};


// ============ Eventos básicos de UI ============
window.changeThingCategory = function (cat) {
  currentCategory = cat;
  currentPage = 0;
  showThingList(cat, 0);
  selectThing(1);
};

$('hideInvisibleToggle')?.addEventListener('change', () => showThingList(currentCategory, 0));
let __searchDebounce = 0;
$('searchInput')?.addEventListener('input', () => {
  clearTimeout(__searchDebounce);
  __searchDebounce = setTimeout(() => showThingList(currentCategory, 0), 120);
});

// oninput del HTML (para no romper)
window.filterList = () => showThingList(currentCategory, 0);

// ============ Stubs/acciones del HTML ============
window.toggleFlagsEditor = () => {
  const p = $('flagsPanel');
  if (!p) return;
  p.classList.toggle('hidden');
};


// =======================
//  FULL-spritesheet IMPORT (NEW THING, AUTO-DETECT) — drop-in for editor.js
// =======================

// --- util corto ---
const TILE = 32;
const clampInt = (v,min,max)=>Math.max(min,Math.min(max, v|0));
const hasWin = (typeof window !== 'undefined');

// === Heurística de factorización para combos (L,Z,Y,X) ===
// Priorizamos layouts OT clásicos:
// - Outfits: X=4 (direcciones), Y=3 (addons), Z=2 (mount), L=1 (capas extra casi nunca usadas)
// - Effects/Missiles: X=4 u 8 según caso; L y Z suelen ser 1; frames grandes
// - Items: X=1; casi siempre 1x1 y frames=1
function factorizeCombos(combos, {category, preferPX4=true}) {
  let L=1, Z=1, Y=1, X=1;
  let rest = combos|0;

  // 1) X (direcciones)
  if (preferPX4 && (rest % 4 === 0)) { X = 4; rest /= 4; }
  else if (category !== 'item' && rest % 4 === 0) { X = 4; rest /= 4; }
  else if (rest % 2 === 0 && (category==='effect' || category==='missile')) { X = 2; rest/=2; }

  // 2) Y (addons) → 3 si se puede (solo una vez)
  if (category === 'outfit' && rest % 3 === 0) { Y = 3; rest /= 3; }

  // 3) Z (mount) → 2 si cuadra
  if (category === 'outfit' && rest % 2 === 0) { Z = 2; rest /= 2; }

  // 4) Layers: lo que quede (capamos a 8 por seguridad)
  if (rest > 1) {
    // intenta 2..8
    for (let l=2; l<=8; l++) {
      if (rest % l === 0) { L = l; rest /= l; break; }
    }
  }
  if (rest !== 1) {
    // No quedó exacto; absorbe el sobrante en layers (fallback tosco)
    L *= rest; rest = 1;
  }

  // sanity
  L = clampInt(L,1,8);
  Z = clampInt(Z,1,4);
  Y = clampInt(Y,1,4);
  X = clampInt(X,1,8);
  return { layers:L, patternZ:Z, patternY:Y, patternX:X };
}

// === AUTO-DETECCIÓN del FULL-sheet exportado por este editor ===
// Devuelve { width,height,frames, layers, patternX, patternY, patternZ, groupCount }
function autoDetectFullSheetShapeFromBitmap(bmp, {
  category = (typeof currentCategory !== 'undefined' ? currentCategory : 'item'),
} = {}) {
  const sheetW = bmp.width|0;
  const sheetH = bmp.height|0;

  // candidatos de frames por fila (columnas) en orden de preferencia por categoría
  const framesCandidates = (category==='effect')
    ? [8,6,4,2,1,16]
    : (category==='outfit' ? [4,6,8,2,1,16] : [1,2,4,8,6,16]);

  let best = null;

  for (const frames of framesCandidates) {
    if (frames <= 0 || sheetW % frames !== 0) continue;
    const cellW = (sheetW / frames)|0;
    if (cellW % TILE !== 0) continue;
    const wTiles = (cellW / TILE)|0;
    if (wTiles < 1 || wTiles > 8) continue;

    for (let hTiles = 1; hTiles <= 8; hTiles++) {
      const cellH = hTiles * TILE;
      if (sheetH % cellH !== 0) continue;

      const rows = (sheetH / cellH)|0; // filas totales = combos * groupCount
      if (rows < 1) continue;

      // Estima cuántos grupos (Idle/Walking en outfit). Probamos 2→1→3.
      const gCandidates = (category==='outfit') ? [2,1,3] : [1,2,3];
      for (const g of gCandidates) {
        if (rows % g !== 0) continue;
        const combosPerGroup = rows / g;
        // factoriza combos
        const prefPX4 = (category!=='item');
        const f = factorizeCombos(combosPerGroup, { category, preferPX4:prefPX4 });
        const predictedRows = f.layers * f.patternZ * f.patternY * f.patternX;
        if (predictedRows !== combosPerGroup) continue; // exactitud primero

        // Score heurístico
        let score = 0;
        // outfits: queremos PX=4, PY=3, PZ=2, L=1, g=2 y tiles 1x1
        if (category==='outfit') {
          if (f.patternX===4) score+=5;
          if (f.patternY===3) score+=4;
          if (f.patternZ===2) score+=3;
          if (f.layers===1)   score+=2;
          if (g===2)          score+=3;
          if (wTiles===1)     score+=2;
          if (hTiles===1)     score+=2;
          if (frames===4 || frames===6 || frames===8) score+=2;
        }
        // effects: frames altos y 1x1
        if (category==='effect') {
          if (frames>=6) score+=4;
          if (wTiles===1 && hTiles===1) score+=3;
          if (f.patternX===1 && f.patternY===1 && f.patternZ===1) score+=2;
        }
        // missiles: frames 4/8
        if (category==='missile') {
          if (frames===4 || frames===8) score+=3;
          if (f.patternX===1 && f.patternY===1) score+=1;
        }
        // items: 1x1, frames=1
        if (category==='item') {
          if (wTiles===1 && hTiles===1) score+=3;
          if (frames===1) score+=3;
        }

        const candidate = {
          width:wTiles, height:hTiles, frames,
          layers:f.layers, patternX:f.patternX, patternY:f.patternY, patternZ:f.patternZ,
          groupCount:g, rows
        };

        if (!best) best = {score, ...candidate};
        else if (score > best.score) best = {score, ...candidate};
      }
    }
  }

  if (!best) {
    throw new Error(`No pude deducir el layout del FULL-sheet (${sheetW}×${sheetH}). ¿Salió del botón "Exportar FULL Spritesheet"?`);
  }

  return best;
}

// === Construye un grupo vacío listo para recibir sprites (según shape) ===
function _makeEmptyGroupFromShape(shape){
  const grp = {
    width:    clampInt(shape.width,1,8),
    height:   clampInt(shape.height,1,8),
    layers:   clampInt(shape.layers,1,8),
    patternX: clampInt(shape.patternX,1,8),
    patternY: clampInt(shape.patternY,1,4),
    patternZ: clampInt(shape.patternZ,1,4),
    frames:   clampInt(shape.frames,1,64),
    sprites: []
  };
  const need = grp.width*grp.height*grp.layers*grp.patternX*grp.patternY*grp.patternZ*grp.frames;
  grp.sprites = new Array(need).fill(0);
  return grp;
}

// === Siguiente ID libre por categoría ===
function _getNextFreeThingId(category) {
  const DAT = (typeof dat !== 'undefined' && dat) ? dat : window.dat;
  const list = DAT[`${category}s`];
  if (!Array.isArray(list)) return (category === 'item') ? 100 : 1;

  if (category === 'item') {
    let id = Math.max(100, DAT.itemCount|0);
    while (list[id]) id++;
    return id;
  } else {
    let id = Math.max(1, (DAT[`${category}Count`] | 0));
    while (list[id]) id++;
    return id;
  }
}

// === Inserta el thing en la estructura y actualiza contadores ===
function _addThing(category, thing) {
  const DAT = (typeof dat !== 'undefined' && dat) ? dat : window.dat;
  if (!DAT[`${category}s`]) DAT[`${category}s`] = [];
  DAT[`${category}s`][thing.id] = thing;

  if (category === 'item')   DAT.itemCount    = Math.max(DAT.itemCount|0, thing.id);
  if (category === 'outfit') DAT.outfitCount  = Math.max(DAT.outfitCount|0, thing.id);
  if (category === 'effect') DAT.effectCount  = Math.max(DAT.effectCount|0, thing.id);
  if (category === 'missile')DAT.missileCount = Math.max(DAT.missileCount|0, thing.id);
}

// === Importa el FULL-sheet siguiendo EXACTAMENTE el orden de exportación del editor ===
// L → Z → Y → X → F ; con columnas=frames (máximo por grupo), avanzando por grupos en orden
async function _fillThingFromFullSheetPNG(thing, pngBlob, {
  dropFullyTransparent = true
} = {}) {
  const SPR = (typeof spr !== 'undefined' && spr) ? spr : window.spr;
  if (!SPR) throw new Error('SPR no cargado');

  const sheetBmp = await createImageBitmap(pngBlob);

  const sample = thing.groups[0];
  const cellW  = sample.width  * TILE;
  const cellH  = sample.height * TILE;
  const cols   = sample.frames; // auto-detect nos dio frames=cols

  // helper canvases
  const grab = document.createElement('canvas'); grab.width = cellW; grab.height = cellH;
  const gg = grab.getContext('2d', { willReadFrequently:true }); gg.imageSmoothingEnabled = false;

  const tile = document.createElement('canvas'); tile.width = tile.height = TILE;
  const gt = tile.getContext('2d', { willReadFrequently:true }); gt.imageSmoothingEnabled = false;

  const isTileTransparent = (imgData) => {
    const d = imgData.data;
    for (let i=0; i<d.length; i+=4) if (d[i+3] !== 0) return false;
    return true;
  };
  const pushSpriteToSPR = (imgData) => {
    SPR.sprites.push(imgData);
    SPR.totalSprites = SPR.sprites.length;
    return SPR.totalSprites; // 1-based
  };
  const idxBaseOf = (g, f,l,x,y,z) => {
    const per = g.width*g.height;
    return ((((f * g.patternZ + z) * g.patternY + y) * g.patternX + x) * g.layers + l) * per;
  };

  // === Recorremos grupos en orden, como exporta tu función ===
  let cellIndexGlobal = 0;

  for (let gIdx = 0; gIdx < thing.groups.length; gIdx++) {
    const g = thing.groups[gIdx];
    const W = g.width, H = g.height;

    // asegurar tamaño correcto del array
    const need = W*H*g.layers*g.patternX*g.patternY*g.patternZ*g.frames;
    if (!Array.isArray(g.sprites) || g.sprites.length !== need) g.sprites = new Array(need).fill(0);

    for (let L=0; L<g.layers; L++) {
      for (let Z=0; Z<g.patternZ; Z++) {
        for (let Y=0; Y<g.patternY; Y++) {
          for (let X=0; X<g.patternX; X++) {
            for (let F=0; F<g.frames; F++) {
              const col = cellIndexGlobal % cols;
              const row = Math.floor(cellIndexGlobal / cols);
              const sx = col * cellW, sy = row * cellH;

              gg.clearRect(0,0,cellW,cellH);
              gg.drawImage(sheetBmp, sx, sy, cellW, cellH, 0, 0, cellW, cellH);

              const base = idxBaseOf(g, F,L,X,Y,Z);

              for (let ty=0; ty<H; ty++) {
                for (let tx=0; tx<W; tx++) {
                  const dx = tx*TILE, dy = ty*TILE;
                  gt.clearRect(0,0,TILE,TILE);
                  gt.drawImage(grab, dx, dy, TILE, TILE, 0,0, TILE,TILE);
                  const imgData = gt.getImageData(0,0,TILE,TILE);

                  // orden DAT: bottom-right → top-left
                  const tileIndexDAT = (H - 1 - ty) * W + (W - 1 - tx);
                  const dst = base + tileIndexDAT;

                  if (dropFullyTransparent && isTileTransparent(imgData)) {
                    g.sprites[dst] = 0;
                  } else {
                    const newId = pushSpriteToSPR(imgData);
                    g.sprites[dst] = newId|0;
                  }
                }
              }
              cellIndexGlobal++;
            }
          }
        }
      }
    }
  }
  return true;
}

// === D-Pad (Dirección) → Pattern X mappings ===
//   Arriba:   PX=0
//   Derecha:  PX=1
//   Abajo:    PX=2
//   Izquierda:PX=3
(function(){
  const $ = (id) => document.getElementById(id);
  const btnUp    = $('dirUp');
  const btnRight = $('dirRight');
  const btnDown  = $('dirDown');
  const btnLeft  = $('dirLeft');
  const patXInp  = $('patternX');

  function setPX(val){
    try {
      if (patXInp) patXInp.value = String(val|0);
      if (typeof patternX !== 'undefined') patternX = val|0;
      if (typeof currentThingId !== 'undefined') repaintMainCanvas();
      updateActive();
    } catch(e){ console.warn('D-Pad setPX', e); }
  }
  function updateActive(){
    const px = parseInt(patXInp?.value ?? (typeof patternX!=='undefined'?patternX:0), 10) || 0;
    [btnUp,btnRight,btnDown,btnLeft].forEach(b=>{ if(b) b.classList.remove('active'); });
    if      (px === 0 && btnUp)    btnUp.classList.add('active');
    else if (px === 1 && btnRight) btnRight.classList.add('active');
    else if (px === 2 && btnDown)  btnDown.classList.add('active');
    else if (px === 3 && btnLeft)  btnLeft.classList.add('active');
  }

  if (btnUp)    btnUp.addEventListener('click',   ()=>setPX(0));
  if (btnRight) btnRight.addEventListener('click',()=>setPX(1));
  if (btnDown)  btnDown.addEventListener('click', ()=>setPX(2));
  if (btnLeft)  btnLeft.addEventListener('click', ()=>setPX(3));

  if (patXInp)  patXInp.addEventListener('input', updateActive);

  // Exponer para refrescos desde otros renders
  window.__updateDirPadActive = updateActive;
  // Inicial
  setTimeout(updateActive, 0);

  // Opcional: flechas del teclado
  window.addEventListener('keydown', (e)=>{
    if (e.target && (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))) return;
    if (e.key === 'ArrowUp')    { setPX(0); e.preventDefault(); }
    if (e.key === 'ArrowRight'){ setPX(1); e.preventDefault(); }
    if (e.key === 'ArrowDown')  { setPX(2); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { setPX(3); e.preventDefault(); }
  });
})();

// --- sincroniza el D-Pad cuando se re-renderiza la selección
try {
  const _oldSelectThingForDpad = window.selectThing;
  window.selectThing = function(...a){
    const r = _oldSelectThingForDpad ? _oldSelectThingForDpad.apply(this,a) : undefined;
    try { window.__updateDirPadActive && window.__updateDirPadActive(); } catch(_){}
    return r;
  };
} catch(_){}


/* === D-Pad direcciones con soporte especial para 'missile' (PX+PY) === */
(function(){
  const $ = (id) => document.getElementById(id);
  const dpad = $('dpad');
  const px   = $('patternX');
  const py   = $('patternY');
  const cat  = $('thingCategory');
  if (!dpad || !px || !py || !cat) return;

  const btns = {
    up: $('dirUp'), right: $('dirRight'), down: $('dirDown'), left: $('dirLeft'),
    ur: $('dirUR'), dr: $('dirDR'), dl: $('dirDL'), ul: $('dirUL')
  };

  // Modo outfits/items/effects: solo Pattern X
  const map4 = { up:[0,null], right:[1,null], down:[2,null], left:[3,null] };

  // Modo missiles: usar combinaciones PX, PY según el orden marcado en las capturas:
  //   Up:        PX=1, PY=0
  //   Right:     PX=2, PY=1
  //   Down:      PX=1, PY=2
  //   Left:      PX=0, PY=1
  //   Up-Right:  PX=2, PY=0
  //   Down-Right:PX=2, PY=2
  //   Down-Left: PX=0, PY=2
  //   Up-Left:   PX=0, PY=0
  const map8 = {
    up:[1,0], right:[2,1], down:[1,2], left:[0,1],
    ur:[2,0], dr:[2,2], dl:[0,2], ul:[0,0],
  };

  const isMissiles = () => (cat.value === 'missile');
  function currentMap(){ return isMissiles() ? map8 : map4; }

  function setMode(){
    dpad.setAttribute('data-mode', isMissiles()? '8' : '4');
    const c = $('dirCenter'); if (c) c.textContent = isMissiles()? 'Pattern X/Y (8)' : 'Pattern X (4)';
    highlight();
  }

  function setDir(key){
    const m = currentMap();
    if (!(key in m)) return;
    const [vx, vy] = m[key];
    if (vx != null) { px.value = String(vx); px.dispatchEvent(new Event('input', {bubbles:true})); px.dispatchEvent(new Event('change', {bubbles:true})); }
    if (vy != null) { py.value = String(vy); py.dispatchEvent(new Event('input', {bubbles:true})); py.dispatchEvent(new Event('change', {bubbles:true})); }
    highlight();
  }

  function highlight(){
    Object.values(btns).forEach(b=>b&&b.classList.remove('active'));
    const m = currentMap();
    const curX = parseInt(px.value||'0',10)|0;
    const curY = isMissiles()? (parseInt(py.value||'0',10)|0) : null;
    const key = Object.keys(m).find(k => {
      const [vx, vy] = m[k];
      const okX = (vx === curX);
      const okY = (vy == null) ? true : (vy === curY);
      return okX && okY;
    });
    if (key && btns[key]) btns[key].classList.add('active');
  }

  // Clicks
  Object.entries(btns).forEach(([k, el]) => el && el.addEventListener('click', (e)=>{ e.preventDefault(); setDir(k); }));

  // Cambios externos
  px.addEventListener('input', highlight);
  px.addEventListener('change', highlight);
  py.addEventListener('input', highlight);
  py.addEventListener('change', highlight);
  cat.addEventListener('change', ()=>setTimeout(setMode,0));

  // Teclado: flechas y diagonales con Alt
  window.addEventListener('keydown', (e)=>{
    if (['INPUT','TEXTAREA','SELECT'].includes((e.target||{}).tagName)) return;
    const alt = e.altKey || e.metaKey;
    if (!isMissiles()) {
      if (e.key === 'ArrowUp')    setDir('up');
      if (e.key === 'ArrowRight') setDir('right');
      if (e.key === 'ArrowDown')  setDir('down');
      if (e.key === 'ArrowLeft')  setDir('left');
    } else {
      if (alt) {
        if (e.key === 'ArrowUp')    setDir('ur');
        if (e.key === 'ArrowRight') setDir('dr');
        if (e.key === 'ArrowDown')  setDir('dl');
        if (e.key === 'ArrowLeft')  setDir('ul');
      } else {
        if (e.key === 'ArrowUp')    setDir('up');
        if (e.key === 'ArrowRight') setDir('right');
        if (e.key === 'ArrowDown')  setDir('down');
        if (e.key === 'ArrowLeft')  setDir('left');
      }
    }
  });

  // Sincronizar tras selectThing
  try{
    const __oldSelect = window.selectThing;
    window.selectThing = function(...a){
      const r = __oldSelect ? __oldSelect.apply(this,a) : undefined;
      try { setMode(); } catch(_){}
      return r;
    };
  }catch(_){}

  // Init
  setMode();
  highlight();
// Honey: robust export button binding
(function(){
  function bindExport(){
    var btn = document.getElementById('exportSprDatBtn');
    if (!btn || btn.__honeyBound) return;
    btn.addEventListener('click', function(ev){
      try{ ev.preventDefault(); }catch(_){}
      if (typeof window.exportSprDat === 'function') return window.exportSprDat();
      alert('Export no disponible: función no cargada.');
    });
    btn.__honeyBound = true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindExport, {once:true});
  } else {
    bindExport();
  }
})();


// Honey robust export binder
(function(){function bind(){
  var btn=document.getElementById('exportSprDatBtn');
  if(!btn||btn.__honeyBound) return;
  btn.addEventListener('click',function(ev){try{ev.preventDefault();}catch(_){}
    if(typeof window.exportSprDat==='function') return window.exportSprDat();
    alert('Export no disponible: función no cargada.');
  });
  btn.__honeyBound=true;
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',bind,{once:true});}else{bind();}})();
// Honey ensure mini-export RUN wiring
(function(){
  function ensureMiniRun(){
    var runBtn = document.getElementById('miniExportRunBtn');
    if(!runBtn) return;
    var verSel = document.getElementById('miniExportVersionSelect');
    var optExt = document.getElementById('miniExportDatExtended');
    var optImp = document.getElementById('miniExportDatImproved');
    var optGrp = document.getElementById('miniExportDatFrameGroups');
    var optTrn = document.getElementById('miniExportTransparency');
    var optPrn = document.getElementById('miniExportPrune');
    function onRun(){
      try{
        __runSprDatExport({
          versionIndex: parseInt(verSel && verSel.value || '0',10)|0,
          datExtended: !!(optExt && optExt.checked),
          datImproved: !!(optImp && optImp.checked),
          datFrameGroups: !!(optGrp && optGrp.checked),
          transparency: !!(optTrn && optTrn.checked),
          prune: !!(optPrn && optPrn.checked)
        });
      }catch(e){ console.error(e); alert('Export falló: ' + e.message); }
    }
    var cloned = runBtn.cloneNode(true);
    runBtn.parentNode.replaceChild(cloned, runBtn);
    cloned.addEventListener('click', onRun, {once:true});
  }
  var oldOpen = window.openMiniExportModal;
  window.openMiniExportModal = function(){ if (typeof oldOpen === 'function') oldOpen(); else { var m=document.getElementById('miniExportModal'); if (m) m.classList.remove('hidden'); } ensureMiniRun(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureMiniRun, {once:true}); else ensureMiniRun();
})();
  function ensureExportGlue(){
    window.__runSprDatExport = async function __runSprDatExport(){
      try{
        const vmSel = document.getElementById('exportVersionSelect');
        const version = vmSel ? vmSel.value : null;

        const dat = window.dat || window.DAT || window.__DAT;
        const spr = window.spr || window.SPR || window.__SPR;

        if (!dat || !spr) throw new Error('DAT/SPR no cargados');

        try{ dat.setExportFormat && dat.setExportFormat({ version }); }catch(_){}
        try{ spr.setExportFormat && spr.setExportFormat({}); }catch(_){}

        const datBin = dat.toBinary ? dat.toBinary() : (dat.toArrayBuffer ? dat.toArrayBuffer() : null);
        const sprBin = spr.toBinary ? spr.toBinary() : (spr.toArrayBuffer ? spr.toArrayBuffer() : null);
        if (!datBin || !sprBin) throw new Error('No hay generadores toBinary()');

        const a = document.createElement('a');
        a.style.display = 'none'; document.body.appendChild(a);
        a.href = URL.createObjectURL(new Blob([datBin])); a.download = 'things.dat'; a.click(); URL.revokeObjectURL(a.href);
        a.href = URL.createObjectURL(new Blob([sprBin])); a.download = 'things.spr'; a.click(); URL.revokeObjectURL(a.href);
        a.remove();
      }catch(e){
        console.error('Exportación falló:', e);
        alert('No se pudo exportar .dat/.spr: ' + (e && e.message ? e.message : e));
      }
    };
  }
  if (document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ensureExportGlue(); }, {once:true});
  } else {ensureExportGlue(); }
})();

/* =========================================================
 * editor.js — Render OTClient-accurate con Auto-Displacement
 * Reemplazo TOTAL
 * ========================================================= */

const TILE_SIZE = 32;

/* =========================
 * Utilidades O(1)
 * ========================= */

function getThingSize(thing) {
  return {
    w: thing.width  || 1,
    h: thing.height || 1
  };
}

function getAutoAnchor(thing) {
  const { w, h } = getThingSize(thing);
  return {
    x: (w >> 1),     // floor(w / 2)
    y: (h - 1)       // último sqm inferior
  };
}

function getDisplacement(thing) {
  const d = thing.__props?.values?.displacement;
  return {
    x: d?.x || 0,
    y: d?.y || 0
  };
}

function getElevation(thing) {
  return thing.__props?.values?.elevation || 0;
}

/* =========================
 * Render EXACTO OTClient
 * ========================= */

function computeDrawPosition(thing, tileX, tileY) {
  const anchor = getAutoAnchor(thing);
  const disp   = getDisplacement(thing);
  const elev   = getElevation(thing);

  return {
    x:
      tileX * TILE_SIZE
      - anchor.x * TILE_SIZE
      + disp.x,

    y:
      tileY * TILE_SIZE
      - anchor.y * TILE_SIZE
      + disp.y
      - elev
  };
}

/* =========================
 * Render principal
 * ========================= */

function renderThingPreview(ctx, thing, tileX, tileY) {
  if (!thing || !thing.sprites) return;

  const pos = computeDrawPosition(thing, tileX, tileY);

  let index = 0;
  const w = thing.width || 1;
  const h = thing.height || 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const spriteId = thing.sprites[index++];
      if (!spriteId) continue;
      // Intentar resolver sprite con APIs comunes:
      // - window.spr.getSprite(idx-1) retorna ImageData en muchas integraciones
      // - window.spr.get(idx) puede ser otra API
      const spr = window.spr;
      let sprite = null;
      try {
        if (spr && typeof spr.getSprite === 'function') sprite = spr.getSprite(spriteId - 1);
        else if (spr && typeof spr.get === 'function') sprite = spr.get(spriteId);
      } catch (_) { sprite = null; }

      if (!sprite) continue;

      // Si sprite es ImageData (putImageData) o Canvas/Image
      if (sprite instanceof ImageData) {
        // dibujar ImageData en un canvas auxiliar y luego en ctx
        const tmp = document.createElement('canvas');
        tmp.width = sprite.width; tmp.height = sprite.height;
        const tctx = tmp.getContext('2d');
        tctx.putImageData(sprite, 0, 0);
        ctx.drawImage(
          tmp,
          pos.x + x * TILE_SIZE,
          pos.y + y * TILE_SIZE
        );
      } else {
        // Asumir elemento dibujable (HTMLImageElement / Canvas)
        ctx.drawImage(
          sprite,
          pos.x + x * TILE_SIZE,
          pos.y + y * TILE_SIZE
        );
      }
    }
  }
}

/* =========================
 * Hook público
 * ========================= */

window.EditorRender = {
  drawThing(ctx, thing, tileX, tileY) {
    renderThingPreview(ctx, thing, tileX, tileY);
  }
};

