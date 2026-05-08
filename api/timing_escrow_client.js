
/**
 * timing_escrow browser client — Quasar on-chain layout (no Anchor).
 *
 * Settle instruction data: 1-byte discriminator + i64 `time_clicked` (see program `#[instruction(discriminator = 1)]`).
 * Deps: @solana/web3.js, @solana/spl-token, bs58
 */

import {
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";

/** Matches `declare_id!` in the on-chain program. */
export const TIMING_ESCROW_PROGRAM_ID = new PublicKey(
  "3PEthrNepy4UErzXeSAxpwrhvDMHUfKzitFQxSNdCvyu"
);

/** Matches `VAULT_SEED` in the on-chain program (`b\"vaultv6\"`). */
const VAULT_SEED = new TextEncoder().encode("vaultv6");

// --- SPL token reward (hardcoded to match on-chain) -------------------------

export const IQ_MINT = new PublicKey(
  "4UaBDZyPHayYz7UM32BtnwLNJ9nUZdSteJYty4hqoGmU"
);
// Alias used by `settle-entry.js`
export const IQ_REWARD_MINT = IQ_MINT;

export const VAULT_IQ_ATA = new PublicKey(
  "APt9xuuFp6qYSfSa2mavF9dkUhGRti5CSv2Vo6pr6gRX"
);

// Keep explicit IDs here to match on-chain checks.
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** Classic SPL ATA; matches on-chain `find_program_address` seeds. */
export function deriveAta(owner, mint) {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
}

/** Alias used by `settle-entry.js` / callers. */
export function getUserIqAta(userPubkey) {
  return deriveAta(userPubkey, IQ_MINT);
}
  
    
  
  
    
  
  function setI64LE(u8, offset, value) {
  
  const n = Number(value);
  
  if (!Number.isFinite(n)) {
  
  throw new Error(`setI64LE: expected finite number, got ${String(value)}`);
  
  }
  
  new DataView(u8.buffer, u8.byteOffset + offset, 8).setBigInt64(
  
  0,
  
  BigInt(Math.trunc(n)),
  
  true
  
  );
  
  }
  
    
  
  /** Matches Quasar `#[instruction(discriminator = 1)] settle(..., time_clicked: i64)`. */
  export function buildSettleInstructionData(timeClicked) {
  
  let ts = Math.trunc(Number(timeClicked));
  
  if (!Number.isFinite(ts)) {
  
  ts = Math.floor(Date.now() / 1000);
  
  }
  
  const data = new Uint8Array(9);
  
  data[0] = 1;
  
  setI64LE(data, 1, ts);
  
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
  
  // `true` often makes RPCs reject otherwise-valid wallet-signed legacy txs; `false` matches @solana/web3.js Connection.simulateTransaction default.
  
  sigVerify: opts.sigVerify ?? false,
  
  innerInstructions: true,
  
  // `true` avoids spurious sim failures when the embedded blockhash ages out before simulation.
  
  replaceRecentBlockhash: opts.replaceRecentBlockhash ?? true,
  
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

async function waitForSignatureConfirmedOrExpired(
  connection,
  signature,
  { lastValidBlockHeight, commitment = "confirmed", maxMs = 45_000 } = {}
) {
  const start = Date.now();
  let sleepMs = 900;
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
    if (st?.confirmationStatus === commitment || st?.slot != null) {
      return;
    }

    if (typeof lastValidBlockHeight === "number") {
      const h = await connection.getBlockHeight(commitment);
      if (h > lastValidBlockHeight) {
        throw new Error(
          `Signature ${signature} has expired: block height exceeded.`
        );
      }
    }

    await new Promise((r) => setTimeout(r, sleepMs));
    sleepMs = Math.min(2500, Math.floor(sleepMs * 1.25));
  }
  throw new Error(`Timed out waiting for ${signature} to confirm.`);
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
  
  * @param {{ timeClicked?: number, vault?: PublicKey }} opts
  
  */
  
  export async function settle(ctx, userPubkey, opts = {}) {
  
  let timeClicked =
  
  opts.timeClicked != null && opts.timeClicked !== ""
  
  ? Math.trunc(Number(opts.timeClicked))
  
  : Math.floor(Date.now() / 1000);
  
  if (!Number.isFinite(timeClicked)) {
  
  timeClicked = Math.floor(Date.now() / 1000);
  
  }
  
    
  
  const { connection, wallet, programId } = ctx;
  
  const vaultPubkey =
  
  opts.vault != null ? opts.vault : getVaultPda(programId)[0];
  
    
  
  /** User IQ ATA — must exist before settle (fund/create off-chain or add an ix). */
  
  const userAta = deriveAta(userPubkey, IQ_MINT);
  
    
  
  const ix = new TransactionInstruction({
  
  programId,
  
  keys: [
  
  { pubkey: userPubkey, isSigner: true, isWritable: true },
  
  { pubkey: vaultPubkey, isSigner: false, isWritable: true },
  
  { pubkey: VAULT_IQ_ATA, isSigner: false, isWritable: true },
  
  { pubkey: userAta, isSigner: false, isWritable: true },
  
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  
  ],
  
  data: buildSettleInstructionData(timeClicked),
  
  });
  
    
  
  const tx = new Transaction().add(ix);
  
  const { blockhash, lastValidBlockHeight } =
  
  await connection.getLatestBlockhash("confirmed");
  
  tx.feePayer = userPubkey;
  
  tx.recentBlockhash = blockhash;
  
  // Prefer wallet-native "sign and send" when available (Phantom exposes this).
  // This can reduce wallet security warnings vs custom raw sends.
  if (typeof wallet?.signAndSendTransaction === "function") {
    const out = await wallet.signAndSendTransaction(tx, {
      preflightCommitment: "processed",
      maxRetries: 3,
    });
    const signature = out?.signature || out;
    if (typeof signature !== "string") {
      throw new Error("Wallet signAndSendTransaction returned no signature");
    }
    await waitForSignatureConfirmedOrExpired(connection, signature, {
      lastValidBlockHeight,
      commitment: "confirmed",
      maxMs: 45_000,
    });
    console.log("settle tx:", signature);
    return { tx: signature, timeClicked };
  }

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
  
  // Let the RPC node retry forwarding (otherwise a valid tx can just never
  // propagate, and you'll "hang" until the blockhash window expires).
  skipPreflight: false,
  
  maxRetries: 3,
  
  preflightCommitment: "processed",
  
  });
  
  await waitForSignatureConfirmedOrExpired(connection, signature, {
    lastValidBlockHeight,
    commitment: "confirmed",
    maxMs: 45_000,
  });
  
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