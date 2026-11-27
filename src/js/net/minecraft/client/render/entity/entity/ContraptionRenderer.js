import EntityRenderer from "../EntityRenderer.js";

// A contraption is drawn by its own OffGridBlockField, the same way a bearing's
// blocks are. This renderer only fills the entity slot in the render manager;
// the field group added to the scene carries the blocks and their pose.
export default class ContraptionRenderer extends EntityRenderer {

    constructor(worldRenderer) {
        super(null);

        this.worldRenderer = worldRenderer;
    }

    fillMeta(entity, meta) {
    }

    isRebuildRequired(entity) {
        return false;
    }

    rebuild(entity) {
    }

    render(entity, partialTicks) {
    }
}
