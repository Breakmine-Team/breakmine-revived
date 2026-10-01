import { IsomorphicFilesystem } from './IsomorphicFilesystem.js';

// Shared filesystem instance for the server modules (config, world, players)
// and the integrated singleplayer server. The browser backend keeps a
// per-instance in-memory cache, so every module that reads/writes the same
// files must use the same instance or they will not see each other's writes.
const fs = new IsomorphicFilesystem();

export default fs;
