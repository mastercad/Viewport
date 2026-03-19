/**
 * syntax.test.js
 *
 * Prüft alle JS-Quelldateien im Renderer auf:
 *  1. Parse-Fehler (SyntaxError → Datei kann nicht geladen werden)
 *  2. Doppelt deklarierte Bezeichner auf Top-Level-Scope
 *     (= "Identifier 'X' has already been declared")
 *
 * Diese Fehler werden im Browser erst zur Laufzeit sichtbar und
 * werden von normalen Unit-Tests nicht gefunden, da diese nur
 * isolierte Logik-Module importieren.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parse } from 'acorn';

const ROOT = new URL('../src/renderer', import.meta.url).pathname;

function collectJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectJsFiles(full));
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const files = collectJsFiles(ROOT);

// ── Hilfsfunktion: Alle Top-Level-Bezeichner aus einem AST sammeln ──────────
function topLevelBindings(ast) {
  const seen = new Map(); // name → [loc, ...]
  for (const node of ast.body) {
    let names = [];
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'ClassDeclaration'
    ) {
      names = [node.id?.name];
    } else if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration
    ) {
      const d = node.declaration;
      if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') {
        names = [d.id?.name];
      } else if (d.type === 'VariableDeclaration') {
        names = d.declarations.map(v =>
          v.id.type === 'Identifier' ? v.id.name : null,
        );
      }
    } else if (node.type === 'VariableDeclaration') {
      names = node.declarations.map(v =>
        v.id.type === 'Identifier' ? v.id.name : null,
      );
    }
    for (const name of names) {
      if (!name) continue;
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push(node.start);
    }
  }
  return seen;
}

describe('Renderer-Quelldateien – Syntax & Duplikate', () => {
  for (const file of files) {
    const rel = relative(ROOT + '/..', file); // z.B. renderer/screenshot.js

    it(`${rel} – parsebar (kein SyntaxError)`, () => {
      const src = readFileSync(file, 'utf8');
      expect(
        () => parse(src, { ecmaVersion: 2022, sourceType: 'module' }),
        `SyntaxError beim Parsen von ${rel}`,
      ).not.toThrow();
    });

    it(`${rel} – keine doppelten Top-Level-Deklarationen`, () => {
      const src = readFileSync(file, 'utf8');
      let ast;
      try {
        ast = parse(src, { ecmaVersion: 2022, sourceType: 'module' });
      } catch {
        // Parse-Fehler wird bereits im Test oben erfasst
        return;
      }
      const bindings = topLevelBindings(ast);
      const duplicates = [];
      for (const [name, positions] of bindings) {
        if (positions.length > 1) duplicates.push(name);
      }
      expect(duplicates, `Doppelt deklariert in ${rel}: ${duplicates.join(', ')}`).toEqual([]);
    });
  }
});
