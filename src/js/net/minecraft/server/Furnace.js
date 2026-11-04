import { addWorldChange, getBlockAt, getBlockMetadata } from './world.js';
import { getPlayers } from './players.js';
import { sendBlockChange } from './packets.js';

// Fuel values: typeId -> burn ticks
const FUEL_VALUES = {
    87: 1600,   // Coal
    29: 16000   // Coal Block
};

// Smelting recipes: inputTypeId -> { resultTypeId, resultCount }
const RECIPES = {
    24: { resultTypeId: 86, resultCount: 1 },  // Iron Ore -> Iron Ingot
    21: { resultTypeId: 90, resultCount: 1 },  // Gold Ore -> Gold Ingot
    12: { resultTypeId: 20, resultCount: 1 },  // Sand -> Glass
    4:  { resultTypeId: 1,  resultCount: 1 }   // Cobblestone -> Stone
};

function isFuel(typeId) { return FUEL_VALUES[typeId] !== undefined; }
function getFuelValue(typeId) { return FUEL_VALUES[typeId] || 0; }
function getSmeltingResult(inputTypeId) { return RECIPES[inputTypeId] || null; }

function getItem(index, inv) {
    const items = inv?.items || [];
    const slot = items[index];
    return slot ? { typeId: slot.typeId || 0, count: slot.count || 0 } : { typeId: 0, count: 0 };
}

function setItem(index, typeId, count, inv) {
    if (!inv.items) inv.items = [];
    inv.items[index] = { typeId, count };
}

function tickFurnace(inv) {
    if (!inv || typeof inv !== 'object') return { changed: false, hasFuel: false, isLit: false };

    if (inv.burnTime === undefined) inv.burnTime = 0;
    if (inv.fuelBurnTime === undefined) inv.fuelBurnTime = 0;
    if (inv.cookTime === undefined) inv.cookTime = 0;

    const input = getItem(0, inv);
    const fuel = getItem(1, inv);
    const output = getItem(2, inv);

    const recipe = input.typeId > 0 ? getSmeltingResult(input.typeId) : null;
    const canOutput = recipe && (output.typeId === 0 || (output.typeId === recipe.resultTypeId && output.count + recipe.resultCount <= 64));

    const hasFuel = fuel.typeId > 0 && isFuel(fuel.typeId);

    // Reset cook progress if the input item changed
    const currentRecipeId = input.typeId > 0 ? (recipe ? recipe.resultTypeId : -1) : 0;
    if (currentRecipeId !== inv._lastRecipeId) {
        inv.cookTime = 0;
        inv._lastRecipeId = currentRecipeId;
    }

    const prevHasFuel = inv._prevHasFuel;
    inv._prevHasFuel = hasFuel;

    if (inv.burnTime > 0) {
        const playerRemovedFuel = prevHasFuel && !hasFuel && !inv._consumedThisTick;
        if (playerRemovedFuel) inv._burnActive = false;
        if (hasFuel || inv._burnActive) inv.burnTime--;
    }

    inv._consumedThisTick = false;

    if (inv.burnTime <= 0) inv._burnActive = false;

    if (inv.burnTime <= 0 && canOutput && hasFuel) {
        const fuelValue = getFuelValue(fuel.typeId);
        const newCount = fuel.count - 1;
        setItem(1, newCount > 0 ? fuel.typeId : 0, newCount > 0 ? newCount : 0, inv);
        inv.fuelBurnTime = fuelValue;
        inv.burnTime = fuelValue;
        inv._burnActive = true;
        inv._consumedThisTick = true;
    }

    if (inv.burnTime <= 0) inv.cookTime = 0;

    if (inv.burnTime > 0 && canOutput) {
        inv.cookTime = (inv.cookTime || 0) + 1;
        if (inv.cookTime >= 200) {
            inv.cookTime = 0;
            const newInputCount = input.count - 1;
            setItem(0, newInputCount > 0 ? input.typeId : 0, newInputCount > 0 ? newInputCount : 0, inv);
            if (output.typeId === 0) {
                setItem(2, recipe.resultTypeId, recipe.resultCount, inv);
            } else {
                setItem(2, output.typeId, output.count + recipe.resultCount, inv);
            }
        }
    }

    const isLit = inv.burnTime > 0 && (hasFuel || inv._burnActive);
    return { changed: true, hasFuel, isLit };
}

function tickAllFurnaces(blockInventories) {
    const changes = [];
    for (const [key, inv] of blockInventories.entries()) {
        if (!key.startsWith('furnace:')) continue;
        const parts = key.split(':');
        if (parts.length !== 4) continue;
        const x = parseInt(parts[1]);
        const y = parseInt(parts[2]);
        const z = parseInt(parts[3]);

        if (getBlockAt(x, y, z) !== 34) {
            blockInventories.delete(key);
            continue;
        }

        const currentMeta = getBlockMetadata(x, y, z);

        const result = tickFurnace(inv);

        const desiredMeta = result.isLit ? currentMeta | 8 : currentMeta & ~8;
        if (desiredMeta !== currentMeta) {
            addWorldChange(x, y, z, 34, desiredMeta);
        }

        changes.push({ key, inv, x, y, z, metaChanged: desiredMeta !== currentMeta, newMeta: desiredMeta });
    }
    return changes;
}

function broadcastFurnaceChanges(players, changes) {
    for (const change of changes) {
        const msg = JSON.stringify({
            type: 'blockInventory',
            key: change.key,
            inventory: change.inv
        });
        for (const player of players.values()) {
            if (player.ws && player.ws.readyState === 1) {
                player.ws.send(msg);
                if (change.metaChanged) {
                    const blockState = (34 << 4) | (change.newMeta & 0xF);
                    sendBlockChange(player.ws, change.x, change.y, change.z, blockState);
                }
            }
        }
    }
}

export { tickAllFurnaces, broadcastFurnaceChanges };
