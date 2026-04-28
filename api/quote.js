import { getBurnerPublicKeyBase58 } from './lib/solana.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

function toLamports(sol) {
  const n = Number(sol);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid SOL amount');
  return Math.floor(n * LAMPORTS_PER_SOL);
}

export async function quote(body) {
  const buyAmountSol = body?.buyAmountSol;
  console.log(buyAmountSol)
  if (buyAmountSol === undefined)
    return Response.json({ error: 'Missing buyAmountSol' }, { status: 400 });

  const creationFeeSol = process.env.PUMP_CREATION_FEE_SOL || '0.021';
  const bufferSol = process.env.PUMP_EXTRA_BUFFER_SOL || '0.002';
  
  const buyLamports = toLamports(buyAmountSol);
  const creationFeeLamports = toLamports(creationFeeSol);
  const bufferLamports = toLamports(bufferSol);
  const totalLamports = buyLamports + creationFeeLamports + bufferLamports;

  return Response.json({
    burnerPublicKey: getBurnerPublicKeyBase58(),
    buyLamports,
    creationFeeLamports,
    bufferLamports,
    totalLamports,
    totalLamportsSol: totalLamports / LAMPORTS_PER_SOL,
  });
}