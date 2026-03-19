/**
 * Tests für utils.js
 *
 * normalizeUrl ist eine reine Funktion ohne Seiteneffekte,
 * ideal für umfassendes Unit-Testing.
 */

import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../src/renderer/utils.js';

describe('normalizeUrl', () => {
  // ── HTTPS / HTTP bereits vorhanden ────────────────────────────────────────

  it('lässt https:// URLs unverändert', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
    expect(normalizeUrl('https://example.com/page?q=1&lang=de')).toBe('https://example.com/page?q=1&lang=de');
  });

  it('lässt http:// URLs unverändert', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('http://example.com/api/v1')).toBe('http://example.com/api/v1');
  });

  it('ist case-insensitiv beim Schema-Check', () => {
    expect(normalizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
    expect(normalizeUrl('HTTP://example.com')).toBe('HTTP://example.com');
  });

  // ── Lokale Adressen → http:// ─────────────────────────────────────────────

  it('fügt http:// vor localhost ein', () => {
    expect(normalizeUrl('localhost')).toBe('http://localhost');
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeUrl('localhost:3000/app')).toBe('http://localhost:3000/app');
  });

  it('fügt http:// vor 127.x.x.x-Adressen ein', () => {
    expect(normalizeUrl('127.0.0.1')).toBe('http://127.0.0.1');
    expect(normalizeUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeUrl('127.0.0.1:8080/api')).toBe('http://127.0.0.1:8080/api');
  });

  it('fügt http:// vor privaten IP-Adressen ein', () => {
    expect(normalizeUrl('192.168.1.1')).toBe('http://192.168.1.1');
    expect(normalizeUrl('192.168.0.100:8080')).toBe('http://192.168.0.100:8080');
    expect(normalizeUrl('10.0.0.1')).toBe('http://10.0.0.1');
    expect(normalizeUrl('172.16.0.1')).toBe('http://172.16.0.1');
  });

  // ── Öffentliche Domains → https:// ───────────────────────────────────────

  it('fügt https:// vor einfachen Domains ein', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('google.com')).toBe('https://google.com');
  });

  it('fügt https:// vor Domains mit Pfad ein', () => {
    expect(normalizeUrl('example.com/path/to/page')).toBe('https://example.com/path/to/page');
    expect(normalizeUrl('example.com/search?q=test')).toBe('https://example.com/search?q=test');
  });

  it('fügt https:// vor Subdomains ein', () => {
    expect(normalizeUrl('sub.example.com')).toBe('https://sub.example.com');
    expect(normalizeUrl('api.my-service.io/v2')).toBe('https://api.my-service.io/v2');
  });

  it('fügt https:// vor Domains mit Port ein', () => {
    expect(normalizeUrl('example.com:8443')).toBe('https://example.com:8443');
    expect(normalizeUrl('example.com:8443/app')).toBe('https://example.com:8443/app');
  });
});
