// A tiny stand-in for the Transformers.js library, used ONLY by tests (loaded from the local test server).
// It mimics the parts media-worker.js uses: env, pipeline(), the callable pipeline, dispose().
// Also fakes the 'translation' pipeline (translate-worker.js).
// Model names choose the behaviour:  test/fast = quick, test/slow = waits 8 s per call,
// test/missing = pipeline() fails like a missing model file.
export const env = { allowLocalModels: true, backends: { onnx: { wasm: {} } } };

export async function pipeline(task, model, opts) {
  if (model.includes('missing')) throw new Error('Could not locate file: ' + model);
  if (model.includes('gpufail') && opts && opts.device === 'webgpu') throw new Error('WebGPU failed for ' + model);
  if (opts && typeof opts.progress_callback === 'function') {
    opts.progress_callback({ status: 'progress', progress: 50, file: 'x' });
    opts.progress_callback({ status: 'progress', progress: 100, file: 'x' });
  }
  if (task === 'translation') {
    // Stand-in for the translation pipeline: shows which language codes it was given.
    // test/slow waits 8 s per text (for cancel tests).
    const tr = async (text, o) => {
      if (model.includes('slow')) await new Promise((r) => setTimeout(r, 8000));
      return [{ translation_text: '[' + (o && o.src_lang) + '>' + (o && o.tgt_lang) + '] ' + text }];
    };
    tr.dispose = async () => {};
    return tr;
  }
  const pipe = async (audio, o) => {
    if (model.includes('slow')) await new Promise((r) => setTimeout(r, 8000));
    if (o && o.streamer) {
      for (let i = 0; i < 5; i++) o.streamer.put([i]);
      o.streamer.end();
    }
    const seconds = audio.length / 16000;
    return {
      text: ' hello world',
      chunks: [
        { text: ' hello ' + ((o && o.language) || 'none'), timestamp: [0, seconds / 2] },
        { text: ' world', timestamp: [seconds / 2, null] }
      ]
    };
  };
  pipe.dispose = async () => {};
  pipe.processor = async () => ({ input_features: {} });
  pipe.model = {
    generation_config: { lang_to_id: { '<|en|>': 50, '<|fa|>': 51 }, decoder_start_token_id: 1 },
    generate: async () => ({ tolist: () => [[1, 51]] })
  };
  return pipe;
}
