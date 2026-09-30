// Makes a .glb smaller for the web: meshopt compression (EXT_meshopt_compression; the game decodes it with
// lib/meshopt_decoder.js) and quantized normals, UVs, colours and skin weights. Positions stay exact floats, because the
// game reads them (js/player-model.js reshapes faces and weights hair by height, in metres).
//   npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
//   node tools/compress-glb.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
const [src, dst] = process.argv.slice(2);
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
await doc.transform(dedup(), prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder }),
  quantize({ pattern: /^(NORMAL|TEXCOORD_\d+|COLOR_\d+|WEIGHTS_\d+|JOINTS_\d+)$/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(dst, doc);
const fs = await import('node:fs');
console.log(src, (fs.statSync(src).size / 1e6).toFixed(2), 'MB ->', dst, (fs.statSync(dst).size / 1e6).toFixed(2), 'MB');
