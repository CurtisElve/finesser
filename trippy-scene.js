/**
 * Full-screen trippy WebGL background (Three.js).
 * Source entry: `bun run build:trippy` → trippy-scene.bundle.js (served to the browser).
 */
import * as THREE from 'three';

const canvas = document.getElementById('trippy-webgl');
if (!canvas) {
  console.warn('trippy-webgl canvas missing');
} else {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const fragmentShader = `
    uniform float uTime;
    uniform vec2 uMouse;
    uniform vec2 uResolution;
    uniform float uIntensity;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = p * 2.02 + vec2(17.0);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = vUv;
      vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
      vec2 uva = (uv - 0.5) * aspect + 0.5;

      /* Same 0–1 space as the canvas; distance in pixels → circular hotspot in screen space (not skewed by aspect-warped uva). */
      vec2 deltaUv = uMouse - vUv;
      vec2 deltaPx = deltaUv * uResolution;
      float distPx = length(deltaPx);
      float pulse = exp(-distPx / 200.0) * 0.48 * uIntensity;
      vec2 dirUv = normalize(deltaUv + 1e-5);

      vec2 warp = uva * 2.1 - 0.55;
      float t = uTime;
      warp += vec2(
        fbm(warp * 3.2 + t * 0.15),
        fbm(warp * 3.1 - t * 0.14)
      ) * (0.38 + 0.2 * uIntensity);
      warp += dirUv * pulse * 0.26;

      vec2 p = warp * (2.8 + 0.35 * sin(t * 0.6));
      float n1 = fbm(p + vec2(t * 0.4, t * 0.28));
      float n2 = fbm(p * 1.35 + vec2(-t * 0.55, t * 0.33) + 11.0);
      float n3 = sin((n1 * 6.28318 + n2 * 4.2) + t * 1.6);

      float moire = sin((uva.x + uva.y) * 80.0 + t * 1.2) * sin((uva.x - uva.y) * 72.0 - t);
      moire *= 0.04 * uIntensity;

      float pat = n1 * 0.5 + n2 * 0.38 + n3 * 0.16;
      pat = sin(pat * 14.0 - t * 0.95) * 0.5 + 0.5;

      vec3 base = vec3(0.97, 0.94, 0.90);
      vec3 mint = vec3(0.42, 0.82, 0.72);
      vec3 violet = vec3(0.58, 0.42, 0.92);
      vec3 rose = vec3(0.92, 0.48, 0.68);
      vec3 gold = vec3(0.92, 0.78, 0.45);

      vec3 col = mix(base, mint, smoothstep(0.15, 0.88, n1) * 0.55);
      col = mix(col, violet, smoothstep(0.35, 0.95, n2) * 0.45 * uIntensity);
      col += rose * (0.22 * pat * pat * uIntensity);
      col += gold * (0.12 * n3 * n3 * uIntensity);

      float hue = fract(n1 * 0.38 + n2 * 0.22 + t * 0.08 + distPx * 0.00045 + pulse);
      vec3 prism = cos(hue * 6.28318 + vec3(0.0, 2.094, 4.189)) * 0.22 + 0.78;
      col = mix(col, col * prism, 0.42 * uIntensity);

      col += moire;

      float vig = 1.0 - pow(length(vUv - 0.5) * 1.42, 2.1);
      col *= vig * 0.9 + 0.1;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uIntensity: { value: reduceMotion ? 0.28 : 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const clock = new THREE.Clock();
  let targetX = 0.5;
  let targetY = 0.5;
  /** Smoothed for CSS card rim */
  let smoothX = 0.5;
  let smoothY = 0.5;
  /** Fast follow for shader (1:1 with pointer) */
  let shaderMX = 0.5;
  let shaderMY = 0.5;
  let vx = 0;
  let vy = 0;
  let prevX = 0;
  let prevY = 0;
  let hasPrev = false;
  let jx = 0;
  let jy = 0;

  function setSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(w, h);
  }

  function onPointer(clientX, clientY) {
    targetX = clientX / window.innerWidth;
    targetY = clientY / window.innerHeight;
    if (hasPrev) {
      vx = vx * 0.82 + (clientX - prevX) * 0.28;
      vy = vy * 0.82 + (clientY - prevY) * 0.28;
    }
    prevX = clientX;
    prevY = clientY;
    hasPrev = true;
  }

  window.addEventListener(
    'mousemove',
    (e) => onPointer(e.clientX, e.clientY),
    { passive: true }
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches && e.touches[0];
      if (t) onPointer(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches && e.touches[0];
      if (t) onPointer(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener('resize', setSize);
  setSize();

  function tick() {
    const elapsed = clock.getElapsedTime();
    const timeScale = reduceMotion ? 0.12 : 1.0;
    uniforms.uTime.value = elapsed * timeScale;

    const cssPull = reduceMotion ? 0.04 : 0.1;
    smoothX += (targetX - smoothX) * cssPull;
    smoothY += (targetY - smoothY) * cssPull;

    const shaderPull = reduceMotion ? 0.12 : 0.78;
    shaderMX += (targetX - shaderMX) * shaderPull;
    shaderMY += (targetY - shaderMY) * shaderPull;

    jx += (vx - jx) * 0.2;
    jy += (vy - jy) * 0.2;
    vx *= 0.9;
    vy *= 0.9;

    uniforms.uMouse.value.set(shaderMX, 1.0 - shaderMY);

    const root = document.documentElement;
    root.style.setProperty('--mx', String(smoothX));
    root.style.setProperty('--my', String(smoothY));
    root.style.setProperty('--shine', String(smoothX * 0.5 + 0.25));
    root.style.setProperty('--vx', String(Math.max(0, Math.min(1, vx / window.innerWidth + 0.5))));
    root.style.setProperty('--vy', String(Math.max(0, Math.min(1, vy / window.innerHeight + 0.5))));
    root.style.setProperty('--jx', String(Math.max(-96, Math.min(96, jx))));
    root.style.setProperty('--jy', String(Math.max(-96, Math.min(96, jy))));
    root.style.setProperty('--pulse', String(Math.sin(elapsed * 0.85) * (reduceMotion ? 6 : 22)));

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
