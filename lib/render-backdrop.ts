import sharp from "sharp";

const BACKDROP_WIDTH = 2120;
const BACKDROP_HEIGHT = 1280;
const FRAME_INSET = 100;
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

type Theme = "warm" | "cool" | "mono";

const washes: Record<Theme, [string, string, string, string, string, string]> = {
  warm: ["15,16,14", ".16", "25,26,23", ".04", "11,12,11", ".27"],
  cool: ["13,18,26", ".18", "23,32,42", ".04", "10,13,19", ".31"],
  mono: ["12,12,12", ".19", "42,42,42", ".03", "8,8,8", ".31"],
};

const blooms: Record<Theme, string> = {
  warm: '<radialGradient id="b1"><stop stop-color="rgb(242,239,207)" stop-opacity=".12"/><stop offset="1" stop-color="rgb(242,239,207)" stop-opacity="0"/></radialGradient><radialGradient id="b2"><stop stop-color="rgb(248,232,196)" stop-opacity=".07"/><stop offset="1" stop-color="rgb(248,232,196)" stop-opacity="0"/></radialGradient>',
  cool: '<radialGradient id="b1"><stop stop-color="rgb(197,221,239)" stop-opacity=".11"/><stop offset="1" stop-color="rgb(197,221,239)" stop-opacity="0"/></radialGradient><radialGradient id="b2"><stop stop-color="rgb(190,210,227)" stop-opacity=".05"/><stop offset="1" stop-color="rgb(190,210,227)" stop-opacity="0"/></radialGradient>',
  mono: '<radialGradient id="b1"><stop stop-color="white" stop-opacity=".075"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>',
};

function washSvg(theme: Theme) {
  const [left, leftAlpha, middle, middleAlpha, right, rightAlpha] = washes[theme];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BACKDROP_WIDTH}" height="${BACKDROP_HEIGHT}"><defs><linearGradient id="h"><stop stop-color="rgb(${left})" stop-opacity="${leftAlpha}"/><stop offset="42%" stop-color="rgb(${middle})" stop-opacity="${middleAlpha}"/><stop offset="100%" stop-color="rgb(${right})" stop-opacity="${rightAlpha}"/></linearGradient><linearGradient id="v" x2="0" y2="1"><stop stop-color="black" stop-opacity=".08"/><stop offset="30%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity=".14"/></linearGradient></defs><rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="url(#h)"/><rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="url(#v)"/></svg>`);
}

function bloomSvg(theme: Theme) {
  const circles = theme === "mono"
    ? '<ellipse cx="1386" cy="640" rx="520" ry="360" fill="url(#b1)"/>'
    : '<ellipse cx="1406" cy="640" rx="500" ry="350" fill="url(#b1)"/><ellipse cx="618" cy="629" rx="540" ry="400" fill="url(#b2)"/>';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BACKDROP_WIDTH}" height="${BACKDROP_HEIGHT}"><defs>${blooms[theme]}</defs>${circles}</svg>`);
}

function vignetteSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BACKDROP_WIDTH}" height="${BACKDROP_HEIGHT}"><defs><radialGradient id="v"><stop offset="46%" stop-color="black" stop-opacity="0"/><stop offset="79%" stop-color="rgb(7,8,7)" stop-opacity=".22"/><stop offset="100%" stop-color="rgb(4,5,4)" stop-opacity=".42"/></radialGradient></defs><rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="url(#v)"/></svg>`);
}

function grainSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BACKDROP_WIDTH}" height="${BACKDROP_HEIGHT}"><defs><pattern id="p" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".55" fill="white" fill-opacity=".34"/></pattern></defs><rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="url(#p)" opacity=".07"/></svg>`);
}

export async function createRenderBackdrop(inputPath: string, outputPath: string, theme: Theme) {
  await sharp(inputPath)
    .resize(BACKDROP_WIDTH, BACKDROP_HEIGHT, { fit: "cover", position: "centre" })
    .blur(50)
    .modulate({ saturation: 0.72, brightness: 0.64 })
    .linear(1.04, -5.12)
    .composite([
      { input: washSvg(theme), blend: "over" },
      { input: bloomSvg(theme), blend: "screen" },
      { input: vignetteSvg(), blend: "over" },
      { input: grainSvg(), blend: "soft-light" },
    ])
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toFile(outputPath);
}
