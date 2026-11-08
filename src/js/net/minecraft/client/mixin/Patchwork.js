import { Version } from "../../../../../resources/version.js";
import Block from "../world/block/Block.js";


export default class Patchwork {
    static version = Version.PATCHWORK_VERSION;
    static timestamp = Version.TIMESTAMP;

    static block = class BlockManager {
        static getBaseBlock() {
            return new Block;
        }

        static registerBlock() {
        }
    }

    static entity = class EntityManager {
        static addEntity(eid) {
            Patchwork.world.worldClass.addEntity(eid);
        }
    }

    static game = class GameManager {
        
        static getLookedAtBlock(reach = 5) {
            return globalThis.Mixin?.callFunction('game:getLookedAtBlock', reach);
        }
    }

    static world = class WorldManager {
        
        static setBlockAt(x, y, z) {

        }
    }

    static renderer = class RendererManager {
    }

    static gui = class GuiManager {
    }
}