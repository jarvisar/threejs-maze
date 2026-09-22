/**
 * Generates the wall layout for one chunk.
 *
 * A randomized Prim's pass carves a spanning tree through the odd cells of the grid, and the carved cells
 * become the walls. That turns the usual "maze of corridors" inside out into what reads as Backrooms-style
 * office space: branching partition walls and pillars in otherwise connected open floor.
 *
 * Every chunk also keeps two straight corridors open, along local row/column 0 and row/column size/2.
 * Together they form a grid of long hallways every `size / 2` cells that stitches chunks together, and
 * the spawn point (the centre of chunk 0,0) sits on one of their crossings. (The original version of
 * this project produced the same hallways as a side effect of how it positioned walls; they are a big
 * part of the look, so they're kept on purpose here.)
 *
 * @param {number} size Cells per side. Must be even.
 * @param {() => number} random PRNG returning floats in [0, 1).
 * @returns {Uint8Array} `size * size` cells indexed as `x * size + z`; 1 = wall, 0 = open.
 */
export function generateChunkCells(size, random) {
    if (size % 2 !== 0 || size < 4) throw new Error(`Chunk size must be an even number >= 4, got ${size}`);

    const cells = new Uint8Array(size * size);
    const index = (x, z) => x * size + z;

    cells[index(1, 1)] = 1;
    const frontier = [1, 1]; // flat list of x, z pairs
    const neighbours = [];

    while (frontier.length > 0) {
        // Take a random frontier cell (swap-remove keeps this O(1)).
        const pick = Math.floor(random() * (frontier.length / 2)) * 2;
        const x = frontier[pick];
        const z = frontier[pick + 1];
        frontier[pick] = frontier[frontier.length - 2];
        frontier[pick + 1] = frontier[frontier.length - 1];
        frontier.length -= 2;

        neighbours.length = 0;
        if (x >= 2) neighbours.push(x - 2, z);
        if (z >= 2) neighbours.push(x, z - 2);
        if (x < size - 2) neighbours.push(x + 2, z);
        if (z < size - 2) neighbours.push(x, z + 2);
        shufflePairs(neighbours, random);

        // Carve every unvisited neighbour of the picked cell, plus the cell between them.
        for (let i = 0; i < neighbours.length; i += 2) {
            const nx = neighbours[i];
            const nz = neighbours[i + 1];
            if (cells[index(nx, nz)] === 1) continue;
            cells[index(nx, nz)] = 1;
            cells[index((x + nx) / 2, (z + nz) / 2)] = 1;
            frontier.push(nx, nz);
        }
    }

    const mid = size / 2;
    for (let k = 0; k < size; k++) {
        cells[index(0, k)] = 0;
        cells[index(k, 0)] = 0;
        cells[index(mid, k)] = 0;
        cells[index(k, mid)] = 0;
    }

    return cells;
}

function shufflePairs(pairs, random) {
    for (let i = pairs.length / 2 - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const ax = pairs[i * 2], az = pairs[i * 2 + 1];
        pairs[i * 2] = pairs[j * 2];
        pairs[i * 2 + 1] = pairs[j * 2 + 1];
        pairs[j * 2] = ax;
        pairs[j * 2 + 1] = az;
    }
}
