// Conversion entre coordonnées de tuile (x, y) et coordonnées écran isométriques.
export const TILE_W = 64;
export const TILE_H = 32;

export function tileToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) };
}

export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const p = screenToTileF(sx, sy);
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

// Version sans arrondi : la tuile (x, y) couvre [x, x+1[ × [y, y+1[.
export function screenToTileF(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

// Centre de la tuile (x, y) à l'écran.
export function tileCenter(x: number, y: number): { sx: number; sy: number } {
  return tileToScreen(x + 0.5, y + 0.5);
}

// Les 4 coins du losange de la tuile (x, y), dans l'ordre haut, droite, bas, gauche.
export function tileDiamond(x: number, y: number): number[] {
  const { sx, sy } = tileToScreen(x, y);
  return [sx, sy, sx + TILE_W / 2, sy + TILE_H / 2, sx, sy + TILE_H, sx - TILE_W / 2, sy + TILE_H / 2];
}
