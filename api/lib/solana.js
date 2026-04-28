import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

export function getBurnerKeypair() {
  const key = process.env.BURNER_PRIVATE_KEY_BASE58;
  if (!key) throw new Error('Missing env: BURNER_PRIVATE_KEY_BASE58');
  return Keypair.fromSecretKey(bs58.decode(key));
}

export function getBurnerPublicKeyBase58() {
  return getBurnerKeypair().publicKey.toBase58();
}

export { PublicKey };