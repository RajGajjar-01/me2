import * as THREE from 'three';

// CPU-backed canvases: Chrome evicts GPU-backed 2D canvases under memory
// pressure (8GB iGPU, path tracer), which blanks every texture on re-upload.
const CPU_CANVAS: CanvasRenderingContext2DSettings = {
  willReadFrequently: true,
};

export class TextureGenerator {
  static createTarmacTexture(size = 512): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;

    ctx.fillStyle = '#656b73';
    ctx.fillRect(0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 45;
      const grain = (Math.random() - 0.5) * 20;
      const v = Math.min(255, Math.max(0, data[i] + noise + grain));
      data[i] = v * 0.98;
      data[i + 1] = v;
      data[i + 2] = v * 1.02;
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.strokeStyle = 'rgba(40, 44, 50, 0.7)';
    ctx.lineWidth = 3;
    const grid = size / 2;
    for (let x = 0; x <= size; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  static createTarmacBumpMap(size = 256): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.min(255, Math.max(0, 128 + (Math.random() - 0.5) * 80));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  static createContainerTexture(
    colorHex: string,
    stencilCode: string,
    size = 512,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;

    ctx.fillStyle = colorHex;
    ctx.fillRect(0, 0, size, size);

    const ribWidth = 24;
    for (let x = 0; x < size; x += ribWidth) {
      const grad = ctx.createLinearGradient(x, 0, x + ribWidth, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.05)');
      grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.35)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, ribWidth, size);
    }

    ctx.fillStyle = 'rgba(95, 45, 20, 0.55)';
    for (let r = 0; r < 8; r++) {
      const rx = Math.random() * size;
      const ry = (Math.random() > 0.5 ? 0 : size - 40) + Math.random() * 40;
      ctx.beginPath();
      ctx.arc(rx, ry, 12 + Math.random() * 20, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(stencilCode, 28, 48);
    ctx.font = '14px monospace';
    ctx.fillText('TACTICAL STORAGE // 30T', 28, 70);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  static createWoodTexture(size = 512): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;

    ctx.fillStyle = '#8b6942';
    ctx.fillRect(0, 0, size, size);

    const plankH = size / 6;
    for (let y = 0; y < size; y += plankH) {
      for (let g = 0; g < 15; g++) {
        ctx.strokeStyle = `rgba(65, 40, 20, ${0.1 + Math.random() * 0.2})`;
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        const py = y + Math.random() * plankH;
        ctx.moveTo(0, py);
        ctx.bezierCurveTo(
          size * 0.3,
          py + (Math.random() - 0.5) * 10,
          size * 0.7,
          py + (Math.random() - 0.5) * 10,
          size,
          py,
        );
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(30, 18, 8, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();

      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(20, y + plankH / 2, 4, 0, Math.PI * 2);
      ctx.arc(size - 20, y + plankH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  static createBurlapTexture(size = 256): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;

    ctx.fillStyle = '#827357';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(50, 42, 30, 0.4)';
    ctx.lineWidth = 2;
    const step = 8;
    for (let x = 0; x < size; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  static createMuzzleFlashTexture(size = 256): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;
    const cx = size / 2;
    const cy = size / 2;

    ctx.clearRect(0, 0, size, size);

    const spikes = [
      { angle: 0, length: size * 0.48, width: 14 },
      { angle: Math.PI / 2, length: size * 0.42, width: 12 },
      { angle: Math.PI, length: size * 0.46, width: 14 },
      { angle: -Math.PI / 2, length: size * 0.44, width: 12 },
      { angle: Math.PI / 4, length: size * 0.32, width: 8 },
      { angle: -Math.PI / 4, length: size * 0.3, width: 8 },
      { angle: (3 * Math.PI) / 4, length: size * 0.32, width: 8 },
      { angle: -(3 * Math.PI) / 4, length: size * 0.3, width: 8 },
    ];

    spikes.forEach((s) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.angle);

      const grad = ctx.createLinearGradient(0, 0, s.length, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.2, 'rgba(255, 200, 50, 0.9)');
      grad.addColorStop(0.6, 'rgba(255, 80, 10, 0.6)');
      grad.addColorStop(1, 'rgba(200, 20, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -s.width / 2);
      ctx.lineTo(s.length, 0);
      ctx.lineTo(0, s.width / 2);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    });

    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.38);
    coreGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    coreGrad.addColorStop(0.18, 'rgba(255, 240, 150, 0.95)');
    coreGrad.addColorStop(0.42, 'rgba(255, 140, 30, 0.75)');
    coreGrad.addColorStop(0.72, 'rgba(240, 50, 10, 0.3)');
    coreGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (0.2 + Math.random() * 0.28) * size;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist;
      const r = 1.2 + Math.random() * 2.2;

      ctx.fillStyle = 'rgba(255, 250, 180, 0.9)';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  static createMuzzleSmokeTexture(size = 128): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;
    const cx = size / 2;
    const cy = size / 2;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.48);
    grad.addColorStop(0.0, 'rgba(220, 215, 210, 0.55)');
    grad.addColorStop(0.35, 'rgba(180, 175, 170, 0.35)');
    grad.addColorStop(0.7, 'rgba(140, 135, 130, 0.15)');
    grad.addColorStop(1.0, 'rgba(100, 100, 100, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  static createTracerTexture(size = 256): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = 32;
    const ctx = canvas.getContext('2d', CPU_CANVAS)!;

    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0.0, 'rgba(255, 100, 10, 0.0)');
    grad.addColorStop(0.4, 'rgba(255, 140, 20, 0.4)');
    grad.addColorStop(0.8, 'rgba(255, 220, 80, 0.85)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 1.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, 32);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
