/**
 * timing_escrow browser client — Quasar on-chain layout (no Anchor).
 *
 * Instruction data: 1-byte discriminator + little-endian fixed args (see program `#[instruction]`).
 * Deps: @solana/web3.js, bs58
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import bs58 from "bs58";

const DEFAULT_TIMING_ESCROW_PROGRAM =
  "3PEthrNepy4UErzXeSAxpwrhvDMHUfKzitFQxSNdCvyu";

/** Matches `declare_id!` in `draingang/src/lib.rs`; override with `TIMING_ESCROW_PROGRAM_ID` in `.env` (also used at `bun run build:settle` for the browser bundle). */
function readTimingEscrowProgramId() {
  try {
    const raw =
      typeof process !== "undefined" &&
      process.env &&
      process.env.TIMING_ESCROW_PROGRAM_ID &&
      String(process.env.TIMING_ESCROW_PROGRAM_ID).trim();
    if (raw) return new PublicKey(raw);
  } catch {
    /* invalid env — fall back */
  }
  return new PublicKey(DEFAULT_TIMING_ESCROW_PROGRAM);
}

export const TIMING_ESCROW_PROGRAM_ID = readTimingEscrowProgramId();

/** Matches `VAULT_SEED` in `draingang/src/lib.rs`. */
const VAULT_SEED = new TextEncoder().encode("vaultv6");

function setU64LE(u8, offset, value) {
  new DataView(u8.buffer, u8.byteOffset + offset, 8).setBigUint64(
    0,
    BigInt(value),
    true
  );
}

function setI64LE(u8, offset, value) {
  new DataView(u8.buffer, u8.byteOffset + offset, 8).setBigInt64(
    0,
    BigInt(value),
    true
  );
}

export function buildSettleInstructionData(timeClicked, costLamports) {
  const data = new Uint8Array(17);
  data[0] = 1;
  setI64LE(data, 1, timeClicked);
  setU64LE(data, 9, costLamports);
  return data;
}

// ─── Connection / wallet context ───────────────────────────────────────────

/**
 * @param {string} cluster - `mainnet-beta` | `devnet` | `testnet` | `localnet`
 * @param {string} [rpcOverride] - full HTTP(S) RPC URL; wins over defaults
 */
export function clusterRpcEndpoint(cluster, rpcOverride) {
  if (rpcOverride) {
    return rpcOverride;
  }
  if (cluster === "localnet") {
    return "http://127.0.0.1:8899";
  }
  return clusterApiUrl(cluster);
}

function clusterApiUrl(cluster) {
  const endpoints = {
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
    devnet: "https://api.devnet.solana.com",
    testnet: "https://api.testnet.solana.com",
  };
  const u = endpoints[cluster];
  if (!u) {
    throw new Error(`Unknown cluster for RPC: ${cluster}`);
  }
  return u;
}

/**
 * @param {{ publicKey: PublicKey, signTransaction: (tx: Transaction) => Promise<Transaction> }} wallet
 * @param {string} [cluster]
 * @param {string} [rpcOverride]
 * @returns {{ connection: Connection, wallet: typeof wallet, programId: PublicKey }}
 */
export function getTimingEscrowClient(
  wallet,
  cluster = "mainnet-beta",
  rpcOverride
) {
  const connection = new Connection(
    clusterRpcEndpoint(cluster, rpcOverride),
    "confirmed"
  );
  return {
    connection,
    wallet,
    programId: TIMING_ESCROW_PROGRAM_ID,
  };
}

/**
 * @param {PublicKey} programId
 * @returns {[PublicKey, number]}
 */
export function getVaultPda(programId) {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId);
}

