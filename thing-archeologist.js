// ===========================================================
// Honey Editor — Thing Archeologist (SANDBOX ANALYZER)
// Modal profesional para análisis profundo del .dat
// NO modifica el proyecto activo (window.dat)
// ===========================================================

(function () {
    'use strict';
  
    const $  = (s, r=document)=>r.querySelector(s);
    const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  
    // =====================================================================
    // UTILS
    // =====================================================================
  
    function el(tag, props={}, children=null) {
      const e = document.createElement(tag);
      for (const k in props) {
        if (k==='class') e.className = props[k];
        else if (k==='text') e.textContent = props[k];
        else if (k==='html') e.innerHTML = props[k];
        else e.setAttribute(k, props[k]);
      }
      if (children) {
        if (Array.isArray(children)) children.forEach(c=>c && e.appendChild(c));
        else e.appendChild(children);
      }
      return e;
    }
  
    // Clone simple para evitar tocar el dat real
    function deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }
  
    // Pretty byte formatting
    const hex = n => "0x"+(n>>>0).toString(16).padStart(2,'0').toUpperCase();
  
    // =============================================================
    // SANDBOX ANALYZER LOGIC
    // =============================================================
  
    function analyzeThingRawBytes(thing, parser) {
      const result = {
        id: thing.id,
        category: thing.category,
        flagsRead: [],
        bytes: [],
        groups: [],
        inconsistencies: []
      };
  
      // Ejecutamos un lector SANDBOX: usando el parser real pero copiando bytes
      try {
        const buf = parser.raw;       // Uint8Array completo
        const seek = parser.seekInfo[thing.uid]; // requiere soporte del parser actual
        if (!seek) {
          result.inconsistencies.push(`No existe información de seek para UID=${thing.uid}`);
          return result;
        }
        const { startOffset, endOffset } = seek;
        const slice = buf.slice(startOffset,endOffset);
        result.bytes = Array.from(slice).map(b=>hex(b));
  
      } catch (err) {
        result.inconsistencies.push("Error leyendo bytes: "+err.message);
      }
  
      // Flags / attributes reconstruidas
      try {
        const attrs = parser.getThingAttributes(thing);
        result.flagsRead = attrs.flagsList;
        result.groups = attrs.groups;
      } catch (e) {
        result.inconsistencies.push("Error reconstruyendo attrs/grupos: "+e.message);
      }
  
      // ----------------------------------------------
      // Validaciones
      // ----------------------------------------------
  
      if (thing.category==='outfit' && thing.layers !== 2) {
        result.inconsistencies.push("Outfit debería tener layers=2 (body + addon) pero el archivo muestra layers="+thing.layers);
      }
  
      if (result.flagsRead.includes('Unknown')) {
        result.inconsistencies.push("Existen flags desconocidas en este thing.");
      }
  
      return result;
    }
  
    function analyzeEntireDat(dat) {
      const out = {
        signature: dat.signature,
        detectedVersion: "unknown",
        things: [],
        warnings: []
      };
  
      try {
        const parser = window._lastDatParser;
        if (!parser) {
          out.warnings.push("Parser real no encontrado. Carga un .dat nuevamente.");
          return out;
        }
  
        for (const cat of ['items','outfits','effects','missiles']) {
          const arr = dat[cat];
          if (!arr) continue;
  
          arr.forEach(thing=>{
            out.things.push( analyzeThingRawBytes(thing, parser) );
          });
        }
  
        out.detectedVersion = detectVersionHeuristics(out);
      } catch (e) {
        out.warnings.push("Error global: "+e.message);
      }
  
      return out;
    }
  
    // Heurística pequeña de versión
    function detectVersionHeuristics(report) {
      const sig = report.signature|0;
  
      if (sig===0x000004A0) return "10.98";
      if (sig===0x000042A3) return "12.x";
      if (sig===0x000003F2) return "8.60";
      if (sig===0x00000200) return "7.72";
  
      return "desconocida";
    }
  
    // =============================================================
    // UI — MODAL
    // =============================================================
  
    let modalEl=null, panelEl=null, outputEl=null;
  
    function buildModal() {
      if (modalEl) return modalEl;
  
      modalEl = el('div',{id:'thingArcheologistModal', class:'modal hidden'});
      panelEl = el('div',{class:'modal-content', id:'thingArcheologistPanel'});
  
      const header = el('div',{style:'display:flex;align-items:center;gap:6px;margin-bottom:10px'},[
        el('h2',{text:'🧬 Thing Archeologist'}),
        el('span',{class:'muted',style:'margin-left:auto;font-size:12px'},
          document.createTextNode('Modo SANDBOX — No altera el .dat real')),
        (()=>{
          const b = el('button',{text:'✖', title:'Cerrar'});
          b.onclick=closeModal;
          return b;
        })()
      ]);
  
      const info = el('p',{class:'muted',text:
        'Analiza profundamente la estructura del .dat, reconstruye el orden real de flags y bytes, detecta inconsistencias, firmas reales y comportamientos ocultos.'
      });
  
      const analyzeBtn = el('button',{id:'archAnalyzeBtn',text:'🔬 Analizar .dat'});
      analyzeBtn.onclick = runAnalysis;
  
      outputEl = el('div',{
        id:'archOutput',
        style:'margin-top:10px;max-height:350px;overflow:auto;border:1px solid var(--border);padding:6px;font-size:12px;background:#111;white-space:pre;font-family:monospace;'
      });
  
      const exportBtn = el('button',{id:'archExportBtn',text:'💾 Exportar reporte JSON'});
      exportBtn.onclick=exportReport;
  
      panelEl.append(header, info, analyzeBtn, exportBtn, outputEl);
      modalEl.appendChild(panelEl);
      document.body.appendChild(modalEl);
      return modalEl;
    }
  
    let lastReport=null;
  
    function runAnalysis() {
      outputEl.textContent="Analizando .dat...\n";
      try {
        const datClone = deepClone(window.dat);
        lastReport = analyzeEntireDat(datClone);
        outputEl.textContent = JSON.stringify(lastReport,null,2);
      } catch (e) {
        outputEl.textContent = "ERROR: "+e.message;
      }
    }
  
    function exportReport() {
      if (!lastReport) {
        alert("No hay reporte generado");
        return;
      }
      const blob = new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = el('a',{href:url,download:'thing_archeology_report.json'});
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    }
  
    function openModal() {
      buildModal();
      modalEl.classList.remove('hidden');
    }
  
    function closeModal() {
      if (modalEl) modalEl.classList.add('hidden');
    }
  
    // ESC
    document.addEventListener('keydown',(ev)=>{
      if (ev.key==='Escape' && modalEl && !modalEl.classList.contains('hidden')) closeModal();
    });
  
    // Public API
    window.ThingArcheologist = { open:openModal };
  
  })();
  