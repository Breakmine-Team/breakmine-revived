const rotate = (point, axis, angle, origin, rescale = false) => {
    const axes = { x: [1, 2], y: [2, 0], z: [0, 1] }[axis];
    if (!axes) throw new Error('Invalid native model rotation axis');
    const p = point.map((v, i) => v - origin[i]);
    const [a, b] = axes, rad = angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    const first = p[a] * c - p[b] * s, second = p[a] * s + p[b] * c;
    p[a] = first; p[b] = second;
    if (rescale) { p[a] /= Math.abs(c); p[b] /= Math.abs(c); }
    return p.map((v, i) => v + origin[i]);
};
const directions = { down: [0,-1,0], up: [0,1,0], north: [0,0,-1], south: [0,0,1], west: [-1,0,0], east: [1,0,0] };

export function nativeFeatureQuads(descriptor) {
    const output = [];
    for (const part of descriptor.parts) for (const element of part.elements) {
        const [a, b, c] = element.from, [d, e, f] = element.to;
        const vertices = {
            down: [[a,b,f],[a,b,c],[d,b,c],[d,b,f]], up: [[a,e,c],[a,e,f],[d,e,f],[d,e,c]],
            north: [[d,b,c],[a,b,c],[a,e,c],[d,e,c]], south: [[a,b,f],[d,b,f],[d,e,f],[a,e,f]],
            west: [[a,b,c],[a,b,f],[a,e,f],[a,e,c]], east: [[d,b,f],[d,b,c],[d,e,c],[d,e,f]]
        };
        const defaults = { down: [a,16-f,d,16-c], up: [a,c,d,f], north: [16-d,16-e,16-a,16-b],
            south: [a,16-e,d,16-b], west: [c,16-e,f,16-b], east: [16-f,16-e,16-c,16-b] };
        for (const [face, entry] of Object.entries(element.faces)) {
            let points = vertices[face].map(v => v.map(n => n / 16));
            if (element.rotation) {
                const r = element.rotation;
                points = points.map(p => rotate(p, r.axis, r.angle, r.origin.map(v => v / 16), r.rescale));
            }
            if (part.x) points = points.map(p => rotate(p, 'x', -part.x, [0.5,0.5,0.5]));
            if (part.y) points = points.map(p => rotate(p, 'y', -part.y, [0.5,0.5,0.5]));
            const [u0,v0,u1,v1] = entry.uv ?? defaults[face];
            const uv = [[u0,v1],[u1,v1],[u1,v0],[u0,v0]];
            const shift = (entry.rotation ?? 0) / 90;
            let mappedUV = uv.map((_, i) => uv[(i + shift) % 4]);
            if (part.uvlock) {
                const a = points[1].map((v, i) => v - points[0][i]), b = points[2].map((v, i) => v - points[0][i]);
                const n = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
                const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
                mappedUV = points.map(([x,y,z]) => {
                    const pair = axis === 0 ? (n[0] > 0 ? [1-z,1-y] : [z,1-y])
                        : axis === 1 ? (n[1] > 0 ? [x,z] : [x,1-z]) : (n[2] > 0 ? [x,1-y] : [1-x,1-y]);
                    return [u0 + pair[0]*(u1-u0), v0 + pair[1]*(v1-v0)];
                });
            }
            // FaceBakery.calculateFacing uses the baked vertices, including
            // deliberately inverted inner elements such as the spawner cage.
            const edgeA = points[1].map((v, i) => v - points[0][i]);
            const edgeB = points[2].map((v, i) => v - points[0][i]);
            const cross = [edgeA[1]*edgeB[2]-edgeA[2]*edgeB[1], edgeA[2]*edgeB[0]-edgeA[0]*edgeB[2], edgeA[0]*edgeB[1]-edgeA[1]*edgeB[0]];
            const length = Math.hypot(...cross);
            const normal = length ? cross.map(v => v / length) : [0,1,0];
            let cullface = null;
            if (entry.cullface) {
                let direction = directions[entry.cullface];
                if (part.x) direction = rotate(direction, 'x', -part.x, [0,0,0]);
                if (part.y) direction = rotate(direction, 'y', -part.y, [0,0,0]);
                cullface = Object.keys(directions).find(name => directions[name].every((v, i) => Math.abs(v - direction[i]) < 1e-6));
            }
            output.push({ face, normal, cullface, points, uv: mappedUV, texture: entry.texture,
                shadeDirectionOverride: element.shade_direction_override ?? null,
                tintType: entry.tintindex === 0 ? descriptor.tintType ?? 'grass' : null });
        }
    }
    return output;
}
