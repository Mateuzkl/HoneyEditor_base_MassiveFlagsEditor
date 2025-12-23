// versionManager.js
export class VersionManager {
  constructor() {
    this.versions = [];
  }

  async loadXML(file) {
    const text = await file.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");
    const entries = xml.querySelectorAll("version");

    this.versions = Array.from(entries).map(node => ({
      value: node.getAttribute("value"),
      name: node.getAttribute("string"),
      dat: node.getAttribute("dat")?.toUpperCase().padStart(8, "0"),
      spr: node.getAttribute("spr")?.toUpperCase().padStart(8, "0"),
      otb: parseInt(node.getAttribute("otb")) || 0
    }));
  }

  getVersionFromSignatures(datSig, sprSig) {
    const datHex = datSig.toString(16).toUpperCase().padStart(8, "0");
    const sprHex = sprSig.toString(16).toUpperCase().padStart(8, "0");

    return this.versions.find(ver =>
      ver.dat === datHex && ver.spr === sprHex
    ) || null;
  }
}
