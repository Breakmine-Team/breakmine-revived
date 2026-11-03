import { Version } from "../../../../../resources/version.js";
import Block from "../world/block/Block.js";

// static; no 'this' allowed.
export default class Patchwork {
    static version = Version.PATCHWORK_VERSION;
    static timestamp = Version.TIMESTAMP;

    static block = class BlockManager {
        static getBaseBlock() {
            return new Block;
        }

        static registerBlock() {
            //
        }
    }

    static entity = class EntityManager {
        static addEntity(eid) {
            Patchwork.world.worldClass.addEntity(eid);
        }
    }

    static game = class GameManager {
        /**
         * Info about the block the player is currently looking at:
         * { name, namespace, id, text_id, description }.
         *
         * `name` is the first line of the block's description, `id` is the
         * numeric block id and `text_id` the namespaced identifier
         * (e.g. "breakmine:stone"). Returns null when nothing is targeted and
         * undefined when there is no world/player yet.
         *
         * @param {number} reach how far to trace, in blocks (default 5)
         */
        static getLookedAtBlock(reach = 5) {
            return globalThis.Mixin?.callFunction('game:getLookedAtBlock', reach);
        }
    }

    static world = class WorldManager {
        
        static setBlockAt(x, y, z) {

        }
    }

    static renderer = class RendererManager {
        //
    }

    static gui = class GuiManager {
        //
    }
}