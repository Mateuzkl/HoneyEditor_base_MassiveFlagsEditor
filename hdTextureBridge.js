// hdTextureBridge.js
// ======================================================
// Honey Editor — DDS / HD Texture Bridge (overlay HD)
// Cliente base: 10.98 (pero retro-compatible)
// No modifica .dat/.spr, solo mantiene un mapa paralelo:
//
//   spriteId -> { path, size, layers, offset, meta }
//
//   HD_BRIDGE_DATA  = datos crudos (descriptor en memoria)
//   HD_BRIDGE       = API lógica de mapeo HD (para OTClient / motores)
//   HdBridge        = API UI (open/close + helpers)
//
// NOTA IMPORTANTE:
// - Este módulo SOLO maneja el descriptor (JSON).
// - NO carga ni rasteriza DDS/PNG. Eso es trabajo del cliente/juego.
// - Versión descriptor: 1.2 (añade template global, stats, tags y export OTClient).
// ======================================================

(function () {
  'use strict';

  // --------------------------------------------------
  // Utils DOM mínimos
  // --------------------------------------------------
  const $  = (sel, r = document) => r.querySelector(sel);
  const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));

  function el(tag, props = {}, children = null) {
    const e = document.createElement(tag);
    for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else e.setAttribute(k, props[k]);
    }
    if (children) {
      if (Array.isArray(children)) children.forEach(c => c && e.appendChild(c));
      else e.appendChild(children);
    }
    return e;
  }

  // --------------------------------------------------
  // Modelo en memoria del bridge (descriptor HD)
  // --------------------------------------------------
  /**
   * Estructura interna:
   * window.HD_BRIDGE_DATA = {
   *   version: '1.2',
   *   clientSignature: window.dat?.signature|0,
   *   spriteSize: 32,
   *   template: 'hd/{id}_{size}.dds', // patrón global opcional
   *   entries: {
   *     [spriteId]: {
   *       spriteId: Number,
   *       size: Number,            // 64,128,...
   *       path: String,            // ruta o nombre lógico
   *       layers: {                // opcionales
   *         base:   String|null,
   *         glow:   String|null,
   *         shadow: String|null,
   *         overlay:String|null
   *       },
   *       offsetX: Number,
   *       offsetY: Number,
   *       meta: {
   *         lastModified: Number (epoch ms) | undefined,
   *         tags: String[] | undefined,
   *         anyOther: ...
   *       }
   *     },
   *     ...
   *   }
   * }
   */

  const DEFAULT_DATA = () => ({
    version: '1.2',
    clientSignature: (window.dat && (window.dat.signature | 0)) || 0,
    spriteSize: 32,
    template: 'hd/{id}_{size}.dds',
    entries: Object.create(null)
  });

  if (!window.HD_BRIDGE_DATA) {
    window.HD_BRIDGE_DATA = DEFAULT_DATA();
  } else {
    // upgrade sencillo 1.0/1.1 -> 1.2 si hace falta
    const d = window.HD_BRIDGE_DATA;
    if (!d.version) d.version = '1.0';
    if (!('template' in d)) d.template = 'hd/{id}_{size}.dds';
    if (!d.entries) d.entries = Object.create(null);
  }

  // helpers de acceso
  function getEntry(id) {
    id = Number(id) | 0;
    if (!id || id < 0) return null;
    const map = window.HD_BRIDGE_DATA.entries;
    return map[id] || null;
  }
  function ensureEntry(id) {
    id = Number(id) | 0;
    if (!id || id < 0) throw new Error('spriteId inválido');
    const map = window.HD_BRIDGE_DATA.entries;
    let e = map[id];
    if (!e) {
      e = {
        spriteId: id,
        size: 64,
        path: '',
        layers: { base: null, glow: null, shadow: null, overlay: null },
        offsetX: 0,
        offsetY: 0,
        meta: {}
      };
      map[id] = e;
    }
    if (!e.layers) e.layers = { base: null, glow: null, shadow: null, overlay: null };
    if (!e.meta || typeof e.meta !== 'object') e.meta = {};
    return e;
  }
  function deleteEntry(id) {
    id = Number(id) | 0;
    if (!id || id < 0) return;
    const map = window.HD_BRIDGE_DATA.entries;
    delete map[id];
  }

  function touchMeta(e) {
    if (!e.meta || typeof e.meta !== 'object') e.meta = {};
    e.meta.lastModified = Date.now();
  }

  // --------------------------------------------------
  // API pública de datos (para motores / OTClients)
  // --------------------------------------------------
  window.HD_BRIDGE = {
    /** Devuelve el descriptor HD de un spriteId o null. */
    get(spriteId) {
      return getEntry(spriteId);
    },
    /** Set/merge de datos para un spriteId. */
    set(spriteId, data) {
      const e = ensureEntry(spriteId);
      if (!data || typeof data !== 'object') return e;
      if (data.size != null) e.size = Number(data.size) || e.size;
      if (data.path != null) e.path = String(data.path);
      if (!e.layers) e.layers = { base: null, glow: null, shadow: null, overlay: null };
      if (data.layers && typeof data.layers === 'object') {
        for (const k of ['base', 'glow', 'shadow', 'overlay']) {
          if (data.layers[k] != null) e.layers[k] = String(data.layers[k]);
        }
      }
      if (data.offsetX != null) e.offsetX = Number(data.offsetX) || 0;
      if (data.offsetY != null) e.offsetY = Number(data.offsetY) || 0;
      if (!e.meta) e.meta = {};
      if (data.meta && typeof data.meta === 'object') {
        Object.assign(e.meta, data.meta);
      }
      touchMeta(e);
      return e;
    },
    /** Elimina el mapeo HD de un spriteId. */
    remove(spriteId) {
      deleteEntry(spriteId);
    },
    /** Limpia todo el mapa HD. */
    reset() {
      window.HD_BRIDGE_DATA = DEFAULT_DATA();
    },
    /** Plantilla global de rutas (ej: "hd/items/{id}_{size}.dds"). */
    getTemplate() {
      return String(window.HD_BRIDGE_DATA.template || '');
    },
    setTemplate(tpl) {
      window.HD_BRIDGE_DATA.template = String(tpl || '');
      return window.HD_BRIDGE_DATA.template;
    },
    /** Devuelve un JSON plano exportable. */
    toJSON() {
      const src = window.HD_BRIDGE_DATA;
      const out = {
        version: src.version || '1.2',
        clientSignature: src.clientSignature | 0,
        spriteSize: src.spriteSize | 0,
        template: src.template || '',
        entries: []
      };
      const map = src.entries || {};
      for (const k of Object.keys(map)) {
        const e = map[k];
        if (!e) continue;
        out.entries.push({
          spriteId: e.spriteId | 0,
          size: e.size | 0,
          path: e.path || '',
          layers: {
            base:   e.layers?.base   ?? null,
            glow:   e.layers?.glow   ?? null,
            shadow: e.layers?.shadow ?? null,
            overlay:e.layers?.overlay?? null
          },
          offsetX: e.offsetX | 0,
          offsetY: e.offsetY | 0,
          meta: e.meta || {}
        });
      }
      return out;
    },
    /** Carga un JSON (objeto) como descriptor HD completo. */
    fromJSON(obj) {
      if (!obj || typeof obj !== 'object') {
        throw new Error('Descriptor HD inválido');
      }
      const data = DEFAULT_DATA();
      data.version = String(obj.version || '1.2');
      data.clientSignature = Number(obj.clientSignature) || 0;
      data.spriteSize = Number(obj.spriteSize) || 32;
      data.template = String(obj.template || data.template || '');
      data.entries = Object.create(null);
      if (Array.isArray(obj.entries)) {
        for (const e of obj.entries) {
          if (!e) continue;
          const id = Number(e.spriteId) | 0;
          if (!id || id < 0) continue;
          data.entries[id] = {
            spriteId: id,
            size: Number(e.size) || 64,
            path: String(e.path || ''),
            layers: {
              base:   e.layers?.base   ?? null,
              glow:   e.layers?.glow   ?? null,
              shadow: e.layers?.shadow ?? null,
              overlay:e.layers?.overlay?? null
            },
            offsetX: Number(e.offsetX) || 0,
            offsetY: Number(e.offsetY) || 0,
            meta: (e.meta && typeof e.meta === 'object') ? e.meta : {}
          };
        }
      }
      window.HD_BRIDGE_DATA = data;
    },
    /**
     * Exporta el descriptor a una estructura amigable para OTClient.
     * options.mode:
     *   - 'map'   => sprites en objeto { [id]: {...} } (por defecto)
     *   - 'array' => sprites en array [{id,...}, ...]
     */
    exportForOtclient(options = {}) {
      const src  = this.toJSON();
      const mode = options.mode === 'array' ? 'array' : 'map';
      const out = {
        version: src.version || '1.2',
        signature: src.clientSignature | 0,
        spriteSize: src.spriteSize | 0,
        template: src.template || '',
        sprites: (mode === 'array' ? [] : {})
      };
      const entries = src.entries || [];
      for (const e of entries) {
        const tags = (e.meta && Array.isArray(e.meta.tags)) ? e.meta.tags.slice() : [];
        const payload = {
          id: e.spriteId | 0,
          size: e.size | 0,
          path: e.path || '',
          layers: {
            base:   e.layers?.base   ?? null,
            glow:   e.layers?.glow   ?? null,
            shadow: e.layers?.shadow ?? null,
            overlay:e.layers?.overlay?? null
          },
          offset: { x: e.offsetX | 0, y: e.offsetY | 0 },
          tags
        };
        if (mode === 'array') out.sprites.push(payload);
        else out.sprites[payload.id] = payload;
      }
      return out;
    }
  };

  // --------------------------------------------------
  // UI — Modal independiente (no en sidebar)
  // --------------------------------------------------

  let modalEl = null;
  let panelEl = null;        // .modal-content
  let repaintTableRef = null;
  let repaintPreviewRef = null;

  // Estado del tutorial interactivo
  let tutStep = 0;
  let tutActive = false;
  let tutStepTextEl = null;
  let tutBtnPrev = null;
  let tutBtnNext = null;
  let tutBtnEnd  = null;

  // Estado de UI extendida
  let statsLabelEl = null;
  let tableSearchInputEl = null;
  let tableFilterSizeEl = null;
  let bulkFromEl = null;
  let bulkToEl = null;
  let bulkSizeEl = null;
  let bulkTplEl = null;
  let tagsInputEl = null;

  // Preview
  let previewCanvasEl = null;
  let previewCtx = null;

  function buildModalOnce() {
    if (modalEl) return modalEl;

    // Contenedor modal (usa .modal de styles.css)
    modalEl = el('div', { id: 'hdBridgeModal', class: 'modal hidden', role: 'dialog', 'aria-modal': 'true' });
    const content = el('div', { class: 'modal-content', id: 'hdBridgePanel' });
    panelEl = content;

    const headerRow = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px' }, [
      el('h2', { id: 'hdBridgeTitle', text: '🖼️ HD Texture Bridge (DDS/PNG)' }),
      el('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' },
        document.createTextNode('Mapeo HD paralelo (.spr intacto, cliente 1098+ extendido)')),
      (function () {
        const btn = el('button', { type: 'button', title: 'Cerrar' }, document.createTextNode('✖'));
        btn.addEventListener('click', closeModal, { passive: true });
        return btn;
      })()
    ]);

    const info = el('p', {
      class: 'muted',
      text: 'Asocia sprites clásicos (.spr) 32×32 con texturas HD (DDS/PNG) externas sin modificar el .spr original. Tu OTClient custom puede leer este descriptor JSON y dibujar HD encima o en lugar del sprite clásico.'
    });

    // --- Tutorial interactivo ---
    const tutBox = (function () {
      const box = el('div', {
        id: 'hdTutorialBox',
        style: 'margin-top:4px;padding:6px;border-radius:6px;border:1px dashed var(--border);font-size:12px'
      });

      const title = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px' }, [
        el('strong', { text: '📘 Tutorial interactivo — Cómo usar HD Texture Bridge' })
      ]);

      tutStepTextEl = el('p', {
        id: 'hdTutStepText',
        class: 'muted',
        text: 'Pulsa "Iniciar" para ver paso a paso cómo mapear un sprite clásico a una textura HD.'
      });

      const btnRow = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px' });

      const btnStart = el('button', { type: 'button', id: 'hdTutStartBtn' }, document.createTextNode('▶ Iniciar'));
      tutBtnPrev = el('button', { type: 'button', id: 'hdTutPrevBtn', disabled: 'disabled' }, document.createTextNode('⏮ Anterior'));
      tutBtnNext = el('button', { type: 'button', id: 'hdTutNextBtn', disabled: 'disabled' }, document.createTextNode('⏭ Siguiente'));
      tutBtnEnd  = el('button', { type: 'button', id: 'hdTutEndBtn',  disabled: 'disabled' }, document.createTextNode('⏹ Terminar'));

      btnRow.append(btnStart, tutBtnPrev, tutBtnNext, tutBtnEnd);

      btnStart.addEventListener('click', () => {
        tutActive = true;
        tutStep = 0;
        tutBtnPrev.disabled = true;
        tutBtnNext.disabled = false;
        tutBtnEnd.disabled  = false;
        applyTutorialStep();
      }, { passive: true });

      tutBtnPrev.addEventListener('click', () => {
        if (!tutActive) return;
        tutStep = Math.max(0, tutStep - 1);
        applyTutorialStep();
      }, { passive: true });

      tutBtnNext.addEventListener('click', () => {
        if (!tutActive) return;
        tutStep = Math.min(5, tutStep + 1);
        applyTutorialStep();
      }, { passive: true });

      tutBtnEnd.addEventListener('click', () => {
        endTutorial();
      }, { passive: true });

      box.append(title, tutStepTextEl, btnRow);
      return box;
    })();

    // --- Controles principales ---
    const rowTop = el('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px' }, [
      el('label', { style: 'flex:0 0 130px' }, [
        document.createTextNode('Sprite ID:'),
        el('input', { id: 'hdSpriteId', type: 'number', min: '1', value: '1', style: 'width:100%' })
      ]),
      el('label', { style: 'flex:0 0 110px' }, [
        document.createTextNode('Tamaño HD:'),
        el('input', { id: 'hdSize', type: 'number', min: '32', step: '32', value: '128', style: 'width:100%' })
      ]),
      el('label', { style: 'flex:1 1 160px' }, [
        document.createTextNode('Ruta / Nombre lógico:'),
        el('input', { id: 'hdPath', type: 'text', placeholder: 'ej: hd/tiles/ground_001_128.dds', style: 'width:100%' })
      ]),
      el('button', { id: 'hdApplyBtn', type: 'button' }, document.createTextNode('➕ Guardar/Actualizar'))
    ]);

    // Preview clásico 32×32
    const previewBox = (function () {
      const box = el('div', {
        id: 'hdPreviewBox',
        style: 'margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap'
      });
      previewCanvasEl = el('canvas', {
        id: 'hdPreviewCanvas',
        width: '64',
        height: '64',
        style: 'border-radius:6px;border:1px solid var(--border);background:#111;image-rendering:pixelated;'
      });
      previewCtx = previewCanvasEl.getContext('2d');
      if (previewCtx) previewCtx.imageSmoothingEnabled = false;

      const label = el('div', { style: 'display:flex;flex-direction:column;font-size:11px' }, [
        el('strong', { text: 'Preview sprite clásico 32×32' }),
        el('span', { class: 'muted', style: 'font-size:11px' },
          document.createTextNode('Solo usa el .spr actual. El overlay HD se renderiza en tu OTClient.'))
      ]);

      box.append(previewCanvasEl, label);
      return box;
    })();

    const rowLayers = el('div', { class: 'row', style: 'display:grid;gap:6px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:8px' }, [
      el('label', {}, [
        document.createTextNode('Layer base:'),
        el('input', { id: 'hdLayerBase', type: 'text', placeholder: 'ej: hd/base/...', style: 'width:100%' })
      ]),
      el('label', {}, [
        document.createTextNode('Layer glow:'),
        el('input', { id: 'hdLayerGlow', type: 'text', placeholder: 'hd/glow/...', style: 'width:100%' })
      ]),
      el('label', {}, [
        document.createTextNode('Layer shadow:'),
        el('input', { id: 'hdLayerShadow', type: 'text', placeholder: 'hd/shadow/...', style: 'width:100%' })
      ]),
      el('label', {}, [
        document.createTextNode('Layer overlay:'),
        el('input', { id: 'hdLayerOverlay', type: 'text', placeholder: 'hd/overlay/...', style: 'width:100%' })
      ])
    ]);

    // Tags (meta.tags)
    const rowTags = el('div', { class: 'row', style: 'margin-top:6px' }, [
      el('label', { style: 'flex:1 1 100%' }, [
        document.createTextNode('Tags (separados por coma):'),
        el('input', {
          id: 'hdTags',
          type: 'text',
          placeholder: 'weapon, fire, legendary',
          style: 'width:100%'
        })
      ])
    ]);

    const rowOffsets = el('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end' }, [
      el('label', { style: 'flex:0 0 90px' }, [
        document.createTextNode('Offset X:'),
        el('input', { id: 'hdOffsetX', type: 'number', value: '0', style: 'width:100%' })
      ]),
      el('label', { style: 'flex:0 0 90px' }, [
        document.createTextNode('Offset Y:'),
        el('input', { id: 'hdOffsetY', type: 'number', value: '0', style: 'width:100%' })
      ]),
      el('button', { id: 'hdDeleteBtn', type: 'button', style: 'margin-left:auto' }, document.createTextNode('🗑️ Eliminar mapeo'))
    ]);

    // Import / Export / Reset + utilidades de mapeo actual
    const rowIO = el('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center' }, [
      (function () {
        const label = el('label', { class: 'btn-like', style: 'cursor:pointer;display:inline-flex;align-items:center;gap:6px' }, [
          document.createTextNode('📂 Importar descriptor HD (.json)')
        ]);
        const inp = el('input', { id: 'hdImportFile', type: 'file', accept: '.json,application/json', style: 'display:none' });
        label.appendChild(inp);
        return label;
      })(),
      el('button', { id: 'hdExportBtn', type: 'button' }, document.createTextNode('💾 Exportar descriptor HD')),
      el('button', { id: 'hdExportOtBtn', type: 'button' }, document.createTextNode('🧩 Export OTClient JSON')),
      el('button', { id: 'hdResetBtn', type: 'button' }, document.createTextNode('⚠️ Reset HD Bridge (solo descriptor)')),
      el('button', { id: 'hdCopyBtn', type: 'button' }, document.createTextNode('📋 Copiar mapeo actual'))
    ]);

    // Barra de estado + búsqueda rápida
    statsLabelEl = el('span', {
      id: 'hdStatsLabel',
      class: 'muted',
      style: 'font-size:11px;white-space:nowrap;'
    }, document.createTextNode('Entradas HD: 0'));

    tableSearchInputEl = el('input', {
      id: 'hdTableSearch',
      type: 'text',
      placeholder: 'Buscar por ID, path o tag...',
      style: 'flex:1 1 140px;min-width:120px'
    });

    tableFilterSizeEl = el('select', {
      id: 'hdTableFilterSize',
      style: 'flex:0 0 90px'
    }, [
      el('option', { value: '0', text: 'Todos' }),
      el('option', { value: '32', text: '32' }),
      el('option', { value: '64', text: '64' }),
      el('option', { value: '128', text: '128' }),
      el('option', { value: '256', text: '256' }),
      el('option', { value: '512', text: '512' })
    ]);

    const rowTools = el('div', {
      class: 'row',
      style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px'
    }, [
      statsLabelEl,
      el('span', { class: 'muted', style: 'font-size:11px;margin-left:auto;' }, document.createTextNode('Filtro tabla:')),
      tableSearchInputEl,
      tableFilterSizeEl
    ]);

    // Panel de asignación masiva (rango)
    bulkFromEl = el('input', { id: 'hdBulkFrom', type: 'number', min: '1', value: '1', style: 'width:100%' });
    bulkToEl   = el('input', { id: 'hdBulkTo', type: 'number', min: '1', value: '1', style: 'width:100%' });
    bulkSizeEl = el('input', { id: 'hdBulkSize', type: 'number', min: '32', step: '32', value: '128', style: 'width:100%' });
    bulkTplEl  = el('input', {
      id: 'hdBulkTpl',
      type: 'text',
      placeholder: 'Plantilla ruta, ej: hd/items/{id}_{size}.dds',
      style: 'width:100%'
    });

    const bulkApplyBtn = el('button', { id: 'hdBulkApplyBtn', type: 'button' }, document.createTextNode('⚙️ Generar rango'));

    const bulkBox = el('div', {
      id: 'hdBulkBox',
      style: 'margin-top:8px;padding:6px;border-radius:6px;border:1px dashed var(--border);font-size:12px'
    }, [
      el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap' }, [
        el('strong', { text: '🔁 Asignación masiva (rango de sprites)' }),
        el('span', { class: 'muted', style: 'font-size:11px' },
          document.createTextNode('Ideal para packs completos donde la ruta sigue un patrón.'))
      ]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:4px' }, [
        el('label', { style: 'flex:0 0 100px' }, [
          document.createTextNode('Desde ID:'),
          bulkFromEl
        ]),
        el('label', { style: 'flex:0 0 100px' }, [
          document.createTextNode('Hasta ID:'),
          bulkToEl
        ]),
        el('label', { style: 'flex:0 0 90px' }, [
          document.createTextNode('Size:'),
          bulkSizeEl
        ])
      ]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end' }, [
        el('label', { style: 'flex:1 1 220px' }, [
          document.createTextNode('Plantilla de ruta:'),
          bulkTplEl
        ]),
        bulkApplyBtn
      ]),
      el('p', {
        class: 'muted',
        style: 'margin-top:4px;font-size:11px'
      }, document.createTextNode('Placeholders válidos: {id}, {sprite}, {size}. Ejemplo: "hd/tiles/{id}_{size}.dds".'))
    ]);

    const tableWrap = el('div', {
      id: 'hdTableWrap',
      style: 'margin-top:10px;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px'
    }, [
      el('table', { id: 'hdTable', style: 'width:100%;border-collapse:collapse;font-size:12px' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { style: 'text-align:left;padding:2px 4px' }, document.createTextNode('ID')),
          el('th', { style: 'text-align:left;padding:2px 4px' }, document.createTextNode('Size')),
          el('th', { style: 'text-align:left;padding:2px 4px' }, document.createTextNode('Path/Base')),
          el('th', { style: 'text-align:left;padding:2px 4px' }, document.createTextNode('Layers')),
          el('th', { style: 'text-align:left;padding:2px 4px' }, document.createTextNode('Tags')),
          el('th', { style: 'text-align:left;padding:2px 4px' }, document.createTextNode('Modificado'))
        ])),
        el('tbody', { id: 'hdTableBody' })
      ])
    ]);

    content.append(
      headerRow,
      info,
      tutBox,
      rowTop,
      previewBox,
      rowLayers,
      rowTags,
      rowOffsets,
      rowIO,
      rowTools,
      bulkBox,
      tableWrap
    );
    modalEl.appendChild(content);
    document.body.appendChild(modalEl);

    // ---------- Wiring eventos ----------
    const idInput      = $('#hdSpriteId', panelEl);
    const sizeInput    = $('#hdSize', panelEl);
    const pathInput    = $('#hdPath', panelEl);
    const baseInput    = $('#hdLayerBase', panelEl);
    const glowInput    = $('#hdLayerGlow', panelEl);
    const shadowInput  = $('#hdLayerShadow', panelEl);
    const overlayInput = $('#hdLayerOverlay', panelEl);
    const offXInput    = $('#hdOffsetX', panelEl);
    const offYInput    = $('#hdOffsetY', panelEl);
    const applyBtn     = $('#hdApplyBtn', panelEl);
    const delBtn       = $('#hdDeleteBtn', panelEl);
    const importInput  = $('#hdImportFile', panelEl);
    const exportBtn    = $('#hdExportBtn', panelEl);
    const exportOtBtn  = $('#hdExportOtBtn', panelEl);
    const resetBtn     = $('#hdResetBtn', panelEl);
    const copyBtn      = $('#hdCopyBtn', panelEl);
    const tbody        = $('#hdTableBody', panelEl);
    tagsInputEl        = $('#hdTags', panelEl);

    // Rellenar plantilla global en el input bulk
    try {
      const tpl = window.HD_BRIDGE.getTemplate();
      if (bulkTplEl && !bulkTplEl.value) bulkTplEl.value = tpl || '';
    } catch (_) {}

    function formatLastModified(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return '-';
      const d = new Date(n);
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const hh = String(d.getHours()).padStart(2,'0');
      const mi = String(d.getMinutes()).padStart(2,'0');
      return `${dd}/${mm}/${yy} ${hh}:${mi}`;
    }

    function updateStats(allEntries) {
      if (!statsLabelEl) return;
      const totalEntries = Array.isArray(allEntries) ? allEntries.length : 0;
      let totalSprites = 0;
      try {
        if (window.spr && typeof window.spr.totalSprites === 'number') {
          totalSprites = window.spr.totalSprites | 0;
        }
      } catch (_) {}
      let coverage = '';
      if (totalSprites > 0) {
        const pct = (totalEntries * 100) / totalSprites;
        coverage = ` | Cobertura: ${pct.toFixed(1)}% de ${totalSprites}`;
      }

      let tagged = 0;
      if (Array.isArray(allEntries)) {
        for (const e of allEntries) {
          const tags = e && e.meta && Array.isArray(e.meta.tags) ? e.meta.tags : null;
          if (tags && tags.length) tagged++;
        }
      }
      const tagInfo = tagged ? ` | Con tags: ${tagged}` : '';

      statsLabelEl.textContent = `Entradas HD: ${totalEntries}${coverage}${tagInfo}`;
    }

    function applyTableFilter(entries) {
      const q = (tableSearchInputEl?.value || '').toLowerCase().trim();
      const sizeFilter = Number(tableFilterSizeEl?.value || '0') | 0;
      if (!entries || !entries.length) return [];
      return entries.filter(e => {
        if (!e) return false;
        if (sizeFilter && (Number(e.size) | 0) !== sizeFilter) return false;
        if (!q) return true;
        const idStr   = String(e.spriteId || '');
        const pathStr = String(e.path || e.layers?.base || '').toLowerCase();
        const tagsStr = (e.meta && Array.isArray(e.meta.tags))
          ? e.meta.tags.join(' ').toLowerCase()
          : '';
        return idStr.includes(q) || pathStr.includes(q) || tagsStr.includes(q);
      });
    }

    function repaintTable() {
      const data = window.HD_BRIDGE.toJSON();
      const entriesAll = (data.entries || []).slice().sort((a, b) => (a.spriteId | 0) - (b.spriteId | 0));
      const entries = applyTableFilter(entriesAll);
      tbody.innerHTML = '';
      for (const e of entries) {
        const tr = el('tr', { 'data-id': String(e.spriteId) });
        tr.appendChild(el('td', { style: 'padding:2px 4px' }, document.createTextNode(String(e.spriteId))));
        tr.appendChild(el('td', { style: 'padding:2px 4px' }, document.createTextNode(String(e.size))));
        tr.appendChild(el('td', {
          style: 'padding:2px 4px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        }, document.createTextNode(e.path || (e.layers?.base || ''))));
        const layers = [];
        if (e.layers?.base) layers.push('B');
        if (e.layers?.glow) layers.push('G');
        if (e.layers?.shadow) layers.push('S');
        if (e.layers?.overlay) layers.push('O');
        tr.appendChild(el('td', { style: 'padding:2px 4px' }, document.createTextNode(layers.join(',') || '-')));
        const tagsStr = (e.meta && Array.isArray(e.meta.tags) && e.meta.tags.length)
          ? e.meta.tags.join(', ')
          : '-';
        tr.appendChild(el('td', {
          style: 'padding:2px 4px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        }, document.createTextNode(tagsStr)));
        tr.appendChild(el('td', { style: 'padding:2px 4px;font-size:11px' }, document.createTextNode(
          formatLastModified(e.meta && e.meta.lastModified)
        )));
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
          fillFormFromEntry(e.spriteId);
        }, { passive: true });
        tbody.appendChild(tr);
      }
      updateStats(entriesAll);
    }
    repaintTableRef = repaintTable;

    // Preview clásico de un sprite (usa spr global)
    function repaintPreview() {
      if (!previewCanvasEl || !previewCtx || !panelEl) return;
      const idInputLocal = $('#hdSpriteId', panelEl);
      const sprParser = window.spr;
      const w = previewCanvasEl.width;
      const h = previewCanvasEl.height;

      previewCtx.save();
      previewCtx.imageSmoothingEnabled = false;
      previewCtx.clearRect(0, 0, w, h);
      previewCtx.fillStyle = '#111';
      previewCtx.fillRect(0, 0, w, h);

      const id = idInputLocal ? (Number(idInputLocal.value) | 0) : 0;
      if (!sprParser || typeof sprParser.getSprite !== 'function' || !id || id <= 0 || id > (sprParser.totalSprites | 0)) {
        // fondo limpio, sin sprite
        previewCtx.restore();
        return;
      }

      let img = null;
      try {
        img = sprParser.getSprite(id - 1);
      } catch (_) {}

      if (!img) {
        previewCtx.restore();
        return;
      }

      const cell = document.createElement('canvas');
      cell.width = cell.height = 32;
      const cg = cell.getContext('2d');
      cg.imageSmoothingEnabled = false;
      cg.putImageData(img, 0, 0);

      const scale = Math.floor(Math.min(w, h) / 32) || 2;
      const dw = 32 * scale;
      const dh = 32 * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;

      previewCtx.drawImage(cell, dx, dy, dw, dh);
      previewCtx.restore();
    }
    repaintPreviewRef = repaintPreview;

    function fillFormFromEntry(id) {
      const e = window.HD_BRIDGE.get(id);
      if (!e) return;
      idInput.value      = String(e.spriteId);
      sizeInput.value    = String(e.size || 64);
      pathInput.value    = e.path || '';
      baseInput.value    = e.layers?.base || '';
      glowInput.value    = e.layers?.glow || '';
      shadowInput.value  = e.layers?.shadow || '';
      overlayInput.value = e.layers?.overlay || '';
      offXInput.value    = String(e.offsetX || 0);
      offYInput.value    = String(e.offsetY || 0);
      if (tagsInputEl) {
        const tags = e.meta && Array.isArray(e.meta.tags) ? e.meta.tags : [];
        tagsInputEl.value = tags.length ? tags.join(', ') : '';
      }
      if (typeof repaintPreviewRef === 'function') {
        repaintPreviewRef();
      }
    }

    applyBtn.addEventListener('click', () => {
      const id = Number(idInput.value) | 0;
      if (!id || id < 0) {
        alert('Sprite ID inválido');
        return;
      }
      const data = {
        size: Number(sizeInput.value) || 64,
        path: pathInput.value.trim(),
        layers: {
          base:    baseInput.value.trim()    || null,
          glow:    glowInput.value.trim()    || null,
          shadow:  shadowInput.value.trim()  || null,
          overlay: overlayInput.value.trim() || null
        },
        offsetX: Number(offXInput.value) || 0,
        offsetY: Number(offYInput.value) || 0
      };
      const entry = window.HD_BRIDGE.set(id, data);

      // tags -> meta.tags
      if (tagsInputEl) {
        const tags = tagsInputEl.value
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
        if (!entry.meta || typeof entry.meta !== 'object') entry.meta = {};
        entry.meta.tags = tags.length ? tags : undefined;
        touchMeta(entry);
      }

      repaintTable();
      if (typeof repaintPreviewRef === 'function') {
        repaintPreviewRef();
      }
    }, { passive: true });

    delBtn.addEventListener('click', () => {
      const id = Number(idInput.value) | 0;
      if (!id || id < 0) return;
      if (!window.confirm('¿Eliminar mapeo HD para sprite ' + id + '?')) return;
      window.HD_BRIDGE.remove(id);
      repaintTable();
      if (typeof repaintPreviewRef === 'function') {
        repaintPreviewRef();
      }
    }, { passive: true });

    // Copiar mapeo actual a portapapeles
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const id = Number(idInput.value) | 0;
        if (!id || id < 0) {
          alert('Sprite ID inválido para copiar.');
          return;
        }
        const e = window.HD_BRIDGE.get(id);
        if (!e) {
          alert('No hay mapeo HD para el sprite ' + id + '.');
          return;
        }
        const snippet = JSON.stringify(e, null, 2);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(snippet);
            alert('Mapeo HD copiado al portapapeles.');
          } else {
            window.prompt('Copia manualmente el JSON del mapeo:', snippet);
          }
        } catch (err) {
          console.error(err);
          window.prompt('No se pudo usar el portapapeles automático. Copia el JSON manualmente:', snippet);
        }
      }, { passive: true });
    }

    // Import
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(String(reader.result || '{}'));
          window.HD_BRIDGE.fromJSON(obj);
          // refrescar plantilla global en UI
          try {
            const tpl = window.HD_BRIDGE.getTemplate();
            if (bulkTplEl) bulkTplEl.value = tpl || '';
          } catch (_) {}
          repaintTable();
          alert('Descriptor HD importado correctamente.\n\nSugerencia: guarda este JSON junto a tu pack .dat/.spr como "cliente 1098 extendido".');
        } catch (e) {
          console.error(e);
          alert('Error leyendo descriptor HD: ' + e.message);
        }
      };
      reader.readAsText(file);
      importInput.value = '';
    });

    // Export descriptor normal
    exportBtn.addEventListener('click', () => {
      try {
        const obj = window.HD_BRIDGE.toJSON();
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'hd_bridge_descriptor.json' });
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
      } catch (e) {
        console.error(e);
        alert('Error exportando descriptor HD: ' + e.message);
      }
    }, { passive: true });

    // Export formato OTClient
    if (exportOtBtn) {
      exportOtBtn.addEventListener('click', () => {
        try {
          const obj = window.HD_BRIDGE.exportForOtclient({ mode: 'map' });
          const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: 'hd_bridge_otclient.json' });
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 0);
        } catch (e) {
          console.error(e);
          alert('Error exportando formato OTClient: ' + e.message);
        }
      }, { passive: true });
    }

    // Reset
    resetBtn.addEventListener('click', () => {
      if (!window.confirm('Esto borrará TODO el mapa HD en memoria (solo descriptor, no toca .spr/.dat). ¿Continuar?')) return;
      window.HD_BRIDGE.reset();
      // re-aplicar plantilla default al input
      try {
        const tpl = window.HD_BRIDGE.getTemplate();
        if (bulkTplEl) bulkTplEl.value = tpl || '';
      } catch (_) {}
      repaintTable();
      if (typeof repaintPreviewRef === 'function') {
        repaintPreviewRef();
      }
    }, { passive: true });

    // Búsqueda / filtro tabla
    if (tableSearchInputEl) {
      tableSearchInputEl.addEventListener('input', () => {
        repaintTable();
      }, { passive: true });
    }
    if (tableFilterSizeEl) {
      tableFilterSizeEl.addEventListener('change', () => {
        repaintTable();
      }, { passive: true });
    }

    // Asignación masiva por rango
    if (bulkApplyBtn) {
      bulkApplyBtn.addEventListener('click', () => {
        const fromId = Number(bulkFromEl && bulkFromEl.value) | 0;
        const toId   = Number(bulkToEl   && bulkToEl.value)   | 0;
        const size   = Number(bulkSizeEl && bulkSizeEl.value) || 128;
        const tplRaw = (bulkTplEl && bulkTplEl.value ? bulkTplEl.value : '').trim();

        if (!fromId || !toId || fromId < 0 || toId < 0) {
          alert('Rango inválido. Revisa "Desde ID" y "Hasta ID".');
          return;
        }
        const a = Math.min(fromId, toId);
        const b = Math.max(fromId, toId);
        const count = (b - a + 1);
        if (count <= 0) {
          alert('Rango vacío.');
          return;
        }
        if (count > 50000 && !window.confirm(`Esto generará ${count} entradas HD. ¿Seguro que quieres continuar?`)) {
          return;
        }

        let tpl = tplRaw || window.HD_BRIDGE.getTemplate() || 'hd/{id}_{size}.dds';
        // guardar plantilla global
        window.HD_BRIDGE.setTemplate(tpl);
        if (bulkTplEl) bulkTplEl.value = tpl;

        function renderPath(idVal) {
          let p = tpl;
          p = p.replace(/\{id\}/g, String(idVal));
          p = p.replace(/\{sprite\}/g, String(idVal));
          p = p.replace(/\{size\}/g, String(size));
          return p;
        }

        for (let id = a; id <= b; id++) {
          window.HD_BRIDGE.set(id, {
            size,
            path: renderPath(id)
          });
        }
        repaintTable();
        alert(`Rango aplicado: ${a} → ${b} (${count} sprites).`);
      }, { passive: true });
    }

    // Autocomplete simple con sprite actual si existe (versión inicial)
    try {
      if (window.currentSpriteId) {
        idInput.value = String(window.currentSpriteId | 0);
      }
    } catch (_) {}

    // Preview reactivo al escribir ID
    if (idInput) {
      const handler = () => {
        if (typeof repaintPreviewRef === 'function') repaintPreviewRef();
      };
      idInput.addEventListener('input', handler, { passive: true });
      idInput.addEventListener('change', handler, { passive: true });
    }

    // Primera pintura de preview
    if (typeof repaintPreviewRef === 'function') {
      repaintPreviewRef();
    }

    return modalEl;
  }

  // ---------- Tutorial interactivo (lógica) ----------

  function clearTutorialHighlights() {
    if (!panelEl) return;
    const highlightIds = [
      'hdSpriteId','hdSize','hdPath',
      'hdLayerBase','hdLayerGlow','hdLayerShadow','hdLayerOverlay',
      'hdOffsetX','hdOffsetY',
      'hdImportFile','hdExportBtn','hdResetBtn'
    ];
    for (const id of highlightIds) {
      const node = $('#'+id, panelEl);
      if (node) {
        node.style.outline = '';
        node.style.boxShadow = '';
      }
    }
  }

  function highlightNode(node) {
    if (!node) return;
    node.style.outline = '2px solid #3cf';
    node.style.boxShadow = '0 0 6px rgba(0,192,255,0.7)';
  }

  function applyTutorialStep() {
    if (!panelEl || !tutStepTextEl) return;
    tutActive = true;
    clearTutorialHighlights();

    const idInput      = $('#hdSpriteId', panelEl);
    const sizeInput    = $('#hdSize', panelEl);
    const pathInput    = $('#hdPath', panelEl);
    const baseInput    = $('#hdLayerBase', panelEl);
    const glowInput    = $('#hdLayerGlow', panelEl);
    const shadowInput  = $('#hdLayerShadow', panelEl);
    const overlayInput = $('#hdLayerOverlay', panelEl);
    const offXInput    = $('#hdOffsetX', panelEl);
    const offYInput    = $('#hdOffsetY', panelEl);
    const importInput  = $('#hdImportFile', panelEl);
    const exportBtn    = $('#hdExportBtn', panelEl);
    const resetBtn     = $('#hdResetBtn', panelEl);

    // Control de botones
    if (tutBtnPrev && tutBtnNext && tutBtnEnd) {
      tutBtnPrev.disabled = (tutStep <= 0);
      tutBtnNext.disabled = (tutStep >= 5);
      tutBtnEnd.disabled  = false;
    }

    switch (tutStep) {
      case 0:
        tutStepTextEl.textContent =
          'Paso 1 — Selección del sprite base: elige el Sprite ID que quieres extender a HD. El módulo intentará usar el sprite del thing actualmente seleccionado en Honey.';
        highlightNode(idInput);
        if (idInput) idInput.focus();
        break;
      case 1:
        tutStepTextEl.textContent =
          'Paso 2 — Tamaño HD: indica el tamaño de la textura HD (por ejemplo 64, 128). Esto NO modifica el .spr, solo le dice a tu OTClient qué resoluciones esperar.';
        highlightNode(sizeInput);
        if (sizeInput) sizeInput.focus();
        break;
      case 2:
        tutStepTextEl.textContent =
          'Paso 3 — Ruta / nombre lógico: escribe la ruta o identificador de la textura HD (ej: "hd/items/sword_001_128.dds"). Tu cliente la cargará usando este valor.';
        highlightNode(pathInput);
        if (pathInput) pathInput.focus();
        break;
      case 3:
        tutStepTextEl.textContent =
          'Paso 4 — Capas opcionales: puedes definir capas base, glow, shadow y overlay si tu OTClient soporta render por capas (por ejemplo glow aditivo o sombras separadas).';
        highlightNode(baseInput);
        highlightNode(glowInput);
        highlightNode(shadowInput);
        highlightNode(overlayInput);
        break;
      case 4:
        tutStepTextEl.textContent =
          'Paso 5 — Offset X/Y: ajusta la posición de la textura HD en relación al sprite 32×32 clásico (por ejemplo mover la textura unos píxeles hacia arriba).';
        highlightNode(offXInput);
        highlightNode(offYInput);
        if (offXInput) offXInput.focus();
        break;
      case 5:
        tutStepTextEl.textContent =
          'Paso 6 — Importar / Exportar: exporta el descriptor HD como "hd_bridge_descriptor.json" para guardarlo junto a tu .dat/.spr. Tu OTClient lo leerá al inicio. También puedes importar uno existente o hacer reset del mapa.';
        highlightNode(importInput);
        highlightNode(exportBtn);
        highlightNode(resetBtn);
        break;
      default:
        endTutorial();
        break;
    }
  }

  function endTutorial() {
    tutActive = false;
    tutStep = 0;
    clearTutorialHighlights();
    if (tutStepTextEl) {
      tutStepTextEl.textContent =
        'Tutorial finalizado. Puedes reiniciarlo cuando quieras o seguir usando el módulo de forma manual.';
    }
    if (tutBtnPrev && tutBtnNext && tutBtnEnd) {
      tutBtnPrev.disabled = true;
      tutBtnNext.disabled = true;
      tutBtnEnd.disabled  = true;
    }
  }

  // --------------------------------------------------
  // Integración con selección actual de Honey
  // --------------------------------------------------
  // Intenta deducir un spriteId razonable a partir del thing actual:
  // - Si existe window.currentSpriteId, lo usa directamente.
  // - Si no, usa currentCategory + currentThingId + dat.getThing(...)
  //   y toma el primer sprite del grupo actual (groupIndex) o el primero.
  function autoGuessSpriteIdInput() {
    if (!panelEl) return;
    const idInput = $('#hdSpriteId', panelEl);
    if (!idInput) return;

    let guessed = null;

    // 1) Si el editor ya expone currentSpriteId, lo usamos.
    try {
      if (typeof window.currentSpriteId === 'number' && window.currentSpriteId > 0) {
        guessed = window.currentSpriteId | 0;
      }
    } catch (_) {}

    // 2) Intentar inferirlo desde el thing actual.
    if (!guessed) {
      try {
        const dat = window.dat;
        const cat = window.currentCategory || 'item';
        const tid = (window.currentThingId | 0) || 0;
        const thing = dat && typeof dat.getThing === 'function'
          ? dat.getThing(cat, tid)
          : null;
        if (thing && Array.isArray(thing.groups) && thing.groups.length) {
          const gi = (window.groupIndex | 0) || 0;
          const g = thing.groups[gi] || thing.groups[0];
          if (g && Array.isArray(g.sprites) && g.sprites.length) {
            guessed = g.sprites[0] | 0;
          }
        }
      } catch (_) {}
    }

    if (guessed && !isNaN(guessed) && guessed > 0) {
      idInput.value = String(guessed | 0);
    }
  }

  // --------------------------------------------------
  // Apertura / cierre del modal
  // --------------------------------------------------
  function openModal() {
    const m = buildModalOnce();
    m.classList.remove('hidden');

    // Autorellenar Sprite ID desde el contexto actual de Honey
    autoGuessSpriteIdInput();

    // refrescar tabla por si hubo cambios externos en el descriptor
    if (typeof repaintTableRef === 'function') {
      repaintTableRef();
    }

    // Reiniciar tutorial en estado "no activo"
    tutActive = false;
    tutStep = 0;
    clearTutorialHighlights();
    if (tutStepTextEl) {
      tutStepTextEl.textContent =
        'Pulsa "Iniciar" para ver paso a paso cómo mapear un sprite clásico a una textura HD.';
    }
    if (tutBtnPrev && tutBtnNext && tutBtnEnd) {
      tutBtnPrev.disabled = true;
      tutBtnNext.disabled = true;
      tutBtnEnd.disabled  = true;
    }

    // Refrescar plantilla global visible
    try {
      const tpl = window.HD_BRIDGE.getTemplate();
      if (bulkTplEl && !bulkTplEl.value) bulkTplEl.value = tpl || '';
    } catch (_) {}

    // Refrescar preview
    if (typeof repaintPreviewRef === 'function') {
      repaintPreviewRef();
    }
  }

  function closeModal() {
    if (modalEl) modalEl.classList.add('hidden');
    endTutorial();
  }

  // ESC para cerrar
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modalEl && !modalEl.classList.contains('hidden')) {
      closeModal();
    }
  }, { passive: true });

  // Construir una vez tras DOM listo (queda oculto hasta .open())
  document.addEventListener('DOMContentLoaded', () => {
    buildModalOnce();
  }, { once: true });

  // --------------------------------------------------
  // API UI pública (como módulo)
  // --------------------------------------------------
  if (!window.HdBridge) window.HdBridge = {};
  window.HdBridge.open         = openModal;
  window.HdBridge.close        = closeModal;
  // Exponer también accesos a la capa de datos (por comodidad)
  window.HdBridge.get          = window.HD_BRIDGE.get;
  window.HdBridge.set          = window.HD_BRIDGE.set;
  window.HdBridge.remove       = window.HD_BRIDGE.remove;
  window.HdBridge.reset        = window.HD_BRIDGE.reset;
  window.HdBridge.toJSON       = window.HD_BRIDGE.toJSON;
  window.HdBridge.fromJSON     = window.HD_BRIDGE.fromJSON;
  window.HdBridge.getTemplate  = window.HD_BRIDGE.getTemplate;
  window.HdBridge.setTemplate  = window.HD_BRIDGE.setTemplate;
  window.HdBridge.exportForOtclient = function (options) {
    return window.HD_BRIDGE.exportForOtclient(options || {});
  };

})();
