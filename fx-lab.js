// fx-lab.js — Honey Editor FX-LAB PRO v3.3 (Corrección de Base/Idle/Walk y Tabs)
// Funcionalidades: Zoom, Velocidad por Capa, Orden Front/Back, Drag&Rotate, Luces, BlendModes, Timeline, Merge Thing (Outfit/Effect/Missile), Visual Picker.

(function (global) {
  'use strict';

  // ============================================================
  //   CONFIGURACIÓN Y UTILIDADES
  // ============================================================
  const TILE_SIZE = 32;
  const GRID_W = 15;
  const GRID_H = 11;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Estado global del laboratorio
  const state = {
    running: false,
    startTime: 0,
    rafId: null,
    
    // Selección
    activeLayerKey: "effect", // 'effect' | 'missile' | 'wings' | 'aura' | 'base'
    activeExtraIndex: null,   // null o índice del array extra
    
    // Vista
    zoom: 2.0,
    
    // Interacción Mouse
    mouse: {
      action: null, 
      startPos: { x: 0, y: 0 },
      initialVal: { x: 0, y: 0, rot: 0 }
    },

    // UI Cache
    ui: {
      overlay: null, canvas: null, ctx: null,
      inputs: {}, timelineCanvas: null
    },

    // Datos
    preset: {
      looktype: 1,
      baseGroupIndex: 0, // <<-- CRÍTICO: Índice del grupo para el outfit base (Idle=0, Walk=1, etc.)
      mountId: 0,
      defaultDir: 2,
      showFloor: true,
      showOutfit: true,
      
      // Capas Fijas + Extras
      layers: {
        aura: null,
        wings: null,
        effect: null,
        missile: null,
        extra: []
      }
    }
  };

  // ============================================================
  //   HELPERS DAT/SPR
  // ============================================================
  function ensureAssets() {
    if (!global.dat || !global.spr || !global.spr.getSprite) {
      alert("⚠️ Carga primero el cliente (.dat/.spr) en la pantalla principal. (global.dat/global.spr no están disponibles o incompletos)");
      throw new Error("Assets missing");
    }
  }

  function getThing(type, id) {
    if (!global.dat || !id) return null;
    const listKey = (type === 'outfit') ? 'outfits' : 
                    (type === 'effect') ? 'effects' : 
                    (type === 'missile') ? 'missiles' : null;
    if (!listKey) return null;
    return global.dat[listKey] ? global.dat[listKey][id] : null;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function getThingLight(thing) {
    if (!thing) return null;
    if (thing.lightLevel !== undefined && thing.lightLevel > 0) {
      return { level: thing.lightLevel, color: thing.lightColor || 0 };
    }
    return null;
  }

  // ============================================================
  //   CORE: GESTIÓN DE CAPAS
  // ============================================================
  function createLayer(type, id) {
    // Para wings/aura/effect, el tipo base de thing es 'effect'.
    const actualType = (type === 'wings' || type === 'aura') ? 'effect' : type;

    return {
      type: actualType,       
      thingId: id || 1,
      groupIndex: 0,
      
      // Transform
      baseOffsetX: 0,
      baseOffsetY: 0,
      rotation: 0,
      dirMode: 'preset', 
      dir: 2,

      // Render
      opacity: 1.0,
      blendMode: 'source-over',
      speed: 1.0, 
      front: true, 
      
      // Logic
      usePatterns: true,
      autoPattern: true,
      isMounted: false, 

      // Timeline (0-100%)
      timeline: { start: 0, end: 100 }
    };
  }
  
  // FIX CRÍTICO: Aseguramos que la Capa Base se maneje de forma virtual para la UI
  function getActiveLayer() {
    // 1. Capa Base (Outfit)
    if (state.activeLayerKey === 'base') {
        const baseThing = getThing('outfit', state.preset.looktype);
        // Retornamos un objeto de capa virtual, solo con propiedades relevantes para UI/Render.
        return {
           type: 'outfit',
           thingId: state.preset.looktype,
           groupIndex: state.preset.baseGroupIndex, 
           isBase: true,
           isMounted: state.preset.mountId > 0, 
           front: false, // Siempre behind
           // Valores dummy/predeterminados para evitar errores de null
           baseOffsetX:0, baseOffsetY:0, rotation:0, opacity:1, speed:1, blendMode:'source-over',
           timeline: {start:0, end:100}
        };
    }

    // 2. Capa Extra
    if (state.activeExtraIndex !== null) {
      return state.preset.layers.extra[state.activeExtraIndex];
    }
    
    // 3. Capa Fija
    const key = state.activeLayerKey;
    const layer = state.preset.layers[key];

    // FIX: Si la capa fija no existe (ej. al abrir), la creamos al pedirla
    if (!layer && ['effect', 'missile', 'wings', 'aura'].includes(key)) {
        const type = (key === 'wings' || key === 'aura') ? 'effect' : key;
        state.preset.layers[key] = createLayer(type, 1);
    }
    
    return state.preset.layers[key];
  }

  // ============================================================
  //   CORE: RENDER LOOP
  // ============================================================
  function startRender() {
    if (state.running) return;
    state.running = true;
    state.startTime = performance.now(); // Resetear tiempo al iniciar
    state.rafId = requestAnimationFrame(loop);
  }
  
  function stopRender() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
  }

  function loop(timestamp) {
    if (!state.running) return;
    const tMs = timestamp - state.startTime;

    renderScene(tMs);
    state.rafId = requestAnimationFrame(loop);
  }

  function renderScene(tMs) {
    const { ctx, canvas } = state.ui;
    const { width, height } = canvas;
    const cx = width / 2;
    const cy = height / 2;

    // 1. Limpiar y Fondo
    ctx.clearRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(state.zoom, state.zoom);
    
    drawGrid(ctx);

    // 2. Preparar Capas
    const renderList = [];

    // Capa Base Outfit (Interna y Estructural)
    if (state.preset.showOutfit) {
      renderList.push({
        _key: 'base', // Añadir clave para identificación
        _internal: true, 
        type: 'outfit', 
        thingId: state.preset.looktype,
        front: false, 
        groupIndex: state.preset.baseGroupIndex, // Usar índice base
        // Propiedades de transformación por si las necesitamos, aunque la base suele ser 0
        baseOffsetX:0, baseOffsetY:0, rotation:0, opacity:1, speed:1,
        autoPattern:true, isMounted: state.preset.mountId > 0
      });
    }

    // Capas Standard
    ['aura', 'wings', 'effect', 'missile'].forEach(k => {
      const l = state.preset.layers[k];
      if (l) {
        l._key = k;
        renderList.push(l);
      }
    });

    // Extras
    state.preset.layers.extra.forEach((l, i) => {
      l._extraIdx = i;
      renderList.push(l);
    });

    // 3. Ordenar: [Back Layers] -> [Base Outfit] -> [Front Layers]
    // La capa base (Outfit) tiene front: false pero debe estar en el centro.
    const nonBaseLayers = renderList.filter(l => !l._internal);
    const baseLayers = renderList.filter(l => l._internal);
    
    const backLayers = nonBaseLayers.filter(l => !l.front);
    const frontLayers = nonBaseLayers.filter(l => l.front);
    
    const finalOrder = [...backLayers, ...baseLayers, ...frontLayers];

    // 4. Dibujar
    finalOrder.forEach(layer => {
      drawLayer(ctx, layer, tMs);
    });

    // 5. Overlay de Selección (Encima de todo)
    const active = getActiveLayer();
    // FIX: No dibujar anillo de selección para la capa base (que es _internal)
    if (active && !active._internal && !active.isBase) { 
        drawSelectionRing(ctx, active);
    }


    ctx.restore();
  }

  function drawGrid(ctx) {
    // ... (sin cambios)
    const w = GRID_W * TILE_SIZE;
    const h = GRID_H * TILE_SIZE;
    const hw = w/2, hh = h/2;

    ctx.fillStyle = "#161616";
    ctx.fillRect(-hw, -hh, w, h);

    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x = -hw; x <= hw; x+=TILE_SIZE) { ctx.moveTo(x, -hh); ctx.lineTo(x, hh); }
    for(let y = -hh; y <= hh; y+=TILE_SIZE) { ctx.moveTo(-hw, y); ctx.lineTo(hw, y); }
    ctx.stroke();
    
    ctx.strokeStyle = "#444";
    ctx.beginPath();
    ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
    ctx.moveTo(0, -10); ctx.lineTo(0, 10);
    ctx.stroke();
  }

  function drawLayer(ctx, layer, tMs) {
    // 1. Validar Timeline (solo aplica a capas no internas/base)
    if (!layer._internal) {
      const cycle = 2000; 
      const progress = (tMs % cycle) / cycle * 100;
      if (progress < layer.timeline.start || progress > layer.timeline.end) return;
    }

    const thing = getThing(layer.type, layer.thingId);
    if (!thing || !thing.groups) return;
    
    // Usamos el groupIndex de la capa (o el baseGroupIndex si es la capa interna)
    const groupIndex = layer._internal ? state.preset.baseGroupIndex : layer.groupIndex;
    const group = thing.groups[groupIndex] || thing.groups[0];
    if (!group) return;

    // 2. Calcular Frame (con velocidad por capa)
    const frameIdx = computeFrame(layer, group, tMs);
    
    // 3. Calcular Pattern
    const dir = (layer.dirMode === 'free') ? layer.dir : state.preset.defaultDir;
    
    // Si es la capa base o un outfit, usamos la lógica de montaje/addons
    const isMounted = layer.isMounted || layer._internal && state.preset.mountId > 0;
    
    const pats = resolvePatterns(layer, state.preset, group, dir, isMounted);

    // 4. Obtener Sprite
    const sprites = getSprites(group, frameIdx, pats);
    const canvasImg = renderSpritesToCanvas(group, sprites);

    // 5. Posicionar
    const sw = Math.max(1, group.width) * TILE_SIZE;
    const sh = Math.max(1, group.height) * TILE_SIZE;
    
    ctx.save();

    const offsetX = layer.baseOffsetX || 0;
    const offsetY = layer.baseOffsetY || 0;
    
    ctx.translate(offsetX, -offsetY); 
    if (layer.rotation) ctx.rotate(layer.rotation * Math.PI / 180);
    
    // Estilos (solo aplican a capas no internas/base)
    if (!layer._internal) {
      ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
      if (layer.blendMode) ctx.globalCompositeOperation = layer.blendMode;
    }


    ctx.drawImage(canvasImg, -sw/2, -sh/2);

    // Luces (solo aplican a capas no internas/base)
    if (!layer._internal) {
      const light = getThingLight(thing);
      if (light && light.level > 0) {
        const cx = 0, cy = 0; 
        const radius = light.level * 4 * (state.zoom / 2); 
        const glowColor = `rgba(255, 200, 100, 0.5)`; 
        
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawSelectionRing(ctx, l) {
    // ... (sin cambios)
    const thing = getThing(l.type, l.thingId);
    const group = thing?.groups?.[l.groupIndex] || thing?.groups?.[0];
    if (!group) return;

    ctx.save();
    
    ctx.translate(l.baseOffsetX || 0, -(l.baseOffsetY || 0));
    if (l.rotation) ctx.rotate(l.rotation * Math.PI / 180);

    const sw = Math.max(1, group.width) * TILE_SIZE;
    const sh = Math.max(1, group.height) * TILE_SIZE;
    const r = Math.max(sw, sh) / 2 + 5; 
    
    const lineWidth = 1 / state.zoom;
    const handleSize = 6 / state.zoom;
    const handleDist = r + (10 / state.zoom);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 180, 255, 0.8)";
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, -handleDist);
    ctx.strokeStyle = "#00aaff";
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -handleDist, handleSize, 0, Math.PI * 2);
    ctx.fillStyle = "#00aaff";
    ctx.fill();
    
    ctx.restore();
  }

  // --- Lógica Auxiliar Render ---
  function computeFrame(layer, group, tMs) {
    // ... (sin cambios)
    const speed = layer.speed || 1.0;
    const localT = tMs * speed; 
    
    if (group.anim && group.anim.perFrameMin) {
       const durs = group.anim.perFrameMin;
       const total = durs.reduce((a,b)=>a+b,0);
       if (total === 0) return 0;
       let t = localT % total;
       for(let i=0; i<durs.length; i++) {
         if (t < durs[i]) return i;
         t -= durs[i];
       }
       return 0;
    }
    const frames = group.frames || 1;
    const idx = Math.floor(localT / 100); 
    return idx % frames;
  }

  function resolvePatterns(layer, preset, group, dir, isMounted) {
    let px=0, py=0, pz=0;
    
    // Si la capa no usa patrones, retornar 0
    if (!layer.usePatterns) return {px:0, py:0, pz:0};

    if (layer.autoPattern) {
       if (layer.type === 'missile') px = dir;
       else if (layer.type === 'effect' && group.patternX > 1) px = dir;
       else if (layer.type === 'outfit') {
          if (group.patternY > 1) py = dir;
          
          // Lógica de montaje/addon para Pz
          if (isMounted && group.patternZ > 1) pz = 1;
          else if (group.patternZ > 1) pz = preset.mountId || 0;
       }
    }
    
    // Si es outfit base (_internal), los patrones de dirección (py) y addons (pz) son forzados por la UI.
    if (layer._internal) {
      if (group.patternY > 1) py = dir;
      if (group.patternZ > 1) pz = preset.mountId || 0;
    }


    return {
      px: clamp(px, 0, (group.patternX||1)-1),
      py: clamp(py, 0, (group.patternY||1)-1),
      pz: clamp(pz, 0, (group.patternZ||1)-1)
    };
  }

  function getSprites(group, f, {px, py, pz}) {
    // ... (sin cambios)
    const z = pz, y = py, x = px, l = 0;
    const totalPerFrame = (group.width || 1) * (group.height || 1);
    
    const idx = (((f * (group.patternZ||1) + z) 
                 * (group.patternY||1) + y) 
                 * (group.patternX||1) + x) 
                 * (group.layers||1) + l;
                 
    const start = idx * totalPerFrame;
    const sprites = group.sprites.slice(start, start + totalPerFrame);
    
    while(sprites.length < totalPerFrame) sprites.push(0);
    return sprites;
  }

  function renderSpritesToCanvas(group, sprites) {
    // ... (sin cambios)
    const w = (group.width || 1) * 32;
    const h = (group.height || 1) * 32;
    
    const c = (typeof OffscreenCanvas !== 'undefined') 
      ? new OffscreenCanvas(w, h) 
      : document.createElement("canvas");
    c.width = w; c.height = h;

    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    
    for(let y=0; y<group.height; y++) {
      for(let x=0; x<group.width; x++) {
         const idx = (group.height-1-y)*group.width + (group.width-1-x);
         const sid = sprites[idx];
         if (sid > 0 && global.spr && global.spr.getSprite) {
            const img = global.spr.getSprite(sid-1);
            if (img) ctx.putImageData(img, x*32, y*32);
         }
      }
    }
    return c;
  }


  // ============================================================
  //   UI CONSTRUCTION
  // ============================================================
  function buildUI() {
    // ... (HTML, CSS y Binding de UI omitido por brevedad, asumiendo que es correcto) ...
    // Si el overlay ya existe, no reinyectamos HTML, pero SÍ debemos asegurar las referencias UI.
    if ($("#fxLabOverlay")) {
        // Re-asignar referencias UI por si se llamó buildUI de nuevo
        state.ui.overlay = $("#fxLabOverlay");
        state.ui.canvas = $("#fxCanvas");
        state.ui.ctx = state.ui.canvas ? state.ui.canvas.getContext("2d") : null;
        state.ui.timelineCanvas = $("#fxTimeline");

        // Asegurar que state.ui.inputs existe y enlazar elementos importantes (incluyendo los que faltaban)
        const ui = state.ui.inputs = state.ui.inputs || {};
        ui.baseId = $("#fxBaseId");
        ui.thingId = $("#fxThingId");
        ui.blend = $("#fxBlend");
        ui.opacity = $("#fxOpacity");
        ui.opacityVal = $("#fxOpacityVal"); // <- agregado
        ui.speed = $("#fxSpeed");
        ui.speedVal = $("#fxSpeedVal");     // <- agregado
        ui.group = $("#fxGroup");
        ui.mounted = $("#fxMounted");
        ui.front = $("#fxFront");
        ui.rot = $("#fxRot");
        ui.rotVal = $("#fxRotVal");         // <- agregado
        ui.zoom = $("#fxZoom");
        ui.zoomVal = $("#fxZoomVal");

        // No reinyectamos HTML ni re-atamos todos los handlers (preservamos los existentes)
        return;
    }

    // Inyectar CSS (Se asume correcto)
    const css = `
      #fxLabOverlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 10000;
        display: none; align-items: center; justify-content: center;
        font-family: 'Segoe UI', sans-serif; color: #ddd; font-size: 13px;
      }
      #fxWindow {
        width: 95vw; height: 90vh; background: #1a1a1a; display: grid;
        grid-template-columns: 1fr 340px; border: 1px solid #444; border-radius: 6px;
        box-shadow: 0 0 40px rgba(0,0,0,0.8); overflow: hidden;
      }
      /* ... (Otros estilos) ... */
      #fxCanvasWrap {
        position: relative; background: #0f0f0f; overflow: hidden;
        display: flex; flex-direction: column;
      }
      #fxCanvas { cursor: grab; display: block; width: 100%; height: 100%; } 
      #fxCanvas:active { cursor: grabbing; }
      
      .fx-toolbar {
        position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 8px; background: rgba(0,0,0,0.6); padding: 8px; border-radius: 20px;
        backdrop-filter: blur(4px);
      }

      /* Sidebar Controls */
      #fxSidebar {
        background: #222; border-left: 1px solid #333; display: flex; flex-direction: column;
        overflow-y: auto; padding: 15px; gap: 12px;
      }
      
      h2 { margin: 0; font-size: 16px; color: #fff; border-bottom: 2px solid #007acc; padding-bottom: 6px; }
      h3 { margin: 5px 0 5px 0; font-size: 12px; text-transform: uppercase; color: #666; font-weight: bold; }

      .fx-row { display: flex; align-items: center; gap: 8px; }
      .fx-label { width: 70px; flex-shrink: 0; color: #aaa; }
      .fx-input { 
        background: #111; border: 1px solid #444; color: #fff; padding: 4px;
        border-radius: 3px; flex: 1; min-width: 0;
      }
      
      .fx-btn {
        background: #333; border: 1px solid #555; color: #eee; padding: 5px 10px;
        border-radius: 4px; cursor: pointer; transition: 0.2s; text-align: center;
      }
      .fx-btn:hover { background: #444; }
      .fx-btn-primary { background: #007acc; border-color: #005f9e; color: #fff; }
      .fx-btn-primary:hover { background: #006bb3; }
      .fx-btn-danger { background: #822; border-color: #611; }

      /* Tabs */
      .fx-tabs { display: flex; background: #111; padding: 3px; border-radius: 4px; gap: 2px; }
      /* Agregamos el tab base */
      .fx-tab { flex: 1; text-align: center; padding: 6px; cursor: pointer; border-radius: 3px; color: #888; }
      .fx-tab.active { background: #333; color: #fff; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }

      /* Extra List */
      .fx-extra-list { display: flex; flex-direction: column; gap: 4px; margin-top: 5px; }
      .fx-extra-item {
        display: flex; align-items: center; justify-content: space-between;
        background: #2a2a2a; padding: 6px 10px; border-radius: 4px; border: 1px solid #333;
        cursor: pointer;
      }
      .fx-extra-item.active { border-color: #007acc; background: #334; }

      /* Timeline */
      .fx-timeline { height: 40px; background: #111; border: 1px solid #333; border-radius: 4px; position: relative; cursor: ew-resize; margin-top: auto; }
      .fx-timeline-handle { 
        position: absolute; top: 10px; width: 10px; height: 20px; background: #00aaff;
        border: 1px solid #005f9e; cursor: col-resize; z-index: 10;
        transform: translateX(-50%); border-radius: 2px;
      }

      /* Picker */
      #fxPicker {
        position: absolute; background: #252525; border: 1px solid #555;
        width: 340px; height: 300px; z-index: 10001; display: none;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 6px; padding: 8px;
        display: flex; flex-direction: column;
      }
      .picker-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
        gap: 4px; overflow-y: auto; flex: 1; margin-top: 6px;
      }
      .picker-cell {
        width: 36px; height: 36px; border: 1px solid #333; background: #1a1a1a;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
      }
      .picker-cell:hover { border-color: #00aaff; }

      /* Zoom Control */
      .zoom-ctrl {
        position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7);
        padding: 5px 10px; border-radius: 20px; display: flex; align-items: center;
        gap: 8px; z-index: 1;
      }

    `;

    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);

    const div = document.createElement("div");
    div.id = "fxLabOverlay";
    div.innerHTML = `
      <div id="fxWindow">
        <div id="fxCanvasWrap">
          <canvas id="fxCanvas"></canvas>
          
          <div class="zoom-ctrl">
            <span>🔍</span>
            <input type="range" id="fxZoom" min="0.5" max="5.0" step="0.1" value="2.0" style="width:80px">
            <span id="fxZoomVal">200%</span>
          </div>

          <div class="fx-toolbar">
            <button class="fx-btn" id="fxPlayBtn">⏯</button>
            <button class="fx-btn" id="fxWebMBtn" title="Grabar video">🎥 Video</button>
          </div>
        </div>

        <div id="fxSidebar">
          <h2>Honey FX Lab Pro v3.3</h2>

          <div class="fx-tabs">
            <div class="fx-tab" data-key="base">BASE</div>
            <div class="fx-tab" data-key="effect">EFFECT</div>
            <div class="fx-tab" data-key="missile">MISSILE</div>
            <div class="fx-tab" data-key="wings">WINGS</div>
            <div class="fx-tab" data-key="aura">AURA</div>
          </div>
          <p style="font-size:11px; margin:5px 0; color:#888;">Capa activa: <span id="fxActiveLayerName" style="color:#00aaff; font-weight:bold;">EFFECT</span></p>

          <h3 style="margin-top:10px;">Outfit Base (Siempre visible)</h3>
          <div class="fx-row">
            <span class="fx-label">Outfit ID</span>
            <input type="number" id="fxBaseId" class="fx-input" value="1" min="1" max="65535">
            <button class="fx-btn" id="fxPickBase">... Picker</button>
          </div>
          <div class="fx-row">
             <span class="fx-label">Mostrar</span>
             <label><input type="checkbox" id="fxShowOutfit" checked> Outfit</label>
             <label><input type="checkbox" id="fxShowFloor" checked> Suelo</label>
          </div>

          <h3 style="margin-top:10px;">Capas Extra (Efectos flotantes)</h3>
          <div id="fxExtraList" class="fx-extra-list">
            </div>
          <button class="fx-btn" id="fxAddExtra" style="margin-top:5px;">+ Añadir Capa Extra</button>

          <h3 style="margin-top:10px;">Controles de Capa Activa</h3>
          
          <div class="fx-row" id="fxThingIdRow">
            <span class="fx-label">Thing ID</span>
            <input type="number" id="fxThingId" class="fx-input" value="13" min="1" max="65535">
            <button class="fx-btn" id="fxPickThing">... Picker</button>
          </div>

          <div class="fx-row" id="fxGroupRow" style="display:none;">
            <span class="fx-label" id="fxGroupLabel">Grupo</span>
            <select id="fxGroup" class="fx-input"></select>
          </div>

          <div class="fx-row">
            <span class="fx-label">Pos. X/Y</span>
            <input type="number" id="fxOffsetX" class="fx-input" value="0" style="width:50px">
            <input type="number" id="fxOffsetY" class="fx-input" value="0" style="width:50px">
            <button class="fx-btn" id="fxResetPos" title="Centrar Posición">⟲</button>
          </div>

          <div class="fx-row" id="fxRotRow">
            <span class="fx-label">Rotación</span>
            <input type="range" id="fxRot" min="-180" max="180" step="1" value="0" style="flex:1;">
            <span style="width:40px; text-align:right;"><span id="fxRotVal">0</span>°</span>
          </div>

          <div style="padding: 5px 0;">
            <div class="fx-row">
              <span class="fx-label">Modo Dir</span>
              <select id="fxDirMode" class="fx-input" style="flex:auto;">
                 <option value="preset">Global (Preset)</option>
                 <option value="free">Fija (Manual)</option>
              </select>
              <div class="dpad" style="display:inline-grid; gap:4px; transform:scale(0.8);">
                 <button class="dir-btn" data-d="0" title="Norte (0)">↑</button>
                 <button class="dir-btn" data-d="1" title="Noreste (1)">↗</button>
                 <button class="dir-btn" data-d="2" title="Este (2)">→</button>
                 <button class="dir-btn" data-d="3" title="Sureste (3)">↘</button>
                 <button class="dir-btn" data-d="4" title="Sur (4)">↓</button>
                 <button class="dir-btn" data-d="5" title="Suroeste (5)">↙</button>
                 <button class="dir-btn" data-d="6" title="Oeste (6)">←</button>
                 <button class="dir-btn" data-d="7" title="Noroeste (7)">↖</button>
              </div>
            </div>
          </div>
          

          <div style="margin-top:10px; background:#292929; padding:8px; border-radius:4px;">
            <h3>Opciones de Render</h3>
            <div class="fx-row">
              <span class="fx-label">Opacidad</span>
              <input type="range" id="fxOpacity" min="0.0" max="1.0" step="0.01" value="1.0" style="flex:1;">
              <span style="width:40px; text-align:right;"><span id="fxOpacityVal">100</span>%</span>
            </div>

            <div class="fx-row">
              <span class="fx-label">Velocidad</span>
              <input type="range" id="fxSpeed" min="0.1" max="5.0" step="0.1" value="1.0" style="flex:1;">
              <span style="width:40px; text-align:right;"><span id="fxSpeedVal">1.0</span>x</span>
            </div>

            <div class="fx-row">
              <span class="fx-label">Blend Mode</span>
              <select id="fxBlend" class="fx-input">
                <option value="source-over">Normal</option>
                <option value="lighter">Lighter (Aditivo)</option>
                <option value="screen">Screen (Pantalla)</option>
                <option value="multiply">Multiply (Multiplicar)</option>
                <option value="overlay">Overlay (Superposición)</option>
                <option value="difference">Difference (Diferencia)</option>
              </select>
            </div>

            <div class="fx-row" style="margin-top:5px; justify-content: space-around;">
              <label style="flex:1;"><input type="checkbox" id="fxFront" checked> Front Layer (En frente del Outfit)</label>
              <label style="flex:1;"><input type="checkbox" id="fxMounted"> Montado (Pz=1)</label>
            </div>
          </div>
          
          <h3 style="margin-top:10px;">Timeline / Ciclo (2 segundos)</h3>
          <div class="fx-row" style="justify-content:space-between; font-size:11px; color:#888;">
            <span>Start</span><span>Timeline</span><span>End</span>
          </div>
          <canvas id="fxTimeline" class="fx-timeline" width="300" height="40"></canvas>
          
          <h3 style="margin-top:10px;">Crear Thing Unificado</h3>
          <div class="fx-row">
            <span class="fx-label">Categoría</span>
            <select id="fxMergeCategory" class="fx-input">
              <option value="outfit">Outfit</option>
              <option value="effect">Effect</option>
              <option value="missile">Missile</option>
            </select>
          </div>
          <button class="fx-btn fx-btn-primary" id="fxMergeBtn" title="Combina todas las capas visibles en un nuevo Thing">⚡ Crear y Guardar Thing</button>
          
          <button class="fx-btn fx-btn-danger" id="fxClose" style="margin-top:10px;">Cerrar FX Lab</button>
        </div>
      </div>
      
      <div id="fxPicker">
        <input type="text" id="fxPickerFilter" class="fx-input" placeholder="Filtrar ID...">
        <div class="picker-grid" id="fxPickerGrid"></div>
        <button class="fx-btn" onclick="document.getElementById('fxPicker').style.display='none'" style="margin-top:5px;">Cancelar</button>
      </div>

    `;
    document.body.appendChild(div);

    // Bind UI Elements
    state.ui.overlay = div;
    state.ui.canvas = $("#fxCanvas");
    state.ui.ctx = state.ui.canvas.getContext("2d");
    state.ui.timelineCanvas = $("#fxTimeline");

    // Bind Inputs
    const ui = state.ui.inputs;
    ui.baseId = $("#fxBaseId");
    ui.thingId = $("#fxThingId");
    ui.blend = $("#fxBlend");
    ui.opacity = $("#fxOpacity");
    ui.opacityVal = $("#fxOpacityVal"); // <-- bind missing element
    ui.speed = $("#fxSpeed");
    ui.speedVal = $("#fxSpeedVal");     // <-- bind missing element
    ui.group = $("#fxGroup");
    ui.mounted = $("#fxMounted");
    ui.front = $("#fxFront");
    ui.rot = $("#fxRot");
    ui.rotVal = $("#fxRotVal");         // <-- bind missing element
    ui.zoom = $("#fxZoom");
    ui.zoomVal = $("#fxZoomVal");

    // Inicializar base y capas
    if (!state.preset.layers.effect) state.preset.layers.effect = createLayer("effect", 13);
    
    // ============================================================
    //   UI BINDING: LÓGICA DE EVENTOS
    // ============================================================
    
    // Helper para actualizar la capa activa
    function updateL(callback) {
      const l = getActiveLayer();
      if (l && !l.isBase) {
        callback(l);
        requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
        syncUI(); // Para actualizar valores dependientes (como rotación)
      }
      else if (l && l.isBase) {
         // Callback solo para la base si es necesario, pero syncUI es suficiente
         requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
      }
    }
    
    // --- Controles de Preset ---
    $("#fxShowOutfit").onchange = (e) => {
        state.preset.showOutfit = e.target.checked;
        requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
    };
    $("#fxShowFloor").onchange = (e) => {
        state.preset.showFloor = e.target.checked;
        requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
        drawGrid(state.ui.ctx); // Solo dibujar la grilla si es necesario.
    };
    
    ui.baseId.oninput = (e) => {
      state.preset.looktype = +e.target.value;
      requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
      refreshGroupSelect();
    };
    
    // --- Controles de Capa Activa ---
    ui.thingId.oninput = (e) => updateL(l => { 
      const val = +e.target.value; 
      l.thingId = val; 
      if (global.spr && val > global.spr.totalSprites) e.target.classList.add("error");
      else e.target.classList.remove("error");
      refreshGroupSelect();
    });
    ui.blend.onchange = (e) => updateL(l => l.blendMode = e.target.value);
    ui.opacity.oninput = (e) => {
        updateL(l => l.opacity = +e.target.value);
        ui.opacityVal.textContent = Math.round(ui.opacity.value * 100);
    };
    ui.speed.oninput = (e) => {
        updateL(l => l.speed = +e.target.value);
        ui.speedVal.textContent = ui.speed.value;
    };
    ui.rot.oninput = (e) => {
        updateL(l => l.rotation = +e.target.value);
        ui.rotVal.textContent = ui.rot.value;
    };
    
    // CORRECCIÓN: Manejo de groupIndex para base y capas
    ui.group.onchange = (e) => {
      const val = +e.target.value;
      const l = getActiveLayer();
      if (l) {
        if (l.isBase) {
          state.preset.baseGroupIndex = val;
        } else {
          l.groupIndex = val;
        }
        // Importante: Refrescar la escena inmediatamente después de cambiar el grupo.
        requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
      }
    };

    ui.mounted.onchange = (e) => updateL(l => l.isMounted = e.target.checked);
    ui.front.onchange = (e) => updateL(l => l.front = e.target.checked);
    
    // Dirección
    $$(".dir-btn").forEach(b => b.onclick = () => {
      state.preset.defaultDir = +b.dataset.d;
      // Actualizamos el tiempo de render para forzar el dibujo
      requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
    });

    // Offset X/Y
    $("#fxOffsetX").oninput = (e) => updateL(l => l.baseOffsetX = +e.target.value);
    $("#fxOffsetY").oninput = (e) => updateL(l => l.baseOffsetY = +e.target.value);
    $("#fxResetPos").onclick = () => {
        updateL(l => { l.baseOffsetX = 0; l.baseOffsetY = 0; });
        $("#fxOffsetX").value = 0; $("#fxOffsetY").value = 0;
    };
    
    // Zoom
    ui.zoom.oninput = (e) => {
        state.zoom = +e.target.value;
        ui.zoomVal.textContent = `${Math.round(state.zoom * 100)}%`;
        requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
    };

    // --- Tabs ---
    $$(".fx-tab").forEach(tab => {
      tab.onclick = () => {
        state.activeLayerKey = tab.dataset.key;
        state.activeExtraIndex = null; 
        syncUI();
      };
    });

    // --- Extras ---
    $("#fxAddExtra").onclick = () => {
      state.preset.layers.extra.push(createLayer("effect", 13));
      state.activeLayerKey = 'effect'; // Usar la clave 'effect' como marcador
      state.activeExtraIndex = state.preset.layers.extra.length - 1;
      syncUI();
    };

    // --- Timeline ---
    let timelineDrag = null; // 'start' o 'end'
    const timelineCanvas = state.ui.timelineCanvas;

    timelineCanvas.onmousedown = (e) => {
      const rect = timelineCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const l = getActiveLayer();
      if (!l || l.isBase) return;

      const width = timelineCanvas.width;
      const x1 = (l.timeline.start / 100) * width;
      const x2 = (l.timeline.end / 100) * width;

      if (Math.abs(x - x1) < 10) timelineDrag = 'start';
      else if (Math.abs(x - x2) < 10) timelineDrag = 'end';
    };

    window.addEventListener('mousemove', (e) => {
      if (!timelineDrag) return;

      const rect = timelineCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = timelineCanvas.width;
      const l = getActiveLayer();

      let progress = clamp(x / width * 100, 0, 100);
      progress = Math.round(progress / 5) * 5; // Snap a 5%

      if (timelineDrag === 'start') {
        l.timeline.start = Math.min(progress, l.timeline.end - 5);
      } else if (timelineDrag === 'end') {
        l.timeline.end = Math.max(progress, l.timeline.start + 5);
      }

      drawTimeline();
      requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
    });

    window.addEventListener('mouseup', () => {
      timelineDrag = null;
    });


    // --- Picker ---
    $("#fxPickBase").onclick = () => openPicker('outfit', ui.baseId);
    $("#fxPickThing").onclick = () => {
        const l = getActiveLayer();
        if (!l || l.isBase) return;
        const type = l.type === 'missile' ? 'missile' : 'effect';
        openPicker(type, ui.thingId);
    };

    // --- Play/Pause ---
    $("#fxPlayBtn").onclick = (e) => {
      if (state.running) {
        stopRender();
        e.target.textContent = "▶️";
      } else {
        startRender();
        e.target.textContent = "⏸";
      }
    };
    
    // --- Merge ---
    $("#fxMergeBtn").onclick = mergeAndCreate;

    // --- Close ---
    $("#fxClose").onclick = stopAndClose;
    
    // --- Canvas Resize ---
    window.addEventListener('resize', () => {
        const c = state.ui.canvas;
        const p = c.parentElement;
        c.width = p.clientWidth;
        c.height = p.clientHeight;
        requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
    });
    
    // Finalmente, iniciar
    startRender();
  }

  // ============================================================
  //   UI SYNC & HELPERS
  // ============================================================
  
  function syncUI() {
    const l = getActiveLayer();
    const isBase = l && l.isBase;
    
    // Actualizar nombre de capa activa
    let name = isBase ? 'BASE: Outfit' : 
               state.activeExtraIndex !== null ? `EXTRA #${state.activeExtraIndex+1} (${l.type})` :
               state.activeLayerKey.toUpperCase();
    $("#fxActiveLayerName").textContent = name;
    
    // Activar Tab
    $$(".fx-tab").forEach(t => t.classList.remove("active"));
    if (state.activeExtraIndex !== null) {
      // Si es un extra, las pestañas fijas no se activan
      $$(".fx-tab").forEach(x => x.classList.remove("active"));
    } else {
      // Activar la pestaña fija
      const tab = $(`.fx-tab[data-key='${state.activeLayerKey}']`);
      if (tab) tab.classList.add("active");
    }

    // Manejo de visibilidad de UI (Propiedades solo para capas no base)
    const display = isBase ? 'none' : 'flex';
    const ui = state.ui.inputs;
    
    $("#fxThingIdRow").style.display = display;
    $("#fxRotRow").style.display = display;
    ui.mounted.parentElement.style.display = display;
    ui.front.parentElement.style.display = display;
    ui.opacity.parentElement.parentElement.style.display = isBase ? 'none' : 'block'; // El contenedor de opacidad/vel/blend
    
    // Dirección libre vs preset
    $("#fxDirMode").value = l?.dirMode || 'preset';
    $$('.dpad').forEach(d => d.style.display = (l?.dirMode === 'free' && !isBase) ? 'grid' : 'none');
    
    // Rellenar valores del Outfit Base (siempre visibles)
    ui.baseId.value = state.preset.looktype;
    $("#fxShowOutfit").checked = state.preset.showOutfit;
    $("#fxShowFloor").checked = state.preset.showFloor;


    if (l && !isBase) {
      // Rellenar valores de Capa
      ui.thingId.value = l.thingId;
      $("#fxOffsetX").value = l.baseOffsetX;
      $("#fxOffsetY").value = l.baseOffsetY;
      
      ui.blend.value = l.blendMode;
      ui.opacity.value = l.opacity;
      ui.speed.value = l.speed;
      ui.rot.value = Math.round(l.rotation);
      
      ui.opacityVal.textContent = Math.round(l.opacity * 100);
      ui.speedVal.textContent = l.speed;
      ui.rotVal.textContent = ui.rot.value;

      ui.mounted.checked = l.isMounted;
      ui.front.checked = l.front;
    } else {
       // Ocultar X/Y y Rotación para la capa Base
      $("#fxOffsetX").value = 0; $("#fxOffsetY").value = 0;
      ui.rot.value = 0; ui.rotVal.textContent = 0;
    }


    renderExtraList();
    refreshGroupSelect(); 
    drawTimeline();
  }

  function renderExtraList() {
    const box = $("#fxExtraList");
    box.innerHTML = "";
    state.preset.layers.extra.forEach((l, i) => {
      const thing = getThing(l.type, l.thingId);
      const name = thing ? thing.name || `Thing ${l.thingId}` : `Thing ${l.thingId}`;
      const el = document.createElement("div");
      el.className = `fx-extra-item${state.activeExtraIndex === i ? ' active' : ''}`;
      el.dataset.index = i;
      el.innerHTML = `
        <span>${i + 1}. ${name} (${l.type.toUpperCase()})</span>
        <button class="fx-btn fx-btn-danger fx-remove-extra" data-index="${i}" style="padding: 2px 5px; font-size:10px;">❌</button>
      `;
      el.onclick = () => {
        state.activeLayerKey = l.type;
        state.activeExtraIndex = i;
        syncUI();
      };
      box.appendChild(el);
    });

    // Binding del botón de eliminar
    $$(".fx-remove-extra").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation(); // Evitar que se active el onclick del item padre
        const index = +e.target.dataset.index;
        state.preset.layers.extra.splice(index, 1);
        // Si eliminamos la capa activa, seleccionar Base
        if (state.activeExtraIndex === index) {
          state.activeLayerKey = 'base';
          state.activeExtraIndex = null;
        } else if (state.activeExtraIndex > index) {
          // Ajustar el índice si se elimina uno anterior
          state.activeExtraIndex--;
        }
        syncUI();
      };
    });
  }

  function refreshGroupSelect() {
    const sel = state.ui.inputs.group;
    const label = $("#fxGroupLabel");
    sel.innerHTML = "";

    const l = getActiveLayer();
    if (!l) {
        $("#fxGroupRow").style.display = 'none';
        return;
    }

    const thingType = l.type;
    const thing = getThing(thingType, l.thingId);

    if (!thing || !thing.groups || thing.groups.length <= 1) {
      $("#fxGroupRow").style.display = 'none';
      return;
    }

    // Mostrar si hay múltiples grupos
    $("#fxGroupRow").style.display = 'flex';
    label.textContent = (thingType === 'outfit' && l.isBase) ? 'Estado' : 'Grupo';

    thing.groups.forEach((g, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `Grupo ${i}`;

      // Etiquetas amigables
      if (thingType === 'outfit') {
        if (i===0) opt.textContent = "0: Idle (Parado)";
        if (i===1) opt.textContent = "1: Walk (Caminando)";
        if (i===2) opt.textContent = "2: Equip (Usando Item)";
      } else {
        if (i===0) opt.textContent = "0: Principal";
        if (i===1) opt.textContent = "1: Alternativo";
      }
      sel.appendChild(opt);
    });

    // Seleccionar el valor correcto
    if (l.isBase) {
      sel.value = state.preset.baseGroupIndex;
    } else {
      sel.value = l.groupIndex;
    }
  }


  function drawTimeline() {
    const ctx = state.ui.timelineCanvas.getContext("2d");
    const { width, height } = state.ui.timelineCanvas;
    const l = getActiveLayer();

    ctx.clearRect(0,0,width,height);
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 10, width, 20);

    // Si es Base o no hay capa, solo dibujar el fondo gris
    if (!l || l.isBase) return;

    const x1 = (l.timeline.start / 100) * width;
    const x2 = (l.timeline.end / 100) * width;

    // Barra de color
    ctx.fillStyle = "#007acc";
    ctx.fillRect(x1, 10, x2 - x1, 20);

    // Borde
    ctx.strokeStyle = "#005f9e";
    ctx.strokeRect(0, 10, width, 20);

    // Indicador de avance (tiempo actual)
    const cycle = 2000;
    const tMs = performance.now() - state.startTime;
    const progress = (tMs % cycle) / cycle * width;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(progress - 1, 10, 2, 20);


    // Handles (se dibujan sobre todo)
    drawHandle(ctx, x1, height/2, '#00aaff');
    drawHandle(ctx, x2, height/2, '#00aaff');
    
    function drawHandle(ctx, x, y, color) {
        ctx.fillStyle = color;
        ctx.strokeStyle = "#005f9e";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(x - 5, y - 10, 10, 20);
        ctx.fill();
        ctx.stroke();
    }
  }


  function stopAndClose() {
    stopRender();
    if (state.ui.overlay) {
      state.ui.overlay.style.display = "none";
    }
  }
  
  // ============================================================
  //   DRAG & ROTATE LOGIC
  // ============================================================
  function setupInteraction() {
    const c = state.ui.canvas;
    
    // Mouse Down
    c.onmousedown = (e) => {
      const rect = c.getBoundingClientRect();
      const cx = c.width/2;
      const cy = c.height/2;
      const wx = ((e.clientX - rect.left) - cx) / state.zoom;
      const wy = ((e.clientY - rect.top) - cy) / state.zoom;
      
      const active = getActiveLayer();
      // No permitir drag/rotate en la capa base
      if (!active || active.isBase) return;
      
      const thing = getThing(active.type, active.thingId);
      const group = thing?.groups?.[active.groupIndex] || thing?.groups?.[0];
      if (!group) return;
      
      const sw = 32 * (group.width || 1);
      const sh = 32 * (group.height || 1);
      
      const r = Math.max(sw, sh) / 2 + 5; 
      
      const distFromCenter = Math.sqrt(wx*wx + wy*wy);

      // 1. Detección de rotación (cerca del borde)
      const handleDist = r + (10 / state.zoom);
      
      // Calcular la posición del handle de rotación en coordenadas mundiales
      const rotX = active.baseOffsetX + handleDist * Math.sin(active.rotation * Math.PI / 180);
      const rotY = -(active.baseOffsetY - handleDist * Math.cos(active.rotation * Math.PI / 180));
      
      const distToRotHandle = Math.sqrt((wx - rotX)*(wx - rotX) + (wy - rotY)*(wy - rotY));
      const handleSize = 6 / state.zoom;

      if (distToRotHandle < handleSize * 2) {
         state.mouse.action = 'rotate';
         state.mouse.initialVal.rot = active.rotation;
         state.mouse.startPos = { x: e.clientX, y: e.clientY };
         return;
      }
      
      // 2. Detección de Drag (sobre el sprite)
      const dx = wx - (active.baseOffsetX || 0);
      const dy = wy - (-(active.baseOffsetY || 0));

      // Detectar si el clic está sobre el área del sprite
      if (Math.abs(dx) < sw/2 && Math.abs(dy) < sh/2) {
        state.mouse.action = 'drag';
        state.mouse.startPos = { x: e.clientX, y: e.clientY };
        state.mouse.initialVal = { x: active.baseOffsetX, y: active.baseOffsetY };
        return;
      }
    };

    window.addEventListener('mousemove', (e) => {
      if (!state.mouse.action) return;

      const active = getActiveLayer();
      if (!active || active.isBase) return;

      const dx = e.clientX - state.mouse.startPos.x;
      const dy = e.clientY - state.mouse.startPos.y;
      
      if (state.mouse.action === 'drag') {
        active.baseOffsetX = state.mouse.initialVal.x + dx / state.zoom;
        active.baseOffsetY = state.mouse.initialVal.y - dy / state.zoom;
        
        // Sincronizar inputs de posición
        $("#fxOffsetX").value = Math.round(active.baseOffsetX);
        $("#fxOffsetY").value = Math.round(active.baseOffsetY);

      } else if (state.mouse.action === 'rotate') {
        const rect = c.getBoundingClientRect();
        const cx = rect.left + c.width / 2;
        const cy = rect.top + c.height / 2;
        
        // Coordenadas del mouse relativas al centro del canvas
        const mouseX = e.clientX - cx;
        const mouseY = e.clientY - cy;

        // Coordenadas de la capa activa relativas al centro del canvas
        const layerX = (active.baseOffsetX || 0) * state.zoom;
        const layerY = -(active.baseOffsetY || 0) * state.zoom;
        
        // Ángulo inicial (vector mouse inicial a centro de capa)
        const startAngle = Math.atan2(state.mouse.startPos.y - (cy - layerY), state.mouse.startPos.x - (cx + layerX));
        // Ángulo actual (vector mouse actual a centro de capa)
        const currentAngle = Math.atan2(e.clientY - (cy - layerY), e.clientX - (cx + layerX));
        
        let delta = (currentAngle - startAngle) * 180 / Math.PI;
        
        // Ajuste para que el inicio de la rotación sea intuitivo
        active.rotation = state.mouse.initialVal.rot + delta;
        active.rotation = (active.rotation + 360) % 360; // Mantener entre 0 y 360
        
        // Sincronizar input de rotación
        state.ui.inputs.rot.value = Math.round(active.rotation);
        state.ui.inputs.rotVal.textContent = Math.round(active.rotation);
      }
      
      requestAnimationFrame(() => renderScene(performance.now() - state.startTime));
    });

    window.addEventListener('mouseup', () => {
      if (state.mouse.action) {
        state.mouse.action = null;
        c.style.cursor = 'grab';
        // Redondeamos los valores finales después del arrastre
        const active = getActiveLayer();
        if (active && !active.isBase) {
          active.baseOffsetX = Math.round(active.baseOffsetX);
          active.baseOffsetY = Math.round(active.baseOffsetY);
          const offX = $("#fxOffsetX");
          const offY = $("#fxOffsetY");
          if (offX) offX.value = active.baseOffsetX;
          if (offY) offY.value = active.baseOffsetY;
          syncUI(); // Forzar el update de rotación también si es necesario
        }
      }
    });

    // Control del cursor
    c.onmousemove = (e) => {
      if (state.mouse.action) {
        c.style.cursor = state.mouse.action === 'drag' ? 'grabbing' : 'grabbing';
        return;
      }
      
      const rect = c.getBoundingClientRect();
      const cx = c.width/2;
      const cy = c.height/2;
      const wx = ((e.clientX - rect.left) - cx) / state.zoom;
      const wy = ((e.clientY - rect.top) - cy) / state.zoom;

      const active = getActiveLayer();
      if (!active || active.isBase) {
        c.style.cursor = 'grab';
        return;
      }

      const thing = getThing(active.type, active.thingId);
      const group = thing?.groups?.[active.groupIndex] || thing?.groups?.[0];
      if (!group) return;
      
      const sw = 32 * (group.width || 1);
      const sh = 32 * (group.height || 1);
      const r = Math.max(sw, sh) / 2 + 5; 
      
      const distFromCenter = Math.sqrt(wx*wx + wy*wy);
      const handleDist = r + (10 / state.zoom);

      // Coordenadas del handle de rotación
      const rotX = active.baseOffsetX + handleDist * Math.sin(active.rotation * Math.PI / 180);
      const rotY = -(active.baseOffsetY - handleDist * Math.cos(active.rotation * Math.PI / 180));
      
      const distToRotHandle = Math.sqrt((wx - rotX)*(wx - rotX) + (wy - rotY)*(wy - rotY));
      const handleSize = 6 / state.zoom;

      if (distToRotHandle < handleSize * 2) {
         c.style.cursor = 'grab'; // Cambiamos a grab para rotación también
         return;
      }
      
      // Detección de Drag (sobre el sprite)
      const dx = wx - (active.baseOffsetX || 0);
      const dy = wy - (-(active.baseOffsetY || 0));

      if (Math.abs(dx) < sw/2 && Math.abs(dy) < sh/2) {
        c.style.cursor = 'grab';
      } else {
        c.style.cursor = 'grab';
      }
    };
  }


  // ============================================================
  //   VISUAL PICKER
  // ============================================================
  
  function openPicker(mode, targetInput) {
    const modal = $("#fxPicker");
    const grid = $("#fxPickerGrid");
    const filter = $("#fxPickerFilter");
    modal.style.display = "flex";
    grid.innerHTML = "";
    filter.value = "";
    
    // El picker siempre usa el .dat cargado globalmente
    const source = (mode === 'outfit') ? global.dat?.outfits : 
                   (mode === 'effect') ? global.dat?.effects : 
                   (mode === 'missile') ? global.dat?.missiles : null;

    if (!source || source.length < 2) {
        grid.innerHTML = "<p style='color:#f88; text-align:center;'>No hay datos para esta categoría cargados (global.dat está incompleto).</p>";
        return;
    }

    const total = source.length;

    function renderGrid(filteredIds) {
        grid.innerHTML = "";
        
        filteredIds.forEach(i => {
            const t = source[i];
            if (!t || !t.groups) return;
            
            const cell = document.createElement("div");
            cell.className = "picker-cell";
            cell.title = `ID: ${i}\n${t.name || ''}`;
            
            const cv = document.createElement("canvas");
            cv.width = 32; cv.height = 32;
            const cx = cv.getContext("2d");
            
            // Intentar dibujar el sprite principal (grupo 0, frame 0, pat 0)
            const group = t.groups[0];
            const sid = group?.sprites?.[0];
            if (sid > 0 && global.spr && global.spr.getSprite) {
                // Hay que usar putImageData para evitar problemas de CORS/renderizado
                const img = global.spr.getSprite(sid-1); 
                if (img) cx.putImageData(img, 0, 0);
            }

            cell.appendChild(cv);
            
            cell.onclick = () => {
                if (mode==='outfit') {
                    state.preset.looktype = i;
                    targetInput.value = i;
                } else {
                    const l = getActiveLayer();
                    if(l && !l.isBase) {
                        l.thingId = i;
                        l.groupIndex = 0; // Resetear grupo al cambiar el thing
                    }
                }
                syncUI(); // Refrescar la UI y el render
                modal.style.display = "none";
            };
            grid.appendChild(cell);
        });
    }

    // Filtrado (se hace con un debounce para mejorar el rendimiento)
    let renderTimeout = null;
    filter.oninput = () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            const val = filter.value.toLowerCase().trim();
            let filteredIds = [];
            
            if (val === '') {
                filteredIds = Array.from({ length: total - 1 }, (_, i) => i + 1);
            } else {
                for(let i = 1; i < total; i++) {
                    const t = source[i];
                    if (t) {
                        const name = (t.name || '').toLowerCase();
                        if (name.includes(val) || String(i).startsWith(val)) {
                            filteredIds.push(i);
                        }
                    }
                }
            }
            renderGrid(filteredIds);
        }, 150);
    };

    // Render inicial
    const initialIds = Array.from({ length: Math.min(total - 1, 500) }, (_, i) => i + 1); // Cargar solo los primeros 500 por defecto
    renderGrid(initialIds);
  }

  // ============================================================
  //   MERGE LOGIC (Crear Thing Unificado 1:1)
  // ============================================================

  async function mergeAndCreate() {
    const category = $("#fxMergeCategory").value;
    if (!confirm(`¿Crear un nuevo Thing unificado de tipo ${category.toUpperCase()} combinando todas las capas visibles? Esto sobrescribe los patrones de grupo X/Y/Z para forzar la fusión.`)) return;

    if (!global.dat || !global.spr || !global.spr.addOrFindSprite) {
        alert("⚠️ Error: global.dat o global.spr no están disponibles o no soportan la función de agregar sprite.");
        return;
    }

    // 1. Determinar el rango de la animación
    const baseLayer = getActiveLayer(); // Usaremos la capa activa como referencia
    const baseThing = getThing(baseLayer.type, baseLayer.thingId);
    if (!baseThing || !baseThing.groups[0]) {
        alert("⚠️ No se pudo obtener la referencia base para el Thing.");
        return;
    }
    const baseGroup = baseThing.groups[baseLayer.groupIndex || 0];

    const frames = baseGroup.frames || 1;
    const width = baseGroup.width || 1;
    const height = baseGroup.height || 1;
    const patternsX = baseGroup.patternX || 1;
    const patternsY = baseGroup.patternY || 1;
    const patternsZ = baseGroup.patternZ || 1;
    const layers = baseGroup.layers || 1;

    // 2. Crear el nuevo thing (Plantilla de datos)
    const newThing = {
        name: `Merged FX Thing [${category.toUpperCase()}]`,
        description: `Combinación de capas desde FX Lab.`,
        groups: [],
        version: global.dat.version, 
        lightLevel: baseThing.lightLevel || 0,
        lightColor: baseThing.lightColor || 0,
        // ... (otras propiedades de Thing)
    };
    
    // Copiar la estructura del grupo base para el nuevo thing, pero forzando 1 capa de sprite
    const newGroup = {
        ...baseGroup,
        sprites: [],
        layers: 1, // Forzar a 1 capa de sprite (todo va en la capa 0)
    };
    newThing.groups.push(newGroup);

    // 3. Renderizar cada cuadro, patrón y frame y extraer los sprites
    // Iteramos sobre todos los patrones de la base
    const baseId = state.preset.looktype;
    const layersToDraw = [
      ...Object.values(state.preset.layers).filter(l => l && l.type),
      ...state.preset.layers.extra
    ].sort((a,b) => (a.front === b.front) ? 0 : a.front ? 1 : -1);

    for (let f = 0; f < frames; f++) {
        for (let z = 0; z < patternsZ; z++) {
            for (let y = 0; y < patternsY; y++) {
                for (let x = 0; x < patternsX; x++) {

                    // Canvas para el frame combinado
                    const w = width;
                    const h = height;
                    const cv = (typeof OffscreenCanvas !== 'undefined') 
                        ? new OffscreenCanvas(w * TILE_SIZE, h * TILE_SIZE) 
                        : document.createElement("canvas");
                    cv.width = w * TILE_SIZE; 
                    cv.height = h * TILE_SIZE;
                    const cx = cv.getContext("2d");
                    cx.imageSmoothingEnabled = false;

                    const tMs = f * 100; // Tiempo ficticio para el frame actual

                    // 3.1. Renderizar Base Outfit (usando los patrones del bucle)
                    const tempBaseLayer = { 
                        _internal:true, type:'outfit', thingId:baseId, front:false, opacity:1, 
                        groupIndex: state.preset.baseGroupIndex, isBase: true, baseOffsetX:0, baseOffsetY:0, rotation:0, speed:1 
                    };
                    // La base usa los patrones del bucle (x,y,z) para dibujar el frame
                    drawLayerToContext(cx, tempBaseLayer, tMs, {px:x, py:y, pz:z});


                    // 3.2. Renderizar Capas
                    layersToDraw.forEach(l => {
                        // Las capas usan los patrones calculados internamente (defaultDir, mounted)
                        drawLayerToContext(cx, l, tMs);
                    });


                    // --- 4. Extraer Sprites del Canvas Combinado ---
                    const imageData = cx.getImageData(0, 0, cv.width, cv.height);
                    
                    for (let ty = 0; ty < h; ty++) {
                        for (let tx = 0; tx < w; tx++) {
                            const spriteCanvas = new OffscreenCanvas(32, 32);
                            const spriteCtx = spriteCanvas.getContext('2d');
                            spriteCtx.imageSmoothingEnabled = false;

                            // Copiar el área del sprite 32x32
                            const tempCanvas = new OffscreenCanvas(w * TILE_SIZE, h * TILE_SIZE);
                            const tempCtx = tempCanvas.getContext('2d');
                            tempCtx.putImageData(imageData, 0, 0);
                            
                            // Aseguramos que la extracción se haga de abajo hacia arriba (como en renderSpritesToCanvas)
                            const srcX = tx * TILE_SIZE;
                            const srcY = (h - 1 - ty) * TILE_SIZE;
                            
                            spriteCtx.drawImage(tempCanvas, srcX, srcY, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);

                            const newSpriteData = spriteCtx.getImageData(0, 0, 32, 32);
                            
                            // Agregar el nuevo sprite al SPR. addOrFindSprite devolverá el ID del sprite.
                            const spriteID = global.spr.addOrFindSprite(newSpriteData);
                            newGroup.sprites.push(spriteID);
                        }
                    }
                }
            }
        }
    }

    // 5. Guardar el Thing en el DAT
    let nextId = 0;
    if (category === 'outfit') {
      nextId = global.dat.outfitCount + 1;
      global.dat.outfits[nextId] = newThing;
      global.dat.outfitCount = nextId;
    } else if (category === 'effect') {
      nextId = global.dat.effectCount + 1;
      global.dat.effects[nextId] = newThing;
      global.dat.effectCount = nextId;
    } else if (category === 'missile') {
      nextId = global.dat.missileCount + 1;
      global.dat.missiles[nextId] = newThing;
      global.dat.missileCount = nextId;
    }

    alert(`✅ ¡Nuevo ${category} creado con ID ${nextId}! Ahora puedes buscarlo en el editor principal.`);
  }

  // Función auxiliar para dibujar una capa a un contexto específico
  function drawLayerToContext(ctx, layer, tMs, forcedPats = null) {
    // 1. Validación (similar a drawLayer, pero sin Timeline ni Luces)
    if (!layer._internal) {
      const cycle = 2000;
      const progress = (tMs % cycle) / cycle * 100;
      if (progress < layer.timeline.start || progress > layer.timeline.end) return;
    }
    
    const thing = getThing(layer.type, layer.thingId);
    if (!thing || !thing.groups) return;
    
    const groupIndex = layer._internal ? state.preset.baseGroupIndex : layer.groupIndex;
    const group = thing.groups[groupIndex] || thing.groups[0];
    if (!group) return;

    // 2. Calcular Frame
    const frameIdx = computeFrame(layer, group, tMs);
    
    // 3. Calcular Pattern
    const dir = (layer.dirMode === 'free') ? layer.dir : state.preset.defaultDir;
    const isMounted = layer.isMounted || layer._internal && state.preset.mountId > 0;
    
    const pats = forcedPats || resolvePatterns(layer, state.preset, group, dir, isMounted);

    // 4. Obtener Sprite
    const sprites = getSprites(group, frameIdx, pats);
    const layerCanvas = renderSpritesToCanvas(group, sprites);

    // 5. Posicionar y dibujar al contexto objetivo
    const sw = Math.max(1, group.width) * TILE_SIZE;
    const sh = Math.max(1, group.height) * TILE_SIZE;

    ctx.save();
    
    // El contexto de merge está centrado
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;

    const offsetX = layer.baseOffsetX || 0;
    const offsetY = layer.baseOffsetY || 0;
    
    // Trasladar al centro del grupo y luego aplicar offset
    ctx.translate(cx + offsetX, cy - offsetY); 
    if (layer.rotation) ctx.rotate(layer.rotation * Math.PI / 180);
    
    // Estilos solo para capas no internas
    if (!layer._internal) {
      ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
      if (layer.blendMode) ctx.globalCompositeOperation = layer.blendMode;
    }

    ctx.drawImage(layerCanvas, -sw/2, -sh/2);

    ctx.restore();
  }

  // ============================================================
  //   EXPORTS
  // ============================================================
  function openLab() {
    ensureAssets();
    buildUI();
    setupInteraction(); // Configurar interacciones de mouse/drag
    
    state.ui.overlay.style.display = "flex";
    
    const c = state.ui.canvas;
    const p = c.parentElement;
    c.width = p.clientWidth;
    c.height = p.clientHeight;

    // Si no hay efecto activo, forzar la creación de uno por defecto
    if (!state.preset.layers.effect) state.preset.layers.effect = createLayer("effect", 13);
    
    // Asegurar que la capa activa por defecto exista
    if (state.activeLayerKey !== 'base' && !state.preset.layers[state.activeLayerKey]) {
        state.activeLayerKey = 'effect';
    }

    syncUI();
    startRender(); // Asegurar que el loop de render esté corriendo
  }

  global.fxLab = {
    open: openLab,
    state: state,
    createLayer: createLayer // Exponer para debug o inicialización avanzada
  };

})(window);
