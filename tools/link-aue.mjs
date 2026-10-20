// Links the AUE engine's packages (the `engine/` git submodule, docs/AUE.md) into node_modules/@aue, so Node resolves
// their `@aue/*` imports (run by `npm run link-aue` / postinstall).
//
// npm cannot install them itself: their package.json files name each other with pnpm's `workspace:*` protocol. A link
// is a directory junction on Windows (no administrator rights needed) and a symbolic link elsewhere; Node follows it to
// the real file, whose own `@aue/*` imports then resolve upwards to this same node_modules. Without the submodule
// (`git submodule update --init`), nothing is linked and the vanilla game runs as before.
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The engine packages the branch runs: the arithmetic, the formats, the battle core and its content. */
export const AUE_PACKAGES = Object.freeze(['math', 'schema', 'sim', 'content']);

/**
 * Each package's link: node_modules/@aue/<name> → engine/packages/<name>. Returns what it did per package; a link that
 * already points there is kept, anything else in its place is replaced.
 * @param {string} [repo] the repository root @returns {{ name: string, done: 'linked' | 'kept' | 'missing' }[]}
 */
export function linkAue(repo = root) {
  const engine = join(repo, 'engine', 'packages'), scope = join(repo, 'node_modules', '@aue');
  if (!existsSync(engine)) return AUE_PACKAGES.map((name) => ({ name, done: 'missing' }));
  mkdirSync(scope, { recursive: true });
  return AUE_PACKAGES.map((name) => {
    const target = join(engine, name), link = join(scope, name);
    if (!existsSync(join(target, 'package.json'))) return { name, done: 'missing' };
    const there = lstatSync(link, { throwIfNoEntry: false });
    if (there?.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === resolve(target)) return { name, done: 'kept' };
    if (there) rmSync(link, { recursive: true, force: true });
    symlinkSync(target, link, 'junction');
    return { name, done: 'linked' };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const done = linkAue();
  if (done.every((d) => d.done === 'missing')) console.warn('link-aue: no engine/ submodule (git submodule update --init); the AUE packages are not linked');
  else console.log(`link-aue: ${done.map((d) => `@aue/${d.name} ${d.done}`).join(', ')}`);
}
