import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createStructureTemplateRegistry } from '../structure-nbt.mjs';
import { orderedTemplatePaletteBlocks } from '../structure-template.mjs';

const stateKey = s => `${s.name};${Object.entries(s.properties).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(',')}`;
export async function compareJarTemplates(data, reference) {
    const registry = await createStructureTemplateRegistry(data);
    assert.equal(registry.ids.length,reference.templates.length);
    let blocks = 0, palettes = 0;
    const classify = s => {
        const entry = reference.shapes[stateKey(s)];
        assert.ok(entry,`JAR palette state must resolve: ${stateKey(s)}`);
        return entry.staticFullBlock;
    };
    for (const entry of reference.templates) {
        const template=registry.get(entry.id);
        assert.deepEqual(template.size,entry.size,entry.id);
        assert.equal(template.entities.length,entry.entities,entry.id);
        assert.equal(template.palettes.length,entry.palettes.length,entry.id);
        for (let i=0;i<template.palettes.length;i++) {
            const ordered=orderedTemplatePaletteBlocks(template,template.palettes[i],classify);
            const text=ordered.map(b=>`${b.pos.x},${b.pos.y},${b.pos.z};${stateKey(b.state)};${b.nbt?1:0}\n`).join('');
            assert.equal(ordered.length,entry.palettes[i].blocks,entry.id);
            assert.equal(createHash('sha256').update(text).digest('hex'),entry.palettes[i].sha256,`${entry.id} palette ${i}`);
            blocks+=ordered.length;palettes++;
        }
    }
    return {templates:registry.ids.length,palettes,blocks,states:Object.keys(reference.shapes).length};
}
