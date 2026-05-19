/**
 * timing_escrow browser client — Quasar + SPL wSOL settle layout.
 *
 * Deps: @solana/web3.js, @solana/spl-token
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export const TIMING_ESCROW_PROGRAM_ID = new PublicKey(
  "3PEthrNepy4UErzXeSAxpwrhvDMHUfKzitFQxSNdCvyu",
);

export const TIMING_ESCROW_AUTHORITY = new PublicKey(
  "J4NLat3y7SxZ1CMBxnpQSrK75Da49vJRwKLgtPVskH27",
);

export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** Shared reward vault — `VaultAccount` seeds. */
export const VAULT_SEED = new TextEncoder().encode("vaultv6");

/** SPL delegate PDA — `DelegateAuthority` seeds. */
export const DELEGATE_SEED = new TextEncoder().encode("delegate");

/** SPL token account size for rent estimate when creating wSOL ATA. */
export const TOKEN_ACCOUNT_DATA_LEN = 165;

export const WIN_ELAPSED_MAX_SEC = 3;
export const WIN_REWARD_LAMPORTS = 100_000_000;
export const TX_FEE_HEADROOM_LAMPORTS = 250_000;

export function getVaultPda(programId = TIMING_ESCROW_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId);
}

export function getDelegatePda(programId = TIMING_ESCROW_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([DELEGATE_SEED], programId);
}

