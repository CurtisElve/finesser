import { Buffer } from 'node:buffer';
globalThis.Buffer = Buffer;
import index from './index.html';
import { quote } from './api/quote';
import { launch } from './api/launch';
import { airdropPreview, airdropPreparePartial } from './api/airdrop.js';
import { timingEscrowConfig } from './api/timing-escrow-config';

const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
})();

const server = Bun.serve({
  port: PORT,
  routes: {
    "/api/solana-rpc": {
      GET: () =>
        Response.json({
          url: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
        }),
    },
    "/api/timing-escrow-config": {
      GET: () => timingEscrowConfig(),
    },
    "/api/airdrop-preview": {
      GET: () => airdropPreview(),
    },
    "/api/airdrop-token-prepare": {
      POST: async (req) => {
        try {
          const body = await req.json();
          return await airdropPreparePartial(body);
        } catch (e) {
          console.error(e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
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
    "/": index,
    "/api/quote": {
      POST: async (req) => {
        try {
          const body = await req.json();
          return await quote(body);
        } catch(erro) {
            console.error(erro)
            return Response.json({ error: erro }, { status: 400 });
        }
      }
    },
    "/api/launch": {
      POST: async (req) => {
        try {
          const body = await req.json();
          return await launch(body);
        } catch (erro){
            console.error(erro)
            return Response.json({ error: erro }, { status: 400 });
        }
      }
    },
  }
});

console.log(`Listening on ${server.url} (PORT=${PORT})`);
