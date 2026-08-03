/**
 * viem-backed signer. The key lives in the user's environment on the user's machine and
 * is used for exactly one thing: signing EIP-3009 transfer authorizations for the
 * amount the server quoted.
 */
import { privateKeyToAccount } from 'viem/accounts';
import type { Signer } from '@yearbook2026/client';

export function viemSigner(privateKey: string): Signer {
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  return {
    address: account.address,
    async signTransferAuthorization(input) {
      return account.signTypedData({
        // USDC's EIP-712 domain, as the server published it. The name differs by
        // network ("USD Coin" on Base, "USDC" on Base Sepolia), so it is never
        // hardcoded here — a wrong domain is an invalid signature.
        domain: {
          name: input.domainName,
          version: input.domainVersion,
          chainId: input.chainId,
          verifyingContract: input.verifyingContract as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: input.from as `0x${string}`,
          to: input.to as `0x${string}`,
          value: BigInt(input.value),
          validAfter: BigInt(input.validAfter),
          validBefore: BigInt(input.validBefore),
          nonce: input.nonce as `0x${string}`,
        },
      });
    },
  };
}
