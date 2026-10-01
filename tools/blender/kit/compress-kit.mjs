// The house kit's copy of tools/compress-glb.mjs (meshopt compression, quantized normals and UVs, positions exact floats),
// differing in two things. Empty nodes and extras survive: the kit's anim pivots (<node>_RockPivot ...), fixture sockets
// (<node>_fix) and SOCKET_* empties carry no mesh, and the shared script's prune() deletes such leaves. And the lo tier gets
// per-mesh targets: a JSON file {mesh name: [ratio, error]} (pack.py sets each node's ratio from its
// trisLo budget), the other meshes taking ratio and error.
//   node compress-kit.mjs in.glb out.glb [ratio [error [targets.json]]]   (run from /tmp/claude-0/gltft, beside its node_modules)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder, prune, dedup, weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
const [src, dst, ratio, err, targets] = process.argv.slice(2);
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
if (ratio) {
  const per = targets ? JSON.parse((await import('node:fs')).readFileSync(targets, 'utf8')) : {};
  await doc.transform(weld());
  for (const m of doc.getRoot().listMeshes()) {
    const [r, e] = per[m.getName()] || [+ratio, +(err || 0.0015)];
    for (const p of m.listPrimitives()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: r, error: e });
  }
}
await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }), reorder({ encoder: MeshoptEncoder }),
  quantize({ pattern: /^(NORMAL|TEXCOORD_\d+|COLOR_\d+|WEIGHTS_\d+|JOINTS_\d+)$/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(dst, doc);
const fs = await import('node:fs');
console.log(src, (fs.statSync(src).size / 1e6).toFixed(3), 'MB ->', dst, (fs.statSync(dst).size / 1e6).toFixed(3), 'MB');
