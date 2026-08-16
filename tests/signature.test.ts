import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  parseSignatureHeader,
  REPLAY_TOLERANCE_SECONDS,
  resetNonces,
  signPayload,
  verifySignature,
} from '@/lib/security/signature';
import { ApiError } from '@/lib/core/errors';

const SECRET = 'whsec_test_key';
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkin.completed' });
const NOW = 1_800_000_000;

describe('Webhook 署名', () => {
  beforeEach(() => resetNonces());

  it('生成した署名を検証できる', () => {
    const { signature, nonce } = buildSignatureHeader({
      secret: SECRET,
      body: BODY,
      timestampSeconds: NOW,
    });

    expect(() =>
      verifySignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: signature,
        nonce,
        nowSeconds: NOW,
      })
    ).not.toThrow();
  });

  it('ボディが1文字でも違えば弾く', () => {
    const { signature, nonce } = buildSignatureHeader({
      secret: SECRET,
      body: BODY,
      timestampSeconds: NOW,
    });

    expect(() =>
      verifySignature({
        secret: SECRET,
        body: BODY + ' ',
        signatureHeader: signature,
        nonce,
        nowSeconds: NOW,
      })
    ).toThrowError(expect.objectContaining({ code: 'signature_invalid' }));
  });

  it('鍵が違えば弾く', () => {
    const { signature, nonce } = buildSignatureHeader({
      secret: SECRET,
      body: BODY,
      timestampSeconds: NOW,
    });

    expect(() =>
      verifySignature({
        secret: 'whsec_other',
        body: BODY,
        signatureHeader: signature,
        nonce,
        nowSeconds: NOW,
      })
    ).toThrowError(expect.objectContaining({ code: 'signature_invalid' }));
  });

  it('5分より古いタイムスタンプは replay として弾く', () => {
    const old = NOW - REPLAY_TOLERANCE_SECONDS - 1;
    const { signature, nonce } = buildSignatureHeader({
      secret: SECRET,
      body: BODY,
      timestampSeconds: old,
    });

    expect(() =>
      verifySignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: signature,
        nonce,
        nowSeconds: NOW,
      })
    ).toThrowError(expect.objectContaining({ code: 'replay_detected' }));
  });

  it('同じ nonce の再送は弾く', () => {
    const { signature, nonce } = buildSignatureHeader({
      secret: SECRET,
      body: BODY,
      timestampSeconds: NOW,
    });
    const params = {
      secret: SECRET,
      body: BODY,
      signatureHeader: signature,
      nonce,
      nowSeconds: NOW,
    };

    verifySignature(params);
    expect(() => verifySignature(params)).toThrowError(
      expect.objectContaining({ code: 'replay_detected' })
    );
  });

  it('署名ヘッダが無い・壊れている場合は弾く', () => {
    expect(() =>
      verifySignature({ secret: SECRET, body: BODY, signatureHeader: null, nonce: 'n' })
    ).toThrow(ApiError);
    expect(() =>
      verifySignature({ secret: SECRET, body: BODY, signatureHeader: 'garbage', nonce: 'n' })
    ).toThrow(ApiError);
  });

  it('署名対象は timestamp.nonce.body の連結', () => {
    const mac = signPayload({
      secret: SECRET,
      body: BODY,
      timestampSeconds: NOW,
      nonce: 'abc',
    });
    const header = buildSignatureHeader({
      secret: SECRET,
      body: BODY,
      timestampSeconds: NOW,
      nonce: 'abc',
    });
    expect(parseSignatureHeader(header.signature)).toEqual({ t: NOW, v1: mac });
  });
});
