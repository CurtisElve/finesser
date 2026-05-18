import {
  settle,
  computePenaltyLamports,
  getTimingEscrowClient,
  getVaultPda,
  TIMING_ESCROW_PROGRAM_ID,
  WIN_ELAPSED_MAX_SEC,
  WIN_REWARD_LAMPORTS,
} from "./api/timing_escrow_client.js";

globalThis.__timingEscrow = {
  settle,
  computePenaltyLamports,
  getTimingEscrowClient,
  getVaultPda,
  TIMING_ESCROW_PROGRAM_ID,
  WIN_ELAPSED_MAX_SEC,
  WIN_REWARD_LAMPORTS,
};
