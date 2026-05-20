import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Point = readonly [number, number];

const viewBoxSize = 512;
const circle = {
  cx: viewBoxSize / 2,
  cy: viewBoxSize / 2,
  r: 238,
};

const colors = {
  blue: '#5667f5',
  white: '#fff',
};

// Adapted from the Nix snowflake logo geometry by Tim Cuthbertson.
// Source: https://github.com/NixOS/nixos-artwork/blob/master/logo/nix-snowflake-colours.svg
// License: CC BY 4.0.
const snowflakeCenter: Point = [407.3, -715.9];
const snowflakeArm: Point[] = [
  [309.54892, -710.38827],
  [431.74575, -498.71315],
  [375.58869, -498.18635],
  [342.96509, -555.05555],
  [310.10864, -498.49025],
  [282.20627, -498.50125],
  [267.91541, -523.19085],
  [314.72588, -603.68095],
  [281.49642, -661.50665],
];

const rotations = [0, 60, -60, 180, 120, -120];

const snowflake = rotations.map((degrees) =>
  snowflakeArm.map((point) => rotate(point, degrees, snowflakeCenter))
);

const flattenedSnowflake = snowflake.flat();
const bounds = getBounds(flattenedSnowflake);
const markWidth = 420;
const scale = markWidth / (bounds.maxX - bounds.minX);
const markHeight = (bounds.maxY - bounds.minY) * scale;
const offset: Point = [(viewBoxSize - markWidth) / 2, (viewBoxSize - markHeight) / 2];

const normalizedSnowflake = snowflake.map((polygon) =>
  polygon.map(([x, y]) => [
    offset[0] + (x - bounds.minX) * scale,
    offset[1] + (y - bounds.minY) * scale,
  ] satisfies Point)
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" role="img" aria-labelledby="title desc">
  <title id="title">Nix snowflake logo</title>
  <desc id="desc">A white angular Nix-style snowflake mark centered in a blue circle.</desc>
  <circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="${colors.blue}" />
  <g fill="${colors.white}">
${normalizedSnowflake.map((polygon) => `    <polygon points="${formatPoints(polygon)}" />`).join('\n')}
  </g>
</svg>
`;

const scriptPath = fileURLToPath(import.meta.url);
const siteRoot = dirname(dirname(scriptPath));
const outPath = join(siteRoot, 'public', 'nix-logo.svg');

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, svg);

function rotate([x, y]: Point, degrees: number, [cx, cy]: Point): Point {
  const radians = (degrees * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;

  return [
    cx + dx * Math.cos(radians) - dy * Math.sin(radians),
    cy + dx * Math.sin(radians) + dy * Math.cos(radians),
  ];
}

function getBounds(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function formatPoints(points: Point[]) {
  return points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' ');
}

function round(value: number) {
  return Number(value.toFixed(3));
}
