// HumanoidModel.setupSwimAnimation, pinned reference JAR. Phase uses walk
// animation position, not wall-clock time. No per-frame temporary objects.
function angle(from, to, amount) {
    let delta = (to - from) % (Math.PI * 2);
    if (delta < -Math.PI) delta += Math.PI * 2;
    if (delta >= Math.PI) delta -= Math.PI * 2;
    return from + delta * amount;
}

export function animateHumanoidSwimming(model, limbSwing, swimAmount) {
    if (!(swimAmount > 0)) return;
    const amount = Math.min(1, swimAmount);
    model.head.rotateAngleX = angle(model.head.rotateAngleX, -Math.PI / 4, amount);
    const phase = ((limbSwing % 26) + 26) % 26;
    let x, leftZ, rightZ;
    if (phase < 14) {
        const reach = (phase * phase - 65 * phase) / (14 * 14 - 65 * 14);
        x = 0; leftZ = Math.PI + 1.8707964 * reach; rightZ = Math.PI - 1.8707964 * reach;
    } else if (phase < 22) {
        const progress = (phase - 14) / 8;
        x = Math.PI / 2 * progress;
        leftZ = 5.012389 - 1.8707964 * progress;
        rightZ = 1.2707963 + 1.8707964 * progress;
    } else {
        x = Math.PI / 2 * (1 - (phase - 22) / 4);
        leftZ = rightZ = Math.PI;
    }
    if (!model.isUsingItem) {
        const left = model.leftArm, right = model.rightArm;
        const leftAmount = model.swingingArm === 'left' ? 0 : amount;
        const rightAmount = model.isThrowingTrident || model.swingingArm === 'right' ? 0 : amount;
        left.rotateAngleX = angle(left.rotateAngleX, x, leftAmount);
        left.rotateAngleY = angle(left.rotateAngleY, Math.PI, leftAmount);
        left.rotateAngleZ = angle(left.rotateAngleZ, leftZ, leftAmount);
        right.rotateAngleX += (x - right.rotateAngleX) * rightAmount;
        right.rotateAngleY += (Math.PI - right.rotateAngleY) * rightAmount;
        right.rotateAngleZ += (rightZ - right.rotateAngleZ) * rightAmount;
    }
    model.leftLeg.rotateAngleX += (.3 * Math.cos(limbSwing / 3 + Math.PI) - model.leftLeg.rotateAngleX) * amount;
    model.rightLeg.rotateAngleX += (.3 * Math.cos(limbSwing / 3) - model.rightLeg.rotateAngleX) * amount;
}
