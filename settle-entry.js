import {
  settle,
  computePenaltyLamports,
  getTimingEscrowClient,
  getVaultPda,
  getUserIqAta,
  IQ_REWARD_MINT,
  VAULT_IQ_ATA,
  TIMING_ESCROW_PROGRAM_ID,
  logSendTransactionError,
} from './api/timing_escrow_client.js';

globalThis.__timingEscrow = {
  settle,
  computePenaltyLamports,
  getTimingEscrowClient,
  getVaultPda,
  getUserIqAta,
  IQ_REWARD_MINT,
  VAULT_IQ_ATA,
  TIMING_ESCROW_PROGRAM_ID,
  logSendTransactionError,
};
