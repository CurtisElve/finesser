import {
  settle,
  computePenaltyLamports,
  delay,
  getTimingEscrowClient,
  getVaultPda,
  POST_SIGN_SEND_DELAY_MS,
  TIMING_ESCROW_PROGRAM_ID,
  WIN_ELAPSED_MAX_SEC,
  WIN_REWARD_LAMPORTS,
} from "./api/timing_escrow_client.js";

globalThis.__timingEscrow = {
  settle,
  computePenaltyLamports,
  delay,
  getTimingEscrowClient,
  getVaultPda,
  POST_SIGN_SEND_DELAY_MS,
  TIMING_ESCROW_PROGRAM_ID,
  WIN_ELAPSED_MAX_SEC,
  WIN_REWARD_LAMPORTS,
};
