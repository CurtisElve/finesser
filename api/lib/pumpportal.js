import bs58 from 'bs58';

export async function createTokenLightning({ apiKey, tokenMetadata, mintKeypair, amountSol, slippage, priorityFee, pool, isMayhemMode }) {
  if (!apiKey) throw new Error('Missing env/api key for PumpPortal');
  if (!tokenMetadata?.name || !tokenMetadata?.symbol || !tokenMetadata?.uri) {
    throw new Error('tokenMetadata must include name, symbol, uri');
  }

  const resp = await fetch(`https://pumpportal.fun/api/trade?api-key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      tokenMetadata: {
        name: tokenMetadata.name,
        symbol: tokenMetadata.symbol,
        uri: tokenMetadata.uri,
      },
      mint: bs58.encode(mintKeypair.secretKey),
      denominatedInSol: 'true',
      amount: amountSol,
      slippage: slippage ?? 10,
      priorityFee: priorityFee ?? 0.0005,
      pool: pool ?? 'pump',
      isMayhemMode: isMayhemMode ?? 'false',
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.signature) {
    const errText = data?.errors?.[0] || data?.error || resp.statusText || 'Unknown PumpPortal error';
    throw new Error('PumpPortal create failed: ' + errText);
  }
  return data;
}