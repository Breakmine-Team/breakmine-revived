let nextItemId = 1000;
const itemEntities = new Map();

function addItemEntity(blockId, x, y, z, motionX, motionY, motionZ, droppedBy, hasPickupDelay = false) {
    const id = nextItemId++;
    const entity = {
        id,
        type: 1, // Object type 1 = Item
        blockId,
        x,
        y,
        z,
        motionX: motionX || 0,
        motionY: motionY || 0,
        motionZ: motionZ || 0,
        droppedBy,
        hasPickupDelay: !!hasPickupDelay,
        spawnTime: Date.now()
    };
    itemEntities.set(id, entity);
    return entity;
}

function removeItemEntity(id) {
    itemEntities.delete(id);
}

function getItemEntity(id) {
    return itemEntities.get(id) || null;
}

function getAllItemEntities() {
    return Array.from(itemEntities.values());
}

function updateItemPositions() {
    for (const [id, entity] of itemEntities) {
        entity.motionY -= 0.04;
        entity.x += entity.motionX;
        entity.y += entity.motionY;
        entity.z += entity.motionZ;
        entity.motionX *= 0.98;
        entity.motionZ *= 0.98;

        // Simple ground collision
        if (entity.y < 1) {
            entity.y = 1;
            entity.motionY = 0;
            entity.motionX *= 0.7;
            entity.motionZ *= 0.7;
        }
    }
}

export {
    addItemEntity,
    removeItemEntity,
    getItemEntity,
    getAllItemEntities,
    updateItemPositions
};
