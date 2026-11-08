const SECTION_COUNT = 16;
const SECTION_SIZE = 16;
const SECTION_VOLUME = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE;
const TOTAL_HEIGHT = 256;




let validBlocks = new Uint8Array(4096);
validBlocks.fill(1);
validBlocks[0] = 0;
let opacityById = new Float32Array(4096);
opacityById.fill(1);
opacityById[0] = 0;
let dynamicOpacityById = new Uint8Array(4096);

function getBlock(sections, x, y, z) {
    const section = sections[y >> 4];
    return section === null ? 0 : section.blocks[(y & 15) << 8 | z << 4 | x];
}

function calculateHeightAt(sections, x, z) {
    let y = TOTAL_HEIGHT;
    while (y > 0) {
        const typeId = getBlock(sections, x, y - 1, z);
        if (typeId !== 0) {
            const opacity = opacityById[typeId] ?? 1;
            if (opacity !== 0) {
                break;
            }
        }
        y--;
    }
    return y;
}

function processChunk(message) {
    const {id, x, z, mask, data} = message;

    const sections = new Array(SECTION_COUNT).fill(null);
    const skyLights = new Array(SECTION_COUNT);
    for (let layer = 0; layer < SECTION_COUNT; layer++) {
        skyLights[layer] = new Uint8Array(SECTION_VOLUME);
    }
    const unknownCells = [];
    let needsMainLight = false;
    let offset = 0;

    for (let layer = 0; layer < SECTION_COUNT; layer++) {
        if ((mask & (1 << layer)) === 0) {
            continue;
        }

        const blocks = new Uint16Array(SECTION_VOLUME);
        const blocksData = new Uint8Array(SECTION_VOLUME);
        let nonEmpty = false;

        for (let i = 0; i < SECTION_VOLUME; i++) {
            const value = (data[offset] & 0xFF) | ((data[offset + 1] & 0xFF) << 8);
            const typeId = value >>> 4;
            const metadata = value & 0xF;

            blocks[i] = typeId;
            blocksData[i] = metadata;

            if (typeId !== 0) {
                nonEmpty = true;

                if (!validBlocks[typeId]) {
                    unknownCells.push(layer, i, typeId);
                    needsMainLight = true;
                }

                if (dynamicOpacityById[typeId]) {
                    needsMainLight = true;
                }
            }

            offset += 2;
        }

        offset += SECTION_VOLUME / 2 * 2;

        if (nonEmpty) {
            sections[layer] = {
                blocks,
                blocksData
            };
        }
    }

    const heightMap = new Uint16Array(256);
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
        for (let lz = 0; lz < SECTION_SIZE; lz++) {
            heightMap[lz << 4 | lx] = calculateHeightAt(sections, lx, lz);
        }
    }

    for (let lx = 0; lx < SECTION_SIZE; lx++) {
        for (let lz = 0; lz < SECTION_SIZE; lz++) {
            const height = heightMap[lz << 4 | lx];
            let light = 15;

            for (let y = TOTAL_HEIGHT - 1; y >= 0; y--) {
                if (y < height) {
                    const typeId = getBlock(sections, lx, y, lz);
                    let opacity = typeId === 0 ? 0 : Math.round((opacityById[typeId] ?? 1) * 255);
                    if (opacity === 0) {
                        opacity = 1;
                    }

                    light -= opacity;
                    if (light < 0) {
                        light = 0;
                    }
                } else {
                    light = 15;
                }

                skyLights[y >> 4][(y & 15) << 8 | lz << 4 | lx] = light;
            }
        }
    }

    return {
        type: "filled",
        id,
        x,
        z,
        sections,
        skyLights,
        heightMap,
        unknownCells,
        needsMainLight
    };
}

function transferList(result) {
    const buffers = [result.heightMap.buffer];
    for (const section of result.sections) {
        if (section !== null) {
            buffers.push(section.blocks.buffer, section.blocksData.buffer);
        }
    }
    for (const skyLight of result.skyLights) {
        buffers.push(skyLight.buffer);
    }
    return buffers;
}

self.onmessage = function (event) {
    const message = event.data;

    if (message.type === "config") {
        validBlocks = message.validBlocks;
        opacityById = message.opacityById;
        dynamicOpacityById = message.dynamicOpacityById;
        return;
    }

    if (message.type !== "fill") {
        return;
    }

    try {
        const result = processChunk(message);
        self.postMessage(result, transferList(result));
    } catch (error) {
        self.postMessage({
            type: "error",
            id: message.id,
            x: message.x,
            z: message.z,
            message: error && error.message ? error.message : String(error)
        });
    }
};