/** User wSOL ATA (associated_token: authority=user, mint=WSOL). */
export function getUserWsolAta(userPubkey) {
  return getAssociatedTokenAddressSync(
    WSOL_MINT,
    userPubkey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

function setU64LE(u8, offset, value) {
  new DataView(u8.buffer, u8.byteOffset + offset, 8).setBigUint64(
    0,
    BigInt(value),
    true,
  );
}

function setI64LE(u8, offset, value) {
  new DataView(u8.buffer, u8.byteOffset + offset, 8).setBigInt64(
    0,
    BigInt(value),
    true,
  );
}

export function buildInitVaultInstructionData(amount) {
  const data = new Uint8Array(9);
  data[0] = 0;
  setU64LE(data, 1, amount);
  return data;
}

export function buildSettleInstructionData(timeClicked, costLamports) {
  const data = new Uint8Array(17);
  data[0] = 1;
  setI64LE(data, 1, timeClicked);
  setU64LE(data, 9, costLamports);
  return data;
}

export function buildWithdrawInstructionData(amount) {
  const data = new Uint8Array(9);
  data[0] = 2;
  setU64LE(data, 1, amount);
  return data;
}

export function clusterRpcEndpoint(cluster, rpcOverride) {
  if (rpcOverride) return rpcOverride;
  if (cluster === "localnet") return "http://127.0.0.1:8899";
  const endpoints = {
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
    devnet: "https://api.devnet.solana.com",
    testnet: "https://api.testnet.solana.com",
  };
  const url = endpoints[cluster];
  if (!url) throw new Error(`Unknown cluster for RPC: ${cluster}`);
  return url;
}

export function getTimingEscrowClient(
  wallet,
  cluster = "mainnet-beta",
  rpcOverride,
) {
  return {
    connection: new Connection(
      clusterRpcEndpoint(cluster, rpcOverride),
      "confirmed",
    ),
    wallet,
    programId: TIMING_ESCROW_PROGRAM_ID,
    cluster,
  };
}

/**
 * Loss path `cost_lamports`: lamports wrapped into wSOL ATA + delegate approve.
 * Program requires `cost_lamports > 0` on loss (`ZeroCost`).
 */
export async function computePenaltyLamports(connection, userPubkey) {
  const [vaultPda] = getVaultPda();
  const userWsolAta = getUserWsolAta(userPubkey);

  const [balanceLamports, vaultInfo, userAcct, wsolAtaInfo, tokenAccountRent] =
    await Promise.all([
      connection.getBalance(userPubkey),
      connection.getAccountInfo(vaultPda),
      connection.getAccountInfo(userPubkey),
      connection.getAccountInfo(userWsolAta),
      connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_DATA_LEN),
    ]);

  const dataLen = userAcct?.data?.length ?? 0;
  const userRentMin = await connection.getMinimumBalanceForRentExemption(dataLen);
  const wsolAtaInitRent = wsolAtaInfo == null ? tokenAccountRent : 0;
  const reserveLamports =
    TX_FEE_HEADROOM_LAMPORTS + userRentMin + wsolAtaInitRent;
  let costLamports = Math.max(
    0,
    Math.floor(balanceLamports - reserveLamports),
  );
  if (costLamports === 0 && balanceLamports > reserveLamports + 1) {
    costLamports = 1;
  }

  return {
    costLamports,
    balanceLamports,
    reserveLamports,
    rentMinLamports: userRentMin,
    wsolAtaInitRent,
    userWsolAta,
    wsolAtaExists: wsolAtaInfo != null,
    delegate: getDelegatePda()[0],
    vaultExists: vaultInfo != null,
    vaultLamports: vaultInfo?.lamports ?? 0,
    canWin: (vaultInfo?.lamports ?? 0) >= WIN_REWARD_LAMPORTS,
    lossRequiresPositiveCost: true,
  };
}

function signatureMeetsCommitment(st, want) {
  const s = st?.confirmationStatus;
  if (!s) return false;
  if (want === "finalized") return s === "finalized";
  if (want === "confirmed") return s === "confirmed" || s === "finalized";
  return s === "processed" || s === "confirmed" || s === "finalized";
}

export async function confirmSignatureHttpPolling(
  connection,
  signature,
  opts = {},
) {
  const commitment = opts.commitment ?? "confirmed";
  const pollMs = opts.pollMs ?? 750;
  let maxPollMs = opts.maxPollMsCap ?? 90_000;
  if (opts.lastValidBlockHeight != null) {
    try {
      const h = await connection.getBlockHeight("confirmed");
      const slotsLeft = opts.lastValidBlockHeight - h;
      if (slotsLeft > 0) {
        maxPollMs = Math.min(maxPollMs, Math.max(10_000, slotsLeft * 450));
      }
    } catch {
      /* ignore */
    }
  }

  const start = Date.now();
  while (Date.now() - start < maxPollMs) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = value[0];
    if (st?.err) {
      throw new Error(
        `Transaction ${signature} failed: ${JSON.stringify(st.err)}`,
      );
    }
    if (signatureMeetsCommitment(st, commitment)) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (opts.lastValidBlockHeight != null) {
    try {
      const h = await connection.getBlockHeight("confirmed");
      if (h > opts.lastValidBlockHeight) {
        throw new Error(
          `Transaction ${signature} expired (blockhash). Try again.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("expired")) throw e;
    }
  }
  throw new Error(
    `Timed out after ${maxPollMs}ms waiting for confirmation: ${signature}`,
  );
}

/**
 * `settle` accounts (order matches `Settle` in program):
 * user, user_wsol_ata, wsol_mint, delegate, vault, token_program,
 * associated_token_program, system_program.
 */
export async function settle(ctx, userPubkey, opts = {}) {
  const timeClicked =
    opts.timeClicked != null
      ? Math.trunc(Number(opts.timeClicked))
      : Math.floor(Date.now() / 1000);

  const { connection, wallet, programId } = ctx;
  const [vaultPubkey] =
    opts.vault != null ? [opts.vault] : getVaultPda(programId);
  const [delegatePubkey] =
    opts.delegate != null ? [opts.delegate] : getDelegatePda(programId);
  const userWsolAta =
    opts.userWsolAta != null ? opts.userWsolAta : getUserWsolAta(userPubkey);

  let costLamports;
  if (opts.costLamports != null) {
    costLamports = Math.max(0, Math.floor(Number(opts.costLamports)));
  } else {
    const pen = await computePenaltyLamports(connection, userPubkey);
    costLamports = pen.costLamports;
  }

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: userWsolAta, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: delegatePubkey, isSigner: false, isWritable: false },
      { pubkey: vaultPubkey, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildSettleInstructionData(timeClicked, costLamports),
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.feePayer = userPubkey;
  tx.recentBlockhash = blockhash;

  const signed = await wallet.signTransaction(tx);
  const raw =
    signed.serialize() instanceof Uint8Array
      ? signed.serialize()
      : new Uint8Array(signed.serialize());

  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed",
  });
  await confirmSignatureHttpPolling(connection, signature, {
    lastValidBlockHeight,
  });

  return {
    tx: signature,
    timeClicked,
    costLamports,
    vault: vaultPubkey,
    userWsolAta,
    delegate: delegatePubkey,
  };
}
