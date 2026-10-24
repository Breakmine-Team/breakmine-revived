// Shared between the client renderer and the server-authoritative off-grid
// state. Keep packet ids and limits in one place so both sides cannot drift.
export const OFF_GRID_PROTOCOL_VERSION = 1;

// Custom play-state packet ids. These sit above the vanilla protocol 47 ids
// and below 0x80, because the client reads packet ids as signed bytes and only
// ids < 0x80 stay positive. Keeping all four in one high block also avoids
// colliding with serverbound vanilla ids (0x00..0x19).
export const OFF_GRID_STATE_PACKET_ID = 0x60;
export const OFF_GRID_UPDATE_PACKET_ID = 0x61;
export const OFF_GRID_REQUEST_PACKET_ID = 0x62;
export const OFF_GRID_CELL_PACKET_ID = 0x63;

// Update actions for OFF_GRID_UPDATE_PACKET_ID.
export const OFF_GRID_UPDATE_SET_CELL = 0;
export const OFF_GRID_UPDATE_POSE = 1;
export const OFF_GRID_UPDATE_CLEAR_FIELD = 2;
export const OFF_GRID_UPDATE_ADD_GHOST = 3;
export const OFF_GRID_UPDATE_CLEAR_GHOSTS = 4;

// Limits mirror the client-side debug command and the field's own storage.
export const OFF_GRID_MAX_DIM = 64;
export const OFF_GRID_MAX_CELLS = 8192;
export const OFF_GRID_MAX_GHOSTS = 1024;
export const OFF_GRID_WORLD_HEIGHT = 256;
