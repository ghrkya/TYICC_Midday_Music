class PcmRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const channels = input.length
    const frameLen = input[0].length
    if (!frameLen) return true

    // 某些设备只有单侧声道有信号，这里做多声道平均，避免录到静音。
    const mixed = new Float32Array(frameLen)
    for (let ch = 0; ch < channels; ch++) {
      const channelData = input[ch]
      if (!channelData) continue
      for (let i = 0; i < frameLen; i++) {
        mixed[i] += channelData[i]
      }
    }

    const divisor = channels > 0 ? channels : 1
    for (let i = 0; i < frameLen; i++) {
      mixed[i] /= divisor
    }

    this.port.postMessage({ type: 'chunk', buffer: mixed.buffer }, [mixed.buffer])
    return true
  }
}

registerProcessor('pcm-recorder-processor', PcmRecorderProcessor)
