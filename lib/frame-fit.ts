// Fits a picture into the video frame WITHOUT cutting people off.
// Pictures that do not match the frame shape are shown whole (never cropped) on a soft blurred
// copy of themselves; pictures that already match the frame shape simply fill it.
export type Rect = { dx: number; dy: number; dw: number; dh: number; contain: boolean };

export function fitRect(iw: number, ih: number, W: number, H: number, zoom = 1): Rect {
  const contain = Math.abs(iw / ih / (W / H) - 1) > 0.06;
  const s = (contain ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih)) * zoom;
  const dw = iw * s;
  const dh = ih * s;
  return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh, contain };
}

const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

// A blurred, darkened, full-frame version of the picture (made once, then reused).
export function blurredBackground(img: HTMLImageElement, W: number, H: number): HTMLCanvasElement {
  let byKey = cache.get(img);
  if (!byKey) {
    byKey = new Map();
    cache.set(img, byKey);
  }
  const key = `${W}x${H}`;
  const hit = byKey.get(key);
  if (hit) return hit;

  const sw = Math.max(8, Math.round(W / 24));
  const sh = Math.max(8, Math.round(H / 24));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");
  const s = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
  sctx?.drawImage(img, (sw - img.naturalWidth * s) / 2, (sh - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  if (octx) {
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(small, 0, 0, W, H); // scaling up a tiny copy = cheap, smooth blur
    octx.fillStyle = "rgba(0,0,0,0.42)";
    octx.fillRect(0, 0, W, H);
  }
  byKey.set(key, out);
  return out;
}
