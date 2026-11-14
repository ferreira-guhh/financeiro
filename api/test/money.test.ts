import { describe, expect, it } from 'vitest';
import { computeFingerprint, normalizeDescription } from '../src/lib/fingerprint.js';
import { fromCents, normalizeMoney, sumMoney, toCents } from '../src/lib/money.js';

describe('money', () => {
  it('converte string ↔ centavos sem float', () => {
    expect(toCents('0.1') + toCents('0.2')).toBe(30n);
    expect(fromCents(toCents('0.1') + toCents('0.2'))).toBe('0.30');
    expect(toCents('-12.5')).toBe(-1250n);
    expect(fromCents(-1n)).toBe('-0.01');
    expect(normalizeMoney('-0')).toBe('0.00');
    expect(normalizeMoney('9999999999999.99')).toBe('9999999999999.99');
  });

  it('soma muitos valores de forma exata', () => {
    expect(sumMoney(Array.from({ length: 1000 }, () => '0.10'))).toBe('100.00');
  });

  it('rejeita formatos ambíguos', () => {
    for (const bad of ['1,50', '1.505', '1e3', '', 'abc', '.5', '1.']) {
      expect(() => toCents(bad)).toThrow();
    }
  });
});

describe('fingerprint', () => {
  const base = {
    accountId: '7b0a3a7e-6c8e-4a5e-9a3a-1f2b3c4d5e6f',
    date: '2026-11-08',
    amount: '-45.90',
    rawDescription: 'Pagamento iFood',
  };

  it('normaliza acentos, caixa e espaços', () => {
    expect(normalizeDescription('  Padaria   São  João ')).toBe('PADARIA SAO JOAO');
  });

  it('é determinístico e insensível a variações cosméticas', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, amount: '-45.9', rawDescription: 'PAGAMENTO  IFOOD' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('distingue sinal, data, conta e ocorrência', () => {
    const a = computeFingerprint(base);
    expect(computeFingerprint({ ...base, amount: '45.90' })).not.toBe(a);
    expect(computeFingerprint({ ...base, date: '2026-11-09' })).not.toBe(a);
    expect(computeFingerprint({ ...base, occurrence: 1 })).not.toBe(a);
    expect(computeFingerprint({ ...base, occurrence: 0 })).toBe(a);
  });
});
