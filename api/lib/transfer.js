import {
  getAssociatedTokenAddress,
  getAccount,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  unpackAccount,
} from '@solana/spl-token';
import { SystemProgram, Transaction, ComputeBudgetProgram } from '@solana/web3.js';

function tokenProgramForOwner(ownerProgram) {
  if (ownerProgram.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

export function formatTokenUiAmount(rawBig, decimals) {
  if (decimals === 0) return rawBig.toString();
  const s = rawBig.toString();
  const pad = decimals - s.length;
  const p = pad > 0 ? '0'.repeat(pad) + s : s;
  const cut = p.length - decimals;
  const intPart = p.slice(0, cut) || '0';
  const fracPart = p.slice(cut);
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/**
 * Single RPC pass: locate burner’s token account for this mint (legacy ATA, Token-2022 ATA, or scan).
 * @returns {{ sourceAccount: import('@solana/spl-token').RawAccount & { address: import('@solana/web3.js').PublicKey }, sourceTokenProgramId: import('@solana/web3.js').PublicKey } | null}
 */
export async function scanBurnerTokenAccountsOnce(connection, burnerKeypair, mintPubkey) {
  try {
    const ataAddress = await getAssociatedTokenAddress(mintPubkey, burnerKeypair.publicKey, false, TOKEN_PROGRAM_ID);
    const account = await getAccount(connection, ataAddress, 'confirmed', TOKEN_PROGRAM_ID);
    if (account && account.amount > 0n) {
      return { sourceAccount: account, sourceTokenProgramId: TOKEN_PROGRAM_ID };
    }
  } catch (_) {}

  try {
    const ataAddress = await getAssociatedTokenAddress(mintPubkey, burnerKeypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const account = await getAccount(connection, ataAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
    if (account && account.amount > 0n) {
      return { sourceAccount: account, sourceTokenProgramId: TOKEN_2022_PROGRAM_ID };
    }
  } catch (_) {}

  try {
    const [legacyAccounts, t22Accounts] = await Promise.all([
      connection.getTokenAccountsByOwner(burnerKeypair.publicKey, { mint: mintPubkey }, { commitment: 'confirmed', programId: TOKEN_PROGRAM_ID }),
      connection.getTokenAccountsByOwner(burnerKeypair.publicKey, { mint: mintPubkey }, { commitment: 'confirmed', programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    const allAccounts = [...legacyAccounts.value, ...t22Accounts.value];
    for (const account of allAccounts) {
      const programId = account.account.owner;
      const unpacked = unpackAccount(account.pubkey, account.account, programId);
      if (unpacked.amount > 0n) {
        return { sourceAccount: unpacked, sourceTokenProgramId: tokenProgramForOwner(programId) };
      }
    }
  } catch (_) {}

  return null;
}

export async function resolveBurnerTokenSource(connection, burnerKeypair, mintPubkey, maxAttempts = 120, delayMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    const found = await scanBurnerTokenAccountsOnce(connection, burnerKeypair, mintPubkey);
    if (found) return found;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/** @param {import('@solana/web3.js').PublicKey} recipientPubkey — fee payer + ATA rent payer (Phantom user). */
export async function buildPartialSignedCoSignedGiftTransaction({
  connection,
  burnerKeypair,
  mintPubkey,
  recipientPubkey,
}) {
  const resolved = await resolveBurnerTokenSource(connection, burnerKeypair, mintPubkey, 120, 500);
  if (!resolved) {
    throw new Error('Could not find burner token account with a balance for this mint.');
  }

  const { sourceAccount, sourceTokenProgramId } = resolved;
  const amount = sourceAccount.amount;
  if (amount === 0n) return null;

  const mintInfo = await getMint(connection, mintPubkey, 'confirmed', sourceTokenProgramId);
  const decimals = mintInfo.decimals;
  const sourceAta = sourceAccount.address;
  const destAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey, false, sourceTokenProgramId);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = recipientPubkey;

  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));

  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      recipientPubkey,
      destAta,
      recipientPubkey,
      mintPubkey,
      sourceTokenProgramId
    )
  );
  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      mintPubkey,
      destAta,
      burnerKeypair.publicKey,
      amount,
      decimals,
      [],
      sourceTokenProgramId
    )
  );

  tx.partialSign(burnerKeypair);

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    transactionBase64: Buffer.from(serialized).toString('base64'),
    blockhash,
    lastValidBlockHeight,
    mint: mintPubkey.toBase58(),
    amountRaw: amount.toString(),
    decimals,
    amountUi: formatTokenUiAmount(amount, decimals),
    tokenProgram: sourceTokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'token2022' : 'spl-token',
  };
}

export async function giftAllTokensToRecipient({ connection, burnerKeypair, mintPubkey, recipientPubkey }) {
  console.log('--- Gifting Tokens: Locking In ---');

  const resolved = await resolveBurnerTokenSource(connection, burnerKeypair, mintPubkey, 120, 500);
  if (!resolved) {
    throw new Error('GIFT FAILED: Could not find the token account with a balance after 60 seconds.');
  }

  const { sourceAccount, sourceTokenProgramId } = resolved;
  const sourceAta = sourceAccount.address;
  const amount = sourceAccount.amount;
  if (amount === 0n) return null;

  const mintInfo = await getMint(connection, mintPubkey, 'confirmed', sourceTokenProgramId);
  const decimals = mintInfo.decimals;

  const destAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey, false, sourceTokenProgramId);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = burnerKeypair.publicKey;

  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));

  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      burnerKeypair.publicKey,
      destAta,
      recipientPubkey,
      mintPubkey,
      sourceTokenProgramId
    )
  );
  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      mintPubkey,
      destAta,
      burnerKeypair.publicKey,
      amount,
      decimals,
      [],
      sourceTokenProgramId
    )
  );

  const sig = await connection.sendTransaction(tx, [burnerKeypair], {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 5,
  });

  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(`  Gift TX confirmed: ${sig}`);
  return sig;
}

export async function returnRemainingSol({ connection, burnerKeypair, recipientPubkey }) {
  const reserveLamports = BigInt(process.env.SOLO_RETURN_RESERVE_LAMPORTS || Math.floor(0.002 * 1e9));
  const burnerLamports = BigInt(await connection.getBalance(burnerKeypair.publicKey, 'confirmed'));

  const lamportsToSend = burnerLamports - reserveLamports;
  if (lamportsToSend <= 0n) {
    console.log('  returnRemainingSol: nothing to send after reserve.');
    return null;
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = burnerKeypair.publicKey;

  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));

  tx.add(
    SystemProgram.transfer({
      fromPubkey: burnerKeypair.publicKey,
      toPubkey: recipientPubkey,
      lamports: Number(lamportsToSend),
    })
  );

  const sig = await connection.sendTransaction(tx, [burnerKeypair], {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 5,
  });

  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(`  SOL return TX confirmed: ${sig}`);
  return sig;
}
