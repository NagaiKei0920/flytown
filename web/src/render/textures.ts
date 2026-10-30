import * as THREE from 'three';

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Meiryo",sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const css = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** 看板の文字テクスチャ。 */
export function signTexture(text: string, bg: number, fg: number, sub?: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 160);
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, css(bg));
  grd.addColorStop(1, css(bg));
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 144);
  g.fillStyle = css(fg);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${text.length > 4 ? 68 : 84}px ${FONT}`;
  g.fillText(text, 256, sub ? 66 : 82);
  if (sub) {
    g.font = `600 30px ${FONT}`;
    g.globalAlpha = 0.8;
    g.fillText(sub, 256, 128);
  }
  return tex(c);
}

/** 縞の日よけ。 */
export function awningTexture(a: number, b: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 32);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = css(i % 2 ? b : a);
    g.fillRect(i * 16, 0, 16, 32);
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * 複眼の六角ファセット。継ぎ目なく繰り返せる 512 px のタイル。
 * map = 色（深い赤、ファセットごとに少し明るさが違う）、normal = 各ファセットのドーム形の法線。
 */
export function hexEyeTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const W = 512;
  const COLS = 16;
  const ROWS = 18;
  const hw = W / COLS;
  const R = hw / Math.sqrt(3);
  const rowH = W / ROWS;
  const sy = rowH / (1.5 * R);
  const [c, g] = canvas(W, W);
  const [b, bg] = canvas(W, W);
  g.fillStyle = '#4a0610';
  g.fillRect(0, 0, W, W);
  bg.fillStyle = '#000';
  bg.fillRect(0, 0, W, W);
  const hexPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      const px = cx + r * Math.cos(a);
      const py = cy + r * sy * Math.sin(a);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  for (let row = -1; row <= ROWS; row++) {
    for (let col = -1; col <= COLS; col++) {
      const cx = (col + (((row % 2) + 2) % 2 ? 0.5 : 0)) * hw;
      const cy = row * rowH + rowH * 0.5;
      const rr = (((col + 40) * 7 + (row + 40) * 13) % 9) / 9;
      const grad = g.createRadialGradient(cx - R * 0.2, cy - R * 0.25, 1, cx, cy, R * 1.05);
      grad.addColorStop(0, `rgb(${226 + rr * 18},${58 + rr * 22},${64 + rr * 18})`);
      grad.addColorStop(0.55, `rgb(${178 + rr * 14},${22 + rr * 10},${40 + rr * 8})`);
      grad.addColorStop(1, 'rgb(96,6,22)');
      hexPath(g, cx, cy, R * 0.97);
      g.fillStyle = grad;
      g.fill();
      const hg = bg.createRadialGradient(cx, cy, 0, cx, cy, R * 1.02);
      hg.addColorStop(0, '#fff');
      hg.addColorStop(0.7, '#9a9a9a');
      hg.addColorStop(1, '#202020');
      hexPath(bg, cx, cy, R * 0.99);
      bg.fillStyle = hg;
      bg.fill();
    }
  }
  // 高さ -> 法線
  const hd = bg.getImageData(0, 0, W, W).data;
  const [nc, ng] = canvas(W, W);
  const out = ng.createImageData(W, W);
  const H = (x: number, y: number) => hd[(((y + W) % W) * W + ((x + W) % W)) * 4] / 255;
  const k = 2.6;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      out.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ng.putImageData(out, 0, 0);
  const map = tex(c);
  const normal = tex(nc, false);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normal };
}

/** 羽の翅脈（白線）。シェーダの uVeins に使う。 */
export function wingVeinTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const line = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  // u: 横 (0..128)、v: 縦 (下が根元)。canvas の y は上が 0 なので v を反転して描く
  const Y = (v: number) => 256 - v * 256;
  line(60, Y(0.0), 64, Y(0.97), 3.2);
  line(52, Y(0.0), 28, Y(0.8), 1.8);
  line(70, Y(0.0), 100, Y(0.78), 1.8);
  for (let k = 0; k < 5; k++) {
    const v = 0.18 + k * 0.15;
    line(63, Y(v), 22 + k * 3, Y(v + 0.12), 1.2);
    line(65, Y(v + 0.03), 104 - k * 3, Y(v + 0.14), 1.2);
  }
  const t = tex(c, false);
  return t;
}

export function glowSpriteTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

/** 道路面のアスファルト模様（ごく弱いノイズ）。 */
export function asphaltTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 232 + Math.random() * 23;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
