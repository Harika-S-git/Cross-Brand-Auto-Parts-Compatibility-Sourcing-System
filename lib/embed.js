// Text -> 384-dimensional, L2-normalised embedding.
//  transformers : Xenova/all-MiniLM-L6-v2 (ONNX, runs locally, no API key)   [default]
//  hash         : deterministic feature-hashing fallback (offline / CI)
export const EMBEDDING_DIM = 384;

let extractorPromise;
async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@xenova/transformers').then(({ pipeline, env }) => {
      env.allowLocalModels = false;
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }).catch((e) => {
      extractorPromise = undefined; // allow a retry on the next request
      const err = new Error(`Embedding model failed to load: ${e.message}`);
      err.userMessage = 'The semantic embedding model could not be loaded (needs internet on first use). Connect to the internet, or set EMBEDDING_PROVIDER=hash in .env.local, restart, and run: npm run db:seed';
      err.status = 503;
      throw err;
    });
  }
  return extractorPromise;
}

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashEmbed(text) {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').split(/\s+/).filter(Boolean);
  const add = (feature, w) => {
    const h = fnv1a(feature);
    vec[h % EMBEDDING_DIM] += (h & 0x80000000 ? -1 : 1) * w;
  };
  words.forEach((w, i) => {
    add('w:' + w, 1);
    if (i > 0) add('b:' + words[i - 1] + '_' + w, 0.5);
    const padded = `#${w}#`;
    for (let k = 0; k < padded.length - 2; k++) add('c:' + padded.slice(k, k + 3), 0.3);
  });
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export async function embed(text) {
  if ((process.env.EMBEDDING_PROVIDER || 'transformers') === 'hash') return hashEmbed(text);
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

/** pgvector literal, e.g. '[0.1,0.2,...]' -- pass as a parameter with ::vector */
export const toPgVector = (arr) => '[' + arr.join(',') + ']';

/** What actually gets embedded for a part: identity + description + fitment, so that
 *  differently-worded catalog entries for the same real part land close together. */
export function buildPartText({ brand, name, description, category, vehicles = [] }) {
  const fits = vehicles.map((v) => `${v.make} ${v.model} ${v.year} ${v.engine}`).join('; ');
  return `${category}. ${brand} ${name}. ${description}${fits ? ` Fits: ${fits}.` : ''}`;
}
