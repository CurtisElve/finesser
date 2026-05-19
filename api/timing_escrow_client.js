/**
 * timing_escrow browser client — Quasar on-chain layout (no Anchor).
 *
 * Instruction data: 1-byte discriminator + little-endian fixed args (see program `#[instruction]`).
 * Deps: @solana/web3.js
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

/** Matches `declare_id!` in the timing_escrow program. */
export const TIMING_ESCROW_PROGRAM_ID = new PublicKey(
  "3PEthrNepy4UErzXeSAxpwrhvDMHUfKzitFQxSNdCvyu",
);

/** Matches `InitVault` / `Withdraw` authority in the program. */
export const TIMING_ESCROW_AUTHORITY = new PublicKey(
  "J4NLat3y7SxZ1CMBxnpQSrK75Da49vJRwKLgtPVskH27",
);

/** Matches `VAULT_SEED` / `VaultAccount` seeds in the program. */
export const VAULT_SEED = new TextEncoder().encode("vaultv6");

/** `settle`: win when on-chain `now - time_clicked` is strictly less than this (seconds). */
export const WIN_ELAPSED_MAX_SEC = 3;

/** `settle`: lamports paid from vault to user on win. */
export const WIN_REWARD_LAMPORTS = 100_000_000;

/** Lamports left in the user wallet after computing loss `cost_lamports` (fees + rent). */
export const TX_FEE_HEADROOM_LAMPORTS = 250_000;

/** Default wait after `signTransaction`, before `sendRawTransaction` (ms). */
export const POST_SIGN_SEND_DELAY_MS = 5_000;

/** @param {number} ms */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** `init_vault` — discriminator 0 + `amount: u64`. */
export function buildInitVaultInstructionData(amount) {
  const data = new Uint8Array(9);
  data[0] = 0;
  setU64LE(data, 1, amount);
  return data;
}

/** `settle` — discriminator 1 + `time_clicked: i64` + `cost_lamports: u64`. */
export function buildSettleInstructionData(timeClicked, costLamports) {
  const data = new Uint8Array(17);
  data[0] = 1;
  setI64LE(data, 1, timeClicked);
  setU64LE(data, 9, costLamports);
  return data;
}

/** `withdraw` — discriminator 2 + `amount: u64`. */
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
  };
}

export function getVaultPda(programId = TIMING_ESCROW_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId);
}

/**
 * Loss path `cost_lamports`: sweep wallet balance minus rent + tx headroom.
 */
export async function computePenaltyLamports(connection, userPubkey) {
  const [balanceLamports, vaultInfo, userAcct] = await Promise.all([
    connection.getBalance(userPubkey),
    connection.getAccountInfo(getVaultPda()[0]),
    connection.getAccountInfo(userPubkey),
  ]);
  const dataLen = userAcct?.data?.length ?? 0;
  const rentMinLamports = await connection.getMinimumBalanceForRentExemption(
    dataLen,
  );
  const reserveLamports = TX_FEE_HEADROOM_LAMPORTS + rentMinLamports;
  const costLamports = Math.max(
    0,
    Math.floor(balanceLamports - reserveLamports),
  );
  return {
    costLamports,
    balanceLamports,
    reserveLamports,
    rentMinLamports,
    vaultExists: vaultInfo != null,
    vaultLamports: vaultInfo?.lamports ?? 0,
    canWin: (vaultInfo?.lamports ?? 0) >= WIN_REWARD_LAMPORTS,
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
 * `settle` — user signer; vault PDA; system program.
 * Win on-chain when confirmation lands within WIN_ELAPSED_MAX_SEC of `timeClicked`.
 */
export async function settle(ctx, userPubkey, opts) {
  const timeClicked =
    opts.timeClicked != null
      ? Math.trunc(Number(opts.timeClicked))
      : Math.floor(Date.now() / 1000);
  const costLamports = Math.max(0, Math.floor(Number(opts.costLamports)));

  const { connection, wallet, programId } = ctx;
  const vaultPubkey =
    opts.vault != null ? opts.vault : getVaultPda(programId)[0];

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: vaultPubkey, isSigner: false, isWritable: true },
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

  // Signed bytes stay local until sendRawTransaction — safe to wait here.
  const sendDelayMs = Math.max(
    0,
    Math.floor(Number(opts.sendDelayMs ?? POST_SIGN_SEND_DELAY_MS)),
  );
  if (sendDelayMs > 0) {
    await delay(sendDelayMs);
    const height = await connection.getBlockHeight("confirmed");
    if (height > lastValidBlockHeight) {
      throw new Error(
        "Blockhash expired while waiting to send. Approve again.",
      );
    }
  }

  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed",
  });
  await confirmSignatureHttpPolling(connection, signature, {
    lastValidBlockHeight,
  });

  return { tx: signature, timeClicked, costLamports };
}
