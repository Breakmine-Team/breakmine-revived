import ModelRenderer from "../renderer/ModelRenderer.js";
import MathHelper from "../../../../util/MathHelper.js";
import ModelBase from "../ModelBase.js";

export default class ModelCreeper extends ModelBase {

    
    constructor() {
        super();

        let width = 64;
        let height = 32;

        this.head = new ModelRenderer("head", width, height)
            .setTextureOffset(0, 0)
            .addBox(-4.0, -8.0, -4.0, 8, 8, 8);

        this.unused = new ModelRenderer("unused", width, height)
            .setTextureOffset(32, 0)
            .addBox(-4.0, -8.0, -4.0, 8, 8, 8, 0.5);

        this.body = new ModelRenderer("body", width, height)
            .setTextureOffset(16, 16)
            .addBox(-4.0, 0.0, -2.0, 8, 12, 4);

        this.leg1 = new ModelRenderer("leg1", width, height)
            .setTextureOffset(0, 16)
            .setRotationPoint(-2.0, 12.0, 4.0)
            .addBox(-2.0, 0.0, -2.0, 4, 6, 4);

        this.leg2 = new ModelRenderer("leg2", width, height)
            .setTextureOffset(0, 16)
            .setRotationPoint(2.0, 12.0, 4.0)
            .addBox(-2.0, 0.0, -2.0, 4, 6, 4);

        this.leg3 = new ModelRenderer("leg3", width, height)
            .setTextureOffset(0, 16)
            .setRotationPoint(-2.0, 12.0, -4.0)
            .addBox(-2.0, 0.0, -2.0, 4, 6, 4);

        this.leg4 = new ModelRenderer("leg4", width, height)
            .setTextureOffset(0, 16)
            .setRotationPoint(2.0, 12.0, -4.0)
            .addBox(-2.0, 0.0, -2.0, 4, 6, 4);
    }

    rebuild(tessellator, group) {
        super.rebuild(tessellator, group);

        this.head.rebuild(tessellator, group);
        this.body.rebuild(tessellator, group);
        this.leg1.rebuild(tessellator, group);
        this.leg2.rebuild(tessellator, group);
        this.leg3.rebuild(tessellator, group);
        this.leg4.rebuild(tessellator, group);
    }

    render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks) {
        this.setRotationAngles(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks);

        this.head.render();
        this.body.render();
        this.leg1.render();
        this.leg2.render();
        this.leg3.render();
        this.leg4.render();

        super.render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks);
    }

    setRotationAngles(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks) {
        this.head.rotateAngleY = yaw / 57.295776;
        this.head.rotateAngleX = pitch / 57.295776;

        this.leg1.rotateAngleX = Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingStrength;
        this.leg2.rotateAngleX = Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbSwingStrength;
        this.leg3.rotateAngleX = Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbSwingStrength;
        this.leg4.rotateAngleX = Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingStrength;
    }
}