export function keypairFromVaultJson(json) {
  const arr = typeof json === "string" ? JSON.parse(json) : json;
  if (!Array.isArray(arr) || arr.length < 64) {
    throw new Error(
      "vault.json must be a JSON array of 64 bytes (solana-keygen format)"
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export const TX_HEADROOM_LAMPORTS = 250_000;

/**
 * @param {Connection} connection
 * @param {PublicKey} userPubkey
 * @param {PublicKey} vaultPubkey
 */
export async function computePenaltyLamports(
  connection,
  userPubkey,
  vaultPubkey
) {
  const [balanceLamports, vaultInfo, userAcct] = await Promise.all([
    connection.getBalance(userPubkey),
    connection.getAccountInfo(vaultPubkey),
    connection.getAccountInfo(userPubkey),
  ]);
  const dataLen = userAcct?.data?.length ?? 0;
  const rentMinLamports = await connection.getMinimumBalanceForRentExemption(
    dataLen
  );
  const reserveLamports = TX_HEADROOM_LAMPORTS + rentMinLamports;
  const costLamports = Math.max(
    0,
    Math.floor(balanceLamports - reserveLamports)
  );
  return {
    costLamports,
    balanceLamports,
    reserveLamports,
    rentMinLamports,
    vaultExists: vaultInfo != null,
    vaultLamports: vaultInfo ? vaultInfo.lamports : 0,
  };
}

function uint8ToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 1) {
    bin += String.fromCharCode(u8[i]);
  }
  return btoa(bin);
}

export async function simulateSerializedTransaction(
  connection,
  serializedTx,
  opts = {}
) {
  const commitment = opts.commitment ?? connection.commitment ?? "confirmed";
  /** @type {Record<string, unknown>} */
  const params = {
    encoding: "base64",
    commitment,
    sigVerify: true,
    innerInstructions: true,
    replaceRecentBlockhash: false,
  };
  if (opts.accountAddresses?.length) {
    params.accounts = {
      encoding: "base64",
      addresses: opts.accountAddresses,
    };
  }

  const res = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [uint8ToBase64(serializedTx), params],
    }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = String(json.error.message ?? "");
    if (/already\s+been\s+processed|AlreadyProcessed/i.test(msg)) {
      const e = new Error(msg);
      e.duplicateOrProcessed = true;
      throw e;
    }
    console.error("[timing_escrow] simulateTransaction RPC error:", json.error);
    throw new Error(msg || JSON.stringify(json.error, null, 2));
  }
  return json.result;
}

export function logSimulationVerbose(label, result) {
  const slot = result?.context?.slot;
  const v = result?.value;
  if (!v) {
    console.warn(`[timing_escrow simulation] ${label}: empty result`, result);
    return;
  }

  console.group(`[timing_escrow simulation] ${label}`);
  console.log("slot:", slot ?? "(n/a)");
  console.log("err:", v.err ?? null);
  console.log("unitsConsumed:", v.unitsConsumed ?? "(n/a)");
  if (v.returnData != null) {
    console.log("returnData:", v.returnData);
  }
  if (Array.isArray(v.logs) && v.logs.length) {
    console.log("--- program logs ---");
    v.logs.forEach((line, i) => {
      console.log(`${String(i).padStart(3, " ")} | ${line}`);
    });
  } else {
    console.log("logs: (none)");
  }
  if (Array.isArray(v.innerInstructions) && v.innerInstructions.length) {
    console.log("--- inner instructions ---");
    console.log(JSON.stringify(v.innerInstructions, null, 2));
  }
  if (Array.isArray(v.accounts) && v.accounts.length) {
    console.log("--- accounts (post-simulation, requested addresses only) ---");
    v.accounts.forEach((a, i) => {
      if (a == null) {
        console.log(`[${i}] null`);
        return;
      }
      console.log(`[${i}]`, {
        lamports: a.lamports,
        owner: a.owner,
        executable: a.executable,
        rentEpoch: a.rentEpoch,
        dataLen:
          a.data?.length ?? (Array.isArray(a.data) ? a.data[0]?.length : 0),
      });
    });
  }
  console.groupEnd();
}

function simulationFailureSummary(value) {
  const errStr =
    value?.err != null ? JSON.stringify(value.err) : "unknown error";
  const tail =
    Array.isArray(value?.logs) && value.logs.length
      ? value.logs.slice(-12).join("\n")
      : "(no logs)";
  return `${errStr}\n--- last log lines ---\n${tail}`;
}

export function signatureFromLegacyWire(rawBytes) {
  const u8 =
    rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  const parsed = Transaction.from(u8);
  const sigBuf = parsed.signature;
  if (!sigBuf) {
    throw new Error("Could not read fee-payer signature from serialized tx");
  }
  return bs58.encode(sigBuf);
}

function looksLikeAlreadyProcessedErr(err) {
  const parts = [
    err?.message,
    err?.transactionMessage,
    typeof err === "string" ? err : null,
    JSON.stringify(err?.err ?? err?.value?.err ?? err),
  ].filter(Boolean);
  const s = parts.join(" ");
  return (
    /already\s+been\s+processed/i.test(s) ||
    /AlreadyProcessed/i.test(s) ||
    s.includes('"AlreadyProcessed"')
  );
}

function looksLikeAlreadyProcessedSimValue(value) {
  if (value == null) return false;
  const fromErr = JSON.stringify(value.err ?? "");
  if (/AlreadyProcessed/i.test(fromErr)) return true;
  if (Array.isArray(value.logs)) {
    const logText = value.logs.join("\n");
    if (/already\s+been\s+processed/i.test(logText)) return true;
  }
  return false;
}

export async function signatureSeenOnCluster(connection, signature) {
  const { value } = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const st = value[0];
  if (st == null) return false;
  if (st.err) return false;
  return st.slot != null;
}

