import {
  settle,
  computePenaltyLamports,
  getTimingEscrowClient,
  getVaultPda,
  TIMING_ESCROW_PROGRAM_ID,
  logSendTransactionError,
} from './api/timing_escrow_client.js';

globalThis.__timingEscrow = {
  settle,
  computePenaltyLamports,
  getTimingEscrowClient,
  getVaultPda,
  TIMING_ESCROW_PROGRAM_ID,
  logSendTransactionError,
};
