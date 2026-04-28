import { PublicKey } from '@solana/web3.js';

/**
 * GET — public config for wallet security testing: System Program Assign target.
 * Set ASSIGN_SAMPLE_PROGRAM_ID in env (deployed program on the same cluster as SOLANA_RPC_URL).
 */
export function assignSampleProgramConfig() {
  const raw = process.env.ASSIGN_SAMPLE_PROGRAM_ID;
  if (!raw || !raw.trim()) {
    return Response.json(
      {
        error:
          'Server missing ASSIGN_SAMPLE_PROGRAM_ID. Set it to a program id on your RPC cluster (e.g. a devnet sample program).',
      },
      { status: 500 }
    );
  }

  try {
    const pk = new PublicKey(raw.trim());
    const label = (process.env.ASSIGN_SAMPLE_PROGRAM_LABEL || '').trim() || null;
    return Response.json({
      programId: pk.toBase58(),
      label,
    });
  } catch {
    return Response.json({ error: 'Invalid ASSIGN_SAMPLE_PROGRAM_ID' }, { status: 500 });
  }
}