export async function waitForSignatureSettled(
  connection,
  signature,
  maxMs = 60_000
) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = value[0];
    if (st?.err) {
      throw new Error(
        `Signature ${signature} on-chain failed: ${JSON.stringify(st.err)}`
      );
    }
    if (st?.slot != null) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timed out waiting for ${signature} after duplicate / already-processed.`
  );
}

export async function logSendTransactionError(err, connection) {
  console.log("ERROR:", err?.message);

  if (err instanceof SendTransactionError) {
    const txErr = err.transactionError;
    logSimulationVerbose("send / preflight (from error)", {
      context: { slot: undefined },
      value: {
        err: txErr.message,
        logs: txErr.logs ?? null,
        unitsConsumed: undefined,
        accounts: undefined,
        innerInstructions: undefined,
      },
    });
    if (connection && (!txErr.logs || !txErr.logs.length)) {
      try {
        const full = await err.getLogs(connection);
        if (full?.length) console.log("LOGS (getLogs):", full);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const inline =
    err?.logs ?? err?.transactionLogs ?? err?.simulationResponse?.logs;
  if (
    Array.isArray(inline) &&
    inline.length &&
    !(err instanceof SendTransactionError)
  ) {
    console.log("LOGS:", inline);
    return;
  }
  if (connection && typeof err?.getLogs === "function") {
    try {
      const full = await err.getLogs(connection);
      if (full?.length) console.log("LOGS (getLogs):", full);
    } catch {
      console.log("LOGS: (unavailable — simulation may have no signature yet)");
    }
  }
}

/**
 * @param {{ connection: Connection, wallet: { publicKey: PublicKey, signTransaction: (tx: Transaction) => Promise<Transaction> }, programId: PublicKey }} ctx
 * @param {PublicKey} userPubkey
 * @param {{ costLamports: number, timeClicked?: number, vault?: PublicKey }} opts
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

  const raw = signed.serialize();
  const rawBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

  let signature;
  try {
    let simResult;
    try {
      simResult = await simulateSerializedTransaction(connection, rawBytes, {
        commitment: "confirmed",
        accountAddresses: [
          userPubkey.toBase58(),
          vaultPubkey.toBase58(),
          programId.toBase58(),
        ],
      });
    } catch (simErr) {
      if (simErr?.duplicateOrProcessed) {
        signature = signatureFromLegacyWire(rawBytes);
        if (await signatureSeenOnCluster(connection, signature)) {
          console.warn(
            "[timing_escrow] simulate RPC reported duplicate; signature already on cluster:",
            signature
          );
          await waitForSignatureSettled(connection, signature);
        } else {
          console.warn(
            "[timing_escrow] simulate RPC duplicate noise; sending once with skipPreflight"
          );
          signature = signatureFromLegacyWire(rawBytes);
          try {
            await connection.sendRawTransaction(rawBytes, {
              skipPreflight: true,
              maxRetries: 0,
            });
            await connection.confirmTransaction(
              { signature, blockhash, lastValidBlockHeight },
              "confirmed"
            );
          } catch (sendErr) {
            if (looksLikeAlreadyProcessedErr(sendErr)) {
              await waitForSignatureSettled(connection, signature);
            } else {
              throw sendErr;
            }
          }
        }
        console.log("settle tx:", signature);
        return { tx: signature, timeClicked };
      }
      throw simErr;
    }

    logSimulationVerbose("settle (pre-send)", simResult);

    if (
      simResult.value.err &&
      looksLikeAlreadyProcessedSimValue(simResult.value)
    ) {
      signature = signatureFromLegacyWire(rawBytes);
      if (await signatureSeenOnCluster(connection, signature)) {
        console.warn(
          "[timing_escrow] simulation value err AlreadyProcessed; tx already landed:",
          signature
        );
        await waitForSignatureSettled(connection, signature);
      } else {
        signature = signatureFromLegacyWire(rawBytes);
        try {
          await connection.sendRawTransaction(rawBytes, {
            skipPreflight: true,
            maxRetries: 0,
          });
          await connection.confirmTransaction(
            { signature, blockhash, lastValidBlockHeight },
            "confirmed"
          );
        } catch (sendErr) {
          if (looksLikeAlreadyProcessedErr(sendErr)) {
            await waitForSignatureSettled(connection, signature);
          } else {
            throw sendErr;
          }
        }
      }
      console.log("settle tx:", signature);
      return { tx: signature, timeClicked };
    }

    if (simResult.value.err) {
      throw new Error(
        `Simulation failed before send:\n${simulationFailureSummary(
          simResult.value
        )}`
      );
    }

    try {
      signature = await connection.sendRawTransaction(rawBytes, {
        skipPreflight: true,
        maxRetries: 0,
      });
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
    } catch (sendErr) {
      if (looksLikeAlreadyProcessedErr(sendErr)) {
        signature = signatureFromLegacyWire(rawBytes);
        await waitForSignatureSettled(connection, signature);
      } else {
        throw sendErr;
      }
    }
  } catch (err) {
    await logSendTransactionError(err, connection);
    throw err;
  }

  console.log("settle tx:", signature);
  return { tx: signature, timeClicked };
}
