// Folder tree for the IDE's file browser. Pure data in, pure data out: no DOM and
// no Vite-only imports, so the tree can be tested straight from Node.

function sortChildren(node) {
    if (!node.dir) return;

    node.children.sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1;
        return a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
    });

    for (const child of node.children) sortChildren(child);
}

// `files` are plain paths such as "net/minecraft/client/ModLoader.js".
export function buildSourceTree(files) {
    const root = { name: "", path: "", dir: true, children: [] };
    const directories = new Map([["", root]]);

    for (const file of files) {
        if (typeof file !== "string") continue;

        const parts = file.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        let parent = root;
        let prefix = "";
        for (let i = 0; i < parts.length - 1; i++) {
            prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];

            let directory = directories.get(prefix);
            if (!directory) {
                directory = { name: parts[i], path: prefix, dir: true, children: [] };
                directories.set(prefix, directory);
                parent.children.push(directory);
            }
            parent = directory;
        }

        parent.children.push({ name: parts[parts.length - 1], path: file, dir: false });
    }

    sortChildren(root);
    return root;
}

export function countFiles(node) {
    if (!node.dir) return 1;

    let total = 0;
    for (const child of node.children) total += countFiles(child);
    return total;
}

// Every folder path in the tree, parents before children.
export function collectDirectoryPaths(node, collected = []) {
    if (!node.dir) return collected;

    for (const child of node.children) {
        if (!child.dir) continue;
        collected.push(child.path);
        collectDirectoryPaths(child, collected);
    }
    return collected;
}

// Folder paths that have to be open for `file` to be visible.
export function ancestorPaths(file) {
    const parts = String(file).split("/").filter(Boolean);
    const paths = [];

    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
        paths.push(prefix);
    }
    return paths;
}
