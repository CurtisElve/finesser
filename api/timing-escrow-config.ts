import { PublicKey } from '@solana/web3.js';

const DEFAULT_TIMING_ESCROW_PROGRAM =
  '3PEthrNepy4UErzXeSAxpwrhvDMHUfKzitFQxSNdCvyu';

function inferCluster(rpcUrl: string): string {
  const u = rpcUrl.toLowerCase();
  if (u.includes('devnet')) return 'devnet';
  if (u.includes('testnet')) return 'testnet';
  if (u.includes('127.0.0.1') || u.includes('localhost')) return 'localnet';
  return 'mainnet-beta';
}

/** Public config for browser settle flow (RPC URL + cluster + program id from env). */
export function timingEscrowConfig() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const cluster = inferCluster(rpcUrl);
  const raw = (
    process.env.TIMING_ESCROW_PROGRAM_ID || DEFAULT_TIMING_ESCROW_PROGRAM
  ).trim();
  try {
    const programId = new PublicKey(raw).toBase58();
    return Response.json({
      cluster,
      rpcUrl,
      programId,
    });
  } catch {
    return Response.json(
      { error: 'Invalid TIMING_ESCROW_PROGRAM_ID in server environment' },
      { status: 500 }
    );
  }
}
