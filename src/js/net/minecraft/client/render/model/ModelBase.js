export default class ModelBase {

    
    rebuild(tessellator, group) {

    }

    render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks) {
        stack.updateMatrix();
    }

    setRotationAngles(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks) {

    }

}