// validator.js
export function validateAssets(dat, spr) {
  const errors = [];
  const total = spr.totalSprites;

  const checkGroup = (thing, group, category) => {
    const {
      width, height, layers,
      patternX, patternY, patternZ,
      frames, sprites
    } = group;

    const expected = width * height * layers * patternX * patternY * patternZ * frames;

    if (sprites.length !== expected) {
      errors.push(`❌ [${category} ID ${thing.id}] cantidad esperada de sprites=${expected}, encontrados=${sprites.length}`);
    }

    sprites.forEach((spriteId, i) => {
      if (!Number.isInteger(spriteId)) {
        errors.push(`❌ [${category} ID ${thing.id}] sprite[${i}] no es entero: ${spriteId}`);
        return;
      }

      if (spriteId <= 0) {
        errors.push(`⚠️ [${category} ID ${thing.id}] sprite[${i}] = 0 (transparente)`);
        return;
      }

      if (spriteId > total) {
        errors.push(`❌ [${category} ID ${thing.id}] sprite[${i}] ID fuera de rango: ${spriteId} > ${total}`);
      }
    });
  };

  const checkThings = (things, category) => {
    for (let id in things) {
      const thing = things[id];
      if (!thing || !thing.groups) continue;
      thing.groups.forEach(group => checkGroup(thing, group, category));
    }
  };

  checkThings(dat.items, "Item");
  checkThings(dat.outfits, "Outfit");
  checkThings(dat.effects, "Effect");
  checkThings(dat.missiles, "Missile");

  if (errors.length === 0) {
    console.info("✅ Todos los sprites están en orden.");
  } else {
    console.warn(`⚠️ ${errors.length} problemas encontrados:\n`, errors.join("\n"));
  }
}///fin validador///