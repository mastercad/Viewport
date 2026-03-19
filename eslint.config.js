/**
 * ESLint 9 – Flat Config
 *
 * Umgebungen:
 *   src/main.js          → Node.js ESM (Electron-Hauptprozess)
 *   src/preload.js       → CommonJS  (Electron-Preload, hat Zugriff auf Node- + Browser-APIs)
 *   src/renderer/**      → Browser ESM
 *   tests/**             → Node.js ESM (Vitest, alle Abhängigkeiten explizit importiert)
 */

import js      from '@eslint/js';
import globals from 'globals';

export default [
  // ── Ignorierte Verzeichnisse ─────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // ── Basis-Regeln (gilt für alle Dateien) ──────────────────────────────────
  js.configs.recommended,

  // ── Globale Regelanpassungen ─────────────────────────────────────────────
  {
    rules: {
      // Unbenutzte Variablen als Warnung – _-Präfix ist bewusst ignoriert
      'no-unused-vars': ['warn', {
        varsIgnorePattern:        '^_',
        argsIgnorePattern:        '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // console.log in Prod-Code vermeiden, aber nicht als hard Error
      'no-console': 'warn',
      // Typische Fehlerquellen
      'no-constant-condition': 'error',
      'no-duplicate-imports':  'error',
      'no-self-compare':       'error',
      'eqeqeq':                ['error', 'always', { null: 'ignore' }],
    },
  },

  // ── Hauptprozess: Node.js ESM ────────────────────────────────────────────
  {
    files: ['src/main.js'],
    languageOptions: {
      ecmaVersion:  2022,
      sourceType:   'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },

  // ── Hauptprozess-Module (push-bridge etc.): Node.js ESM ─────────────────
  {
    files: ['src/push-bridge.js'],
    languageOptions: {
      ecmaVersion:  2022,
      sourceType:   'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },

  // ── Preload-Skripte: CommonJS (require + Browser-APIs via contextBridge) ──
  {
    files: ['src/preload.js', 'src/panel-preload.js', 'src/push-webview-preload.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // ── Panel-Renderer: Browser-Script (kein ESM, kein require) ──────────────
  {
    files: ['src/panel.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'script',
      globals: { ...globals.browser },
    },
  },

  // ── Renderer: Browser ESM ─────────────────────────────────────────────────
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'module',
      globals: {
        ...globals.browser,
        // Electron-Preload-Brücke
        ss: 'readonly',
      },
    },
  },

  // ── Tests: Node.js ESM (Vitest) – manche Tests laufen in happy-dom (Browser-APIs) ──
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // In Tests ist console.log ok
      'no-console': 'off',
    },
  },
];
