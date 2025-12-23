/**
 * ============================================================================
 * Módulo: Bulk Flag Editor (Edición Masiva) v3.1 (CUSTOM FLAGS + DIALOGOS)
 * Autor: Honey Editor Extension
 * Descripción:
 * - FIX: Renderizado de Sprites optimizado.
 * - NUEVO: Sistema de "Custom Flags" persistente (LocalStorage).
 * - NUEVO: UI para agregar flags manualmente desde el panel.
 * - NUEVO: **Botón para eliminar Custom Flags.**
 * - NUEVO: **Sistema de diálogos modales (alert/confirm/prompt) reutilizable.**
 * - UPDATE: Lógica de aplicación basada en Arrays (soporta flags > 32, ej: 0xFE).
 * - UPDATE: **promptAddFlag y applyChanges usan diálogos asíncronos.**
 * ============================================================================
 */
(function() {
    // ==========================================
    // 0. Base de Datos de Flags (Nombres + Hex)
    // ==========================================
    const DEFAULT_FLAGS = {
      0x00: "Es Suelo (Ground)", 0x01: "Borde de Suelo (Clip)", 0x02: "Suelo (Bottom)",
      0x03: "Suelo (Top)", 0x04: "Contenedor", 0x05: "Apilable (Stackable)", 0x06: "Forzar Uso",
      0x07: "Multi Uso", 0x08: "Escribible", 0x09: "Escribible (1 vez)", 0x0A: "Contenedor Líquido",
      0x0B: "Líquido", 0x0C: "Intransitable (Unpassable)", 0x0D: "Inamovible (Unmoveable)",
      0x0E: "Bloquea Misiles", 0x0F: "Bloquea Pathfinder", 0x10: "Inmóvil (No Move Anim)",
      0x11: "Recogible (Pickupable)", 0x12: "Colgable (Hangable)", 0x13: "Gancho Sur (Vertical)",
      0x14: "Gancho Este (Horizontal)", 0x15: "Rotable (Rotateable)", 0x16: "Tiene Luz",
      0x17: "No Ocultar (Don't Hide)", 0x18: "Translucido", 0x19: "Desplazamiento (Displacement)",
      0x1A: "Elevación", 0x1B: "Acostado (Lying Corpse)", 0x1C: "Mini Mapa (Animate Always)",
      0x1D: "Tiene Lente (Lens Help)", 0x1E: "Bloqueo Completo", 0x1F: "Ignorar Look",
      0x20: "Ropa (Cloth)", 0x21: "Mercado", 0x22: "Usable", 0x23: "Tiene Acción",
      0xFE: "Flag Especial 1", 0xFF: "Fin de Flags"
    };
  
    // Helper: Cargar/Guardar Custom Flags (compatibilidad + corrección de referencia)
    function loadCustomFlags() {
        try {
            const raw = localStorage.getItem('honey_custom_flags');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error('Error leyendo custom flags:', e);
            return {};
        }
    }
    function saveFlagsToLocalStorage(obj) {
        try {
            localStorage.setItem('honey_custom_flags', JSON.stringify(obj || {}));
        } catch (e) {
            console.error('Error guardando custom flags:', e);
        }
    }
    // Backwards-compatible alias
    function getCustomFlags() { return loadCustomFlags(); }
    // Expose to global for other modules that might expect them
    window.loadCustomFlags = loadCustomFlags;
    window.saveFlagsToLocalStorage = saveFlagsToLocalStorage;
    window.getCustomFlags = getCustomFlags;
    // Ensure there's a mutable DEFAULT_FLAGS copy on window for runtime modifications
    window.DEFAULT_FLAGS = Object.assign({}, DEFAULT_FLAGS);
  
    // =================================================================
    // FUNCIONES DE PERSISTENCIA Y NOTIFICACIÓN (REEMPLAZAR EXISTENTES)
    // =================================================================

    /**
     * Guarda o actualiza una bandera custom en LocalStorage y notifica al editor principal.
     * @param {string} hexCode - El código de la bandera en formato Hexadecimal (e.g., '0x44').
     * @param {string} name - El nombre descriptivo de la bandera (e.g., 'Es Animación (#44)').
     */
    function saveCustomFlag(hexCode, name) {
        const customFlags = loadCustomFlags();
        // Accept both numeric opcode or string ("0xNN" or decimal string)
        const decimalCode = (typeof hexCode === 'number')
            ? hexCode
            : (typeof hexCode === 'string' && hexCode.toLowerCase().startsWith('0x')
                ? parseInt(hexCode, 16)
                : parseInt(hexCode, 10));
        
        // Validaciones
        if (isNaN(decimalCode) || decimalCode < 0 || decimalCode >= 256) {
            window.dialogAlert && window.dialogAlert('Error', 'El código hexadecimal no es válido o está fuera del rango permitido (0x00 - 0xFF).');
            return;
        }

        const key = '0x' + decimalCode.toString(16).toUpperCase().padStart(2, '0');
        
        // 1. Guardar en LocalStorage
        customFlags[key] = name;
        saveFlagsToLocalStorage(customFlags); // guarda en 'honey_custom_flags'

        // 2. Actualizar la lista local del Bulk Editor (usar la copia global)
        window.DEFAULT_FLAGS = window.DEFAULT_FLAGS || {};
        window.DEFAULT_FLAGS[key] = name; 

        // 3. NOTIFICAR AL EDITOR PRINCIPAL (¡La clave para el refresco instantáneo!)
        const DAT_EDITOR = window.DAT_EDITOR;
        if (DAT_EDITOR && typeof DAT_EDITOR.registerCustomFlag === 'function') {
            
            // Registrar la bandera custom en el sistema global del editor
            DAT_EDITOR.registerCustomFlag(decimalCode, name);
            
            // Forzar la reconstrucción de la grilla de flags en el Thing Properties Panel
            if (typeof DAT_EDITOR.ensureFlagsGrid === 'function') {
                DAT_EDITOR.ensureFlagsGrid(true);
            }
        } else {
            // Si el editor no está listo, encolar el registro para cuando aparezca.
            queuePendingRegistration(decimalCode, name, 'register');
            window.dialogAlert && window.dialogAlert('Info', `Bandera custom '${name}' (${key}) guardada localmente. Se aplicará al editor cuando esté disponible.`, 'info');
        }

        // Opcional: Refrescar la UI del Bulk Editor si está abierta
        window.renderFlags && window.renderFlags(); 
        
        window.dialogAlert && window.dialogAlert('Éxito', `Bandera custom '${name}' (${key}) guardada.`, 'success');
    }

    /**
     * Elimina una bandera custom de LocalStorage y notifica al editor principal.
     * @param {string} hexCode - El código de la bandera en formato Hexadecimal (e.g., '0x44').
     */
    function deleteCustomFlag(hexCode) {
        // Accept both number and string inputs
        const decimalCode = (typeof hexCode === 'number')
            ? hexCode
            : (typeof hexCode === 'string' && hexCode.toLowerCase().startsWith('0x'))
                ? parseInt(hexCode, 16)
                : parseInt(hexCode, 10);
        if (isNaN(decimalCode) || decimalCode < 0) return;

        const key = '0x' + decimalCode.toString(16).toUpperCase().padStart(2, '0');
        let customFlags = loadCustomFlags();

        if (!customFlags[key]) {
            window.dialogAlert && window.dialogAlert('Error', `La bandera ${key} no está registrada como bandera custom.`, 'error');
            return;
        }

        const flagName = customFlags[key];
        
        // 1. Eliminar de LocalStorage
        delete customFlags[key];
        saveFlagsToLocalStorage(customFlags);
        
        // 2. Eliminar de la lista local del Bulk Editor (window.DEFAULT_FLAGS copia)
        if (window.DEFAULT_FLAGS) delete window.DEFAULT_FLAGS[key];

        // 3. NOTIFICAR AL EDITOR PRINCIPAL (¡La clave para el refresco instantáneo!)
        const DAT_EDITOR = window.DAT_EDITOR;
        if (DAT_EDITOR && typeof DAT_EDITOR.unregisterCustomFlag === 'function') {
            
            // Desregistrar la bandera custom
            DAT_EDITOR.unregisterCustomFlag(decimalCode);
            
            // Forzar la reconstrucción de la grilla de flags en el Thing Properties Panel
            if (typeof DAT_EDITOR.ensureFlagsGrid === 'function') {
                DAT_EDITOR.ensureFlagsGrid();
            }
        } else {
            // Encolar la eliminación para cuando el editor esté disponible
            queuePendingRegistration(decimalCode, flagName, 'unregister');
            window.dialogAlert && window.dialogAlert('Info', `Bandera custom '${flagName}' (${key}) eliminada localmente. Se aplicará al editor cuando esté disponible.`, 'info');
        }
        
        // Opcional: Refrescar la UI del Bulk Editor si está abierta
        window.renderFlags && window.renderFlags();

        window.dialogAlert && window.dialogAlert('Éxito', `Bandera custom '${flagName}' (${key}) eliminada.`, 'success');
    }

    // --- NEW: Pending registration queue + retry logic ---
    // Small helper queue stored on window so it survives reloads of this module instance
    function getPendingQueue() {
        window._honey_pending_flag_ops = window._honey_pending_flag_ops || [];
        return window._honey_pending_flag_ops;
    }

    function queuePendingRegistration(opcode, name, op) {
        // op: 'register' | 'unregister'
        const q = getPendingQueue();
        // Avoid duplicates: keep last op per opcode (register overrides unregister for same save)
        const idx = q.findIndex(i => i.opcode === opcode);
        if (idx !== -1) q.splice(idx, 1);
        q.push({ opcode, name, op });
        // Try to flush immediately (or start background polling)
        tryRegisterWithEditor();
    }

    function registerAllCustomFlags() {
        const DAT_EDITOR = window.DAT_EDITOR;
        if (!DAT_EDITOR) return false;
        // Register all from localStorage
        const customs = loadCustomFlags();
        Object.keys(customs).forEach(k => {
            let dec = NaN;
            if (typeof k === 'string' && k.toLowerCase().startsWith('0x')) dec = parseInt(k, 16);
            else dec = parseInt(k, 10);
            if (!isNaN(dec) && typeof DAT_EDITOR.registerCustomFlag === 'function') {
                DAT_EDITOR.registerCustomFlag(dec, customs[k]);
            }
        });
        // Also flush pending queue
        const q = getPendingQueue().slice();
        q.forEach(item => {
            if (item.op === 'register' && typeof DAT_EDITOR.registerCustomFlag === 'function') {
                DAT_EDITOR.registerCustomFlag(item.opcode, item.name);
            } else if (item.op === 'unregister' && typeof DAT_EDITOR.unregisterCustomFlag === 'function') {
                DAT_EDITOR.unregisterCustomFlag(item.opcode);
            }
        });
        // clear queue
        window._honey_pending_flag_ops = [];
        if (typeof DAT_EDITOR.ensureFlagsGrid === 'function') DAT_EDITOR.ensureFlagsGrid();
        return true;
    }

    // Try to register now or poll a few times until DAT_EDITOR appears
    function tryRegisterWithEditor() {
        if (window._honey_register_attempting) return;
        window._honey_register_attempting = true;
        const maxAttempts = 20;
        let attempts = 0;
        const tick = () => {
            attempts++;
            if (window.DAT_EDITOR) {
                registerAllCustomFlags();
                window._honey_register_attempting = false;
                return;
            }
            if (attempts >= maxAttempts) {
                window._honey_register_attempting = false;
                return;
            }
            setTimeout(tick, 500);
        };
        tick();
    }

    // Kick off an initial attempt on module load to sync existing stored flags if the editor appears later
    tryRegisterWithEditor();

    // Exponer para que otros módulos puedan forzar el registro antes de exportar
    window.registerAllCustomFlags = registerAllCustomFlags;

    // =================================================================
    // FIN DE LAS FUNCIONES ACTUALIZADAS
    // =================================================================
  
    // Combinar Default + Custom
    function getAllFlags() {
        const result = {};
        // Copy DEFAULT_FLAGS ensuring numeric keys (decimal string form)
        Object.keys(DEFAULT_FLAGS).forEach(k => {
            const dec = parseInt(k, 10);
            if (!isNaN(dec)) result[dec] = DEFAULT_FLAGS[k];
        });
        // Merge custom flags from localStorage, parsing keys like "0xNN" or decimal strings
        const customs = loadCustomFlags();
        Object.keys(customs).forEach(k => {
            let dec = NaN;
            if (typeof k === 'string' && k.toLowerCase().startsWith('0x')) {
                dec = parseInt(k, 16);
            } else {
                dec = parseInt(k, 10);
            }
            if (!isNaN(dec)) {
                result[dec] = customs[k];
            }
        });
        return result;
    }
  
    // ==========================================
    // 1. Configuración y Estado
    // ==========================================
    const STATE = {
      selectedIds: new Set(),
      category: 'items',
      lastClickedIndex: -1,
      items: [],
      filteredItems: [],
      rowHeight: 76,
      colWidth: 76,
      containerHeight: 0,
      containerWidth: 0,
      cols: 1,
      scrollTop: 0,
  
      // ---- Animación (1 RAF global) ----
      anim: {
        token: 0,
        raf: 0,
        cells: [] 
      }
    };
  
    // Referencias Globales con Fallback
    const getDat = () => window.dat || window.DAT || window.__DAT;
    const getSpr = () => window.spr || window.SPR || window.__SPR;
    const getEditorAPI = () => window.DAT_EDITOR;
  
    // ==========================================
    // 2. Estilos (CSS)
    // ==========================================
    function injectStyles() {
    const styleId = 'bulk-editor-styles-v3';
    if (document.getElementById(styleId)) return;
  
    const css = `
    #bulkModalOverlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.85);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
        opacity: 0;
        pointer-events: none;
        transition: opacity .2s;
    }
    #bulkModalOverlay.active { opacity: 1; pointer-events: all; }
  
    .bulk-modal {
        background: #171e2e;
        color: #eaf1ff;
        width: 95%;
        max-width: 1100px;
        height: 90vh;
        border-radius: 8px;
        border: 1px solid #2b3b56;
        display: flex;
        flex-direction: column;
        box-shadow: 0 10px 40px rgba(0,0,0,.6);
        font-family: 'Segoe UI', sans-serif;
    }
  
    .bulk-header {
        padding: 12px 20px;
        border-bottom: 1px solid #2b3b56;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #131926;
    }
  
    .bulk-body { flex:1; display:flex; overflow:hidden; }
    .bulk-panel-left {
        flex:7;
        display:flex;
        flex-direction:column;
        background:#0d111a;
        border-right:1px solid #2b3b56;
    }
  
    .bulk-toolbar {
        padding:10px;
        display:flex;
        gap:10px;
        background:#131926;
        border-bottom:1px solid #2b3b56;
        align-items:center;
    }
  
    .bulk-grid-container { flex:1; overflow-y:auto; position:relative; }
    .bulk-virtual-content {
        position: absolute; inset: 0;
        display: grid; padding: 8px; box-sizing: border-box;
        grid-auto-rows: 76px; gap: 8px;
    }
  
    .bulk-item {
        width: 76px; height: 76px;
        background: #1f273b; border: 1px solid #2b3b56; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        position: relative; cursor: pointer; user-select: none; box-sizing: border-box;
    }
  
    .bulk-item.selected {
        border-color:#51a3ff; background:#2a3a55; box-shadow: inset 0 0 0 1px #51a3ff;
    }
  
    .bulk-item canvas {
        width: 64px; height: 64px; image-rendering: pixelated; pointer-events: none;
    }
  
    .bulk-item .id-label {
        position:absolute; bottom:2px; right:4px;
        font-size:9px; font-family: monospace; color:#94a3b8;
        background:rgba(15,23,42,.6); padding:1px 3px; border-radius:3px;
    }
  
    /* Panel Derecho */
    .bulk-panel-right {
        flex:2.7; min-width:300px; padding:10px;
        background:#131926; display:flex; flex-direction:column;
    }
  
    .bulk-flags-list { flex:1; overflow-y:auto; }
  
    .bulk-flag-row {
        display:flex; align-items:center; padding:6px 8px;
        border-radius:4px; margin-bottom:3px; cursor:pointer;
        position: relative; /* Para el botón de eliminar */
    }
    .bulk-flag-row:hover { background: #1e293b; }
  
    .state-indicator {
        width:20px; height:20px; margin-right:10px; border-radius:3px;
        display:flex; align-items:center; justify-content:center;
        background:#1e293b; border:1px solid #475569; color:#64748b; font-weight:bold;
        flex-shrink: 0;
    }
  
    .bulk-flag-row[data-state="1"] .state-indicator { background:#166534; border-color:#22c55e; color:#fff; }
    .bulk-flag-row[data-state="1"] .state-indicator::after { content:"✓"; }
  
    .bulk-flag-row[data-state="2"] .state-indicator { background:#991b1b; border-color:#ef4444; color:#fff; }
    .bulk-flag-row[data-state="2"] .state-indicator::after { content:"✕"; }
  
    .bulk-flag-row[data-state="3"] .state-indicator { border-color:#3b82f6; color:#3b82f6; }
    .bulk-flag-row[data-state="3"] .state-indicator::after { content:"●"; font-size:10px; }
  
    .bulk-flag-row[data-state="4"] .state-indicator { border-color:#facc15; color:#facc15; }
    .bulk-flag-row[data-state="4"] .state-indicator::after { content:"◐"; font-size:11px; }
  
    .bulk-flag-label { display:flex; align-items:center; gap:10px; flex:1; min-width: 0; }
    .bulk-flag-hex {
        min-width:42px; text-align:right; font-family: monospace; font-size:11px;
        color:#38bdf8; opacity:.85; flex-shrink: 0;
    }
    .bulk-flag-name {
        flex:1; font-size:12px; color:#e5e7eb;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
  
    .flag-count-badge {
        margin-left:auto; padding:2px 6px; border-radius:999px;
        font-size:11px; font-weight:700; min-width:26px; text-align:center;
        flex-shrink: 0;
    }
    .flag-count-low { background:#1e293b; color:#94a3b8; }
    .flag-count-mid { background:#1e3a8a; color:#93c5fd; }
    .flag-count-high { background:#78350f; color:#fde68a; }
    .flag-count-max { background:#1e40af; color:#ffffff; }
  
    .bulk-status-bar {
        padding:8px 10px; font-size:12px; background:#0d111a;
        border-top:1px solid #2b3b56; color:#94a3b8;
    }
    .bulk-status-bar b { color:#3b82f6; }
  
    /* Custom Flag Button */
    .btn-add-flag {
        background: #2b3b56; border: 1px solid #3b82f6; color: #fff;
        padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;
        margin-left: 5px; transition: background .15s;
    }
    .btn-add-flag:hover { background: #3b82f6; }
  
    /* Botón de Eliminar Custom Flag */
    .btn-delete-flag {
        margin-left: 8px;
        background: transparent; border: none; color: #f87171;
        font-size: 14px; cursor: pointer; padding: 0 4px; line-height: 1;
        opacity: 0; transition: opacity .1s;
    }
    .bulk-flag-row[data-custom="true"]:hover .btn-delete-flag {
        opacity: 1;
    }
    .btn-delete-flag:hover { color: #ef4444; }
  
  
    /* --- Estilos para el nuevo Diálogo Modal (Reutilizable) --- */
    #honeyDialogOverlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.7);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(3px);
        opacity: 0;
        pointer-events: none;
        transition: opacity .15s;
    }
    #honeyDialogOverlay.active { opacity: 1; pointer-events: all; }
  
    .honey-dialog {
        background: #1e293b;
        color: #eaf1ff;
        width: 90%;
        max-width: 400px;
        border-radius: 8px;
        border: 1px solid #334155;
        box-shadow: 0 5px 20px rgba(0,0,0,.5);
        padding: 20px;
        font-family: 'Segoe UI', sans-serif;
    }
  
    .honey-dialog-content {
        margin-bottom: 20px;
        font-size: 14px;
        line-height: 1.5;
    }
  
    .honey-dialog-input {
        width: 100%;
        padding: 8px 10px;
        margin-top: 10px;
        border: 1px solid #475569;
        border-radius: 4px;
        background: #0f172a;
        color: #e2e8f0;
        box-sizing: border-box;
    }
  
    .honey-dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }
  
    .btn-dark {
        background: #334155;
        color: #e2e8f0;
        border: 1px solid #475569;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    }
    .btn-dark:hover { background: #475569; }
  
    .btn-primary {
        background: #3b82f6;
        color: #fff;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
    }
    .btn-primary:hover { background: #2563eb; }
  
    .bulk-title { font-weight: 600; font-size: 18px; display: flex; align-items: center; gap: 8px; }
    .bulk-title span { color: #fde047; }
    `;
  
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
    }
  
    // ==========================================
    // 3. HTML (UI)
    // ==========================================
    function injectHTML() {
      let overlay = document.getElementById('bulkModalOverlay');
      if (overlay) return;
  
      const html = `
        <div class="bulk-modal">
          <div class="bulk-header">
            <div class="bulk-title"><span>⚡</span> Honey - Editor Masivo de Flags</div>
            <button class="btn btn-secondary" id="btnCloseBulk">Cerrar</button>
          </div>
  
          <div class="bulk-body">
            <div class="bulk-panel-left">
              <div class="bulk-toolbar">
                <select id="bulkCategorySel" class="input-dark" style="width: 110px;">
                  <option value="items">Items</option>
                  <option value="outfits">Outfits</option>
                  <option value="effects">Effects</option>
                  <option value="missiles">Missiles</option>
                </select>
  
                <input type="text" id="bulkItemSearch" class="input-dark" placeholder="Buscar ID..." style="width: 100px;">
  
                <div style="width:1px; height:20px; background:#2b3b56; margin:0 5px;"></div>
  
                <button class="btn btn-secondary" id="btnBulkSelectAll">Todos</button>
                <button class="btn btn-secondary" id="btnBulkSelectNone">Ninguno</button>
  
                <span style="margin-left:auto; font-size:12px; color:#94a3b8;">
                  Seleccionados: <b id="bulkCountDisplay" style="color:#3b82f6; margin-left:5px;">0</b>
                </span>
              </div>
  
              <div id="bulkGridContainer" class="bulk-grid-container">
                <div id="bulkVirtualSpacer" style="width:1px; opacity:0; pointer-events:none;"></div>
                <div id="bulkVirtualContent" class="bulk-virtual-content"></div>
              </div>
              <div class="bulk-status-bar" id="bulkStatusMsg">
                Usa <b>Shift + Click</b> para seleccionar rangos.
              </div>
            </div>
  
            <div class="bulk-panel-right">
              <div style="display:flex; align-items:center; margin-bottom:10px;">
                <input type="text" id="bulkFlagSearchInput" class="input-dark" placeholder="🔍 Filtrar Flags..." style="flex:1;">
                <button id="btnBulkAddFlag" class="btn-add-flag" title="Agregar Flag Personalizada" style="margin-left: 10px; font-size: 14px; padding: 3px 8px; display:flex; align-items:center;">
                    <span style="margin-right: 4px;">✨</span> Agregar
                </button>
              </div>
  
              <div style="font-size:10px; color:#64748b; display:flex; justify-content:space-between; margin-bottom:5px; padding:0 4px; text-transform:uppercase; letter-spacing:0.5px;">
                <span>Ignorar / Estado Actual</span> <span>Agregar</span> <span>Quitar</span>
              </div>
  
              <div id="bulkFlagsList" class="bulk-flags-list"></div>
  
              <div style="margin-top:auto; padding-top:15px; border-top:1px solid #2b3b56; display:flex; gap:10px; justify-content:flex-end;">
                <button class="btn btn-primary" id="btnApplyBulk">💾 Aplicar</button>
              </div>
            </div>
          </div>
        </div>
        
        <div id="honeyDialogOverlay">
            <div class="honey-dialog">
                <div class="honey-dialog-content" id="dialogContent"></div>
                <input type="text" id="dialogInput" class="honey-dialog-input" style="display:none;">
                <div class="honey-dialog-buttons">
                    <button class="btn-dark" id="dialogCancelBtn" style="display:none;">Cancelar</button>
                    <button class="btn-primary" id="dialogConfirmBtn">Aceptar</button>
                </div>
            </div>
        </div>
      `;
  
      overlay = document.createElement('div');
      overlay.id = 'bulkModalOverlay';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      
      // Función helper para cerrar el diálogo
      function closeDialog() {
          const overlay = document.getElementById('honeyDialogOverlay');
          if (overlay) overlay.classList.remove('active');
          if (window.honeyDialogResolver) {
              window.honeyDialogResolver = null;
          }
      }
  
      document.getElementById('btnCloseBulk').onclick = closeModal;
      document.getElementById('bulkCategorySel').onchange = changeCategory;
      document.getElementById('bulkItemSearch').oninput = filterItems;
      document.getElementById('btnBulkSelectAll').onclick = selectAll;
      document.getElementById('btnBulkSelectNone').onclick = selectNone;
      document.getElementById('btnApplyBulk').onclick = applyChanges;
      document.getElementById('bulkFlagSearchInput').oninput = (e) => filterFlags(e.target.value);
      document.getElementById('btnBulkAddFlag').onclick = promptAddFlag;
      document.getElementById('bulkGridContainer').onscroll = onScroll;
  
      // Evento para cerrar el diálogo al hacer clic fuera
      document.getElementById('honeyDialogOverlay').onclick = (e) => {
          if (e.target.id === 'honeyDialogOverlay') {
              // Si está activo y es un prompt o confirm, se resuelve como 'cancel'
              const dialog = document.getElementById('honeyDialogOverlay');
              if (dialog.dataset.type !== 'alert') {
                  // Esto detiene el flujo de la promesa si el usuario hace click fuera
                  if (window.honeyDialogResolver) {
                      window.honeyDialogResolver({ confirmed: false, value: null });
                      closeDialog();
                  }
              } else {
                  closeDialog();
              }
          }
      };
    }
  
    // ==========================================
    // 4. Modal de Diálogo Reutilizable (NUEVO)
    // ==========================================
    const TILE32 = 32; // Tamaño de tile de referencia para render
    const TILE_RENDER = 76; // Tamaño del canvas en el grid
    const TILE_PADDING = 6; // Padding para el render
    
    // Canvas y Contextos Auxiliares para Renderizado
    const __tileCanvas = document.createElement('canvas');
    __tileCanvas.width = __tileCanvas.height = TILE32;
    const __tileCtx = __tileCanvas.getContext('2d', { willReadFrequently: true });
    
    // El 'resolver' se almacena globalmente para poder cerrarlo desde el overlay click
    // o desde cualquier lugar, manteniendo el flujo asíncrono.
    let honeyDialogResolver = null; 
  
    /**
     * Muestra un diálogo modal (alert, confirm, prompt).
     * @param {'alert'|'confirm'|'prompt'} type - Tipo de diálogo.
     * @param {string} content - Contenido HTML/texto.
     * @param {string} [defaultValue=''] - Valor inicial para 'prompt'.
     * @returns {Promise<{confirmed: boolean, value: string|null}>}
     */
    function showDialog(type, content, defaultValue = '') {
        return new Promise(resolve => {
            const overlay = document.getElementById('honeyDialogOverlay');
            const contentEl = document.getElementById('dialogContent');
            const inputEl = document.getElementById('dialogInput');
            const confirmBtn = document.getElementById('dialogConfirmBtn');
            const cancelBtn = document.getElementById('dialogCancelBtn');
  
            contentEl.innerHTML = content;
            inputEl.value = defaultValue;
            overlay.dataset.type = type;
  
            inputEl.style.display = (type === 'prompt') ? 'block' : 'none';
            cancelBtn.style.display = (type !== 'alert') ? 'block' : 'none';
            confirmBtn.textContent = (type === 'prompt') ? 'Siguiente' : 'Aceptar';
  
            // Limpiar listeners previos
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            inputEl.onkeydown = null;
  
            // Almacenar el resolver en window para manejar cierres externos (click en overlay)
            window.honeyDialogResolver = resolve;
  
            const close = (confirmed, value = null) => {
                overlay.classList.remove('active');
                delete window.honeyDialogResolver; // Limpiar el resolver
                resolve({ confirmed, value });
            };
  
            confirmBtn.onclick = () => {
                if (type === 'prompt') {
                    close(true, inputEl.value);
                } else {
                    close(true, null);
                }
            };
  
            cancelBtn.onclick = () => close(false, null);
  
            if (type === 'prompt') {
                // En prompt, permitir enviar con Enter
                inputEl.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmBtn.click();
                    }
                };
                // Enfocar el input
                setTimeout(() => inputEl.focus(), 10);
            } else {
                // Enfocar el botón de confirmación en alert/confirm
                setTimeout(() => confirmBtn.focus(), 10);
            }
  
            overlay.classList.add('active');
        });
    }
  
    // ==========================================
    // 5. Lógica de Flags Custom (UPDATED)
    // ==========================================
  
    async function promptAddFlag() {
        // PASO 1: Pedir el código
        const codeResult = await showDialog('prompt', "Ingresa el **código** de la Flag (ej: `0xFE`, `254`):", "");
        if (!codeResult.confirmed || !codeResult.value) return;
  
        const rawCode = codeResult.value.trim();
        let code = 0;
  
        // Intentar parsear como Hex o Decimal
        if (rawCode.toLowerCase().startsWith('0x')) {
            code = parseInt(rawCode, 16);
        } else {
            code = parseInt(rawCode, 10);
        }
  
        if (isNaN(code) || code < 0 || code > 255) {
            await showDialog('alert', "Código de flag inválido. Debe ser un número entre 0 y 255 (0xFF).");
            return;
        }
  
        // Revisar si ya existe
        const allFlags = getAllFlags();
        if (allFlags.hasOwnProperty(code)) {
            await showDialog('alert', `La Flag **0x${code.toString(16).toUpperCase()}** ya existe como: "${allFlags[code]}". No se puede sobrescribir.`);
            return;
        }
  
        // PASO 2: Pedir el nombre
        const nameResult = await showDialog('prompt', `Ingresa el **nombre** de la Flag **0x${code.toString(16).toUpperCase()}**:`, `Custom Flag ${code}`);
        if (!nameResult.confirmed || !nameResult.value.trim()) {
            await showDialog('alert', "El nombre no puede estar vacío.");
            return;
        }
  
        const name = nameResult.value.trim();
  
        // PASO 3: Confirmación y Guardar
        const confirm = await showDialog('confirm', `Se registrará la Flag Custom:<br><br> **Código:** 0x${code.toString(16).toUpperCase()}<br> **Nombre:** ${name}`);
  
        if (confirm.confirmed) {
            saveCustomFlag(code, name);
            renderFlags(); // Recargar lista
  
            // Intentar hacer scroll a la nueva flag
            setTimeout(() => {
                const el = document.querySelector(`.bulk-flag-row[data-opcode="${code}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }
  
    async function promptDeleteFlag(opcode, name) {
        const result = await showDialog('confirm', `¿Estás seguro de que quieres **eliminar** la Flag Custom?<br><br> **Código:** 0x${opcode.toString(16).toUpperCase()}<br> **Nombre:** ${name}`);
  
        if (result.confirmed) {
            deleteCustomFlag(opcode);
            renderFlags(); // Recargar lista
            inspectFlagsOfSelected(); // Re-inspeccionar para quitar badges si aplica
        }
    }
  
    // ==========================================
    // 6. Lógica de Datos
    // ==========================================
  
    function changeCategory(e) {
        STATE.category = e.target.value;
        STATE.selectedIds.clear();
        STATE.lastClickedIndex = -1;
        STATE.anim.token++;
        STATE.anim.cells.length = 0;
        loadData();
    }
  
    function loadData() {
        const dat = getDat();
        if (!dat || !dat[STATE.category]) {
            STATE.items = [];
            filterItems();
            return;
        }
  
        const collection = dat[STATE.category];
        STATE.items = [];
        for (let i = 1; i < collection.length; i++) {
            const thing = collection[i];
            if (!thing) continue;
            STATE.items.push({
                idx: i,
                idDisplay: thing.id || i,
                thing
            });
        }
        filterItems();
    }
  
    function filterItems() {
        const query = document.getElementById('bulkItemSearch')?.value.trim().toLowerCase();
  
        STATE.filteredItems = !query
            ? STATE.items
            : STATE.items.filter(item => String(item.idDisplay).includes(query));
  
        const container = document.getElementById('bulkGridContainer');
        if (container) container.scrollTop = 0;
  
        STATE.anim.token++;
        STATE.anim.cells.length = 0;
        renderVirtualGrid();
        updateCounter();
        resetFlagSelections();
    }
  
    // ==========================================
    // 7. Virtual Scroller & Rendering
    // ==========================================
  
    const TILE_ANIM_MS = 140; // Ms por frame de animación
  
    function getThingType() {
        if (STATE.category === 'items') return 'item';
        if (STATE.category === 'outfits') return 'outfit';
        if (STATE.category === 'effects') return 'effect';
        if (STATE.category === 'missiles') return 'missile';
        return 'item';
    }
  
    function _drawGroupToThumb(canvas, group, sprites, sprRef) {
        const gw = Math.max(1, group.width | 0);
        const gh = Math.max(1, group.height | 0);
        const bigW = gw * TILE32;
        const bigH = gh * TILE32;
        
        const big = document.createElement('canvas');
        big.width = bigW;
        big.height = bigH;
        const g = big.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingEnabled = false;
        __tileCtx.imageSmoothingEnabled = false;
  
        for (let y = 0; y < gh; y++) {
            for (let x = 0; x < gw; x++) {
                const idx = (gh - 1 - y) * gw + (gw - 1 - x);
                const sid = sprites[idx] | 0;
  
                if (sid < 1) continue;
                
                const img = sprRef?.getSprite?.(sid - 1);
                if (!img) continue;
  
                __tileCtx.putImageData(img, 0, 0);
                g.drawImage(__tileCanvas, 0, 0, TILE32, TILE32, x * TILE32, y * TILE32, TILE32, TILE32);
            }
        }
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
  
        const maxW = canvas.width - TILE_PADDING * 2;
        const maxH = canvas.height - TILE_PADDING * 2;
        const scale = Math.min(maxW / bigW, maxH / bigH, 1);
  
        const drawW = Math.floor(bigW * scale);
        const drawH = Math.floor(bigH * scale);
        const drawX = (canvas.width - drawW) / 2;
        const drawY = (canvas.height - drawH) / 2;
  
        ctx.drawImage(big, 0, 0, bigW, bigH, drawX, drawY, drawW, drawH);
    }
    
    function startAnimationLoop() {
        cancelAnimationFrame(STATE.anim.raf);
        STATE.anim.token++;
        const currentToken = STATE.anim.token;
  
        const step = (t) => {
            if (STATE.anim.token !== currentToken) return; // Stop condition
            
            const sprRef = getSpr();
            
            for (const c of STATE.anim.cells) {
                if (c.group.frames === 1 || !sprRef) {
                    // Si solo tiene un frame o no hay spr, solo renderizar una vez si es necesario.
                    if (!c.renderedOnce) {
                        _drawGroupToThumb(c.canvas, c.group, c.group.sprites, sprRef);
                        c.renderedOnce = true;
                    }
                    continue;
                }
                
                if (t > c.lastT + c.msPerFrame) {
                    c.frame = ((c.frame | 0) + 1) % c.frames;
                    c.lastT = t;
                }
                
                // MOD: asegurar patternX por defecto = 2 para outfits si no está definido
                const patX = c.group.patternX || 2;

                // Cálculo simple de índice animado (asume structure flat básica para preview)
                const per = c.perFrame;
                const base = c.frame * per * (c.group.layers||1) * patX * (c.group.patternY||1) * (c.group.patternZ||1);
                
                // Si el índice excede, fallback al frame 0
                const safeBase = (base + per <= c.group.sprites.length) ? base : 0;
                
                // NOTA: Esta simplificación puede no ser 100% fiel a la animación de engine, 
                // pero es suficiente para una preview rápida.
                const sprites = c.group.sprites.slice(safeBase, safeBase + per);
                while (sprites.length < per) sprites.push(0);
  
                _drawGroupToThumb(c.canvas, c.group, sprites, sprRef);
            }
            
            STATE.anim.raf = requestAnimationFrame(step);
        };
  
        STATE.anim.raf = requestAnimationFrame(step);
    }
  
    function renderVirtualGrid() {
        const container = document.getElementById('bulkGridContainer');
        const spacer = document.getElementById('bulkVirtualSpacer');
        const content = document.getElementById('bulkVirtualContent');
        if (!container || !content || !spacer) return;
  
        STATE.containerHeight = container.clientHeight;
        STATE.containerWidth = container.clientWidth;
        STATE.cols = 9;
        // Considerar padding (bulk-virtual-content padding: 8px left+right) y gaps (8px)
        const paddingTotal = 8 * 2;
        const gapTotal = (STATE.cols - 1) * 8;
        const available = Math.max(0, STATE.containerWidth - paddingTotal - gapTotal);
        STATE.colWidth = Math.max(60, Math.floor(available / STATE.cols));
        
        // Calcular el número total de filas
        const totalRows = Math.ceil(STATE.filteredItems.length / STATE.cols);
        const totalHeight = totalRows * STATE.rowHeight;
  
        spacer.style.height = `${totalHeight}px`;
        content.style.gridTemplateColumns = `repeat(${STATE.cols}, ${STATE.colWidth}px)`;
  
        onScroll();
        startAnimationLoop();
    }
  
    function onScroll() {
        const container = document.getElementById('bulkGridContainer');
        const content = document.getElementById('bulkVirtualContent');
        if (!container || !content) return;
  
        STATE.scrollTop = container.scrollTop;
        
        const { rowHeight, containerHeight, cols, filteredItems } = STATE;
        
        const startIndex = Math.max(0, Math.floor(STATE.scrollTop / rowHeight) * cols);
        const numRowsVisible = Math.ceil(containerHeight / rowHeight);
        const endIndex = Math.min(filteredItems.length, startIndex + (numRowsVisible + 1) * cols); // +1 para buffer
        
        renderChunk(startIndex, endIndex);
  
        // Ajustar posición del contenedor de contenido virtual
        const startRow = Math.floor(startIndex / cols);
        const offset = startRow * rowHeight;
        content.style.transform = `translateY(${offset}px)`;
    }
  
    function renderChunk(start, end) {
        const content = document.getElementById('bulkVirtualContent');
        const sprRef = getSpr();
        if (!content) return;
        
        content.innerHTML = '';
        const frag = document.createDocumentFragment();
        const slice = STATE.filteredItems.slice(start, end);
  
        // Limpiar animaciones previas para la nueva porción
        STATE.anim.cells.length = 0;
  
        slice.forEach(item => {
            const el = document.createElement('div');
            el.className = 'bulk-item';
            if (STATE.selectedIds.has(item.idx)) el.classList.add('selected');
            
            const thing = item.thing;
            
            const c = document.createElement('canvas');
            c.width = c.height = TILE_RENDER;
            el.appendChild(c);
            
            // ID Label
            const idLabel = document.createElement('div');
            idLabel.className = 'id-label';
            idLabel.textContent = item.idDisplay;
            el.appendChild(idLabel);
  
            const group = (thing?.groups?.[0]) ? thing.groups[0] : null;
  
            if (sprRef?.getSprite && group?.sprites?.length) {
                // Setup animación simple
                const per = Math.max(1, group.width|0) * Math.max(1, group.height|0);
                STATE.anim.cells.push({ 
                    canvas: c, 
                    group, 
                    perFrame: per, 
                    frames: Math.max(1, group.frames|0), 
                    frame: 0, 
                    lastT: 0, 
                    msPerFrame: TILE_ANIM_MS 
                });
            } else {
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#111827';
                ctx.fillRect(0, 0, TILE_RENDER, TILE_RENDER);
            }
            
            el.dataset.idx = item.idx;
            el.onclick = (e) => toggleSelect(e, item.idx, STATE.filteredItems.findIndex(i => i.idx === item.idx));
            
            frag.appendChild(el);
        });
  
        content.appendChild(frag);
    }
    
    // ==========================================
    // 8. Selección y Lógica de Flags
    // ==========================================
  
    function toggleSelect(e, idx, indexInFiltered) {
        if (e.shiftKey && STATE.lastClickedIndex !== -1) {
            const lastIndex = STATE.filteredItems.findIndex(i => i.idx === STATE.lastClickedIndex);
            if (lastIndex === -1) { // Fallback si el último clickeado no está visible
                STATE.selectedIds.add(idx);
            } else {
                const start = Math.min(lastIndex, indexInFiltered);
                const end = Math.max(lastIndex, indexInFiltered);
                for (let i = start; i <= end; i++) {
                    STATE.selectedIds.add(STATE.filteredItems[i].idx);
                }
            }
            STATE.lastClickedIndex = idx;
        } else if (e.ctrlKey || e.metaKey) {
            if (STATE.selectedIds.has(idx)) STATE.selectedIds.delete(idx);
            else STATE.selectedIds.add(idx);
            STATE.lastClickedIndex = idx;
        } else {
            STATE.selectedIds.clear();
            STATE.selectedIds.add(idx);
            STATE.lastClickedIndex = idx;
        }
        
        onScroll(); // Re-renderizar para actualizar el estado visual
        updateCounter();
        inspectFlagsOfSelected();
    }
  
    function selectAll() {
        STATE.filteredItems.forEach(i => STATE.selectedIds.add(i.idx));
        onScroll();
        updateCounter();
        inspectFlagsOfSelected();
        document.getElementById('bulkStatusMsg').innerHTML = `Seleccionados: <b>${STATE.selectedIds.size}</b>.`;
    }
  
    function selectNone() {
        STATE.selectedIds.clear();
        onScroll();
        updateCounter();
        inspectFlagsOfSelected();
    }
  
    function updateCounter() {
        const el = document.getElementById('bulkCountDisplay');
        if (el) el.textContent = STATE.selectedIds.size;
    }
    
    // ==========================================
    // 9. Renderizado y Lógica de Flags Panel
    // ==========================================
    
    // Muestra la lista de flags y resetea su estado de selección
    function renderFlags() {
        const list = document.getElementById('bulkFlagsList');
        if (!list) return;
        list.innerHTML = '';
        
        const allFlags = getAllFlags();
        const sortedOpCodes = Object.keys(allFlags).map(k => parseInt(k)).sort((a,b) => a-b);
        const frag = document.createDocumentFragment();
  
        sortedOpCodes.forEach(opcode => {
            const name = allFlags[opcode];
            const hexStr = '0x' + opcode.toString(16).toUpperCase().padStart(2, '0');
            const isCustom = !DEFAULT_FLAGS.hasOwnProperty(opcode);
            
            const row = document.createElement('div');
            row.className = 'bulk-flag-row';
            row.dataset.opcode = opcode;
            row.dataset.state = "0"; // 0: Ignorar, 1: Agregar, 2: Quitar, 3: Mixto (solo en inspección) 4: Parcial (solo en inspección)
            row.dataset.search = `${hexStr.toLowerCase()} ${name.toLowerCase()}`;
            if (isCustom) row.dataset.custom = "true";
  
            // Indicador de Estado/Inspección
            const indicator = document.createElement('div');
            indicator.className = 'state-indicator';
            indicator.title = 'Click para alternar: Ignorar / Agregar / Quitar';
  
            // Nombre y Hex
            const infoDiv = document.createElement('div');
            infoDiv.className = 'bulk-flag-label';
  
            const hexSpan = document.createElement('span');
            hexSpan.className = 'bulk-flag-hex';
            hexSpan.textContent = hexStr;
  
            const nameSpan = document.createElement('span');
            nameSpan.className = 'bulk-flag-name';
            nameSpan.textContent = name;
  
            infoDiv.appendChild(hexSpan);
            infoDiv.appendChild(nameSpan);
  
            row.appendChild(indicator);
            row.appendChild(infoDiv);
  
            // Botón de eliminar para Flags Custom
            if (isCustom) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete-flag';
                deleteBtn.innerHTML = '&#x2715;'; // Símbolo X
                deleteBtn.title = `Eliminar Flag Custom ${hexStr}`;
                deleteBtn.onclick = (e) => {
                    e.stopPropagation(); // Evita que se active el click de cambio de estado
                    promptDeleteFlag(opcode, name);
                };
                row.appendChild(deleteBtn);
            }
  
            // Lógica de cambio de estado (0 -> 1 -> 2 -> 0)
            row.onclick = () => {
                let s = parseInt(row.dataset.state);
                if (s === 3 || s === 4) s = 0; // Si es mixto/completo, reiniciar ciclo
                s = (s + 1) % 3; // Ciclo 0 (Ignorar) -> 1 (Agregar) -> 2 (Quitar) -> 0
                row.dataset.state = s;
                
                // Limpiar cualquier badge de inspección
                row.querySelectorAll('.flag-count-badge').forEach(b => b.remove());
                row.querySelectorAll('.state-indicator::after').forEach(b => b.remove());
            };
  
            frag.appendChild(row);
        });
  
        list.appendChild(frag);
        filterFlags(document.getElementById('bulkFlagSearchInput')?.value || '');
    }
    
    function filterFlags(q) {
        q = q.toLowerCase();
        const rows = document.querySelectorAll('.bulk-flag-row');
        rows.forEach(row => {
            row.style.display = row.dataset.search.includes(q) ? 'flex' : 'none';
        });
    }
  
    function resetFlagSelections() {
        document.querySelectorAll('.bulk-flag-row').forEach(row => {
            row.dataset.state = "0";
            // Limpiar visuales de inspección
            row.querySelectorAll('.flag-count-badge').forEach(b => b.remove());
        });
    }
    
    // ==========================================
    // 10. Inspección y Aplicación (UPDATED ARRAY LOGIC)
    // ==========================================
    
    // Función para obtener las flags de un thing como un Array de números (opcodes)
    function getFlagsAsArray(thing) {
        // Normaliza las flags a un Array de números
        const api = getEditorAPI();
        
        // Si hay una API de bitmaskToArray (para formatos modernos >32 bits)
        if (api && typeof api.bitmaskToArray === 'function' && typeof thing.flags === 'number') {
            return api.bitmaskToArray(thing.flags);
        }
  
        if (Array.isArray(thing.flags)) {
            return thing.flags; // Ya es array
        }
        
        if (typeof thing.flags === 'number') { 
            // Fallback bitmask 32-bit legacy
            const arr = [];
            for (let b = 0; b < 32; b++) {
                if ((thing.flags >> b) & 1) {
                    arr.push(b);
                }
            }
            return arr;
        }
        
        return [];
    }
  
    function inspectFlagsOfSelected() {
        const totalSelected = STATE.selectedIds.size;
        const statusMsg = document.getElementById('bulkStatusMsg');
        
        if (totalSelected === 0) {
            resetFlagSelections();
            if (statusMsg) statusMsg.innerHTML = `Usa <b>Shift + Click</b> para seleccionar rangos.`;
            return;
        }
        
        const dat = getDat();
        if (!dat) return;
  
        // Mapa de conteo: opcode -> {presente: N, ausente: M}
        const flagCounts = {}; 
        
        // 1. Contar la presencia de cada flag en los ítems seleccionados
        STATE.selectedIds.forEach(id => {
            const item = STATE.items.find(i => i.idx === id);
            if (!item) return;
  
            const flagsArray = getFlagsAsArray(item.thing);
            
            // Flags presentes
            const presentFlags = new Set(flagsArray);
            
            // Flags ausentes (para banderas que se han definido en el sistema)
            const allPossibleFlags = getAllFlags(); 
  
            Object.keys(allPossibleFlags).map(k => parseInt(k)).forEach(opcode => {
                flagCounts[opcode] = flagCounts[opcode] || { present: 0, total: 0 };
                flagCounts[opcode].total++;
                
                if (presentFlags.has(opcode)) {
                    flagCounts[opcode].present++;
                }
            });
        });
        
        // 2. Actualizar la UI de flags
        document.querySelectorAll('.bulk-flag-row').forEach(row => {
            const opcode = parseInt(row.dataset.opcode);
            const countData = flagCounts[opcode];
            
            // Resetear visuales
            row.dataset.state = "0"; 
            row.querySelectorAll('.flag-count-badge').forEach(b => b.remove());
            
            if (!countData) return;
            
            const { present, total } = countData;
            
            if (total !== totalSelected) return; // Error de conteo o item no encontrado, ignorar
  
            if (present === total) {
                row.dataset.state = "3"; // ● Completo
            } else if (present > 0 && present < total) {
                row.dataset.state = "4"; // ◐ Parcial
            }
  
            // Badge de conteo para Mixto/Completo
            const count = present;
  
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'flag-count-badge';
                badge.textContent = `${count}`;
                
                // MOD: asignar clase .flag-count-max solo si es 100% (count === totalSelected)
                if (count === totalSelected) {
                    badge.classList.add('flag-count-max');
                } else if (count < totalSelected * 0.25) {
                    badge.classList.add('flag-count-low');
                } else if (count < totalSelected * 0.5) {
                    badge.classList.add('flag-count-mid');
                } else if (count < totalSelected * 0.75) {
                    badge.classList.add('flag-count-high');
                } else {
                    // > =75% pero no 100% -> alto
                    badge.classList.add('flag-count-high');
                }
  
                row.appendChild(badge);
            }
        });
        
        if (statusMsg) statusMsg.innerHTML = `Inspeccionando <b>${totalSelected}</b> items.`;
    }
  
    // --- Core Logic: Apply Changes using Arrays ---
    async function applyChanges() {
        const dat = getDat();
        const api = getEditorAPI();
        
        if (!dat || STATE.selectedIds.size === 0) {
            await showDialog('alert', "Por favor, selecciona al menos un item para aplicar cambios.");
            return;
        }
  
        const toAdd = [];
        const toRemove = [];
        
        document.querySelectorAll('.bulk-flag-row').forEach(row => {
            const s = parseInt(row.dataset.state);
            const op = parseInt(row.dataset.opcode);
            
            if (s === 1) toAdd.push(op);
            if (s === 2) toRemove.push(op);
        });
  
        if (!toAdd.length && !toRemove.length) {
            await showDialog('alert', "No seleccionaste ninguna flag para agregar o quitar. Haz clic en los indicadores.");
            return;
        }
        
        // Resumen de cambios para el modal de confirmación
        const allFlagsMap = getAllFlags();
        const addList = toAdd.map(op => `<li>+ 0x${op.toString(16).toUpperCase()} (${allFlagsMap[op]})</li>`).join('');
        const removeList = toRemove.map(op => `<li>- 0x${op.toString(16).toUpperCase()} (${allFlagsMap[op]})</li>`).join('');
  
        const changeSummary = `
            Se aplicarán los siguientes cambios a **${STATE.selectedIds.size}** items:<br><br>
            <ul>${addList}${removeList}</ul>
            ¿Deseas continuar?
        `;
  
        const confirmation = await showDialog('confirm', changeSummary);
        if (!confirmation.confirmed) return;
  
        let appliedCount = 0;
  
        // Función para convertir el array de flags al formato de almacenamiento del thing
        const arrayToThingFlags = (flagsArray) => {
             // Usar la función de la API si existe, de lo contrario, asumir bitmask 32-bit
            if (api && typeof api.arrayToBitmask === 'function') {
                return api.arrayToBitmask(flagsArray);
            }
            
            // Fallback: Bitmask 32-bit (solo para flags 0-31)
            let mask = 0;
            flagsArray.forEach(op => {
                if (op >= 0 && op < 32) {
                    mask |= (1 << op);
                }
            });
            return mask;
        }
  
        // 3. Aplicar los cambios
        STATE.selectedIds.forEach(id => {
            const item = STATE.items.find(i => i.idx === id);
            if (!item) return;
            
            const thing = item.thing;
            const currentFlags = new Set(getFlagsAsArray(thing));
            let changed = false;
  
            // Agregar
            toAdd.forEach(op => {
                if (!currentFlags.has(op)) {
                    currentFlags.add(op);
                    changed = true;
                }
            });
  
            // Quitar
            toRemove.forEach(op => {
                if (currentFlags.has(op)) {
                    currentFlags.delete(op);
                    changed = true;
                }
            });
            
            if (changed) {
                const newFlagsArray = Array.from(currentFlags).sort((a,b) => a-b);
                const newFlagsValue = arrayToThingFlags(newFlagsArray);
                
                // Decisión: Si el thing.flags original es un array, se almacena el array. Si es number, se almacena el number/bitmask.
                if (Array.isArray(thing.flags) || (api && typeof api.flagsToArray === 'function')) {
                    thing.flags = newFlagsArray;
                } else {
                    thing.flags = newFlagsValue;
                }
  
                // Sincronizar las propiedades individuales si la API lo permite
                if (api && typeof api.syncPropsFromThingFlags === 'function') {
                    api.syncPropsFromThingFlags(thing);
                } else {
                    // Si no hay API de sincronización, se puede dejar que el editor principal maneje esto.
                    // ¡Importante! No se recomienda manipular las propiedades del thing directamente sin una API.
                }
  
                appliedCount++;
                
                // Forzar el re-renderizado del item
                if (typeof window.editor?.forceRenderItem === 'function') {
                    window.editor.forceRenderItem(STATE.category, item.idx);
                }
            }
        });
  
        // 4. Finalizar y notificar
        if (appliedCount > 0) {
            await showDialog('alert', `✅ Flags aplicadas con éxito a **${appliedCount}** items.`);
            inspectFlagsOfSelected(); // Re-inspeccionar para actualizar los estados de los flags
            
            // Notify main editor so the Thing Properties Panel refreshes if the currently inspected thing was changed.
            try {
                const DAT = window.DAT_EDITOR;
                if (DAT && typeof DAT.refreshPropertiesPanelAfterBulk === 'function') {
                    const affected = Array.from(STATE.selectedIds); // ids modified
                    DAT.refreshPropertiesPanelAfterBulk(affected);
                } else {
                    // Best-effort: trigger ensureFlagsGrid/render if available
                    if (window.loadCustomFlags) try { window.loadCustomFlags(); } catch(_) {}
                    if (window.DAT_EDITOR && typeof window.DAT_EDITOR.ensureFlagsGrid === 'function') {
                        try { window.DAT_EDITOR.ensureFlagsGrid(true); } catch(_) {}
                    }
                }
            } catch (e) { console.warn('Bulk -> refresh properties panel failed', e); }
        } else {
            await showDialog('alert', "No se aplicaron cambios, ya que los items ya tenían/no tenían las flags seleccionadas.");
        }
    }
    
    // ==========================================
    // 11. Inicialización
    // ==========================================
  
    function openModal() {
        injectStyles();
        injectHTML();
        
        const overlay = document.getElementById('bulkModalOverlay');
        const catSel = document.getElementById('bulkCategorySel');
        const mainCatSel = document.getElementById('mainCategorySelect'); // Asume que hay un selector de categoría principal
  
        // Intentar sincronizar con la categoría del editor principal si existe
        if (mainCatSel && ['items', 'outfits', 'effects', 'missiles'].includes(mainCatSel.value)) {
            catSel.value = mainCatSel.value;
            STATE.category = mainCatSel.value;
        } else {
            STATE.category = 'items';
            catSel.value = 'items';
        }
    
        STATE.selectedIds.clear();
        STATE.lastClickedIndex = -1;
    
        renderFlags();
        loadData();
        
        if (overlay) overlay.classList.add('active');
        
        // Re-calcular el grid al abrirse
        setTimeout(renderVirtualGrid, 50);
    }
  
    function closeModal() {
        const overlay = document.getElementById('bulkModalOverlay');
        if (overlay) overlay.classList.remove('active');
        STATE.anim.token++; // Stop anim
        
        const dialog = document.getElementById('honeyDialogOverlay');
        if (dialog) dialog.classList.remove('active'); // Asegurar cierre del diálogo
    }
  
    document.addEventListener('DOMContentLoaded', () => {
        let btn = document.getElementById('btnOpenBulkEditor');
        // Si el botón ya existe (del HTML principal), solo le atamos el evento
        if (btn) {
            btn.onclick = openModal;
        } else {
            // Fallback por si no está en el HTML
            const nav = document.querySelector('nav') || document.body;
            btn = document.createElement('button');
            btn.id = 'btnOpenBulkEditor';
            btn.textContent = '🚀 Bulk Editor';
            btn.className = 'btn btn-primary';
            btn.style.cssText = "position:fixed; bottom:20px; right:20px; z-index:9998; font-size:14px; padding:8px 15px;";
            nav.appendChild(btn);
            btn.onclick = openModal;
        }
    });
  
  })();