import Polygon from "./Polygon.js";
import Vertex from "./Vertex.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";

export default class ModelRenderer {

    
    constructor(name, textureWidth, textureHeight) {
        this.name = name;

        this.textureWidth = textureWidth;
        this.textureHeight = textureHeight;

        this.textureOffsetX = 0;
        this.textureOffsetY = 0;

        this.rotateAngleX = 0;
        this.rotateAngleY = 0;
        this.rotateAngleZ = 0;

        this.rotationPointX = 0;
        this.rotationPointY = 0;
        this.rotationPointZ = 0;

        this.scaleX = 1;
        this.scaleY = 1;
        this.scaleZ = 1;

        this.cubes = [];
        this.children = [];

        this.bone = new THREE.Object3D();
    }

    
    setTextureOffset(textureOffsetX, textureOffsetY) {
        this.textureOffsetX = textureOffsetX;
        this.textureOffsetY = textureOffsetY;
        return this;
    }

    
    setTextureSize(width, height) {
        this.textureWidth = width;
        this.textureHeight = height;
        return this;
    }

    
    setRotationPoint(x, y, z) {
        this.rotationPointX = x;
        this.rotationPointY = y;
        this.rotationPointZ = z;
        return this;
    }

    
    setRotationAngle(x, y, z) {
        this.rotateAngleX = x;
        this.rotateAngleY = y;
        this.rotateAngleZ = z;
        return this;
    }

    
    setScale(x, y, z) {
        this.scaleX = x;
        this.scaleY = y;
        this.scaleZ = z;
        return this;
    }

    
    addBox(offsetX, offsetY, offsetZ, width, height, depth, inflate = 0, mirror = false) {
        let polygons = [];

        let x = offsetX + width;
        let y = offsetY + height;
        let z = offsetZ + depth;

        let vertexBottom1 = new Vertex(offsetX, offsetY, offsetZ);
        let vertexBottom2 = new Vertex(x, offsetY, offsetZ);
        let vertexBottom3 = new Vertex(offsetX, offsetY, z);
        let vertexBottom4 = new Vertex(x, offsetY, z);

        let vertexTop1 = new Vertex(x, y, z);
        let vertexTop2 = new Vertex(offsetX, y, z);
        let vertexTop3 = new Vertex(x, y, offsetZ);
        let vertexTop4 = new Vertex(offsetX, y, offsetZ);

        const createPolygon = (vertices, minU, minV, maxU, maxV) => {
            const uStart = mirror ? maxU : minU;
            const uEnd = mirror ? minU : maxU;
            return new Polygon(vertices, uStart, minV, uEnd, maxV, this.textureWidth, this.textureHeight);
        };

        polygons[0] = createPolygon(
            [vertexBottom4, vertexBottom2, vertexTop3, vertexTop1],
            this.textureOffsetX + depth + width,
            this.textureOffsetY + depth,
            this.textureOffsetX + depth + width + depth,
            this.textureOffsetY + depth + height
        );

        polygons[1] = createPolygon(
            [vertexBottom1, vertexBottom3, vertexTop2, vertexTop4],
            this.textureOffsetX,
            this.textureOffsetY + depth,
            this.textureOffsetX + depth,
            this.textureOffsetY + depth + height
        );

        polygons[2] = createPolygon(
            [vertexBottom4, vertexBottom3, vertexBottom1, vertexBottom2],
            this.textureOffsetX + depth,
            this.textureOffsetY,
            this.textureOffsetX + depth + width,
            this.textureOffsetY + depth
        );

        polygons[3] = createPolygon(
            [vertexTop3, vertexTop4, vertexTop2, vertexTop1],
            this.textureOffsetX + depth + width,
            this.textureOffsetY,
            this.textureOffsetX + depth + width + width,
            this.textureOffsetY + depth
        );

        polygons[4] = createPolygon(
            [vertexBottom2, vertexBottom1, vertexTop4, vertexTop3],
            this.textureOffsetX + depth,
            this.textureOffsetY + depth,
            this.textureOffsetX + depth + width,
            this.textureOffsetY + depth + height
        );

        polygons[5] = createPolygon(
            [vertexBottom3, vertexBottom4, vertexTop1, vertexTop2],
            this.textureOffsetX + depth + width + depth,
            this.textureOffsetY + depth,
            this.textureOffsetX + depth + width + depth + width,
            this.textureOffsetY + depth + height
        );

        polygons[0].shading = 0.6; 
        polygons[1].shading = 0.6; 
        polygons[2].shading = 1.0; 
        polygons[3].shading = 0.5; 
        polygons[4].shading = 0.8; 
        polygons[5].shading = 0.8; 

        this.cubes.push(polygons);

        return this;
    }

    addChild(model) {
        this.children.push(model);
    }

    removeChild(model) {
        let index = this.children.indexOf(model);
        if (index !== -1) {
            this.children.splice(index, 1);
        }
    }

    getModelByName(name) {
        if (this.name === name) {
            return this;
        }

        for (const child of this.children) {
            let innerResult = child.getModelByName(name);
            if (innerResult != null) {
                return innerResult;
            }
        }

        return null;
    }

    rebuild(tessellator, group) {
        this.bone.clear();

        tessellator.startDrawing();
        for (let i = 0; i < this.cubes.length; i++) {
            let polygons = this.cubes[i];

            for (let face = 0; face < 6; face++) {
                let polygon = polygons[face];
                polygon.render(tessellator);
            }
        }
        tessellator.draw(this.bone);

        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            child.rebuild(tessellator, this.bone);
        }

        group.add(this.bone);
    }

    render() {
        this.bone.position.setX(this.rotationPointX);
        this.bone.position.setY(this.rotationPointY);
        this.bone.position.setZ(this.rotationPointZ);

        this.bone.rotation.order = 'ZYX';
        this.bone.rotation.x = this.rotateAngleX;
        this.bone.rotation.y = this.rotateAngleY;
        this.bone.rotation.z = this.rotateAngleZ;

        this.bone.scale.setX(this.scaleX);
        this.bone.scale.setY(this.scaleY);
        this.bone.scale.setZ(this.scaleZ);

        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            child.render();
        }

        this.bone.updateMatrix();
    }

    clone() {
        let modelRenderer = new ModelRenderer(this.name, this.textureWidth, this.textureHeight);
        modelRenderer.bone = this.bone.clone();
        modelRenderer.textureOffsetX = this.textureOffsetX;
        modelRenderer.textureOffsetY = this.textureOffsetY;
        modelRenderer.cubes = this.cubes;
        modelRenderer.copyTransformOf(this);

        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            modelRenderer.addChild(child.clone());
        }

        return modelRenderer;
    }

    copyTransformOf(modelRenderer) {
        this.rotationPointX = modelRenderer.rotationPointX;
        this.rotationPointY = modelRenderer.rotationPointY;
        this.rotationPointZ = modelRenderer.rotationPointZ;
        this.scaleX = modelRenderer.scaleX;
        this.scaleY = modelRenderer.scaleY;
        this.scaleZ = modelRenderer.scaleZ;
        this.rotateAngleX = modelRenderer.rotateAngleX;
        this.rotateAngleY = modelRenderer.rotateAngleY;
        this.rotateAngleZ = modelRenderer.rotateAngleZ;
    }
}