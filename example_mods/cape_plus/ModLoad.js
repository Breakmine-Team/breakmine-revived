import CapeService from "./CapeService.js";
import GuiCapeUpload from "./gui/GuiCapeUpload.js";

export default class ModLoad {
    static onLoad(world, minecraft, modLoader) {
        modLoader.registerService(
            "cape_plus",
            new CapeService(minecraft, GuiCapeUpload)
        );
    }
}
