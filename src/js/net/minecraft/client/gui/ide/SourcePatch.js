// The IDE lets you edit a game file directly. A .jph cannot ship file contents:
// each entry is a script that runs against that file's live module namespace
// (see ModulePatcher), so the only edits a patch can express are ones that
// re-assign something reachable from `exports`.
//
// This module turns source edits into exactly that. It diffs a file's classes
// member by member and writes the assignments that reproduce your change on the
// running game, plus a cleanup function that puts the originals back.
//
// Pure JavaScript: no DOM, no Vite and no module loading, so it is unit-testable
// from Node and reusable outside the browser.

const PAIRS = { '(': ')', '[': ']', '{': '}' };
const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;

function isIdentifierPart(character) {
    return !!character && IDENTIFIER_PART.test(character);
}

// Replaces the contents of strings, template literals and comments with spaces,
// keeping every index and newline intact, so braces in them stop counting
// towards nesting. Braces inside ${...} are masked too, which keeps the count
// balanced for the common case.
function maskSource(source) {
    const masked = source.split('');
    let state = null;
    let quote = '';

    for (let i = 0; i < source.length; i++) {
        const character = source[i];
        const next = source[i + 1];

        if (state === 'line') {
            if (character === '\n') state = null;
            else masked[i] = ' ';
            continue;
        }

        if (state === 'block') {
            if (character === '*' && next === '/') {
                masked[i] = ' ';
                masked[i + 1] = ' ';
                i++;
                state = null;
            } else if (character !== '\n') {
                masked[i] = ' ';
            }
            continue;
        }

        if (state === 'string') {
            if (character === '\\') {
                masked[i] = ' ';
                if (i + 1 < source.length) masked[i + 1] = ' ';
                i++;
            } else if (character === quote) {
                masked[i] = ' ';
                state = null;
            } else if (character !== '\n') {
                masked[i] = ' ';
            }
            continue;
        }

        if (character === '/' && next === '/') {
            masked[i] = ' ';
            masked[i + 1] = ' ';
            i++;
            state = 'line';
            continue;
        }
        if (character === '/' && next === '*') {
            masked[i] = ' ';
            masked[i + 1] = ' ';
            i++;
            state = 'block';
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            masked[i] = ' ';
            state = 'string';
            quote = character;
        }
    }

    return masked.join('');
}

function skipSpace(masked, index) {
    let i = index;
    while (i < masked.length && /\s/.test(masked[i])) i++;
    return i;
}

function readWord(masked, index) {
    let i = index;
    while (i < masked.length && !IDENTIFIER_PART.test(masked[i])) i++;
    if (i >= masked.length) return { word: '', start: i, end: i };

    let end = i;
    while (end < masked.length && IDENTIFIER_PART.test(masked[end])) end++;
    return { word: masked.slice(i, end), start: i, end };
}

