// A model made ready for the sea: its textures packed into the one file, cut to a phone's
// size and compressed, and its geometry compressed, so a guest on the bar's wifi downloads
// as little as can be. A ship goes to public/ships/<name>.glb, where her ModelFile's url
// finds it; a set of land (buildings, trees, rocks) to public/props/<name>.glb, for a
// PropSet in src/data/props.ts.
//
//   npm run ships:pack -- path/to/ship.glb jackdaw
//   npm run ships:pack -- path/to/ship.gltf jackdaw --size 2048 --ktx2
//   npm run ships:pack -- path/to/ship.glb revenant --names scripts/ships/revenant.json
//   npm run props:pack -- path/to/nassau.glb nassau
//
// A set can come in pieces, a file a prop the way packs are sold: give them all, and they
// are put into one file, each file's nodes as they were, and a texture they share kept once.
//
//   npm run props:pack -- palm-bend.glb rocks-a.glb … kenney-land --names scripts/props/kenney-land.json
//
// A file whose parts aren't named the way the art brief asks (a bought one, say) is put
// right with --names: a JSON file of node names to drop and to rename, matched as regular
// expressions on each node's whole name, renames in order, first match wins:
//
//   { "drop": ["^WaterPlane$"], "rename": [["^StylShip_(Sail\\w*)$", "sail_$1"]] }
//
// Textures are cut to 1024 px a side unless --size says otherwise: on a phone each 2048
// one costs 21 MB of memory uncompressed, and there are three to a ship.
//
// Textures go to WebP by default: small to download, but full size once on the GPU. With
// --ktx2 they go to KTX2 (ETC1S for colour, UASTC for normal and other data maps), which
// the GPU keeps compressed: a quarter of the memory or less, which is what a phone runs
// short of with a sea full of ships. That needs KTX-Software's `ktx` on the PATH.
//
// The steps are gltf-transform's (run through npx, pinned, so nothing is installed). Its
// `optimize` is not used: it joins meshes, which would lose the node names the game reads
// her sails, ports and colours by (src/render/ships/gltf.ts).

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const CLI = '@gltf-transform/cli@4.5.1';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return null; const [, v] = args.splice(i, 2); return v ?? ''; };
const ktx2 = args.includes('--ktx2');
if (ktx2) args.splice(args.indexOf('--ktx2'), 1);
const size = Number(flag('--size') ?? 1024);
const names = flag('--names');
const to = flag('--to') ?? 'ships';
const inputs = args.slice(0, -1), name = args.at(-1);
if (!inputs.length || !name || !/^[a-z0-9-]+$/.test(name) || !(size > 0) || !/^(ships|props)$/.test(to)) {
  console.error('usage: npm run ships:pack|props:pack -- <model.glb|.gltf>… <name> [--size 1024] [--ktx2] [--names map.json]');
  process.exit(1);
}

const run = (...a: string[]) => execFileSync('npx', ['-y', CLI, ...a], { stdio: ['ignore', 'ignore', 'inherit'] });
const work = mkdtempSync(join(tmpdir(), 'model-pack-'));
const step = (n: number) => join(work, `${n}.glb`);
const kb = (p: string) => `${(statSync(p).size / 1024).toFixed(0)} KB`;

interface Names { drop?: string[]; rename?: [string, string][] }
interface Node { name?: string; children?: number[]; mesh?: number; skin?: number; weights?: number[] }
interface Gltf { nodes?: Node[]; scenes?: { nodes: number[] }[] }

/** A GLB with its JSON changed by `edit`, and its binary chunk as it was. */
function edited(from: string, to: string, edit: (json: Gltf) => void) {
  const b = readFileSync(from);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  edit(json);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(to, Buffer.concat([head, text, rest]));
}

/** Nodes renamed and some dropped, by a --names map. A dropped node is only cut from the
 *  tree; `prune` then clears it and whatever only it used. */
const rename = (map: Names) => (json: Gltf) => {
  const drop = (map.drop ?? []).map((r) => new RegExp(r));
  const rules = (map.rename ?? []).map(([r, w]) => [new RegExp(r), w] as const);
  const nodes: Node[] = json.nodes ?? [];
  const gone = new Set<number>();
  let renamed = 0;
  nodes.forEach((n, i) => {
    const name = n.name ?? '';
    if (drop.some((r) => r.test(name))) { gone.add(i); return; }
    const rule = rules.find(([r]) => r.test(name));
    if (rule) { n.name = name.replace(rule[0], rule[1]); renamed++; }
  });
  for (const n of nodes) if (n.children) n.children = n.children.filter((c) => !gone.has(c));
  for (const sc of json.scenes ?? []) sc.nodes = sc.nodes.filter((c) => !gone.has(c));
  console.log(`names: ${gone.size} dropped, ${renamed} renamed`);
};

/** Every mesh moved to a node of its own, unnamed, under the node that held it, which keeps
 *  its name, its place and its children. Where a node stands is read: a prop's origin, a
 *  lid's hinge. Compressing a mesh's geometry moves its node to undo the compression, and
 *  would move that with it. */
const wrap = (json: Gltf) => {
  const nodes: Node[] = (json.nodes ??= []);
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    if (node.mesh === undefined) continue;
    nodes.push({ name: '', mesh: node.mesh, skin: node.skin, weights: node.weights });
    delete node.mesh; delete node.skin; delete node.weights;
    node.children = [...(node.children ?? []), nodes.length - 1];
  }
};

try {
  // one file, textures inside: pieces each read in, then put into one scene
  const ins = inputs.map((f, i) => { const o = join(work, `in${i}.glb`); run('copy', f, o); return o; });
  if (ins.length > 1) run('merge', ...ins, step(0), '--merge-scenes');
  else copyFileSync(ins[0], step(0));
  const map = names ? JSON.parse(readFileSync(names, 'utf8')) as Names : null;
  edited(step(0), step(9), (json) => { if (map) rename(map)(json); wrap(json); });
  run('dedup', step(9), step(8));                                   // a texture the pieces share, once
  // empties are kept: a muzzle, a flag's hoist, a lighthouse's lamp is one
  run('prune', step(8), step(1), '--keep-leaves', 'true');
  run('resize', step(1), step(2), '--width', String(size), '--height', String(size));
  if (ktx2) {
    run('uastc', step(2), step(3), '--slots', '{normalTexture,occlusionTexture,metallicRoughnessTexture}');
    run('etc1s', step(3), step(4), '--slots', '{baseColorTexture,emissiveTexture}');
  } else {
    run('webp', step(2), step(4));
  }
  run('meshopt', step(4), step(5));
  mkdirSync(join('public', to), { recursive: true });
  const out = join('public', to, `${name}.glb`);
  copyFileSync(step(5), out);
  const from = inputs.length > 1 ? `${inputs.length} files` : `${basename(inputs[0])} (${kb(inputs[0])})`;
  console.log(`${from} → ${out} (${kb(out)})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
