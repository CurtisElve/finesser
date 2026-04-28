import { PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { getConnection, getBurnerKeypair } from './lib/solana.js';
import {
  scanBurnerTokenAccountsOnce,
  buildPartialSignedCoSignedGiftTransaction,
  formatTokenUiAmount,
} from './lib/transfer.js';

function mintStr() {
  const s = process.env.AIRDROP_TOKEN_ADDRESS;
  return s && s.trim() ? s.trim() : null;
}

function displayNameFromEnv() {
  const n = process.env.AIRDROP_TOKEN_DISPLAY_NAME;
  const sym = process.env.AIRDROP_TOKEN_DISPLAY_SYMBOL;
  return {
    name: n && n.trim() ? n.trim() : null,
    symbol: sym && sym.trim() ? sym.trim() : null,
  };
}

/** GET — quick snapshot for the claim modal (one RPC pass). */
export async function airdropPreview() {
  const mintAddress = mintStr();
  if (!mintAddress) {
    return Response.json({ error: 'Server missing AIRDROP_TOKEN_ADDRESS' }, { status: 500 });
  }

  let mintPubkey;
  try {
    mintPubkey = new PublicKey(mintAddress);
  } catch {
    return Response.json({ error: 'Invalid AIRDROP_TOKEN_ADDRESS' }, { status: 500 });
  }

  let burnerKeypair;
  try {
    burnerKeypair = getBurnerKeypair();
  } catch (e) {
    return Response.json({ error: e?.message || 'Invalid BURNER_PRIVATE_KEY_BASE58' }, { status: 500 });
  }

  const connection = getConnection();
  const found = await scanBurnerTokenAccountsOnce(connection, burnerKeypair, mintPubkey);
  const envDisplay = displayNameFromEnv();

  if (!found) {
    return Response.json({
      available: false,
      mint: mintAddress,
      name: envDisplay.name,
      symbol: envDisplay.symbol,
      message: 'No balance detected on the burner for this mint yet. Try again in a moment.',
    });
  }

  const mintInfo = await getMint(connection, mintPubkey, 'confirmed', found.sourceTokenProgramId);
  const decimals = mintInfo.decimals;
  const amountRaw = found.sourceAccount.amount.toString();
  const amountUi = formatTokenUiAmount(found.sourceAccount.amount, decimals);
  const tokenProgramKind = found.sourceTokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'token2022' : 'spl-token';

  return Response.json({
    available: true,
    mint: mintAddress,
    decimals,
    amountRaw,
    amountUi,
    tokenProgram: tokenProgramKind,
    name: envDisplay.name,
    symbol: envDisplay.symbol,
    summary:
      (envDisplay.symbol || envDisplay.name
        ? `You are receiving ${amountUi} ${envDisplay.symbol || envDisplay.name || 'tokens'}.`
        : `You are receiving ${amountUi} tokens.`) +
      ' Approve in Phantom to pay network fees and (if needed) token account rent.',
  });
}

/** POST body: { recipientPublicKey: string } — partially signed tx for Phantom co-sign. */
export async function airdropPreparePartial(body) {
  const recipient = body?.recipientPublicKey;
  if (!recipient || typeof recipient !== 'string') {
    return Response.json({ error: 'recipientPublicKey is required' }, { status: 400 });
  }

  const mintAddress = mintStr();
  if (!mintAddress) {
    return Response.json({ error: 'Server missing AIRDROP_TOKEN_ADDRESS' }, { status: 500 });
  }

  let recipientPubkey;
  try {
    recipientPubkey = new PublicKey(recipient);
  } catch {
    return Response.json({ error: 'Invalid recipientPublicKey' }, { status: 400 });
  }

  let mintPubkey;
  try {
    mintPubkey = new PublicKey(mintAddress);
  } catch {
    return Response.json({ error: 'Invalid AIRDROP_TOKEN_ADDRESS' }, { status: 500 });
  }

  const connection = getConnection();
  let burnerKeypair;
  try {
    burnerKeypair = getBurnerKeypair();
  } catch (e) {
    return Response.json({ error: e?.message || 'Missing or invalid BURNER_PRIVATE_KEY_BASE58' }, { status: 500 });
  }

  try {
    const built = await buildPartialSignedCoSignedGiftTransaction({
      connection,
      burnerKeypair,
      mintPubkey,
      recipientPubkey,
    });

    if (built == null) {
      return Response.json({ error: 'Nothing to send: burner balance is zero' }, { status: 400 });
    }

    const envDisplay = displayNameFromEnv();

    return Response.json({
      transactionBase64: built.transactionBase64,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      mint: built.mint,
      amountUi: built.amountUi,
      amountRaw: built.amountRaw,
      decimals: built.decimals,
      tokenProgram: built.tokenProgram,
      name: envDisplay.name,
      symbol: envDisplay.symbol,
    });
  } catch (e) {
    console.error('airdropPreparePartial:', e);
    return Response.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