function matchPair(masked, index) {
    const open = masked[index];
    const close = PAIRS[open];
    if (!close) return -1;

    let depth = 0;
    for (let i = index; i < masked.length; i++) {
        if (masked[i] === open) depth++;
        else if (masked[i] === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findChar(masked, character, from) {
    for (let i = from; i < masked.length; i++) {
        if (masked[i] === character) return i;
    }
    return -1;
}

// End of a statement, honouring nested brackets so a `;` inside an object or a
// for-loop header does not end it early.
function statementEnd(masked, from) {
    let depth = 0;
    for (let i = from; i < masked.length; i++) {
        const character = masked[i];
        if (character === '(' || character === '[' || character === '{') {
            depth++;
        } else if (character === ')' || character === ']' || character === '}') {
            depth--;
            if (depth < 0) return i;
        } else if (character === ';' && depth === 0) {
            return i + 1;
        }
    }
    return masked.length;
}

function declarationEnd(masked, from) {
    const open = findChar(masked, '{', from);
    if (open === -1) return masked.length;
    const close = matchPair(masked, open);
    return close === -1 ? masked.length : close + 1;
}

// --- top-level units ---------------------------------------------------------

export function parseUnits(source) {
    const masked = maskSource(source);
    const units = [];
    let i = 0;

    while (i < masked.length) {
        while (i < masked.length && (/\s/.test(masked[i]) || masked[i] === ';')) i++;
        if (i >= masked.length) break;

        const unit = readUnit(source, masked, i);
        if (!unit || unit.end <= i) {
            i++;
            continue;
        }
        units.push(unit);
        i = unit.end;
    }

    return units;
}

function readUnit(source, masked, start) {
    const first = readWord(masked, start);
    let pos = first.end;

    if (first.word === 'import') {
        const stop = statementEnd(masked, pos);
        return unit('import', null, null, source, start, stop);
    }

    if (first.word === 'export') {
        pos = skipSpace(masked, pos);
        const second = readWord(masked, pos);
        const keyword = second.word;

        if (keyword === 'default') {
            return readDeclaration(source, masked, start, skipSpace(masked, second.end), 'default');
        }
        if (keyword === 'const' || keyword === 'let' || keyword === 'var'
            || keyword === 'function' || keyword === 'class' || keyword === 'async') {
            return readDeclaration(source, masked, start, second.start, null);
        }

        const stop = statementEnd(masked, pos);
        return unit('other', null, null, source, start, stop);
    }

    return readDeclaration(source, masked, start, start, null);
}

function readDeclaration(source, masked, start, position, defaultExport) {
    let pos = skipSpace(masked, position);
    let word = readWord(masked, pos).word;

    if (word === 'async') {
        pos = skipSpace(masked, readWord(masked, pos).end);
        word = readWord(masked, pos).word;
    }

    if (word === 'function') {
        pos = skipSpace(masked, readWord(masked, pos).end);
        if (masked[pos] === '*') pos = skipSpace(masked, pos + 1);

        const nameTok = readWord(masked, pos);
        const stop = declarationEnd(masked, nameTok.end);
        return unit('function', nameTok.word || null, exportName(defaultExport, nameTok.word), source, start, stop);
    }

    if (word === 'class') {
        pos = skipSpace(masked, readWord(masked, pos).end);
        const nameTok = readWord(masked, pos);
        const name = nameTok.word && nameTok.word !== 'extends' ? nameTok.word : null;
        const stop = declarationEnd(masked, name ? nameTok.end : pos);
        return unit('class', name, exportName(defaultExport, name), source, start, stop);
    }

    if (word === 'const' || word === 'let' || word === 'var') {
        const nameTok = readWord(masked, skipSpace(masked, readWord(masked, pos).end));
        const stop = statementEnd(masked, nameTok.end);
        return unit('decl', nameTok.word || null, exportName(defaultExport, nameTok.word), source, start, stop);
    }

    const stop = statementEnd(masked, pos);
    return unit('other', null, null, source, start, stop);
}

function exportName(defaultExport, name) {
    if (defaultExport) return 'default';
    return name || null;
}

function unit(kind, name, exportedAs, source, start, end) {
    return { kind, name, exportedAs, start, end, text: source.slice(start, end) };
}

// --- class members -----------------------------------------------------------

export function parseClassMembers(classText) {
    const masked = maskSource(classText);
    const bodyOpen = findChar(masked, '{', 0);
    if (bodyOpen === -1) return { members: [], bodyOpen: -1, bodyClose: -1 };

    const bodyClose = matchPair(masked, bodyOpen);
    const end = bodyClose === -1 ? masked.length : bodyClose;

    const members = [];
    let i = bodyOpen + 1;
    while (i < end) {
        while (i < end && (/\s/.test(masked[i]) || masked[i] === ';' || masked[i] === ',')) i++;
        if (i >= end) break;

        const member = readMember(classText, masked, i, end);
        if (!member) {
            i++;
            continue;
        }
        members.push(member);
        i = Math.max(member.end, i + 1);
    }

    return { members, bodyOpen, bodyClose };
}

function readMember(text, masked, start, limit) {
    let pos = skipSpace(masked, start);
    let isStatic = false;
    let isAsync = false;
    let isGenerator = false;
    let accessor = null;

    if (masked.startsWith('static', pos) && !isIdentifierPart(masked[pos + 6])) {
        isStatic = true;
        pos = skipSpace(masked, pos + 6);
    }

    if (masked.startsWith('async', pos) && !isIdentifierPart(masked[pos + 5])
        && masked[skipSpace(masked, pos + 5)] !== '(') {
        isAsync = true;
        pos = skipSpace(masked, pos + 5);
    }

    if (masked[pos] === '*') {
        isGenerator = true;
        pos = skipSpace(masked, pos + 1);
    }

    if ((masked.startsWith('get', pos) || masked.startsWith('set', pos))
        && !isIdentifierPart(masked[pos + 3])) {
        const candidate = masked.slice(pos, pos + 3);
        const after = skipSpace(masked, pos + 3);
        if (masked[after] !== '(') {
            accessor = candidate;
            pos = after;
        }
    }

    let name = null;
    if (masked[pos] === '#') {
        const privateTok = readWord(masked, pos + 1);
        if (privateTok.start === pos + 1 && privateTok.word) name = '#' + privateTok.word;
        pos = privateTok.end;
    } else {
        const nameTok = readWord(masked, pos);
        if (nameTok.word) {
            name = nameTok.word;
            pos = nameTok.end;
        }
    }

    if (!name) {
        const stop = Math.min(statementEnd(masked, pos), limit);
        const end = Math.max(stop, start + 1);
        return { kind: 'other', name: null, isStatic, start, end, text: text.slice(start, end) };
    }

    const after = skipSpace(masked, pos);

    if (masked[after] === '(') {
        const paramsClose = matchPair(masked, after);
        const bodyOpen = paramsClose === -1 ? -1 : findChar(masked, '{', paramsClose + 1);
        const bodyClose = bodyOpen === -1 ? -1 : matchPair(masked, bodyOpen);
        const end = bodyClose === -1 ? limit : Math.min(bodyClose + 1, limit);

        return {
            kind: name === 'constructor' ? 'constructor' : (accessor || 'method'),
            name,
            isStatic,
            isAsync,
            isGenerator,
            params: bodyOpen === -1 ? '' : text.slice(after + 1, paramsClose),
            body: bodyClose === -1 ? null : text.slice(bodyOpen + 1, bodyClose),
            start,
            end,
            text: text.slice(start, end)
        };
    }

    // A field: `name = value;`, optionally static.
    const stop = Math.min(statementEnd(masked, after), limit);
    const equals = findChar(masked.slice(0, stop), '=', after);

    return {
        kind: 'field',
        name,
        isStatic,
        start,
        end: stop,
        init: equals === -1 ? null : text.slice(equals + 1, stop).replace(/;\s*$/, '').trim(),
        text: text.slice(start, stop)
    };
}

function memberKey(member) {
    return `${member.isStatic ? 'static ' : ''}${member.kind === 'get' || member.kind === 'set' ? member.kind + ' ' : ''}${member.name}`;
}

// --- patch generation --------------------------------------------------------

function unitKey(item) {
    return `${item.kind}:${item.name || item.exportedAs || 'anonymous'}`;
}

function targetExpression(item) {
    if (item.exportedAs === 'default') return 'exports.default';
    if (item.exportedAs) return `exports.${item.exportedAs}`;
    return null;
}

function describeUnit(item) {
    if (item.kind === 'class') return item.name ? `class ${item.name}` : 'the anonymous class';
    return `${item.kind} ${item.name || '(anonymous)'}`;
}

function unsupportedReason(member) {
    if (member.kind === 'constructor') {
        return 'constructors cannot be swapped without breaking objects that already exist';
    }
    if (member.kind === 'get' || member.kind === 'set') {
        return 'accessors need Object.defineProperty; write that part by hand';
    }
    if (member.name && member.name.startsWith('#')) {
        return 'private members are not reachable from outside the class';
    }
    if (member.kind === 'field') {
        return member.isStatic
            ? 'this static field has no initialiser to copy'
            : 'instance fields are set per object at construction; move the logic into a method';
    }
    return 'this member is not a plain method or static field';
}

function buildMemberPatch(member, existed) {
    if (member.kind === 'constructor' || member.kind === 'get' || member.kind === 'set') return null;
    if (member.name && member.name.startsWith('#')) return null;
    if (member.kind === 'other') return null;

    if (member.kind === 'field') {
        if (!member.isStatic || member.init === null || member.init === '') return null;
        return { accessor: `Target.${member.name}`, value: member.init, existed };
    }

    if (member.body === null) return null;

    const owner = member.isStatic ? 'Target' : 'Target.prototype';
    const prefix = `${member.isAsync ? 'async ' : ''}function${member.isGenerator ? '*' : ''}`;
    const value = `${prefix} ${member.name}(${member.params}) {${member.body}}`;

    return { accessor: `${owner}.${member.name}`, value, existed };
}

// Names a patch cannot see: they are module-scope imports, resolved when Vite
// builds the game, not fields of the exports object.
function importedBindings(source) {
    const names = new Set();

    for (const item of parseUnits(source)) {
        if (item.kind !== 'import') continue;

        let body = item.text.replace(/^import\s+/, '');
        const from = body.lastIndexOf('from');
        if (from !== -1) body = body.slice(0, from);

        const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(body);
        if (namespace) names.add(namespace[1]);

        const named = /\{([\s\S]*?)\}/.exec(body);
        if (named) {
            for (const entry of named[1].split(',')) {
                const parts = entry.trim().split(/\s+as\s+/);
                const local = (parts[1] || parts[0] || '').trim();
                if (local) names.add(local);
            }
        }

        const defaultBinding = body.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(defaultBinding)) names.add(defaultBinding);
    }

    return names;
}

function usedImports(body, imports) {
    if (!body) return [];
    const found = new Set();
    const masked = maskSource(body);

    for (const name of imports) {
        const pattern = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
        if (pattern.test(masked)) found.add(name);
    }

    return [...found];
}

// `originalSource` is the file as it ships, `editedSource` what the IDE holds
// now. Returns the patch script plus what could not be converted.
export function generatePatch(file, originalSource, editedSource) {
    const result = { file, changed: false, source: '', converted: [], skipped: [], warnings: [] };

    if (typeof originalSource !== 'string' || typeof editedSource !== 'string') return result;
    if (originalSource === editedSource) return result;

    result.changed = true;

    const before = new Map();
    for (const item of parseUnits(originalSource)) before.set(unitKey(item), item);

    const after = new Map();
    for (const item of parseUnits(editedSource)) after.set(unitKey(item), item);

    const imports = importedBindings(originalSource);
    const assignments = [];

    for (const [key, item] of after) {
        const original = before.get(key);

        if (!original) {
            result.skipped.push({
                unit: describeUnit(item),
                reason: 'it is new in this file; a patch can only change what the file already defines'
            });
            continue;
        }
        before.delete(key);
        if (original.text === item.text) continue;

        if (item.kind === 'import') {
            result.skipped.push({
                unit: describeUnit(item),
                reason: 'imports are resolved when the game is built and are not on the namespace'
            });
            continue;
        }

        if (item.kind !== 'class') {
            result.skipped.push({
                unit: describeUnit(item),
                reason: item.kind === 'function'
                    ? 'module-level functions are not reachable from the namespace; move the change into a class'
                    : 'module-level values are read-only through the namespace; change what uses them instead'
            });
            continue;
        }

        const target = targetExpression(item);
        const editedMembers = parseClassMembers(item.text).members;
        const originalMembers = parseClassMembers(original.text).members;
        const remaining = new Map(originalMembers.map((member) => [memberKey(member), member]));

        for (const member of editedMembers) {
            const memberId = memberKey(member);
            const previous = remaining.get(memberId);
            remaining.delete(memberId);

            if (previous && previous.text === member.text) continue;

            const name = `${item.name || 'class'}.${member.name}`;
            if (!target) {
                result.skipped.push({ unit: name, reason: 'the file does not export this class, so a patch cannot reach it' });
                continue;
            }
            if (member.kind === 'other') {
                result.skipped.push({ unit: name, reason: unsupportedReason(member) });
                continue;
            }

            const built = buildMemberPatch(member, !!previous);
            if (!built) {
                result.skipped.push({ unit: name, reason: unsupportedReason(member) });
                continue;
            }

            const uses = usedImports(member.body, imports);
            if (uses.length > 0) {
                result.warnings.push({ unit: name, identifiers: uses });
            }

            assignments.push({ ...built, target, name, uses });
            result.converted.push({ unit: name });
        }

        for (const member of remaining.values()) {
            result.skipped.push({
                unit: `${item.name || 'class'}.${member.name}`,
                reason: 'it was deleted; a patch cannot remove game behaviour safely'
            });
        }
    }

    for (const item of before.values()) {
        if (item.kind === 'import') continue;
        result.skipped.push({
            unit: describeUnit(item),
            reason: 'it was removed from the file; a patch cannot delete game code safely'
        });
    }

    if (assignments.length === 0) return result;

    const lines = [
        `// Generated from your edits to ${file}.`,
        '// Keep editing that file in the Source view and this script is rewritten;',
        '// edit this text yourself and the IDE stops regenerating it.',
        '//',
        "// Runs with `exports` bound to that file's live module namespace, so these",
        '// assignments change the class the game is already using - not a copy.'
    ];

    for (const warning of result.warnings) {
        lines.push('//');
        lines.push(`// Warning: ${warning.unit} uses ${warning.identifiers.join(', ')}, which a patch`);
        lines.push('// cannot see (module imports are not on the namespace). This will throw');
        lines.push('// until that part is rewritten to use values the patch can reach.');
    }

    lines.push('');
    lines.push('const Target = ' + assignments[0].target + ';');
    lines.push('');

    const restores = [];
    assignments.forEach((assignment, index) => {
        if (assignment.target !== assignments[0].target) {
            lines.push(`const Target${index} = ${assignment.target};`);
        }

        const targetName = assignment.target === assignments[0].target ? 'Target' : `Target${index}`;
        const accessor = assignment.accessor.replace(/^Target/, targetName);

        if (assignment.existed) {
            const saved = `_before_${index}`;
            lines.push(`const ${saved} = ${accessor};`);
            restores.push(`${accessor} = ${saved};`);
        }

        lines.push(`${accessor} = ${assignment.value};`);
        if (!assignment.existed) restores.push(`delete ${accessor};`);
        lines.push('');
    });

    lines.push('// Disabling the patch calls this and the stock members come back.');
    lines.push('return () => {');
    for (const restore of restores) lines.push(`    ${restore}`);
    lines.push('};');
    lines.push('');

    result.source = lines.join('\n');
    return result;
}

export const SourcePatch = {
    generatePatch,
    parseUnits,
    parseClassMembers
};

export default SourcePatch;
