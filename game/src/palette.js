// The look plan, in one place. SABLE LINE is a dusk rail yard: deep slate sky, warm
// amber sun, rust steel and teal for the player's team. Every colour in the game is one
// of these names; the same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#171a20', // sky / fog
  surface: '#232a33', // walls, containers
  hairline: '#333d47', // crates, trim
  ink: '#ece7db', // HUD text, light
  muted: '#8b98a5', // secondary text
  accent: '#f2a33c', // amber: sun, crosshair accent, buy highlights
  rust: '#c65a2e', // enemy team, hazard stripes
  teal: '#3fb8a6', // friendly team, site markers
  ground: '#2a2620', // yard floor
  dark: '#12151a', // shadows, panels
};

export function shade(name) {
  return PALETTE[name];
}
