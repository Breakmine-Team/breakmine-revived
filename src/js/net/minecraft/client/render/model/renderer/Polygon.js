import Vertex from "./Vertex.js";

export default class Polygon {

    constructor(vertices, minU, minV, maxU, maxV, textureWidth, textureHeight) {
        this.vertices = vertices;
        this.vertexCount = vertices.length;
        this.shading = 1.0;

        minU /= textureWidth;
        minV /= textureHeight;
        maxU /= textureWidth;
        maxV /= textureHeight;

        minV = 1 - minV;
        maxV = 1 - maxV;

        vertices[0] = Vertex.create(vertices[0].position).withUV(maxU, minV);
        vertices[1] = Vertex.create(vertices[1].position).withUV(minU, minV);
        vertices[2] = Vertex.create(vertices[2].position).withUV(minU, maxV);
        vertices[3] = Vertex.create(vertices[3].position).withUV(maxU, maxV);
    }

    render(tessellator) {
        tessellator.setColorShaded(this.shading);

        for (let i = 3; i >= 0; i--) {
            let vertex = this.vertices[i];

            tessellator.addVertexWithUV(vertex.position.x, vertex.position.y, vertex.position.z, vertex.u, vertex.v);
        }
    }
}