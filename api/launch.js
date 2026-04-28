import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { createTokenLightning } from './lib/pumpportal.js';
import { getBurnerKeypair } from './lib/solana.js';
import { giftAllTokensToRecipient, returnRemainingSol } from './lib/transfer.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function launch(body) {
  try {
    const {
      fundingTxSignature,
      recipientPublicKey,
      buyAmountSol,
      tokenMetadata,
      slippage,
      priorityFee,
      pool,
      isMayhemMode,
    } = body || {};

    if (!fundingTxSignature) throw new Error('Missing fundingTxSignature');
    if (!recipientPublicKey) throw new Error('Missing recipientPublicKey');
    if (buyAmountSol === undefined) throw new Error('Missing buyAmountSol');
    if (!tokenMetadata?.uri || !tokenMetadata?.name || !tokenMetadata?.symbol) {
      throw new Error('Missing tokenMetadata {name,symbol,uri}');
    }

    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const burnerKeypair = getBurnerKeypair();
    const apiKey = process.env.PUMP_PORTAL_API_KEY;
    if (!apiKey) throw new Error('Missing env: PUMP_PORTAL_API_KEY');

    const recipientPubkey = new PublicKey(recipientPublicKey);
    const pumpCreationFeeSol = process.env.PUMP_CREATION_FEE_SOL || '0.021';
    const pumpExtraBufferSol = process.env.PUMP_EXTRA_BUFFER_SOL || '0.002';
    const pumpCreationFeeLamports = Math.floor(Number(pumpCreationFeeSol) * LAMPORTS_PER_SOL);
    const pumpExtraBufferLamports = Math.floor(Number(pumpExtraBufferSol) * LAMPORTS_PER_SOL);
    const buyLamports = Math.floor(Number(buyAmountSol) * LAMPORTS_PER_SOL);
    const totalRequiredLamports = buyLamports + pumpCreationFeeLamports + pumpExtraBufferLamports;

    // Wait for funding tx to appear on RPC
    const tx = await connection.getTransaction(fundingTxSignature, { maxSupportedTransactionVersion: 0 });
    if (!tx) {
      let found = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const t = await connection.getTransaction(fundingTxSignature, { maxSupportedTransactionVersion: 0 });
        if (t) { found = true; break; }
      }
      if (!found) throw new Error('Funding tx not found/confirmed on RPC yet.');
    }

    // Wait for burner balance to be sufficient
    let burnerBalance = await connection.getBalance(burnerKeypair.publicKey, 'confirmed');
    for (let i = 0; i < 20; i++) {
      if (burnerBalance >= totalRequiredLamports) break;
      await new Promise((r) => setTimeout(r, 500));
      burnerBalance = await connection.getBalance(burnerKeypair.publicKey, 'confirmed');
    }
    if (burnerBalance < totalRequiredLamports) {
      throw new Error(
        'Burner wallet balance is still too low to launch. Required ' +
        (totalRequiredLamports / LAMPORTS_PER_SOL).toFixed(4) + ' SOL, burner has ' +
        (burnerBalance / LAMPORTS_PER_SOL).toFixed(4) + ' SOL.'
      );
    }

    const mintKeypair = Keypair.generate();
    const createResp = await createTokenLightning({
      apiKey,
      tokenMetadata,
      mintKeypair,
      amountSol: Number(buyAmountSol / 3).toFixed(4), 
      slippage,
      priorityFee,
      pool,
      isMayhemMode,
    });

    const createSignature = createResp.signature || createResp.txSignature || createResp.result?.signature;
    if (!createSignature) throw new Error('PumpPortal create response missing signature');

    console.log('--- Waiting for Create TX to Confirm ---');
    console.log(`  Signature: ${createSignature}`);

    // Confirm the create tx on our RPC before doing anything else
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction(
      {
        signature: createSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      'confirmed'
    );
    console.log('  Create TX confirmed.');

    // Cold-start buffer: PumpFun token account state can lag behind even after
    // the tx is confirmed on our RPC node. This prevents the gifting poll from
    // burning all its attempts on a state that isn't visible yet.
    console.log('  Waiting 3s for PumpFun state to settle...');
    await new Promise((r) => setTimeout(r, 3000));

    const mintPubkey = mintKeypair.publicKey;

    console.log('--- Discovering Token Account ---');
    console.log(`  Mint Address:  ${mintPubkey.toBase58()}`);
    console.log(`  Owner Wallet:  ${burnerKeypair.publicKey.toBase58()}`);
    console.log('---------------------------------');

    const giftSignature = await giftAllTokensToRecipient({
      connection,
      burnerKeypair,
      mintPubkey,
      recipientPubkey,
    });

    const solReturnSignature = await returnRemainingSol({
      connection,
      burnerKeypair,
      recipientPubkey,
    });

    return Response.json({
      burnerPublicKey: burnerKeypair.publicKey.toBase58(),
      mintAddress: mintPubkey.toBase58(),
      createSignature,
      giftSignature: giftSignature || null,
      solReturnSignature: solReturnSignature || null,
    });
  } catch (e) {
    return Response.json({ error: e?.message || String(e) }, { status: 500 });
  }
}