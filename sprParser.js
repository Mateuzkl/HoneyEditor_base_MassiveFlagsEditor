// sprParser.js
export class SprParser {
  constructor(arrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.signature = this.view.getUint32(0, true);
    this.totalSprites = this.view.getUint32(4, true);
    this.offsets = [];
    this.sprites = [];

    // Preferencias de export
    this.exportOptions = {
      transparency: null,       // null = autodetect (this.hasAlpha)
      signatureOverride: null   // si quieres forzar firma
    };

    this.readOffsets();
    this.hasAlpha = this.detectAlphaSupport(); // autodetect

    // Clientes viejos (ej. 7.70 con firma 0x439852BE) NO tienen canal alpha,
    // aunque la heurística pueda confundirse. Fuerza RGB puro en ese caso.
    if ((this.signature >>> 0) === 0x439852BE) {
      this.hasAlpha = false;
    }

    // Asegúrate que SprParser acepte archivos .spr sin Transparency.
    if (typeof this.hasAlpha !== 'boolean') this.hasAlpha = false;

    this.parseSprites();
  }

  setExportFormat(options = {}) {
    this.exportOptions = { ...this.exportOptions, ...options };
  }

  readOffsets() {
    let offset = 8;
    for (let i = 0; i < this.totalSprites; i++) {
      if (offset + 4 > this.view.byteLength) { this.offsets.push(0); continue; }
      this.offsets.push(this.view.getUint32(offset, true));
      offset += 4;
    }
  }

  detectAlphaSupport() {
    // Mejor heurística: revisa los bloques coloreados del primer sprite válido
    for (let i = 0; i < Math.min(10, this.offsets.length); i++) {
      const addr = this.offsets[i];
      if (!addr || addr + 5 > this.view.byteLength) continue;

      const pixelDataSize = this.view.getUint16(addr + 3, true);
      const dataEnd = addr + 5 + pixelDataSize;
      if (dataEnd > this.view.byteLength) continue;

      let pos = addr + 5;
      let pixels = 0;
      while (pos + 4 <= dataEnd && pixels < 1024) {
        const tcount = this.view.getUint16(pos, true); pos += 2;
        const ccount = this.view.getUint16(pos, true); pos += 2;
        pixels += tcount + ccount;
        // Si hay pixels coloreados, revisa si hay bytes extra (alpha)
        if (ccount > 0 && pos + ccount * 3 <= dataEnd) {
          // Si quedan suficientes bytes para alpha, revisa si los siguientes bytes parecen alpha
          if (pos + ccount * 4 <= dataEnd) return true; // hay alpha
          else return false; // solo RGB
        }
        pos += ccount * 3; // salta los bytes de color
      }
    }
    return false;
  }

  parseSprites() {
    const maxPixels = 32 * 32;
    for (let i = 0; i < this.totalSprites; i++) {
      const addr = this.offsets[i];
      if (!addr || addr + 5 > this.view.byteLength) { this.sprites[i] = null; continue; }
      try {
        let o = addr;
        const tpix = {
          r: this.view.getUint8(o),
          g: this.view.getUint8(o + 1),
          b: this.view.getUint8(o + 2)
        };
        o += 3;
        const pixelDataSize = this.view.getUint16(o, true);
        o += 2;
        if (pixelDataSize === 0 || o + pixelDataSize > this.view.byteLength) { this.sprites[i] = null; continue; }
        const pixelDataEnd = o + pixelDataSize;
        const img = new ImageData(32, 32);
        const data = img.data;
        let written = 0;
        let pos = o;
        while (written < maxPixels && pos < pixelDataEnd) {
          if (pos + 4 > pixelDataEnd) break;
          const transparent = this.view.getUint16(pos, true); pos += 2;
          const colored = this.view.getUint16(pos, true); pos += 2;
          for (let t = 0; t < transparent && written < maxPixels; t++) {
            const idx = written * 4;
            data[idx] = tpix.r;
            data[idx + 1] = tpix.g;
            data[idx + 2] = tpix.b;
            data[idx + 3] = 0;
            written++;
          }
          for (let c = 0; c < colored && written < maxPixels; c++) {
            const idx = written * 4;
            data[idx] = this.view.getUint8(pos); pos++;
            data[idx + 1] = this.view.getUint8(pos); pos++;
            data[idx + 2] = this.view.getUint8(pos); pos++;
            if (this.hasAlpha) {
              data[idx + 3] = this.view.getUint8(pos); pos++;
            } else {
              data[idx + 3] = 255;
            }
            written++;
          }
        }
        // Rellena los píxeles restantes como transparentes
        while (written < maxPixels) {
          const idx = written * 4;
          data[idx] = tpix.r;
          data[idx + 1] = tpix.g;
          data[idx + 2] = tpix.b;
          data[idx + 3] = 0;
          written++;
        }
        this.sprites[i] = img;
      } catch (e) {
        console.error('Error parsing sprite', i, e);
        this.sprites[i] = null;
      }
    }
  }

