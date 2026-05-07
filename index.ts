import index from './index.html';
import { timingEscrowConfig } from './api/timing-escrow-config';

const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
})();

const server = Bun.serve({
  port: PORT,
  routes: {
    "/api/timing-escrow-config": {
      GET: () => timingEscrowConfig(),
    },
    "/trippy-scene.bundle.js": new Response(Bun.file(`${import.meta.dir}/trippy-scene.bundle.js`), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    }),
    "/settle-escrow.bundle.js": new Response(Bun.file(`${import.meta.dir}/settle-escrow.bundle.js`), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    }),
    "/resources/target.png": new Response(Bun.file(`${import.meta.dir}/resources/target.png`), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    }),
    "/resources/brain.glb": new Response(
      Bun.file(`${import.meta.dir}/resources/brain.glb`),
      {
        headers: {
          "Content-Type": "model/gltf-binary",
          "Cache-Control": "public, max-age=86400",
        },
      },
    ),
    "/resources/leaderboard.jpeg": new Response(Bun.file(`${import.meta.dir}/resources/leaderboard.jpeg`), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    }),
    "/resources/graph.png": new Response(Bun.file(`${import.meta.dir}/resources/graph.png`), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    }),
    "/": index,
  }
});

console.log(`Listening on ${server.url} (PORT=${PORT})`);