  getSprite(index) { return this.sprites[index] || null; }

  /**
   * Añade un sprite nuevo en memoria a partir de un ImageData.
   * Si la imagen no es 32x32, se reescala en un canvas auxiliar.
   * Devuelve el nuevo spriteId (1-based, como en los .spr de Tibia).
   */
  addSpriteFromImageData(imgData) {
    if (!(imgData instanceof ImageData)) {
      throw new Error('addSpriteFromImageData espera ImageData');
    }

    let sprite = imgData;
    if (imgData.width !== 32 || imgData.height !== 32) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      const tmp = document.createElement('canvas');
      tmp.width = imgData.width;
      tmp.height = imgData.height;
      tmp.getContext('2d').putImageData(imgData, 0, 0);

      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(tmp, 0, 0, 32, 32);
      sprite = ctx.getImageData(0, 0, 32, 32);
    }

    if (!Array.isArray(this.sprites)) this.sprites = [];
    if (this.sprites.length < this.totalSprites) {
      this.sprites.length = this.totalSprites;
    }

    this.sprites.push(sprite);
    this.totalSprites = (this.totalSprites | 0) + 1;
    return this.totalSprites;
  }

  // Encoder compatible OB (conteos 16-bit, clave transparente + size LE)
  toBinary(options = {}) {
    const useAlpha = (this.exportOptions.transparency === null)
      ? this.hasAlpha
      : !!this.exportOptions.transparency;

    const signature = (this.exportOptions.signatureOverride ?? this.signature) >>> 0;
    const totalSprites = this.totalSprites >>> 0;

    // Header: firma + totalSprites (u32 + u32) + tabla offsets (u32 * totalSprites)
    const headerSize = 8 + totalSprites * 4;
    const header = new Uint8Array(headerSize);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, signature, true);
    hv.setUint32(4, totalSprites, true);

    const setOffset = (i, off) => hv.setUint32(8 + i * 4, off >>> 0, true);

    const encodeSprite = (img) => {
      if (!img || !img.data || img.data.length !== 32 * 32 * 4) return null;
      const d = img.data, PIX = 1024, blocks = [];
      let i = 0;
      while (i < PIX) {
        // transparent run
        let t = 0;
        while (i < PIX && d[i * 4 + 3] === 0 && t < 0xFFFF) { t++; i++; }
        // colored run
        let c = 0; const bytes = [];
        while (i < PIX && d[i * 4 + 3] !== 0 && c < 0xFFFF) {
          const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
          bytes.push(r, g, b); if (useAlpha) bytes.push(a);
          c++; i++;
          if (i < PIX && d[i * 4 + 3] === 0) break;
        }
        blocks.push({ t, c, bytes });
      }
      let payload = 0; for (const b of blocks) payload += 4 + b.bytes.length;
      const out = new Uint8Array(3 + 2 + payload);
      let p = 0;
      // transparent key (0,0,0)
      out[p++] = 0; out[p++] = 0; out[p++] = 0;
      // size LE
      out[p++] = payload & 0xFF; out[p++] = (payload >> 8) & 0xFF;
      // runs
      for (const b of blocks) {
        out[p++] = b.t & 0xFF; out[p++] = (b.t >> 8) & 0xFF;
        out[p++] = b.c & 0xFF; out[p++] = (b.c >> 8) & 0xFF;
        if (b.bytes.length) { out.set(b.bytes, p); p += b.bytes.length; }
      }
      return out;
    };

    const chunks = new Array(totalSprites);
    let cursor = headerSize;

    for (let i = 0; i < totalSprites; i++) {
      const buf = encodeSprite(this.sprites[i]);
      if (!buf) { setOffset(i, 0); chunks[i] = null; }
      else { setOffset(i, cursor); chunks[i] = buf; cursor += buf.byteLength; }
    }

    const out = new Uint8Array(cursor); out.set(header, 0);
    let pos = headerSize;
    for (const c of chunks) { if (!c) continue; out.set(c, pos); pos += c.byteLength; }
    return out;
  }
}
